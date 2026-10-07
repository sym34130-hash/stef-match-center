import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Snapshot } from "../src/types";

test.use({ reducedMotion: "reduce" });

test("les voyages horaires restent lisibles et compatibles avec les anciens snapshots", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const snapshot: Snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  const hours = snapshot.hourlyPerformance ?? [];
  expect(hours.length).toBeGreaterThan(3);
  expect(hours.every((hour) => Number.isInteger(hour.arrivingTravels))).toBe(true);
  // Exercise singular, zero, unavailable and legacy values without writing data.
  hours[0].arrivingTravels = 1;
  hours[0].arrivingTravelCodes = ["ONLY-FIRST"];
  hours[1].arrivingTravels = 0;
  hours[1].arrivingTravelCodes = [];
  hours[2].arrivingTravels = null;
  delete hours[3].arrivingTravels;
  delete hours[3].arrivingTravelCodes;
  const middleIndex = Math.floor(hours.length / 2);
  hours[middleIndex].arrivingTravelCodes = Array.from({ length: 42 }, (_, index) => `LONG-${String(index).padStart(2, "0")}`);
  hours[middleIndex].arrivingTravels = 42;
  let legacy = false;
  await page.route("**/api/agencies/058/snapshot**", async (route) => {
    const displayed = structuredClone(snapshot);
    if (legacy) for (const hour of displayed.hourlyPerformance ?? []) { delete hour.arrivingTravels; delete hour.arrivingTravelCodes; }
    await route.fulfill({ json: { snapshot: displayed } });
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  const sizes = testInfo.project.name === "desktop"
    ? [[1366, 768], [1440, 900], [1536, 864], [1600, 900], [1920, 1080], [2560, 1440], [1024, 768]]
    : [[testInfo.project.use.viewport!.width, testInfo.project.use.viewport!.height]];
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  await navigation.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
  const chart = page.locator(".performance-chart");
  const expected = hours.filter((hour) => hour.arrivingTravels != null).map((hour) => `${hour.arrivingTravels} ${hour.arrivingTravels === 1 ? "voyage arrivé" : "voyages arrivés"}`);
  let maxLayoutDelta = 0;
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const mode of ["normal", "celebration"]) {
      if (mode === "celebration") {
        await navigation.getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
        await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
      }
      await navigation.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
      await expect(chart).toBeVisible();
      await expect(chart.locator(".performance-chart-travels")).toHaveText(expected);
      const errors = await chart.evaluate((svg) => {
        const errors: string[] = [];
        const bounds = svg.getBoundingClientRect();
        const texts = [...svg.querySelectorAll(".performance-chart-point text")];
        const curve = svg.querySelector<SVGPathElement>(".performance-chart-line")!;
        const matrix = curve.getScreenCTM()!;
        const curvePoints = [];
        for (let distance = 0; distance <= curve.getTotalLength(); distance += 3) {
          curvePoints.push(curve.getPointAtLength(distance).matrixTransform(matrix));
        }
        for (const text of svg.querySelectorAll(".performance-chart-travels")) {
          const box = text.getBoundingClientRect();
          if (box.left < bounds.left - 1 || box.right > bounds.right + 1 || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1) errors.push(`bord SVG : ${text.textContent}`);
          for (const other of texts) {
            if (other === text) continue;
            const rect = other.getBoundingClientRect();
            if (Math.min(box.right, rect.right) - Math.max(box.left, rect.left) > 1 && Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top) > 1) errors.push(`collision : ${text.textContent} / ${other.textContent}`);
          }
          if (curvePoints.some((point) => point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom)) errors.push(`courbe : ${text.textContent}`);
          for (const circle of svg.querySelectorAll(".performance-chart-point circle")) {
            const rect = circle.getBoundingClientRect();
            if (Math.min(box.right, rect.right) - Math.max(box.left, rect.left) > 1 && Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top) > 1) errors.push(`point : ${text.textContent}`);
          }
        }
        if (document.documentElement.scrollWidth > innerWidth + 1) errors.push("débordement horizontal");
        return errors;
      });
      expect(errors, `${width}x${height} ${mode}`).toEqual([]);
      await chart.screenshot({ path: testInfo.outputPath(`${width}x${height}-${mode}-hourly-travels.png`) });
      const geometry = () => chart.evaluate((svg) => {
        const box = (element: Element) => { const rect = element.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height]; };
        return [box(svg), box(svg.closest(".performance-chart-panel")!), ...[...svg.querySelectorAll(".performance-chart-hour, circle")].map(box)];
      });
      const dialog = page.getByRole("dialog", { name: /Voyages arrivés à/ });
      for (const index of [0, 1, middleIndex, hours.length - 1]) {
        const hour = hours[index];
        const trigger = chart.getByRole("button", { name: `${hour.arrivingTravels} ${hour.arrivingTravels === 1 ? "voyage arrivé" : "voyages arrivés"} à ${hour.label}`, exact: true });
        await trigger.scrollIntoViewIfNeeded();
        let previousGeometry = await geometry();
        await expect.poll(async () => {
          const current = await geometry();
          const delta = Math.max(...current.flatMap((rect, index) => rect.map((value, axis) => Math.abs(value - previousGeometry[index][axis]))));
          previousGeometry = current;
          return delta;
        }).toBeLessThan(0.1);
        const before = await geometry();
        const triggerBox = await trigger.boundingBox();
        // Measure a real pointer interaction without an automation scroll.
        if (testInfo.project.use.hasTouch) await page.touchscreen.tap(triggerBox!.x + triggerBox!.width / 2, triggerBox!.y + triggerBox!.height / 2);
        else await page.mouse.click(triggerBox!.x + triggerBox!.width / 2, triggerBox!.y + triggerBox!.height / 2);
        await expect(dialog).toHaveCount(1);
        await expect(dialog.locator("li")).toHaveText(hour.arrivingTravelCodes!);
        const after = await geometry();
        const delta = Math.max(...after.flatMap((rect, index) => rect.map((value, axis) => Math.abs(value - before[index][axis]))));
        maxLayoutDelta = Math.max(maxLayoutDelta, delta);
        expect(delta, `aucun layout shift ${width}x${height} ${mode} ${index} : ${JSON.stringify({ before, after })}`).toBeLessThan(0.25);
        const bounds = await dialog.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        if (index === middleIndex) {
          expect(await dialog.locator("ul").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
          await dialog.locator("ul").evaluate((element) => { element.scrollTop = element.scrollHeight; });
          await expect(dialog).toBeVisible();
          const listBox = await dialog.locator("ul").boundingBox();
          const lastCodeBox = await dialog.locator("li").last().boundingBox();
          expect(lastCodeBox!.y + lastCodeBox!.height).toBeLessThanOrEqual(listBox!.y + listBox!.height + 1);
        }
        await dialog.screenshot({ path: testInfo.outputPath(`${width}x${height}-${mode}-${index}-arrivals.png`) });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      }
      const triggers = chart.getByRole("button");
      await triggers.first().focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(1);
      await triggers.last().click();
      await expect(dialog).toHaveCount(1);
      await expect(dialog).toHaveAttribute("aria-label", `Voyages arrivés à ${hours.at(-1)!.label}`);
      await triggers.last().click();
      await expect(dialog).toHaveCount(0);
      await triggers.first().focus();
      await page.keyboard.press("Space");
      await expect(dialog).toHaveCount(1);
      await page.mouse.click(width - 2, height - 2);
      await expect(dialog).toHaveCount(0);
      if (mode === "celebration") await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
    }
  }
  await navigation.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
  await chart.getByRole("button").first().focus();
  // Settle the browser scroll caused by focusing the newly displayed SVG.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /Voyages arrivés à/ })).toHaveCount(1);
  await page.getByRole("button", { name: "03 Composition", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /Voyages arrivés à/ })).toHaveCount(0);
  await testInfo.attach("anti-layout-shift", { body: JSON.stringify({ project: testInfo.project.name, sizes, maxLayoutDelta }), contentType: "application/json" });
  console.log(`Anti-layout-shift ${testInfo.project.name} : ${maxLayoutDelta} px`);
  legacy = true;
  await page.reload();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await page.getByRole("navigation", { name: "Navigation de la feuille de match" }).getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
  await expect(chart).toBeVisible();
  await expect(chart.locator(".performance-chart-travels")).toHaveCount(0);
  await expect(chart.locator(".performance-chart-volume")).toHaveCount(hours.length);
});
