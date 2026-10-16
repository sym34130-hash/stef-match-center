/**
 * A KPI concedes a football goal exactly when the canonical operational score
 * does: with four KPIs available, a metric must STRICTLY exceed the league's
 * active score target to score. Equality therefore concedes.
 *
 * Partial snapshots must not claim a conceded goal before the score is valid.
 */
export function isKpiGoalConceded(
  value: number | null | undefined,
  scoreAvailable: boolean,
  targetPercent: number,
): boolean {
  return scoreAvailable
    && typeof value === "number"
    && Number.isFinite(value)
    && Number.isFinite(targetPercent)
    && value <= targetPercent;
}
