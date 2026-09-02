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

export async function saveRemoteImage({ url, outputDirectory, photoId, sourceBuffer }) {
  const image = await fetchBuffer(url);
  const outputPath = path.join(outputDirectory, `${photoId}.jpg`);
  const styled = sharp(image).rotate();
  const metadata = await styled.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (sourceBuffer && width >= 320 && height >= 240) {
    const insetWidth = Math.round(width * 0.21);
    const insetHeight = Math.round(height * 0.23);
    const border = Math.max(2, Math.round(width * 0.002));
    const padding = Math.max(7, Math.round(width * 0.007));
    const captionSpace = Math.max(18, Math.round(height * 0.025));
    const portrait = await sharp(sourceBuffer)
      .rotate()
      .resize(insetWidth - padding * 2, insetHeight - padding * 2 - captionSpace, { fit: "cover" })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
      .toBuffer();
    const inset = await sharp({
      create: { width: insetWidth, height: insetHeight, channels: 3, background: "#0a0a0a" },
    })
      .composite([{
        input: {
          create: {
            width: insetWidth - border * 2,
            height: insetHeight - border * 2,
            channels: 3,
            background: "#fffaf4",
          },
        },
        left: border,
        top: border,
      }, {
        input: portrait,
        left: padding,
        top: padding,
      }])
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
      .toBuffer();

    await styled
      .composite([{ input: inset, left: 0, top: 0 }])
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
      .toFile(outputPath);
  } else {
    await styled.jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toFile(outputPath);
  }
  return outputPath;
}
