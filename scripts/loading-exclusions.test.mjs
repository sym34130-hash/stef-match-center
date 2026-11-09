import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";

const headers = [
  "Opérateur", "Date heure de début d'opération", "Type d'opération", "N° Position",
  "Code Voyage", "Agence Segment", "Type Segment", "Filtre opérateur", "Filtre heure",
  "Poste", "Poz non zonées", "DZ", "Duels gagnés",
];
function fixture() {
  const rows = [headers];
  const first = Date.parse("2026-09-17T22:00:00+02:00");
  for (const travel of ["FAST", "SLOW"]) {
    for (let position = 0; position < 15; position++) {
      rows.push(["TEST", new Date(first + position * 12000).toISOString(), "DECHG",
        `${travel}-P${position}`, travel, "01K", "EX", "", "", "Défenseur", "", "", 1]);
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Données");
  // TCD PPT provides the authoritative loading cohort, independent of DECHG rows.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Chargement"],
    ["Code Voyage", "Min. de Date/Heure de début d'opération", "Nombre de N° Position", "TC", "TC/poz", "Commentaire"],
    ["FAST", "17/09/2026 22:00:00", 15, 90 / 86400, 90 / 86400, ""],
    ["SLOW", "17/09/2026 22:20:00", 15, 200 / 86400, 200 / 86400, ""],
    ["SHORT", "17/09/2026 22:30:00", 3, 200 / 86400, 200 / 86400, ""],
  ]), "TCD PPT");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
const workbook = fixture();
function build(loadingExclusions = [], receptionExclusions = {}, excludedTravelCodes = []) {
  const result = buildSnapshotFromWorkbook(workbook, "loading-scoped.xlsx", "01K",
    { start: "21:30", end: "06:30", loadingExclusions, receptionExclusions, excludedTravelCodes });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.snapshot;
}

test("CHG-only exclusions preserve DECHG, positions, users, possession and pass score", () => {
  const baseline = build();
  assert.deepEqual(baseline.loadingScope.availableTravels, ["FAST", "SLOW"]);
  assert.deepEqual([baseline.loadingQuality.targeted, baseline.loadingQuality.offTarget], [1, 1]);
  assert.equal(baseline.loadingQuality.targetedPercent, 50);
  const filtered = build([{ code: "SLOW", reason: "Chargement exceptionnel", updatedAt: "2026-09-17T21:00:00Z" }]);
  assert.deepEqual([filtered.loadingQuality.targeted, filtered.loadingQuality.offTarget], [1, 0]);
  assert.equal(filtered.loadingQuality.targetedPercent, 100);
  assert.equal(filtered.loadingQuality.nonTargetedShots.length, 0);
  assert.deepEqual(filtered.loadingScope.excludedTravels.map(item => [item.code, item.reason]), [["SLOW", "Chargement exceptionnel"]]);
  assert.equal(filtered.loadingScope.effectiveExcluded, 1);
  assert.equal(filtered.operationalScore.indicators.loadingPercent, 100);
  assert.equal(filtered.summary.operations, baseline.summary.operations);
  assert.equal(filtered.summary.players, baseline.summary.players);
  assert.equal(filtered.summary.positions, baseline.summary.positions);
  assert.equal(filtered.summary.passRate, baseline.summary.passRate);
  assert.equal(filtered.summary.possessionPercent, baseline.summary.possessionPercent);
  assert.equal(filtered.unloadingQuality.targetedPercent, baseline.unloadingQuality.targetedPercent);
  assert.deepEqual(build().loadingQuality.nonTargetedShots.map(t => t.travelCode), ["SLOW"]);
});

test("CHG selection is scoped; filtering a code outside eligible TCD does not invent a removal", () => {
  const filtered = build([{ code: "SHORT", reason: "Voyage trop court" }, { code: "UNKNOWN", reason: "Inconnu" }]);
  assert.equal(filtered.loadingScope.effectiveExcluded, 0);
  assert.equal(filtered.loadingQuality.targetedPercent, 50);
  assert.equal(filtered.loadingScope.excludedTravels.length, 2);
  assert.deepEqual(filtered.loadingScope.availableTravels, ["FAST", "SLOW"]);
});

test("CHG and DECHG selections remain independent even when using the same travel code", () => {
  const selected = build([{ code: "SLOW", reason: "CHG atypique" }],
    { travels: [{ code: "FAST", reason: "DECHG atypique" }] });
  assert.equal(selected.loadingQuality.targetedPercent, 100);
  assert.equal(selected.unloadingQuality.eligibleTrips, 1);
  assert.deepEqual(selected.receptionScope.excludedTravels.map(x => x.code), ["FAST"]);
  assert.deepEqual(selected.loadingScope.excludedTravels.map(x => x.code), ["SLOW"]);
  assert.equal(selected.summary.operations, build().summary.operations);
});

test("Global legacy exclusions still suppress all source populations", () => {
  const global = build([], {}, ["SLOW"]);
  assert.deepEqual(global.loadingScope.availableTravels, ["FAST"]);
  assert.equal(global.summary.operations, 15);
  assert.equal(global.loadingQuality.targetedPercent, 100);
});
