import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStripPipeline } from "../utils/stripPipeline.js";

test("backend backfills completed print jobs from the local server without printing again", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strip-completion-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, ".print-jobs"));
  const job = { photoId: "1793644763586-4d9ada", printJobId: "remote-job", status: "print-queued", selectedStyle: { id: "selected" }, alternateStyle: { id: "alternate" }, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(directory, ".print-jobs", `${job.photoId}.json`), JSON.stringify(job));
  const pipeline = createStripPipeline({ directory, editor: {}, settings: { serverUrl: "http://print.test/print", token: "secret" }, uploadPrint: () => assert.fail("Must not print again"), fetchPrintStatus: async (url, options) => {
    assert.equal(url.toString(), "http://print.test/jobs/remote-job");
    assert.equal(options.headers.Authorization, "Bearer secret");
    return { ok: true, json: async () => ({ status: "printed", completedAt: "2026-11-02T19:00:00.000Z" }) };
  } });
  await pipeline.refreshPrintStatuses();
  assert.equal(pipeline.get(job.photoId).status, "printed");
  assert.equal(pipeline.get(job.photoId).printedAt, "2026-11-02T19:00:00.000Z");
  const saved = JSON.parse(fs.readFileSync(path.join(directory, ".print-jobs", `${job.photoId}.json`)));
  assert.equal(saved.status, "printed");
  await assert.rejects(pipeline.rebuild(job.photoId), /already been submitted/);
});
