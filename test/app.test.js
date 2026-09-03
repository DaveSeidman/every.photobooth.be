import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { styleTransferPrompt } from "../modes.js";
import { saveRemoteImage } from "../utils/imageUtils.js";

let temporaryDirectory;
let app;

before(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "every-photobooth-"));
  app = createApp({
    config: {
      ...config,
      falKey: "",
      directories: {
        uploads: path.join(temporaryDirectory, "uploads"),
        photos: path.join(temporaryDirectory, "photos"),
      },
      labels: {
        styled: "Styled Portrait",
        original: "Source Portrait",
      },
    },
  });
});

after(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

test("health endpoint reports service readiness", async () => {
  const response = await request(app).get("/").expect(200);
  assert.equal(response.body.status, "ok");
  assert.equal(response.body.aiConfigured, false);
});

test("public config exposes labels and modes without secrets", async () => {
  const response = await request(app).get("/config").expect(200);
  assert.equal(response.body.labels.styled, "Styled Portrait");
  assert.deepEqual(response.body.modes.map((mode) => mode.id), ["every", "posthog"]);
  assert.deepEqual(response.body.everyStyles.map((style) => style.id), [
    "weights-measures",
    "digital-twins",
    "future-of-work",
    "black-white",
  ]);
  assert.equal(response.body.falKey, undefined);
});

test("submit requires a photo", async () => {
  const response = await request(app).post("/submit").expect(400);
  assert.equal(response.body.success, false);
});

test("only Every and PostHog modes are available", async () => {
  const modes = await request(app).get("/modes").expect(200);
  assert.deepEqual(modes.body.modes.map((mode) => mode.id), ["every", "posthog"]);
});

test("black and white accepts an explicit varied background color", () => {
  const prompt = styleTransferPrompt({
    mode: "every",
    styleId: "black-white",
    palette: "warm coral",
  });
  assert.match(prompt, /exactly this assigned color: warm coral/);
  assert.match(prompt, /dense stippling, directional hatching, crosshatching/);
  assert.match(prompt, /Do not add a border/);
});

test("PostHog mode creates one paper hedgehog per photographed person", () => {
  const prompt = styleTransferPrompt({ mode: "posthog" });
  assert.match(prompt, /exactly one hedgehog for each person/i);
  assert.match(prompt, /colored cardboard/i);
  assert.doesNotMatch(prompt, /Keep every original face unobstructed/i);
});

test("saved portraits include the original source as a top-left notch", async () => {
  const styled = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#245ca8" },
  }).jpeg().toBuffer();
  const source = await sharp({
    create: { width: 200, height: 160, channels: 3, background: "#d54a3c" },
  }).jpeg().toBuffer();
  const photoId = "notched-portrait";
  await saveRemoteImage({
    url: `data:image/jpeg;base64,${styled.toString("base64")}`,
    outputDirectory: temporaryDirectory,
    photoId,
    sourceBuffer: source,
  });

  const { data, info } = await sharp(path.join(temporaryDirectory, `${photoId}.jpg`))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3);
  const insetPixel = pixel(24, 24);
  const styledPixel = pixel(300, 200);
  assert.ok(insetPixel[0] > insetPixel[2], "the red source portrait should occupy the notch");
  assert.ok(styledPixel[2] > styledPixel[0], "the styled portrait should remain outside the notch");
});

test("submit supports a named Every style with one source image", async () => {
  const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  let receivedPrompt;
  const integrationApp = createApp({
    config: {
      ...config,
      falKey: "",
      directories: {
        uploads: path.join(temporaryDirectory, "integration-uploads"),
        photos: path.join(temporaryDirectory, "integration-photos"),
      },
    },
    editor: {
      async styleTransfer(_source, _filename, prompt) {
        receivedPrompt = prompt;
        return { styledUrl: `data:image/png;base64,${onePixelPng.toString("base64")}` };
      },
    },
  });

  const response = await request(integrationApp)
    .post("/submit")
    .field("mode", "every")
    .field("style", "weights-measures")
    .attach("photo", onePixelPng, "portrait.png")
    .expect(200);

  assert.match(receivedPrompt, /IMAGE 1 is the only source photograph/);
  assert.match(receivedPrompt, /LOCK THE SOURCE COMPOSITION/);
  assert.match(receivedPrompt, /rulers, measuring tapes, protractors/);
  assert.match(receivedPrompt, /Vitruvian circles/);
  assert.match(receivedPrompt, /Tiny indecipherable drafting annotations/);
  assert.doesNotMatch(receivedPrompt, /IMAGE 2/);
  assert.equal(response.body.output.mode, "every");
  assert.match(receivedPrompt, /EDGE-TO-EDGE ARTWORK/);
  assert.equal(response.body.output.styleProfile, "every-weights-measures-v3");
  assert.equal(response.body.output.styleLabel, "Weights & Measures");
  assert.equal(response.body.output.styled, response.body.output.variantA);
});
