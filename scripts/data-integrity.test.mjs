import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { parse106jText } from "../server/pdf-106j.mjs";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";

function workbook(rows) {
  const headers = [
    "Opérateur", "Date heure de début d'opération", "Type d'opération",
    "N° Position", "Code Voyage", "Agence Segment", "Type Segment",
    "Filtre opérateur", "Filtre heure", "Poste", "Poz non zonées", "DZ",
    "Duels gagnés", "Quart temps",
  ];
  const file = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(file, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Données");
  return XLSX.write(file, { type: "buffer", bookType: "xlsx" });
}
function row(datetime, type = "DECHG", segment = "01K") {
  return ["OP TEST", datetime, type, "P001", "TEST-01", segment, "Test", "", "", "", "", "", "", ""];
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
