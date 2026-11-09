/** Lot D1 — read-only KPI selection simulator.
 * The four-KPI official score remains the unchanged, comparable reference.
 * Never persist a simulated scenario as a match result. */
export const SCORE_INDICATORS = [
  { id: "passRate", label: "Passes réussies" },
  { id: "loadingPercent", label: "Tirs cadrés (chargement)" },
  { id: "unloadingPercent", label: "Duels gagnés (réception)" },
  { id: "possessionPercent", label: "Possession" },
] as const;

export type ScoreIndicatorId = typeof SCORE_INDICATORS[number]["id"];

/** Activity configuration is explicit, never inferred from a blank day's Excel. */
export type ScoreActivityProfile = "with-zoning" | "without-zoning";
export const COMMON_SCORE_INDICATORS: readonly ScoreIndicatorId[] =
  ["loadingPercent", "unloadingPercent"] as const;

export function eligibleScoreIndicatorIds(profile: ScoreActivityProfile): ScoreIndicatorId[] {
  if (profile === "without-zoning") return [...COMMON_SCORE_INDICATORS];
  return SCORE_INDICATORS.map((item) => item.id);
}
export type ScoreIndicatorValues = Partial<Record<ScoreIndicatorId, number | null | undefined>>;

export type ScoreSimulationResult =
  | { status: "available"; selected: ScoreIndicatorId[]; reached: number; missed: number; ratioPercent: number; unavailable: [] }
  | { status: "unavailable"; selected: ScoreIndicatorId[]; reached: null; missed: null; ratioPercent: null; unavailable: ScoreIndicatorId[] };

export function simulateScoreSelection(
  values: ScoreIndicatorValues | undefined,
  targetPercent: number,
  selection: readonly string[],
): ScoreSimulationResult {
  const known = new Set<string>(SCORE_INDICATORS.map((entry) => entry.id));
  // Reject, rather than silently discard, invalid/duplicate metric selections.
  if (!Array.isArray(selection) || !selection.length
      || selection.some((id) => typeof id !== "string" || !known.has(id))
      || new Set(selection).size !== selection.length
      || !Number.isFinite(targetPercent) || targetPercent < 1 || targetPercent > 100) {
    return { status: "unavailable", selected: [], reached: null, missed: null, ratioPercent: null, unavailable: [] };
  }

  const selected = SCORE_INDICATORS.map((item) => item.id).filter((id) => selection.includes(id));
  const unavailable = selected.filter((id) => !Number.isFinite(values?.[id]));
  if (unavailable.length > 0) {
    return { status: "unavailable", selected, reached: null, missed: null, ratioPercent: null, unavailable };
  }

  // Use the engine's *strictly greater than* rule, not >= (equal is missed).
  const reached = selected.filter((id) => (values?.[id] as number) > targetPercent).length;
  return {
    status: "available",
    selected,
    reached,
    missed: selected.length - reached,
    ratioPercent: Math.round((reached / selected.length) * 100),
    unavailable: [],
  };
}
