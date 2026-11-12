import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";
import { isHourlyPassChartRow } from "../server/hourly-pass-scope.mjs";

test("unloading chart accepts every segment (including LIV), but only DECHG operations", () => {
  for (const segmentType of ["AQ", "ED", "EX", "", " ", " ex ", "aq", "LIV", "liv", "TR", "OTHER", null, undefined]) {
    assert.equal(isHourlyPassChartRow({ operationType: "DECHG", segmentType }), true, String(segmentType));
  }
  assert.equal(isHourlyPassChartRow({ operationType: " dechG ", segmentType: "LIV" }), true);
  for (const operationType of ["CHG", "ZONAGE", "", "DECHARGEMENT"]) {
    assert.equal(isHourlyPassChartRow({ operationType, segmentType: "EX" }), false, operationType);
  }
});

const headings = ["Operateur", "Date Heure de debut d operation", "Type operation",
  "N position", "Code voyage", "Agence segment", "Type segment",
  "Filtre operateur", "Filtre heure", "Poste", "Poz non zonees", "DZ", "Duels gagnes", "Heure OP"];
function entry(type, segment, time, won, code, filter = "") {
  return ["Test", `2026-09-17T${time}+02:00`, type, "P-" + code + "-" + time,
    code, "01K", segment, filter, "", "Défenseur", "", (won ? 10 : 40) / 1440, won ? 1 : 0, 22];
}
const rows = [
  entry("DECHG", "AQ", "21:30:00", true, "AQ"),
  entry("DECHG", "ED", "22:00:00", false, "ED"),
  entry("DECHG", "EX", "22:10:00", true, "MIXED"),
  entry("DECHG", "", "22:20:00", true, "BLANK"),
  entry("DECHG", "LIV", "22:30:00", false, "MIXED"),
  entry("DECHG", "TR", "22:40:00", false, "TR"),
  entry("CHG", "EX", "23:00:00", true, "CHG"),
  entry("ZONAGE", "EX", "23:05:00", true, "ZONAGE"),
  entry("DECHG", "ex", "23:10:00", true, "EXLOW"),
  entry("DECHG", " EX ", "23:20:00", true, "EXSPACE"),
  entry("DECHG", " ", "23:30:00", true, "BLANKSPACE"),
  entry("DECHG", "LIV", "23:40:00", true, "LIV"),
  entry("DECHG", "EX", "23:50:00", true, "FILTERED", "x"),
];
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headings, ...rows]), "Données");
const buffer = XLSX.write(book, {type:"buffer",bookType:"xlsx"});
const criteria = {zonageMinutes:30,loadingSeconds:165,unloadingSeconds:60,scoreTargetPercent:50};
function run(criteriaOverride = criteria, excludedTravelCodes = []) {
  const result = buildSnapshotFromWorkbook(buffer, "passes-scope.xlsx", "01K", {
    start:"21:30",end:"06:30",criteria:criteriaOverride,excludedTravelCodes,
  });
  assert.equal(result.ok,true,JSON.stringify(result.error ?? null));
  return result.snapshot;
}

test("all eligible DECHG segments including LIV and TR, without changing official KPI", () => {
  const s = run();
  assert.deepEqual(s.hourlyPerformance.map(({label,total,won}) => [label,total,won]), [
    ["21h",1,1],["22h",5,2],["23h",4,4],
  ]);
  assert.deepEqual([s.summary.duelWon,s.summary.duelTotal,s.summary.passRate],[9,12,75]);
  assert.equal(s.operationalScore.indicators.passRate,75);
  assert.deepEqual(s.overallHourlyPerformance.map(({label,won,total}) => [label,won,total]), [
    ["21h",1,1],["22h",2,5],["23h",6,6],
  ]);
  assert.equal(s.overallHourlyPerformance.reduce((n,item)=>n+item.total,0),s.summary.duelTotal);
  assert.equal(s.overallHourlyPerformance.reduce((n,item)=>n+item.won,0),s.summary.duelWon);
  assert.equal(s.hourlyPerformance.reduce((n,item) => n + item.total,0),10);
  assert.equal(s.hourlyPerformance.reduce((n,item) => n + item.won,0),7);
  assert.equal(s.hourlyPerformance.find(item => item.label === "23h").arrivingTravelCodes.includes("LIV"),true);
  assert.equal(s.hourlyPerformance.find(item => item.label === "22h").arrivingTravelCodes.includes("MIXED"),true);
});

test("active league threshold recalculates both independently; trip exclusions affect both", () => {
  const strict = run({...criteria,zonageMinutes:5});
  assert.equal(strict.summary.passRate,0);
  assert.equal(strict.overallHourlyPerformance.reduce((n,item)=>n+item.won,0),0);
  assert.equal(strict.hourlyPerformance.reduce((n,item)=>n+item.won,0),0);
  const excluded = run(criteria,["MIXED"]);
  assert.equal(excluded.summary.duelTotal,10,"Both EX and LIV rows of excluded travel leave official population");
  assert.equal(excluded.overallHourlyPerformance.reduce((n,item)=>n+item.total,0),10);
  assert.equal(excluded.hourlyPerformance.reduce((n,item)=>n+item.total,0),8,"Both eligible EX and LIV rows of excluded travel leave the chart");
  assert.equal(excluded.hourlyPerformance.find(item=>item.label==="22h").arrivingTravelCodes.includes("MIXED"),false);
});

test("LIV-only DECHG is present in both hourly unloading and official views", () => {
  const onlyLIV = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(onlyLIV,XLSX.utils.aoa_to_sheet([headings,entry("DECHG","LIV","22:00:00",true,"LIV")]),"Données");
  const result = buildSnapshotFromWorkbook(XLSX.write(onlyLIV,{type:"buffer",bookType:"xlsx"}),
    "liv.xlsx","01K",{start:"21:30",end:"06:30",criteria});
  assert.equal(result.ok,true);
  assert.deepEqual(result.snapshot.hourlyPerformance.map(({label,won,total,rate})=>[label,won,total,rate]),[
    ["22h",1,1,100],
  ]);
  assert.deepEqual(result.snapshot.overallHourlyPerformance.map(({label,won,total,rate})=>[label,won,total,rate]),[
    ["22h",1,1,100],
  ]);
  assert.equal(result.snapshot.summary.passRate,100);
});


test("13:00–22:30: 19h uses all eligible DECHG including LIV, and official KPI remains intact", () => {
  const scenario = [];
  for (let hour = 13; hour <= 22; hour++) {
    const time = String(hour).padStart(2, "0") + ":05:00";
    scenario.push(entry("DECHG", "EX", time, true, "CI-H" + hour));
  }
  scenario.push(entry("DECHG", "EX", "19:10:00", true, "CI-H19-A"));
  scenario.push(entry("DECHG", "ED", "19:15:00", true, "CI-H19-B"));
  scenario.push(entry("DECHG", "AQ", "19:20:00", false, "CI-H19-C"));
  scenario.push(entry("DECHG", "", "19:25:00", false, "CI-H19-D"));
  // LIV is included in both DECHG and official views.
  scenario.push(entry("DECHG", "LIV", "19:30:00", false, "CI-LIV"));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headings, ...scenario]), "Données");
  const result = buildSnapshotFromWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    "CI_13_22H30.xlsx", "01K", { start: "13:00", end: "22:30", criteria });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const chart = result.snapshot.hourlyPerformance;
  assert.equal(chart.length, 10);
  for (const row of chart) {
    if (row.label === "19h") {
      assert.deepEqual([row.won, row.total, row.rate], [3, 6, 50]);
    } else {
      assert.deepEqual([row.won, row.total, row.rate], [1, 1, 100], row.label);
    }
  }
  assert.equal(chart.reduce((sum, row) => sum + row.won, 0), 12);
  assert.equal(chart.reduce((sum, row) => sum + row.total, 0), 15);
  assert.equal(result.snapshot.summary.passRate, 80,
    "Both views include LIV; the official KPI itself must not change");
  const official = result.snapshot.overallHourlyPerformance;
  assert.equal(official.length, 10);
  assert.deepEqual(
    official.find(item => item.label === "19h"),
    { label: "19h", hour: 19, won: 3, total: 6, rate: 50 },
    "LIV failure is included in both views",
  );
  assert.deepEqual([
    official.reduce((sum, item) => sum + item.won, 0),
    official.reduce((sum, item) => sum + item.total, 0),
  ], [12, 15]);
  assert.equal(official.reduce((sum, item) => sum + item.won, 0) /
    official.reduce((sum, item) => sum + item.total, 0) * 100, result.snapshot.summary.passRate);
  assert.equal(result.snapshot.match.timeRangeLabel, "13:00 - 22:30");
});
