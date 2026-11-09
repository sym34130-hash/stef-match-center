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
      "Filtre opérateur", "Filtre heure", "Poste", "Poz non zonées", "DZ", "Duels gagnés", "Client de tri"],
    ["OP TEST", "17/09/2026 22:00:00", "DECHG", "P001", "TRIP-001", "05R", "Test", "", "", "", "", "", "", "TRI TEST"],
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
    // Lot A: the two 106J tonnages are distinct, regardless of operating period.
    const importedSnapshot = (await after.json()).snapshot;
    const causerieUrl = `http://127.0.0.1:${apiPort}/api/agencies/01K/causerie`;
    const causerieHeaders = { "x-access-code": "INTEGRATION-01K" };
    const matchDate = encodeURIComponent(importedSnapshot.match.date);
    const readBrief = async () => {
      const response = await fetch(`${causerieUrl}?matchDate=${matchDate}`, { headers: causerieHeaders });
      assert.equal(response.status, 200);
      return response.json();
    };
    const currentPlan = await readBrief();
    const savePlanResponse = await fetch(causerieUrl, {
      method: "POST",
      headers: { ...causerieHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        matchDate: importedSnapshot.match.date,
        expectedRevision: currentPlan.causerieRevision,
        plan: { visibleIndicators: ["tonnage-distribution", "tonnage-expedition", "positions"] },
      }),
    });
    assert.equal(savePlanResponse.status, 200, "Brief preferences must be persisted by the API");
    const savedPlan = (await savePlanResponse.json()).plan;
    assert.deepEqual(savedPlan.visibleIndicators, ["tonnage-distribution", "tonnage-expedition", "positions"]);

    // Synthetic PDF indicators are injected only into this isolated browser test.
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

    const assertTonnage = async (distribution, expedition, cardCount) => {
      await page.waitForFunction(expected => document.querySelectorAll(".match-indicator-card").length === expected, cardCount, { timeout: 15000 });
      assert.equal(await page.locator('[data-indicator="tonnage-distribution"]').count(), distribution === null ? 0 : 1);
      assert.equal(await page.locator('[data-indicator="tonnage-expedition"]').count(), expedition === null ? 0 : 1);
      if (distribution !== null) {
        assert.equal(await page.locator('[data-indicator="tonnage-distribution"] .match-indicator-value').innerText(), distribution);
      }
      if (expedition !== null) {
        assert.equal(await page.locator('[data-indicator="tonnage-expedition"] .match-indicator-value').innerText(), expedition);
      }
    };

    await page.reload();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await assertTonnage("255 t", "478 t", 3);
    assert.equal(await page.locator('[data-indicator="performance"]').count(), 0);
    console.log(`Browser: both 106J tonnages displayed together at ${viewport.width}px: OK`);

    const navigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
    await navigation.getByRole("button", { name: "Aller à Brief équipe" }).click();
    const brief = page.locator(".match-brief-slide .tv-action");
    await brief.getByRole("button", { name: "Écrire" }).click();
    assert.equal((await brief.locator(".tv-plan-column.attack > b").textContent()).trim(), "Service client");
    const toggle = (label) => brief.locator(".tv-brief-indicator-options label").filter({ hasText: label }).locator("input");
    await toggle("Tonnage Distribution").uncheck();
    await toggle("Ponctualité arrivage").check();
    await brief.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await brief.getByRole("button", { name: "Écrire" }).waitFor({ state: "visible" });
    let updated = await readBrief();
    assert.deepEqual(updated.plan.visibleIndicators, ["tonnage-expedition", "positions", "arrival"]);
    await navigation.getByRole("button", { name: "Aller à Coup de sifflet final" }).click();
    await assertTonnage(null, "478 t", 3);
    await page.reload();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await assertTonnage(null, "478 t", 3);

    // Reverse the selection to prove both toggles work independently.
    await navigation.getByRole("button", { name: "Aller à Brief équipe" }).click();
    await brief.getByRole("button", { name: "Écrire" }).click();
    await toggle("Tonnage Distribution").check();
    await toggle("Tonnage Expédition").uncheck();
    await brief.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await brief.getByRole("button", { name: "Écrire" }).waitFor({ state: "visible" });
    updated = await readBrief();
    assert.deepEqual(updated.plan.visibleIndicators, ["tonnage-distribution", "positions", "arrival"]);
    await navigation.getByRole("button", { name: "Aller à Coup de sifflet final" }).click();
    await assertTonnage("255 t", null, 3);
    await page.reload();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await assertTonnage("255 t", null, 3);
    console.log(`Browser: independent KPI toggles, Service client, saves and reloads at ${viewport.width}px: OK`);

    // The nine collective cards can also be edited next to the carousel,
    // without navigating to the team brief or altering the four score KPIs.
    const beforeDirectEdit = await readBrief();
    const button = page.getByRole("button", { name: "Personnaliser les indicateurs" });
    await button.click();
    const panel = page.getByRole("group", { name: "Personnalisation des neuf cartes du carrousel" });
    assert.equal(await panel.locator('input[type="checkbox"]').count(), 9);
    assert.equal(await panel.locator(".match-indicator-settings-options input:checked").count(), 3);
    await panel.locator("label").filter({ hasText: "Tonnage Distribution" }).locator("input").uncheck();
    await panel.locator("label").filter({ hasText: "Tonnage Expédition" }).locator("input").check();
    await panel.getByRole("button", { name: "Enregistrer l'affichage" }).click();
    await page.getByRole("status").getByText("Affichage du carrousel enregistré pour ce match.").waitFor({ state: "visible" });
    const afterDirectEdit = await readBrief();
    assert.deepEqual(afterDirectEdit.plan.visibleIndicators, ["tonnage-expedition", "positions", "arrival"]);
    for (const key of ["attack", "midfield", "defense", "attachments", "mercato", "mercatoProfiles", "redCards", "coach"]) {
      assert.deepEqual(afterDirectEdit.plan[key], beforeDirectEdit.plan[key], `A carousel setting must preserve ${key}`);
    }
    await assertTonnage(null, "478 t", 3);
    await page.reload();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await assertTonnage(null, "478 t", 3);
    console.log(`Browser: direct nine-card carousel editor, safe save and reload at ${viewport.width}px: OK`);
    // Lot B: reception-only travel and tri-client filtering, with an audit
    // trail and unchanged global metrics, in a strictly isolated agency.
    const readSnapshot = async () => {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/agencies/01K/snapshot`, { headers: causerieHeaders });
      assert.equal(response.status, 200);
      return (await response.json()).snapshot;
    };
    const baselineReception = await readSnapshot();
    assert.equal(baselineReception.receptionScope.clientColumnPresent, true);
    assert.deepEqual(baselineReception.receptionScope.availableTravels, ["TRIP-001"]);
    assert.deepEqual(baselineReception.receptionScope.availableClients.map(item => item.code), ["TRI TEST"]);
    await page.getByRole("navigation", { name: "Navigation de la feuille de match" })
      .getByRole("button", { name: "Aller à Statistiques du match" }).click();
    await page.locator(".operational-charts-carousel-dots").getByRole("tab", { name: "Afficher % duels gagnés" }).click();
    const scopePanel = page.locator(".reception-scope-control");
    const excludedRows = scopePanel.locator(".reception-scope-exclusion");
    const addToggle = scopePanel.locator(".reception-scope-add > summary");

    // The list is intentionally visible WITHOUT expanding the add form.
    await scopePanel.getByText("Aucune exclusion active sur ce match.").waitFor({ state: "visible" });
    assert.equal(await excludedRows.count(), 0);
    assert.equal(await addToggle.getAttribute("aria-expanded"), null); // native details
    await addToggle.click();
    assert.match(await scopePanel.innerText(), /Une exclusion modifie uniquement/);
    await scopePanel.getByLabel("Voyage concerné").selectOption("TRIP-001");
    await scopePanel.getByLabel("Motif de l'exclusion").first().fill("Double déchargement atypique");
    await scopePanel.getByRole("button", { name: "Exclure ce voyage de la réception" }).click();
    await page.waitForFunction(() => document.querySelector(".reception-scope-total")?.textContent?.includes("1 exclusion"), null, { timeout: 15000 });
    const travelFiltered = await readSnapshot();
    assert.deepEqual(travelFiltered.receptionScope.excludedTravels.map(item => item.code), ["TRIP-001"]);
    assert.equal(travelFiltered.summary.operations, baselineReception.summary.operations);
    assert.equal(travelFiltered.summary.positions, baselineReception.summary.positions);
    assert.equal(travelFiltered.summary.duelTotal, baselineReception.summary.duelTotal);

    const travelRow = excludedRows.filter({ hasText: "TRIP-001" });
    await travelRow.getByText("Double déchargement atypique").waitFor({ state: "visible" });
    assert.equal(await travelRow.isVisible(), true);
    assert.match(await travelRow.innerText(), /Exclu le/);
    // Closing the edit form must NOT hide the excluded voyage or its motif.
    await addToggle.click();
    assert.equal(await travelRow.isVisible(), true);
    assert.equal(await travelRow.getByText("Double déchargement atypique").isVisible(), true);
    const contrast = await travelRow.evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      text: getComputedStyle(element.querySelector(".reception-scope-code")).color,
    }));
    assert.deepEqual(contrast, {
      background: "rgb(245, 250, 255)",
      text: "rgb(14, 43, 71)",
    }, "Exclusion cards must use opaque, high-contrast colors");
    await travelRow.getByRole("button", { name: "Réintégrer le voyage TRIP-001 en réception" }).click();
    await page.waitForFunction(() => document.querySelector(".reception-scope-total")?.textContent?.includes("0 exclusion"), null, { timeout: 15000 });
    assert.equal(await excludedRows.count(), 0);
    const restoredReception = await readSnapshot();
    assert.deepEqual(restoredReception.receptionScope.excludedTravels, []);

    await addToggle.click();
    await scopePanel.getByLabel("Client identifié dans l'Excel").selectOption("TRI TEST");
    await scopePanel.getByLabel("Motif de l'exclusion").last().fill("Client de tri hors périmètre");
    await scopePanel.getByRole("button", { name: "Exclure ce client de la réception" }).click();
    await page.waitForFunction(() => document.querySelector(".reception-scope-total")?.textContent?.includes("1 exclusion"), null, { timeout: 15000 });
    const clientFiltered = await readSnapshot();
    assert.deepEqual(clientFiltered.receptionScope.excludedClients.map(item => item.code), ["TRI TEST"]);
    assert.equal(clientFiltered.summary.operations, baselineReception.summary.operations);
    const clientRow = excludedRows.filter({ hasText: "TRI TEST" });
    await clientRow.getByText("Client de tri hors périmètre").waitFor({ state: "visible" });
    // A refresh should still expose the retained rule, independently of the add form.
    await page.reload();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await page.getByRole("navigation", { name: "Navigation de la feuille de match" })
      .getByRole("button", { name: "Aller à Statistiques du match" }).click();
    await page.locator(".operational-charts-carousel-dots").getByRole("tab", { name: "Afficher % duels gagnés" }).click();
    const reloadedRow = page.locator(".reception-scope-exclusion").filter({ hasText: "TRI TEST" });
    await reloadedRow.getByText("Client de tri hors périmètre").waitFor({ state: "visible" });
    assert.equal(await page.locator(".reception-scope-add").getAttribute("open"), null);
    const state = JSON.parse(await fs.readFile(path.join(root, "01K", "reception-exclusions.json"), "utf8"));
    assert.equal(Object.values(state.scopes)[0].history.length, viewport.width === 1366 ? 3 : 7);
    await reloadedRow.getByRole("button", { name: "Réintégrer le client TRI TEST en réception" }).click();
    await page.waitForFunction(() => document.querySelector(".reception-scope-total")?.textContent?.includes("0 exclusion"), null, { timeout: 15000 });
    assert.deepEqual((await readSnapshot()).receptionScope.excludedClients, []);
    console.log(`Browser: scoped reception voyage, tri client, restore, audit at ${viewport.width}px: OK`);
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
