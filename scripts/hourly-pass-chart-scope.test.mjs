import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";
import { isHourlyPassChartRow } from "../server/hourly-pass-scope.mjs";

test("passes chart column C/G: only DECHG + AQ, ED, EX or blank; normalize case and whitespace", () => {
  for (const segmentType of ["AQ", "ED", "EX", "", " ", " ex ", "aq", null, undefined]) {
    assert.equal(isHourlyPassChartRow({ operationType: "DECHG", segmentType }), true, String(segmentType));
  }
  for (const segmentType of ["LIV", "liv", "TR", "OTHER"]) {
    assert.equal(isHourlyPassChartRow({ operationType: "DECHG", segmentType }), false, segmentType);
  }
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

test("passes hourly graph excludes LIV/other operations, not the official pass KPI", () => {
  const s = run();
  assert.deepEqual(s.hourlyPerformance.map(({label,total,won}) => [label,total,won]), [
    ["21h",1,1],["22h",3,2],["23h",3,3],
  ]);
  assert.deepEqual([s.summary.duelWon,s.summary.duelTotal,s.summary.passRate],[9,12,75]);
  assert.equal(s.operationalScore.indicators.passRate,75);
  assert.equal(s.hourlyPerformance.reduce((n,item) => n + item.total,0),7);
  assert.equal(s.hourlyPerformance.reduce((n,item) => n + item.won,0),6);
  assert.equal(s.hourlyPerformance.some(item => item.arrivingTravelCodes?.includes("LIV")),false);
  assert.equal(s.hourlyPerformance.find(item => item.label === "22h").arrivingTravelCodes.includes("MIXED"),true);
});

test("active league threshold recalculates both independently; trip exclusions affect both", () => {
  const strict = run({...criteria,zonageMinutes:5});
  assert.equal(strict.summary.passRate,0);
  assert.equal(strict.hourlyPerformance.reduce((n,item)=>n+item.won,0),0);
  const excluded = run(criteria,["MIXED"]);
  assert.equal(excluded.summary.duelTotal,10,"Both EX and LIV rows of excluded travel leave official population");
  assert.equal(excluded.hourlyPerformance.reduce((n,item)=>n+item.total,0),6,"Only EX row of excluded travel leaves chart");
  assert.equal(excluded.hourlyPerformance.find(item=>item.label==="22h").arrivingTravelCodes.includes("MIXED"),false);
});

test("graph has no values if no allowed source rows, while official KPI is available", () => {
  const onlyLIV = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(onlyLIV,XLSX.utils.aoa_to_sheet([headings,entry("DECHG","LIV","22:00:00",true,"LIV")]),"Données");
  const result = buildSnapshotFromWorkbook(XLSX.write(onlyLIV,{type:"buffer",bookType:"xlsx"}),
    "liv.xlsx","01K",{start:"21:30",end:"06:30",criteria});
  assert.equal(result.ok,true);
  assert.deepEqual(result.snapshot.hourlyPerformance,[]);
  assert.equal(result.snapshot.summary.passRate,100);
});
