import { WebSocket, WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

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

function roomSnapshot(room, client) {
  const clients = [...room.clients];
  return {
    phones: clients.filter((client) => client.role === "phone").length,
    kiosks: clients.filter((client) => client.role === "kiosk").length,
    cards: room.cards,
    moved: room.moved,
    handoff: client?.role === "phone" ? room.deliveries.get(client.clientId) || null : room.handoff || null,
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
        deliveries: new Map(),
        transferTimers: new Set(),
        nextTransferAt: 0,
        updatedAt: Date.now(),
      });
    }
    return rooms.get(photoId);
  };

  const broadcast = (room, message) => {
    room.updatedAt = Date.now();
    room.clients.forEach((client) => send(client, message));
  };

  const schedulePhone = (room, clientId) => {
    if (room.deliveries.has(clientId)) return;
    const now = Date.now();
    const startsAt = Math.max(now + 450, room.nextTransferAt);
    const handoff = {
      id: randomUUID(), recipientId: clientId, startsAt,
      exitMs: 750, phoneDelayMs: 1100, phoneDurationMs: 700,
      returnDelayMs: 1950, returnDurationMs: 450, durationMs: 2400,
    };
    room.deliveries.set(clientId, handoff);
    // The next event reaches the tablet 450 ms before its animation starts.
    // Leave that lead-in after restoration, so it cannot cancel the return early.
    room.nextTransferAt = startsAt + handoff.durationMs + 450 + 200;
    const dispatch = () => {
      if (![...room.clients].some((client) => client.role === "phone" && client.clientId === clientId)) return;
      room.handoff = handoff;
      room.updatedAt = Date.now();
      room.clients.forEach((client) => {
        if (client.role === "kiosk" || client.clientId === clientId) send(client, { type: "handoff:transfer", serverTime: Date.now(), handoff });
      });
    };
    const delay = startsAt - now - 450;
    if (delay <= 0) dispatch();
    else {
      const timer = setTimeout(() => { room.transferTimers.delete(timer); dispatch(); }, delay);
      room.transferTimers.add(timer);
    }
  };

  const deleteRoom = (photoId) => {
    rooms.get(photoId)?.transferTimers.forEach(clearTimeout);
    rooms.delete(photoId);
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
        socket.clientId = typeof message.clientId === "string" && /^[a-zA-Z0-9-]{6,100}$/.test(message.clientId) ? message.clientId : randomUUID();
        socket.room = getRoom(message.photoId);
        socket.room.clients.add(socket);
        const room = socket.room;
        const presence = roomSnapshot(room);
        if (presence.phones > 0 && presence.kiosks > 0) {
          new Set([...room.clients].filter((client) => client.role === "phone").map((client) => client.clientId))
            .forEach((clientId) => schedulePhone(room, clientId));
        }
        send(socket, { type: "session", serverTime: Date.now(), ...roomSnapshot(socket.room, socket) });
        broadcast(socket.room, { type: "presence", ...roomSnapshot(socket.room) });
        return;
      }

      if (!socket.room) return;

      if (message.type === "takeaway:interaction" && socket.role === "phone") {
        const actions = ["grab", "pull", "cancel", "detach", "share-start", "share-complete", "download-started", "share-cancelled", "share-error"];
        if (!actions.includes(message.action)) return;
        const now = Date.now();
        if (message.action === "pull" && now - (socket.lastTakeawayPull || 0) < 50) return;
        if (message.action === "pull") socket.lastTakeawayPull = now;
        const gestureId = typeof message.gestureId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(message.gestureId) ? message.gestureId : "share";
        // Hold one gesture's ownership through its return animation. Other
        // phones continue locally, but cannot redirect this tablet mid-tear.
        const room = socket.room;
        if (room.takeawayOwner?.expiresAt <= now) room.takeawayOwner = null;
        const owner = room.takeawayOwner;
        if (owner && (owner.socket !== socket || owner.gestureId !== gestureId)) return;
        if (!owner && ["pull", "cancel"].includes(message.action)) return;
        if (["grab", "detach"].includes(message.action) || owner) {
          const hold = message.action === "cancel" ? 650 : message.action === "detach" ? 2400 : ["grab", "pull"].includes(message.action) ? 8000 : Math.max(0, (owner?.expiresAt || now) - now);
          room.takeawayOwner = {socket, gestureId, expiresAt: now + hold};
        }
        const interaction = {
          type: "takeaway:interaction", action: message.action, gestureId, clientId: socket.clientId, serverTime: now,
          progress: clamp(message.progress, 0, 1), x: clamp(message.x, -1, 1), y: clamp(message.y, 0, 1),
          angle: clamp(message.angle, -60, 60), origin: message.origin === 100 ? 100 : 0,
          grabX: clamp(message.grabX, 0, 1), grabY: clamp(message.grabY, 0, 1),
          method: message.method === "pull" ? "pull" : "tap",
        };
        socket.takeawayGesture = ["grab", "pull"].includes(message.action) ? interaction : null;
        socket.room.clients.forEach((client) => { if (client.role === "kiosk") send(client, interaction); });
        return;
      }

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
      if (socket.takeawayGesture) {
        if (socket.room.takeawayOwner?.socket === socket) socket.room.takeawayOwner.expiresAt = Date.now() + 650;
        socket.room.clients.forEach((client) => {
        if (client.role === "kiosk") send(client, {...socket.takeawayGesture, action:"cancel", serverTime:Date.now()});
        });
      }
      broadcast(socket.room, { type: "presence", ...roomSnapshot(socket.room) });
      if (socket.room.clients.size === 0) {
        cleanupTimers.set(socket.photoId, setTimeout(() => {
          const room = rooms.get(socket.photoId);
          if (room?.clients.size === 0) deleteRoom(socket.photoId);
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
        deleteRoom(photoId);
        clearTimeout(cleanupTimers.get(photoId));
        cleanupTimers.delete(photoId);
      }
    });
  }, 25_000);

  websocketServer.on("close", () => {
    clearInterval(heartbeat);
    cleanupTimers.forEach((timer) => clearTimeout(timer));
    rooms.forEach((room) => room.transferTimers.forEach(clearTimeout));
  });
  return websocketServer;
}
