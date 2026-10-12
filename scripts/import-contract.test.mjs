import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reference = await fs.readFile(path.join(root, "data/agencies/058/latest.xlsx"));

test("contrat Excel : référence complète et absence de TCD sans fallback inventé", () => {
  const before = buildSnapshotFromWorkbook(reference, "reference.xlsx", "058").snapshot;
  assert.equal(before.validation.importReadiness.status, "complete");
  const workbook = XLSX.read(reference);
  workbook.SheetNames = workbook.SheetNames.filter(name => name.toLowerCase() !== "tcd ppt");
  delete workbook.Sheets["TCD PPT"];
  const result = buildSnapshotFromWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "sans-tcd.xlsx", "058");
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.validation.importReadiness.status, "partial");
  assert.equal(result.snapshot.operationalScore.indicators.loadingPercent, null);
  assert.equal(result.snapshot.operationalScore.status, "unavailable");
  const missing = result.snapshot.validation.importReadiness.unavailableKpis.find(item => item.id === "loadingPercent");
  assert.match(missing.source, /TCD PPT/);
  assert.match(missing.reason, /absente ou incomplète/);
  assert.equal(result.snapshot.summary.passRate, before.summary.passRate);
  assert.equal(result.snapshot.summary.positions, before.summary.positions);
});

test("contrat Excel : fichier totalement invalide", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Sans données"]]), "Vide");
  assert.equal(buildSnapshotFromWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "invalide.xlsx", "058").ok, false);
});

test("contrat Excel : format STABILISE réel partiel, sans faux zéro", { skip: !process.env.STEF_STABILIZED_WORKBOOK }, async () => {
  const file = process.env.STEF_STABILIZED_WORKBOOK;
  if (!file) { throw new Error("STEF_STABILIZED_WORKBOOK est requis pour ce contrôle du classeur réel."); }
  const result = buildSnapshotFromWorkbook(await fs.readFile(file), "stabilise.xlsx", "058");
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.validation.importReadiness.status, "partial");
  assert.equal(result.snapshot.summary.passRate, null);
  assert.equal(result.snapshot.operationalScore.indicators.loadingPercent, null);
  assert.deepEqual(result.snapshot.validation.importReadiness.unavailableKpis.map(item => item.id).sort(), ["loadingPercent", "passRate"]);
});
