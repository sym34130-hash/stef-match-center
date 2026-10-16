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
const day = (date, clock) => `${date}T${clock}+02:00`;
function operation(type, position, date, clock, durationSeconds, filter = "") {
  return [
    "Test", day(date, clock), type, position, "VOYAGE1", "01K",
    "TR", filter, "", "Défenseur", "",
    durationSeconds / 86400, durationSeconds <= 1800 ? 1 : 0,
    22, // deliberately stale: hourly KPI must use timestamp, not Excel hour.
  ];
}
function makeWorkbook() {
  const rows = [
    operation("ZONAGE", "EARLY", "2026-09-17", "21:40:00", 1800.000000000001),
    operation("DECHG", "EARLY", "2026-09-17", "21:50:00", 1800.000000000001),
    operation("DECHG", "MATCH", "2026-09-17", "22:10:00", 1500),
    operation("ZONAGE", "MATCH", "2026-09-17", "22:20:00", 1860),
    operation("DECHG", "MORNING", "2026-09-18", "06:20:00", 1920),
    operation("ZONAGE", "MORNING", "2026-09-18", "06:25:00", 1200),
    operation("DECHG", "LAST", "2026-09-18", "06:30:15", 1800),
    operation("DECHG", "BEFORE", "2026-09-17", "21:29:59", 0),
    operation("DECHG", "AFTER", "2026-09-18", "06:31:00", 0),
    operation("DECHG", "FILTERED", "2026-09-17", "23:00:00", 0, "filtered"),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Données");
  // A stale hourly chart must never override filtered, minute-accurate rows.
  const x = XLSX.utils.aoa_to_sheet([["Heure op", "Somme de Passes réussies"], [22, 0.9]]);
  XLSX.utils.book_append_sheet(wb, x, "X");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
const buffer = makeWorkbook();
const basic = { zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 };
function snapshot({start="21:30",end="06:30",criteria=basic,excludedTravelCodes=[]}={}) {
  const result = buildSnapshotFromWorkbook(buffer, "kpi-integrity.xlsx", "01K", {start,end,criteria,excludedTravelCodes});
  assert.equal(result.ok, true, JSON.stringify(result.error ?? null));
  return result.snapshot;
}
test("hourly pass score: exact minutes, partial hours, single denominator and stale Excel hours ignored", () => {
  const s = snapshot();
  assert.equal(s.summary.duelTotal, 7);
  assert.equal(s.summary.duelWon, 5);
  assert.equal(s.summary.passRate, 71.4);
  assert.deepEqual(s.hourlyPerformance.map(row => [row.label,row.total,row.won]),
    [["21h",2,2],["22h",2,1],["06h",3,2]]);
  assert.equal(s.operationalScore.indicators.passRate, s.summary.passRate);
  assert.equal(s.hourlyPerformance.reduce((total,row)=>total+row.total,0),s.summary.duelTotal);
  assert.equal(s.summary.possessionPositions.reception, 4);
  assert.equal(s.summary.possessionPositions.matched, 2);
  assert.equal(s.summary.possessionPercent, 50);
});

test("league threshold changes hourly and aggregate rates without reusing Excel flags", () => {
  const old = snapshot();
  const changed = snapshot({criteria:{...basic,zonageMinutes:25}});
  assert.equal(changed.summary.duelTotal, 7);
  assert.equal(changed.summary.duelWon, 2);
  assert.equal(changed.summary.passRate, 28.6);
  assert.notEqual(changed.operationalScore.indicators.passRate, old.operationalScore.indicators.passRate);
  assert.equal(changed.hourlyPerformance.reduce((n,r)=>n+r.won,0),2);
  assert.equal(changed.hourlyPerformance.reduce((n,r)=>n+r.total,0),7);
});

test("boundary: exactly 30 minutes remains on target despite Excel float noise", () => {
  const s = snapshot({start:"21:30",end:"22:00"});
  assert.equal(s.summary.duelTotal, 2);
  assert.equal(s.summary.duelWon, 2);
  assert.equal(s.summary.passRate, 100);
  assert.deepEqual(s.hourlyPerformance.map(r=>r.label),["21h"]);
});

test("possession: zonage before DECHG must not become a completed reception", () => {
  const s = snapshot();
  assert.deepEqual(s.summary.possessionPositions,{zonage:3,reception:4,matched:2});
  const partial = snapshot({start:"21:30",end:"22:00"});
  assert.equal(partial.summary.possessionPositions.reception,1);
  assert.equal(partial.summary.possessionPositions.matched,0);
  assert.equal(partial.summary.possessionPercent,0);
});

test("excluded travel affects hourly and possession populations without hidden pivot fallback", () => {
  const s = snapshot({excludedTravelCodes:["VOYAGE1"]});
  assert.equal(s.summary.duelTotal,0);
  assert.equal(s.summary.passRate,null);
  assert.equal(s.summary.possessionPercent,null);
  assert.deepEqual(s.hourlyPerformance,[]);
});
