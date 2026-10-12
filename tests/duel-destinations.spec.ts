import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Snapshot } from "../src/types";

test.use({ reducedMotion: "reduce" });

test("Duels perdus : destination descriptive, valeur absente et tableau responsive", async ({ page }, info) => {
  test.setTimeout(120_000);
  const snapshot: Snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  const duels = snapshot.unloadingDuelQuality!.lostDuels;
  expect(duels.length).toBeGreaterThan(1);
  duels[0].destination = "Site de réception - destination volontairement longue pour contrôler la troncature";
  duels[1].destination = null;
  await page.route("**/api/agencies/058/snapshot**", route => route.fulfill({ json: { snapshot } }));
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  const sizes = info.project.name === "desktop" ? [[1366,768],[1440,900],[1536,864],[1920,1080]] : [[info.project.use.viewport!.width,info.project.use.viewport!.height]];
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    for (const celebration of [false,true]) {
      if (celebration) {
        await nav.getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
        await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
      }
      await nav.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
      await page.locator(".operational-charts-carousel-dots").getByRole("tab", { name: "Afficher % duels gagnés" }).click();
      const details = page.locator(".reception-quality-card .duel-quality-details");
      if (!await details.evaluate(el => el.hasAttribute("open"))) await details.locator("summary").click();
      const table = details.getByRole("table", { name: "Duels perdus" });
      await expect(table.locator(".is-head > span")).toHaveText(["Voyage","Destination","Agence","Heure","Nb poz","Temps/poz","Résultat","Action"]);
      await expect(table.locator(".duel-destination").first()).toHaveText(duels[0].destination!);
      await expect(table.locator(".duel-destination").first()).toHaveAttribute("title", duels[0].destination!);
      await expect(table.locator(".duel-destination").nth(1)).toHaveText("—");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await table.locator(".duel-quality-table-row").evaluateAll(rows => rows.every(row => {
        const cells = [...row.children].map(cell => cell.getBoundingClientRect());
        return cells.every((cell,index) => index === 0 || cell.left >= cells[index-1].right - 1);
      }))).toBe(true);
      await page.screenshot({ path: info.outputPath(`${width}-${height}-${celebration ? "celebration" : "normal"}-destinations.png`), fullPage: true });
      if (celebration) await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
    }
  }
});
