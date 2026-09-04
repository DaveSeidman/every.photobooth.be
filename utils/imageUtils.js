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

export async function saveSourceImage({ sourceBuffer, outputDirectory, photoId }) {
  const outputPath = path.join(outputDirectory, `${photoId}-source.jpg`);
  await sharp(sourceBuffer)
    .rotate()
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
  return outputPath;
}

export async function saveRemoteImage({ url, outputDirectory, photoId }) {
  const image = await fetchBuffer(url);
  const outputPath = path.join(outputDirectory, `${photoId}.jpg`);
  await sharp(image)
    .rotate()
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
  return outputPath;
}
