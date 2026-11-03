import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { createActivityStore } from "../utils/activity.js";
import { createApp } from "../app.js";
import { config } from "../config.js";

test("counts exclude source/print copies, use local days and survive restart/deletion", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booth-activity-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "1792100000000-abc123.jpg");
  for (const suffix of ["", "-source", "-print"]) fs.writeFileSync(path.join(dir, `1792100000000-abc123${suffix}.jpg`), "image");
  fs.utimesSync(output, new Date("2026-10-16T03:30:00Z"), new Date("2026-10-16T03:30:00Z"));
  const options = { timezone: "America/New_York", now: () => new Date("2026-10-16T04:30:00Z") };
  const store = createActivityStore(dir, options);
  assert.deepEqual(store.snapshot().completed, { total: 1, today: 0 });
  store.start("new", "Digital Twins");
  assert.equal(store.snapshot().processing.length, 1);
  store.finish("new", "completed");
  store.start("failed", "Black & White");
  store.finish("failed", "failed");
  store.start("interrupted", "Future of Work");
  fs.unlinkSync(output);
  const restarted = createActivityStore(dir, options).snapshot();
  assert.deepEqual(restarted.completed, { total: 2, today: 1 });
  assert.deepEqual(restarted.failed, { total: 1, today: 1 });
  assert.equal(restarted.processing.length, 0);
  assert.equal(restarted.interrupted, 1);
});

test("status tracks in-flight generation and failure; printer is explicitly disabled", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booth-status-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let release, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const app = createApp({ config: { ...config, fallback: { ...config.fallback, enabled: false }, print: { ...config.print, prepareStrips: false, autoSubmit: false }, directories: { uploads: path.join(dir, "uploads"), photos: path.join(dir, "photos") } }, editor: {
    async styleTransfer() { entered(); await gate; throw new Error("Test generator unavailable"); },
  } });
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  const pending = request(app).post("/submit").field("style", "digital-twins").attach("photo", image, "photo.png").then((response) => response);
  await started;
  const active = await request(app).get("/api/status").expect(200);
  assert.equal(active.body.processing.length, 1);
  assert.equal(active.body.printer.enabled, false);
  assert.equal(active.body.printer.printing, null);
  assert.equal(active.body.falKey, undefined);
  release();
  assert.equal((await pending).status, 500);
  const failed = await request(app).get("/api/status").expect(200);
  assert.equal(failed.body.processing.length, 0);
  assert.equal(failed.body.failed.total, 1);
  await request(app).get("/").set("Accept", "text/html").expect("Content-Type", /html/).expect(200);
  const json = await request(app).get("/").expect(200);
  assert.equal(json.body.status, "ok");
});

test("completed counter resets persist without deleting photos or historical jobs", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booth-counter-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const photo = path.join(dir, "1792100000000-abc123.jpg");
  fs.writeFileSync(photo, "saved photo");
  const store = createActivityStore(dir);
  store.start("in-flight", "Digital Twins");
  const reset = store.resetCompletedTotal();
  assert.equal(reset.completed.total, 0);
  assert.ok(reset.completedResetAt);
  assert.ok(fs.existsSync(photo));
  assert.equal(reset.recent.length, 2);
  assert.equal(reset.processing.length, 1);
  store.finish("in-flight", "completed");
  assert.equal(store.snapshot().completed.total, 1);
  const restarted = createActivityStore(dir).snapshot();
  assert.equal(restarted.completed.total, 1);
  assert.equal(restarted.completedResetAt, reset.completedResetAt);
  assert.equal(restarted.recent.length, 2);
});

test("reset endpoint changes only the completed counter", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booth-reset-api-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const photos = path.join(dir, "photos"); fs.mkdirSync(photos);
  fs.writeFileSync(path.join(photos, "1792100000000-abc123.jpg"), "saved photo");
  const app = createApp({ config: { ...config, fallback: { ...config.fallback, enabled: false }, print: { prepareStrips: false, autoSubmit: false }, directories: { uploads: path.join(dir, "uploads"), photos } } });
  const before = await request(app).get("/api/status").expect(200);
  assert.equal(before.body.completed.total, 1);
  await request(app).post("/api/status/completed/reset").send({}).expect(400);
  const reset = await request(app).post("/api/status/completed/reset").send({ reset: true }).expect(200);
  assert.equal(reset.body.completed.total, 0);
  assert.equal(reset.body.recent.length, before.body.recent.length);
  assert.equal(reset.body.failed.total, before.body.failed.total);
  const after = await request(app).get("/api/status").expect(200);
  assert.equal(after.body.completed.total, 0);
});
