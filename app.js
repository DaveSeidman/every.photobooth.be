import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import multer from "multer";
import { config, publicConfig } from "./config.js";
import { ensureDirectories, createUploadMiddleware } from "./utils/fileUtils.js";
import { createFalEditor } from "./utils/falUtils.js";
import { resizeForModel, saveRemoteImage, saveSourceImage } from "./utils/imageUtils.js";
import { normalizeMode, publicEveryStyles, publicModes, styleTransferSpec } from "./modes.js";
import { createActivityStore } from "./utils/activity.js";

export function createApp(overrides = {}) {
  const runtimeConfig = overrides.config || config;
  const editor = overrides.editor || createFalEditor({
    credentials: runtimeConfig.falKey,
    model: runtimeConfig.falModel,
    resolution: runtimeConfig.falResolution,
    thinkingLevel: runtimeConfig.falThinkingLevel,
    timeoutMs: runtimeConfig.falTimeoutMs,
  });
  const app = express();

  ensureDirectories([runtimeConfig.directories.uploads, runtimeConfig.directories.photos]);
  const activity = createActivityStore(runtimeConfig.directories.photos, { timezone: runtimeConfig.statusTimezone });
  const startedAt = Date.now();
  const statusPage = (_request, response) => response.type("html").send(fs.readFileSync(new URL("./utils/status-page.html", import.meta.url), "utf8"));
  const upload = createUploadMiddleware(runtimeConfig.directories.uploads, runtimeConfig.uploadMaxBytes);

  app.use(cors({
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
  app.get("/api/status", (_request, response) => response.set("Cache-Control", "no-store").json({
    ...activity.snapshot(),
    status: "ok",
    aiConfigured: Boolean(runtimeConfig.falKey),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    printer: { enabled: false, queued: null, printing: null, message: "No photos are being sent to a printer by this backend. Printing is not enabled, and no printer queue is connected." },
  }));
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/config", (_request, response) => response.json({
    ...publicConfig(runtimeConfig),
    modes: publicModes(),
    everyStyles: publicEveryStyles(),
  }));
  app.get("/modes", (_request, response) => response.json({ modes: publicModes() }));

  app.post("/submit", upload.single("photo"), async (request, response, next) => {
    let activePhotoId;
    try {
      if (!request.file) {
        response.status(400).json({ success: false, message: "A photo file is required." });
        return;
      }
      if (!runtimeConfig.falKey && !overrides.editor) {
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
      activity.start(photoId, style.label);
      activePhotoId = photoId;
      const modelBuffer = await resizeForModel(request.file.path);

      const { styledUrl } = await editor.styleTransfer(
        modelBuffer,
        request.file.filename,
        promptOverride || style.prompt,
      );
      await saveRemoteImage({
        url: styledUrl,
        outputDirectory: runtimeConfig.directories.photos,
        photoId,
      });
      await saveSourceImage({
        sourceBuffer: modelBuffer,
        outputDirectory: runtimeConfig.directories.photos,
        photoId,
      });

      activity.finish(photoId, "completed");
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
          printStatus: "coming-soon",
          mode,
          styleProfile: style.id,
          styleLabel: style.label,
        },
      });
    } catch (error) {
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
    response.status(500).json({ success: false, message: error.message || "Unexpected server error." });
  });

  return app;
}
