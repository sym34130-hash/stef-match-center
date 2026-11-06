export const MAX_AGENCY_CODE_LENGTH = 64;
export const MAX_ACCESS_CODE_LENGTH = 512;

export function boundedAuthText(value, limit) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  return text.length <= limit ? text.trim() : null;
}

export function authAttemptKey(ip, agencyCode) {
  const address = boundedAuthText(ip, 64)?.toLowerCase() || "invalid-ip";
  const code = boundedAuthText(agencyCode, MAX_AGENCY_CODE_LENGTH);
  return `${address}:${code === null ? "invalid-code" : code.toUpperCase() || "unknown"}`;
}

export function createAuthAttemptLimiter({ windowMs = 15 * 60_000, maxAttempts = 20, maxEntries = 10_000, now = Date.now } = {}) {
  const entries = new Map();
  let overflow = null;
  let nextSweep = 0;

  function prune() {
    const time = now();
    if (time >= nextSweep) {
      for (const [key, entry] of entries) if (entry.resetAt <= time) entries.delete(key);
      nextSweep = time + Math.min(windowMs, 60_000);
    }
    if (overflow?.resetAt <= time) overflow = null;
    return time;
  }

  function current(key, time) {
    const entry = entries.get(key);
    if (entry && entry.resetAt <= time) { entries.delete(key); return null; }
    return entry;
  }

  return {
    isLimited(key) {
      const time = prune();
      const entry = current(key, time) ?? (entries.size >= maxEntries ? overflow : null);
      return (entry?.count ?? 0) >= maxAttempts;
    },
    register(key) {
      const time = prune();
      const entry = current(key, time);
      if (entry) { entry.count++; return; }
      if (entries.size < maxEntries) {
        entries.set(key, { count: 1, resetAt: time + windowMs });
        return;
      }
      // Do not evict active counters: rotating keys must not reset an existing block.
      if (!overflow) overflow = { count: 0, resetAt: time + windowMs };
      overflow.count++;
    },
    clear(key) { prune(); entries.delete(key); },
    get size() { prune(); return entries.size; },
  };
}
