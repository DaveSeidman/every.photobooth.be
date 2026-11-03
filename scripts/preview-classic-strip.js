import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { createClassicStrip } from "../utils/stripLayout.js";

const backend = fileURLToPath(new URL("../", import.meta.url));
const frontend = path.resolve(backend, "../every-photobooth-frontend/public");
const directory = path.join(backend, "docs");
await fs.mkdir(directory, { recursive: true });
// Local sample artwork only: this command never calls an image model or printer.
const originalPath = path.join(directory, "strip-proof-original.jpg");
await sharp(path.join(frontend, "style-previews/black-white.jpg")).grayscale().jpeg().toFile(originalPath);
console.log(await createClassicStrip({
  originalPath,
  selectedPath: path.join(frontend, "style-previews/black-white.jpg"),
  alternatePath: path.join(frontend, "style-previews/future-of-work.jpg"),
  outputDirectory: directory, photoId: "classic-strip-proof", selectedLabel: "Black & White", alternateLabel: "Future of Work",
  date: process.argv[2] || "", location: "in Brooklyn",
}));
