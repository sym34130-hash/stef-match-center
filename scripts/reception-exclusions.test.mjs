import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { normalizeReceptionExclusions, prepareReceptionScope } from "../server/reception-exclusions.mjs";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";

function line(travelCode, triClient, position, operationType = "DECHG") {
  return { travelCode, triClient, position, operationType, segmentType: "EX", startedAt: new Date("2026-09-17T22:30:00Z") };
}

test("Lot B: un voyage exclu de la réception ne supprime aucune opération source", () => {
  const rows = [line("V1", "TRI", "1"), line("V2", "NORMAL", "2"), line("V1", "TRI", "3", "ZONAGE")];
  const result = prepareReceptionScope(rows, { travels: [{ code: "V1", reason: "Double déchargement" }] });
  assert.deepEqual(result.rows.map(row => [row.travelCode, row.operationType]), [["V2", "DECHG"], ["V1", "ZONAGE"]]);
  assert.deepEqual(result.scope.excludedTravels.map(item => item.reason), ["Double déchargement"]);
  assert.equal(result.scope.excludedByTravelCount, 1);
  assert.equal(rows.length, 3, "Les données sources ne sont jamais mutées");
});

test("Lot B: filtrage client exact, sans déduction à partir du segment ni de la destination", () => {
  const rows = [
    line("A", "Tri Nord", "1"), line("A", "Tri Nord", "2"),
    line("B", "Client Final", "3"), line("B", "Client Final", "4"),
    line("MIX", "Tri Nord", "5"), line("MIX", "Client Final", "6"),
    line("UNKNOWN", "", "7"), line("UNKNOWN", "", "8"),
  ];
  const filters = { clients: [{ code: "  tri nord ", reason: "Client de tri" }] };
  const result = prepareReceptionScope(rows, filters, { clientColumnPresent: true });
  assert.deepEqual([...result.excludedTravelCodes], ["A"]);
  assert.deepEqual(result.scope.ambiguousClientTravels, ["MIX"]);
  assert.deepEqual([...new Set(result.rows.filter(row => row.operationType === "DECHG").map(row => row.travelCode))], ["B", "MIX", "UNKNOWN"]);
  assert.equal(result.scope.excludedByClientCount, 1);
  assert.deepEqual(result.scope.availableClients.map(item => item.code), ["Client Final", "Tri Nord"]);
});

test("Lot B: exclusions réversibles, doublons et limites normalisés", () => {
  const first = normalizeReceptionExclusions({
    travels: [{ code: "  V  1 ", reason: "  Retard    atypique  " }, { code: "V 1", reason: "Révision" }],
    clients: [{ code: "CliEnt", reason: "Tri" }, { code: "client", reason: "Tri" }],
  });
  assert.equal(first.travels.length, 1);
  assert.equal(first.travels[0].code, "V 1");
  assert.equal(first.travels[0].reason, "Révision");
  assert.equal(first.clients.length, 1);
  const restored = prepareReceptionScope([line("V 1", "CLIENT", "1")], { travels: [], clients: [] });
  assert.equal(restored.rows.length, 1);
  assert.equal(restored.scope.excludedByTravelCount, 0);
  assert.equal(restored.scope.excludedByClientCount, 0);
});

function syntheticWorkbook(withClient = true) {
  const columns = [
    "Opérateur", "Date heure de début d'opération", "Type d'opération", "N° Position",
    "Code Voyage", "Agence Segment", "Type Segment", "Filtre opérateur", "Filtre heure",
    "Poste", "Poz non zonées", "DZ", "Duels gagnés",
  ];
  if (withClient) columns.push("Client de tri");
  const rows = [columns];
  const start = Date.parse("2026-09-17T21:30:00+02:00");
  for (const [trip, client, seconds] of [["RAPIDE", "CLIENT FINAL", 20], ["LENT", "CLIENT TRI", 85]]) {
    for (let i = 0; i < 15; i++) {
      const stamp = new Date(start + i * seconds * 1000).toISOString();
      rows.push(["OP A", stamp, "DECHG", `${trip}-P${i}`, trip, "058", "EX", "", "", "Défenseur", "", "", "", ...(withClient ? [client] : [])]);
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Données");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("Lot B: exclusion ciblée recalcule le duel sans effacer les joueurs, volumes et autres KPI", () => {
  const xlsx = syntheticWorkbook();
  const build = (filters = {}) => {
    const result = buildSnapshotFromWorkbook(xlsx, "reception-exclusion-test.xlsx", "058",
      { start: "21:30", end: "06:30", receptionExclusions: filters });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    return result.snapshot;
  };
  const before = build();
  assert.equal(before.unloadingQuality.eligibleTrips, 2);
  assert.equal(before.unloadingQuality.targetedPercent, 50);
  assert.deepEqual(before.receptionScope.availableTravels, ["LENT", "RAPIDE"]);
  assert.equal(before.receptionScope.clientColumnPresent, true);
  const filtered = build({ travels: [{ code: "LENT", reason: "Double déchargement" }] });
  assert.equal(filtered.unloadingQuality.eligibleTrips, 1);
  assert.equal(filtered.unloadingQuality.targetedPercent, 100);
  assert.equal(filtered.unloadingHourlyAnalysis.eligibleTravels, 1);
  assert.equal(filtered.summary.operations, before.summary.operations);
  assert.equal(filtered.summary.positions, before.summary.positions);
  assert.equal(filtered.summary.players, before.summary.players);
  assert.equal(filtered.summary.possessionPercent, before.summary.possessionPercent);
  assert.equal(filtered.summary.passRate, before.summary.passRate);
  assert.equal(filtered.loadingQuality.targetedPercent, before.loadingQuality.targetedPercent);
  assert.equal(filtered.operationalScore.indicators.passRate, before.operationalScore.indicators.passRate);
  assert.equal(filtered.operationalScore.indicators.possessionPercent, before.operationalScore.indicators.possessionPercent);
  assert.equal(filtered.operationalScore.indicators.unloadingPercent, 100);
  const byClient = build({ clients: [{ code: "CLIENT TRI", reason: "Tri hors réception" }] });
  assert.equal(byClient.unloadingQuality.targetedPercent, 100);
  assert.equal(byClient.receptionScope.excludedByClientCount, 1);
  assert.equal(build().unloadingQuality.targetedPercent, 50);
});

test("Lot B: sans colonne client, aucune attribution n'est inventée", () => {
  const result = buildSnapshotFromWorkbook(syntheticWorkbook(false), "sans-client.xlsx", "058",
    { start: "21:30", end: "06:30", receptionExclusions: { clients: [{ code: "CLIENT TRI", reason: "Test" }] } });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.snapshot.receptionScope.clientColumnPresent, false);
  assert.equal(result.snapshot.receptionScope.availableClients.length, 0);
  assert.equal(result.snapshot.unloadingQuality.targetedPercent, 50);
  assert.equal(result.snapshot.receptionScope.excludedByClientCount, 0);
});
