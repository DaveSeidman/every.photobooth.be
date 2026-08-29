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
    variantA: process.env.VARIANT_A_LABEL || "Thesis Blue",
    original: "Source Portrait",
    variantB: process.env.VARIANT_B_LABEL || "Thesis Coral",
  },
  prompts: {
    variantA: process.env.VARIANT_A_PROMPT || "Recreate the SOURCE IMAGE as an Every / Thesis: 2027 editorial conference speaker portrait. CRITICAL COMPOSITION LOCK: keep the exact same framing, crop, camera angle, perspective, focal length, number of people, body proportions, poses, facial expressions, and recognizable faces. Do not add, remove, move, resize, or merge people. Render every person as a crisp, high-contrast black-and-white photographic cutout with a lightly posterized photocopy / screenprint texture, preserving facial detail and clothing silhouette. Replace only the background with a saturated electric blue field (#2B83EE) and one broad rough diagonal dry-brush swash behind the subject in a darker blue. Add subtle offset ink registration, coarse halftone dots, paper fiber, and imperfect risograph grain. Keep the result bold, art-directed, tactile, and editorial. Do not add any text, lettering, logo, watermark, border, icon, or object over a face.",
    variantB: process.env.VARIANT_B_PROMPT || "Recreate the SOURCE IMAGE as an Every / Thesis: 2027 editorial conference speaker portrait. CRITICAL COMPOSITION LOCK: keep the exact same framing, crop, camera angle, perspective, focal length, number of people, body proportions, poses, facial expressions, and recognizable faces. Do not add, remove, move, resize, or merge people. Render every person as a crisp, high-contrast black-and-white photographic cutout with a lightly posterized photocopy / screenprint texture, preserving facial detail and clothing silhouette. Replace only the background with a warm coral field (#FF7B70) and one broad rough diagonal dry-brush swash behind the subject in a slightly darker coral. Add subtle offset ink registration, coarse halftone dots, paper fiber, and imperfect risograph grain. Keep the result bold, art-directed, tactile, and editorial. Do not add any text, lettering, logo, watermark, border, icon, or object over a face.",
    transition: process.env.TRANSITION_PROMPT || "Transform the complete three-panel photo strip into a lively Every / Thesis: 2027 editorial print collage while keeping every panel exactly the same size and position. Preserve the three-panel composition and all people. Use saturated electric blue, coral, cyan, and yellow color blocks, rough diagonal painterly swashes, black-and-white halftone photocopy texture, paper grain, and slightly misregistered risograph ink. Keep all faces recognizable and do not add any text, logos, or watermarks.",
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
