export const modeDefinitions = [
  {
    id: "every",
    label: "Every",
    description: "One of two Greco-Roman emperor treatments, chosen by the guest.",
    color: "#2B83EE",
    developerOnly: false,
  },
  {
    id: "posthog",
    label: "PostHog",
    description: "PostHog-inspired product-engineering portrait treatment.",
    color: "#F59E0B",
    developerOnly: false,
  },
];

const identityLock = `IMAGE 1 is the only source photograph. Preserve exactly the same number of original human subjects and every person's recognizable identity, exact facial features, facial expression, eye direction, smile, hair, skin tone, and social chemistry. Do not omit, merge, replace, beautify, age, or de-age any original person. Keep every original face unobstructed and unmistakably recognizable.`;

const noText = `NO TEXT: Do not render letters, words, numbers, captions, headlines, logos, watermarks, signatures, labels, signage, interface copy, or decorative pseudo-text anywhere.`;

const noBorder = `EDGE-TO-EDGE ARTWORK: Extend the scene naturally and continuously to all four canvas edges. Do not add a border, frame, mat, inset panel, picture edge, poster outline, decorative perimeter, bounding rectangle, card, vignette, white margin, or colored band around the image.`;

const emperorIdentity = `Transform every person visible in the photobooth photo—whether there are one, two, three, or four people—into a distinct Greco-Roman emperor. Preserve the exact number of people, each person's recognizable face, expression, pose, position, and key physical features. Do not add, remove, duplicate, merge, or obscure anyone. Give each person a sculptural marble body, classical drapery, and an imposing imperial presence, arranging the group as a balanced Greco-Roman imperial portrait.`;

export const everyStyleDefinitions = [
  {
    id: "emperor-cyan",
    label: "Imperial Cyan",
    description: "Marble emperors, punk engraving, and a vivid cyan temple.",
    prompt: `${emperorIdentity}
Render the image as an antique engraving-inspired editorial illustration with a punk screen-print and photocopied-zine aesthetic: bold halftone dots, coarse grain, irregular ink textures, analog noise, deep shadows, and blown-out highlights. Use high-contrast black and white, with a classical temple in vivid cyan rendered as a slightly misregistered duotone print. Create a centered, dramatic composition that adapts naturally to the number of people, with every face clearly visible and a distressed vintage underground-poster finish.`,
  },
  {
    id: "emperor-ink",
    label: "Imperial Ink",
    description: "Marble emperors in a gritty, antique engraving treatment.",
    // The supplied second prompt ends here; keep it verbatim pending its remainder.
    prompt: `${emperorIdentity}
Render the image as an antique engraving-inspired editorial illustration with a punk screen-print and photocopied-zine aesthetic: bold halftone dots, coarse grain, irregular ink textures, analog noise, deep shadows…`,
  },
];

const posthogDirection = `Reimagine every person in IMAGE 1 as one distinct, irresistibly cute hedgehog character in a handcrafted miniature paper diorama. Preserve the exact number of people: create exactly one hedgehog for each person, no more and no fewer. Make each character recognizable through their original pose, hair silhouette, clothing colors, glasses, and relationship to the other people.

IDENTITY DEVICE: Each hedgehog wears a small, glossy, die-cut paper mask printed with that corresponding person's real photographic face from IMAGE 1. Reproduce the person's recognizable facial identity, exact expression, smile, eye direction, facial proportions, skin tone, facial hair, and glasses on the mask with high fidelity. Make the mask unmistakably physical: slightly curved coated paper stock, a crisp white cut edge with visible thickness, bright controlled varnish reflections, and a faint printed halftone or paper fiber texture. Keep the entire mask shape visible against the hedgehog's darker paper spines. Attach some masks with thin string or elastic visibly wrapping around the sides of the hedgehog's head; attach others with two or three tiny, believable pieces of translucent matte Scotch tape at the temples or forehead. Show subtle tape edges and highlights without covering the printed eyes, nose, or mouth. Vary these attachment methods naturally across the group.

Shape each mask neatly around the person's face and keep it frontal enough to recognize immediately. It must read as a deliberate printed paper face mask worn by a cute cardboard hedgehog—not a human head grafted onto an animal, exposed human skin, a flat floating photo rectangle, a framed portrait, or a horror mask. Give every hedgehog exactly one mask belonging to the correct person; never swap, blend, duplicate, or invent faces.

Build a unified low-poly world from colored cardboard, folded construction paper, cut paper, and tiny hand-crafted materials. The entire floor must be a broad, gently textured pale-sage paper meadow extending to every edge and far into the background. Populate the meadow with many scattered clusters of individually folded paper grass blades: narrow angular strips creased up from the ground, in varied heights and several related sage and olive tones. Distribute the grass organically across foreground, middle distance, and background, with denser patches around the hedgehogs and ample quiet space between clusters. Each blade should cast a tiny directional shadow so the field clearly reads as handcrafted dimensional paper, matching an elegant tabletop diorama rather than real turf or a flat printed grass texture.

Add soft directional sunlight, long gentle shadows, a few restrained garden beds, wooden crates, translucent paper water, and chunky geometric blocks. Let the hedgehogs play, garden, explore, share food, or collaborate around one whimsical product-research object. The visual language is warm, cutesy, tactile, restrained, and premium: visible folded facets, paper fibers, beveled cardboard edges, miniature scale, and soft studio lighting.

Compose the group together near the center and keep every hedgehog fully visible. Leave useful calm negative space around the group. Avoid photoreal humans, plush toys, plastic figurines, generic woodland illustration, a website screenshot, UI windows, readable text, logos, extra animals, duplicated characters, borders, frames, collages, gradients, or a busy background. ${noText}`;

const everyStyleById = new Map(everyStyleDefinitions.map((style) => [style.id, style]));

export function publicModes() {
  return modeDefinitions;
}

export function publicEveryStyles() {
  return everyStyleDefinitions.map(({ id, label, description }) => ({ id, label, description }));
}

export function normalizeMode(mode) {
  return modeDefinitions.some((candidate) => candidate.id === mode) ? mode : "every";
}

function selectEveryStyle(styleId) {
  if (styleId && everyStyleById.has(styleId)) return everyStyleById.get(styleId);
  return everyStyleDefinitions[Math.floor(Math.random() * everyStyleDefinitions.length)];
}

export function styleTransferSpec({ mode, styleId } = {}) {
  const normalizedMode = normalizeMode(mode);
  if (normalizedMode === "posthog") {
    return {
      id: "posthog-paper-mask-hedgehogs-v4",
      label: "Paper Hedgehog World",
      prompt: `${posthogDirection}\n\n${noBorder}\n\nReturn one unified finished landscape-oriented paper-diorama image.`,
    };
  }

  const style = selectEveryStyle(styleId);
  return {
    id: `every-${style.id}-v3`,
    label: style.label,
    prompt: `${identityLock}\n\n${style.prompt}\n\n${noBorder}\n\nReturn one unified finished editorial image, not a before-and-after layout or a sheet of alternatives. Preserve each original person's identity first; apply only this named art direction second.`,
  };
}

export function styleTransferPrompt(options) {
  return styleTransferSpec(options).prompt;
}
