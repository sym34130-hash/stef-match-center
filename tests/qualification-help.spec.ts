import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";
import type { Snapshot } from "../src/types";
import { describeQualificationReason, NON_QUALIFIABLE_NOTICE, qualificationReasons } from "../src/qualification-reasons";

test.use({ reducedMotion: "reduce", actionTimeout: 10_000 });
const headers = ["Operateur", "Date Heure de debut d operation", "Type operation", "N position", "Code voyage", "Agence segment", "Type segment", "Filtre operateur", "Filtre heure", "Poste", "Poz non zonees", "DZ", "Duels gagnes", "Heure OP"];
const source = (type: string, position: string, clock: string, travel = "TEST-IN") => ["Anonymous", `2026-09-17T${clock}+02:00`, type, position, travel, "058", "", "", "", "", "", 1 / 24, 0, Number(clock.slice(0, 2))];
function fixture(unknown = false) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers,
    source("DECHG", "BEFORE", "22:10:00"), source("ZONAGE", "BEFORE", "22:00:00", ""),
    source("DECHG", "ABSENT", "22:20:00"), source("DECHG", "NO-TRAVEL", "22:20:00", ""),
    source("DECHG", "CONFLICT", "22:10:00", "TEST-A"), source("DECHG", "CONFLICT", "22:11:00", "TEST-B"),
    source("DECHG", "LATE", "22:00:00"), source("ZONAGE", "LATE", "23:00:00", ""),
  ]), "Données");
  const result = buildSnapshotFromWorkbook(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), "qualification.xlsx", "058", { start: "21:30", end: "06:30" });
  expect(result.ok).toBe(true);
  const snapshot = result.snapshot as Snapshot;
  if (unknown) snapshot.zonageDiagnostic!.details.find(entry => entry.position === "ABSENT")!.reason = "future_reason";
  return snapshot;
}
async function prepare(page: Page, snapshot: Snapshot) {
  await page.addInitScript(() => { sessionStorage.clear(); localStorage.clear(); });
  await page.route("**/api/session", route => route.fulfill({ json: { agency: { code: "058", name: "Agen", canImport: true } } }));
  await page.route("**/api/agencies/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/snapshot")) return route.fulfill({ json: { snapshot } });
    if (path.endsWith("/league-configs")) return route.fulfill({ json: { configs: [] } });
    if (path.endsWith("/sync-state")) return route.fulfill({ json: { snapshotRevision: "qualification", leagueConfigRevision: "qualification", causerieRevision: null } });
    if (path.endsWith("/causerie")) return route.fulfill({ json: { plan: null } });
    throw new Error(`Unexpected API call: ${path}`);
  });
  await page.goto("/");
  await page.getByLabel("Code d'accès").fill("SYNTHETIC-TEST-ONLY");
  await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
}
async function openDiagnostic(page: Page, mode: string) {
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  if (mode === "celebration") {
    await navigation.getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
    await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
  }
  await navigation.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
  await page.getByRole("tab", { name: "Afficher Diagnostic opérationnel", exact: true }).click();
  await page.getByRole("button", { name: "Voir les positions à examiner", exact: true }).click();
}

test("motifs : quatre explications, clavier, fermeture, aucun déplacement des lignes", async ({ page }, info) => {
  test.setTimeout(180_000);
  const snapshot = fixture(), initial = JSON.stringify(snapshot), errors: string[] = [], writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/api/agencies/") && request.method() !== "GET") writes.push(request.method()); });
  await prepare(page, snapshot);
  const sizes = info.project.name === "desktop" ? [[1366, 768], [1440, 900], [390, 844], [320, 700]] : [[info.project.use.viewport!.width, info.project.use.viewport!.height]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const mode of ["normal", "celebration"]) {
      await openDiagnostic(page, mode);
      const outer = page.getByRole("dialog", { name: "Positions à examiner", exact: true });
      await expect(outer.locator(".qualification-help-trigger")).toHaveCount(4);
      await expect(outer.getByRole("button", { name: "Fermer les positions à examiner", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(outer.locator(".qualification-help-trigger").first()).toBeFocused();
      for (const reason of Object.values(qualificationReasons)) {
        const button = outer.getByRole("button", { name: new RegExp(`Comprendre le motif ${reason.label} pour la position`) });
        await button.scrollIntoViewIfNeeded();
        const geometry = () => button.evaluate(el => {
          const row = el.closest("li")!.getBoundingClientRect(), dialog = el.closest("dialog")!.getBoundingClientRect();
          const list = el.closest("ul")!;
          return { rowHeight: row.height, rowTop: row.top, dialogHeight: dialog.height, dialogWidth: dialog.width, scrollHeight: list.scrollHeight };
        });
        const before = await geometry();
        await button.focus(); await page.keyboard.press("Enter");
        const help = page.getByRole("dialog", { name: `Comprendre : ${reason.label}`, exact: true });
        await expect(help).toBeVisible();
        await expect(help).toContainText(reason.explanation);
        await expect(help).toContainText(NON_QUALIFIABLE_NOTICE);
        await expect(button).toHaveAttribute("aria-expanded", "true");
        expect(await page.locator(".qualification-help-popover:popover-open").count()).toBe(1);
        expect(await geometry()).toEqual(before);
        const box = await help.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
        expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
        expect(await help.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        if (reason.label === "Zonage uniquement antérieur") await page.screenshot({ path: info.outputPath(`${width}x${height}-${mode}-explanation.png`) });
        await page.keyboard.press("Escape");
        await expect(help).not.toBeVisible(); await expect(outer).toBeVisible(); await expect(button).toBeFocused();
        await page.keyboard.press("Space"); await expect(help).toBeVisible();
        await help.getByRole("button", { name: "Fermer l’explication", exact: true }).click();
        await expect(help).not.toBeVisible(); await expect(button).toBeFocused();
        await button.click(); await expect(help).toBeVisible();
        await outer.getByRole("heading", { name: "Positions à examiner", exact: true }).click();
        await expect(help).not.toBeVisible(); await expect(outer).toBeVisible();
        expect(await geometry()).toEqual(before);
      }
      const buttons = outer.locator(".qualification-help-trigger");
      await buttons.nth(0).click();
      // The open explanation may cover an adjacent row; switch through its accessible control.
      await buttons.nth(1).focus(); await page.keyboard.press("Enter");
      expect(await page.locator(".qualification-help-popover:popover-open").count()).toBe(1);
      await outer.getByRole("button", { name: "Fermer les positions à examiner", exact: true }).click();
      await expect(outer).not.toBeVisible();
      expect(await page.locator(".qualification-help-popover:popover-open").count()).toBe(0);
      if (mode === "celebration") await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
  }
  expect(JSON.stringify(snapshot)).toBe(initial); expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test("motifs : fallback inconnu et mini-glossaire fidèle", async ({ page }) => {
  await prepare(page, fixture(true));
  await openDiagnostic(page, "normal");
  await page.getByRole("button", { name: "Comprendre le motif Association non qualifiable pour la position ABSENT", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Comprendre : Association non qualifiable", exact: true });
  await expect(help).toContainText(describeQualificationReason("future_reason").explanation);
  await expect(help).toContainText(NON_QUALIFIABLE_NOTICE);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "? Guide", exact: true }).click();
  await page.getByRole("button", { name: "05 Analyser les anomalies", exact: true }).click();
  await page.getByText("Comprendre les motifs « Non qualifiable »", { exact: true }).click();
  const glossary = page.locator(".guide-qualification-glossary");
  await expect(glossary).toBeVisible(); await expect(glossary.locator("dt")).toHaveCount(4);
  for (const reason of Object.values(qualificationReasons)) {
    await expect(glossary).toContainText(reason.label); await expect(glossary).toContainText(reason.summary);
  }
  await expect(page.locator(".guide-page")).toContainText("Une position non qualifiable est une position dont le délai de zonage ne peut pas être vérifié de manière fiable avec les données disponibles.");
});
