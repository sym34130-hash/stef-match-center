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
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Chargement"],
    ["Code Voyage", "Min. de Date/Heure de début d'opération", "Nombre de N° Position", "TC", "TC/poz", "Commentaire"],
    ["CHG-OK", "17/09/2026 22:00:00", 15, 90 / 86400, 90 / 86400, ""],
    ["CHG-SLOW", "17/09/2026 22:20:00", 15, 200 / 86400, 200 / 86400, ""],
  ]), "TCD PPT");
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
    assert.deepEqual(savedPlan.visibleIndicators, ["accident-free-days", "tonnage-distribution", "tonnage-expedition", "positions"]);

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

    const assertTonnage = async (distribution, expedition, cardCount, safetyVisible = true) => {
      // The A.T. card is selected by default for legacy plans but can be hidden.
      await page.waitForFunction(expected => document.querySelectorAll(".match-indicator-card").length === expected, cardCount + Number(safetyVisible), { timeout: 15000 });
      assert.equal(await page.locator('[data-indicator="accident-free-days"] .match-indicator-card.is-safety').count(), Number(safetyVisible));
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
    assert.deepEqual(updated.plan.visibleIndicators, ["accident-free-days", "tonnage-expedition", "positions", "arrival"]);
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
    assert.deepEqual(updated.plan.visibleIndicators, ["accident-free-days", "tonnage-distribution", "positions", "arrival"]);
    await navigation.getByRole("button", { name: "Aller à Coup de sifflet final" }).click();
    await assertTonnage("255 t", null, 3);
    await page.reload();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await assertTonnage("255 t", null, 3);
    console.log(`Browser: independent KPI toggles, Service client, saves and reloads at ${viewport.width}px: OK`);

    // All ten collective cards can also be edited next to the carousel,
    // without navigating to the team brief or altering the four score KPIs.
    const beforeDirectEdit = await readBrief();
    const button = page.getByRole("button", { name: "Personnaliser les indicateurs" });
    await button.click();
    const panel = page.getByRole("group", { name: "Personnalisation des dix cartes du carrousel" });
    assert.equal(await panel.locator('input[type="checkbox"]').count(), 10);
    assert.equal(await panel.locator(".match-indicator-settings-options input:checked").count(), 4);
    await panel.locator("label").filter({ hasText: "Tonnage Distribution" }).locator("input").uncheck();
    await panel.locator("label").filter({ hasText: "Tonnage Expédition" }).locator("input").check();
    await panel.getByRole("button", { name: "Enregistrer l'affichage" }).click();
    await page.getByRole("status").getByText("Affichage du carrousel enregistré pour ce match.").waitFor({ state: "visible" });
    const afterDirectEdit = await readBrief();
    assert.deepEqual(afterDirectEdit.plan.visibleIndicators, ["accident-free-days", "tonnage-expedition", "positions", "arrival"]);
    for (const key of ["attack", "midfield", "defense", "attachments", "mercato", "mercatoProfiles", "redCards", "coach"]) {
      assert.deepEqual(afterDirectEdit.plan[key], beforeDirectEdit.plan[key], `A carousel setting must preserve ${key}`);
    }
    await assertTonnage(null, "478 t", 3);
    await page.reload();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await assertTonnage(null, "478 t", 3);
    console.log(`Browser: direct ten-card carousel editor, safe save and reload at ${viewport.width}px: OK`);
    // A deliberate AT deselection must persist; migration must not re-enable it.
    await button.click();
    const safetyToggle = panel.locator("label").filter({ hasText: "Jours sans accident du travail" }).locator("input");
    assert.equal(await safetyToggle.isChecked(), true);
    await safetyToggle.uncheck();
    await panel.getByRole("button", { name: "Enregistrer l'affichage" }).click();
    await page.getByRole("status").getByText("Affichage du carrousel enregistré pour ce match.").waitFor({ state: "visible" });
    const withoutSafety = await readBrief();
    assert.deepEqual(withoutSafety.plan.visibleIndicators, ["tonnage-expedition", "positions", "arrival"]);
    assert.equal(withoutSafety.plan.visibleIndicatorsVersion, 2);
    await assertTonnage(null, "478 t", 3, false);
    await page.reload();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await assertTonnage(null, "478 t", 3, false);
    console.log(`Browser: AT card can be hidden and remains hidden after reload at ${viewport.width}px: OK`);


    // In celebration mode the editor must be outside the height-constrained carousel.
    await page.getByRole("button", { name: "Mode célébration" }).click();
    const celebration = page.locator(".match-page.is-celebration-mode");
    await celebration.waitFor({ state: "visible" });
    const celebrationCarousel = celebration.locator(".match-indicators-viewport");
    const carouselBeforeDialog = await celebrationCarousel.boundingBox();
    assert.ok(carouselBeforeDialog?.height > 0, "The celebration carousel must remain visible");
    assert.equal(await celebration.locator(".match-indicators-customization").count(), 0,
      "Presentation mode must not waste a carousel header row on the settings button");
    const celebrationSettingsButton = celebration.locator(".match-carousel-controls")
      .getByRole("button", { name: "Personnaliser les indicateurs" });
    await celebrationSettingsButton.click();
    const celebrationDialog = page.getByRole("dialog", { name: "Personnaliser les indicateurs" });
    await celebrationDialog.waitFor({ state: "visible" });
    assert.equal(await celebration.locator(".match-indicators-area .match-indicator-settings").count(), 0,
      "The settings form must not occupy a carousel grid row");
    assert.equal(await page.locator("body > .match-indicator-settings-backdrop").count(), 1,
      "The editor must be portalled outside the clipped celebration slide");
    assert.equal(await celebrationDialog.locator('input[type="checkbox"]').count(), 10);
    const dialogBox = await celebrationDialog.boundingBox();
    const dialogDiagnostics = await celebrationDialog.evaluate(element => ({
      dialog: element.getBoundingClientRect().toJSON(),
      backdrop: element.parentElement?.getBoundingClientRect().toJSON(),
      maxHeight: getComputedStyle(element).maxHeight,
      overflow: getComputedStyle(element).overflow,
      scrollHeight: element.scrollHeight,
      innerHeight: window.innerHeight,
      visualHeight: window.visualViewport?.height,
    }));
    assert.ok(dialogBox && dialogBox.y >= -1 && dialogBox.y + dialogBox.height <= viewport.height + 1,
      "All dialog content must fit into a scrollable viewport: " + JSON.stringify({ dialogBox, viewport, dialogDiagnostics }));
    const carouselWithDialog = await celebrationCarousel.boundingBox();
    assert.ok(carouselWithDialog && Math.abs(carouselWithDialog.height - carouselBeforeDialog.height) < 2,
      "Opening settings must not shrink the KPI carousel");
    await page.keyboard.press("Escape");
    await celebrationDialog.waitFor({ state: "hidden" });
    assert.equal(await celebrationSettingsButton.evaluate(el => document.activeElement === el), true,
      "Closing with Escape must restore keyboard focus");

    await celebrationSettingsButton.click();
    const celebrationSafety = celebrationDialog.locator("label")
      .filter({ hasText: "Jours sans accident du travail" }).locator("input");
    await celebrationSafety.check();
    await celebrationDialog.getByRole("button", { name: "Enregistrer l'affichage" }).click();
    await celebrationDialog.waitFor({ state: "hidden" });
    await page.getByRole("status").getByText("Affichage du carrousel enregistré pour ce match.").waitFor({ state: "visible" });
    assert.deepEqual((await readBrief()).plan.visibleIndicators,
      ["accident-free-days", "tonnage-expedition", "positions", "arrival"]);
    await assertTonnage(null, "478 t", 3, true);
    const carouselAfterDialog = await celebrationCarousel.boundingBox();
    assert.ok(carouselAfterDialog && carouselAfterDialog.height > 100,
      "The KPI carousel must remain readable after the number of selected cards changes");
    assert.equal(await celebration.locator(".match-indicators-area .match-indicator-settings").count(), 0,
      "Saving must not reinsert the editor into the presentation carousel");
    await page.getByRole("button", { name: "Sortir du mode Célébration" }).click();
    console.log(`Browser: independent celebration dialog, keyboard access and unchanged carousel at ${viewport.width}px: OK`);

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
    const scopePanel = page.locator(".reception-scope-control");
    assert.equal(await scopePanel.evaluate(element => Boolean(element.closest(".operational-charts-carousel"))), false,
      "The exclusion controls must sit outside the horizontally swiping chart");
    const excludedRows = scopePanel.locator(".reception-scope-exclusion");
    const collapseToggle = scopePanel.locator(".reception-scope-collapse-summary");
    const addToggle = scopePanel.locator(".reception-scope-add > summary");
    assert.equal(await scopePanel.getAttribute("open"), null, "Management must start collapsed");
    const compactHeight = await scopePanel.evaluate(element => element.getBoundingClientRect().height);
    assert.ok(compactHeight <= 85, `Collapsed manager must not shrink the charts (${compactHeight}px)`);
    await collapseToggle.click();

    // The list is intentionally visible WITHOUT expanding the add form.
    await scopePanel.getByText("Aucune exclusion active sur ce match.").waitFor({ state: "visible" });
    assert.equal(await excludedRows.count(), 0);
    assert.equal(await addToggle.getAttribute("aria-expanded"), null); // native details
    await addToggle.click();
    assert.match(await scopePanel.innerText(), /Cette exclusion agit seulement/);
    // Long operational motives must wrap without horizontal clipping in both
    // normal statistics and the fixed-height celebration/TV layout.
    const reasonField = scopePanel.getByLabel("Motif de l'exclusion").first();
    const longReason = "Double déchargement exceptionnel avec plusieurs opérateurs, un retour quai imprévu et des temps à vérifier avant toute comparaison.";
    await reasonField.fill(longReason);
    const assertReasonVisible = async () => {
      const geometry = await reasonField.evaluate(field => {
        const input = field.getBoundingClientRect();
        const editor = field.closest(".reception-scope-editor").getBoundingClientRect();
        const panel = field.closest(".reception-scope-control").getBoundingClientRect();
        const scroll = field.closest(".reception-scope-expanded");
        return {
          input: { left: input.left, right: input.right, top: input.top, bottom: input.bottom },
          editor: { left: editor.left, right: editor.right },
          panel: { left: panel.left, right: panel.right },
          scrollHeight: field.scrollHeight, clientHeight: field.clientHeight,
          width: field.clientWidth,
          expandedScrollable: scroll.scrollHeight > scroll.clientHeight,
        };
      });
      assert.ok(geometry.input.left >= geometry.editor.left - 2, "The motive must not be clipped on the left");
      assert.ok(geometry.input.right <= geometry.editor.right + 2, "The motive must not be clipped on the right");
      assert.ok(geometry.input.left >= geometry.panel.left - 2 && geometry.input.right <= geometry.panel.right + 2,
        "No horizontal overflow outside the exclusion panel");
      assert.ok(geometry.width >= 160, "The motive textarea must remain wide enough to read");
      assert.ok(geometry.scrollHeight <= geometry.clientHeight + 3,
        "A reasonably long motive must expand to show all its lines: " + JSON.stringify(geometry));
      return geometry;
    };
    await assertReasonVisible();
    const matchPage = page.locator(".match-page");
    const originalCelebration = await matchPage.evaluate(el => el.classList.contains("is-celebration-mode"));
    if (!originalCelebration) await matchPage.evaluate(el => el.classList.add("is-celebration-mode"));
    await reasonField.scrollIntoViewIfNeeded();
    const tvGeometry = await assertReasonVisible();
    assert.ok(tvGeometry.expandedScrollable || tvGeometry.input.bottom <= viewport.height,
      "The motive must be accessible in TV mode, including by scrolling the panel");
    if (!originalCelebration) await matchPage.evaluate(el => el.classList.remove("is-celebration-mode"));
    await reasonField.fill("Double déchargement atypique");
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
    // Closing the edit form keeps the audit row visible. The OUTER panel can
    // still be collapsed while it contains an excluded voyage.
    await addToggle.click();
    assert.equal(await travelRow.isVisible(), true);
    await collapseToggle.click();
    assert.equal(await scopePanel.getAttribute("open"), null, "Even with a voyage excluded, full collapse must work");
    assert.equal(await travelRow.isVisible(), false);
    assert.match(await collapseToggle.innerText(), /1 exclusion active/);
    assert.ok(await scopePanel.evaluate(element => element.getBoundingClientRect().height) <= 85);
    await collapseToggle.click();
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
    assert.equal(await page.locator(".reception-scope-control").getAttribute("open"), null,
      "After reload, the manager remains compact even with exclusions");
    assert.match(await page.locator(".reception-scope-collapse-summary").innerText(), /1 exclusion active/);
    await page.locator(".reception-scope-collapse-summary").click();
    const reloadedRow = page.locator(".reception-scope-exclusion").filter({ hasText: "TRI TEST" });
    await reloadedRow.getByText("Client de tri hors périmètre").waitFor({ state: "visible" });
    assert.equal(await page.locator(".reception-scope-add").getAttribute("open"), null);
    const state = JSON.parse(await fs.readFile(path.join(root, "01K", "reception-exclusions.json"), "utf8"));
    assert.equal(Object.values(state.scopes)[0].history.length, viewport.width === 1366 ? 3 : 7);
    await reloadedRow.getByRole("button", { name: "Réintégrer le client TRI TEST en réception" }).click();
    await page.waitForFunction(() => document.querySelector(".reception-scope-total")?.textContent?.includes("0 exclusion"), null, { timeout: 15000 });
    assert.deepEqual((await readSnapshot()).receptionScope.excludedClients, []);
    // Both activities use the same expandable container, but separate scopes.
    await page.getByRole("tab", { name: "Chargement 0" }).click();
    await page.locator(".reception-scope-current").getByText("Aucune exclusion active sur ce match.").waitFor({ state: "visible" });
    const beforeLoading = await readSnapshot();
    assert.deepEqual(beforeLoading.loadingScope.availableTravels, ["CHG-OK", "CHG-SLOW"]);
    assert.equal(beforeLoading.loadingQuality.targetedPercent, 50);
    await scopePanel.locator(".reception-scope-add > summary").click();
    await scopePanel.getByLabel("Voyage concerné").selectOption("CHG-SLOW");
    const loadingReason = scopePanel.getByLabel("Motif de l'exclusion");
    await loadingReason.fill("Chargement exceptionnel : retour au quai pour contrôle exceptionnel du chargement sur la plage active.");
    assert.ok(await loadingReason.evaluate(field => {
      const rect = field.getBoundingClientRect();
      const editor = field.closest(".reception-scope-editor").getBoundingClientRect();
      return rect.left >= editor.left - 2 && rect.right <= editor.right + 2 && field.scrollHeight <= field.clientHeight + 3;
    }), "CHG motive must fit the form without clipping");
    await loadingReason.fill("Chargement exceptionnel");
    await scopePanel.getByRole("button", { name: "Exclure ce voyage du chargement" }).click();
    await page.waitForFunction(() => document.querySelector(".reception-scope-total")?.textContent?.includes("1 exclusion"), null, { timeout: 15000 });
    const afterLoading = await readSnapshot();
    assert.equal(afterLoading.loadingQuality.targetedPercent, 100);
    assert.equal(afterLoading.operationalScore.indicators.loadingPercent, 100);
    assert.equal(afterLoading.summary.operations, beforeLoading.summary.operations);
    assert.equal(afterLoading.summary.positions, beforeLoading.summary.positions);
    assert.equal(afterLoading.summary.passRate, beforeLoading.summary.passRate);
    assert.equal(afterLoading.unloadingQuality.targetedPercent, beforeLoading.unloadingQuality.targetedPercent);
    const loadingRow = scopePanel.locator(".reception-scope-exclusion").filter({ hasText: "CHG-SLOW" });
    await loadingRow.getByText("Chargement exceptionnel").waitFor({ state: "visible" });
    await scopePanel.locator(".reception-scope-collapse-summary").click();
    assert.equal(await scopePanel.getAttribute("open"), null, "CHG exclusions must remain retractable");
    assert.match(await scopePanel.locator(".reception-scope-collapse-summary").innerText(), /1 exclusion active/);
    await scopePanel.locator(".reception-scope-collapse-summary").click();
    await loadingRow.getByRole("button", { name: "Réintégrer le voyage CHG-SLOW en chargement" }).click();
    await page.waitForFunction(() => document.querySelector(".reception-scope-total")?.textContent?.includes("0 exclusion"), null, { timeout: 15000 });
    assert.equal((await readSnapshot()).loadingQuality.targetedPercent, 50);
    assert.deepEqual((await readSnapshot()).loadingScope.excludedTravels, []);
    const loadingState = JSON.parse(await fs.readFile(path.join(root, "01K", "loading-exclusions.json"), "utf8"));
    assert.equal(Object.values(loadingState.scopes)[0].history.length, viewport.width === 1366 ? 2 : 4);
    await scopePanel.locator(".reception-scope-collapse-summary").click();
    assert.equal(await scopePanel.getAttribute("open"), null);
    console.log(`Browser: CHG/DECHG scoped exclusions, compact panel, restore and audit at ${viewport.width}px: OK`);
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
