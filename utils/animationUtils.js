import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import fetch from "node-fetch";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

export async function createTransitionAnimation({ stripPath, outputDirectory, photoId, prompt, editor }) {
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
