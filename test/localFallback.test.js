import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { createLocalPortrait } from "../utils/localFilters.js";
import { createGenerationFallback } from "../utils/generationFallback.js";

const original = await sharp({ create: { width: 120, height: 120, channels: 3, background: "#b58d65" } }).jpeg().toBuffer();
const aiImage = await sharp({ create: { width: 120, height: 120, channels: 3, background: "#2055a0" } }).jpeg().toBuffer();
const aiUrl = `data:image/jpeg;base64,${aiImage.toString("base64")}`;
async function setup(t, editor, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booth-local-fallback-"));
  let app, printCalls = 0;
  t.after(async () => { await app?.locals.strips.whenIdle(); await fs.rm(directory, { recursive: true, force: true }); });
  app = createApp({ config: { ...config, falKey: "", fallback: { enabled: true, normalDurationMs: options.normalMs || 17000 }, directories: { uploads: path.join(directory, "uploads"), photos: path.join(directory, "photos") }, print: { prepareStrips: true, autoSubmit: true, serverUrl: "http://print.test/print", conferenceDate: "2026-11-05", location: "in Brooklyn" } }, editor, uploadPrint: async () => { printCalls++; return { jobId: "mock-printer-job", dryRun: true }; } });
  return { app, directory, printCalls: () => printCalls };
}
const submit = (app) => request(app).post("/submit").field("mode", "every").field("style", "black-white").attach("photo", original, "original.jpg");

test("local filters keep the source dimensions and produce distinct valid portraits", async () => {
  const hashes = new Set();
  for (const id of ["black-white", "weights-measures", "digital-twins", "future-of-work"]) {
    const output = await createLocalPortrait(original, id);
    const meta = await sharp(output.buffer).metadata();
    assert.equal(output.generationMode, "local");
    assert.equal(meta.width, 120); assert.equal(meta.height, 120);
    hashes.add(output.buffer.toString("base64"));
  }
  assert.equal(hashes.size, 4);
});

test("provider failure immediately produces two local portraits and one printable sheet", async (t) => {
  const { app, directory, printCalls } = await setup(t, { async upload() { throw new Error("Fal unavailable"); }, async edit() { assert.fail("Edit should not start after upload failure"); } });
  const response = await submit(app).expect(200);
  const { photoId } = response.body.output;
  assert.equal(response.body.output.generationMode, "local");
  assert.equal(response.body.output.fallbackReason, "error");
  assert.match(response.body.output.styleLabel, /Classic/);
  await app.locals.strips.whenIdle();
  const job = app.locals.strips.get(photoId);
  assert.deepEqual(job.generationModes, { selected: "local", alternate: "local" });
  assert.equal(job.status, "dry-run");
  assert.equal(printCalls(), 1);
  assert.equal((await sharp(path.join(directory, "photos", `${photoId}-print.jpg`)).metadata()).width, 1200);
  const status = await request(app).get("/api/status");
  assert.equal(status.body.completed.total, 1); assert.equal(status.body.failed.total, 0);
});

test("missing AI credentials still produces a local result without calling a provider", async (t) => {
  const { app, printCalls } = await setup(t, undefined);
  const response = await submit(app).expect(200);
  assert.equal(response.body.output.generationMode, "local");
  await app.locals.strips.whenIdle();
  assert.equal(printCalls(), 1);
});

test("a successful AI portrait is retained when only the other treatment fails", async (t) => {
  const { app, printCalls } = await setup(t, { async upload() { return "https://source.test/photo"; }, async edit(_url, _prompt, { role }) { if (role === "selected") return aiUrl; throw new Error("Alternate failed"); } });
  const response = await submit(app).expect(200);
  assert.equal(response.body.output.generationMode, "ai");
  await app.locals.strips.whenIdle();
  assert.deepEqual(app.locals.strips.get(response.body.output.photoId).generationModes, { selected: "ai", alternate: "local" });
  assert.equal(printCalls(), 1);
});

test("stalled shared upload falls back at twice normal and never starts late edits", async (t) => {
  let release, edits = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const { app, printCalls } = await setup(t, { upload: () => pending, async edit() { edits++; return aiUrl; } }, { normalMs: 20 });
  try {
    const response = await submit(app).expect(200);
    assert.equal(response.body.output.fallbackReason, "timeout");
    await app.locals.strips.whenIdle();
    release("https://source.test/photo");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(edits, 0);
    assert.equal(printCalls(), 1);
  } finally { release("https://source.test/photo"); }
});

test("late AI output cannot replace local files or submit another print", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { app, directory, printCalls } = await setup(t, { async upload() { return "https://source.test/photo"; }, edit: () => pending }, { normalMs: 20 });
  try {
    const response = await submit(app).expect(200);
    const photo = path.join(directory, "photos", `${response.body.output.photoId}.jpg`);
    await app.locals.strips.whenIdle();
    const local = await fs.readFile(photo);
    release(aiUrl);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(await fs.readFile(photo), local);
    assert.equal(printCalls(), 1);
  } finally { release(aiUrl); }
});

test("the deadline is twice the measured median, with persisted learning and a bootstrap default", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "booth-latency-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let clock = 0;
  const guard = createGenerationFallback({ directory, now: () => clock });
  assert.equal(guard.policy().fallbackAfterMs, 34000);
  for (const duration of [3000, 5000, 7000]) await guard.run({ sourceBuffer: original, aiTask: async () => { clock += duration; return { buffer: aiImage }; } });
  assert.equal(guard.policy().normalDurationMs, 5000);
  assert.equal(guard.policy().fallbackAfterMs, 10000);
  assert.equal(createGenerationFallback({ directory }).policy().fallbackAfterMs, 10000);
});

for (const simulation of ["offline", "error", "timeout"]) {
  test(`F1 ${simulation} simulation falls back in both slots without provider calls`, async (t) => {
    const { app, printCalls } = await setup(t, {
      upload() { assert.fail("Simulation must not upload to Fal"); },
      edit() { assert.fail("Simulation must not call the model"); },
    }, { normalMs: 20 });
    const response = await request(app).post("/submit").field("mode", "every").field("style", "black-white").field("failureSimulation", simulation).attach("photo", original, "original.jpg").expect(200);
    assert.equal(response.body.output.generationMode, "local");
    assert.equal(response.body.output.fallbackReason, simulation === "timeout" ? "timeout" : "error");
    await app.locals.strips.whenIdle();
    assert.deepEqual(app.locals.strips.get(response.body.output.photoId).generationModes, { selected: "local", alternate: "local" });
    assert.equal(printCalls(), 1);
  });
}
