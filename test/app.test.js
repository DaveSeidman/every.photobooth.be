import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../app.js";
import { config } from "../config.js";

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

test("public config exposes labels and prompts without secrets", async () => {
  const response = await request(app).get("/config").expect(200);
  assert.equal(response.body.labels.variantA, "Thesis Blue");
  assert.equal(response.body.labels.variantB, "Thesis Coral");
  assert.match(response.body.prompts.variantA, /screenprint/i);
  assert.match(response.body.prompts.variantB, /#FF7B70/);
  assert.equal(response.body.falKey, undefined);
});

test("submit requires a photo", async () => {
  const response = await request(app).post("/submit").expect(400);
  assert.equal(response.body.success, false);
});
