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

async function connect(role, photoId = "portrait-123", clientId) {
  const socket = new WebSocket(websocketUrl);
  clients.push(socket);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const session = waitFor(socket, "session");
  socket.send(JSON.stringify({ type: "join", photoId, role, clientId }));
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

  const cardMove = waitFor(phone, "cards:move");
  kiosk.send(JSON.stringify({
    type: "cards:move",
    cards: [{ card: "styled", x: 0.42, y: 0.61, phoneX: 1.24, phoneY: 0.47, rotation: 2, layer: 3, settled: false, dragging: true }],
  }));
  assert.deepEqual(await cardMove, {
    type: "cards:move",
    cards: [{
      card: "styled",
      x: 0.42,
      y: 0.61,
      phoneX: 1.24,
      phoneY: 0.47,
      rotation: 2,
      layer: 3,
      settled: false,
      dragging: true,
    }],
  });

  const { socket: secondPhone } = await connect("phone");
  const completion = waitFor(phone, "handoff:complete");
  const secondCompletion = waitFor(secondPhone, "handoff:complete");
  kiosk.send(JSON.stringify({ type: "handoff:complete" }));
  assert.ok((await completion).version);
  assert.ok((await secondCompletion).version, "every connected phone receives the kiosk handoff");

  const { session: lateSession } = await connect("phone");
  assert.equal(lateSession.completed, undefined, "a completed handoff must not replay when a phone reconnects");
});

test("phone connection automatically schedules one transfer shared by tablet and phone", async () => {
  const photoId = "auto-transfer-123";
  const { socket: kiosk } = await connect("kiosk", photoId);
  const tabletTransfer = waitFor(kiosk, "handoff:transfer");
  const { session: phoneSession } = await connect("phone", photoId);
  const tablet = await tabletTransfer;
  assert.deepEqual(phoneSession.handoff, tablet.handoff);
  assert.equal(tablet.handoff.startsAt - tablet.serverTime, 450);
  assert.equal(tablet.handoff.exitMs, 750);
  assert.equal(tablet.handoff.phoneDelayMs, 1100);
  assert.ok(tablet.handoff.phoneDelayMs > tablet.handoff.exitMs, "phone waits until tablet has left");
  assert.equal(tablet.handoff.durationMs, 2400);
  const { session: secondPhone } = await connect("phone", photoId);
  assert.notEqual(secondPhone.handoff.id, tablet.handoff.id);
  assert.ok(secondPhone.handoff.startsAt - 450 >= tablet.handoff.startsAt + tablet.handoff.durationMs + 200,
    "another phone waits for the tablet photo to return before repeating the sequence");
});

test("phone-first connection waits for a booth, then automatically transfers", async () => {
  const photoId = "phone-first-123";
  const { socket: phone, session } = await connect("phone", photoId);
  assert.equal(session.handoff, null);
  const incoming = waitFor(phone, "handoff:transfer");
  const { session: kiosk } = await connect("kiosk", photoId);
  assert.deepEqual((await incoming).handoff, kiosk.handoff);
});

test("finished transfers survive reconnect without a fresh animation timestamp", async () => {
  const photoId = "reconnect-transfer-123";
  const { session: alone } = await connect("kiosk", photoId);
  assert.equal(alone.handoff, null);
  const { socket: phone, session: first } = await connect("phone", photoId, "stable-phone-client");
  phone.close();
  const { session: rejoined } = await connect("phone", photoId, "stable-phone-client");
  assert.deepEqual(rejoined.handoff, first.handoff);
});
