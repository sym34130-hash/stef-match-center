import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Snapshot } from "../src/types";

test.use({ reducedMotion: "reduce" });
const base = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8")) as Snapshot;
const agencies = [
  { code: "058", name: "Agen" }, { code: "01K", name: "Montpellier" },
  { code: "05R", name: "Toulouse" }, { code: "04P", name: "Bordeaux" },
  { code: "R3A", name: "Lyon" }, { code: "04H", name: "Brive" },
];
const sections = ["Démarrer", "Préparer Excel", "Importer et actualiser", "Lire les écrans", "Analyser les anomalies", "Modifier le plan", "Administrateur", "Points d’attention"];
const configs = [
  { id: "bronze", zonageMinutes: 45, loadingSeconds: 195, unloadingSeconds: 75, scoreTargetPercent: 45 },
  { id: "argent", zonageMinutes: 27, loadingSeconds: 142, unloadingSeconds: 52, scoreTargetPercent: 50 },
  { id: "or", zonageMinutes: 25, loadingSeconds: 150, unloadingSeconds: 55, scoreTargetPercent: 60 },
  { id: "platine", zonageMinutes: 20, loadingSeconds: 135, unloadingSeconds: 50, scoreTargetPercent: 70 },
];

async function openGuide(page: Page) {
  if (await page.locator(".tv-mode").count()) await page.getByRole("button", { name: "Quitter le brief équipe", exact: true }).click();
  const back = page.getByRole("button", { name: "Retour au coup d'envoi", exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByRole("button", { name: "? Guide", exact: true }).click();
  await expect(page.locator(".guide-page")).toBeVisible();
}
function item(page: Page, index: number) {
  return page.getByRole("navigation", { name: "Sommaire du guide" }).getByRole("button", { name: `${String(index + 1).padStart(2, "0")} ${sections[index]}`, exact: true });
}
async function mockGuide(page: Page, current: () => { agency: typeof agencies[number]; imported: boolean }) {
  await page.addInitScript(() => { sessionStorage.clear(); localStorage.clear(); });
  await page.route("**/api/session", route => route.fulfill({ json: { agency: { ...current().agency, canImport: true } } }));
  await page.route("**/api/agencies/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/snapshot")) return current().imported
      ? route.fulfill({ json: { snapshot: { ...base, agency: { ...current().agency, detectedCode: current().agency.code } } } })
      : route.fulfill({ status: 404, json: { message: "Aucun match importé" } });
    if (path.endsWith("/league-configs")) return route.fulfill({ json: { configs } });
    if (path.endsWith("/sync-state")) return route.fulfill({ json: { snapshotRevision: "guide-fixture", leagueConfigRevision: "guide-config", causerieRevision: null } });
    if (path.endsWith("/causerie")) return route.fulfill({ json: { plan: null } });
    return route.continue();
  });
}
async function login(page: Page, code: string) {
  await page.goto("/"); await page.getByLabel("Code agence").selectOption(code);
  await page.getByLabel("Code d'accès").fill("GUIDE-TEST-ONLY");
  await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
  await openGuide(page);
}

test("Guide V2 : huit rubriques, progression et six agences avec/sans Excel", async ({ page }, info) => {
  test.setTimeout(180_000);
  let current = { agency: agencies[0], imported: false };
  await mockGuide(page, () => current);
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/api/agencies/") && request.method() !== "GET") writes.push(request.method()); });
  for (const agency of agencies) for (const imported of [false, true]) {
    current = { agency, imported };
    await login(page, agency.code);
    const guide = page.locator(".guide-page"), progress = guide.getByRole("progressbar");
    await expect(guide.locator(".guide-nav-item")).toHaveCount(8);
    await expect(guide.locator(".guide-hero-status strong")).toHaveText(imported ? "Match disponible" : "Excel à importer");
    await expect(guide).not.toContainText("GUIDE-TEST-ONLY");
    await expect(guide).not.toContainText(/STEF-(058|01K|05R|04P|R3A|04H)/);
    await expect(guide).toContainText("Agen, Montpellier, Toulouse, Bordeaux, Lyon et Brive");
    await expect(guide.getByRole("button", { name: "Étape précédente", exact: true })).toBeDisabled();
    for (let index = 0; index < sections.length; index++) {
      await expect(item(page, index)).toHaveAttribute("aria-current", "step");
      await expect(progress).toHaveAttribute("aria-valuenow", String(index + 1));
      await expect(progress).toHaveAttribute("aria-valuemax", "8");
      await expect(guide.locator(".guide-panel-heading .eyebrow")).toContainText(`${String(index + 1).padStart(2, "0")} · ${sections[index]}`);
      expect(await guide.locator(".guide-progress-track > span").evaluate(el => parseFloat((el as HTMLElement).style.width))).toBe((index + 1) / 8 * 100);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${agency.code} ${imported} ${sections[index]}`).toBe(true);
      const box = await guide.locator(".guide-panel").boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
      expect(await guide.locator(".guide-nav-item, .guide-panel-heading, .guide-actions button, .guide-steps li").evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
      if (index === 4 && agency.code === "058" && imported) {
        await expect(guide.getByRole("heading", { name: "FLOP Zonage - TOP 5", exact: true })).toBeVisible();
        await expect(guide).toContainText("nombre de retards");
        await expect(guide).toContainText("Les trois segments totalisent 100 %", { ignoreCase: true });
        await expect(guide.locator(".guide-zonage-legend > span")).toHaveCount(3);
        await expect(guide).toContainText("Ces positions ne sont pas comptées comme des retards.");
        await expect(guide).not.toContainText(/SORG02|184|188/);
        for (const summary of await guide.locator(".guide-disclosure summary").all()) {
          await summary.focus(); await page.keyboard.press("Enter");
          await expect(summary.locator("..")).toHaveAttribute("open", "");
        }
        await expect(guide).toContainText("n’est pas un temps à zéro");
        await expect(guide).toContainText("N’additionnez jamais positions et voyages");
        await guide.locator(".guide-panel").screenshot({ path: info.outputPath("guide-anomalies.png") });
      }
      if (index < 7) await guide.getByRole("button", { name: "Étape suivante", exact: true }).click();
    }
    await expect(guide.getByRole("button", { name: "Étape suivante", exact: true })).toBeDisabled();
    await expect(guide).toContainText("Après une mise à jour ou un redémarrage du site, les données enregistrées peuvent disparaître.");
    await guide.getByRole("button", { name: "Étape précédente", exact: true }).click();
    await expect(item(page, 6)).toHaveAttribute("aria-current", "step");
    await expect(guide.locator(".guide-league-card.silver")).toContainText("27 min");
    await guide.getByRole("button", { name: "Retour au début", exact: true }).click();
    await expect(item(page, 0)).toHaveAttribute("aria-current", "step");
    for (let index = 7; index >= 0; index--) { await item(page, index).click(); await expect(progress).toHaveAttribute("aria-valuenow", String(index + 1)); }
  }
  if (info.project.name === "desktop") for (const [width, height] of [[320, 700], [390, 844], [768, 1024], [1366, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    for (let index = 0; index < sections.length; index++) {
      await item(page, index).click();
      await expect.poll(async () => page.locator(".guide-content").evaluate(el => {
        const area = el.getBoundingClientRect(), navigation = document.querySelector<HTMLElement>(".sidebar")!;
        const nav = navigation.getBoundingClientRect();
        const inset = nav.right > area.left && nav.left < area.right ? navigation.offsetHeight + 12 : 18;
        const maxScroll = document.documentElement.scrollHeight - innerHeight;
        const expectedScroll = Math.min(maxScroll, Math.max(0, scrollY + area.top - inset));
        return Math.abs(scrollY - expectedScroll);
      })).toBeLessThanOrEqual(2);
      const geometry = await page.locator(".guide-content").evaluate(el => {
        const area = el.getBoundingClientRect(), nav = document.querySelector(".sidebar")!.getBoundingClientRect();
        return { right: area.right, left: area.left, top: area.top, navBottom: nav.bottom, intersect: nav.right > area.left && nav.left < area.right, clipped: el.scrollWidth > el.clientWidth + 1 };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(width + 1);
      expect(geometry.clipped).toBe(false);
      expect(geometry.top).toBeLessThan(height / 2);
      if (geometry.intersect) expect(geometry.top).toBeGreaterThanOrEqual(geometry.navBottom - 1);
    }
  }
  expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test("Guide V2 : liens réels, périmètres et consignes fidèles", async ({ page }) => {
  test.setTimeout(120_000);
  let imported = true;
  await mockGuide(page, () => ({ agency: agencies[0], imported }));
  for (const available of [true, false]) {
    imported = available; await login(page, "058");
    await item(page, 1).click();
    await expect(page.locator(".guide-page")).toContainText("ne recalcule pas les formules du classeur");
    await expect(page.locator(".guide-page")).not.toContainText("H correspond");
    await expect(page.locator(".guide-excel-figure img")).toBeVisible();
    expect(await page.locator(".guide-excel-figure img").evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await item(page, 3).click();
    await expect(page.locator("ol.guide-reading-list li")).toHaveCount(5);
    await expect(page.locator("ol.guide-reading-list li").nth(3)).toContainText("ponctualité destination du PDF 106J");
    await item(page, 5).click();
    for (const label of ["SAV", "EXPÉDITION / RAMASSE & EMBALLAGE", "SST", "Priorité terrain", "Zone à surveiller", "Équilibre d'équipe", "Conflit de sauvegarde"]) await expect(page.locator(".guide-page")).toContainText(label);
    const links = [
      { section: 0, label: "Ouvrir l’import", target: ".import-page" },
      { section: 3, label: "Ouvrir la Feuille de match", target: available ? ".match-page" : ".no-data-view" },
      { section: 3, label: "Ouvrir Composition", target: available ? ".composition-page" : ".no-data-view" },
      { section: 3, label: "Ouvrir Coach", target: available ? ".coach-page" : ".no-data-view" },
      { section: 3, label: "Ouvrir le brief équipe", target: available ? ".tv-mode" : ".no-data-view" },
      { section: 6, label: "Ouvrir Administrateur", target: ".administrator-page" },
    ];
    for (const link of links) {
      await item(page, link.section).click();
      await page.getByRole("button", { name: link.label, exact: true }).click();
      if (!available && link.target === ".no-data-view") await expect(page.getByRole("heading", { name: "Aucun match importé", exact: true })).toBeVisible();
      else await expect(page.locator(link.target)).toBeVisible();
      await openGuide(page);
    }
  }
});
