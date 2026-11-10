export const BRIEF_LAYOUT_VERSION = 2;
export const BRIEF_TEXT_LIMITS = { attack: 1502, midfield: 3005, defense: 1502 };
export const BRIEF_CAPTURE_LIMITS = { attack: 12, midfield: 24, defense: 12 };

export const BRIEF_INDICATOR_SELECTION_VERSION = 2;

export const BRIEF_INDICATOR_IDS = ["performance", "injuries", "accident-free-days", "tonnage-distribution", "tonnage-expedition", "positions", "arrival", "departure", "destination", "temperature"];

export function normalizeBriefIndicators(value, selectionVersion = BRIEF_INDICATOR_SELECTION_VERSION) {
  if (!Array.isArray(value)) return [...BRIEF_INDICATOR_IDS];
  const chosen = new Set(value.filter((item) => typeof item === "string"));
  // The previous Lot A draft stored a single "tonnage" preference.
  // Preserve its meaning: included -> show both; excluded -> show neither.
  if (chosen.has("tonnage")) {
    chosen.add("tonnage-distribution");
    chosen.add("tonnage-expedition");
  }
  // Historical selections predate this card. Preserve every prior choice while
  // displaying the new safety counter by default exactly once.
  // Versioned selections must honour an explicit decision to hide it.
  if (!(Number(selectionVersion) >= BRIEF_INDICATOR_SELECTION_VERSION)) {
    chosen.add("accident-free-days");
  }
  const selected = BRIEF_INDICATOR_IDS.filter((id) => chosen.has(id));
  // A blank or malformed selection never leaves the carousel empty.
  return selected.length > 0 ? selected : [...BRIEF_INDICATOR_IDS];
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
