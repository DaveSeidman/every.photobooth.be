import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import multer from "multer";
import { config, publicConfig } from "./config.js";
import { ensureDirectories, createUploadMiddleware } from "./utils/fileUtils.js";
import { createFalEditor } from "./utils/falUtils.js";
import { resizeForModel, saveRemoteImage } from "./utils/imageUtils.js";
import { normalizeMode, publicEveryStyles, publicModes, styleTransferSpec } from "./modes.js";

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

  app.get("/", (_request, response) => response.json({
    status: "ok",
    service: "every-photobooth-backend",
    aiConfigured: Boolean(runtimeConfig.falKey),
  }));
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/config", (_request, response) => response.json({
    ...publicConfig(runtimeConfig),
    modes: publicModes(),
    everyStyles: publicEveryStyles(),
  }));
  app.get("/modes", (_request, response) => response.json({ modes: publicModes() }));

  app.post("/submit", upload.single("photo"), async (request, response, next) => {
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
      const modelBuffer = await resizeForModel(request.file.path);

      const { styledUrl } = await editor.styleTransfer(
        modelBuffer,
        request.file.filename,
        style.prompt,
      );
      await saveRemoteImage({
        url: styledUrl,
        outputDirectory: runtimeConfig.directories.photos,
        photoId,
        sourceBuffer: modelBuffer,
      });

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
          animation: null,
          printStatus: "coming-soon",
          mode,
          styleProfile: style.id,
          styleLabel: style.label,
        },
      });
    } catch (error) {
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
