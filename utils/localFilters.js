import sharp from "sharp";

const filters = {
  "black-white": { label: "Ink & Paper", low: [18, 18, 18], high: [253, 250, 247], screen: true },
  "weights-measures": { label: "Blueprint", low: [14, 35, 66], high: [156, 229, 245], grid: true },
  "digital-twins": { label: "Coral Duotone", low: [28, 20, 38], high: [255, 119, 101], posterize: true },
  "future-of-work": { label: "Electric Halftone", low: [18, 25, 65], high: [156, 229, 245], screen: true },
};
export function localFilterFor(styleId = "black-white") {
  const key = styleId.replace(/^every-/, "").replace(/-v\d+$/, "");
  return { key: filters[key] ? key : "black-white", ...(filters[key] || filters["black-white"]) };
}
export async function createLocalPortrait(sourceBuffer, styleId) {
  const filter = localFilterFor(styleId);
  const { data, info } = await sharp(sourceBuffer).rotate().resize({ width: 1024, withoutEnlargement: true }).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const pixels = Buffer.alloc(info.width * info.height * 3);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const p = (y * info.width + x) * 3;
    let tone = Math.max(0, Math.min(1, ((data[p] * .2126 + data[p + 1] * .7152 + data[p + 2] * .0722) / 255 - .5) * 1.22 + .5));
    if (filter.screen) {
      const radius = ((x % 6 - 2.5) ** 2 + (y % 6 - 2.5) ** 2) / 12.5;
      tone = tone * .68 + (radius > 1 - tone ? 1 : 0) * .32;
    }
    if (filter.posterize) tone = Math.round(tone * 6) / 6;
    if (filter.grid && (x % 64 === 0 || y % 64 === 0)) tone = tone * .8 + .2;
    for (let channel = 0; channel < 3; channel++) pixels[p + channel] = Math.round(filter.low[channel] + (filter.high[channel] - filter.low[channel]) * tone);
  }
  return { buffer: await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toBuffer(), label: `${filter.label} · Classic`, generationMode: "local", styleProfile: `local-${filter.key}` };
}
