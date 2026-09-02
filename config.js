import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const numberFromEnv = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const dataDirectory = path.resolve(process.env.DATA_DIR || process.cwd());
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  port: numberFromEnv("PORT", 8000),
  falKey: process.env.FAL_KEY ?? "",
  falModel: process.env.FAL_MODEL || "fal-ai/nano-banana/edit",
  falResolution: process.env.FAL_RESOLUTION || "1K",
  falThinkingLevel: process.env.FAL_THINKING_LEVEL || "minimal",
  falTimeoutMs: numberFromEnv("FAL_TIMEOUT_MS", 30_000),
  animationEnabled: false,
  uploadMaxBytes: numberFromEnv("UPLOAD_MAX_MB", 15) * 1024 * 1024,
  allowedOrigins,
  directories: {
    uploads: path.join(dataDirectory, "uploads"),
    photos: path.join(dataDirectory, "photos"),
  },
  labels: {
    styled: process.env.STYLED_LABEL || "Styled Portrait",
    original: "Source Portrait",
  },
};

export function publicConfig(runtimeConfig = config) {
  return {
    labels: runtimeConfig.labels,
    features: {
      print: false,
      animation: false,
    },
  };
}
