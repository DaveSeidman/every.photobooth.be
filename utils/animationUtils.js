import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import fetch from "node-fetch";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

async function createEveryOneInAnimation({ originalPath, groupUrl, outputDirectory, photoId, editor }) {
  const [groupResponse, originalBuffer] = await Promise.all([fetch(groupUrl), fs.readFile(originalPath)]);
  if (!groupResponse.ok) throw new Error("Could not download cumulative group image.");
  const groupBuffer = Buffer.from(await groupResponse.arrayBuffer());
  const frameDirectory = path.join(outputDirectory, `${photoId}-frames`);
  await fs.mkdir(frameDirectory, { recursive: true });
  const width = 768;
  const height = 768;
  const originalData = originalBuffer.toString("base64");
  const framePaths = [];
  for (let index = 0; index < 18; index += 1) {
    const progress = index / 17;
    const eased = 1 - ((1 - progress) ** 3);
    const zoom = 1.7 - (0.7 * eased);
    const cropWidth = Math.max(1, Math.round(width / zoom));
    const cropHeight = Math.max(1, Math.round(height / zoom));
    const left = Math.max(0, Math.round((width - cropWidth) / 2));
    const top = Math.max(0, Math.round((height - cropHeight) / 2));
    const groupFrame = await sharp(groupBuffer)
      .resize(width, height, { fit: "cover" })
      .extract({ left, top, width: Math.min(cropWidth, width), height: Math.min(cropHeight, height) })
      .resize(width, height)
      .png()
      .toBuffer();
    const overlayOpacity = Math.max(0, 1 - (progress / 0.62));
    const overlayWidth = Math.round(width * 0.42);
    const overlayHeight = Math.round(height * 0.62);
    const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><image href="data:image/jpeg;base64,${originalData}" x="${Math.round((width - overlayWidth) / 2)}" y="${Math.round((height - overlayHeight) / 2)}" width="${overlayWidth}" height="${overlayHeight}" preserveAspectRatio="xMidYMid slice" opacity="${overlayOpacity.toFixed(3)}"/></svg>`);
    const framePath = path.join(frameDirectory, `${String(index).padStart(3, "0")}.jpg`);
    await sharp(groupFrame).composite([{ input: svg }]).jpeg({ quality: 88 }).toFile(framePath);
    framePaths.push(framePath);
  }
  const outputPath = path.join(outputDirectory, `${photoId}.gif`);
  await execFileAsync(ffmpegPath.path, [
    "-y", "-framerate", "9", "-i", path.join(frameDirectory, "%03d.jpg"),
    "-vf", "split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=sierra2_4a",
    "-loop", "0", outputPath,
  ]);
  await Promise.allSettled(framePaths.map((framePath) => fs.unlink(framePath)));
  await fs.rm(frameDirectory, { recursive: true, force: true });
  return outputPath;
}

export async function createTransitionAnimation({ stripPath, outputDirectory, photoId, prompt, editor, mode, originalPath, groupUrl }) {
  if (mode === "every.one.in" && originalPath && groupUrl) {
    return createEveryOneInAnimation({ originalPath, groupUrl, outputDirectory, photoId, editor });
  }
  const sourceBuffer = await sharp(stripPath)
    .resize({ width: 768, withoutEnlargement: true })
    .jpeg({ quality: 84 })
    .toBuffer();
  const sourceFileName = `${photoId}-strip.jpg`;
  const sourceUrl = await editor.upload(sourceBuffer, sourceFileName);
  const transformedUrl = await editor.edit(sourceUrl, prompt);
  const response = await fetch(transformedUrl);
  if (!response.ok) throw new Error("Could not download animation frame.");

  const transformedPath = path.join(outputDirectory, `${photoId}-transition.jpg`);
  await fs.writeFile(transformedPath, Buffer.from(await response.arrayBuffer()));

  const metadata = await sharp(stripPath).metadata();
  const normalizedOriginal = path.join(outputDirectory, `${photoId}-original-frame.jpg`);
  const normalizedTransformed = path.join(outputDirectory, `${photoId}-transformed-frame.jpg`);
  await Promise.all([
    sharp(stripPath).resize(metadata.width, metadata.height, { fit: "cover" }).toFile(normalizedOriginal),
    sharp(transformedPath).resize(metadata.width, metadata.height, { fit: "cover" }).toFile(normalizedTransformed),
  ]);

  const outputPath = path.join(outputDirectory, `${photoId}.gif`);
  await execFileAsync(ffmpegPath.path, [
    "-y",
    "-loop", "1", "-t", "2", "-i", normalizedOriginal,
    "-loop", "1", "-t", "2", "-i", normalizedTransformed,
    "-filter_complex", "[0:v][1:v]blend=all_expr='A*(1-T/2)+B*(T/2)',fps=12,format=yuv420p[v]",
    "-map", "[v]", "-t", "2", outputPath,
  ]);

  await Promise.allSettled([
    fs.unlink(normalizedOriginal),
    fs.unlink(normalizedTransformed),
    fs.unlink(transformedPath),
  ]);
  return outputPath;
}
