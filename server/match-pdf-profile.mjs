import { BRIEF_INDICATOR_IDS } from "./brief-layout.mjs";

export const PDF_CHART_IDS = Object.freeze([
  "passes-hourly", "reception-time", "loading", "centers", "operational-diagnostic",
]);
export const PDF_BRIEF_FIELDS = Object.freeze([
  "safety", "priorities", "attack", "midfield", "defense", "decisions",
]);
const DEFAULT_KPIS = ["performance", "accident-free-days", "positions", "arrival"];
const BRIEF_LIMITS = Object.freeze({
  safety: 260, priorities: 260, attack: 240, midfield: 240,
  defense: 240, decisions: 330,
});

export function defaultPdfProfile() {
  return {
    version: 1,
    indicatorIds: [...DEFAULT_KPIS],
    chartId: "passes-hourly",
    dailyBrief: { matchDate: "", ...Object.fromEntries(PDF_BRIEF_FIELDS.map(key => [key, ""])) },
  };
}

/** Validate writes without silently accepting extra KPI selections or unknown charts.
 * The saved configuration is agency-wide; the short printed brief is date-scoped. */
export function normalizePdfProfile(value, { strict = false } = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallback = defaultPdfProfile();
  const source = input.indicatorIds === undefined ? fallback.indicatorIds : input.indicatorIds;
  if (!Array.isArray(source) || source.some(id => typeof id !== "string" || !BRIEF_INDICATOR_IDS.includes(id))) {
    throw new TypeError("La sélection des KPI du PDF est invalide.");
  }
  if (strict && (source.length > 4 || new Set(source).size !== source.length)) {
    throw new TypeError("Sélectionne au maximum 4 KPI complémentaires distincts.");
  }
  const indicatorIds = [...new Set(source)].slice(0, 4);
  const chartId = input.chartId === undefined ? fallback.chartId : input.chartId;
  if (!PDF_CHART_IDS.includes(chartId)) throw new TypeError("Le graphique du PDF est inconnu.");
  const originalBrief = input.dailyBrief ?? {};
  if (!originalBrief || typeof originalBrief !== "object" || Array.isArray(originalBrief)) {
    throw new TypeError("La synthèse du brief est invalide.");
  }
  const matchDate = originalBrief.matchDate ?? "";
  if (typeof matchDate !== "string" || (matchDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(matchDate))) {
    throw new TypeError("La date du brief est invalide.");
  }
  const dailyBrief = { matchDate };
  for (const field of PDF_BRIEF_FIELDS) {
    const value = originalBrief[field] ?? "";
    if (typeof value !== "string" || value.length > BRIEF_LIMITS[field]) {
      throw new TypeError("La synthèse " + field + " est trop longue ou invalide.");
    }
    dailyBrief[field] = value.trim();
  }
  return { version: 1, indicatorIds, chartId, dailyBrief };
}

export function effectivePdfProfile(value, visibleIndicators, matchDate) {
  const profile = normalizePdfProfile(value);
  const available = new Set(Array.isArray(visibleIndicators) ? visibleIndicators : BRIEF_INDICATOR_IDS);
  return {
    ...profile,
    indicatorIds: profile.indicatorIds.filter(id => available.has(id)),
    dailyBrief: profile.dailyBrief.matchDate === matchDate
      ? profile.dailyBrief
      : { matchDate, ...Object.fromEntries(PDF_BRIEF_FIELDS.map(key => [key, ""])) },
  };
}
