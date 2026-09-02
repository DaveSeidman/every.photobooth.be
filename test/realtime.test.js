import { createServer } from "node:http";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { attachRealtimeServer } from "../realtime.js";

let server;
let websocketServer;
let websocketUrl;
const clients = [];

function waitFor(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 1500);
    const onMessage = (rawMessage) => {
      const message = JSON.parse(rawMessage.toString());
      if (message.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

async function connect(role) {
  const socket = new WebSocket(websocketUrl);
  clients.push(socket);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const session = waitFor(socket, "session");
  socket.send(JSON.stringify({ type: "join", photoId: "portrait-123", role }));
  return { socket, session: await session };
}

before(async () => {
  server = createServer((_request, response) => response.end("ok"));
  websocketServer = attachRealtimeServer(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  websocketUrl = `ws://127.0.0.1:${server.address().port}/ws`;
});

after(async () => {
  clients.forEach((client) => client.close());
  await new Promise((resolve) => websocketServer.close(resolve));
  await new Promise((resolve) => server.close(resolve));
});

test("kiosk and phone share continuous card positions and one-time handoff completion", async () => {
  const { socket: kiosk } = await connect("kiosk");
  const kioskPresence = waitFor(kiosk, "presence");
  const { socket: phone } = await connect("phone");
  assert.equal((await kioskPresence).phones, 1);

  const cardMove = waitFor(phone, "card:move");
  kiosk.send(JSON.stringify({
    type: "card:move",
    card: "styled",
    x: 0.42,
    y: 0.61,
    phoneX: 1.24,
    phoneY: 0.47,
    rotation: 2,
    dragging: true,
  }));
  assert.deepEqual(await cardMove, {
    type: "card:move",
    card: "styled",
    x: 0.42,
    y: 0.61,
    phoneX: 1.24,
    phoneY: 0.47,
    rotation: 2,
    dragging: true,
  });

  const completion = waitFor(phone, "handoff:complete");
  kiosk.send(JSON.stringify({ type: "handoff:complete" }));
  assert.ok((await completion).version);

  const { session: lateSession } = await connect("phone");
  assert.equal(lateSession.completed, undefined, "a completed handoff must not replay when a phone reconnects");
});
