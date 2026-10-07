import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Snapshot } from "../src/types";

test("les voyages horaires restent lisibles et compatibles avec les anciens snapshots", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const snapshot: Snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  const hours = snapshot.hourlyPerformance ?? [];
  expect(hours.length).toBeGreaterThan(3);
  expect(hours.every((hour) => Number.isInteger(hour.travels))).toBe(true);
  // Exercise singular, zero, unavailable and legacy values without writing data.
  hours[0].travels = 1;
  hours[1].travels = 0;
  hours[2].travels = null;
  delete hours[3].travels;
  let legacy = false;
  await page.route("**/api/agencies/058/snapshot**", async (route) => {
    const displayed = structuredClone(snapshot);
    if (legacy) for (const hour of displayed.hourlyPerformance ?? []) delete hour.travels;
    await route.fulfill({ json: { snapshot: displayed } });
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  const sizes = testInfo.project.name === "desktop"
    ? [[1366, 768], [1440, 900], [1536, 864], [1600, 900], [1920, 1080], [2560, 1440]]
    : [[testInfo.project.use.viewport!.width, testInfo.project.use.viewport!.height]];
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  await navigation.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
  const chart = page.locator(".performance-chart");
  const expected = hours.filter((hour) => hour.travels != null).map((hour) => `${hour.travels} ${hour.travels === 1 ? "voyage" : "voyages"}`);
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
      if (mode === "celebration") await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
    }
  }
  legacy = true;
  await page.reload();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await page.getByRole("navigation", { name: "Navigation de la feuille de match" }).getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
  await expect(chart).toBeVisible();
  await expect(chart.locator(".performance-chart-travels")).toHaveCount(0);
  await expect(chart.locator(".performance-chart-volume")).toHaveCount(hours.length);
});
