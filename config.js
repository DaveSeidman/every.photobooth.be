import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const numberFromEnv = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const dataDirectory = path.resolve(process.env.DATA_DIR || process.cwd());
export function resolveAllowedOrigins(value = "") {
  const configured = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  // Existing Render services can retain the old Blueprint's env value.
  // Keep the canonical booth domain allowed for both HTTP and WebSocket traffic.
  return configured.length ? [...new Set([...configured, "https://photobooth.lightboxlive.io"])] : [];
}
const allowedOrigins = resolveAllowedOrigins(process.env.ALLOWED_ORIGINS);


export const config = {
  port: numberFromEnv("PORT", 8000),
  statusTimezone: process.env.STATUS_TIMEZONE || "America/New_York",
  falKey: process.env.FAL_KEY ?? "",
  falModel: process.env.FAL_MODEL || "fal-ai/nano-banana/edit",
  falResolution: process.env.FAL_RESOLUTION || "1K",
  falThinkingLevel: process.env.FAL_THINKING_LEVEL || "minimal",
  falInputWidth: numberFromEnv("FAL_INPUT_WIDTH", 512),
  falTimeoutMs: numberFromEnv("FAL_TIMEOUT_MS", 30_000),
  animationEnabled: false,
  fallback: {
    enabled: process.env.LOCAL_FALLBACK_ENABLED !== "false",
    normalDurationMs: numberFromEnv("AI_NORMAL_DURATION_MS", 17000),
  },
  print: {
    prepareStrips: process.env.PRINT_PREPARE_STRIPS === "true",
    autoSubmit: process.env.PRINT_AUTO_SUBMIT === "true",
    serverUrl: process.env.PRINT_SERVER_URL || "",
    token: process.env.PRINT_SERVER_TOKEN || "",
    conferenceDate: process.env.CONFERENCE_DATE || "",
    location: process.env.CONFERENCE_LOCATION || "in Brooklyn",
  },
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
