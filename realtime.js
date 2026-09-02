import { WebSocket, WebSocketServer } from "ws";

const PHOTO_ID_PATTERN = /^[a-zA-Z0-9-]{6,80}$/;
const ROOM_TTL_MS = 10 * 60 * 1000;

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function roomSnapshot(room) {
  const clients = [...room.clients];
  return {
    phones: clients.filter((client) => client.role === "phone").length,
    kiosks: clients.filter((client) => client.role === "kiosk").length,
    cards: room.cards,
    moved: room.moved,
    transfer: room.transfer,
  };
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export function attachRealtimeServer(server, { allowedOrigins = [] } = {}) {
  const rooms = new Map();
  const websocketServer = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 8 * 1024,
    verifyClient({ req }, done) {
      const origin = req.headers.origin;
      done(!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin), 403, "Origin not allowed");
    },
  });

  const getRoom = (photoId) => {
    if (!rooms.has(photoId)) {
      rooms.set(photoId, {
        clients: new Set(),
        cards: {
          original: { x: 0.7, y: 0.3 },
          styled: { x: 0.76, y: 0.62 },
        },
        moved: false,
        transfer: null,
        updatedAt: Date.now(),
      });
    }
    return rooms.get(photoId);
  };

  const broadcast = (room, message) => {
    room.updatedAt = Date.now();
    room.clients.forEach((client) => send(client, message));
  };

  websocketServer.on("connection", (socket) => {
    socket.isAlive = true;
    socket.on("pong", () => { socket.isAlive = true; });

    const joinTimeout = setTimeout(() => socket.close(1008, "Join required"), 5000);

    socket.on("message", (rawMessage) => {
      let message;
      try {
        message = JSON.parse(rawMessage.toString());
      } catch {
        socket.close(1007, "Invalid message");
        return;
      }

      if (message.type === "join") {
        if (!PHOTO_ID_PATTERN.test(message.photoId || "") || !["kiosk", "phone"].includes(message.role)) {
          socket.close(1008, "Invalid room");
          return;
        }
        clearTimeout(joinTimeout);
        if (socket.room) socket.room.clients.delete(socket);
        socket.photoId = message.photoId;
        socket.role = message.role;
        socket.room = getRoom(message.photoId);
        socket.room.clients.add(socket);
        send(socket, { type: "session", serverTime: Date.now(), ...roomSnapshot(socket.room) });
        broadcast(socket.room, { type: "presence", ...roomSnapshot(socket.room) });
        return;
      }

      if (!socket.room) return;

      if (message.type === "card:move" && socket.role === "kiosk" && ["original", "styled"].includes(message.card)) {
        socket.room.moved = true;
        socket.room.cards[message.card] = { x: clamp(message.x), y: clamp(message.y) };
        broadcast(socket.room, {
          type: "card:move",
          card: message.card,
          ...socket.room.cards[message.card],
          dragging: Boolean(message.dragging),
        });
      }

      if (message.type === "handoff:transfer" && socket.role === "kiosk") {
        socket.room.transfer = { startAt: Date.now() + 900, version: Date.now() };
        broadcast(socket.room, { type: "handoff:transfer", ...socket.room.transfer });
      }
    });

    socket.on("close", () => {
      clearTimeout(joinTimeout);
      if (!socket.room) return;
      socket.room.clients.delete(socket);
      broadcast(socket.room, { type: "presence", ...roomSnapshot(socket.room) });
    });
  });

  const heartbeat = setInterval(() => {
    websocketServer.clients.forEach((socket) => {
      if (!socket.isAlive) {
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
    const expiry = Date.now() - ROOM_TTL_MS;
    rooms.forEach((room, photoId) => {
      if (room.clients.size === 0 && room.updatedAt < expiry) rooms.delete(photoId);
    });
  }, 25_000);

  websocketServer.on("close", () => clearInterval(heartbeat));
  return websocketServer;
}
