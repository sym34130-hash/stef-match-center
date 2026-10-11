type Zone = "attack" | "midfield" | "defense";
export const BRIEF_LAYOUT_VERSION: 2;
export const BRIEF_TEXT_LIMITS: Record<Zone, number>;
export const BRIEF_CAPTURE_LIMITS: Record<Zone, number>;
export function migrateBriefLayout(plan: unknown): {
  briefLayoutVersion: 2;
  attack: string[];
  midfield: string[];
  defense: string[];
  attachments: Record<Zone, string[]>;
};
