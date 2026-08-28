import fs from "node:fs/promises";
import path from "node:path";
import fetch from "node-fetch";
import sharp from "sharp";

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download generated image (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

export function resizeForModel(filePath, width = 1024) {
  return sharp(filePath)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
}

export async function composeStrip({ originalPath, variantAUrl, variantBUrl, outputDirectory, photoId, layout }) {
  const [variantA, original, variantB, background] = await Promise.all([
    fetchBuffer(variantAUrl),
    fs.readFile(originalPath),
    fetchBuffer(variantBUrl),
    fs.readFile(layout.background),
  ]);

  const panels = await Promise.all(
    [variantA, original, variantB].map((panel) => sharp(panel)
      .rotate()
      .resize({ width: layout.photoWidth, height: layout.photoHeight, fit: "cover", position: "centre" })
      .jpeg({ quality: 92 })
      .toBuffer()),
  );

  const outputPath = path.join(outputDirectory, `${photoId}.jpg`);
  const backgroundBuffer = await sharp(background)
    .resize({ width: layout.width, height: layout.height, fit: "fill" })
    .toBuffer();

  await sharp(backgroundBuffer)
    .composite(panels.map((input, index) => ({
      input,
      left: layout.left,
      top: layout.top + index * (layout.photoHeight + layout.gap),
    })))
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);

  return outputPath;
}
