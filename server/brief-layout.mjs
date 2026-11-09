export const BRIEF_LAYOUT_VERSION = 2;
export const BRIEF_TEXT_LIMITS = { attack: 1502, midfield: 3005, defense: 1502 };
export const BRIEF_CAPTURE_LIMITS = { attack: 12, midfield: 24, defense: 12 };

export const BRIEF_INDICATOR_IDS = ["performance", "injuries", "tonnage", "positions", "arrival", "departure", "destination", "temperature"];

export function normalizeBriefIndicators(value) {
  if (!Array.isArray(value)) return [...BRIEF_INDICATOR_IDS];
  const chosen = new Set(value.filter((item) => typeof item === "string"));
  const selected = BRIEF_INDICATOR_IDS.filter((id) => chosen.has(id));
  // A blank or malformed selection never leaves the carousel empty.
  return selected.length > 0 ? selected : [...BRIEF_INDICATOR_IDS];
}

export function normalizeTonnageActivity(value) {
  return value === "distribution" || value === "expedition" ? value : "auto";
}

// Crossing midnight (or starting before 08:00) is treated as an operating
// night for display only. Managers can override this in the day's brief.
export function resolveTonnageActivity(value, start, end) {
  const selected = normalizeTonnageActivity(value);
  if (selected !== "auto") return selected;
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (typeof start !== "string" || typeof end !== "string" || !valid.test(start) || !valid.test(end)) return "expedition";
  return end < start || Number(start.slice(0, 2)) < 8 ? "distribution" : "expedition";
}

function lines(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function captures(value) {
  return Array.isArray(value) ? lines(value) : typeof value === "string" && value ? [value] : [];
}

export function migrateBriefLayout(plan) {
  const input = plan && typeof plan === "object" ? plan : {};
  const legacy = !(Number(input.briefLayoutVersion) >= BRIEF_LAYOUT_VERSION);
  const midfield = lines(input.midfield);
  const defense = lines(input.defense);
  const midfieldCaptures = captures(input.attachments?.midfield);
  const defenseCaptures = captures(input.attachments?.defense);
  return {
    ...input,
    briefLayoutVersion: BRIEF_LAYOUT_VERSION,
    attack: lines(input.attack),
    // Preserve every historical entry, including all six legacy text slots.
    midfield: legacy ? [...midfield, ...defense] : midfield,
    defense: legacy ? [] : defense,
    attachments: {
      attack: captures(input.attachments?.attack),
      midfield: legacy ? [...midfieldCaptures, ...defenseCaptures] : midfieldCaptures,
      defense: legacy ? [] : defenseCaptures,
    },
  };
}
