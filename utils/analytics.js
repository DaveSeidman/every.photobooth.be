import fs from 'node:fs';
import path from 'node:path';

export const ANALYTICS_EVENTS = new Set(['booth_view','booth_start','photo_captured','photo_retake','photo_approved','generation_start','generation_complete','generation_error','takeaway_view','portrait_loaded','share_start','share_complete','download_started','share_cancelled','share_error']);
export function createAnalyticsStore(directory) {
  const file = path.join(directory, '.analytics.json');
  let state = { since: new Date().toISOString(), counts: { live: {}, test: {} }, recent: [], seen: [] };
  if (fs.existsSync(file)) state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seen = new Set(state.seen);
  return {
    record(events) {
      if (!Array.isArray(events) || events.length > 30 || events.some(event => !event || !ANALYTICS_EVENTS.has(event.name) || typeof event.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(event.id) || !['live','test'].includes(event.environment) || !['booth','takeaway'].includes(event.site))) return false;
      for (const event of events) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        const clean = { name: event.name, site: event.site, environment: event.environment, at: new Date().toISOString() };
        if (['emperor-cyan','emperor-ink','custom'].includes(event.style)) clean.style = event.style;
        if (['ai','local'].includes(event.mode)) clean.mode = event.mode;
        if (Number.isFinite(event.durationMs)) clean.durationMs = Math.min(600000, Math.max(0, Math.round(event.durationMs)));
        const counts = state.counts[event.environment];
        counts[event.name] = (counts[event.name] || 0) + 1;
        if (event.name === 'generation_complete' && clean.mode) {
          const outcome = `generation_complete_${clean.mode}`;
          counts[outcome] = (counts[outcome] || 0) + 1;
        }
        state.recent.unshift(clean);
      }
      state.recent = state.recent.slice(0, 40);
      state.seen = [...seen].slice(-10000);
      seen.clear(); state.seen.forEach(id => seen.add(id));
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
      fs.renameSync(`${file}.tmp`, file);
      return true;
    },
    snapshot() { return { since: state.since, counts: state.counts, recent: state.recent }; },
  };
}
