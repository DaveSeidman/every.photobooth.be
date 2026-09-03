import { WebSocket, WebSocketServer } from "ws";

const PHOTO_ID_PATTERN = /^[a-zA-Z0-9-]{6,80}$/;
const ROOM_TTL_MS = 10 * 60 * 1000;
const EMPTY_ROOM_GRACE_MS = 30 * 1000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function cardPosition(message) {
  return {
    x: clamp(message.x, -1, 2),
    y: clamp(message.y, -1, 2),
    phoneX: clamp(message.phoneX, -3, 4),
    phoneY: clamp(message.phoneY, -3, 4),
    rotation: clamp(message.rotation, -30, 30),
    layer: clamp(message.layer, 0, 1_000_000),
    settled: Boolean(message.settled),
  };
}

function roomSnapshot(room) {
  const clients = [...room.clients];
  return {
    phones: clients.filter((client) => client.role === "phone").length,
    kiosks: clients.filter((client) => client.role === "kiosk").length,
    cards: room.cards,
    moved: room.moved,
  };
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function validMove(move) {
  return move && ["original", "styled"].includes(move.card);
}

export function attachRealtimeServer(server, { allowedOrigins = [] } = {}) {
  const rooms = new Map();
  const cleanupTimers = new Map();
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
    clearTimeout(cleanupTimers.get(photoId));
    cleanupTimers.delete(photoId);
    if (!rooms.has(photoId)) {
      rooms.set(photoId, {
        clients: new Set(),
        cards: {
          original: { x: 0.7, y: 0.3, phoneX: 2, phoneY: 0.3, rotation: -3, layer: 1, settled: false },
          styled: { x: 0.76, y: 0.62, phoneX: 2, phoneY: 0.62, rotation: 2, layer: 2, settled: false },
        },
        moved: false,
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

      if (message.type === "cards:move" && socket.role === "kiosk" && Array.isArray(message.cards)) {
        const moves = message.cards.slice(0, 2).filter(validMove).map((move) => {
          socket.room.cards[move.card] = cardPosition(move);
          return {
            card: move.card,
            ...socket.room.cards[move.card],
            dragging: Boolean(move.dragging),
          };
        });
        if (moves.length) {
          socket.room.moved = true;
          broadcast(socket.room, { type: "cards:move", cards: moves });
        }
      }

      // Accept the original single-card event while older deployed clients roll forward.
      if (message.type === "card:move" && socket.role === "kiosk" && validMove(message)) {
        socket.room.moved = true;
        socket.room.cards[message.card] = cardPosition(message);
        broadcast(socket.room, { type: "cards:move", cards: [{
          card: message.card,
          ...socket.room.cards[message.card],
          dragging: Boolean(message.dragging),
        }] });
      }

      if (message.type === "handoff:complete" && socket.role === "kiosk") {
        broadcast(socket.room, { type: "handoff:complete", version: Date.now() });
      }
    });

    socket.on("close", () => {
      clearTimeout(joinTimeout);
      if (!socket.room) return;
      socket.room.clients.delete(socket);
      broadcast(socket.room, { type: "presence", ...roomSnapshot(socket.room) });
      if (socket.room.clients.size === 0) {
        cleanupTimers.set(socket.photoId, setTimeout(() => {
          const room = rooms.get(socket.photoId);
          if (room?.clients.size === 0) rooms.delete(socket.photoId);
          cleanupTimers.delete(socket.photoId);
        }, EMPTY_ROOM_GRACE_MS));
      }
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
      if (room.clients.size === 0 && room.updatedAt < expiry) {
        rooms.delete(photoId);
        clearTimeout(cleanupTimers.get(photoId));
        cleanupTimers.delete(photoId);
      }
    });
  }, 25_000);

  websocketServer.on("close", () => {
    clearInterval(heartbeat);
    cleanupTimers.forEach((timer) => clearTimeout(timer));
  });
  return websocketServer;
}
