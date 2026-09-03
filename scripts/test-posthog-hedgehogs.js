import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import sharp from "sharp";
import { createFalEditor } from "../utils/falUtils.js";
import { styleTransferPrompt } from "../modes.js";

dotenv.config();

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(scriptDirectory, "..");
const frontendDirectory = path.resolve(backendDirectory, "../every-photobooth-frontend");
const inputDirectory = path.join(frontendDirectory, "public/test-frames");
const runName = process.argv[2] || `posthog-paper-hedgehogs-${new Date().toISOString().slice(0, 10)}`;
const outputDirectory = path.join(frontendDirectory, "public/test-results", runName);
const model = process.env.FAL_MODEL || "fal-ai/nano-banana/edit";
const prompt = styleTransferPrompt({ mode: "posthog" });

if (!process.env.FAL_KEY) throw new Error("FAL_KEY is not configured.");

const inputNames = (await fs.readdir(inputDirectory))
  .filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (!inputNames.length) throw new Error("No test images were found.");

const editor = createFalEditor({
  credentials: process.env.FAL_KEY,
  model,
  resolution: process.env.FAL_RESOLUTION || "1K",
  thinkingLevel: process.env.FAL_THINKING_LEVEL || "minimal",
  timeoutMs: 120_000,
});

await fs.mkdir(outputDirectory, { recursive: true });
const rows = [];

for (const [index, inputName] of inputNames.entries()) {
  const inputPath = path.join(inputDirectory, inputName);
  const buffer = await fs.readFile(inputPath);
  const uploadedUrl = await editor.upload(buffer, inputName);
  const startedAt = performance.now();
  const outputUrl = await editor.edit(uploadedUrl, prompt);
  const response = await fetch(outputUrl);
  if (!response.ok) throw new Error(`Could not download ${outputUrl}: ${response.status}`);
  const outputName = `image${index + 1}-posthog-paper-hedgehogs.jpg`;
  await sharp(Buffer.from(await response.arrayBuffer()))
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toFile(path.join(outputDirectory, outputName));
  const seconds = (performance.now() - startedAt) / 1000;
  rows.push({ inputName, outputName, seconds });
  process.stdout.write(`${inputName}: ${seconds.toFixed(1)}s\n`);
}

const background = { r: 242, g: 238, b: 224 };
const columnWidth = 640;
const gutter = 28;
const headerHeight = 90;
const rowHeight = 530;
const sheetWidth = columnWidth * 2 + gutter;
const sheetHeight = headerHeight + rowHeight * rows.length;
const header = Buffer.from(`<svg width="${sheetWidth}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
  <text x="${columnWidth / 2}" y="56" text-anchor="middle" font-family="Arial" font-weight="700" font-size="26">ORIGINAL</text>
  <text x="${columnWidth + gutter + columnWidth / 2}" y="56" text-anchor="middle" font-family="Arial" font-weight="700" font-size="26">POSTHOG / PAPER HEDGEHOGS</text>
</svg>`);
const composites = [{ input: header, left: 0, top: 0 }];

for (const [index, row] of rows.entries()) {
  for (const [column, imagePath] of [
    [0, path.join(inputDirectory, row.inputName)],
    [1, path.join(outputDirectory, row.outputName)],
  ]) {
    const rendered = await sharp(imagePath)
      .resize(columnWidth, rowHeight - 18, { fit: "contain", background })
      .jpeg({ quality: 92 })
      .toBuffer();
    composites.push({ input: rendered, left: column * (columnWidth + gutter), top: headerHeight + index * rowHeight });
  }
}

await sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 3, background } })
  .composite(composites)
  .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
  .toFile(path.join(outputDirectory, "contact-sheet.jpg"));

const readme = `# PostHog paper hedgehog test\n\n- Model: \`${model}\`\n- Generations: ${rows.length}\n\n## Timings\n\n${rows.map((row, index) => `- Image ${index + 1}: ${row.seconds.toFixed(1)} seconds`).join("\n")}\n\n## Prompt\n\n${prompt}\n`;
await fs.writeFile(path.join(outputDirectory, "README.md"), readme);
process.stdout.write(`Contact sheet: ${path.join(outputDirectory, "contact-sheet.jpg")}\n`);
