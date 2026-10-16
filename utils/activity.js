import fs from "node:fs";
import path from "node:path";

export function createActivityStore(photoDirectory, { timezone = "America/New_York", now = () => new Date() } = {}) {
  const file = path.join(photoDirectory, ".activity.json");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const jobs = new Map(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).map((job) => [job.id, job]) : []);
  const persist = () => {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify([...jobs.values()]));
    fs.renameSync(`${file}.tmp`, file);
  };
  for (const job of jobs.values()) {
    if (job.status === "processing") {
      job.status = "interrupted";
      job.finishedAt = now().toISOString();
    }
  }
  // Import existing app-generated outputs once; source and print copies are excluded.
  for (const name of fs.readdirSync(photoDirectory)) {
    const match = /^(\d{13})-([a-f0-9]+)\.jpg$/.exec(name);
    if (!match) continue;
    const id = name.slice(0, -4);
    if (jobs.has(id)) continue;
    const finishedAt = fs.statSync(path.join(photoDirectory, name)).mtime.toISOString();
    jobs.set(id, { id, status: "completed", finishedAt, imported: true });
  }
  persist();

  return {
    start(id, style) {
      jobs.set(id, { id, style, status: "processing", startedAt: now().toISOString() });
      persist();
    },
    finish(id, status) {
      Object.assign(jobs.get(id), { status, finishedAt: now().toISOString() });
      persist();
    },
    snapshot() {
      const current = now();
      const today = day.format(current);
      const all = [...jobs.values()];
      const count = (status, daily = false) => all.filter((job) => job.status === status && (!daily || day.format(new Date(job.finishedAt)) === today)).length;
      return {
        updatedAt: current.toISOString(), timezone, today,
        completed: { total: count("completed"), today: count("completed", true) },
        failed: { total: count("failed"), today: count("failed", true) },
        interrupted: count("interrupted"),
        processing: all.filter((job) => job.status === "processing"),
        recent: all.sort((a, b) => (b.startedAt || b.finishedAt).localeCompare(a.startedAt || a.finishedAt)).slice(0, 12),
      };
    },
  };
}
