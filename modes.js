export const modeDefinitions = [
  {
    id: "every",
    label: "Every",
    description: "One of four focused Every editorial treatments, chosen by the guest.",
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

const compositionLock = `LOCK THE SOURCE COMPOSITION. Keep every original person's head size, body size, anatomy, body proportions, pose, silhouette, position in the frame, spacing, overlaps, relative scale, camera angle, perspective, and crop unchanged. Keep each face, head, shoulder, torso, hand, and limb at the same coordinates as IMAGE 1. Do not zoom, reframe, rotate, widen, compress, rearrange, or reposition the original subjects. Apply the treatment around and across this fixed photographic registration.`;

const noText = `NO TEXT: Do not render letters, words, numbers, captions, headlines, logos, watermarks, signatures, labels, signage, interface copy, or decorative pseudo-text anywhere.`;

const noBorder = `EDGE-TO-EDGE ARTWORK: Extend the scene naturally and continuously to all four canvas edges. Do not add a border, frame, mat, inset panel, picture edge, poster outline, decorative perimeter, bounding rectangle, card, vignette, white margin, or colored band around the image.`;

export const blackWhiteBackgroundColors = [
  "saturated mustard yellow",
  "electric ultramarine blue",
  "deep royal violet",
  "pale mint green",
  "warm coral",
  "soft lavender",
  "bright cyan",
  "warm cream",
];

export const everyStyleDefinitions = [
  {
    id: "weights-measures",
    label: "Weights & Measures",
    description: "Your portrait mapped with architectural lines, proportion, and precision.",
    prompt: `${compositionLock}

Turn the fixed portrait into a disciplined editorial study of human proportion, measurement, and constructed intelligence. Keep the people dominant and precisely registered while integrating a coherent graphic system of rulers, measuring tapes, protractors, drafting compasses, plumb lines, surveyor sight-lines, vanishing points, Cartesian x/y/z axes, perspective grids, dimension arrows, crop marks, architectural blueprint fragments, Vitruvian circles, proportional divisions, and restrained radial geometry.

Every measuring element must be a flat two-dimensional drafting overlay made from fine ink lines, translucent blueprint lines, ticks, arcs, and registration marks. Never render a photorealistic ruler, physical protractor, wooden measuring stick, metal tool, cast shadow, hand-held instrument, or three-dimensional measuring object. Make the overlays visibly respond to the portrait: align baselines to shoulders and eye-lines, center arcs around heads or joints, extend sight-lines along gaze direction, locate axes in the scene's perspective, bracket the group's width and height, and let proportional grids follow the existing spatial relationships without covering faces.

Use a limited two-to-four-color spot palette with one flat solid backplate: cobalt, electric blue, deep violet, mustard, warm cream, coral, or newsprint gray. Render the people as crisp high-contrast photographic engravings with stippling, fine crosshatching, halftone dots, paper grain, and subtle ink misregistration. Geometry must feel intentional, sparse, and precise—not like a fake scientific infographic or a collection of unrelated decorations. Use three or four strong overlay systems at varied scales rather than filling every space. Tiny indecipherable drafting annotations and micro-label marks are allowed, but no readable language, equations, fake data, UI panels, charts, logos, or headlines.`,
  },
  {
    id: "digital-twins",
    label: "Digital Twins",
    description: "Meet the android counterpart built from your pose and personality.",
    prompt: `The composition may change for this treatment, but preserve every original human as a clearly identifiable human with their original face and expression. Add exactly one android twin for each original person—no more and no fewer. Each android should visibly echo its corresponding person's face, hair silhouette, pose language, or clothing shapes while remaining unmistakably robotic. Do not replace a person with a robot.

Create a warm, surprising interaction between each person and their twin: high-fiving, mirroring a gesture, collaborating over an object, exchanging a tool, finishing one another's task, or looking together at one impossible artifact. Arrange all humans and android twins as one coherent scene with believable eye-lines, scale, contact, hands, lighting, and occlusion.

Use an Every editorial language: one flat saturated backplate, high-contrast black-and-white copperplate engraving and stippling, tactile paper grain, clean cut-paper edges, and one or two spot colors. Blend classical and futuristic cues through restrained gardens, sculptural drapery, marble fragments, a glowing geometric object, an archive table, or monumental architecture. Choose one interaction and one setting; do not create a crowded robot showroom, a split screen, panels, duplicated human faces, or a generic sci-fi laboratory. ${noText}`,
  },
  {
    id: "future-of-work",
    label: "Future of Work",
    description: "Wear the strange, tactile interfaces of work after automation.",
    prompt: `${compositionLock}

Transform the fixed portrait into a focused editorial vision of people working through intelligent machines. Integrate a small number of plausible near-future interfaces directly with the existing poses: elegant VR or spatial-computing visors, noninvasive fMRI-inspired headsets, brain-computer-interface sensors, articulated robotic assistance, bionic or exoskeletal limb overlays, haptic gloves, neural bands, transparent optical instruments, or a single luminous computational artifact. Select only two or three technologies that make sense with the photographed people; do not attach every device.

The technology should feel tactile, credible, and wondrous—not dystopian, medical, militarized, or like generic cyberpunk. Keep all original human faces and expressions fully visible; never cover the eyes unless a visor is the singular central concept, and never amputate or replace an original limb. Use a bold flat backplate with no gradients, black-and-white stippled engraving and newspaper halftone for people and machines, a limited spot palette, and elegant orbital sight-lines or wave fields. Combine one classical humanist element with one advanced technology. Avoid gears, random cables, fake control panels, dashboards, diagrams, and meaningless technical clutter. ${noText}`,
  },
  {
    id: "black-white",
    label: "Black & White",
    description: "Become a hand-engraved portrait against a vivid field of color.",
    prompt: `${compositionLock}

Fully redraw every person as a beautifully observed black-and-white engraved illustration while preserving their exact likeness and expression. The foreground transformation must be unmistakable at first glance: replace all continuous-tone photographic skin, hair, and clothing with clearly visible nineteenth-century copperplate linework, banknote engraving, dense stippling, directional hatching, crosshatching, pointillist dots, and newspaper halftone. Add the tactile character of fine pen-and-ink contour drawing, drypoint etching, scratchboard, and lithographic pencil marks. Let different mark-making methods describe different surfaces: stippling across skin, flowing pen hatches through hair, crosshatching in fabric shadows, and scratchboard-white accents along highlights. Use deep solid blacks, clean paper-white highlights, crisp etched contours, varied hatch direction, and visible dot structure. Do not merely desaturate, grayscale, posterize, or apply a weak monochrome filter to the original photograph. No smooth photographic shading may remain on the people.

Keep eyes, teeth, hair texture, skin contours, clothing folds, and distinctive facial details sharp and recognizable. The engraved marks should follow facial planes, hair flow, fabric folds, and body volume rather than sit on top as a uniform texture. Avoid waxy faces, smudged shading, soft gray blur, low-contrast pencil drawing, vector-cartoon simplification, or a grayscale photograph with faint dots.

Replace the background with exactly this assigned color: {{BACKGROUND_COLOR}}. Make it a simple, unmistakably flat solid field with no gradient and do not substitute blue unless blue is the assigned color. Add at most one quiet background motif selected to fit the portrait: dark cypress silhouettes, a clipped garden, a classical colonnade, an abacus-like pattern, butterflies, distant modernist architecture, or sparse botanical silhouettes. Keep the motif secondary and graphic; it must not form a border. Do not add diagrams, measuring devices, robots, togas, headsets, cables, collage panels, or visual clutter. ${noText}`,
  },
];

const posthogDirection = `${compositionLock}

Transform the portrait into a playful product-engineering editorial image inspired by an operating-system desktop built from paper and ink. Use a warm cream or pale sage flat field, thick black outlines, orange and yellow spot colors, subtle halftone texture, chunky window geometry, event dots, funnels, heatmap cells, feature flags, charts, cables, and one mischievous hog-like silhouette. Invent a single surreal metaphor about observing, testing, or shipping a product. Keep the people dominant and integrated into the scene. Do not create a literal website screenshot or a PostHog logo. ${noText}`;

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

function resolveStylePrompt(style, palette) {
  if (style.id !== "black-white") return style.prompt;
  const selectedPalette = blackWhiteBackgroundColors.includes(palette)
    ? palette
    : blackWhiteBackgroundColors[Math.floor(Math.random() * blackWhiteBackgroundColors.length)];
  return style.prompt.replace("{{BACKGROUND_COLOR}}", selectedPalette);
}

export function styleTransferSpec({ mode, styleId, palette } = {}) {
  const normalizedMode = normalizeMode(mode);
  if (normalizedMode === "posthog") {
    return {
      id: "posthog-editorial-v1",
      label: "PostHog",
      prompt: `${identityLock}\n\n${posthogDirection}\n\nReturn one unified finished editorial image. Preserve the people first; apply the art direction second.`,
    };
  }

  const style = selectEveryStyle(styleId);
  return {
    id: `every-${style.id}-v3`,
    label: style.label,
    prompt: `${identityLock}\n\n${resolveStylePrompt(style, palette)}\n\n${noBorder}\n\nReturn one unified finished editorial image, not a before-and-after layout or a sheet of alternatives. Preserve each original person's identity first; apply only this named art direction second.`,
  };
}

export function styleTransferPrompt(options) {
  return styleTransferSpec(options).prompt;
}
