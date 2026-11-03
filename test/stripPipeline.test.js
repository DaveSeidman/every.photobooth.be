import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import request from "supertest";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { conferenceDateLabel } from "../utils/stripLayout.js";
import { styleTransferSpec } from "../modes.js";

const image = async (color) => sharp({ create: { width: 100, height: 100, channels: 3, background: color } }).png().toBuffer();
const original = await image("green"), selected = await image("red"), alternate = await image("blue");
const dataUrl = (buffer) => `data:image/png;base64,${buffer.toString("base64")}`;
async function setup(t, editor, print = {}, uploadPrint) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "every-classic-strip-"));
  let app;
  t.after(async () => { await app?.locals.strips.whenIdle(); await fs.rm(directory, { recursive: true, force: true }); });
  app = createApp({ config: { ...config, fallback: { ...config.fallback, enabled: false }, print: { prepareStrips: true, ...print }, falKey: "", directories: { uploads: path.join(directory, "uploads"), photos: path.join(directory, "photos") } }, editor, uploadPrint });
  return { app, directory };
}
const submit = (app) => request(app).post("/submit").field("mode", "every").field("style", "black-white").attach("photo", original, "original.png");

test("both edits start after one upload, selected response does not wait for alternate, and sheet waits for both", async (t) => {
  let release, releaseSelected, bothStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const selectedGate = new Promise((resolve) => { releaseSelected = resolve; });
  const started = new Promise((resolve) => { bothStarted = resolve; });
  let primaryCalls = 0, extraCalls = 0, sourceUploads = 0, extraPrompt, uploads = 0;
  const { app, directory } = await setup(t, {
    async upload() { sourceUploads++; return "https://example.test/original"; },
    async edit(sourceUrl, prompt, context) {
      assert.equal(sourceUrl, "https://example.test/original");
      if (context.role === "selected") { primaryCalls++; await selectedGate; return dataUrl(selected); }
      extraCalls++; extraPrompt = prompt; bothStarted(); await gate; return dataUrl(alternate);
    },
  }, { autoSubmit: true, serverUrl: "http://print.test/print" }, async () => { uploads++; });
  const pending = submit(app).expect(200).then((response) => response);
  try {
    await Promise.race([started, new Promise((_, reject) => { const timeout = setTimeout(() => reject(new Error("Edits did not start concurrently")), 1000); timeout.unref(); })]);
    assert.equal(primaryCalls, 1);
    assert.equal(extraCalls, 1);
    assert.equal(sourceUploads, 1);
    assert.equal(uploads, 0);
  } catch (error) { release(); throw error; } finally { releaseSelected(); }
  const response = await pending;
  const id = response.body.output.photoId;
  try {
    assert.equal(response.body.output.printStatus, "preparing-strip");
    const pending = await request(app).get(`/photos/${id}/strip`).expect(200);
    assert.equal(pending.body.status, "generating");
    assert.notEqual(styleTransferSpec({ mode: "every", styleId: pending.body.alternateStyle.id }).id, response.body.output.styleProfile);
    assert.match(extraPrompt, /IMAGE 1 is the only source photograph/);
  } finally { release(); }
  await app.locals.strips.whenIdle();
  const job = await request(app).get(`/photos/${id}/strip`).expect(200);
  assert.equal(job.body.status, "awaiting-date");
  assert.equal(primaryCalls, 1);
  assert.equal(extraCalls, 1);
  assert.equal(uploads, 0);
  const sheet = path.join(directory, "photos", `${id}-print.jpg`);
  const metadata = await sharp(sheet).metadata();
  assert.equal(metadata.width, 1200); assert.equal(metadata.height, 1800); assert.equal(metadata.density, 300);
  const pixels = await sharp(sheet).raw().toBuffer();
  const pixel = (x, y) => [...pixels.subarray((y * 1200 + x) * 3, (y * 1200 + x) * 3 + 3)];
  assert.ok(pixel(300, 250)[1] > 90); // original green
  assert.ok(pixel(300, 750)[0] > 230); // selected red
  assert.ok(pixel(300, 1250)[2] > 230); // alternate blue
  assert.deepEqual(pixel(300, 1250), pixel(900, 1250));
  const activity = await request(app).get("/api/status");
  assert.equal(activity.body.completed.total, 1);
});

test("a second-style failure preserves the selected portrait and records strip failure", async (t) => {
  const { app } = await setup(t, {
    async upload() { return "https://example.test/original"; },
    async edit(_source, _prompt, context) {
      if (context.role === "selected") return dataUrl(selected);
      throw new Error("Second treatment unavailable");
    },
  });
  const response = await submit(app).expect(200);
  await app.locals.strips.whenIdle();
  const job = await request(app).get(`/photos/${response.body.output.photoId}/strip`).expect(200);
  assert.equal(job.body.status, "failed");
  await request(app).get(response.body.output.photo).expect(200);
  const activity = await request(app).get("/api/status");
  assert.equal(activity.body.completed.total, 1);
  assert.equal(activity.body.failed.total, 0);
});

test("automatic submission requires a confirmed date and uses a stable print job key", async (t) => {
  let uploads = 0;
  const { app } = await setup(t, {
    async upload() { return "https://example.test/original"; },
    async edit(_source, _prompt, context) { return dataUrl(context.role === "selected" ? selected : alternate); },
  }, { autoSubmit: true, serverUrl: "http://print.test/print", conferenceDate: "2027-01-15" }, async (_file, url, options) => {
    uploads++; assert.equal(url, "http://print.test/print"); assert.match(options.jobKey, /^strip-\d{13}-[a-f0-9]{6}$/);
    return { jobId: "print-123", dryRun: true };
  });
  const response = await submit(app).expect(200);
  const id = response.body.output.photoId;
  await app.locals.strips.whenIdle();
  const job = await request(app).get(`/photos/${id}/strip`).expect(200);
  assert.equal(job.body.status, "dry-run");
  assert.equal(uploads, 1);
  await request(app).post(`/photos/${id}/strip/rebuild`).expect(409);
  assert.equal(uploads, 1);
});

test("conference date rejects invalid calendar dates and formats dates without timezone drift", () => {
  assert.equal(conferenceDateLabel("2027-01-15"), "January 15, 2027");
  assert.equal(conferenceDateLabel(""), "DATE TO BE CONFIRMED");
  assert.throws(() => conferenceDateLabel("2027-02-30"));
  assert.throws(() => conferenceDateLabel("tomorrow"));
});


test("model input is 512 pixels while the source saved for printing retains camera resolution", async (t) => {
  const fullResolution = await sharp({ create: { width: 1600, height: 1600, channels: 3, background: "green" } }).jpeg().toBuffer();
  let inputWidth;
  const { app, directory } = await setup(t, {
    async upload(buffer) { inputWidth = (await sharp(buffer).metadata()).width; return "https://example.test/original"; },
    async edit(_source, _prompt, context) { return dataUrl(context.role === "selected" ? selected : alternate); },
  });
  const response = await request(app).post("/submit").field("mode", "every").field("style", "black-white").attach("photo", fullResolution, "original.jpg").expect(200);
  await app.locals.strips.whenIdle();
  assert.equal(inputWidth, 512);
  const metadata = await sharp(path.join(directory, "photos", `${response.body.output.photoId}-source.jpg`)).metadata();
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 1600);
});

test("selected-generation failure prevents sheet submission even if alternate succeeds", async (t) => {
  let uploads = 0;
  const { app } = await setup(t, {
    async upload() { return "https://example.test/original"; },
    async edit(_source, _prompt, context) {
      if (context.role === "selected") throw new Error("Selected generation failed");
      return dataUrl(alternate);
    },
  }, { autoSubmit: true, serverUrl: "http://print.test/print", conferenceDate: "2026-11-05" }, async () => { uploads++; });
  await submit(app).expect(500);
  await app.locals.strips.whenIdle();
  assert.equal(uploads, 0);
  assert.equal(app.locals.strips.snapshot().recent[0].status, "failed");
});
