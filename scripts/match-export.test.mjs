import test from "node:test";
import assert from "node:assert/strict";
import pdfParse from "pdf-parse";
import { matchExportLeague, matchExportModel, MatchExportError } from "../server/match-export-model.mjs";
import { renderMatchPdf } from "../server/match-export-pdf.mjs";
import { normalizePdfProfile, effectivePdfProfile, PDF_CHART_IDS } from "../server/match-pdf-profile.mjs";

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
      passRate: 65, loadingPercent: 88, unloadingPercent: 80, possessionPercent: 49,
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
  pdfProfile: overrides.pdfProfile ?? null,
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
  assert.equal(parsed058.numpages, 2, "The complete printable briefing must be exactly two pages");
  assert.equal(parsed059.numpages, 2);
  assert.match(parsed058.text, /AGENCE-058/);
  assert.match(parsed058.text, /LIGUE 1/);
  assert.match(parsed058.text, /Equipe-058/);
  assert.match(parsed058.text, /Tirs cadres/);
  assert.doesNotMatch(parsed058.text, /AGENCE-059|Equipe-059/);
  assert.match(parsed059.text, /AGENCE-059/);
  assert.doesNotMatch(parsed059.text, /AGENCE-058/);
  assert.ok(!pdf058.equals(pdf059), "PDFs of different agencies must be distinct");
});

test("Lot E V3: agency profile supports 4 to 6 known KPI and a chart", () => {
  const profile = normalizePdfProfile({
    indicatorIds: ["positions", "arrival", "temperature", "performance"],
    chartId: "centers",
    dailyBrief: { matchDate: date, priorities: "Sécuriser les départs" },
  }, { strict: true });
  assert.equal(profile.indicatorIds.length, 4);
  assert.equal(profile.dailyBrief.priorities, "Sécuriser les départs");
  assert.throws(() => normalizePdfProfile({
    indicatorIds: ["positions", "arrival", "temperature", "performance", "injuries", "departure", "destination"],
  }, { strict: true }), /6 KPI/);
  assert.equal(normalizePdfProfile({ indicatorIds: ["positions", "arrival", "temperature", "performance", "injuries", "departure"] }, { strict: true }).indicatorIds.length, 6);
  assert.throws(() => normalizePdfProfile({ chartId: "unknown" }), /inconnu/);
  const active = effectivePdfProfile(profile, ["positions", "performance"], date);
  assert.deepEqual(active.indicatorIds, ["positions", "performance"]);
  assert.equal(effectivePdfProfile(profile, ["positions"], "2026-11-11").dailyBrief.priorities, "");
});

test("Lot E V3: all 5 chart choices are supported without generating extra pages", async () => {
  for (const chartId of PDF_CHART_IDS) {
    const model = build("058", {
      pdfProfile: { indicatorIds: ["positions"], chartId },
    });
    const pdf = await pdfParse(renderMatchPdf(model));
    assert.equal(pdf.numpages, 2, chartId);
    assert.match(pdf.text, /Positions/);
    assert.doesNotMatch(pdf.text, /Ponctualite arrivage|Blessures A.T/i);
  }
});

test("Lot E V2: an excessive brief must fail instead of silently spilling or being truncated", () => {
  const model = build("058", { causerie: {
    visibleIndicators: ["positions"], visibleIndicatorsVersion: 2,
    attack: ["Surcharge opérationnelle ".repeat(180)], midfield: [], defense: [],
  } });
  rejected(() => renderMatchPdf(model), 422);
  model.pdfProfile = {
    indicatorIds: ["positions"], chartId: "loading",
    dailyBrief: { matchDate: date, attack: "Vérifier les quais avant le départ." },
  };
  assert.equal((renderMatchPdf(model).toString("latin1").match(/\/Type \/Page \/Parent/g) ?? []).length, 2);
});

test("Lot E V3: 4, 5 or 6 complementary KPIs do not overlap the chart or create a third page", async () => {
  const ids = ["performance", "injuries", "accident-free-days", "positions", "arrival", "departure"];
  for (const count of [4, 5, 6]) {
    const selected = ids.slice(0, count);
    const model = build("058", {
      causerie: { visibleIndicators: ids, visibleIndicatorsVersion: 2, attack: ["Message service client"], midfield: ["Départs prioritaires"], defense: ["Vigilance SST"] },
      pdfProfile: { indicatorIds: selected, chartId: "passes-hourly" },
    });
    const parsed = await pdfParse(renderMatchPdf(model));
    assert.equal(parsed.numpages, 2, count + " KPI");
    assert.match(parsed.text, /SERVICE CLIENT/i);
    assert.match(parsed.text, /EXPÉDITION \/ RAMASSE & EMBALLAGE/i);
    assert.match(parsed.text, /SST/);
    assert.match(parsed.text, /Message service client/);
    assert.match(parsed.text, /Vigilance SST/);
    if (count === 6) assert.match(parsed.text, /Ponctualite depart/);
    if (count === 4) assert.doesNotMatch(parsed.text, /Ponctualite depart/);
  }
});


test("Lot E V4: first export fills four visible KPIs without re-enabling hidden cards", async () => {
  const visible = ["departure", "temperature", "tonnage-expedition", "destination", "positions", "arrival"];
  const first = effectivePdfProfile(null, visible, date);
  assert.equal(first.indicatorIds.length, 4);
  assert.deepEqual(first.indicatorIds, ["positions", "arrival", "departure", "temperature"]);
  assert.ok(first.indicatorIds.every(id => visible.includes(id)));
  const sparse = effectivePdfProfile({ indicatorIds: ["positions"], chartId: "centers" }, visible, date);
  assert.deepEqual(sparse.indicatorIds, ["positions", "departure", "temperature", "tonnage-expedition"]);
  const few = effectivePdfProfile(null, ["temperature", "positions"], date);
  assert.deepEqual(few.indicatorIds, ["positions", "temperature"]);
  const snapshot = { ...makeSnapshot("058") };
  const model = matchExportModel({
    agency: agency("058"), snapshot, league, expectedMatchDate: date, expectedImportedAt: importedAt,
    causerie: { visibleIndicators: visible, visibleIndicatorsVersion: 2, attack: [], midfield: [], defense: [] },
  });
  const pdf = await pdfParse(renderMatchPdf(model));
  assert.equal(pdf.numpages, 2);
  assert.match(pdf.text, /PONCTUALITE DEPART/i);
  assert.doesNotMatch(pdf.text, /BLESSURES A.T/i);
});

test("Lot E V4: image-only service brief cannot disappear silently from the PDF", async () => {
  for (const [zone, title] of [["attack", "Service client"], ["midfield", "Expédition"], ["defense", "SST"]]) {
    const causerie = {
      visibleIndicators: ["positions", "arrival", "departure", "temperature"], visibleIndicatorsVersion: 2,
      attack: [], midfield: [], defense: [],
      attachments: { attack: [], midfield: [], defense: [], [zone]: ["data:image/jpeg;base64,TEST-CAPTURE"] },
    };
    const model = build("058", { causerie });
    assert.throws(() => renderMatchPdf(model),
      error => error instanceof MatchExportError && error.status === 422 && error.message.includes(title));
    model.pdfProfile = {
      indicatorIds: ["positions", "arrival", "departure", "temperature"], chartId: "centers",
      dailyBrief: { matchDate: date, [zone]: "Synthèse validée pour la réunion opérationnelle." },
    };
    const parsed = await pdfParse(renderMatchPdf(model));
    assert.equal(parsed.numpages, 2);
    assert.match(parsed.text, /Synthèse validée pour la réunion opérationnelle/);
    assert.match(parsed.text, /Captures sur le site/i);
    model.pdfProfile.dailyBrief.matchDate = "2026-11-11";
    rejected(() => renderMatchPdf(model), 422);
  }
});

test("Lot E V4: reception chart plots actual seconds per position, target and slots", async () => {
  const analysis = { state: "disponible", targetSeconds: 60, items: [
    { label: "13h", start: "13:00", state: "disponible", distinctPositions: 30, meanSecondsPerPosition: 45 },
    { label: "14h", start: "14:00", state: "disponible", distinctPositions: 22, meanSecondsPerPosition: 92 },
    { label: "15h", start: "15:00", state: "indisponible", distinctPositions: 0, meanSecondsPerPosition: null },
  ] };
  const model = build("058", {
    snapshot: { unloadingHourlyAnalysis: analysis },
    pdfProfile: { indicatorIds: ["performance"], chartId: "reception-time" },
  });
  const first = renderMatchPdf(model);
  const parsed = await pdfParse(first);
  assert.equal(parsed.numpages, 2);
  assert.match(parsed.text, /Barres : moyenne en s\/position/);
  assert.match(parsed.text, /Cible : 60 s\/poz/);
  assert.match(parsed.text, /2 créneaux exploitables/);
  assert.match(parsed.text, /Positions\/créneau : 22 à 30/);
  model.unloadingHourlyAnalysis.items[1].meanSecondsPerPosition = 54;
  const changed = renderMatchPdf(model);
  assert.ok(!first.equals(changed), "Changing measured seconds must change the chart geometry/colors");
});


test("Lot E V5: compare five PDF summaries with canonical source metrics across all four league configurations", async () => {
  const allConfigs = [
    { id: "bronze", zonageMinutes: 35, loadingSeconds: 185, unloadingSeconds: 70, scoreTargetPercent: 45 },
    { id: "argent", zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 },
    { id: "or", zonageMinutes: 25, loadingSeconds: 150, unloadingSeconds: 55, scoreTargetPercent: 60 },
    { id: "platine", zonageMinutes: 20, loadingSeconds: 130, unloadingSeconds: 45, scoreTargetPercent: 70 },
  ];
  for (const criteria of allConfigs) {
    const selectedLeague = matchExportLeague(criteria.id, allConfigs);
    const snapshot = {
      performanceCriteria: { ...selectedLeague.criteria },
      operationalScore: {
        status: "available", targetPercent: criteria.scoreTargetPercent,
        goalsFor: [65, 80, 72, 59].filter(value => value > criteria.scoreTargetPercent).length,
        goalsAgainst: [65, 80, 72, 59].filter(value => value <= criteria.scoreTargetPercent).length,
        indicators: { passRate: 65, loadingPercent: 80, unloadingPercent: 72, possessionPercent: 59 },
        loading: { targetSeconds: criteria.loadingSeconds },
      },
      loadingQuality: { targeted: 8, offTarget: 2, targetedPercent: 80, offTargetPercent: 20 },
      unloadingQuality: { targeted: 72, offTarget: 28, targetedPercent: 72, offTargetPercent: 28 },
      unloadingHourlyAnalysis: {
        state: "disponible", targetSeconds: criteria.unloadingSeconds,
        items: [
          { start: "2026-11-10T21:00:00.000Z", label: "22h", state: "disponible", meanSecondsPerPosition: 30, distinctPositions: 15 },
          { start: "2026-11-10T23:00:00.000Z", state: "disponible", meanSecondsPerPosition: 90, distinctPositions: 30 },
        ],
      },
      zonageDiagnostic: {
        state: "disponible", targetMinutes: criteria.zonageMinutes,
        receivedPositions: 100, qualifiablePositions: 80, latePositions: 14, onTimePositions: 66,
        unqualifiablePositions: 20, anomalyRate: 17.5, coverageRate: 80,
        top5: [{ travelCode: "TEST-RETARD-01", latePositions: 12 }],
      },
      dailyIndicators: {
        agencyCode: "058", referenceDate: "2026-11-09", sourceName: "FAUX-106J.pdf",
        punctuality: { arrivalPunctuality: 96, destinationPunctuality: 92 },
        punctualityTargets: { destinationPunctuality: 88 },
        expedition: { tonnage: 9 },
      },
      hourlyPerformance: [
        { label: "13h", rate: 80, won: 8, total: 10 },
        { label: "14h", rate: 40, won: 2, total: 5 },
      ],
    };
    for (const chartId of PDF_CHART_IDS) {
      const model = build("058", {
        league: selectedLeague, snapshot,
        pdfProfile: { indicatorIds: ["performance", "injuries", "accident-free-days", "arrival"], chartId },
      });
      const parsed = await pdfParse(renderMatchPdf(model));
      assert.equal(parsed.numpages, 2, criteria.id + ":" + chartId);
      assert.match(parsed.text, new RegExp(selectedLeague.label));
      assert.ok(parsed.text.includes("CHG <= " + criteria.loadingSeconds + " s/poz"));
      assert.ok(parsed.text.includes("DECHG <= " + criteria.unloadingSeconds + " s/poz"));
      assert.ok(parsed.text.includes("Zonage <= " + criteria.zonageMinutes + " min"));
      if (chartId === "passes-hourly") {
        assert.match(parsed.text, /Total filtré : 66,7 %/i);
        assert.match(parsed.text, /périmètre distinct du KPI officiel/i);
      } else if (chartId === "reception-time") {
        assert.ok(parsed.text.includes("Cible : " + criteria.unloadingSeconds + " s/poz"));
        assert.match(parsed.text, /22h/);
        assert.match(parsed.text, /00h/);
        assert.match(parsed.text, /Positions\/créneau : 15 à 30/);
        assert.match(parsed.text, /Duels au score : 72 %/i);
      } else if (chartId === "loading") {
        assert.match(parsed.text, /Chargements cadrés/i);
        assert.match(parsed.text, /8 \/ 10/);
        assert.ok(parsed.text.includes("Temps par position <= " + criteria.loadingSeconds));
      } else if (chartId === "centers") {
        assert.match(parsed.text, /Source PDF 106J du 2026-11-09/);
        assert.match(parsed.text, /92 %/);
        assert.match(parsed.text, /Objectif 106J : 88 %/);
        assert.match(parsed.text, /pas le seuil de ligue/);
      } else {
        assert.ok(parsed.text.includes("Cible zonage <= " + criteria.zonageMinutes + " min"));
        assert.match(parsed.text, /Hors délai : 14\/80/i);
        assert.match(parsed.text, /TEST-RETARD-01/);
        assert.match(parsed.text, /Couverture.*80 %/);
      }
    }
  }
});

test("Lot E V5: reject internal chart thresholds from an obsolete league even when root criteria match", () => {
  const active = league.criteria;
  const score = makeSnapshot("058").operationalScore;
  rejected(() => build("058", { snapshot: {
    operationalScore: { ...score, targetPercent: active.scoreTargetPercent + 5 },
  } }), 409);
  rejected(() => build("058", { snapshot: {
    operationalScore: { ...score, loading: { targetSeconds: active.loadingSeconds - 10 } },
  } }), 409);
  rejected(() => build("058", { snapshot: {
    unloadingHourlyAnalysis: { state: "disponible", targetSeconds: active.unloadingSeconds + 5, items: [] },
  } }), 409);
  rejected(() => build("058", { snapshot: {
    zonageDiagnostic: { state: "disponible", targetMinutes: active.zonageMinutes + 5 },
  } }), 409);
});

test("Lot E V5: missing source must not masquerade as a zero KPI in charts", async () => {
  for (const chartId of ["loading", "centers", "operational-diagnostic", "reception-time"]) {
    const model = build("058", { snapshot: {
      loadingQuality: null, dailyIndicators: null,
      zonageDiagnostic: { state: "indisponible", targetMinutes: league.criteria.zonageMinutes },
      unloadingHourlyAnalysis: { state: "indisponible", targetSeconds: league.criteria.unloadingSeconds, items: [] },
    }, pdfProfile: { indicatorIds: ["performance"], chartId } });
    const parsed = await pdfParse(renderMatchPdf(model));
    assert.equal(parsed.numpages, 2);
    assert.match(parsed.text, /indisponible|Aucun/i);
  }
});


test("Lot E V5: block charts when the score disagrees with canonical loading, unloading or result counts", () => {
  const root = makeSnapshot("058");
  rejected(() => build("058", { snapshot: {
    operationalScore: { ...root.operationalScore, indicators: {
      ...root.operationalScore.indicators, loadingPercent: 52,
    } },
  } }), 409);
  rejected(() => build("058", { snapshot: {
    operationalScore: { ...root.operationalScore, indicators: {
      ...root.operationalScore.indicators, unloadingPercent: 52,
    } },
  } }), 409);
  rejected(() => build("058", { snapshot: {
    operationalScore: { ...root.operationalScore, goalsFor: 4, goalsAgainst: 0 },
  } }), 409);
});
