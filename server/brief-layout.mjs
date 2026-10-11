export const BRIEF_LAYOUT_VERSION = 2;
export const BRIEF_TEXT_LIMITS = { attack: 1502, midfield: 3005, defense: 1502 };
export const BRIEF_CAPTURE_LIMITS = { attack: 12, midfield: 24, defense: 12 };

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
