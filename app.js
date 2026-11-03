import sharp from "sharp";
import { createGenerationFallback } from "./utils/generationFallback.js";
import { createStripPipeline } from "./utils/stripPipeline.js";
import { logEvent } from "./utils/logger.js";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import multer from "multer";
import { config, publicConfig } from "./config.js";
import { ensureDirectories, createUploadMiddleware } from "./utils/fileUtils.js";
import { createFalEditor } from "./utils/falUtils.js";
import { resizeForModel, fetchBuffer, saveSourceImage } from "./utils/imageUtils.js";
import { normalizeMode, publicEveryStyles, publicModes, styleTransferSpec } from "./modes.js";
import { createActivityStore } from "./utils/activity.js";

export function createApp(overrides = {}) {
  const runtimeConfig = overrides.config || config;
  const editor = overrides.editor || createFalEditor({
    credentials: runtimeConfig.falKey,
    model: runtimeConfig.falModel,
    resolution: runtimeConfig.falResolution,
    thinkingLevel: runtimeConfig.falThinkingLevel,
    timeoutMs: Math.max(runtimeConfig.falTimeoutMs, (runtimeConfig.fallback?.normalDurationMs || 17000) * 2 + 5000),
  });
  const app = express();

  ensureDirectories([runtimeConfig.directories.uploads, runtimeConfig.directories.photos]);
  const generation = createGenerationFallback({ directory: runtimeConfig.directories.photos, settings: runtimeConfig.fallback });
  const activity = createActivityStore(runtimeConfig.directories.photos, { timezone: runtimeConfig.statusTimezone });
  const strips = createStripPipeline({ directory: runtimeConfig.directories.photos, editor, generation, settings: runtimeConfig.print, uploadPrint: overrides.uploadPrint });
  app.locals.strips = strips;
  const pathForPhoto = (id) => path.join(runtimeConfig.directories.photos, `${id}.jpg`);
  const startedAt = Date.now();
  const statusPage = (_request, response) => response.type("html").send(fs.readFileSync(new URL("./utils/status-page.html", import.meta.url), "utf8"));
  const upload = createUploadMiddleware(runtimeConfig.directories.uploads, runtimeConfig.uploadMaxBytes);

  app.use((request, response, next) => {
    const requestId = crypto.randomUUID();
    request.requestId = requestId;
    response.setHeader("X-Request-Id", requestId);
    const started = performance.now();
    const details = { requestId, method: request.method, path: request.path };
    logEvent("http.started", { ...details, contentType: request.get("content-type"), contentLength: request.get("content-length") });
    response.on("finish", () => logEvent("http.completed", { ...details, status: response.statusCode, durationMs: Math.round(performance.now() - started) }));
    response.on("close", () => {
      if (!response.writableFinished) logEvent("http.disconnected", { ...details, durationMs: Math.round(performance.now() - started) }, "warn");
    });
    next();
  });
  app.use(cors({
    exposedHeaders: ["X-Request-Id"],
    origin(origin, callback) {
      if (!origin || runtimeConfig.allowedOrigins.length === 0 || runtimeConfig.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("This frontend origin is not allowed."));
    },
  }));
  app.use(express.json());
  app.use("/uploads", express.static(runtimeConfig.directories.uploads));
  app.use("/photos", express.static(runtimeConfig.directories.photos));

  app.get("/", (request, response) => request.get("accept")?.includes("text/html") ? statusPage(request, response) : response.json({
    status: "ok",
    service: "every-photobooth-backend",
    aiConfigured: Boolean(runtimeConfig.falKey),
  }));
  app.get("/status", statusPage);
  app.get("/api/status", async (_request, response) => {
    await strips.refreshPrintStatuses();
    response.set("Cache-Control", "no-store").json({
    ...activity.snapshot(),
    status: "ok",
    aiConfigured: Boolean(runtimeConfig.falKey),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    generation: generation.policy(),
    strips: strips.snapshot(),
    printer: { enabled: Boolean(runtimeConfig.print?.autoSubmit && runtimeConfig.print?.serverUrl && runtimeConfig.print?.conferenceDate), queued: null, printing: null,
      message: runtimeConfig.print?.autoSubmit && runtimeConfig.print?.serverUrl && runtimeConfig.print?.conferenceDate
        ? "Automatic strip submission is configured. Physical printer status is available on the local print server."
        : "Automatic printing is disabled. Prepared strips remain available for preview; configure the date and print server before enabling automatic submission." },
    });
  });
  app.post("/api/status/completed/reset", (request, response) => {
    if (!request.is("application/json") || request.body?.reset !== true) return response.status(400).json({ message: "Send { reset: true } as JSON to reset the completed total." });
    const previous = activity.snapshot().completed.total;
    const snapshot = activity.resetCompletedTotal();
    logEvent("activity.completed-reset", { previous, total: snapshot.completed.total, resetAt: snapshot.completedResetAt });
    response.set("Cache-Control", "no-store").json(snapshot);
  });
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/config", (_request, response) => response.json({
    ...publicConfig(runtimeConfig),
    generation: generation.policy(),
    modes: publicModes(),
    everyStyles: publicEveryStyles(),
  }));
  app.get("/modes", (_request, response) => response.json({ modes: publicModes() }));

  const validPhotoId = (request, response, next) => {
    if (!/^\d{13}-[a-f0-9]{6}$/.test(request.params.photoId)) return response.status(400).json({ message: "Invalid photo ID." });
    next();
  };
  app.get("/photos/:photoId/strip", validPhotoId, async (request, response) => {
    await strips.refreshPrintStatuses();
    const job = strips.get(request.params.photoId);
    if (!job) return response.status(404).json({ message: "No strip preparation job for this portrait." });
    response.set("Cache-Control", "no-store").json(job);
  });
  app.post("/photos/:photoId/strip/rebuild", validPhotoId, async (request, response, next) => {
    try { await strips.rebuild(request.params.photoId); response.json(strips.get(request.params.photoId)); } catch (error) { next(error); }
  });

  app.post("/submit", upload.single("photo"), async (request, response, next) => {
    let activePhotoId;
    try {
      if (!request.file) {
        response.status(400).json({ success: false, message: "A photo file is required." });
        return;
      }
      if (!runtimeConfig.falKey && !overrides.editor && runtimeConfig.fallback?.enabled === false) {
        response.status(503).json({ success: false, message: "The image service is not configured." });
        return;
      }

      const photoId = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
      const mode = normalizeMode(request.body.mode);
      const style = styleTransferSpec({ mode, styleId: request.body.style });
      const promptOverride = typeof request.body.promptOverride === "string"
        ? request.body.promptOverride.trim()
        : "";
      if (promptOverride.length > 20_000) {
        response.status(400).json({ success: false, message: "Prompt override is too long." });
        return;
      }
      logEvent("generation.started", { requestId: request.requestId, photoId, mode, style: style.id, customPrompt: Boolean(promptOverride), uploadBytes: request.file.size });
      activity.start(photoId, style.label);
      activePhotoId = photoId;
      const modelBuffer = await resizeForModel(request.file.path, runtimeConfig.falInputWidth || 512);
      logEvent("generation.source-prepared", { requestId: request.requestId, photoId, bytes: modelBuffer.length, inputWidth: runtimeConfig.falInputWidth || 512 });
      const inferenceStarted = performance.now();
      const deadlineMs = generation.policy().fallbackAfterMs;
      const originalBuffer = fs.readFileSync(request.file.path);
      const failureSimulation = ["offline", "error", "timeout"].includes(request.body.failureSimulation) ? request.body.failureSimulation : "none";
      if (failureSimulation !== "none") logEvent("generation.simulation", { photoId, failureSimulation }, "warn");
      const aiAvailable = Boolean(runtimeConfig.falKey || overrides.editor);
      const prepareStrip = mode === "every" && runtimeConfig.print?.prepareStrips;
      // Share one original upload; both edits subscribe as soon as it is ready.
      const sourceUrlPromise = failureSimulation === "none" && aiAvailable && editor.upload && editor.edit
        ? Promise.resolve().then(() => editor.upload(modelBuffer, request.file.filename))
        : null;
      const primaryReady = (async () => {
        const generated = await generation.run({ photoId, role: "selected", styleId: style.id, sourceBuffer: originalBuffer, startedAt: inferenceStarted, deadlineMs, failureSimulation,
          aiTask: async (signal) => {
            if (!aiAvailable) throw new Error("AI service is not configured.");
            let output;
            if (sourceUrlPromise) {
              const sourceUrl = await sourceUrlPromise;
              signal.throwIfAborted();
              output = { styledUrl: await editor.edit(sourceUrl, promptOverride || style.prompt, { photoId, role: "selected", signal }) };
            } else output = await editor.styleTransfer(modelBuffer, request.file.filename, promptOverride || style.prompt);
            const image = await fetchBuffer(output.styledUrl, signal);
            return { ...output, buffer: await sharp(image).rotate().jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toBuffer(), label: promptOverride ? "Custom portrait" : style.label, styleProfile: style.id };
          },
        });
        logEvent("generation.portrait-ready", { requestId: request.requestId, photoId, generationMode: generated.generationMode, durationMs: Math.round(performance.now() - inferenceStarted) });
        await Promise.all([
          fs.promises.writeFile(pathForPhoto(photoId), generated.buffer),
          saveSourceImage({ sourceBuffer: originalBuffer, outputDirectory: runtimeConfig.directories.photos, photoId }),
        ]);
        return generated;
      })();
      if (prepareStrip) {
        try {
          strips.start({ photoId, selectedStyle: { ...style, label: promptOverride ? "Custom portrait" : style.label }, sourceBuffer: modelBuffer, sourceFilename: request.file.filename, originalBuffer, sourceUrlPromise, primaryReady, startedAt: inferenceStarted, deadlineMs, aiAvailable, failureSimulation });
        } catch (error) { logEvent("strip.start-failed", { photoId, message: error.message }, "error"); }
      }
      const generated = await primaryReady;
      const styledUrl = generated.styledUrl || `/photos/${photoId}.jpg`;
      logEvent("generation.saved", { requestId: request.requestId, photoId });
      activity.finish(photoId, "completed", { generationMode: generated.generationMode, style: generated.label || style.label });
      activePhotoId = null;
      response.json({
        success: true,
        input: `/uploads/${request.file.filename}`,
        output: {
          styled: styledUrl,
          // Temporary aliases keep older deployed frontends compatible.
          variantA: styledUrl,
          variantB: styledUrl,
          past: styledUrl,
          future: styledUrl,
          photoId,
          photo: `/photos/${photoId}.jpg`,
          sourcePhoto: `/photos/${photoId}-source.jpg`,
          animation: null,
          printStatus: prepareStrip ? "preparing-strip" : "disabled",
          stripStatusUrl: prepareStrip ? `/photos/${photoId}/strip` : null,
          mode,
          styleProfile: generated.styleProfile || style.id,
          styleLabel: generated.label || style.label,
          generationMode: generated.generationMode,
          fallbackReason: generated.fallbackReason,
        },
      });
    } catch (error) {
      logEvent("generation.failed", { requestId: request.requestId, photoId: activePhotoId, error: { name: error.name, message: error.message } }, "error");
      if (activePhotoId) activity.finish(activePhotoId, "failed");
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof multer.MulterError) {
      response.status(400).json({ success: false, message: error.message });
      return;
    }
    console.error("Request failed:", error);
    response.status(error.status || 500).json({ success: false, message: error.message || "Unexpected server error." });
  });

  return app;
}
