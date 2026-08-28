import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const numberFromEnv = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const booleanFromEnv = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
};

export const config = {
  port: numberFromEnv("PORT", 8000),
  falKey: process.env.FAL_KEY ?? "",
  falModel: process.env.FAL_MODEL || "fal-ai/nano-banana/edit",
  printServerUrl: process.env.PRINT_SERVER_URL ?? "",
  printGamma: numberFromEnv("PRINT_GAMMA", 1.15),
  animationEnabled: booleanFromEnv("ENABLE_ANIMATION", true),
  uploadMaxBytes: numberFromEnv("UPLOAD_MAX_MB", 15) * 1024 * 1024,
  directories: {
    uploads: path.join(process.cwd(), "uploads"),
    photos: path.join(process.cwd(), "photos"),
  },
  strip: {
    background: path.resolve(process.cwd(), process.env.STRIP_BACKGROUND || "assets/strip-background.svg"),
    width: numberFromEnv("STRIP_WIDTH", 600),
    height: numberFromEnv("STRIP_HEIGHT", 1800),
    photoWidth: numberFromEnv("PHOTO_WIDTH", 540),
    photoHeight: numberFromEnv("PHOTO_HEIGHT", 440),
    left: numberFromEnv("PHOTO_LEFT", 30),
    top: numberFromEnv("PHOTO_TOP", 60),
    gap: numberFromEnv("PHOTO_GAP", 60),
  },
  labels: {
    variantA: process.env.VARIANT_A_LABEL || "Reimagined One",
    original: "Original",
    variantB: process.env.VARIANT_B_LABEL || "Reimagined Two",
  },
  prompts: {
    variantA: process.env.VARIANT_A_PROMPT || "Recreate the source photo with identical framing, crop, camera angle, body proportions, poses, facial expressions, and number of people. Keep every face recognizable. Transform only the environment, wardrobe, lighting, materials, and art direction according to the first experience concept.",
    variantB: process.env.VARIANT_B_PROMPT || "Recreate the source photo with identical framing, crop, camera angle, body proportions, poses, facial expressions, and number of people. Keep every face recognizable. Transform only the environment, wardrobe, lighting, materials, and art direction according to the second experience concept.",
    transition: process.env.TRANSITION_PROMPT || "Transform the complete three-panel photo strip into an alternate version while keeping every panel in exactly the same size and position. Preserve the strip composition and make the change visually coherent.",
  },
};

export function publicConfig(runtimeConfig = config) {
  return {
    labels: runtimeConfig.labels,
    prompts: runtimeConfig.prompts,
    features: {
      print: Boolean(runtimeConfig.printServerUrl),
      animation: runtimeConfig.animationEnabled,
    },
  };
}
