import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { buildOperationalAnalyses, operationalAnalysisNeedsRefresh, OPERATIONAL_ANALYSIS_VERSION } from "../server/operational-analysis.mjs";
import { buildSnapshotFromWorkbook, normalizeSnapshotContract, normalizeTimeRange } from "../server/match-engine.mjs";

const criteria = { zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 };
const row = (operationType, position, clock, travelCode = "A", day = "2026-09-17", offset = "+02:00") => ({
  operationType, position, travelCode, startedAt: new Date(`${day}T${clock}${offset}`),
  operator: "Anonymous", operatorFilter: "", unzonedFilter: "", agencySegment: "01K", dz: null, duelWonFlag: 1,
});
const analyze = (rows, options = {}) => buildOperationalAnalyses({ rows,
  period: normalizeTimeRange("21:30", "06:30"), criteria, loadingQuality: { sourceAvailable: false }, ...options });

test("zonage : position répétée, code ZONAGE vide, réception attribuée sans le CHG", () => {
  const rec = row("DECHG", "P1", "22:00:00", "IN");
  const result = analyze([rec, { ...rec }, row("ZONAGE", "P1", "22:10:00", ""), row("CHG", "P1", "23:00:00", "OUT")]);
  const z = result.zonageDiagnostic;
  assert.equal(z.receivedPositions, 1); assert.equal(z.qualifiablePositions, 1);
  assert.equal(z.onTimePositions, 1); assert.equal(z.repeatedReceptionPositions, 1);
  assert.equal(z.travels[0].travelCode, "IN"); assert.equal(z.travels.length, 1);
  assert.equal(z.coverageRate, 100); assert.equal(z.anomalyRate, 0);
});

test("zonage : première opération postérieure, jamais une opération antérieure", () => {
  const z = analyze([row("ZONAGE", "P", "22:00:00", ""), row("DECHG", "P", "22:10:00"),
    row("ZONAGE", "P", "22:45:00", ""), row("ZONAGE", "P", "23:00:00", "")]).zonageDiagnostic;
  assert.equal(z.latePositions, 1); assert.equal(z.details[0].delaySeconds, 2100);
  assert.equal(z.travels[0].averageExcessSeconds, 300);
});

test("zonage : aucune association entre deux nuits", () => {
  const z = analyze([row("DECHG", "P", "23:00:00"), row("CHG", "Q", "23:01:00"),
    row("ZONAGE", "P", "00:10:00", "", "2026-09-19")]).zonageDiagnostic;
  assert.equal(z.unqualifiablePositions, 1); assert.equal(z.qualifiablePositions, 0);
  assert.equal(z.night.otherNightOperations, 1); assert.equal(z.anomalyRate, null);
});

test("zonage : réceptions contradictoires non attribuées", () => {
  const z = analyze([row("DECHG", "P", "22:00:00", "A"), row("DECHG", "P", "22:01:00", "B"), row("ZONAGE", "P", "22:10:00", "")]).zonageDiagnostic;
  assert.equal(z.unattributedPositions, 1); assert.equal(z.unqualifiablePositions, 1);
  assert.equal(z.travels.length, 0); assert.equal(z.details[0].travelCode, null);
  assert.equal(z.details[0].reason, "receptions_contradictoires");
});

test("zonage : code réception absent et position différente ne créent pas d'association", () => {
  const z = analyze([row("DECHG", "P", "22:00:00", ""), row("ZONAGE", "Q", "22:01:00", "A")]).zonageDiagnostic;
  assert.equal(z.unqualifiablePositions, 1); assert.equal(z.positionsWithoutReception, 1);
  assert.equal(z.details[0].reason, "voyage_reception_absent"); assert.equal(z.state, "indisponible");
});

test("zonage : absence ou zonage uniquement antérieur ne sont pas des retards", () => {
  const z = analyze([row("DECHG", "P", "22:00:00"), row("ZONAGE", "Q", "22:00:00", ""), row("DECHG", "Q", "22:05:00")]).zonageDiagnostic;
  assert.equal(z.latePositions, 0); assert.equal(z.unqualifiablePositions, 2);
  assert.deepEqual(z.unqualifiableReasons, { zonage_absent: 1, zonage_uniquement_anterieur: 1 });
});

test("zonage : frontière exacte et dépassement d'une seconde", () => {
  const z = analyze([row("DECHG", "P", "22:00:00"), row("ZONAGE", "P", "22:30:00", ""),
    row("DECHG", "Q", "22:00:00"), row("ZONAGE", "Q", "22:30:01", "")]).zonageDiagnostic;
  assert.equal(z.onTimePositions, 1); assert.equal(z.latePositions, 1); assert.equal(z.anomalyRate, 50);
  assert.equal(z.travels[0].averageExcessSeconds, 1);
});

test("zonage : taux sur qualifiables, couverture et classement déterministe", () => {
  const rows = [row("DECHG", "P", "22:00:00", "B"), row("ZONAGE", "P", "22:40:00", ""),
    row("DECHG", "Q", "22:00:00", "B"), row("DECHG", "R", "22:00:00", "A"), row("ZONAGE", "R", "22:40:00", "")];
  const z = analyze(rows).zonageDiagnostic;
  assert.deepEqual(z.top5.map(t => t.travelCode), ["A", "B"]);
  assert.equal(z.travels[1].anomalyRate, 100); assert.equal(z.travels[1].coverageRate, 50);
  assert.equal(z.anomalyRate, 100); assert.equal(z.coverageRate, 66.7);
  assert.equal(z.receivedPositions, z.onTimePositions + z.latePositions + z.unqualifiablePositions);
  assert.deepEqual(analyze([...rows].reverse()).zonageDiagnostic, z);
});

test("réception : convention par lignes conservée et absence de durée exclue", () => {
  const h = analyze([row("DECHG", "P", "22:00:00"), row("DECHG", "P", "22:02:00"),
    row("DECHG", "Q", "22:01:00", "SINGLE")]).unloadingHourlyAnalysis;
  assert.equal(h.eligibleTravels, 1); assert.equal(h.excludedZeroDurationTravels, 1);
  assert.equal(h.travels[0].operationRows, 2); assert.equal(h.travels[0].distinctPositions, 1);
  assert.equal(h.meanSecondsPerPosition, 60); assert.equal(h.offTargetTravels, 0);
});

test("réception : même voyage traversant minuit affecté une seule fois au début", () => {
  const h = analyze([row("DECHG", "P", "23:59:00"), row("DECHG", "Q", "00:01:00", "A", "2026-09-18")]).unloadingHourlyAnalysis;
  assert.equal(h.eligibleTravels, 1); assert.equal(h.meanSecondsPerPosition, 60);
  assert.deepEqual(h.items.filter(s => s.travelCount).map(s => s.label), ["23h"]);
});

test("réception : TVE100 réutilisé sur deux nuits sans mélange", () => {
  const rows = [row("DECHG", "OLD", "03:37:37", "TVE100"), row("DECHG", "P", "04:10:15", "TVE100", "2026-09-18"), row("DECHG", "Q", "04:24:58", "TVE100", "2026-09-18")];
  const result = analyze(rows), h = result.unloadingHourlyAnalysis;
  assert.equal(h.night.startDate, "2026-09-17"); assert.equal(h.night.otherNightOperations, 1);
  assert.equal(h.travels[0].operationRows, 2); assert.equal(h.travels[0].timePerPositionSeconds, 883 / 2);
  assert.equal(h.items.find(s => s.label === "04h").travelCount, 1);
  assert.equal(h.items.find(s => s.label === "03h").travelCount, 0);
});

test("nuit : égalité des volumes départagée par la date la plus récente", () => {
  const result = analyze([row("DECHG", "P", "22:00:00"), row("DECHG", "Q", "22:02:00"),
    row("DECHG", "P", "22:00:00", "A", "2026-09-18"), row("DECHG", "Q", "22:02:00", "A", "2026-09-18")]);
  assert.equal(result.zonageDiagnostic.night.startDate, "2026-09-18");
  assert.equal(result.unloadingHourlyAnalysis.travels[0].operationRows, 2);
});

test("nuit : un groupe plus récent mais isolé ne remplace pas la nuit principale", () => {
  const result = analyze([row("DECHG", "P", "22:00:00"), row("DECHG", "Q", "22:01:00"), row("DECHG", "R", "22:00:00", "B", "2026-09-20")]);
  assert.equal(result.zonageDiagnostic.night.startDate, "2026-09-17");
});

test("réception : moyenne arithmétique des ratios, pas moyenne pondérée", () => {
  const h = analyze([row("DECHG", "P", "22:00:00", "A"), row("DECHG", "Q", "22:02:00", "A"),
    row("DECHG", "R", "22:00:00", "B"), row("DECHG", "S", "22:10:00", "B"), row("DECHG", "T", "22:20:00", "B")]).unloadingHourlyAnalysis;
  const slot = h.items.find(s => s.label === "22h");
  assert.equal(slot.meanSecondsPerPosition, 230); assert.equal(slot.travelCount, 2);
  assert.equal(slot.operationRows, 5); assert.equal(slot.distinctPositions, 5);
  assert.equal(slot.offTargetPercent, 50); assert.equal(slot.offTargetTravels, 1);
});

test("réception : créneaux partiels et minute de fin incluse", () => {
  const h = analyze([row("DECHG", "P", "21:30:00"), row("DECHG", "Q", "21:32:00"),
    row("DECHG", "R", "06:30:00", "B", "2026-09-18"), row("DECHG", "S", "06:30:59", "B", "2026-09-18")]).unloadingHourlyAnalysis;
  assert.equal(h.items[0].start, "2026-09-17T19:30:00.000Z"); assert.equal(h.items[0].end, "2026-09-17T20:00:00.000Z");
  assert.equal(h.items.at(-1).end, "2026-09-18T04:30:00.000Z");
  assert.equal(h.items.at(-1).travelCount, 1); assert.equal(h.items.at(-1).endInclusiveMinute, true);
  assert.equal(h.items.reduce((n, s) => n + s.travelCount, 0), h.eligibleTravels);
});

test("Europe/Paris : durée réelle lors du passage à l'heure d'hiver", () => {
  const h = analyze([row("DECHG", "P", "02:10:00", "A", "2026-10-25", "+02:00"), row("DECHG", "Q", "02:20:00", "A", "2026-10-25", "+01:00")]).unloadingHourlyAnalysis;
  assert.equal(h.night.startDate, "2026-10-24"); assert.equal(h.travels[0].timePerPositionSeconds, 2100);
  assert.equal(h.items.filter(s => s.label === "02h").length, 2);
  assert.equal(h.items.reduce((n, s) => n + s.travelCount, 0), 1);
});

test("Europe/Paris : borne ambiguë indisponible plutôt que devinée", () => {
  const a = analyze([row("DECHG", "P", "02:10:00", "A", "2026-10-25", "+02:00")], { period: normalizeTimeRange("02:00", "06:30") });
  assert.equal(a.zonageDiagnostic.state, "indisponible");
  assert.equal(a.zonageDiagnostic.reason, "borne_horaire_ambigue_ou_inexistante");
});

test("absence de données : indisponible, taux null, aucun faux zéro", () => {
  const a = analyze([]); assert.equal(a.zonageDiagnostic.state, "indisponible");
  assert.equal(a.zonageDiagnostic.anomalyRate, null); assert.equal(a.unloadingHourlyAnalysis.meanSecondsPerPosition, null);
  assert.equal(a.anomalySummary.state, "indisponible");
  assert.equal(analyze([row("DECHG", "P", "invalid")]).zonageDiagnostic.night, null);
});

test("ligues et critères personnalisés : seuils actifs uniquement", () => {
  const rows = [row("DECHG", "P", "22:00:00"), row("ZONAGE", "P", "22:27:01", ""), row("DECHG", "Q", "22:02:00")];
  for (const [zonageMinutes, unloadingSeconds] of [[45, 75], [30, 60], [25, 55], [20, 50], [27, 52]]) {
    const a = analyze(rows, { criteria: { ...criteria, zonageMinutes, unloadingSeconds } });
    assert.equal(a.zonageDiagnostic.latePositions, zonageMinutes <= 27 ? 1 : 0);
    assert.equal(a.unloadingHourlyAnalysis.offTargetTravels, unloadingSeconds < 60 ? 1 : 0);
    assert.equal(a.unloadingHourlyAnalysis.targetSeconds, unloadingSeconds);
  }
});

const headers = ["Operateur", "Date Heure de debut d operation", "Type operation", "N position", "Code voyage", "Agence segment", "Type segment", "Filtre operateur", "Filtre heure", "Poste", "Poz non zonees", "DZ", "Duels gagnes", "Heure OP"];
function workbook(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows.map(r => [r.operator, r.startedAt.toISOString(), r.operationType, r.position, r.travelCode, r.agencySegment, "", r.operatorFilter, "", "", r.unzonedFilter, 10 / 1440, 1, Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(r.startedAt))])]), "Données");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

test("intégration : Excel partiel, filtres opérateur/exclusions/plage, sans API inventée", () => {
  const buffer = workbook([row("DECHG", "P", "22:00:00", "A"), row("DECHG", "Q", "22:02:00", "A"), row("ZONAGE", "P", "22:20:00", ""),
    row("DECHG", "R", "23:00:00", "B"), { ...row("DECHG", "S", "22:01:00", "FILTERED"), operatorFilter: "x" }]);
  const s = buildSnapshotFromWorkbook(buffer, "partial.xlsx", "01K", { start: "21:30", end: "06:30", excludedTravelCodes: ["B"] }).snapshot;
  assert.equal(s.validation.importReadiness.status, "partial"); assert.equal(s.loadingQuality.sourceAvailable, false);
  assert.deepEqual(s.zonageDiagnostic.travels.map(t => t.travelCode), ["A"]);
  assert.equal(s.zonageDiagnostic.receivedPositions, 2); assert.equal(s.unloadingHourlyAnalysis.eligibleTravels, 1);
  const narrow = buildSnapshotFromWorkbook(buffer, "partial.xlsx", "01K", { start: "23:00", end: "00:30" }).snapshot;
  assert.deepEqual(narrow.zonageDiagnostic.travels.map(t => t.travelCode), ["B"]);
  assert.equal(narrow.unloadingHourlyAnalysis.state, "indisponible");
  assert.equal(s.summary.passRate, 100);
});

test("six agences : calcul sans état global, même source et fichiers différents", () => {
  const buffer = workbook([row("DECHG", "P", "22:00:00"), row("ZONAGE", "P", "22:40:00", "")]);
  for (const agency of ["058", "01K", "05R", "04P", "R3A", "04H"]) {
    const s = buildSnapshotFromWorkbook(buffer, "test.xlsx", agency, { start: "21:30", end: "06:30" }).snapshot;
    assert.equal(s.agency.code, agency); assert.equal(s.zonageDiagnostic.latePositions, 1);
  }
  const other = buildSnapshotFromWorkbook(workbook([row("DECHG", "X", "22:00:00", "OTHER")]), "other.xlsx", "04H", { start: "21:30", end: "06:30" }).snapshot;
  assert.deepEqual(other.zonageDiagnostic.travels.map(t => t.travelCode), ["OTHER"]);
  assert.equal(buildSnapshotFromWorkbook(buffer, "test.xlsx", "01K", { start: "21:30", end: "06:30" }).snapshot.zonageDiagnostic.latePositions, 1);
});

test("contrat : anciennes analyses retirées sans toucher aux KPI, normalisation idempotente", () => {
  const legacy = { players: [], summary: { passRate: 64.2 }, operationalScore: { goalsFor: 4 },
    operationalAnalysisVersion: 0, zonageDiagnostic: { obsolete: true } };
  const normalized = normalizeSnapshotContract(legacy);
  assert.equal(normalized.zonageDiagnostic, undefined); assert.equal(normalized.summary.passRate, 64.2);
  assert.equal(normalized.operationalScore.goalsFor, 4); assert.equal(operationalAnalysisNeedsRefresh(normalized), true);
  const current = { ...normalized, ...analyze([]) };
  assert.equal(current.operationalAnalysisVersion, OPERATIONAL_ANALYSIS_VERSION);
  assert.equal(operationalAnalysisNeedsRefresh(current), false);
  assert.deepEqual(normalizeSnapshotContract(normalizeSnapshotContract(current)), normalizeSnapshotContract(current));
  assert.equal(legacy.zonageDiagnostic.obsolete, true);
});

test("bilan : unités séparées, TCD identifié, pas de cause inventée", () => {
  const a = analyze([row("DECHG", "P", "22:00:00"), row("DECHG", "Q", "22:05:00"), row("ZONAGE", "P", "22:40:00", "")],
    { loadingQuality: { sourceAvailable: true, targeted: 3, offTarget: 2 } });
  assert.equal(a.anomalySummary.loading.offTargetTravels, 2); assert.equal(a.anomalySummary.loading.scope, "plage_active_toutes_dates");
  assert.equal(a.anomalySummary.zonage.latePositions, 1); assert.equal(a.anomalySummary.unloading.offTargetTravels, 1);
  assert.ok(a.anomalySummary.messages[0].includes("1 positions hors délai sur 1 positions qualifiables"));
  assert.equal("total" in a.anomalySummary, false); assert.equal("operators" in a.zonageDiagnostic.details[0], false);
});

test("API temporaire : ancien snapshot reconstruit, ou conservé sans analyses si Excel absent", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "stef-analysis-contract-"));
  const buffer = workbook([row("DECHG", "P", "22:00:00"), row("ZONAGE", "P", "22:40:00", "")]);
  const agencies = ["AUD", "OLD"].map(code => ({ code, name: code, accessCode: `temporary-test-${code}`, canImport: true }));
  for (const agency of agencies) {
    const s = buildSnapshotFromWorkbook(buffer, "test.xlsx", agency.code, { start: "21:30", end: "06:30" }).snapshot;
    for (const key of ["operationalAnalysisVersion", "zonageDiagnostic", "unloadingHourlyAnalysis", "anomalySummary"]) delete s[key];
    s.operationalAnalysisVersion = 0; s.zonageDiagnostic = { obsolete: true };
    await fs.mkdir(path.join(temporary, agency.code));
    await fs.writeFile(path.join(temporary, agency.code, "latest.json"), JSON.stringify(s));
    if (agency.code === "AUD") await fs.writeFile(path.join(temporary, agency.code, "latest.xlsx"), buffer);
  }
  const socket = net.createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const server = spawn(process.execPath, ["server/index.mjs"], { cwd: root,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), STEF_BIND_HOST: "127.0.0.1", STEF_DATA_DIR: temporary, STEF_AGENCIES_JSON: JSON.stringify(agencies) }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch { /* Startup only. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready);
    for (const agency of agencies) {
      const response = await fetch(`${base}/api/agencies/${agency.code}/snapshot?${new URLSearchParams(criteria)}`, { headers: { "x-access-code": agency.accessCode } });
      assert.equal(response.status, 200);
      const { snapshot } = await response.json();
      assert.equal(snapshot.summary.passRate, 100);
      assert.equal(snapshot.agency.code, agency.code);
      if (agency.code === "AUD") {
        assert.equal(snapshot.operationalAnalysisVersion, OPERATIONAL_ANALYSIS_VERSION);
        assert.equal(snapshot.zonageDiagnostic.latePositions, 1);
      } else {
        assert.equal(snapshot.operationalAnalysisVersion, undefined);
        assert.equal(snapshot.zonageDiagnostic, undefined);
      }
    }
  } finally {
    if (server.exitCode === null) { const stopped = once(server, "close"); server.kill("SIGTERM"); await stopped; }
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("réconciliation ponctuelle Montpellier, Excel inchangé et KPI officiels avant/après", { skip: !process.env.STEF_OPERATIONAL_WORKBOOK }, async () => {
  const buffer = await fs.readFile(process.env.STEF_OPERATIONAL_WORKBOOK);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const s = buildSnapshotFromWorkbook(buffer, "reference.xlsx", "01K").snapshot;
  assert.deepEqual(s.operationalScore.indicators, { passRate: 64.2, loadingPercent: 75, unloadingPercent: 78.4, possessionPercent: 72.8 });
  assert.equal(s.zonageDiagnostic.night.startDate, "2026-09-17");
  assert.deepEqual([s.zonageDiagnostic.receivedPositions, s.zonageDiagnostic.qualifiablePositions, s.zonageDiagnostic.latePositions, s.zonageDiagnostic.unqualifiablePositions], [676, 488, 184, 188]);
  assert.deepEqual([s.unloadingHourlyAnalysis.eligibleTravels, s.unloadingHourlyAnalysis.offTargetTravels, s.unloadingHourlyAnalysis.meanSecondsPerPosition], [37, 7, 93]);
  assert.equal(s.unloadingHourlyAnalysis.travels.find(t => t.travelCode === "TVE100").timePerPositionSeconds, 883 / 20);
  if (process.env.STEF_OPERATIONAL_BASELINE) {
    const before = JSON.parse(await fs.readFile(process.env.STEF_OPERATIONAL_BASELINE, "utf8"));
    for (const key of Object.keys(before)) assert.deepEqual(s[key], before[key], `Official field unchanged: ${key}`);
  }
  assert.equal(createHash("sha256").update(await fs.readFile(process.env.STEF_OPERATIONAL_WORKBOOK)).digest("hex"), hash);
});
