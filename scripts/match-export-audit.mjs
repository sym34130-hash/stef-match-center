import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { matchExportLeague, matchExportModel } from "../server/match-export-model.mjs";
import { renderMatchPdf } from "../server/match-export-pdf.mjs";
import { PDF_CHART_IDS } from "../server/match-pdf-profile.mjs";

const out = process.env.STEF_PDF_AUDIT_DIR || "artifacts/lot-e-audit";
await fs.mkdir(out, { recursive: true });
const fixtures = [
  { code: "058", league: "argent", visible: ["performance", "injuries", "accident-free-days", "positions", "arrival", "departure"] },
  { code: "059", league: "or", visible: ["performance", "tonnage-expedition", "tonnage-distribution", "temperature"] },
  { code: "060", league: "bronze", visible: ["performance", "positions", "arrival", "temperature", "destination"] },
  { code: "061", league: "platine", visible: ["performance", "injuries", "positions", "destination", "departure", "temperature"] },
];
const configs = [
  { id: "argent", zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 },
  { id: "or", zonageMinutes: 25, loadingSeconds: 150, unloadingSeconds: 55, scoreTargetPercent: 60 },
  { id: "bronze", zonageMinutes: 35, loadingSeconds: 185, unloadingSeconds: 70, scoreTargetPercent: 45 },
  { id: "platine", zonageMinutes: 20, loadingSeconds: 130, unloadingSeconds: 45, scoreTargetPercent: 70 },
];
for (const fixture of fixtures) {
  const league = matchExportLeague(fixture.league, configs);
  const code = fixture.code, date = "2026-11-10", importedAt = "2026-11-10T09:00:00.000Z";
  const players = ["ATTAQUANT", "DEFENSEUR", "MILIEU", "POLYVALENT"].map((kind, i) => ({
    name: kind + "-" + code, role: kind, operations: 50 - i * 4,
    positions: 42 - i * 4, byType: { CHG: 30-i*3, DECHG: 20-i*2, ZONAGE: 18-i*2 },
    positionsByType: { CHG: 25-i*2, DECHG: 16-i*2, ZONAGE: 12-i },
    operationTypes: i === 3 ? 3 : 1, polyvalence: i === 3 ? 87 : 25,
  }));
  // Synthetic examples, not production agency thresholds.
  const rates = { passRate: 75, loadingPercent: 85, unloadingPercent: 69, possessionPercent: 52 };
  const goalsFor = Object.values(rates).filter(value => value > league.criteria.scoreTargetPercent).length;
  const snapshot = {
    agency: { code, name: "AGENCE TEST " + code, detectedCode: code }, sourceName: "FAUX_Excel-" + code + ".xlsx",
    importedAt, performanceCriteria: { ...league.criteria },
    match: { date, periodStart: "13:00", periodEnd: "22:30", timeRangeLabel: "13:00 - 22:30", status: "MAITRISE" },
    operationalScore: { status: "available", targetPercent: league.criteria.scoreTargetPercent, goalsFor, goalsAgainst: 4 - goalsFor,
      indicators: rates, loading: { targetSeconds: league.criteria.loadingSeconds } },
    summary: { operations: 500, positions: 310, players: 19, travels: 44, duelWon: 80, duelTotal: 101 },
    players, highlights: {
      bestScorer: { name: players[0].name, value: 70, role: "Attaquant" },
      defensiveWall: { name: players[1].name, value: 65, role: "Defenseur" },
      bestPasser: { name: players[2].name, value: 60, role: "Milieu" },
      manOfTheMatch: { name: players[0].name, value: 60, role: "Attaquant" },
    },
    yellowCards: Array.from({ length: 18 }, (_, i) => ({
      playerName: "OPERATEUR-" + code + "-" + i, travelCode: "TR" + i,
      time: "15:30", reason: "Controle temperature",
    })),
    dailyIndicators: { agencyCode: code, sourceName: "106J-SYNTHETIQUE.pdf", referenceDate: "2026-11-09",
      punctualityTargets: { destinationPunctuality: 91 }, punctuality: {
      arrivalPunctuality: 96, departurePunctuality: 94,
      destinationPunctuality: 92, temperatureReturn: 97 },
      distribution: { tonnage: 7.2 }, expedition: { tonnage: 14.4 } },
    hourlyPerformance: Array.from({ length: 24 }, (_, i) => {
      const won = 10 + i, total = 25 + i;
      return { label: String((13 + i) % 24).padStart(2, "0") + "h", hour: i,
        won, total, rate: Math.round(won / total * 1000) / 10 };
    }),
    unloadingHourlyAnalysis: { state: "disponible", targetSeconds: league.criteria.unloadingSeconds,
      items: Array.from({ length: 23 }, (_, i) => ({
        start: new Date(Date.UTC(2026, 10, 10, 12 + i)).toISOString(),
        label: String((13 + i) % 24).padStart(2, "0") + "h",
        meanSecondsPerPosition: 22+i*3, distinctPositions: 10+i, state: "disponible" })) },
    loadingQuality: { targeted: 85, offTarget: 15, targetedPercent: 85, offTargetPercent: 15 },
    unloadingQuality: { targeted: 69, offTarget: 31, targetedPercent: 69, offTargetPercent: 31 },
    unloadingDuelQuality: { wonPercent: 67, lostPercent: 33 },
    zonageDiagnostic: { state: "disponible", targetMinutes: league.criteria.zonageMinutes,
      receivedPositions: 160, latePositions: 12, onTimePositions: 138, unqualifiablePositions: 10,
      qualifiablePositions: 150, anomalyRate: 8, coverageRate: 93.75,
      top5: [{ travelCode: "EX-001", latePositions: 8 }] },
    anomalySummary: { unloading: { offTargetTravels: 2, eligibleTravels: 23 },
      loading: { offTargetTravels: 3, eligibleTravels: 27 } },
  };
  const causerie = {
    briefLayoutVersion: 2, visibleIndicatorsVersion: 2, visibleIndicators: fixture.visible,
    team: "TEST GROUPE-" + code, manager: "TEST RESPONSABLE-" + code,
    attack: ["PRIORITES DE TEST " + "controle quai / ".repeat(150) + "FIN-DU-BRIEF-TEST-" + code],
    midfield: ["ZONAGE : horodatage et attribution a clarifier avant le depart."],
    defense: ["RECEPTION : fiabiliser le creneau reel avant la promesse."],
    coach: { tactic: "Vérifier le départ camion", priority: "Suivi des écarts", arbitration: "Arbitrer à quai" },
    mercato: "Nouveau collaborateur sur la plage test", redCards: "",
    attachments: { attack: ["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAsICAoIBwsKCQoNDAsNERwSEQ8PESIZGhQcKSQrKigkJyctMkA3LTA9MCcnOEw5PUNFSElIKzZPVU5GVEBHSEX/2wBDAQwNDREPESESEiFFLicuRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUX/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJgAyOf/2Q=="], midfield: [], defense: [] },
  };
  const model = matchExportModel({ agency: { code, name: "AGENCE TEST " + code },
    snapshot, causerie, league,
    expectedMatchDate: date, expectedImportedAt: importedAt,
    manualInjuries: 2, manualExpectedPlayers: 20 });

  // The complete 2,000+ character instructions cannot fit on A4: refuse to
  // silently cut critical text. A date-scoped short summary makes it printable.
  assert.throws(() => renderMatchPdf(model), e => e.status === 422);

  for (const chartId of PDF_CHART_IDS) {
    model.pdfProfile = {
      indicatorIds: fixture.visible.slice(0, 6),
      chartId,
      dailyBrief: { matchDate: date, attack: "FIN-DU-BRIEF-TEST-" + code },
    };
    const pdf = renderMatchPdf(model);
    const pdfText = pdf.toString("latin1");
    const pages = (pdfText.match(/\/Type \/Page \/Parent/g) ?? []).length;
    assert.equal(pdfText.slice(0, 8), "%PDF-1.4");
    assert.equal(pages, 2, chartId + ": must never create a third page");
    assert.match(pdfText, new RegExp("FIN-DU-BRIEF-TEST-" + code));
    assert.ok(pdfText.includes(league.label));
    assert.ok(pdfText.includes("Zonage <= " + league.criteria.zonageMinutes + " min"));
    assert.ok(pdfText.includes("CHG <= " + league.criteria.loadingSeconds + " s/poz"));
    assert.ok(pdfText.includes("DECHG <= " + league.criteria.unloadingSeconds + " s/poz"));
    assert.match(pdfText, /BRIEF OPERATIONNEL DU JOUR|SERVICE CLIENT/);
    const expectedText = {
      "passes-hourly": "Total filtré",
      "reception-time": "Cible : " + league.criteria.unloadingSeconds + " s/poz",
      loading: "Temps par position",
      centers: "Source PDF 106J du 2026-11-09",
      "operational-diagnostic": "Cible zonage",
    }[chartId];
    assert.ok(pdfText.includes(expectedText), chartId + ": missing target/source " + expectedText);
    assert.doesNotMatch(pdfText, /\/Subtype \/Image/, "No screenshots in two-page summary");
    const filename = path.join(out, "SYNTHETIC_MATCH_" + code + "_" + league.label.replace(/ /g, "_") + "_" + chartId + ".pdf");
    await fs.writeFile(filename, pdf);
    console.log(filename + " / pages=" + pages + " / bytes=" + pdf.length);
  }
}
