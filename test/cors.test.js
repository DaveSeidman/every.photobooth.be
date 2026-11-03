import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import request from 'supertest';
import { WebSocket } from 'ws';
import { createApp } from '../app.js';
import { config, resolveAllowedOrigins } from '../config.js';
import { attachRealtimeServer } from '../realtime.js';

const domain='https://photobooth.lightboxlive.io';
test('legacy Render allowlist also accepts the canonical domain without losing configured origins', () => {
  assert.deepEqual(resolveAllowedOrigins(' https://daveseidman.github.io, http://localhost:8080 '),['https://daveseidman.github.io','http://localhost:8080',domain]);
  assert.deepEqual(resolveAllowedOrigins(''),[]);
  assert.equal(resolveAllowedOrigins(`${domain},${domain}`).length,1);
});
test('custom domain gets CORS headers on config, submit errors and preflight while other origins remain denied', async (t) => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'booth-cors-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const app=createApp({config:{...config,allowedOrigins:resolveAllowedOrigins('https://daveseidman.github.io'),falKey:'',print:{prepareStrips:false,autoSubmit:false},directories:{uploads:path.join(directory,'uploads'),photos:path.join(directory,'photos')}}});
  const response=await request(app).get('/config').set('Origin',domain).expect(200);
  assert.equal(response.headers['access-control-allow-origin'],domain);
  assert.match(response.headers.vary,/Origin/);
  const preflight=await request(app).options('/submit').set('Origin',domain).set('Access-Control-Request-Method','POST').set('Access-Control-Request-Headers','content-type').expect(204);
  assert.equal(preflight.headers['access-control-allow-origin'],domain);
  assert.match(preflight.headers['access-control-allow-methods'],/POST/);
  const missingPhoto=await request(app).post('/submit').set('Origin',domain).expect(400);
  assert.equal(missingPhoto.headers['access-control-allow-origin'],domain);
  const denied=await request(app).get('/config').set('Origin','https://unrelated.example').expect(403);
  assert.equal(denied.headers['access-control-allow-origin'],undefined);
});
test('WebSocket handshake accepts the new domain with the legacy allowlist configuration', async (t) => {
  const server=createServer();
  const wsServer=attachRealtimeServer(server,{allowedOrigins:resolveAllowedOrigins('https://daveseidman.github.io')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const socket=new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`,{origin:domain});
  t.after(async()=>{
    socket.terminate();
    await new Promise(resolve=>wsServer.close(resolve));
    await new Promise(resolve=>server.close(resolve));
  });
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  assert.equal(socket.readyState,WebSocket.OPEN);
});
