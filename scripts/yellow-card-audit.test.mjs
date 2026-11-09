import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { auditYellowCards } from "../server/yellow-card-audit.mjs";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";

const period = { startMinutes: 21 * 60, endMinutes: 6 * 60 + 30, isOvernight: true };

function set(sheet, address, value) {
  sheet[address] = { t: typeof value === "number" ? "n" : "s", v: value };
}

function matrixWorkbook({ awarded = 14, temperature = 18, loading = false } = {}) {
  const workbook = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([
    ["Opérateur", "Date heure de début d'opération", "Type d'opération", "N° Position",
      "Code Voyage", "Agence Segment", "Type Segment", "Filtre opérateur", "Filtre heure",
      "Poste", "Poz non zonées", "DZ", "Duels gagnés"],
    ["OP TEST", "17/09/2026 22:00:00", "DECHG", "P1", "TRP-01", "058", "EX", "", "", "", "", "", ""],
  ]);
  XLSX.utils.book_append_sheet(workbook, data, "Données");

  const match = {};
  match["!ref"] = `A1:AN${Math.max(awarded + 5, 35)}`;
  set(match, "A1", "Feuille de match test (données synthétiques)");
  for (const [col, header] of [["AK", "Nom"], ["AL", "Heure carton"], ["AM", "Faute"], ["AN", "Voyage"]]) {
    set(match, `${col}5`, header);
  }
  for (let number = 1; number <= awarded; number += 1) {
    const row = number + 5;
    const token = String(number).padStart(2, "0");
    set(match, `AK${row}`, `OP ${token}`);
    set(match, `AL${row}`, "21:37:00");
    set(match, `AM${row}`, "Pas de prise de temp");
    set(match, `AN${row}`, `TRP-${token}`);
  }
  XLSX.utils.book_append_sheet(workbook, match, "Feuille de match");

  const x = {};
  x["!ref"] = `A1:IM${Math.max(temperature + 8, 35)}`;
  set(x, "II7", "Type d'opération");
  set(x, "IJ7", "Code Voyage");
  for (let number = 1; number <= temperature; number += 1) {
    const row = number + 7;
    const token = String(number).padStart(2, "0");
    set(x, `II${row}`, "DECHG");
    set(x, `IJ${row}`, `TRP-${token}`);
    set(x, `IK${row}`, `OP ${token}`);
    set(x, `IL${row}`, 46282 + (21 * 3600 + 37 * 60) / 86400);
    set(x, `IM${row}`, "Pas de prise de temp");
  }
  XLSX.utils.book_append_sheet(workbook, x, "X");

  const tcd = {};
  tcd["!ref"] = "A1:Y50";
  set(tcd, "P9", "Code Voyage");
  set(tcd, "X9", "Attaquant");
  set(tcd, "Y9", "Carton jaune");
  for (let row = 10; row <= 25; row += 1) {
    set(tcd, `P${row}`, `CHG-${row}`);
    set(tcd, `Y${row}`, "Chargement à quai"); // Static template label, not a card.
  }
  if (loading) {
    set(tcd, "X10", "OP CHG");
    set(tcd, "Q10", 46282 + (22 * 3600 + 12 * 60) / 86400);
  }
  XLSX.utils.book_append_sheet(workbook, tcd, "TCD PPT");
  return workbook;
}

function awardedList(count) {
  return Array.from({ length: count }, (_, i) => ({
    playerName: `OP ${String(i + 1).padStart(2, "0")}`,
    time: "21:37:00", reason: "Pas de prise de temp",
    travelCode: `TRP-${String(i + 1).padStart(2, "0")}`,
  }));
}

test("Lot C : 14 cartons listés contre 18 cas température complets -> 4 absents de la synthèse", () => {
  const workbook = matrixWorkbook();
  const audit = auditYellowCards(workbook, awardedList(14), period);
  assert.equal(audit.sourceAvailable, true);
  assert.deepEqual(audit.byReason, { temperature: 14, loading: 0, other: 0 });
  assert.equal(audit.matrix.temperatureCandidates, 18);
  assert.equal(audit.matrix.loadingCandidates, 0);
  assert.equal(audit.matrix.unlistedCandidates.length, 4);
  assert.deepEqual(audit.matrix.unlistedCandidates.map(item => item.travelCode),
    ["TRP-15", "TRP-16", "TRP-17", "TRP-18"]);
});

test("Lot C : le libellé constant « Chargement à quai » ne constitue pas un carton attribué", () => {
  const workbook = matrixWorkbook({ awarded: 0, temperature: 0 });
  const audit = auditYellowCards(workbook, [], period);
  assert.equal(audit.matrix.loadingCandidates, 0);
  assert.deepEqual(audit.matrix.unlistedCandidates, []);
  const withActualAttacker = auditYellowCards(matrixWorkbook({ awarded: 0, temperature: 0, loading: true }), [], period);
  assert.equal(withActualAttacker.matrix.loadingCandidates, 1);
  assert.equal(withActualAttacker.matrix.unlistedCandidates[0].travelCode, "CHG-10");
  assert.equal(withActualAttacker.matrix.unlistedCandidates[0].category, "loading");
});

test("Lot C : exclusions globales et fenêtre horaire portent aussi sur les candidats, pas de faux positif", () => {
  const workbook = matrixWorkbook();
  const filtered = auditYellowCards(workbook, awardedList(14), period, new Set(["TRP-18"]));
  assert.equal(filtered.matrix.unlistedCandidates.length, 3);
  const daytime = { startMinutes: 8 * 60, endMinutes: 17 * 60, isOvernight: false };
  assert.equal(auditYellowCards(workbook, [], daytime).matrix.temperatureCandidates, 0);
});

test("Lot C : intégration du snapshot — 18 attribués, dont 4 récupérés, KPI non modifiés", () => {
  const xlsx = XLSX.write(matrixWorkbook(), { type: "buffer", bookType: "xlsx" });
  const result = buildSnapshotFromWorkbook(xlsx, "lot-c-synthetique.xlsx", "058",
    { start: "21:00", end: "06:30" });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const snapshot = result.snapshot;
  assert.equal(snapshot.yellowCards.length, 18);
  assert.deepEqual(snapshot.yellowCards.slice(14).map(card => card.travelCode), ["TRP-15", "TRP-16", "TRP-17", "TRP-18"]);
  assert.equal(new Set(snapshot.yellowCards.map(card => `${card.playerName}|${card.travelCode}|${card.reason}`)).size, 18);
  assert.equal(snapshot.yellowCardAudit.byReason.temperature, 18);
  assert.equal(snapshot.yellowCardAudit.matrix.unlistedCandidates.length, 4);
  assert.ok(snapshot.validation.warnings.some(message => message.includes("4 carton(s)") && message.includes("réintégré(s)")));
  assert.equal(snapshot.summary.operations, 1);
  assert.equal(snapshot.summary.positions, 1);
});


test("Lot C : aucun doublon si la synthèse contient déjà les 18 cartons", () => {
  const xlsx = XLSX.write(matrixWorkbook({ awarded: 18 }), { type: "buffer", bookType: "xlsx" });
  const result = buildSnapshotFromWorkbook(xlsx, "lot-c-complet.xlsx", "058", { start: "21:00", end: "06:30" });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.snapshot.yellowCards.length, 18);
  assert.equal(result.snapshot.yellowCardAudit.byReason.temperature, 18);
  assert.equal(result.snapshot.yellowCardAudit.matrix.unlistedCandidates.length, 0);
});

test("Lot C : une vraie faute de chargement est comptée, pas le libellé fixe", () => {
  const xlsx = XLSX.write(matrixWorkbook({ awarded: 0, temperature: 0, loading: true }), { type: "buffer", bookType: "xlsx" });
  const result = buildSnapshotFromWorkbook(xlsx, "lot-c-chargement.xlsx", "058", { start: "21:00", end: "06:30" });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.snapshot.yellowCards.length, 1);
  assert.equal(result.snapshot.yellowCards[0].reason, "Chargement à quai");
  assert.equal(result.snapshot.yellowCardAudit.byReason.loading, 1);
});
