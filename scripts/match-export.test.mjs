import test from "node:test";
import assert from "node:assert/strict";
import pdfParse from "pdf-parse";
import { matchExportLeague, matchExportModel, MatchExportError } from "../server/match-export-model.mjs";
import { renderMatchPdf } from "../server/match-export-pdf.mjs";

const config = [{ id: "argent", zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 },
  { id: "or", zonageMinutes: 25, loadingSeconds: 150, unloadingSeconds: 55, scoreTargetPercent: 60 }];
const league = matchExportLeague("argent", config);
const importedAt = "2026-11-10T10:00:00.000Z";
const date = "2026-11-10";
const agency = code => ({ code, name: "AGENCE-" + code });
const makeSnapshot = code => ({
  agency: { code, detectedCode: code, name: "AGENCE-" + code },
  importedAt, sourceName: "TEST-" + code + ".xlsx",
  performanceCriteria: { ...league.criteria },
  match: { date, timeRangeLabel: "13:00 - 22:30", status: "MAITRISE", score: 2 },
  operationalScore: {
    status: "available", goalsFor: 3, goalsAgainst: 1, indicators: {
      passRate: 65, loadingPercent: 75, unloadingPercent: 72, possessionPercent: 59,
    },
  },
  summary: {
    positions: 150, operations: 200, players: 15, travels: 20, duelWon: 32, duelTotal: 40,
  },
  highlights: { manOfTheMatch: { name: "OPERATEUR-" + code, role: "CHG", value: 20, valueLabel: "points" } },
  yellowCards: [{ playerName: "OPERATEUR-" + code, reason: "Temperature", travelCode: "VOYAGE-" + code, time: "15:30" }],
  dailyIndicators: { agencyCode: code, punctuality: { arrivalPunctuality: 96 } },
  hourlyPerformance: [{ label: "13h", rate: 70 }, { label: "14h", rate: 75 }],
  loadingQuality: { targetedPercent: 88, offTargetPercent: 12 },
  unloadingDuelQuality: { wonPercent: 75, lostPercent: 25 },
  unloadingQuality: { targetedPercent: 80, offTargetPercent: 20 },
});
const build = (code, overrides = {}) => matchExportModel({
  agency: agency(code),
  snapshot: { ...makeSnapshot(code), ...(overrides.snapshot ?? {}) },
  league: overrides.league ?? league,
  causerie: overrides.causerie ?? {
    team: "Equipe-" + code, manager: "Manager-" + code,
    visibleIndicators: ["performance", "injuries", "accident-free-days", "arrival"],
    visibleIndicatorsVersion: 3,
    attack: ["Priorite-" + code], midfield: [], defense: [],
  },
  safety: { lastAccidentDate: "2026-11-01", counter: { days: 9 } },
  expectedMatchDate: overrides.expectedMatchDate ?? date,
  expectedImportedAt: overrides.expectedImportedAt ?? importedAt,
  manualInjuries: overrides.manualInjuries ?? 2,
});
function rejected(callback, status) {
  assert.throws(callback, e => e instanceof MatchExportError && e.status === status);
}

test("Lot E: valid league is selected with agency-specific stored criteria", () => {
  assert.equal(league.label, "LIGUE 1");
  assert.equal(matchExportLeague("or", config).criteria.scoreTargetPercent, 60);
  rejected(() => matchExportLeague("or", [{ id: "argent", ...config[0] }]), 409);
  rejected(() => matchExportLeague("foreign", config), 400);
});

test("Lot E: reject another agency's snapshot, Excel and PDF provenance", () => {
  rejected(() => matchExportModel({
    agency: agency("058"), snapshot: makeSnapshot("059"), league,
    expectedMatchDate: date, expectedImportedAt: importedAt,
  }), 409);
  rejected(() => build("058", { snapshot: { agency: { code: "058", detectedCode: "059" } } }), 409);
  rejected(() => build("058", { snapshot: { dailyIndicators: { agencyCode: "059" } } }), 409);
});

test("Lot E: reject stale match, stale import, nonmatching league KPI and invalid manual KPI", () => {
  rejected(() => build("058", { expectedMatchDate: "2026-11-09" }), 409);
  rejected(() => build("058", { expectedImportedAt: "2026-11-08T00:00:00Z" }), 409);
  rejected(() => build("058", { snapshot: { performanceCriteria: { ...league.criteria, loadingSeconds: 200 } } }), 409);
  rejected(() => build("058", { manualInjuries: 150 }), 400);
});

test("Lot E: different agencies and league thresholds cannot be mixed", async () => {
  const differentLeague = matchExportLeague("or", config);
  const model = build("059", {
    league: differentLeague,
    snapshot: { performanceCriteria: differentLeague.criteria },
  });
  const pdf = await pdfParse(renderMatchPdf(model));
  assert.match(pdf.text, /AGENCE-059/);
  assert.match(pdf.text, /LDC/);
  assert.match(pdf.text, /CHG <= 150 s\/poz/);
  assert.doesNotMatch(pdf.text, /CHG <= 165 s\/poz|AGENCE-058/);
  assert.doesNotMatch(pdf.text, /Tonnage distribution/);
});

test("Lot E: direct PDF is valid, includes selected league/KPIs/brief and isolates agencies", async () => {
  const model058 = build("058");
  const model059 = build("059");
  assert.deepEqual(model058.visibleIndicators, ["performance", "injuries", "accident-free-days", "arrival"]);
  assert.equal(model058.criteria.loadingSeconds, 165);
  const pdf058 = renderMatchPdf(model058);
  const pdf059 = renderMatchPdf(model059);
  assert.equal(pdf058.subarray(0, 8).toString("latin1"), "%PDF-1.4");
  const parsed058 = await pdfParse(pdf058);
  const parsed059 = await pdfParse(pdf059);
  assert.ok(parsed058.numpages >= 6, "All four match sections plus the carousel need several pages");
  assert.match(parsed058.text, /AGENCE-058/);
  assert.match(parsed058.text, /LIGUE 1/);
  assert.match(parsed058.text, /OPERATEUR-058/);
  assert.match(parsed058.text, /Equipe-058/);
  assert.match(parsed058.text, /Tirs cadres/);
  assert.doesNotMatch(parsed058.text, /AGENCE-059|OPERATEUR-059|Equipe-059/);
  assert.match(parsed059.text, /AGENCE-059|OPERATEUR-059/);
  assert.doesNotMatch(parsed059.text, /AGENCE-058|OPERATEUR-058/);
  assert.ok(!pdf058.equals(pdf059), "PDFs of different agencies must be distinct");
});
