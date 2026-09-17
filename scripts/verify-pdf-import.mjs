import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [workbookPath, pdfPath] = process.argv.slice(2);
assert.ok(workbookPath && pdfPath, "Usage: pnpm test:pdf:import <Excel.xlsx> <106J.pdf>");
const workbook = await fs.readFile(workbookPath);
const pdf = await fs.readFile(pdfPath);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "stef-pdf-audit-"));
const dataDir = path.join(temporary, "agencies");
const outputDir = process.env.PDF_IMPORT_OUTPUT_DIR
  ? path.resolve(process.env.PDF_IMPORT_OUTPUT_DIR)
  : path.join(root, "output", "pdf-import-validation");
await fs.mkdir(outputDir, { recursive: true });
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const headers = { "x-access-code": "pdf-audit-only" };
const expected = { arrivalPunctuality: 80, departurePunctuality: 64.1, destinationPunctuality: 62, temperatureReturn: 92.19 };
const expectedTargets = { arrivalPunctuality: 85, departurePunctuality: 85, destinationPunctuality: 85, temperatureReturn: 100 };
let server;
let browser;
let logs = "";

async function startServer() {
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), STEF_DATA_DIR: dataDir,
      STEF_AGENCIES_JSON: JSON.stringify([{ code: "058", name: "Agen - 058", accessCode: headers["x-access-code"], canImport: true }]) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { logs += chunk; });
  server.stderr.on("data", (chunk) => { logs += chunk; });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* Server is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`API indisponible: ${logs}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const stopped = once(server, "close");
  server.kill("SIGTERM");
  await stopped;
}

async function upload(buffer, name) {
  const body = new FormData();
  body.append("file", new Blob([buffer]), name);
  const response = await fetch(`${base}/api/agencies/058/import`, { method: "POST", headers, body });
  return { status: response.status, payload: await response.json() };
}

async function snapshot(query = "") {
  const response = await fetch(`${base}/api/agencies/058/snapshot${query}`, { headers });
  assert.equal(response.status, 200);
  return (await response.json()).snapshot;
}

function checkPdf(value) {
  assert.deepEqual(value.dailyIndicators.expedition, { tonnage: 478 });
  assert.deepEqual(value.dailyIndicators.punctuality, expected);
  assert.deepEqual(value.dailyIndicators.punctualityTargets, expectedTargets);
}

try {
  await startServer();
  const premature = await upload(pdf, "106J.pdf");
  assert.equal(premature.status, 422);
  assert.equal(premature.payload.title, "EXCEL REQUIS");
  const excel = await upload(workbook, path.basename(workbookPath));
  assert.equal(excel.status, 200, JSON.stringify(excel.payload));
  const positions = excel.payload.snapshot.summary.positions;
  const operations = excel.payload.snapshot.summary.operations;

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill(headers["x-access-code"]);
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "MAJ Import", exact: true }).click();
  await page.locator('input[type="file"][accept=".pdf"]').setInputFiles(pdfPath);
  const uploaded = page.waitForResponse((response) => response.url().endsWith("/api/agencies/058/import") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Importer le PDF 106J", exact: true }).click();
  const response = await uploaded;
  assert.equal(response.status(), 200);
  const imported = (await response.json()).snapshot;
  checkPdf(imported);
  assert.equal(imported.summary.positions, positions, "Le PDF ne remplace pas les positions Excel");
  assert.equal(imported.summary.operations, operations);
  await expect(page.getByText("Les indicateurs 106J sont prêts.", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, "import-valide.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Voir le match", exact: true }).click();
  await expect(page.locator(".match-indicator-card")).toHaveCount(8);
  await expect(page.locator('[data-indicator="tonnage"] .match-indicator-value')).toHaveText("478 t");
  await expect(page.locator('[data-indicator="positions"] .match-indicator-value')).toHaveText(new Intl.NumberFormat("fr-FR").format(positions));
  await page.getByRole("button", { name: "Afficher Ponctualité arrivage", exact: true }).click();
  await expect(page.locator('[data-indicator="arrival"]')).toHaveAttribute("data-featured", "");
  await page.locator(".match-indicators").screenshot({ path: path.join(outputDir, "indicateurs-importes.png") });
  await page.reload();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await expect(page.locator('[data-indicator="temperature"] .match-indicator-value')).toHaveText("92,19%");
  for (const [league, tone] of [["bronze", "bronze"], ["argent", "silver"], ["or", "gold"], ["platine", "platinum"]]) {
    await page.getByRole("button", { name: "ADM Administrateur", exact: true }).click();
    await page.locator(`.league-card.${tone} .league-select-button`).click();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await expect(page.locator(`.app-shell.league-${league}`)).toBeVisible();
    await expect(page.locator('[data-indicator="tonnage"] .match-indicator-value')).toHaveText("478 t");
    await expect(page.locator('[data-indicator="departure"] .match-indicator-value')).toHaveText("64,1%");
  }
  assert.deepEqual(errors, [], "Aucune erreur JavaScript");
  await browser.close();
  browser = null;

  const latestPath = path.join(dataDir, "058", "latest.json");
  const staleSnapshot = JSON.parse(await fs.readFile(latestPath, "utf8"));
  delete staleSnapshot.dailyIndicators.punctualityTargets;
  await fs.writeFile(latestPath, JSON.stringify(staleSnapshot));
  checkPdf(await snapshot());

  const rangeResponse = await fetch(`${base}/api/agencies/058/time-range`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ start: "16:00", end: "18:00" }),
  });
  assert.equal(rangeResponse.status, 200);
  const filtered = (await rangeResponse.json()).snapshot;
  checkPdf(filtered);
  assert.notEqual(filtered.summary.positions, positions, "Les positions suivent la plage, les taux PDF restent journaliers");
  const beforeInvalid = await fs.readFile(path.join(dataDir, "058", "latest-106j.pdf"));
  const invalid = await upload(Buffer.from("Not a PDF"), "invalid.pdf");
  assert.equal(invalid.status, 400);
  assert.deepEqual(await fs.readFile(path.join(dataDir, "058", "latest-106j.pdf")), beforeInvalid);
  checkPdf(await snapshot());
  const repeated = await upload(pdf, path.basename(pdfPath));
  assert.equal(repeated.status, 200);
  checkPdf(repeated.payload.snapshot);
  const reimportExcel = await upload(workbook, path.basename(workbookPath));
  assert.equal(reimportExcel.status, 200);
  checkPdf(reimportExcel.payload.snapshot);
  assert.equal(reimportExcel.payload.snapshot.summary.positions, positions);
  await stopServer();
  await startServer();
  checkPdf(await snapshot());
  const report = { status: "PASS", workbook: path.basename(workbookPath), pdf: path.basename(pdfPath),
    date: imported.match.lastOperation, positionsExcel: positions, positionsFiltered: filtered.summary.positions,
    tonnage: 478, punctuality: expected, punctualityTargets: expectedTargets, checks: ["real-browser-upload", "reload", "four-leagues", "filtered-period", "invalid-file-preserves-data", "reimport", "server-restart-same-storage"] };
  await fs.writeFile(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  await stopServer();
  await fs.rm(temporary, { recursive: true, force: true });
}

async function freePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return address.port;
}
