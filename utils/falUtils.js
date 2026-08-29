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
        image_urls: Array.isArray(imageUrl) ? imageUrl : [imageUrl],
        num_images: 1,
        output_format: "jpeg",
      },
      logs: false,
    });
    const outputUrl = extractFirstImageUrl(result);
    if (!outputUrl) throw new Error("The image model returned no output URL.");
    return outputUrl;
  };

  const createVariantsFromSourceUrls = async (sourceUrls, variantAPrompt, variantBPrompt) => {
    const [variantAUrl, variantBUrl] = await Promise.all([
      edit(sourceUrls, variantAPrompt),
      edit(sourceUrls, variantBPrompt),
    ]);
    return { sourceUrl: sourceUrls[0], variantAUrl, variantBUrl };
  };

  return {
    upload,
    async createVariants(buffer, filename, variantAPrompt, variantBPrompt, additionalImageUrls = []) {
      const sourceUrl = await upload(buffer, filename);
      return createVariantsFromSourceUrls([sourceUrl, ...additionalImageUrls.filter(Boolean)], variantAPrompt, variantBPrompt);
    },
    createVariantsFromSourceUrls,
    edit,
  };
}
