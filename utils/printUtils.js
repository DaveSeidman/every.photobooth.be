import { printMedia } from "./printMedia.js";
import { logEvent } from "./logger.js";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import FormData from "form-data";
import sharp from "sharp";

export async function createPrintSheet(stripPath, outputDirectory, photoId, layout = { width: printMedia.stripWidth, height: printMedia.stripHeight }, gamma = 1) {
  const printPath = path.join(outputDirectory, `${photoId}-print.jpg`);
  const strip = await sharp(stripPath)
    .resize({ width: layout.width, height: layout.height, fit: "contain", background: "white" })
    .removeAlpha()
    .jpeg({ quality: 96 })
    .toBuffer();

  let sheet = sharp({
    create: {
      width: layout.width * 2,
      height: layout.height,
      channels: 3,
      background: "white",
    },
  })
    .composite([
      { input: strip, left: 0, top: 0 },
      { input: strip, left: layout.width, top: 0 },
    ]);
  // Keep color unchanged until an on-site print justifies compensation.
  if (gamma !== 1) sheet = sheet.gamma(gamma);
  await sheet
    .withMetadata({ density: printMedia.density })
    .jpeg({ quality: 96, chromaSubsampling: "4:4:4" })
    .toFile(printPath);

  return printPath;
}

export async function sendToPrintServer(printPath, printServerUrl, { token, jobKey = path.basename(printPath) } = {}) {
  if (!printServerUrl) return { skipped: true };
  const started = performance.now();
  try {
    const bytes = fs.statSync(printPath).size;
    const form = new FormData();
    form.append("file", fs.createReadStream(printPath));
    logEvent("print.upload-started", { jobKey, bytes });
    const response = await axios.post(printServerUrl, form, {
      headers: { ...form.getHeaders(), "Idempotency-Key": jobKey, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      timeout: 30_000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    logEvent("print.upload-accepted", { jobKey, jobId: response.data?.jobId, status: response.data?.status, durationMs: Math.round(performance.now() - started) });
    return response.data;
  } catch (error) {
    logEvent("print.upload-failed", { jobKey, status: error.response?.status, message: error.message }, "error");
    throw error;
  }
}
