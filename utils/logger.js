export function logEvent(event, details = {}, level = "info") {
  const record = { timestamp: new Date().toISOString(), event, level, ...details };
  (level === "error" ? console.error : console.log)(JSON.stringify(record));
}
