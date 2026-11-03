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

test("phone tear movement is bounded and relayed only within its tablet room", async () => {
  const photoId="takeaway-echo-123";
  const {socket:kiosk}=await connect("kiosk",photoId);
  const {socket:other}=await connect("kiosk","unrelated-takeaway-123");
  let crossedRooms=0;
  other.on("message",raw=>{if(JSON.parse(raw).type==="takeaway:interaction")crossedRooms++;});
  const {socket:phone}=await connect("phone",photoId,"phone-echo-123");
  const grabbed=waitFor(kiosk,"takeaway:interaction");
  phone.send(JSON.stringify({type:"takeaway:interaction",action:"grab",gestureId:"gesture-echo-123",grabX:.9}));
  assert.equal((await grabbed).action,"grab");
  const moved=waitFor(kiosk,"takeaway:interaction");
  phone.send(JSON.stringify({type:"takeaway:interaction",action:"pull",gestureId:"gesture-echo-123",x:500,y:500,angle:500,progress:500,origin:100}));
  const event=await moved;
  assert.equal(event.x,1);assert.equal(event.y,1);assert.equal(event.angle,60);assert.equal(event.progress,1);
  assert.equal(event.origin,100);assert.equal(event.clientId,"phone-echo-123");
  const cancelled=waitFor(kiosk,"takeaway:interaction");
  phone.close();
  assert.equal((await cancelled).action,"cancel");
  assert.equal(crossedRooms,0);
});

test("simultaneous phones cannot take over the tablet during an owned tear", async () => {
  const photoId="takeaway-multiple-123";
  const {socket:kiosk}=await connect("kiosk",photoId);
  const {socket:first}=await connect("phone",photoId,"phone-first-123");
  const {socket:second}=await connect("phone",photoId,"phone-second-123");
  const received=[];
  kiosk.on("message",raw=>{const event=JSON.parse(raw);if(event.type==="takeaway:interaction")received.push(event);});
  const grab=waitFor(kiosk,"takeaway:interaction");
  first.send(JSON.stringify({type:"takeaway:interaction",action:"grab",gestureId:"first-gesture-123"}));
  await grab;
  second.send(JSON.stringify({type:"takeaway:interaction",action:"grab",gestureId:"second-gesture-123"}));
  second.send(JSON.stringify({type:"takeaway:interaction",action:"detach",gestureId:"second-gesture-123"}));
  second.send(JSON.stringify({type:"takeaway:interaction",action:"share-complete",gestureId:"second-gesture-123"}));
  const moved=waitFor(kiosk,"takeaway:interaction");
  first.send(JSON.stringify({type:"takeaway:interaction",action:"pull",gestureId:"first-gesture-123",progress:.5}));
  assert.equal((await moved).clientId,"phone-first-123");
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(received.every(event=>event.clientId==="phone-first-123"));
  const detached=waitFor(kiosk,"takeaway:interaction");
  first.send(JSON.stringify({type:"takeaway:interaction",action:"detach",gestureId:"first-gesture-123"}));
  await detached;
  second.send(JSON.stringify({type:"takeaway:interaction",action:"grab",gestureId:"third-gesture-123"}));
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(received.every(event=>event.clientId==="phone-first-123"),"ownership lasts through the tablet's return animation");
});

test("relay does not discard a normal motion burst when packets arrive together", async () => {
  const photoId="takeaway-burst-123";
  const {socket:kiosk}=await connect("kiosk",photoId);
  const {socket:phone}=await connect("phone",photoId,"phone-burst-123");
  const grabbed=waitFor(kiosk,"takeaway:interaction");
  phone.send(JSON.stringify({type:"takeaway:interaction",action:"grab",gestureId:"burst-gesture-123"}));
  await grabbed;
  const received=[];
  const all=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Dropped motion burst')),1500);
    const listener=raw=>{const m=JSON.parse(raw);if(m.type==='takeaway:interaction'&&m.action==='pull'){received.push(m.x);if(received.length===8){clearTimeout(timeout);kiosk.off('message',listener);resolve();}}};
    kiosk.on('message',listener);
  });
  for(let i=1;i<=8;i++)phone.send(JSON.stringify({type:"takeaway:interaction",action:"pull",gestureId:"burst-gesture-123",x:i/10}));
  await all;assert.deepEqual(received,[.1,.2,.3,.4,.5,.6,.7,.8]);
});
