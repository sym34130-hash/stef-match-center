import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import * as XLSX from "xlsx";

async function freePort() {
  const s = net.createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const port = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return port;
}

async function ready(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch { /* process starting */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Server never became available: ${url}`);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "stef-browser-integrity-"));
const apiPort = await freePort();
const webPort = await freePort();
const baseURL = `http://127.0.0.1:${webPort}`;
const commonEnv = {
  ...process.env, PORT: String(apiPort), VITE_PORT: String(webPort),
  STEF_BIND_HOST: "127.0.0.1", STEF_DATA_DIR: root,
  NODE_ENV: "test",
  STEF_AGENCIES_JSON: JSON.stringify([
    { code: "01K", name: "Montpellier", accessCode: "INTEGRATION-01K", canImport: true },
    { code: "05R", name: "Toulouse", accessCode: "INTEGRATION-05R", canImport: true },
  ]),
};
const api = spawn(process.execPath, ["server/index.mjs"], { env: commonEnv, stdio: ["ignore", "pipe", "pipe"] });
const vite = spawn("./node_modules/.bin/vite", ["--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { env: commonEnv, stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
for (const proc of [api, vite]) proc.stderr.on("data", chunk => { stderr += chunk.toString(); });
let browser;
try {
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`), ready(baseURL)]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Opérateur", "Date heure de début d'opération", "Type d'opération",
      "N° Position", "Code Voyage", "Agence Segment", "Type Segment",
      "Filtre opérateur", "Filtre heure", "Poste", "Poz non zonées", "DZ", "Duels gagnés"],
    ["OP TEST", "17/09/2026 22:00:00", "DECHG", "P001", "TRIP-001", "05R", "Test", "", "", "", "", "", ""],
  ]), "Données");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));
    await page.goto(baseURL);
    await page.getByLabel("Code agence").selectOption("01K");
    await page.getByLabel("Code d'accès").fill("INTEGRATION-01K");
    await page.getByRole("button", { name: "Accéder au match" }).click();
    await page.getByRole("button", { name: "MAJ Import", exact: true }).click();
    await page.locator(".import-source-drop-zone input[type=file]").first()
      .setInputFiles({ name: "multisegment.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
    await page.getByRole("button", { name: "Contrôler et importer Excel" }).click();
    const confirmation = page.getByRole("alert", { name: "Confirmation d’agence requise" });
    await confirmation.waitFor({ state: "visible", timeout: 20000 });
    assert.match(await confirmation.innerText(), /05R/);
    const before = await fetch(`http://127.0.0.1:${apiPort}/api/agencies/01K/snapshot`, { headers: { "x-access-code": "INTEGRATION-01K" } });
    if (viewport.width === 1366) assert.equal(before.status, 404);
    await confirmation.getByRole("button", { name: "Je confirme que ce fichier appartient à mon agence" }).click();
    await page.locator(".import-result.success").waitFor({ state: "visible", timeout: 20000 });
    const successText = await page.locator(".import-result.success").innerText();
    assert.match(successText, /MATCH ACTUALISÉ|IMPORT PARTIEL/);
    const after = await fetch(`http://127.0.0.1:${apiPort}/api/agencies/01K/snapshot`,
      { headers: { "x-access-code": "INTEGRATION-01K" } });
    assert.equal(after.status, 200, "Confirmed import must persist the snapshot");
    // Lot A: store the same brief preferences used by the UI, without touching source KPI values.
    const importedSnapshot = (await after.json()).snapshot;
    const causerieUrl = `http://127.0.0.1:${apiPort}/api/agencies/01K/causerie`;
    const causerieHeaders = { "x-access-code": "INTEGRATION-01K" };
    const currentPlanResponse = await fetch(`${causerieUrl}?matchDate=${encodeURIComponent(importedSnapshot.match.date)}`, { headers: causerieHeaders });
    assert.equal(currentPlanResponse.status, 200);
    const currentPlan = await currentPlanResponse.json();
    const savePlanResponse = await fetch(causerieUrl, {
      method: "POST",
      headers: { ...causerieHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        matchDate: importedSnapshot.match.date,
        expectedRevision: currentPlan.causerieRevision,
        plan: { visibleIndicators: ["tonnage", "positions"], tonnageActivity: "distribution" },
      }),
    });
    assert.equal(savePlanResponse.status, 200, "Brief preferences must be persisted by the API");
    const savedPlan = (await savePlanResponse.json()).plan;
    assert.deepEqual(savedPlan.visibleIndicators, ["tonnage", "positions"]);
    assert.equal(savedPlan.tonnageActivity, "distribution");

    // This fixture is shown only in the isolated browser; the actual PDF import remains unchanged.
    await page.route("**/api/agencies/01K/snapshot**", async route => {
      const response = await route.fetch();
      const body = await response.json();
      body.snapshot.dailyIndicators = {
        sourceName: "synthetic-106j.pdf",
        agencyCode: "01K",
        referenceDate: "17 septembre 2026",
        importedAt: null,
        expedition: { tonnage: 478 },
        distribution: { tonnage: 255 },
        punctuality: {},
      };
      await route.fulfill({ response, json: body });
    });
    await page.reload();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".match-indicator-card").length === 2, null, { timeout: 15000 });
    await page.locator('[data-indicator="tonnage"] .match-indicator-value').waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await page.locator(".match-indicator-card").count(), 2, "Only two KPI cards should be visible");
    assert.equal(await page.locator('[data-indicator="tonnage"] .match-indicator-value').innerText(), "255 t");
    assert.match(await page.locator('[data-indicator="tonnage"] .match-indicator-source').innerText(), /Distribution/);
    assert.equal(await page.locator('[data-indicator="performance"]').count(), 0);
    console.log(`Browser: Lot A cards, distribution tonnage and saved preferences at ${viewport.width}px: OK`);
    // Exercise the actual editor, not only its API contract: update, save and reload.
    await page.getByRole("navigation", { name: "Navigation de la feuille de match" })
      .getByRole("button", { name: "Aller à Brief équipe" }).click();
    const brief = page.locator(".match-brief-slide .tv-action");
    await brief.getByRole("button", { name: "Écrire" }).click();
    assert.equal((await brief.locator(".tv-plan-column.attack > b").textContent()).trim(), "Service client");
    await brief.locator(".tv-brief-indicator-options label").filter({ hasText: "Ponctualité arrivage" }).locator("input").check();
    await brief.locator(".tv-brief-tonnage-activity select").selectOption("expedition");
    await brief.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await brief.getByRole("button", { name: "Écrire" }).waitFor({ state: "visible" });
    const updated = await (await fetch(`${causerieUrl}?matchDate=${encodeURIComponent(importedSnapshot.match.date)}`, { headers: causerieHeaders })).json();
    assert.deepEqual(updated.plan.visibleIndicators, ["tonnage", "positions", "arrival"]);
    assert.equal(updated.plan.tonnageActivity, "expedition");
    await page.getByRole("navigation", { name: "Navigation de la feuille de match" })
      .getByRole("button", { name: "Aller à Coup de sifflet final" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".match-indicator-card").length === 3, null, { timeout: 15000 });
    assert.equal(await page.locator('[data-indicator="tonnage"] .match-indicator-value').innerText(), "478 t");
    await page.reload();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".match-indicator-card").length === 3, null, { timeout: 15000 });
    assert.equal(await page.locator('[data-indicator="tonnage"] .match-indicator-value').innerText(), "478 t");
    console.log(`Browser: Lot A UI editor, Service client, saved choice and reload at ${viewport.width}px: OK`);
    assert.deepEqual(errors, [], `Unexpected React errors at ${viewport.width}px`);
    console.log(`Browser: login, upload, agency confirmation, completed import at ${viewport.width}px: OK`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  for (const proc of [api, vite]) {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGTERM");
      await Promise.race([once(proc, "close"), new Promise(resolve => setTimeout(resolve, 2000))]);
    }
  }
  await fs.rm(root, { recursive: true, force: true });
  if (stderr) console.log("Server diagnostics:", stderr.slice(-1200));
}
