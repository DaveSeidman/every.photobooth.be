import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { publicEveryStyles, styleTransferSpec } from "../modes.js";
import { fetchBuffer } from "./imageUtils.js";
import { createClassicStrip, conferenceDateLabel } from "./stripLayout.js";
import { sendToPrintServer } from "./printUtils.js";
import { logEvent } from "./logger.js";

export function createStripPipeline({ directory, editor, generation, settings = {}, uploadPrint = sendToPrintServer, fetchPrintStatus = fetch }) {
  if (settings.conferenceDate) conferenceDateLabel(settings.conferenceDate);
  const metadataDirectory = path.join(directory, ".print-jobs");
  fs.mkdirSync(metadataDirectory, { recursive: true });
  const jobs = new Map();
  const tasks = new Map();
  let refreshingPrints;
  function save(job, status, extra = {}) {
    Object.assign(job, extra, { status, updatedAt: new Date().toISOString() });
    const file = path.join(metadataDirectory, `${job.photoId}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(job, null, 2));
    fs.renameSync(`${file}.tmp`, file);
    jobs.set(job.photoId, job);
    logEvent(`strip.${status}`, { photoId: job.photoId, selectedStyle: job.selectedStyle.id, alternateStyle: job.alternateStyle.id, error: job.error });
    return job;
  }
  for (const filename of fs.readdirSync(metadataDirectory).filter((name) => name.endsWith(".json"))) {
    const job = JSON.parse(fs.readFileSync(path.join(metadataDirectory, filename), "utf8"));
    jobs.set(job.photoId, job);
    if (["queued", "generating", "rendering", "submitting"].includes(job.status)) save(job, "interrupted", { error: "Backend restarted during strip preparation. Review before retrying." });
  }
  const filename = (id, suffix = "") => path.join(directory, `${id}${suffix}.jpg`);

  async function render(job) {
    save(job, "rendering", { error: null });
    const output = await createClassicStrip({
      originalPath: filename(job.photoId, "-source"), selectedPath: filename(job.photoId), alternatePath: filename(job.photoId, "-alternate"),
      outputDirectory: directory, photoId: job.photoId, selectedLabel: job.selectedStyle.label, alternateLabel: job.alternateStyle.label,
      date: settings.conferenceDate || "", location: settings.location || "in Brooklyn",
    });
    save(job, output.dateConfirmed ? "ready" : "awaiting-date", {
      sheetUrl: `/photos/${job.photoId}-print.jpg`, stripUrl: `/photos/${job.photoId}-strip.png`,
      alternateUrl: `/photos/${job.photoId}-alternate.jpg`, date: settings.conferenceDate || "", location: settings.location || "in Brooklyn",
    });
    if (settings.autoSubmit && settings.serverUrl && output.dateConfirmed) {
      save(job, "submitting");
      const remote = await uploadPrint(output.sheetPath, settings.serverUrl, { token: settings.token, jobKey: `strip-${job.photoId}` });
      save(job, remote.dryRun ? "dry-run" : "print-queued", { printJobId: remote.jobId });
    }
    return job;
  }
  function track(id, work) {
    const task = Promise.resolve().then(work).catch((error) => {
      const job = jobs.get(id);
      save(job, "failed", { error: error.message });
    }).finally(() => tasks.delete(id));
    tasks.set(id, task);
    return task;
  }
  return {
    start({ photoId, selectedStyle, sourceBuffer, sourceFilename, sourceUrl, sourceUrlPromise, primaryReady = Promise.resolve(), originalBuffer = sourceBuffer, startedAt = performance.now(), deadlineMs, aiAvailable = true, failureSimulation = "none" }) {
      if (jobs.has(photoId)) return jobs.get(photoId);
      const alternatives = publicEveryStyles().filter((candidate) => `every-${candidate.id}-v3` !== selectedStyle.id);
      const alternate = alternatives[randomInt(alternatives.length)];
      const alternateSpec = styleTransferSpec({ mode: "every", styleId: alternate.id });
      const job = save({ photoId, selectedStyle: { id: selectedStyle.id, label: selectedStyle.label }, alternateStyle: { id: alternate.id, label: alternate.label }, createdAt: new Date().toISOString() }, "queued");
      track(photoId, async () => {
        save(job, "generating");
        // Run alongside the chosen treatment, then wait for both saved files.
        const started = performance.now();
        const alternateReady = (async () => {
          const generateAI = async (signal) => {
            if (!aiAvailable) throw new Error("AI service is not configured.");
            const uploadedSource = sourceUrlPromise ? await sourceUrlPromise : sourceUrl;
            signal?.throwIfAborted();
            const styledUrl = uploadedSource && editor.edit
              ? await editor.edit(uploadedSource, alternateSpec.prompt, { photoId, role: "alternate", signal })
              : (await editor.styleTransfer(sourceBuffer, sourceFilename, alternateSpec.prompt)).styledUrl;
            const buffer = await fetchBuffer(styledUrl, signal);
            return { buffer: await sharp(buffer).rotate().jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toBuffer(), label: alternate.label, generationMode: "ai" };
          };
          const generated = generation
            ? await generation.run({ photoId, role: "alternate", styleId: alternate.id, sourceBuffer: originalBuffer, aiTask: generateAI, startedAt, deadlineMs, failureSimulation })
            : await generateAI();
          logEvent("strip.alternate-returned", { photoId, generationMode: generated.generationMode, durationMs: Math.round(performance.now() - started) });
          await fs.promises.writeFile(filename(photoId, "-alternate"), generated.buffer);
          return generated;
        })();
        const outcomes = await Promise.allSettled([alternateReady, primaryReady]);
        const failure = outcomes.find((outcome) => outcome.status === "rejected");
        if (failure) throw failure.reason;
        const [alternateResult, selectedResult] = outcomes.map((outcome) => outcome.value);
        save(job, "rendering", {
          selectedStyle: { ...job.selectedStyle, label: selectedResult?.label || job.selectedStyle.label },
          alternateStyle: { ...job.alternateStyle, label: alternateResult.label || job.alternateStyle.label },
          generationModes: { selected: selectedResult?.generationMode || "ai", alternate: alternateResult.generationMode },
          fallbackReasons: { selected: selectedResult?.fallbackReason, alternate: alternateResult.fallbackReason },
        });
        await render(job);
      });
      return job;
    },
    async refreshPrintStatuses() {
      if (!settings.serverUrl) return;
      if (refreshingPrints) return refreshingPrints;
      refreshingPrints = Promise.all([...jobs.values()].filter((job) => job.printJobId && ["print-queued", "printing", "print-held", "print-stopped"].includes(job.status)).map(async (job) => {
        try {
          const url = new URL(settings.serverUrl);
          url.pathname = `${url.pathname.replace(/\/print\/?$/, "")}/jobs/${encodeURIComponent(job.printJobId)}`;
          url.search = ""; url.hash = "";
          const response = await fetchPrintStatus(url, { headers: settings.token ? { Authorization: `Bearer ${settings.token}` } : {}, signal: AbortSignal.timeout(4500) });
          if (!response.ok) throw new Error(`Print status unavailable (${response.status}).`);
          const remote = await response.json();
          if (remote.trackingError) throw new Error(remote.trackingError);
          const status = { queued: "print-queued", submitting: "print-queued", submitted: "print-queued", printing: "printing", held: "print-held", stopped: "print-stopped", printed: "printed", cancelled: "print-cancelled", failed: "print-failed", interrupted: "print-interrupted", "dry-run": "dry-run" }[remote.status];
          if (!status) throw new Error(`Unknown print status: ${remote.status}`);
          if (status !== job.status || job.printTrackingError) save(job, status, { printTrackingError: null, printedAt: remote.completedAt, error: remote.error || null });
        } catch (error) {
          if (job.printTrackingError !== error.message) save(job, job.status, { printTrackingError: error.message });
        }
      })).finally(() => { refreshingPrints = null; });
      return refreshingPrints;
    },
    get: (id) => jobs.get(id),
    async rebuild(id) {
      const job = jobs.get(id);
      if (!job) throw Object.assign(new Error("Strip job not found."), { status: 404 });
      if (tasks.has(id)) throw Object.assign(new Error("Strip preparation is already in progress."), { status: 409 });
      if (["print-queued", "printing", "print-held", "print-stopped", "printed", "dry-run"].includes(job.status)) throw Object.assign(new Error("This strip has already been submitted. Use the print server's explicit reprint endpoint."), { status: 409 });
      if (!fs.existsSync(filename(id, "-alternate"))) throw Object.assign(new Error("No second portrait is available. Rebuild does not start another paid generation."), { status: 409 });
      return track(id, () => render(job));
    },
    whenIdle: () => Promise.all([...tasks.values()]),
    snapshot: () => ({ preparing: [...tasks.keys()], recent: [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12) }),
  };
}
