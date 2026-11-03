import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createPrintSheet } from "./printUtils.js";

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
const frameY = [30, 540, 1050];
export const stripGeometry = { width: 600, height: 1800, imageSize: 444, imageLeft: 78, imageTops: [46, 556, 1066], safeInset: 30 };

export function conferenceDateLabel(date) {
  if (!date) return "DATE TO BE CONFIRMED";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Conference date must be a valid YYYY-MM-DD date.");
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export async function createClassicStrip({ originalPath, selectedPath, alternatePath, outputDirectory, photoId, selectedLabel, alternateLabel, date = "", location = "in Brooklyn" }) {
  const labels = ["Original", selectedLabel, alternateLabel];
  // Rounded ticket stock with one tear-off divider above the conference footer.
  const backdrop = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1800">
    <rect width="600" height="1800" fill="#121212"/>
    <rect x="30" y="24" width="540" height="1752" rx="22" fill="#fdfaf7"/>
    <path d="M52 1568 H548" stroke="#c9c8c4" stroke-width="2" stroke-dasharray="8 8"/>
    <g fill="#121212"><circle cx="30" cy="1568" r="15"/><circle cx="570" cy="1568" r="15"/></g>
    <g fill="#121212" font-family="monospace" font-size="20">${labels.map((label, i) => `<text x="74" y="${frameY[i] + 487}">${escape(`${String(i + 1).padStart(2, "0")} / ${label || "Every portrait"}`)}</text>`).join("")}</g>
    <g text-anchor="middle" fill="#121212" font-family="monospace">
      <text x="300" y="1700" font-size="22">${escape(conferenceDateLabel(date).toUpperCase())}</text>
      <text x="300" y="1736" font-size="23" fill="#121212">${escape(location)}</text>
    </g>
  </svg>`);
  const layers = await Promise.all([originalPath, selectedPath, alternatePath].map(async (filename, index) => ({
    input: await sharp(filename).rotate().resize(444, 444, { fit: "cover", position: "centre" }).ensureAlpha()
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="444" height="444"><rect width="444" height="444" rx="10" fill="white"/></svg>'), blend: "dest-in" }]).png().toBuffer(),
    left: 78, top: stripGeometry.imageTops[index],
  })));
  const logo = await sharp(Buffer.from((await fs.readFile(new URL("../assets/thesis/logo.svg", import.meta.url), "utf8")).replaceAll("#FFFAF4", "#121212"))).resize({ width: 340 }).png().toBuffer();
  layers.push({ input: logo, left: 130, top: 1600 });
  const stripPath = path.join(outputDirectory, `${photoId}-strip.png`);
  await sharp(backdrop).composite(layers).png().toFile(stripPath);
  return { stripPath, sheetPath: await createPrintSheet(stripPath, outputDirectory, photoId), dateConfirmed: Boolean(date) };
}
