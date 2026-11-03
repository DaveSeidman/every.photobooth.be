import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import sharp from "sharp";
import { createFalEditor } from "../utils/falUtils.js";
import {
  everyStyleDefinitions,
  styleTransferPrompt,
} from "../modes.js";

dotenv.config();

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(scriptDirectory, "..");
const frontendDirectory = path.resolve(backendDirectory, "../every-photobooth-frontend");
const inputDirectory = path.join(frontendDirectory, "public/test-frames");
const runName = process.argv[2] || "nano-banana-every-five-styles-2026-09-02";
const outputDirectory = path.join(frontendDirectory, `public/test-results/${runName}`);

const model = "fal-ai/nano-banana/edit";
const pricePerGeneration = 0.039;
const maximumPricePerGeneration = 0.10;
const requiredInputSize = { width: 1280, height: 1024 };

if (pricePerGeneration > maximumPricePerGeneration) {
  throw new Error("Price guard stopped the run: a generation exceeds $0.10.");
}
if (!process.env.FAL_KEY) throw new Error("FAL_KEY is not configured.");

const inputNames = (await fs.readdir(inputDirectory))
  .filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (inputNames.length !== 4) {
  throw new Error(`Expected exactly 4 test images, found ${inputNames.length}.`);
}

for (const inputName of inputNames) {
  const metadata = await sharp(path.join(inputDirectory, inputName)).metadata();
  if (metadata.width !== requiredInputSize.width || metadata.height !== requiredInputSize.height) {
    throw new Error(
      `${inputName} is ${metadata.width}x${metadata.height}; all test inputs must be 1280x1024.`,
    );
  }
}

const editor = createFalEditor({ credentials: process.env.FAL_KEY, model });
await fs.mkdir(outputDirectory, { recursive: true });
const results = [];

for (const [imageIndex, inputName] of inputNames.entries()) {
  const inputPath = path.join(inputDirectory, inputName);
  const inputBuffer = await fs.readFile(inputPath);
  const uploadedUrl = await editor.upload(inputBuffer, inputName);
  const row = { inputName, outputs: {} };

  for (const style of everyStyleDefinitions) {
    const prompt = styleTransferPrompt({ mode: "every", styleId: style.id });
    const startedAt = performance.now();
    const outputUrl = await editor.edit(uploadedUrl, prompt);
    const response = await fetch(outputUrl);
    if (!response.ok) throw new Error(`Could not download ${outputUrl}: ${response.status}`);
    const outputBuffer = Buffer.from(await response.arrayBuffer());
    const outputName = `image${imageIndex + 1}-${style.id}.jpg`;
    await sharp(outputBuffer)
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
      .toFile(path.join(outputDirectory, outputName));
    row.outputs[style.id] = {
      outputName,
      prompt,
      seconds: (performance.now() - startedAt) / 1000,
    };
    process.stdout.write(
      `${inputName} / ${style.label}: ${row.outputs[style.id].seconds.toFixed(1)}s\n`,
    );
  }
  results.push(row);
}

const originalColumnWidth = 300;
const styleColumnWidth = 400;
const cellHeight = 336;
const headerHeight = 100;
const columnGutter = 24;
const columns = [{ id: "original", label: "Original" }, ...everyStyleDefinitions];
const columnWidths = columns.map((_column, index) => (
  index === 0 ? originalColumnWidth : styleColumnWidth
));
const columnLefts = columnWidths.map((_width, index) => (
  columnWidths.slice(0, index).reduce((sum, width) => sum + width, 0) + index * columnGutter
));
const sheetWidth = columnWidths.reduce((sum, width) => sum + width, 0)
  + columnGutter * (columns.length - 1);
const sheetHeight = headerHeight + cellHeight * results.length;
const background = { r: 241, g: 236, b: 225 };
const escapeXml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const headerSvg = Buffer.from(`
  <svg width="${sheetWidth}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
    ${columns.map((column, index) => `
      <text x="${columnLefts[index] + columnWidths[index] / 2}" y="62"
        font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700"
        text-anchor="middle" fill="#111111">${escapeXml(column.label)}</text>
    `).join("")}
  </svg>
`);
const layers = [{ input: headerSvg, left: 0, top: 0 }];

for (const [rowIndex, result] of results.entries()) {
  const imagePaths = [
    path.join(inputDirectory, result.inputName),
    ...everyStyleDefinitions.map((style) => (
      path.join(outputDirectory, result.outputs[style.id].outputName)
    )),
  ];
  for (const [columnIndex, imagePath] of imagePaths.entries()) {
    const isOriginal = columnIndex === 0;
    const imageWidth = isOriginal ? 250 : styleColumnWidth;
    const imageHeight = isOriginal ? 200 : cellHeight;
    const input = await sharp(imagePath)
      .resize(imageWidth, imageHeight, { fit: "contain", background })
      .jpeg({ quality: 92 })
      .toBuffer();
    layers.push({
      input,
      left: columnLefts[columnIndex] + Math.floor((columnWidths[columnIndex] - imageWidth) / 2),
      top: headerHeight + rowIndex * cellHeight + Math.floor((cellHeight - imageHeight) / 2),
    });
  }
}

await sharp({
  create: { width: sheetWidth, height: sheetHeight, channels: 3, background },
})
  .composite(layers)
  .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
  .toFile(path.join(outputDirectory, "contact-sheet.jpg"));

const timingLines = results.flatMap((result, imageIndex) => (
  everyStyleDefinitions.map((style) => (
    `- Image ${imageIndex + 1}, ${style.label}: ${result.outputs[style.id].seconds.toFixed(1)} seconds`
  ))
));
const promptSections = everyStyleDefinitions.map((style) => {
  if (style.id !== "black-white") {
    return `### ${style.label}\n\n${results[0].outputs[style.id].prompt}`;
  }
  return `### ${style.label}\n\n${results.map((result, index) => (
    `#### Image ${index + 1}: ${result.outputs[style.id].palette}\n\n${result.outputs[style.id].prompt}`
  )).join("\n\n")}`;
});
const generationCount = inputNames.length * everyStyleDefinitions.length;
const readme = `# Every five-style comparison

- Model: \`${model}\`
- Input dimensions: ${requiredInputSize.width}x${requiredInputSize.height}
- Inputs: portrait image only; no visual style-reference image
- Generated images: ${generationCount}
- Price: $${pricePerGeneration.toFixed(3)} per image
- Estimated batch cost: $${(generationCount * pricePerGeneration).toFixed(3)}

## Timings

${timingLines.join("\n")}

## Prompts

${promptSections.join("\n\n")}
`;
await fs.writeFile(path.join(outputDirectory, "README.md"), readme);

process.stdout.write(`Contact sheet: ${path.join(outputDirectory, "contact-sheet.jpg")}\n`);
