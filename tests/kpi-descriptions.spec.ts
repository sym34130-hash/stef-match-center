import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

test("KPI : descriptions issues des critères actifs sans modifier les valeurs", async ({ page }, info) => {
  test.setTimeout(180_000);
  const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  const original = structuredClone(snapshot);
  await page.route("**/api/agencies/058/snapshot**", route => route.fulfill({ json: { snapshot } }));
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  const values = await page.locator(".match-score-bubble > strong").allTextContents();
  for (const [zonage, loading, unloading, loadingText, unloadingText] of [
    [45,195,75,"3 min 15","1 min 15"],
    [30,165,60,"2 min 45","1 min"],
    [25,150,55,"2 min 30","55 sec"],
    [20,135,50,"2 min 15","50 sec"],
    [27,142,52,"2 min 22","52 sec"],
  ] as const) {
    snapshot.performanceCriteria = { ...original.performanceCriteria, zonageMinutes: zonage, loadingSeconds: loading, unloadingSeconds: unloading };
    await page.reload();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await expect(page.locator(".loading-score-bubble small")).toHaveText(`Voyages chargés en ${loadingText} ou moins par position`);
    await expect(page.locator(".reception-score-bubble small")).toHaveText(`Voyages réceptionnés en ${unloadingText} ou moins par position`);
    await expect(page.locator(".possession-score-bubble small")).toHaveText("Positions zonées");
    await expect(page.locator(".pass-score-bubble small")).toHaveText(`Objectif zonage : ${zonage} min ou moins`);
    expect(await page.locator(".match-score-bubble > strong").allTextContents()).toEqual(values);
  }
  const sizes = info.project.name === "desktop" ? [[1366,768],[1440,900],[1536,864],[1920,1080]] : [[info.project.use.viewport!.width,info.project.use.viewport!.height]];
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    for (const celebration of [false,true]) {
      if (celebration) await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
      await expect(page.locator(".pass-score-bubble small")).toHaveText("Objectif zonage : 27 min ou moins");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const geometry = await page.locator(".match-score-bubble").evaluateAll(elements => elements.map(el => {
        const small = el.querySelector("small")!;
        const strong = el.querySelector("strong")!;
        const box = el.getBoundingClientRect();
        const text = small.getBoundingClientRect();
        return { width: box.width, height: box.height, clipped: small.scrollWidth > small.clientWidth + 1 || small.scrollHeight > small.clientHeight + 1, collides: strong.getBoundingClientRect().bottom > text.top + 1, outside: text.bottom > box.bottom + 1 };
      }));
      for (const item of geometry) {
        expect(item.clipped).toBe(false);
        expect(item.collides).toBe(false);
        expect(item.outside).toBe(false);
      }
      expect(Math.max(...geometry.map(item => item.width)) - Math.min(...geometry.map(item => item.width))).toBeLessThan(2);
      expect(Math.max(...geometry.map(item => item.height)) - Math.min(...geometry.map(item => item.height))).toBeLessThan(2);
      await page.screenshot({ path: info.outputPath(`${width}-${height}-${celebration ? "celebration" : "normal"}-kpi.png`) });
      if (celebration) await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
    }
  }
  expect(snapshot.summary).toEqual(original.summary);
});
