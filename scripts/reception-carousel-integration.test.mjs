import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";

const headers = [
  "Operateur", "Date Heure de debut d operation", "Type operation",
  "N position", "Code voyage", "Agence segment", "Type segment",
  "Filtre operateur", "Filtre heure", "Poste", "Poz non zonees",
  "DZ", "Duels gagnes", "Heure OP",
];
function voyage(code, size, start, secondsBetweenOperations, segment = "EX", operatorFilter = "") {
  const startAt = Date.parse(start);
  return Array.from({ length: size }, (_, index) => [
    "Operator", new Date(startAt + index * secondsBetweenOperations * 1000).toISOString(),
    "DECHG", code + "-" + index, code, "01K", segment,
    operatorFilter, "", "Défenseur", "", 10 / 1440, 1, 22,
  ]);
}
function fixture() {
  const rows = [
    ...voyage("GOOD", 15, "2026-09-17T22:00:00+02:00", 10),
    ...voyage("SLOW", 15, "2026-09-18T00:00:00+02:00", 90),
    ...voyage("GOOD2", 15, "2026-09-18T01:00:00+02:00", 25),
    ...voyage("SHORT", 14, "2026-09-17T23:00:00+02:00", 20),
    ...voyage("QUAI38", 20, "2026-09-17T23:15:00+02:00", 120, "AQ"),
    ...voyage("OLD", 15, "2026-09-16T22:00:00+02:00", 120),
    ...voyage("FILTERED", 15, "2026-09-17T23:00:00+02:00", 90, "EX", "excluded"),
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Données");
  // A stale TCD row must not contaminate the new period-specific reception KPI.
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Déchargement"],
    ["Code Voyage", "Min. de Date/Heure de début d'opération", "Max. de Date/Heure de début d'opération",
      "Nombre de N° Position", "Duels gagnés", "Duels perdus", "Duels"],
    ["TCD-ONLY", "16/09/2026 22:00:00", "16/09/2026 22:30:00", 15, 1, 0, 1],
  ]), "TCD PPT");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}
const workbook = fixture();
const criteria = { zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 };
function snapshot(options = {}) {
  const result = buildSnapshotFromWorkbook(workbook, "reception-ci.xlsx", "01K",
    { start: "21:30", end: "06:30", criteria, ...options });
  assert.equal(result.ok, true, JSON.stringify(result.error ?? null));
  return result.snapshot;
}
function reconcile(value) {
  const quality = value.unloadingQuality;
  const details = value.unloadingDuelQuality;
  const hourly = value.unloadingHourlyAnalysis;
  const diagnostic = value.anomalySummary.unloading;
  // Business KPI and the lost-duel list stay fully reconciled.
  assert.equal(quality.targeted + quality.offTarget, details.won + details.lost);
  assert.equal(quality.targeted, details.won);
  assert.equal(quality.offTarget, details.lost);
  assert.equal(details.lostDuels.length, quality.offTarget);
  assert.deepEqual([diagnostic.eligibleTravels, diagnostic.offTargetTravels],
    [quality.eligibleTrips, quality.offTarget], "diagnostic keeps the official, non-AQ cohort");
  // Hourly chart is a deliberately distinct visual cohort.
  assert.equal(hourly.items.reduce((sum, slot) => sum + slot.travelCount, 0), hourly.eligibleTravels);
  assert.ok(hourly.travels.every(trip => trip.operationRows >= 15));
}

test("carousel 2: graph includes AQ but official KPI and details remain unchanged", () => {
  const s = snapshot();
  assert.equal(s.unloadingHourlyAnalysis.night.startDate, "2026-09-17");
  assert.equal(s.unloadingHourlyAnalysis.excludedSmallTravels, 1);
  assert.equal(s.unloadingHourlyAnalysis.excludedQuayRows, 0);
  assert.equal(s.unloadingQuality.targeted, 2);
  assert.equal(s.unloadingQuality.offTarget, 1);
  assert.equal(s.unloadingQuality.targetedPercent, 66.7);
  assert.equal(s.unloadingDuelQuality.lostDuels[0].travelCode, "SLOW");
  assert.deepEqual(s.unloadingHourlyAnalysis.travels.map(item => item.travelCode).sort(), ["GOOD", "GOOD2", "QUAI38", "SLOW"]);
  assert.equal(s.unloadingHourlyAnalysis.offTargetTravels, 2);
  assert.equal(s.anomalySummary.unloading.offTargetTravels, 1);
  reconcile(s);
});

test("carousel 2: active league criterion recalculates all views together", () => {
  const s = snapshot({ criteria: { ...criteria, unloadingSeconds: 20 } });
  assert.deepEqual([s.unloadingQuality.targeted, s.unloadingQuality.offTarget], [1, 2]);
  reconcile(s);
});

test("carousel 2: excluding a lost voyage removes it from the three views", () => {
  const s = snapshot({ excludedTravelCodes: ["SLOW"] });
  assert.deepEqual([s.unloadingQuality.targeted, s.unloadingQuality.offTarget], [2, 0]);
  assert.deepEqual(s.unloadingDuelQuality.lostDuels, []);
  reconcile(s);
});

test("carousel 2 graph: column C DECHG only, column G AQ/ED/EX/blank only, LIV excluded", () => {
  const sourceRows = [
    ...voyage("EX_GOOD", 15, "2026-09-17T22:00:00+02:00", 15, "ex"),
    ...voyage("ED_GOOD", 15, "2026-09-17T23:00:00+02:00", 15, "ED"),
    ...voyage("BLANK_GOOD", 15, "2026-09-18T00:00:00+02:00", 15, "   "),
    ...voyage("AQ_BAD", 15, "2026-09-18T01:00:00+02:00", 90, "AQ"),
    ...voyage("LIV_BAD", 15, "2026-09-18T02:00:00+02:00", 100, "LIV"),
    ...voyage("TR_BAD", 15, "2026-09-18T03:00:00+02:00", 100, "TR"),
    ...voyage("MIXED", 15, "2026-09-18T04:00:00+02:00", 10, "EX"),
    ...voyage("MIXED", 10, "2026-09-18T04:30:00+02:00", 100, "LIV"),
    ...voyage("CHG_ONLY", 15, "2026-09-18T05:00:00+02:00", 20, "EX")
      .map(row => { const copy = [...row]; copy[2] = "CHG"; return copy; }),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...sourceRows]), "Données");
  const result = buildSnapshotFromWorkbook(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    "segments.xlsx", "01K", { start: "21:30", end: "06:30", criteria });
  assert.equal(result.ok, true);
  const s = result.snapshot;
  assert.deepEqual(s.unloadingHourlyAnalysis.travels.map(v => v.travelCode).sort(),
    ["AQ_BAD", "BLANK_GOOD", "ED_GOOD", "EX_GOOD", "MIXED"]);
  assert.equal(s.unloadingHourlyAnalysis.excludedSegmentRows, 40,
    "15 LIV + 15 TR + 10 LIV rows from MIXED are excluded before grouping");
  assert.equal(s.unloadingHourlyAnalysis.eligibleTravels, 5);
  assert.equal(s.unloadingHourlyAnalysis.offTargetTravels, 1);
  const mixed = s.unloadingHourlyAnalysis.travels.find(v => v.travelCode === "MIXED");
  assert.equal(mixed.operationRows, 15, "LIV rows of a mixed voyage never affect the chart mean");
  assert.equal(s.unloadingQuality.eligibleTrips, 6,
    "Official KPI still includes LIV/TR, excludes AQ and retains its original policy");
  assert.equal(s.anomalySummary.unloading.eligibleTravels, s.unloadingQuality.eligibleTrips);
  reconcile(s);
});
