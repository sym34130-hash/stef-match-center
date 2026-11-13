import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

const sizes = [[1366,768],[1440,900],[1536,864],[1600,900],[1920,1080],[2560,1440],
  [1366,650],[1536,720],[1920,800],[1920,900],[1024,768],[1180,640],[2560,800],
  [1536,1024],[820,1180],[768,1024],[390,844],[360,800],[320,740]];

test("Lot 2 : score, KPI et navigation accessibles sur les 19 résolutions", async ({ page }, info) => {
  test.setTimeout(180_000);
  test.skip(info.project.name !== "desktop", "Matrice exécutée une fois, avec les 19 viewports explicites.");
  const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  await page.route("**/api/agencies/058/snapshot**", route => route.fulfill({ json: { snapshot } }));
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  const measurements = [];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const mode of ["normal", "celebration"]) {
      if (mode === "celebration") await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const geometry = await page.locator(".match-ceremony.is-active").evaluate(root => {
        const stage = root.querySelector<HTMLElement>(".match-result-stage")!;
        const board = root.querySelector<HTMLElement>(".match-scoreboard")!;
        const kpis = root.querySelector<HTMLElement>(".match-indicators-area")!;
        const s = stage.getBoundingClientRect(), b = board.getBoundingClientRect(), k = kpis.getBoundingClientRect();
        const viewport = root.querySelector(".match-indicators-viewport")!.getBoundingClientRect();
        const cardVerticalOverflow = Math.max(0, ...[...root.querySelectorAll("[data-featured] .match-indicator-card")].map(card => {
          const r = card.getBoundingClientRect();
          return Math.max(viewport.top - r.top, r.bottom - viewport.bottom);
        }));
        return { stageHeight: s.height, boardHeight: b.height, boardOverflow: board.scrollHeight - board.clientHeight,
          collision: Math.min(b.right, k.right) > Math.max(b.left, k.left)
            ? Math.max(0, Math.min(b.bottom, k.bottom) - Math.max(b.top, k.top)) : 0,
          stageOverflow: b.bottom - s.bottom,
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          kpiClipping: kpis.scrollHeight - kpis.clientHeight,
          cardVerticalOverflow,
          bubbles: board.querySelectorAll(".match-score-bubble").length };
      });
      measurements.push({ width, height, mode, ...geometry });
      expect.soft(geometry.pageOverflow, `${width}x${height} ${mode} page`).toBeLessThanOrEqual(1);
      expect.soft(geometry.boardOverflow, `${width}x${height} ${mode} scoreboard clipping`).toBeLessThanOrEqual(1);
      expect.soft(geometry.collision, `${width}x${height} ${mode} score / KPI`).toBeLessThanOrEqual(1);
      expect.soft(geometry.stageOverflow, `${width}x${height} ${mode} score / parent`).toBeLessThanOrEqual(1);
      expect.soft(geometry.kpiClipping, `${width}x${height} ${mode} carrousel KPI coupé`).toBeLessThanOrEqual(1);
      expect.soft(geometry.cardVerticalOverflow, `${width}x${height} ${mode} carte KPI coupée`).toBeLessThanOrEqual(1);
      expect(geometry.bubbles).toBe(4);
      await expect(page.getByRole("button", { name: "Section suivante", exact: true })).toBeVisible();
      const next = page.getByRole("button", { name: "Indicateurs suivants", exact: true });
      if (await next.isEnabled()) {
        await next.click();
        await page.getByRole("button", { name: "Indicateurs précédents", exact: true }).click();
      }
      const edit = page.getByRole("button", { name: "Modifier les chiffres", exact: true });
      await edit.scrollIntoViewIfNeeded();
      const editBox = await edit.boundingBox();
      expect(editBox!.y).toBeGreaterThanOrEqual(0);
      expect(editBox!.y + editBox!.height).toBeLessThanOrEqual(height + 1);
      if (width === 1366 && height === 650 && mode === "celebration") {
        await page.screenshot({ path: info.outputPath("1366x650-celebration-kpi-reachable.png") });
      }
      await page.locator(".match-slide-viewport").evaluate(element => { element.scrollTop = 0; });
      if ([[1366,650],[1536,864],[1180,640],[390,844]].some(([w,h]) => w === width && h === height)) {
        await page.screenshot({ path: info.outputPath(`${width}x${height}-${mode}-score.png`), fullPage: mode === "normal" });
      }
      if (mode === "celebration") await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
    }
  }
  await info.attach("mesures-score.json", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
  console.log(JSON.stringify(measurements));
});

test("Lot 2 : camemberts lisibles, notamment 1180x640, sans élargir la tolérance", async ({ page }, info) => {
  test.setTimeout(180_000);
  test.skip(info.project.name !== "desktop", "19 viewports explicites.");
  const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  await page.route("**/api/agencies/058/snapshot**", route => route.fulfill({ json: { snapshot } }));
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  const measurements = [];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const mode of ["normal", "celebration"]) {
      await nav.getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
      if (mode === "celebration") await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
      await nav.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
      for (const label of ["% duels gagnés", "% tirs cadrés"]) {
        await page.getByRole("tab", { name: `Afficher ${label}`, exact: true }).click();
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const geometry = await page.locator(".operational-chart-slide.is-active").evaluate(root => {
          const pie = root.querySelector(".loading-quality-pie");
          if (!pie) return null;
          const r = pie.getBoundingClientRect(), card = root.firstElementChild!.getBoundingClientRect();
          return { left: r.left - card.left, right: r.right - card.right, top: r.top - card.top, bottom: r.bottom - card.bottom,
            pageOverflow: document.documentElement.scrollWidth - innerWidth };
        });
        if (!geometry) continue;
        measurements.push({ width, height, mode, label, ...geometry });
        expect.soft(geometry.left, `${width}x${height} ${mode} ${label} gauche`).toBeGreaterThanOrEqual(-2);
        expect.soft(geometry.right, `${width}x${height} ${mode} ${label} droite`).toBeLessThanOrEqual(2);
        expect.soft(geometry.top, `${width}x${height} ${mode} ${label} haut`).toBeGreaterThanOrEqual(-2);
        expect.soft(geometry.bottom, `${width}x${height} ${mode} ${label} bas`).toBeLessThanOrEqual(2);
        expect.soft(geometry.pageOverflow).toBeLessThanOrEqual(1);
        if (width === 1180) await page.screenshot({ path: info.outputPath(`${mode}-${label.replaceAll("% ", "").replaceAll(" ", "-")}.png`) });
      }
      if (mode === "celebration") await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
    }
  }
  await info.attach("mesures-camemberts.json", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
});
