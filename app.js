import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import multer from "multer";
import { config, publicConfig } from "./config.js";
import { ensureDirectories, createUploadMiddleware } from "./utils/fileUtils.js";
import { createFalEditor } from "./utils/falUtils.js";
import { composeStrip, resizeForModel } from "./utils/imageUtils.js";
import { createTransitionAnimation } from "./utils/animationUtils.js";
import { modePrompts, normalizeMode, publicModes, sanitizeOracleContext, designerPromptOptions } from "./modes.js";
import { getSession, resetSession, sessionSummary, updateSession } from "./sessions.js";

const parseJsonObject = (value) => {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

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
  app.get("/modes", (_request, response) => response.json({ modes: publicModes() }));
  app.get("/sessions/:sessionId", (request, response) => response.json(sessionSummary(request.params.sessionId)));
  app.get("/prompts", (_request, response) => response.json({
    past: runtimeConfig.prompts.variantA,
    future: runtimeConfig.prompts.variantB,
    remove: runtimeConfig.prompts.transition,
    ...runtimeConfig.prompts,
  }));
  app.post("/sessions/reset", (request, response) => {
    response.json({ success: true, session: resetSession(request.body?.sessionId) });
  });

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
      const session = getSession(request.body.sessionId);
      const oracleContext = sanitizeOracleContext(parseJsonObject(request.body.oracleContext));
      const designerOptions = designerPromptOptions(parseJsonObject(request.body.designerOptions));
      const futureChoice = ["builder", "designer", "inventor"].includes(request.body.futureChoice) ? request.body.futureChoice : "builder";
      const modeDefaults = modePrompts({
        mode,
        basePrompts: runtimeConfig.prompts,
        oracleContext,
        designerOptions,
        futureChoice,
        hasMemory: mode === "every.one.in" && Boolean(session.masterUrl),
      });
      const variantAPrompt = request.body.variantAPrompt || request.body.pastPrompt || modeDefaults.variantA;
      const variantBPrompt = request.body.variantBPrompt || request.body.futurePrompt || modeDefaults.variantB;
      const transitionPrompt = request.body.transitionPrompt || request.body.removePrompt || modeDefaults.transition;
      const modelBuffer = await resizeForModel(request.file.path);
      const { variantAUrl, variantBUrl } = await editor.createVariants(
        modelBuffer,
        request.file.filename,
        variantAPrompt,
        variantBPrompt,
        mode === "every.one.in" && session.masterUrl ? [session.masterUrl] : [],
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
          printStatus: "coming-soon",
          mode,
          groupCount: mode === "every.one.in" ? session.count + 1 : undefined,
          oracle: mode === "every.oracle" ? { enabled: true, message: "A little context, carefully used." } : undefined,
          futureChoice: mode === "every.future.familiar" ? futureChoice : undefined,
        },
      });

      if (mode === "every.one.in") {
        updateSession(session.id, {
          masterUrl: variantAUrl,
          count: session.count + 1,
          oracleContext: {},
        });
      }

      void (async () => {
        if (runtimeConfig.animationEnabled) {
          try {
            await createTransitionAnimation({
              stripPath,
              outputDirectory: runtimeConfig.directories.photos,
              photoId,
              prompt: transitionPrompt,
              editor,
              mode,
              originalPath: request.file.path,
              groupUrl: mode === "every.one.in" ? variantAUrl : null,
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
