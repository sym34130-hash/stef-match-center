import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Snapshot } from "../src/types";

test.use({ reducedMotion: "reduce" });

test("graphique agrandi : modal, créneau, voyages, focus et géométrie conservés", async ({ page }, info) => {
  test.setTimeout(180_000);
  const snapshot: Snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  const codes = ["MR3402", "LD1300", "SORG02", "SEVE00", "MV0000", "LU0000", "84AAV2", "MR3404"];
  snapshot.hourlyPerformance = [22,23,0,1,2,3,4,5].map((hour, index) => ({
    label: `${String(hour).padStart(2,"0")}h`, hour,
    won: [39,46,147,268,150,173,76,19][index], total: [110,94,203,339,257,253,133,42][index],
    rate: [35.5,48.9,72.4,79.1,58.4,68.4,57.1,45.2][index],
    arrivingTravels: hour === 1 ? 8 : hour === 5 ? 42 : 1,
    arrivingTravelCodes: hour === 1 ? codes : hour === 5 ? Array.from({ length: 42 }, (_, i) => `LONG-${String(i).padStart(2,"0")}`) : [`TEST-${hour}`],
  }));
  let writes = 0;
  await page.route("**/api/agencies/058/snapshot**", (route) => route.fulfill({ json: { snapshot } }));
  page.on("request", (request) => { if (request.url().includes("/api/") && request.method() !== "GET" && !request.url().endsWith("/api/session")) writes++; });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  const normal = page.locator(".performance-chart-panel > .performance-chart");
  const expand = page.getByRole("button", { name: "Agrandir le graphique", exact: true });
  const dialog = page.getByRole("dialog", { name: "Graphique Performance horaire agrandi", exact: true });
  const sizes = info.project.name === "desktop"
    ? [[1366,768],[1440,900],[1536,864],[1600,900],[1920,1080],[2560,1440],[1024,768],[768,1024],[390,844]]
    : [[info.project.use.viewport!.width, info.project.use.viewport!.height]];
  let maxDelta = 0;
  const geometry = () => page.evaluate(() => {
    const selectors = [".performance-chart-panel > .performance-chart", ".operational-charts-carousel", ".match-carousel-navigation", ".match-statistics-section"];
    return selectors.map((selector) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; });
  });
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    for (const mode of ["normal","celebration"]) {
      if (mode === "celebration") {
        await navigation.getByRole("button", {name:"Aller à Coup de sifflet final",exact:true}).click();
        await page.getByRole("button", {name:"Mode célébration",exact:true}).click();
      }
      await navigation.getByRole("button", {name:"Aller à Statistiques du match",exact:true}).click();
      const normalTrigger = normal.getByRole("button", {name:"8 voyages arrivés à 01h",exact:true});
      await normalTrigger.scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await normalTrigger.click();
      await expect(page.getByRole("dialog", {name:"Voyages arrivés à 01h",exact:true}).locator("li")).toHaveText(codes);
      if (width !== 1366 || mode !== "normal") await page.keyboard.press("Escape");
      await expand.scrollIntoViewIfNeeded();
      await expand.focus();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const before = await geometry();
      const scrollBefore = await page.evaluate(() => [scrollX,scrollY]);
      const carouselBefore = await page.locator(".operational-charts-carousel-viewport").evaluate((e) => e.scrollLeft);
      const labelsBefore = await normal.locator("text").allTextContents();
      if (info.project.use.hasTouch) await expand.tap(); else await expand.click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal","true");
      await expect(page.locator(".hourly-arrivals-detail")).toHaveCount(0);
      const openedGeometry = await geometry();
      const openedDelta = Math.max(...openedGeometry.flatMap((rect,i) => rect.map((v,j) => Math.abs(v-before[i][j]))));
      maxDelta=Math.max(maxDelta,openedDelta);
      expect(openedDelta, "arrière-plan inchangé à l'ouverture").toBeLessThan(0.25);
      await expect(dialog.locator(".performance-chart").locator("text")).toHaveText(labelsBefore);
      const collisions = await dialog.locator(".performance-chart").evaluate((svg) => {
        const texts = [...svg.querySelectorAll("text")];
        return texts.flatMap((text, i) => texts.slice(i + 1).filter((other) => {
          const a = text.getBoundingClientRect(), b = other.getBoundingClientRect();
          return Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
        }).map((other) => `${text.textContent} / ${other.textContent}`));
      });
      expect(collisions, "libellés agrandis sans chevauchement").toEqual([]);
      await expect(dialog.getByRole("button", {name:"8 voyages arrivés à 01h",exact:true})).toHaveAttribute("aria-pressed","true");
      expect(await dialog.evaluate((e) => e.contains(document.activeElement))).toBe(true);
      for (let i=0;i<12;i++) {
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate((e) => e.contains(document.activeElement))).toBe(true);
      }
      const close = dialog.getByRole("button", {name:"Fermer le graphique agrandi",exact:true});
      await close.focus();
      const closeBox = await close.boundingBox();
      await page.mouse.move(closeBox!.x + 5,closeBox!.y + 5);
      await page.mouse.wheel(0,500);
      expect(await page.evaluate(() => [scrollX,scrollY])).toEqual(scrollBefore);
      const trigger = dialog.getByRole("button", {name:"8 voyages arrivés à 01h",exact:true});
      await trigger.scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const graphBefore = await dialog.locator(".performance-chart").boundingBox();
      const overlayBefore = await dialog.boundingBox();
      await trigger.click();
      const detail = dialog.getByRole("dialog", {name:"Voyages arrivés à 01h",exact:true});
      await expect(detail.locator("li")).toHaveText(codes);
      expect(await dialog.locator(".performance-chart").boundingBox()).toEqual(graphBefore);
      expect(await dialog.boundingBox()).toEqual(overlayBefore);
      await detail.getByRole("button", {name:"Fermer les voyages arrivés"}).click();
      await expect(dialog).toBeVisible();
      await trigger.click();
      const otherTrigger = dialog.getByRole("button", {name:"1 voyage arrivé à 22h",exact:true});
      await otherTrigger.scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await otherTrigger.click();
      await expect(dialog.locator(".hourly-arrivals-detail")).toHaveCount(1);
      await expect(dialog.getByRole("dialog", {name:"Voyages arrivés à 22h",exact:true}).locator("li")).toHaveText(["TEST-22"]);
      await dialog.locator(".performance-chart-total").click();
      await expect(dialog.locator(".hourly-arrivals-detail")).toHaveCount(0);
      const longTrigger = dialog.getByRole("button", {name:"42 voyages arrivés à 05h",exact:true});
      await longTrigger.scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await longTrigger.click();
      const longList = dialog.getByRole("dialog", {name:"Voyages arrivés à 05h",exact:true});
      await expect(longList).toBeVisible();
      await expect(longList.locator("li")).toHaveCount(42);
      expect(await longList.locator("ul").evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
      await longList.locator("ul").evaluate((e) => {e.scrollTop=e.scrollHeight;});
      await expect(longList).toBeVisible();
      const bounds = await longList.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
      const currentClose = await close.boundingBox();
      expect(bounds!.y).toBeGreaterThan(currentClose!.y + currentClose!.height);
      await longList.getByRole("button", {name:"Fermer les voyages arrivés"}).click();
      await trigger.scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await trigger.click();
      await dialog.screenshot({path:info.outputPath(`${width}x${height}-${mode}-expanded.png`)});
      await dialog.getByRole("dialog", {name:"Voyages arrivés à 01h",exact:true}).getByRole("button", {name:"Fermer les voyages arrivés"}).click();
      await close.click();
      await expect(dialog).toHaveCount(0);
      await expect(expand).toBeFocused();
      await expect(normal.getByRole("button", {name:"8 voyages arrivés à 01h",exact:true})).toHaveAttribute("aria-pressed","true");
      const after = await geometry();
      const delta = Math.max(...after.flatMap((rect,i) => rect.map((v,j) => Math.abs(v-before[i][j]))));
      maxDelta=Math.max(maxDelta,delta);
      expect(delta,`${width}x${height} ${mode} layout shift`).toBeLessThan(0.25);
      expect(await page.evaluate(() => [scrollX,scrollY])).toEqual(scrollBefore);
      expect(await page.locator(".operational-charts-carousel-viewport").evaluate((e) => e.scrollLeft)).toBe(carouselBefore);
      await expand.click();
      await expect(dialog).toBeVisible();
      const selected = dialog.getByRole("button", {name:"8 voyages arrivés à 01h",exact:true});
      await expect(close).toBeFocused();
      for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
      await expect(selected).toBeFocused();
      await expect(selected).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Enter");
      const reopenedDetail = dialog.getByRole("dialog", {name:"Voyages arrivés à 01h",exact:true});
      await expect(reopenedDetail).toBeVisible();
      await expect(selected).toHaveAttribute("aria-expanded", "true");
      await dialog.locator(".performance-chart-expanded-scroll").dispatchEvent("scroll");
      await expect(reopenedDetail).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(reopenedDetail).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(selected).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(reopenedDetail.locator("li")).toHaveText(codes);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Space");
      await expect(reopenedDetail.locator("li")).toHaveText(codes);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(expand).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (mode === "celebration") {
        await expect(page.locator(".match-page")).toHaveClass(/is-celebration-mode/);
        await expect(page.locator(".match-statistics-section")).toHaveClass(/is-active/);
        await page.getByRole("button", {name:"Sortir du mode Célébration",exact:true}).click();
      }
    }
  }
  expect(writes).toBe(0);
  console.log(`Overlay ${info.project.name} : déplacement maximal ${maxDelta} px, aucune mutation API`);
});
