import fs from "node:fs";
import path from "node:path";
import { createLocalPortrait } from "./localFilters.js";
import { logEvent } from "./logger.js";

export function createGenerationFallback({ directory, settings = {}, now = () => performance.now() }) {
  const file = path.join(directory, ".ai-latency.json");
  let samples = [];
  try { if (fs.existsSync(file)) samples = JSON.parse(fs.readFileSync(file, "utf8")).filter((value) => Number.isFinite(value) && value >= 1000).slice(-20); } catch { /* An absent/corrupt timing file must not stop the booth. */ }
  const enabled = settings.enabled !== false;
  function policy() {
    const sorted = samples.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const normalDurationMs = sorted.length >= 3
      ? Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2)
      : Math.max(1, settings.normalDurationMs || 17000);
    return { localFallbackEnabled: enabled, normalDurationMs, fallbackAfterMs: normalDurationMs * 2, sampleCount: samples.length };
  }
  function record(durationMs) {
    if (durationMs < 1000) return;
    samples.push(Math.round(durationMs)); samples = samples.slice(-20);
    try { fs.writeFileSync(`${file}.tmp`, JSON.stringify(samples)); fs.renameSync(`${file}.tmp`, file); } catch (error) { logEvent("generation.timing-save-failed", { message: error.message }, "warn"); }
  }
  return {
    policy,
    async run({ photoId, role, styleId, sourceBuffer, aiTask, startedAt = now(), deadlineMs = policy().fallbackAfterMs, failureSimulation = "none" }) {
      let timer;
      const controller = new AbortController();
      const elapsed = () => Math.round(now() - startedAt);
      const ai = Promise.resolve().then(() => {
        if (failureSimulation === "timeout") return new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
        });
        if (failureSimulation === "offline" || failureSimulation === "error") {
          throw Object.assign(new Error(failureSimulation === "offline" ? "Simulated internet outage: AI service unreachable." : "Simulated AI image generation error."), { code: failureSimulation === "offline" ? "ENETUNREACH" : "SIMULATED_AI_ERROR" });
        }
        return aiTask(controller.signal);
      });
      try {
        const result = (enabled || failureSimulation === "timeout") ? await Promise.race([ai, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error("AI generation exceeded the local fallback deadline."), { code: "AI_DEADLINE" })), Math.max(0, deadlineMs - elapsed()));
        })]) : await ai;
        if (enabled) record(elapsed());
        return { ...result, generationMode: "ai" };
      } catch (error) {
        if (!enabled) throw error;
        controller.abort();
        const reason = error.code === "AI_DEADLINE" ? "timeout" : "error";
        logEvent("generation.local-fallback", { photoId, role, reason, elapsedMs: elapsed(), deadlineMs, message: error.message }, "warn");
        // Only the winner writes files. Late AI results can neither overwrite
        // this portrait nor cause a second sheet or printer submission.
        return { ...await createLocalPortrait(sourceBuffer, styleId), fallbackReason: reason };
      } finally { clearTimeout(timer); }
    },
  };
}
