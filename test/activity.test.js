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
  const app = createApp({ config: { ...config, directories: { uploads: path.join(dir, "uploads"), photos: path.join(dir, "photos") } }, editor: {
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
