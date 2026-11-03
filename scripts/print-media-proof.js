import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { createPrintSheet } from "../utils/printUtils.js";

// A calibration proof, independent of the eventual guest-facing strip design.
const outputDirectory = path.resolve(process.argv[2] || "docs");
await fs.mkdir(outputDirectory, { recursive: true });
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "every-print-proof-"));
try {
  const inputPath = path.join(temporaryDirectory, "strip.png");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1800" viewBox="0 0 600 1800">
    <rect width="600" height="1800" fill="white"/>
    <rect x="30" y="30" width="540" height="1740" fill="none" stroke="#aaa" stroke-width="2" stroke-dasharray="8 8"/>
    <g font-family="Arial,sans-serif" text-anchor="middle" fill="#121212">
      <text x="300" y="100" font-size="30" font-weight="bold">EVERY / PRINT PROOF</text>
      <text x="300" y="148" font-size="24">DNP QW410 · 2 × 6 inch strip</text>
      <text x="300" y="188" font-size="20">600 × 1800 pixels · 300 DPI</text>
      <rect x="60" y="260" width="480" height="480" fill="#9ce5f5" stroke="#121212" stroke-width="3"/>
      <circle cx="300" cy="500" r="180" fill="none" stroke="#121212" stroke-width="3"/>
      <text x="300" y="800" font-size="24">Square image geometry</text>
      <text x="300" y="840" font-size="20">Circle should stay round</text>
      <text x="300" y="950" font-size="24">30 px / 0.1 inch safety margin</text>
      <text x="300" y="990" font-size="20">Dashed border should remain visible</text>
      <rect x="60" y="1080" width="120" height="150" fill="#121212"/>
      <rect x="180" y="1080" width="120" height="150" fill="#9ce5f5"/>
      <rect x="300" y="1080" width="120" height="150" fill="#ff7765"/>
      <rect x="420" y="1080" width="120" height="150" fill="#fdfaf7" stroke="#ccc"/>
      <text x="300" y="1290" font-size="20">Unadjusted color · gamma 1.0</text>
      <path d="M150 1430h300 M150 1415v30 M450 1415v30" fill="none" stroke="#121212" stroke-width="3"/>
      <text x="300" y="1490" font-size="24">This line should measure 1 inch</text>
      <text x="300" y="1630" font-size="24">Two matching strips per sheet</text>
      <text x="300" y="1672" font-size="20">Perforation between copies</text>
    </g>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(inputPath);
  const result = await createPrintSheet(inputPath, outputDirectory, "qw410-media-proof");
  console.log(result);
} finally { await fs.rm(temporaryDirectory, { recursive: true, force: true }); }
