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
function voyage(code, size, start, secondsBetweenOperations, segment = "TR", operatorFilter = "") {
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
    ...voyage("FILTERED", 15, "2026-09-17T23:00:00+02:00", 90, "TR", "excluded"),
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
  assert.equal(quality.targeted + quality.offTarget, details.won + details.lost);
  assert.equal(details.won + details.lost, hourly.eligibleTravels);
  assert.equal(hourly.offTargetTravels, quality.offTarget);
  assert.equal(details.lostDuels.length, quality.offTarget);
  assert.equal(hourly.items.reduce((sum, slot) => sum + slot.travelCount, 0), hourly.eligibleTravels);
  assert.deepEqual(details.lostDuels.map(trip => trip.travelCode).sort(),
    hourly.travels.filter(trip => trip.offTarget).map(trip => trip.travelCode).sort());
}

test("carousel 2: same 15+ non-AQ voyages, period and target in all three views", () => {
  const s = snapshot();
  assert.equal(s.unloadingHourlyAnalysis.night.startDate, "2026-09-17");
  assert.equal(s.unloadingHourlyAnalysis.excludedSmallTravels, 1);
  assert.equal(s.unloadingHourlyAnalysis.excludedQuayRows, 20);
  assert.equal(s.unloadingQuality.targeted, 2);
  assert.equal(s.unloadingQuality.offTarget, 1);
  assert.equal(s.unloadingQuality.targetedPercent, 66.7);
  assert.equal(s.unloadingDuelQuality.lostDuels[0].travelCode, "SLOW");
  assert.deepEqual(s.unloadingHourlyAnalysis.travels.map(item => item.travelCode).sort(), ["GOOD", "GOOD2", "SLOW"]);
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
