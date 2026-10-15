import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { parse106jText } from "../server/pdf-106j.mjs";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";
import { pdfAssociation, pdfReferenceDay } from "../server/source-provenance.mjs";

function workbook(rows) {
  const headers = [
    "Opérateur", "Date heure de début d'opération", "Type d'opération",
    "N° Position", "Code Voyage", "Agence Segment", "Type Segment",
    "Filtre opérateur", "Filtre heure", "Poste", "Poz non zonées", "DZ",
    "Duels gagnés",
  ];
  const file = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(file, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Données");
  return XLSX.write(file, { type: "buffer", bookType: "xlsx" });
}
function row(datetime, type = "DECHG", segment = "01K") {
  return ["OP TEST", datetime, type, "P001", "TEST-01", segment, "Test", "", "", "", "", "", ""];
}

test("A02: la date d'import PDF ne change pas à chaque lecture", () => {
  const text = "SIE.106J Date de référence de calcul :18 septembre 2026 Taux de ponctualité Arrivage % 81,00 %";
  const fixed = "2026-09-19T10:15:00.000Z";
  const first = parse106jText(text, "rapport.pdf", { uploadedAt: fixed });
  const second = parse106jText(text, "rapport.pdf", { uploadedAt: fixed });
  assert.equal(first.importedAt, fixed);
  assert.equal(second.importedAt, fixed);
  assert.equal(first.referenceDate, "18 septembre 2026");
  assert.equal(parse106jText(text, "historique.pdf").importedAt, null);
});

test("A05: 00h30 à Paris appartient au jour civil local en plage de journée", () => {
  const result = buildSnapshotFromWorkbook(
    workbook([row("18/09/2026 00:30:00")]), "test.xlsx", "01K",
    { start: "00:00", end: "02:00" },
  );
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.snapshot.match.date, "2026-09-18");
  assert.equal(result.snapshot.match.legacyDate, "2026-09-17");
});

test("A05: la nuit 21h30–06h30 garde sa date de début après minuit", () => {
  const result = buildSnapshotFromWorkbook(
    workbook([row("17/09/2026 22:00:00"), row("18/09/2026 00:30:00", "ZONAGE")]),
    "test-nuit.xlsx", "01K", { start: "21:30", end: "06:30" },
  );
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.snapshot.match.date, "2026-09-17");
});

test("A03: un segment majoritaire différent reste un indice, pas une preuve de propriété", () => {
  const result = buildSnapshotFromWorkbook(
    workbook([row("17/09/2026 22:00:00", "DECHG", "05R")]),
    "multisegment.xlsx", "01K", { start: "21:30", end: "06:30" },
  );
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.snapshot.agency.detectedCode, "05R");
  assert.ok(result.snapshot.validation.warnings.some(value => value.includes("majoritaire")));
});

test("A01: PDF 106J compatible avec les deux dates de la nuit, jamais avec un autre jour", () => {
  const match = { zonageDiagnostic: { night: { startDate: "2026-09-17", endDate: "2026-09-18" } } };
  assert.equal(pdfAssociation({ referenceDate: "17 septembre 2026" }, match).status, "matched");
  assert.equal(pdfAssociation({ referenceDate: "18 septembre 2026" }, match).status, "matched");
  assert.equal(pdfAssociation({ referenceDate: "16 septembre 2026" }, match).status, "mismatched");
  assert.equal(pdfAssociation({ referenceDate: null }, match).status, "unverified");
  assert.equal(pdfReferenceDay("31 février 2026"), null);
  assert.equal(pdfReferenceDay("18 août 2026"), "2026-08-18");
});

test("A01: dates de Paris reconnues même à la frontière UTC", () => {
  const snapshot = { match: {
    firstOperation: "2026-09-17T22:30:00.000Z",
    lastOperation: "2026-09-18T01:00:00.000Z",
  } };
  assert.equal(pdfAssociation({ referenceDate: "18 septembre 2026" }, snapshot).status, "matched");
  assert.equal(pdfAssociation({ referenceDate: "17 septembre 2026" }, snapshot).status, "mismatched");
});

test("A03: le modèle calculé conserve l'indice agence sans altérer le contrat historique", () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Opérateur", "Date heure de début d'opération", "Type d'opération",
      "N° Position", "Code Voyage", "Agence Segment", "Type Segment",
      "Filtre opérateur", "Filtre heure", "Poste", "Poz non zonées", "DZ", "Duels gagnés", "Quart temps"],
    ["OP TEST", "17/09/2026 22:00:00", "DECHG", "P001", "TEST-01", "05R", "Test", "", "", "", "", "", "", ""],
  ]), "Données");
  const result = buildSnapshotFromWorkbook(XLSX.write(book, { type: "buffer", bookType: "xlsx" }),
    "derived.xlsx", "01K", { start: "21:30", end: "06:30" });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.snapshot.agency.detectedCode, "01K");
  assert.equal(result.snapshot.validation.agencySegmentHint, "05R");
});

test("A01: PDF 106J d'Agen jamais associé à Montpellier, même à date identique", () => {
  const pdf = parse106jText(`SIE.106J - Indicateurs journaliers agence 58
    Site : STEF Transport AGEN [0058]
    Date de référence de calcul : 11 septembre 2026
    Expédition Tonnage T 478 +33%`, "rapport-agen.pdf", { uploadedAt: "2026-09-11T13:27:00.000Z" });
  assert.equal(pdf.agencyCode, "0058");
  const matchAgen = { agency: { code: "058" }, anomalySummary: { night: { startDate: "2026-09-10", endDate: "2026-09-11" } } };
  const matchMontpellier = { ...matchAgen, agency: { code: "01K" } };
  assert.equal(pdfAssociation(pdf, matchAgen).status, "matched");
  assert.equal(pdfAssociation(pdf, matchMontpellier).status, "mismatched-agency");
});
