import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMatchExportIdentity, assertMatchExportStillCurrent } from "../server/match-export-identity.mjs";

const agency = { code: "058", name: "Agen - 058" };
const league = { id:"argent", label:"LIGUE 1", zonageMinutes:30, loadingSeconds:165, unloadingSeconds:60, scoreTargetPercent:50 };
const snapshot = {
  agency:{ code:"058", detectedCode:"058", name:agency.name },
  sourceName:"HM 058 A V11.xlsx", importedAt:"2026-11-10T07:00:00.000Z",
  match:{ date:"2026-09-09" }, performanceCriteria:{zonageMinutes:30,loadingSeconds:165,unloadingSeconds:60,scoreTargetPercent:50},
  dailyIndicators:{agencyCode:"058", referenceDate:"2026-09-11", sourceName:"106J.pdf"},
};
function params(overrides={}) {return {
  sessionAgency:agency, snapshot, league, briefPlan:{visibleIndicators:["performance","injuries"],updatedAt:"2026-11-10T07:01:00Z"},
  briefPlanScope:"058:2026-09-09:2026-11-10T07:00:00.000Z", kpis:{injuriesValue:"2",expectedPlayersValue:"18"},
  generatedAt:"2026-11-10T08:00:00Z", ...overrides
};}

test("Lot E: matches agency, league, actual criteria, manual KPI and brief revision", () => {
  const ctx=buildMatchExportIdentity(params());
  assert.equal(ctx.agencyCode,"058");
  assert.equal(ctx.leagueLabel,"LIGUE 1");
  assert.deepEqual(ctx.indicators,["performance","injuries","accident-free-days"]);
  assert.equal(ctx.manualKpis.expectedPlayersValue,"18");
  assert.equal(ctx.performanceCriteria.scoreTargetPercent,50);
  assert.equal(ctx.pdf106j.referenceDate,"2026-09-11");
  assert.equal(ctx.filename,"STEF-MATCH-058-2026-09-09-LIGUE-1.pdf");
  assertMatchExportStillCurrent(ctx,params());
});

test("Lot E: forbids a snapshot belonging to a second agency", () => {
  assert.throws(()=>buildMatchExportIdentity(params({snapshot:{...snapshot,agency:{...snapshot.agency,code:"059"}}})),/agence connectée/);
});

test("Lot E: forbids foreign-agency 106J, while allowing a different reference date", () => {
  assert.throws(()=>buildMatchExportIdentity(params({snapshot:{...snapshot,dailyIndicators:{...snapshot.dailyIndicators,agencyCode:"059"}}})),/106J/);
  assert.throws(()=>buildMatchExportIdentity(params({snapshot:{...snapshot,dailyIndicators:{...snapshot.dailyIndicators,agencyCode:null}}})),/106J/);
  assert.equal(buildMatchExportIdentity(params()).pdf106j.referenceDate,"2026-09-11");
});

test("Lot E: forbids a brief from a different date or import revision", () => {
  assert.throws(()=>buildMatchExportIdentity(params({briefPlanScope:"058:2026-09-08:2026-11-10T07:00:00.000Z"})),/brief/);
  assert.throws(()=>buildMatchExportIdentity(params({briefPlanScope:"059:2026-09-09:2026-11-10T07:00:00.000Z"})),/brief/);
});

test("Lot E: a league change or KPI adjustment invalidates a previously frozen PDF", () => {
  const before=buildMatchExportIdentity(params());
  assert.throws(()=>assertMatchExportStillCurrent(before,params({league:{...league,id:"or"}})),/changé/);
  assert.throws(()=>assertMatchExportStillCurrent(before,params({kpis:{injuriesValue:"3",expectedPlayersValue:"18"}})),/changé/);
  assert.throws(()=>assertMatchExportStillCurrent(before,params({snapshot:{...snapshot,importedAt:"2026-11-10T07:10:00Z"},briefPlanScope:"058:2026-09-09:2026-11-10T07:10:00Z"})),/changé/);
});

test("Lot E: actual imported criteria win over current league defaults", () => {
  const ctx=buildMatchExportIdentity(params({league:{...league,loadingSeconds:200}}));
  assert.equal(ctx.performanceCriteria.loadingSeconds,165);
  assert.equal(ctx.criteriaSource,"snapshot");
});

test("Lot E: no key, credential, or other agency data appears in the manifest", () => {
  const ctx=buildMatchExportIdentity(params());
  assert.equal("accessCode" in ctx,false);
  assert.ok(!ctx.signature.includes("SECRET"));
});
