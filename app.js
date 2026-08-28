import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import multer from "multer";
import { config, publicConfig } from "./config.js";
import { ensureDirectories, createUploadMiddleware } from "./utils/fileUtils.js";
import { createFalEditor } from "./utils/falUtils.js";
import { composeStrip, resizeForModel } from "./utils/imageUtils.js";
import { createPrintSheet, sendToPrintServer } from "./utils/printUtils.js";
import { createTransitionAnimation } from "./utils/animationUtils.js";

export function createApp(overrides = {}) {
  const runtimeConfig = overrides.config || config;
  const editor = overrides.editor || createFalEditor({
    credentials: runtimeConfig.falKey,
    model: runtimeConfig.falModel,
  });
  const app = express();

  ensureDirectories([runtimeConfig.directories.uploads, runtimeConfig.directories.photos]);
  const upload = createUploadMiddleware(runtimeConfig.directories.uploads, runtimeConfig.uploadMaxBytes);

  app.use(cors());
  app.use(express.json());
  app.use("/uploads", express.static(runtimeConfig.directories.uploads));
  app.use("/photos", express.static(runtimeConfig.directories.photos));

  app.get("/", (_request, response) => response.json({
    status: "ok",
    service: "every-photobooth-backend",
    aiConfigured: Boolean(runtimeConfig.falKey),
  }));
  app.get("/config", (_request, response) => response.json(publicConfig(runtimeConfig)));
  app.get("/prompts", (_request, response) => response.json({
    past: runtimeConfig.prompts.variantA,
    future: runtimeConfig.prompts.variantB,
    remove: runtimeConfig.prompts.transition,
    ...runtimeConfig.prompts,
  }));

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
      const variantAPrompt = request.body.variantAPrompt || request.body.pastPrompt || runtimeConfig.prompts.variantA;
      const variantBPrompt = request.body.variantBPrompt || request.body.futurePrompt || runtimeConfig.prompts.variantB;
      const transitionPrompt = request.body.transitionPrompt || request.body.removePrompt || runtimeConfig.prompts.transition;
      const modelBuffer = await resizeForModel(request.file.path);
      const { variantAUrl, variantBUrl } = await editor.createVariants(
        modelBuffer,
        request.file.filename,
        variantAPrompt,
        variantBPrompt,
      );
      const stripPath = await composeStrip({
        originalPath: request.file.path,
        variantAUrl,
        variantBUrl,
        outputDirectory: runtimeConfig.directories.photos,
        photoId,
        layout: runtimeConfig.strip,
      });

      response.json({
        success: true,
        input: `/uploads/${request.file.filename}`,
        output: {
          variantA: variantAUrl,
          variantB: variantBUrl,
          // Backward-compatible aliases make migration from the Halloween client painless.
          past: variantAUrl,
          future: variantBUrl,
          photoId,
          photo: `/photos/${photoId}.jpg`,
          animation: runtimeConfig.animationEnabled ? `/photos/${photoId}.gif` : null,
        },
      });

      void (async () => {
        try {
          const printPath = await createPrintSheet(
            stripPath,
            runtimeConfig.directories.photos,
            photoId,
            runtimeConfig.strip,
            runtimeConfig.printGamma,
          );
          await sendToPrintServer(printPath, runtimeConfig.printServerUrl);
        } catch (error) {
          console.error("Print pipeline failed:", error.message);
        }

        if (runtimeConfig.animationEnabled) {
          try {
            await createTransitionAnimation({
              stripPath,
              outputDirectory: runtimeConfig.directories.photos,
              photoId,
              prompt: transitionPrompt,
              editor,
            });
          } catch (error) {
            console.error("Animation pipeline failed:", error.message);
          }
        }
      })();
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
