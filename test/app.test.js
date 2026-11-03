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
      ...config, fallback: { ...config.fallback, enabled: false }, print: { ...config.print, prepareStrips: false, autoSubmit: false },
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
    "emperor-cyan",
    "emperor-ink",
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

test("both emperor prompts preserve the group and cyan has the supplied temple direction", () => {
  for (const styleId of ["emperor-cyan", "emperor-ink"]) {
    const prompt = styleTransferPrompt({ mode: "every", styleId });
    assert.match(prompt, /distinct Greco-Roman emperor/);
    assert.match(prompt, /Do not add, remove, duplicate, merge, or obscure anyone/);
    assert.match(prompt, /sculptural marble body/);
    assert.match(prompt, /Do not add a border/);
    assert.doesNotMatch(prompt, /rulers, measuring tapes|android twin|headsets/);
  }
  assert.match(styleTransferPrompt({ mode: "every", styleId: "emperor-cyan" }), /classical temple in vivid cyan/);
});

test("PostHog mode creates one paper hedgehog per photographed person", () => {
  const prompt = styleTransferPrompt({ mode: "posthog" });
  assert.match(prompt, /exactly one hedgehog for each person/i);
  assert.match(prompt, /colored cardboard/i);
  assert.doesNotMatch(prompt, /Keep every original face unobstructed/i);
});

test("saved portraits keep the generated image free of a source-photo inset", async () => {
  const styled = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#245ca8" },
  }).jpeg().toBuffer();
  const photoId = "clean-portrait";
  await saveRemoteImage({
    url: `data:image/jpeg;base64,${styled.toString("base64")}`,
    outputDirectory: temporaryDirectory,
    photoId,
  });

  const { data, info } = await sharp(path.join(temporaryDirectory, `${photoId}.jpg`))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3);
  const topLeftPixel = pixel(24, 24);
  const styledPixel = pixel(300, 200);
  assert.ok(topLeftPixel[2] > topLeftPixel[0], "the generated portrait should remain clean at top left");
  assert.ok(styledPixel[2] > styledPixel[0], "the styled portrait should remain outside the notch");
});

test("submit supports a named Every style with one source image", async () => {
  const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  let receivedPrompt;
  const integrationApp = createApp({
    config: {
      ...config, fallback: { ...config.fallback, enabled: false }, print: { ...config.print, prepareStrips: false, autoSubmit: false },
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
    .field("style", "emperor-cyan")
    .attach("photo", onePixelPng, "portrait.png")
    .expect(200);

  assert.match(receivedPrompt, /IMAGE 1 is the only source photograph/);
  assert.match(receivedPrompt, /distinct Greco-Roman emperor/);
  assert.match(receivedPrompt, /classical temple in vivid cyan/);
  assert.doesNotMatch(receivedPrompt, /IMAGE 2/);
  assert.equal(response.body.output.mode, "every");
  assert.match(receivedPrompt, /EDGE-TO-EDGE ARTWORK/);
  assert.equal(response.body.output.styleProfile, "every-emperor-cyan-v3");
  assert.equal(response.body.output.styleLabel, "Imperial Cyan");
  assert.equal(response.body.output.styled, response.body.output.variantA);
  const activity = await request(integrationApp).get("/api/status").expect(200);
  assert.equal(activity.body.completed.total, 1);
  assert.equal(activity.body.completed.today, 1);
  assert.equal(activity.body.processing.length, 0);
});

test("submit uses a supplied prompt override verbatim", async () => {
  const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  let receivedPrompt;
  const integrationApp = createApp({
    config: {
      ...config, fallback: { ...config.fallback, enabled: false }, print: { ...config.print, prepareStrips: false, autoSubmit: false },
      falKey: "",
      directories: {
        uploads: path.join(temporaryDirectory, "override-uploads"),
        photos: path.join(temporaryDirectory, "override-photos"),
      },
    },
    editor: {
      async styleTransfer(_source, _filename, prompt) {
        receivedPrompt = prompt;
        return { styledUrl: `data:image/png;base64,${onePixelPng.toString("base64")}` };
      },
    },
  });

  await request(integrationApp)
    .post("/submit")
    .field("mode", "every")
    .field("style", "emperor-cyan")
    .field("promptOverride", "  Render this custom treatment.  ")
    .attach("photo", onePixelPng, "portrait.png")
    .expect(200);

  assert.equal(receivedPrompt, "Render this custom treatment.");
});
