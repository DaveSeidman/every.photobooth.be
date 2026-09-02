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
const runName = process.argv[2] || "nano-banana-2-thinking-2026-09-02";
const outputDirectory = path.join(
  frontendDirectory,
  `public/test-results/${runName}`,
);

const model = "fal-ai/nano-banana-2/edit";
const resolution = "1K";
const prices = { minimal: 0.08, high: 0.082 };
const maximumPricePerGeneration = 0.10;
const requiredInputSize = { width: 1280, height: 1024 };

if (Math.max(...Object.values(prices)) > maximumPricePerGeneration) {
  throw new Error("Price guard stopped the run: a generation exceeds $0.10.");
}
if (!process.env.FAL_KEY) throw new Error("FAL_KEY is not configured.");

const prompt = styleTransferPrompt({ mode: "every" });
const minimalEditor = createFalEditor({
  credentials: process.env.FAL_KEY,
  model,
  resolution,
  thinkingLevel: "minimal",
});
const highEditor = createFalEditor({
  credentials: process.env.FAL_KEY,
  model,
  resolution,
  thinkingLevel: "high",
});

const inputNames = (await fs.readdir(inputDirectory))
  .filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (inputNames.length !== 4) {
  throw new Error(`Expected exactly 4 test images, found ${inputNames.length}.`);
}

for (const inputName of inputNames) {
  const metadata = await sharp(path.join(inputDirectory, inputName)).metadata();
  if (
    metadata.width !== requiredInputSize.width
    || metadata.height !== requiredInputSize.height
  ) {
    throw new Error(
      `${inputName} is ${metadata.width}x${metadata.height}; all test inputs must be 1280x1024.`,
    );
  }
}

await fs.mkdir(outputDirectory, { recursive: true });
const results = [];

for (const [index, inputName] of inputNames.entries()) {
  const inputPath = path.join(inputDirectory, inputName);
  const inputBuffer = await fs.readFile(inputPath);
  const uploadedUrl = await minimalEditor.upload(inputBuffer, inputName);
  const row = { inputName, outputs: {} };

  for (const [thinkingLevel, editor] of [
    ["minimal", minimalEditor],
    ["high", highEditor],
  ]) {
    const startedAt = performance.now();
    const outputUrl = await editor.edit(uploadedUrl, prompt);
    const response = await fetch(outputUrl);
    if (!response.ok) throw new Error(`Could not download ${outputUrl}: ${response.status}`);
    const outputBuffer = Buffer.from(await response.arrayBuffer());
    const outputName = `image${index + 1}-${thinkingLevel}.jpg`;
    await sharp(outputBuffer).jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toFile(
      path.join(outputDirectory, outputName),
    );
    row.outputs[thinkingLevel] = {
      outputName,
      seconds: (performance.now() - startedAt) / 1000,
    };
    process.stdout.write(
      `${inputName} / ${thinkingLevel}: ${row.outputs[thinkingLevel].seconds.toFixed(1)}s\n`,
    );
  }
  results.push(row);
}

const cellWidth = 640;
const cellHeight = 480;
const headerHeight = 90;
const sheetWidth = cellWidth * 3;
const sheetHeight = headerHeight + cellHeight * results.length;
const background = { r: 241, g: 236, b: 225 };

const svgText = (text, x, y, size = 30) => Buffer.from(`
  <svg width="${sheetWidth}" height="${sheetHeight}" xmlns="http://www.w3.org/2000/svg">
    <text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}"
      font-weight="700" text-anchor="middle" fill="#111111">${text}</text>
  </svg>
`);

const layers = [
  { input: svgText("Original", cellWidth / 2, 56), left: 0, top: 0 },
  { input: svgText("Thinking: minimal", cellWidth * 1.5, 56), left: 0, top: 0 },
  { input: svgText("Thinking: high", cellWidth * 2.5, 56), left: 0, top: 0 },
];

for (const [rowIndex, result] of results.entries()) {
  const top = headerHeight + rowIndex * cellHeight;
  const paths = [
    path.join(inputDirectory, result.inputName),
    path.join(outputDirectory, result.outputs.minimal.outputName),
    path.join(outputDirectory, result.outputs.high.outputName),
  ];
  for (const [columnIndex, imagePath] of paths.entries()) {
    const input = await sharp(imagePath)
      .resize(cellWidth, cellHeight, { fit: "contain", background })
      .jpeg({ quality: 92 })
      .toBuffer();
    layers.push({ input, left: columnIndex * cellWidth, top });
  }
}

await sharp({
  create: { width: sheetWidth, height: sheetHeight, channels: 3, background },
})
  .composite(layers)
  .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
  .toFile(path.join(outputDirectory, "contact-sheet.jpg"));

const timingLines = results.flatMap((result, index) => [
  `- Image ${index + 1}, minimal: ${result.outputs.minimal.seconds.toFixed(1)} seconds`,
  `- Image ${index + 1}, high: ${result.outputs.high.seconds.toFixed(1)} seconds`,
]);
const readme = `# Nano Banana 2 thinking-level comparison

- Model: \`${model}\`
- Resolution: ${resolution}
- Inputs: portrait image only; no visual style-reference image
- Minimal price: $${prices.minimal.toFixed(3)} per image
- High price: $${prices.high.toFixed(3)} per image
- Estimated batch cost: $${(inputNames.length * (prices.minimal + prices.high)).toFixed(3)}
- Prompt includes a hard prohibition on all text and pseudo-text.

## Timings

${timingLines.join("\n")}

## Prompt

${prompt}
`;
await fs.writeFile(path.join(outputDirectory, "README.md"), readme);

process.stdout.write(`Contact sheet: ${path.join(outputDirectory, "contact-sheet.jpg")}\n`);
