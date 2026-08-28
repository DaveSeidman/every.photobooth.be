import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import FormData from "form-data";
import sharp from "sharp";

export async function createPrintSheet(stripPath, outputDirectory, photoId, layout, gamma = 1.15) {
  const printPath = path.join(outputDirectory, `${photoId}-print.jpg`);
  const strip = await sharp(stripPath)
    .resize({ width: layout.width, height: layout.height, fit: "fill" })
    .removeAlpha()
    .jpeg({ quality: 96 })
    .toBuffer();

  await sharp({
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
    ])
    .gamma(gamma)
    .withMetadata({ density: 300 })
    .jpeg({ quality: 96, chromaSubsampling: "4:4:4" })
    .toFile(printPath);

  return printPath;
}

export async function sendToPrintServer(printPath, printServerUrl) {
  if (!printServerUrl) return { skipped: true };
  const form = new FormData();
  form.append("file", fs.createReadStream(printPath));
  const response = await axios.post(printServerUrl, form, {
    headers: form.getHeaders(),
    timeout: 30_000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return response.data;
}
