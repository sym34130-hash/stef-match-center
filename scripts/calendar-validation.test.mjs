import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";

function parseDate(value) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Operateur", "Date Heure de debut d operation", "Type operation", "N position", "Code voyage", "Agence segment", "Type segment", "Filtre operateur", "Filtre heure", "Poste", "Poz non zonees", "DZ", "Duels gagnes"],
    ["Test", value, "DECHG", "P1", "V1", "058", "EX", "", "", "Defenseur", "", 0, 1],
  ]), "Données");
  return buildSnapshotFromWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "date-test.xlsx", "058", { start: "00:00", end: "23:30" });
}

for (const value of ["2026-02-31T14:00:00+01:00", "2026-02-31Z", "2026-02-31GMT", "2026-02-29T14:00:00Z", "2100-02-29T14:00:00Z", "2026-04-31T14:00:00+09:00", "2026-99-99T14:00:00Z", "2026-00-12", "2026-01-00", "", "pas une date"]) {
  test(`1D: date source invalide rejetée ${value || "vide"}`, () => {
    assert.equal(parseDate(value).ok, false);
  });
}

for (const value of ["2024-02-29T14:00:00+01:00", "2000-02-29T14:00:00Z", "2026-04-30T14:00:00+09:00", "2026-12-31T14:00:00-03:00", "2026-01-31T23:30:00-03:00", "28/02/2026 14:00:00"]) {
  test(`1D: date source valide et conversion existante conservée ${value}`, () => {
    const result = parseDate(value);
    assert.equal(result.ok, true, result.error?.message);
    assert.equal(result.snapshot.validation.invalidDateRows, 0);
    if (value.includes("T")) assert.equal(result.snapshot.match.firstOperation, new Date(value).toISOString());
  });
}
