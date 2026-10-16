import { buildReceptionCohort } from "./reception-cohort.mjs";

// Hourly reception shares the official reception cohort; other diagnostics remain descriptive.
export const OPERATIONAL_ANALYSIS_VERSION = 3;
const parisFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const compareCodes = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const ratio = (n, d) => d > 0 ? Math.round(n / d * 1000) / 10 : null;
const text = value => String(value ?? "").trim();
const parts = date => Object.fromEntries(parisFormatter.formatToParts(date).map(p => [p.type, p.value]));
const dateKey = p => `${p.year}-${p.month}-${p.day}`;
const shiftDay = (day, offset) => new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);

function localBoundary(day, clock) {
  const wall = Date.parse(`${day}T${clock}:00Z`);
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(instant));
    const represented = Date.parse(`${dateKey(p)}T${p.hour}:${p.minute}:${p.second}Z`);
    instant += wall - represented;
  }
  // Reject a missing/ambiguous DST boundary rather than guessing an instant.
  const candidates = [instant - 3600000, instant, instant + 3600000].filter(value => {
    const p = parts(new Date(value));
    return dateKey(p) === day && `${p.hour}:${p.minute}` === clock && p.second === "00";
  });
  return candidates.length === 1 ? new Date(candidates[0]).toISOString() : null;
}

export function operationalAnalysisNeedsRefresh(snapshot) {
  return snapshot?.operationalAnalysisVersion !== OPERATIONAL_ANALYSIS_VERSION ||
    !snapshot.zonageDiagnostic || !snapshot.unloadingHourlyAnalysis || !snapshot.anomalySummary;
}

export function normalizeOperationalAnalysisContract(snapshot) {
  if (!snapshot || !operationalAnalysisNeedsRefresh(snapshot)) return snapshot;
  const copy = { ...snapshot };
  for (const key of ["operationalAnalysisVersion", "zonageDiagnostic", "unloadingHourlyAnalysis", "anomalySummary"]) delete copy[key];
  return copy;
}

export function selectNight(rows, period) {
  const candidates = new Map();
  for (const row of rows) {
    const p = parts(row.startedAt);
    const minute = Number(p.hour) * 60 + Number(p.minute);
    const day = period.isOvernight && minute <= period.endMinutes ? shiftDay(dateKey(p), -1) : dateKey(p);
    const group = candidates.get(day) ?? [];
    group.push(row);
    candidates.set(day, group);
  }
  const ranked = [...candidates].sort(([a, ar], [b, br]) => br.length - ar.length || compareCodes(b, a));
  if (!ranked.length) return { night: null, selectedRows: [], reason: "aucune_operation_eligible" };
  const [startDate, selectedRows] = ranked[0];
  const endDate = period.isOvernight ? shiftDay(startDate, 1) : startDate;
  const start = localBoundary(startDate, period.start);
  const end = localBoundary(endDate, period.end);
  if (!start || !end) return { night: null, selectedRows: [], reason: "borne_horaire_ambigue_ou_inexistante" };
  return {
    night: {
      startDate, endDate, start, end, timeZone: "Europe/Paris", endInclusiveMinute: true,
      eligibleOperations: selectedRows.length,
      otherNightOperations: rows.length - selectedRows.length,
      candidates: ranked.map(([date, group]) => ({ startDate: date, operations: group.length })),
      selectionRule: "maximum_operations_puis_date_recente",
    },
    selectedRows, reason: null,
  };
}

const emptyCounts = () => ({ receivedPositions: 0, qualifiablePositions: 0, onTimePositions: 0, latePositions: 0, unqualifiablePositions: 0 });
function rates(counts) {
  return { ...counts, anomalyRate: ratio(counts.latePositions, counts.qualifiablePositions), coverageRate: ratio(counts.qualifiablePositions, counts.receivedPositions) };
}

function zonageAnalysis(rows, night, targetMinutes, reason) {
  const totals = emptyCounts(), travels = new Map(), details = [];
  const reasons = {}, warnings = [];
  let positionsWithoutReception = 0, repeatedReceptionPositions = 0;
  const byPosition = Map.groupBy(rows, row => row.position);
  for (const [position, operations] of byPosition) {
    const receptions = operations.filter(row => row.operationType === "DECHG")
      .sort((a, b) => a.startedAt - b.startedAt);
    if (!receptions.length) { positionsWithoutReception++; continue; }
    totals.receivedPositions++;
    if (receptions.length > 1) repeatedReceptionPositions++;
    const codes = [...new Set(receptions.map(row => row.travelCode).filter(Boolean))];
    const first = receptions[0];
    // All receptions must identify the same inbound voyage; never use CHG.
    const travelCode = codes.length === 1 && receptions.every(row => row.travelCode === codes[0]) ? codes[0] : null;
    const zones = operations.filter(row => row.operationType === "ZONAGE").sort((a, b) => a.startedAt - b.startedAt);
    const zone = zones.find(row => row.startedAt >= first.startedAt);
    const failure = codes.length > 1 ? "receptions_contradictoires" : !travelCode ? "voyage_reception_absent" :
      !zone ? (zones.length ? "zonage_uniquement_anterieur" : "zonage_absent") : null;
    const delaySeconds = !failure ? Math.max(0, Math.round((zone.startedAt - first.startedAt) / 1000)) : null;
    const classification = failure ? "non_qualifiable" : delaySeconds > targetMinutes * 60 ? "hors_delai" : "dans_delai";
    const counter = classification === "hors_delai" ? "latePositions" : classification === "dans_delai" ? "onTimePositions" : "unqualifiablePositions";
    totals[counter]++;
    if (!failure) totals.qualifiablePositions++;
    if (failure) reasons[failure] = (reasons[failure] ?? 0) + 1;
    if (travelCode) {
      const trip = travels.get(travelCode) ?? { travelCode, ...emptyCounts(), excessSeconds: 0 };
      trip.receivedPositions++; trip[counter]++;
      if (!failure) trip.qualifiablePositions++;
      if (classification === "hors_delai") trip.excessSeconds += delaySeconds - targetMinutes * 60;
      travels.set(travelCode, trip);
    }
    // Keep only exceptions; no operator names or duplicated source operations.
    if (classification !== "dans_delai") details.push({
      position, travelCode, classification, reason: failure, delaySeconds,
      receptionAt: first.startedAt.toISOString(), zonageAt: !failure ? zone.startedAt.toISOString() : null,
    });
  }
  const items = [...travels.values()].map(({ excessSeconds, ...trip }) => ({
    ...rates(trip), state: trip.qualifiablePositions ? "disponible" : "indisponible",
    averageExcessSeconds: trip.latePositions ? Math.round(excessSeconds / trip.latePositions) : null,
  })).sort((a, b) => b.latePositions - a.latePositions || (b.anomalyRate ?? -1) - (a.anomalyRate ?? -1) || compareCodes(a.travelCode, b.travelCode));
  details.sort((a, b) => compareCodes(a.travelCode ?? "", b.travelCode ?? "") || compareCodes(a.position, b.position));
  if (reasons.receptions_contradictoires) warnings.push(`${reasons.receptions_contradictoires} position(s) avec des voyages de réception contradictoires, non attribuées.`);
  if (reasons.voyage_reception_absent) warnings.push(`${reasons.voyage_reception_absent} position(s) sans voyage de réception fiable, non attribuées.`);
  return {
    state: totals.qualifiablePositions ? "disponible" : "indisponible",
    reason: reason ?? (totals.qualifiablePositions ? null : "aucune_position_qualifiable"),
    night, targetMinutes, ...rates(totals),
    unattributedPositions: (reasons.receptions_contradictoires ?? 0) + (reasons.voyage_reception_absent ?? 0),
    positionsWithoutReception, repeatedReceptionPositions, unqualifiableReasons: reasons,
    travels: items, top5: items.filter(trip => trip.latePositions > 0).slice(0, 5), details, warnings,
  };
}

function hourlyReception(rows, night, targetSeconds, reason, minimumPositions, includeQuay = false) {
  const base = { state: "indisponible", reason: reason ?? "aucun_voyage_a_duree_positive", night, targetSeconds,
    grouping: "heure_du_premier_DECHG_de_la_nuit", eligibleTravels: 0, excludedZeroDurationTravels: 0,
    excludedSmallTravels: 0, excludedQuayRows: 0,
    unidentifiedTravelRows: 0, meanSecondsPerPosition: null, offTargetTravels: 0, offTargetPercent: null, items: [], travels: [] };
  if (!night) return base;
  const cohort = buildReceptionCohort(rows, targetSeconds, { ...(minimumPositions == null ? {} : { minimumPositions }), includeQuay });
  base.excludedZeroDurationTravels = cohort.excludedZeroDurationTravels;
  base.excludedSmallTravels = cohort.excludedSmallTravels;
  base.excludedQuayRows = cohort.excludedQuayRows;
  base.unidentifiedTravelRows = cohort.unidentifiedTravelRows;
  const trips = cohort.travels;
  const end = Date.parse(night.end);
  for (let start = Date.parse(night.start); start < end;) {
    const p = parts(new Date(start));
    const next = Math.min(end, start + (60 - Number(p.minute)) * 60000);
    const last = next === end;
    // The existing active range includes the entire final minute.
    const selected = trips.filter(trip => Date.parse(trip.start) >= start && Date.parse(trip.start) < (last ? next + 60000 : next));
    const total = selected.length, offTarget = selected.filter(trip => trip.offTarget).length;
    base.items.push({
      start: new Date(start).toISOString(), end: new Date(next).toISOString(), endInclusiveMinute: last,
      label: `${p.hour}h`, state: total ? "disponible" : "indisponible",
      travelCount: total, operationRows: selected.reduce((sum, trip) => sum + trip.operationRows, 0),
      distinctPositions: new Set(selected.flatMap(trip => trip.positions)).size,
      meanSecondsPerPosition: total ? Math.round(selected.reduce((sum, trip) => sum + trip.timePerPositionSeconds, 0) / total) : null,
      offTargetTravels: offTarget, offTargetPercent: ratio(offTarget, total), targetSeconds,
      travelCodes: selected.map(trip => trip.travelCode),
    });
    start = next;
  }
  base.travels = trips.map(trip => {
    const copy = { ...trip };
    delete copy.positions;
    return copy;
  });
  base.eligibleTravels = trips.length;
  base.offTargetTravels = trips.filter(trip => trip.offTarget).length;
  base.offTargetPercent = ratio(base.offTargetTravels, trips.length);
  if (trips.length) {
    base.state = "disponible"; base.reason = null;
    base.meanSecondsPerPosition = Math.round(trips.reduce((sum, trip) => sum + trip.timePerPositionSeconds, 0) / trips.length);
  }
  return base;
}

/** Input rows already satisfy the official match filter (operator, active clock range, exclusions).
 * The hourly graph now uses its own segment subset; the KPI and diagnostics retain their existing population.
 */
export function buildOperationalAnalyses({ rows, period, criteria, loadingQuality, validation = {}, minimumReceptionPositions }) {
  const valid = (rows ?? []).filter(row => row.startedAt instanceof Date && Number.isFinite(+row.startedAt) &&
    text(row.position) && ["DECHG", "ZONAGE", "CHG"].includes(row.operationType))
    .map(row => ({ ...row, position: text(row.position), travelCode: text(row.travelCode) }));
  const { night, selectedRows, reason } = selectNight(valid, period);
  const zonageDiagnostic = zonageAnalysis(selectedRows, night, criteria.zonageMinutes, reason);
  // Chart-only filter: column C = DECHG (Excel « DÉCHARGEMENT »),
  // column G = AQ, ED, EX or empty. LIV and unknown segment types are omitted.
  // Keep the 15-position minimum and selected operating night as before.
  // The official reception KPI/duel detail and diagnostic still exclude AQ.
  const chartSegmentTypes = new Set(["AQ", "ED", "EX", ""]);
  const chartRows = selectedRows.filter(row => row.operationType === "DECHG" &&
    chartSegmentTypes.has(text(row.segmentType).toUpperCase()));
  const officialReceptionHourlyAnalysis = hourlyReception(selectedRows, night, criteria.unloadingSeconds, reason, minimumReceptionPositions);
  const unloadingHourlyAnalysis = hourlyReception(chartRows, night, criteria.unloadingSeconds, reason, minimumReceptionPositions, true);
  unloadingHourlyAnalysis.excludedSegmentRows = selectedRows.filter(row => row.operationType === "DECHG").length - chartRows.length;
  const warnings = [...zonageDiagnostic.warnings];
  if (night?.otherNightOperations) warnings.push(`${night.otherNightOperations} opération(s) appartenant à d'autres périodes d'exploitation exclues du diagnostic.`);
  const invalidRows = (rows?.length ?? 0) - valid.length;
  if (invalidRows || validation.issueRows) warnings.push(`${invalidRows + (validation.issueRows ?? 0)} ligne(s) non exploitable(s) signalée(s).`);
  if (validation.unknownOperationRows) warnings.push(`${validation.unknownOperationRows} type(s) d'opération non reconnu(s) dans la source.`);
  if (validation.duplicateRows) warnings.push(`${validation.duplicateRows} clé(s) de doublons potentiels dans la source ; le diagnostic zonage déduplique les positions.`);
  if (officialReceptionHourlyAnalysis.excludedZeroDurationTravels) warnings.push(`${officialReceptionHourlyAnalysis.excludedZeroDurationTravels} voyage(s) de réception sans durée positive.`);
  if (officialReceptionHourlyAnalysis.excludedSmallTravels) warnings.push(`${officialReceptionHourlyAnalysis.excludedSmallTravels} voyage(s) avec moins de 15 positions DECHG, non qualifiables pour les duels.`);
  if (officialReceptionHourlyAnalysis.excludedQuayRows) warnings.push(`${officialReceptionHourlyAnalysis.excludedQuayRows} opération(s) AQ de quai exclues des duels de réception.`);
  if (officialReceptionHourlyAnalysis.unidentifiedTravelRows) warnings.push(`${officialReceptionHourlyAnalysis.unidentifiedTravelRows} ligne(s) DECHG sans code voyage.`);
  if (night?.otherNightOperations && loadingQuality?.sourceAvailable) warnings.push("Les chargements conservent le périmètre horaire officiel du TCD, toutes dates confondues.");
  const topTravel = zonageDiagnostic.top5[0] ?? null;
  const worst = officialReceptionHourlyAnalysis.items.filter(item => item.state === "disponible")
    .sort((a, b) => b.meanSecondsPerPosition - a.meanSecondsPerPosition || compareCodes(a.start, b.start))[0] ?? null;
  const messages = [];
  if (topTravel) messages.push(`Le voyage ${topTravel.travelCode} concentre ${topTravel.latePositions} positions hors délai sur ${topTravel.qualifiablePositions} positions qualifiables.`);
  if (worst) messages.push(`Le créneau ${worst.label} présente une moyenne de ${worst.meanSecondsPerPosition} secondes par position pour ${worst.travelCount} voyage(s) commencés dans ce créneau.`);
  const hasLoading = loadingQuality?.sourceAvailable && loadingQuality.targeted + loadingQuality.offTarget > 0;
  const available = night && (zonageDiagnostic.state === "disponible" || officialReceptionHourlyAnalysis.state === "disponible" || hasLoading);
  return {
    operationalAnalysisVersion: OPERATIONAL_ANALYSIS_VERSION,
    zonageDiagnostic, unloadingHourlyAnalysis,
    anomalySummary: {
      state: available ? "disponible" : "indisponible", reason: available ? null : reason ?? "aucune_analyse_qualifiable", night,
      zonage: { latePositions: zonageDiagnostic.latePositions, unqualifiablePositions: zonageDiagnostic.unqualifiablePositions,
        receivedPositions: zonageDiagnostic.receivedPositions, qualifiablePositions: zonageDiagnostic.qualifiablePositions },
      unloading: { offTargetTravels: officialReceptionHourlyAnalysis.offTargetTravels, eligibleTravels: officialReceptionHourlyAnalysis.eligibleTravels },
      loading: { state: hasLoading ? "disponible" : "indisponible", offTargetTravels: hasLoading ? loadingQuality.offTarget : null,
        eligibleTravels: hasLoading ? loadingQuality.targeted + loadingQuality.offTarget : null, source: "TCD PPT", scope: "plage_active_toutes_dates" },
      worstReceptionSlot: worst ? { start: worst.start, end: worst.end, label: worst.label, meanSecondsPerPosition: worst.meanSecondsPerPosition, travelCount: worst.travelCount } : null,
      topZonageTravel: topTravel ? { travelCode: topTravel.travelCode, latePositions: topTravel.latePositions, qualifiablePositions: topTravel.qualifiablePositions } : null,
      warnings, messages,
    },
  };
}
