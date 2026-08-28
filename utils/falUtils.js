import { File } from "node:buffer";
import { fal } from "@fal-ai/client";

const extractFirstImageUrl = (result) => {
  const images = result?.data?.images;
  if (!Array.isArray(images) || images.length === 0) return null;
  return typeof images[0] === "string" ? images[0] : images[0]?.url ?? null;
};

export function createFalEditor({ credentials, model }) {
  if (credentials) fal.config({ credentials });

  const upload = async (buffer, filename) => {
    if (!credentials) throw new Error("FAL_KEY is not configured.");
    const file = new File([buffer], filename, { type: "image/jpeg" });
    const uploaded = await fal.storage.upload(file);
    const sourceUrl = typeof uploaded === "string" ? uploaded : uploaded?.file?.url;
    if (!sourceUrl) throw new Error("The source image could not be uploaded to FAL.");
    return sourceUrl;
  };

  const edit = async (imageUrl, prompt) => {
    const result = await fal.subscribe(model, {
      input: {
        prompt,
        image_urls: [imageUrl],
        num_images: 1,
        output_format: "jpeg",
      },
      logs: false,
    });
    const outputUrl = extractFirstImageUrl(result);
    if (!outputUrl) throw new Error("The image model returned no output URL.");
    return outputUrl;
  };

  return {
    upload,
    async createVariants(buffer, filename, variantAPrompt, variantBPrompt) {
      const sourceUrl = await upload(buffer, filename);

      const [variantAUrl, variantBUrl] = await Promise.all([
        edit(sourceUrl, variantAPrompt),
        edit(sourceUrl, variantBPrompt),
      ]);
      return { sourceUrl, variantAUrl, variantBUrl };
    },
    edit,
  };
}
