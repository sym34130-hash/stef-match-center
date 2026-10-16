// Shared source of truth for reception duels and hourly reception analysis.
// A reception duel is an inbound transport voyage with at least 15 DECHG
// position rows. AQ (quay activity) is not a transport reception duel.
// The caller MUST supply rows scoped to one selected operating period.
export const MIN_RECEPTION_POSITIONS = 15;

export function buildReceptionCohort(rows, targetSeconds, { minimumPositions = MIN_RECEPTION_POSITIONS } = {}) {
  const receptions = (rows ?? []).filter(row => row.operationType === "DECHG");
  const excludedQuayRows = receptions.filter(row => String(row.segmentType ?? "").trim().toUpperCase() === "AQ").length;
  const unidentifiedTravelRows = receptions.filter(row => !String(row.travelCode ?? "").trim()).length;
  const groups = new Map();
  for (const row of receptions) {
    const travelCode = String(row.travelCode ?? "").trim();
    if (!travelCode || String(row.segmentType ?? "").trim().toUpperCase() === "AQ") continue;
    if (!groups.has(travelCode)) groups.set(travelCode, []);
    groups.get(travelCode).push(row);
  }
  const travels = [];
  let excludedSmallTravels = 0;
  let excludedZeroDurationTravels = 0;
  for (const [travelCode, operations] of groups) {
    if (operations.length < minimumPositions) {
      excludedSmallTravels++;
      continue;
    }
    const dates = operations.map(row => +row.startedAt);
    if (dates.some(value => !Number.isFinite(value))) continue;
    const start = Math.min(...dates);
    const end = Math.max(...dates);
    const elapsedSeconds = Math.max(0, Math.round((end - start) / 1000));
    if (!elapsedSeconds) {
      excludedZeroDurationTravels++;
      continue;
    }
    const timePerPositionSeconds = elapsedSeconds / operations.length;
    travels.push({
      travelCode,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      elapsedSeconds,
      operationRows: operations.length,
      distinctPositions: new Set(operations.map(row => row.position)).size,
      positions: operations.map(row => row.position),
      timePerPositionSeconds,
      offTarget: timePerPositionSeconds > targetSeconds,
    });
  }
  travels.sort((a, b) => a.start.localeCompare(b.start) || a.travelCode.localeCompare(b.travelCode));
  return { travels, excludedSmallTravels, excludedQuayRows, excludedZeroDurationTravels, unidentifiedTravelRows };
}
