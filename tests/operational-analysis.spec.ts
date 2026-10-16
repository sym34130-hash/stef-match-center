import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";
import type { Snapshot } from "../src/types";

test.use({ reducedMotion: "reduce" });
const base: Snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
const wb = XLSX.utils.book_new();
const headers = ["Operateur", "Date Heure de debut d operation", "Type operation", "N position", "Code voyage", "Agence segment", "Type segment", "Filtre operateur", "Filtre heure", "Poste", "Poz non zonees", "DZ", "Duels gagnes", "Heure OP"];
const rows: Array<Array<string | number>> = [];
for (let trip = 0; trip < 5; trip++) {
  for (let pos = 0; pos < 15; pos++) {
    rows.push(["Anonymous", `2026-09-17T22:${String(trip * 5 + pos).padStart(2, "0")}:00+02:00`, "DECHG", `P-${trip}-${pos}`, `TEST-${trip}`, "01K", "", "", "", "", "", 1 / 24, 0, 22]);
    if (pos < 2) rows.push(["Anonymous", "2026-09-17T23:00:00+02:00", "ZONAGE", `P-${trip}-${pos}`, "", "01K", "", "", "", "", "", 1 / 24, 0, 23]);
  }
}
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Données");
const realFile = process.env.STEF_OPERATIONAL_WORKBOOK;
const buffer = realFile ? readFileSync(realFile) : XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
const defaults = { zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 };
function fixture(options: { start?: string; end?: string; criteria?: typeof defaults; excludedTravelCodes?: string[] } = {}): Snapshot {
  const result = buildSnapshotFromWorkbook(buffer, "reference.xlsx", "01K", { start: "21:30", end: "06:30", criteria: defaults, ...options });
  expect(result.ok).toBe(true);
  const actual = result.snapshot as Snapshot;
  if (realFile) return { ...actual, agency: { ...actual.agency, name: "Montpellier - 01K" } };
  return { ...base, agency: { ...actual.agency, name: "Montpellier - 01K" }, match: { ...base.match, ...actual.match },
    performanceCriteria: actual.performanceCriteria, excludedTravelCodes: actual.excludedTravelCodes,
    operationalAnalysisVersion: actual.operationalAnalysisVersion, zonageDiagnostic: actual.zonageDiagnostic,
    unloadingHourlyAnalysis: actual.unloadingHourlyAnalysis, anomalySummary: actual.anomalySummary };
}
async function login(page: Page, code = "01K") {
  await page.goto("/"); await page.getByLabel("Code agence").selectOption(code);
  await page.getByLabel("Code d'accès").fill(`LOCAL-${code}-DEV`);
  await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
}
async function stats(page: Page) {
  await page.getByRole("navigation", { name: "Navigation de la feuille de match" }).getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
}
const carousel = (page: Page) => page.getByRole("region", { name: "Graphiques de lecture opérationnelle", exact: true });
const tab = (page: Page, name: string) => page.getByRole("tab", { name: `Afficher ${name}`, exact: true });

test("jour/nuit : dates, libellés et anciens avertissements dans les deux modes", async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => { sessionStorage.clear(); localStorage.clear(); });
  let snapshot = fixture();
  await page.route("**/api/agencies/01K/snapshot**", route => route.fulfill({ json: { snapshot } }));
  for (const [start, end, date, clock] of [
    ["08:00", "16:00", "2026-09-17", "08"], ["14:00", "22:00", "2026-09-17", "14"],
    ["21:30", "06:30", "2026-09-17", "22"], ["00:00", "08:00", "2026-09-18", "00"],
  ]) {
    const source = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(source, XLSX.utils.aoa_to_sheet([headers,
      ["Anonymous", `${date}T${clock}:00:00+02:00`, "DECHG", "DAY-P1", "DAY-TRIP", "01K", "", "", "", "", "", 1 / 24, 0, Number(clock)],
      ["Anonymous", `${date}T${clock}:02:00+02:00`, "DECHG", "DAY-P2", "DAY-TRIP", "01K", "", "", "", "", "", 1 / 24, 0, Number(clock)],
      ["Anonymous", `${date}T${clock}:45:00+02:00`, "ZONAGE", "DAY-P1", "", "01K", "", "", "", "", "", 1 / 24, 0, Number(clock)],
    ]), "Données");
    const actual = buildSnapshotFromWorkbook(XLSX.write(source, { type: "buffer", bookType: "xlsx" }), "day-night.xlsx", "01K", { start, end, criteria: defaults }).snapshot as Snapshot;
    snapshot = { ...actual, agency: { ...actual.agency, name: "Montpellier - 01K" } };
    // An old snapshot must not keep a nocturnal-only warning visible.
    snapshot.anomalySummary!.warnings = ["2 opération(s) d'autres nuits exclues des nouvelles analyses."];
    const saved = JSON.stringify(snapshot);
    await login(page);
    for (const mode of ["normal", "celebration"]) {
      if (mode === "celebration") {
        await page.getByRole("navigation", { name: "Navigation de la feuille de match" }).getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
        await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
      }
      await stats(page);
      await tab(page, "% duels gagnés").click();
      await expect(page.locator(".reception-hourly-analysis")).not.toContainText(/nuit/);
      await expect(page.locator(".reception-hourly-analysis")).toContainText(`${start.replace(":", "h")}–${end.replace(":", "h")}`);
      await tab(page, "Diagnostic opérationnel").click();
      const diagnostic = page.locator(".operational-diagnostic-card");
      await expect(diagnostic).toContainText("Période d'exploitation retenue");
      await expect(diagnostic).toContainText("réceptions hors cible — période analysée");
      await diagnostic.locator(".diagnostic-warnings summary").click();
      await expect(diagnostic).toContainText("2 opération(s) appartenant à d'autres périodes d'exploitation exclues du diagnostic.");
      await expect(diagnostic).not.toContainText(/nuit/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await diagnostic.screenshot({ path: info.outputPath(`day-night-${start.replace(":", "")}-${mode}.png`) });
      if (mode === "celebration") await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
    }
    expect(JSON.stringify(snapshot)).toBe(saved);
  }
});

test("analyses : cinq slides, rendu normal/Célébration, responsive et détails clavier", async ({ page }, info) => {
  test.setTimeout(240_000);
  const snapshot = fixture(); const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/agencies/01K/snapshot**", route => route.fulfill({ json: { snapshot } }));
  await login(page);
  const sizes = info.project.name === "desktop" ? [[1366, 768], [1440, 900], [1536, 864], [1600, 900], [1920, 1080], [2560, 1440], [1024, 768], [768, 1024], [390, 844], [320, 740], [320, 700]] : [[info.project.use.viewport!.width, info.project.use.viewport!.height]];
  const labels = ["% passes réussies par heure", "% duels gagnés", "% tirs cadrés", "% centres réussis", "Diagnostic opérationnel"];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const mode of ["normal", "celebration"]) {
      if (mode === "celebration") {
        await page.getByRole("navigation", { name: "Navigation de la feuille de match" }).getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
        await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
      }
      await stats(page);
      await expect(page.locator(".operational-chart-slide")).toHaveCount(5);
      for (let index = 0; index < labels.length; index++) {
        await tab(page, labels[index]).click();
        await expect(page.locator(".operational-charts-carousel-counter")).toHaveText(`${index + 1} / 5`);
        const card = page.locator(".operational-chart-slide.is-active");
        expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${width}x${height} ${mode} slide ${index + 1}`).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        if (index === 1) {
          const graph = card.getByRole("group", { name: "Histogramme des temps moyens, en secondes par position" });
          await expect(graph).toBeVisible();
          await expect(graph.getByRole("button")).toHaveCount(snapshot.unloadingHourlyAnalysis!.items.length);
          const analysis = snapshot.unloadingHourlyAnalysis!;
          for (const [slotIndex, slot] of analysis.items.entries()) {
            const button = graph.getByRole("button").nth(slotIndex);
            const value = button.locator(".reception-hour-value");
            const expected = slot.state === "disponible" && slot.meanSecondsPerPosition != null
              ? slot.distinctPositions.toLocaleString("fr-FR") : "—";
            await expect(value).toHaveText(slot.state === "disponible" && slot.meanSecondsPerPosition != null
              ? `${expected} pos.` : "—");
            if (slot.state === "disponible") {
              await expect(button).toHaveAttribute("aria-label", new RegExp(`${slot.distinctPositions} position`));
            }
            // Even narrow screens display the compact count, with the exact
            // number remaining accessible through button and selected details.
            if (slot.state === "disponible" && (width === 390 || width === 320)) {
              await expect(value).toBeVisible();
            }
          }
          const target = graph.getByRole("button").nth(Math.floor(snapshot.unloadingHourlyAnalysis!.items.length / 2));
          await target.focus(); await page.keyboard.press("Enter");
          await expect(target).toHaveAttribute("aria-pressed", "true");
          await expect(page.locator("#reception-hour-detail")).toContainText("Objectif");
          await expect(page.locator("#reception-hour-detail")).toContainText("Positions distinctes");
          await expect(page.locator("#reception-hour-detail")).toContainText("Moyenne");
          await expect(page.locator(".reception-hourly-analysis")).toContainText("Même périmètre que les duels gagnés");
          const collisions = await graph.locator(".reception-hour-label").evaluateAll(labels => {
            const boxes = labels.map(label => { const range = document.createRange(); range.selectNodeContents(label); return range.getBoundingClientRect(); });
            return boxes.flatMap((a, i) => boxes.slice(i + 1).filter(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
          });
          expect(collisions, `${width}x${height} hour labels`).toEqual([]);
        }
        if (index === 4) {
          const diagnostic = card.locator(".operational-diagnostic-card");
          const bounds = await diagnostic.boundingBox();
          const viewportBounds = await carousel(page).boundingBox();
          expect(bounds!.x, `${width} diagnostic left`).toBeGreaterThanOrEqual(viewportBounds!.x - 2);
          expect(bounds!.x + bounds!.width, `${width} diagnostic right`).toBeLessThanOrEqual(viewportBounds!.x + viewportBounds!.width + 2);
          expect(bounds!.x, `${width} diagnostic screen left`).toBeGreaterThanOrEqual(-1);
          expect(bounds!.x + bounds!.width, `${width} diagnostic screen right`).toBeLessThanOrEqual(width + 1);
          await expect(diagnostic.locator(".diagnostic-top5 > li")).toHaveCount(snapshot.zonageDiagnostic!.top5.length);
          await expect(diagnostic.locator(".diagnostic-metrics dd").nth(0)).toHaveText(String(snapshot.zonageDiagnostic!.latePositions));
          for (const metric of await diagnostic.locator(".diagnostic-metrics dd").all()) {
            expect(await metric.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.clientHeight <= parseFloat(getComputedStyle(el).fontSize) * 1.2), "Compteur lisible sur une seule ligne").toBe(true);
          }
          for (const label of await diagnostic.locator(".diagnostic-metrics dt").all()) {
            expect(await label.evaluate(el => {
              const range = document.createRange(); range.setStart(el.firstChild!, 0); range.setEnd(el.firstChild!, el.textContent!.indexOf(" "));
              return range.getClientRects().length;
            }), "Le premier mot du libellé ne doit pas être cassé").toBe(1);
          }
          await expect(diagnostic.getByRole("heading", { name: "FLOP Zonage - TOP 5", exact: true })).toBeVisible();
          await expect(diagnostic.locator(".diagnostic-coverage-note")).toHaveText("Gris = délai impossible à vérifier. Ces positions ne sont pas comptées comme des retards.");
          const priority = snapshot.anomalySummary!.topZonageTravel!;
          await expect(diagnostic.getByRole("region", { name: "Priorité du brief" })).toContainText(`Premier voyage à examiner : ${priority.travelCode} — ${priority.latePositions} retards`);
          const z = snapshot.zonageDiagnostic!;
          expect(z.latePositions + z.onTimePositions + z.unqualifiablePositions).toBe(z.receivedPositions);
          expect(z.latePositions + z.onTimePositions).toBe(z.qualifiablePositions);
          if (realFile) {
            expect([z.latePositions, z.onTimePositions, z.unqualifiablePositions, z.qualifiablePositions, z.receivedPositions, z.anomalyRate, z.coverageRate]).toEqual([184, 304, 188, 488, 676, 37.7, 72.2]);
            expect(z.top5.map(t => [t.travelCode, t.latePositions, t.onTimePositions, t.unqualifiablePositions, t.receivedPositions])).toEqual([
              ["SORG02", 19, 13, 0, 32], ["710000", 16, 5, 6, 27], ["TOUL00", 14, 1, 5, 20], ["VENDAR", 13, 1, 24, 38], ["MR3402", 12, 14, 3, 29],
            ]);
          }
          for (const [rank, trip] of snapshot.zonageDiagnostic!.top5.entries()) {
            const row = diagnostic.locator(".diagnostic-top5 > li").nth(rank);
            await expect(row.locator(".diagnostic-trip-main strong")).toHaveText(trip.travelCode);
            await expect(row.locator(".diagnostic-trip-main > span")).toHaveAttribute("aria-label", `${trip.latePositions} positions hors délai sur ${trip.receivedPositions} reçues`);
            const widths = await row.locator(".diagnostic-bar-track > span").evaluateAll(segments => segments.map(segment => parseFloat((segment as HTMLElement).style.width)));
            expect(widths).toHaveLength(3);
            expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 4);
            for (const [i, value] of [trip.latePositions, trip.onTimePositions, trip.unqualifiablePositions].entries()) expect(widths[i]).toBeCloseTo(value / trip.receivedPositions * 100, 4);
          }
          const first = snapshot.zonageDiagnostic!.top5[0];
          const trigger = diagnostic.getByRole("button", { name: `Voir les positions du voyage ${first.travelCode}`, exact: true });
          await trigger.focus(); await page.keyboard.press("Enter");
          const dialog = page.getByRole("dialog", { name: `Positions à examiner · ${first.travelCode}`, exact: true });
          await expect(dialog).toBeVisible();
          await expect(dialog.locator(".diagnostic-detail-stats")).toContainText("Qualifiables");
          await expect(dialog.locator(".diagnostic-detail-stats")).toContainText(first.coverageRate.toLocaleString("fr-FR", { maximumFractionDigits: 1 }));
          await expect(dialog.locator(".zonage-detail-list li")).toHaveCount(snapshot.zonageDiagnostic!.details.filter(entry => entry.travelCode === first.travelCode).length);
          const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1); expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
          await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
          if (width === 1366 && mode === "normal") {
            await diagnostic.getByRole("button", { name: "Voir les positions à examiner", exact: true }).click();
            const all = page.getByRole("dialog", { name: "Positions à examiner", exact: true });
            await expect(all.locator(".zonage-detail-list li")).toHaveCount(snapshot.zonageDiagnostic!.details.length);
            await all.getByRole("button", { name: "Fermer les positions à examiner", exact: true }).click();
            await expect(all).toHaveCount(0);
            const warnings = diagnostic.locator(".diagnostic-warnings");
            if (snapshot.anomalySummary!.warnings.length) {
              await warnings.locator("summary").click();
              await expect(warnings.locator("li")).toHaveText(snapshot.anomalySummary!.warnings);
              await warnings.locator("summary").click();
            }
          }
        }
        if (width === 1440 || width === 390 || width === 320 || (info.project.name === "desktop" && width === 1366)) {
          await card.locator(":scope > *").evaluate(el => { el.scrollTop = 0; });
          await card.screenshot({ path: info.outputPath(`${width}x${height}-${mode}-operational-${index + 1}.png`) });
          if (width === 390 && index === 4) await page.screenshot({ path: info.outputPath(`${width}x${height}-${mode}-page.png`), fullPage: true });
        }
      }
      await carousel(page).focus(); await page.keyboard.press("Home"); await expect(tab(page, labels[0])).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("End"); await expect(tab(page, labels[4])).toHaveAttribute("aria-selected", "true");
      if (info.project.use.hasTouch) {
        const diagnostic = page.locator(".operational-diagnostic-card");
        const settle = () => carousel(page).evaluate(el => new Promise<void>(resolve => {
          let previous = "", stable = 0;
          const tick = () => {
            const position = [el.scrollLeft, scrollY, el.querySelector(".operational-diagnostic-card")?.scrollTop].join(":");
            stable = position === previous ? stable + 1 : 0; previous = position;
            if (stable >= 6) resolve(); else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }));
        await diagnostic.locator("h3").scrollIntoViewIfNeeded();
        await settle();
        const box = (await diagnostic.boundingBox())!;
        const scrollBefore = await carousel(page).evaluate(el => el.scrollLeft);
        const cdp = await page.context().newCDPSession(page);
        const swipe = async (x: number, y: number, dx: number, dy: number) => {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
          for (let step = 1; step <= 10; step++) {
            await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * step / 10, y: y + dy * step / 10 }] });
            await page.waitForTimeout(20);
          }
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        };
        const x = box.x + box.width * .1;
        const y = Math.max(100, Math.min(height - 140, box.y + 140));
        expect(await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest(".operational-diagnostic-card")), [x, y])).toBe(true);
        await swipe(x, y, box.width * .8, 0);
        await settle();
        await expect.poll(() => carousel(page).evaluate(el => el.scrollLeft)).toBeLessThan(scrollBefore - 50);
        await expect(tab(page, labels[4])).toHaveAttribute("aria-selected", "false");
        await tab(page, labels[4]).tap();
        await diagnostic.locator("h3").scrollIntoViewIfNeeded();
        await settle();
        await expect(tab(page, labels[4])).toHaveAttribute("aria-selected", "true");
        if (await diagnostic.evaluate(el => el.scrollHeight > el.clientHeight + 20)) {
          const current = (await diagnostic.boundingBox())!;
          const y = Math.min(height - 40, Math.max(100, current.y + 200));
          expect(await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest(".operational-diagnostic-card")), [current.x + current.width / 2, y])).toBe(true);
          await swipe(current.x + current.width / 2, y, 0, -80);
          await settle();
          await expect.poll(() => diagnostic.evaluate(el => el.scrollTop)).toBeGreaterThan(20);
        }
        await cdp.detach();
        await tab(page, labels[1]).tap(); await expect(tab(page, labels[1])).toHaveAttribute("aria-selected", "true");
      }
      if (mode === "celebration") await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
    }
  }
  expect(errors).toEqual([]);
});

test("analyses : ancien snapshot, absence de données et absence d'anomalies", async ({ page }) => {
  let snapshot = fixture(); delete snapshot.zonageDiagnostic; delete snapshot.unloadingHourlyAnalysis; delete snapshot.anomalySummary;
  await page.route("**/api/agencies/01K/snapshot**", route => route.fulfill({ json: { snapshot } }));
  await login(page); await stats(page); await tab(page, "Diagnostic opérationnel").click();
  const diagnostic = page.locator(".operational-diagnostic-card");
  await expect(diagnostic.locator(".diagnostic-metrics dd")).toHaveText(["—", "—"]);
  await expect(diagnostic).toContainText("Analyse indisponible");
  await tab(page, "% duels gagnés").click(); await expect(page.locator(".reception-hourly-analysis")).toContainText("Analyse indisponible");
  snapshot = fixture(); snapshot.zonageDiagnostic = { ...snapshot.zonageDiagnostic!, top5: [], latePositions: 0, anomalyRate: 0 };
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await tab(page, "Diagnostic opérationnel").click(); await expect(diagnostic).toContainText("Aucun voyage hors délai");
  await expect(diagnostic.locator(".diagnostic-metrics dd").first()).toHaveText("0");
  snapshot.zonageDiagnostic = { ...snapshot.zonageDiagnostic!, state: "indisponible", qualifiablePositions: 0, coverageRate: 0, anomalyRate: null };
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await expect(diagnostic.locator(".diagnostic-metrics dd").first()).toHaveText("—");
  snapshot = fixture();
  snapshot.zonageDiagnostic!.top5[0] = { ...snapshot.zonageDiagnostic!.top5[0], receivedPositions: 0 };
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await expect(diagnostic.locator(".diagnostic-top5 > li").first()).toContainText("Répartition indisponible");
  await expect(diagnostic.locator(".diagnostic-top5 > li").first().locator(".diagnostic-bar-track")).toHaveCount(0);
  snapshot = fixture();
  const laterNight = { ...snapshot.zonageDiagnostic!.night!, startDate: "2026-09-19", endDate: "2026-09-20", start: "2026-09-19T19:30:00.000Z", end: "2026-09-20T04:30:00.000Z" };
  snapshot.zonageDiagnostic = { ...snapshot.zonageDiagnostic!, night: laterNight };
  snapshot.unloadingHourlyAnalysis = { ...snapshot.unloadingHourlyAnalysis!, night: laterNight };
  snapshot.anomalySummary = { ...snapshot.anomalySummary!, night: laterNight };
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await expect(diagnostic.locator(".analysis-night")).toContainText(/19.*20 septembre 2026/);
  await tab(page, "% duels gagnés").click();
  await expect(page.locator(".reception-hourly-analysis .analysis-provenance")).toContainText(/19.*20 septembre 2026/);
});

test("analyses : seuils, plage, exclusions/réintégration et agences actualisés", async ({ page, browser }) => {
  let snapshot = fixture();
  await page.route("**/api/agencies/01K/snapshot**", route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("zonageMinutes")) {
      const criteria = Object.fromEntries(Object.keys(defaults).map(key => [key, Number(url.searchParams.get(key))])) as typeof defaults;
      snapshot = fixture({ criteria, start: snapshot.match.periodStart, end: snapshot.match.periodEnd, excludedTravelCodes: snapshot.excludedTravelCodes });
    }
    return route.fulfill({ json: { snapshot } });
  });
  await page.route("**/api/agencies/01K/time-range", route => {
    const input = route.request().postDataJSON(); snapshot = fixture(input);
    return route.fulfill({ json: { snapshot } });
  });
  await page.route("**/api/agencies/01K/travel-exclusions", route => {
    const input = route.request().postDataJSON();
    snapshot = fixture({ start: snapshot.match.periodStart, end: snapshot.match.periodEnd, criteria: snapshot.performanceCriteria,
      excludedTravelCodes: input.excluded ? [...snapshot.excludedTravelCodes ?? [], input.travelCode] : snapshot.excludedTravelCodes?.filter(code => code !== input.travelCode) });
    return route.fulfill({ json: { snapshot } });
  });
  await login(page);
  await page.locator(".sidebar").getByRole("button", { name: "ADM Administrateur", exact: true }).click();
  await page.locator(".league-card.gold").getByRole("button", { name: "Activer", exact: true }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click(); await stats(page);
  await tab(page, "Diagnostic opérationnel").click();
  await page.locator(".diagnostic-method summary").click();
  await expect(page.locator(".diagnostic-method")).toContainText("cible 25 min");
  await page.getByLabel("Début", { exact: true }).selectOption("22:00"); await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(page.locator(".analysis-night")).toContainText("22h00");
  await tab(page, "% tirs cadrés").click();
  // Exclusion controls belong to the existing lost-duel table; use a known official voyage.
  await tab(page, "% duels gagnés").click();
  await page.locator(".reception-quality-card .duel-quality-details summary").click();
  const hide = page.locator(".reception-quality-card .travel-visibility-button").first();
  const code = (await hide.getAttribute("aria-label"))!.replace("Masquer le voyage ", "");
  const receptionBefore = snapshot.anomalySummary!.unloading.eligibleTravels;
  await hide.click(); await expect(page.getByRole("button", { name: `Réintégrer ${code}`, exact: true })).toBeVisible();
  if (realFile) expect(snapshot.anomalySummary!.unloading.eligibleTravels).toBe(receptionBefore - 1);
  await tab(page, "Diagnostic opérationnel").click();
  await expect(page.locator(".diagnostic-secondary")).toContainText(`/${snapshot.anomalySummary!.unloading.eligibleTravels} réceptions hors cible`);
  await page.getByRole("button", { name: `Réintégrer ${code}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Réintégrer ${code}`, exact: true })).toHaveCount(0);
  await expect(page.locator(".diagnostic-secondary")).toContainText(`/${receptionBefore} réceptions hors cible`);
  // Compact navigation has no agency-switch button; use an independent session there.
  const switchButton = page.getByRole("button", { name: "Changer d'agence", exact: true });
  const independent = await switchButton.isVisible() ? null : await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: page.viewportSize()! });
  const other = independent ? await independent.newPage() : page;
  if (!independent) await switchButton.click();
  await other.route("**/api/agencies/04H/snapshot**", route => route.fulfill({ json: { snapshot: { ...fixture(), agency: { code: "04H", detectedCode: "04H", name: "Brive - 04H" }, zonageDiagnostic: undefined, anomalySummary: undefined, unloadingHourlyAnalysis: undefined } } }));
  await login(other, "04H"); await stats(other); await tab(other, "Diagnostic opérationnel").click();
  await expect(other.locator(".diagnostic-metrics dd")).toHaveText(["—", "—"]);
  await independent?.close();
});
