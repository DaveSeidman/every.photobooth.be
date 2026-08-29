const sessions = new Map();

const normalizeSessionId = (value) => {
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "local-booth";
};

export function getSession(sessionId) {
  const id = normalizeSessionId(sessionId);
  if (!sessions.has(id)) sessions.set(id, { id, masterUrl: null, count: 0, oracleContext: {} });
  return sessions.get(id);
}

export function updateSession(sessionId, patch) {
  const session = getSession(sessionId);
  Object.assign(session, patch);
  return session;
}

export function resetSession(sessionId) {
  const id = normalizeSessionId(sessionId);
  sessions.delete(id);
  return { id, count: 0, masterUrl: null };
}

export function sessionSummary(sessionId) {
  const session = getSession(sessionId);
  return { id: session.id, count: session.count, hasMemory: Boolean(session.masterUrl) };
}
