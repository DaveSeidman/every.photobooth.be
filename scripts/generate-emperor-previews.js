// Explicit operator task: two paid edits, one source upload; never prints.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { config } from "../config.js";
import { createFalEditor } from "../utils/falUtils.js";
import { everyStyleDefinitions, styleTransferPrompt } from "../modes.js";

const frontend = fileURLToPath(new URL("../../every-photobooth-frontend/", import.meta.url));
const source = await sharp(path.join(frontend, "public/test-frames/image1.png")).resize({width:512}).jpeg({quality:85}).toBuffer();
const editor = createFalEditor({credentials:config.falKey, model:config.falModel, timeoutMs:120000});
const url = await editor.upload(source, "couple-original.jpg");
await Promise.all(everyStyleDefinitions.map(async (style) => {
  const output = await editor.edit(url, styleTransferPrompt({mode:"every",styleId:style.id}), {role:`preview-${style.id}`});
  const response = await fetch(output);
  if (!response.ok) throw new Error(`Preview download failed (${response.status})`);
  await sharp(Buffer.from(await response.arrayBuffer())).resize({width:768}).jpeg({quality:94}).toFile(path.join(frontend, `public/style-previews/${style.id}.jpg`));
  console.log(`Saved ${style.id} thumbnail`);
}));
