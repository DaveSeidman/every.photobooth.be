const safeText = (value, max = 80) => typeof value === "string" ? value.trim().slice(0, max) : "";

export const modeDefinitions = [
  {
    id: "thesis.editorial",
    label: "Thesis editorial",
    description: "Blue/coral screenprinted portrait studies.",
    color: "#2B83EE",
    developerOnly: false,
  },
  {
    id: "every.one.in",
    label: "Every One In",
    description: "A cumulative group portrait that remembers the room.",
    color: "#FF7B70",
    developerOnly: true,
  },
  {
    id: "every.oracle",
    label: "Every Oracle",
    description: "A consent-safe portrait with subtle signals from attendee context.",
    color: "#31C8F5",
    developerOnly: true,
  },
  {
    id: "every.designer",
    label: "Every Designer",
    description: "A guest-adjustable print composition before generation.",
    color: "#FFDE3D",
    developerOnly: true,
  },
  {
    id: "branded.posthog",
    label: "Branded / PostHog",
    description: "A sponsor skin inspired by product analytics and desktop tools.",
    color: "#F59E0B",
    developerOnly: true,
  },
];

export function publicModes() {
  return modeDefinitions;
}

export function normalizeMode(mode) {
  return modeDefinitions.some((candidate) => candidate.id === mode) ? mode : "thesis.editorial";
}

export function sanitizeOracleContext(context = {}) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return {};
  return {
    firstName: safeText(context.firstName, 40),
    city: safeText(context.city, 60),
    industry: safeText(context.industry, 80),
    role: safeText(context.role, 80),
    company: safeText(context.company, 80),
  };
}

export function designerPromptOptions(options = {}) {
  const palettes = new Set(["blue", "coral", "cyan", "gold"]);
  const palette = palettes.has(options.palette) ? options.palette : "blue";
  const numeric = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : fallback;
  return {
    palette,
    brushX: numeric(options.brushX, 50),
    brushY: numeric(options.brushY, 50),
    texture: options.texture === "fine" ? "fine" : "coarse",
  };
}

export function modePrompts({ mode, basePrompts, oracleContext = {}, designerOptions = {}, hasMemory = false }) {
  const oracle = sanitizeOracleContext(oracleContext);
  const designer = designerPromptOptions(designerOptions);
  const oracleClues = [oracle.city, oracle.industry, oracle.role].filter(Boolean).join(", ") || "a thoughtful, future-facing attendee";
  const memoryInstruction = hasMemory
    ? "The SECOND reference image is the existing cumulative group portrait. Keep every existing person in it and add the newest people from the SOURCE IMAGE at the visual center. Re-render everyone together as if they were physically shoulder-to-shoulder in one cramped photobooth: shared light, consistent scale, overlapping shoulders and arms, natural hugs and squeezes, one believable perspective. Never paste rectangular photo panels or make a collage."
    : "The SOURCE IMAGE contains the newest people. Preserve their natural spacing and pose as a group in one believable photobooth scene.";

  if (mode === "every.one.in") {
    const base = `Recreate the SOURCE IMAGE as an Every One In cumulative group portrait. ${memoryInstruction} CRITICAL IDENTITY LOCK: preserve every recognizable face, exact newest-subject expressions, body proportions, and camera framing. Use a tactile editorial screenprint treatment: crisp black-and-white stippled photographic people, saturated coral and electric blue color blocks, rough diagonal ink swashes, coarse newsprint halftone, paper fiber, and imperfect risograph registration. The newest subjects must read as the center of the group and previous people must naturally flank them. No text, logos, watermarks, borders, or floating cutout rectangles.`;
    return { variantA: base, variantB: `${base} Make this alternate take slightly more cyan and yellow while keeping the crowd complete.`, transition: base };
  }

  if (mode === "every.oracle") {
    const base = `Recreate the SOURCE IMAGE as an Every Oracle portrait. Preserve exact framing, crop, camera angle, recognizable faces, poses, and body proportions. Render people as high-contrast black-and-white stippled newspaper cutouts on a single saturated cyan-blue backplate with one rough diagonal brush mark and subtle halftone/riso texture. Add only one or two quiet, symbolic visual motifs inspired by this attendee context: ${oracleClues}. The result should feel like a perceptive art director noticed their world, never like surveillance. Do not show or spell any context, names, companies, logos, readable text, literal UI, or private facts. No watermarks or borders.`;
    return { variantA: base, variantB: `${base} Use a warm coral backplate and a different symbolic motif, keeping it subtle and human.`, transition: base };
  }

  if (mode === "every.designer") {
    const colors = { blue: "electric blue", coral: "warm coral", cyan: "bright cyan", gold: "sunlit yellow" };
    const base = `Recreate the SOURCE IMAGE as a guest-directed Every Designer editorial poster. Keep exact framing, crop, camera angle, recognizable faces, number of people, poses, and body proportions. Use a large flat ${colors[designer.palette]} backplate with a rough diagonal painterly brush swash positioned around ${designer.brushX}% horizontal and ${designer.brushY}% vertical. Render people as high-contrast black-and-white stippled newspaper cutouts with ${designer.texture} halftone, photocopy grain, paper fiber, and slight ink misregistration. Blend classical engraved references with one tasteful hyper-modern object or material, but keep people central and recognizable. No generated text, logos, watermarks, borders, or objects over faces.`;
    return { variantA: base, variantB: `${base} Make the alternate composition use a complementary coral/cyan accent while honoring the guest's placement.`, transition: base };
  }

  if (mode === "branded.posthog") {
    const base = `Recreate the SOURCE IMAGE as a playful PostHog-sponsored product-analytics portrait. Preserve exact framing, crop, camera angle, recognizable faces, number of people, poses, and body proportions. Use a pale sage-green desktop-like field, chunky black-and-white stippled cutout people, orange and warm yellow accent blocks, gentle paper texture, and a few abstract analytics motifs such as event dots, funnels, retention curves, heatmap cells, feature flags, or a tiny friendly hog-like silhouette. Make it feel like an imaginative operating system interface made of paper and ink, not a literal screenshot. Never generate the PostHog logo, brand wordmark, readable UI text, watermark, or objects over faces. Keep the people the hero.`;
    return { variantA: base, variantB: `${base} Use a cobalt-blue accent and a different abstract analytics motif, with the same people and composition.`, transition: base };
  }

  return basePrompts;
}
