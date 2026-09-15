import { expect, test, type Page } from "@playwright/test";

// Values extracted from the supplied SIE.106J report; PDF positions are deliberately unrelated.
const dailyIndicators = {
  sourceName: "SIE.106J.pdf", importedAt: "2026-09-11T12:00:00Z", referenceDate: "11 septembre 2026",
  expedition: { tonnage: 478, positions: 9999 },
  punctuality: { arrivalPunctuality: 80, departurePunctuality: 64.1, destinationPunctuality: 62, temperatureReturn: 92.19 },
  punctualityTargets: { arrivalPunctuality: 85, departurePunctuality: 85, destinationPunctuality: 85, temperatureReturn: 100 },
};

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("STEF-058");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await page.locator(".match-indicators").scrollIntoViewIfNeeded();
}

test("le carrousel KPI conserve ses sources, sa profondeur et ses saisies", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  let excelPositions = 0;
  let presentPlayers = 0;
  await page.route("**/api/agencies/058/snapshot**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    excelPositions = body.snapshot.summary.positions;
    presentPlayers = body.snapshot.summary.players;
    body.snapshot.dailyIndicators = dailyIndicators;
    // Guard against accidentally displaying a stale summary tonnage or a saved position override.
    body.snapshot.summary.tonnage = 12;
    await route.fulfill({ response, json: body });
  });
  await login(page);
  const viewport = page.locator(".match-indicators-viewport");
  const carousel = page.locator(".match-indicators");
  const value = (id: string) => carousel.locator(`[data-indicator="${id}"] .match-indicator-value`);
  await expect(carousel.locator(".match-indicator-card")).toHaveCount(8);
  await expect(value("tonnage")).toHaveText("478 t");
  await expect(value("positions")).toHaveText(new Intl.NumberFormat("fr-FR").format(excelPositions));
  await expect(value("arrival")).toHaveText("80%");
  await expect(value("departure")).toHaveText("64,1%");
  await expect(page.locator(".match-score-bubbles").getByText("% centres réussis", { exact: true })).toBeVisible();
  await expect(page.locator(".match-score-bubble.centers-score-bubble strong")).toHaveText("62%");
  await expect(page.locator(".match-score-bubbles").getByText("% passes réussies", { exact: true })).toBeVisible();
  await expect(page.locator(".match-score-bubble.duel-score-bubble strong")).toHaveText("69,2%");
  await expect(value("temperature")).toHaveText("92,19%");
  await expect(carousel.locator('[data-indicator="arrival"] .match-indicator-card')).toHaveClass(/is-below-target/);
  await expect(carousel.locator('[data-indicator="temperature"] .match-indicator-card')).toHaveClass(/is-below-target/);
  await expect(carousel.locator('[data-indicator="temperature"] .match-indicator-meter')).toBeVisible();
  await expect(carousel.locator('[data-indicator="temperature"] .match-indicator-target')).toHaveCSS("left", /.+/);
  await expect(carousel.locator('[data-indicator="temperature"] .match-indicator-meter-scale')).toHaveText("0%Objectif 100%100%");
  await expect(carousel.locator('[data-indicator="arrival"] .match-indicator-source')).toContainText("objectif 85%");
  await expect(page.locator(".operational-chart-slide")).toHaveCount(4);
  await expect(page.locator(".operational-charts-carousel").getByText("% centres réussis", { exact: true })).toBeVisible();
  await expect(page.locator(".operational-charts-carousel").getByText("Temps de réception", { exact: true })).toBeVisible();
  await expect(page.locator(".centers-quality-pie span")).toHaveText("62%");
  await page.locator(".centers-quality-details summary").click();
  await expect(page.locator(".centers-quality-details")).toContainText("taux consolidé de ponctualité destination");
  const centers = await viewport.evaluate((el) => el.clientWidth >= 640 ? 2 : 1);
  await expect(carousel.locator("[data-featured]")).toHaveCount(centers);
  await carousel.screenshot({ path: testInfo.outputPath("kpi-initial.png") });

  await page.getByRole("button", { name: "Modifier les chiffres", exact: true }).click();
  await page.getByLabel("Nombre de blessures A.T").selectOption("2");
  await page.getByLabel("Effectif prévu du jour").fill("22");
  await page.getByRole("button", { name: "Enregistrer les chiffres", exact: true }).click();
  await expect(value("injuries")).toHaveText("2");
  await expect(carousel.locator(".real-staff-metric strong")).toHaveText(`${new Intl.NumberFormat("fr-FR").format(Math.round(presentPlayers / 22 * 1000) / 10)}%`);
  await page.getByRole("button", { name: "Modifier les chiffres", exact: true }).click();
  await page.getByLabel("Nombre de blessures A.T").selectOption("5");
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(value("injuries")).toHaveText("2");

  await carousel.getByRole("button", { name: "Afficher Tonnage", exact: true }).click();
  await expect(carousel.locator('[data-indicator="tonnage"]')).toHaveAttribute("data-featured", "");
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(500);
  await carousel.screenshot({ path: testInfo.outputPath("kpi-pdf.png") });
  const dimensions = await carousel.locator(".match-indicator-card").evaluateAll((cards) => cards.map((card) => ({
    width: (card as HTMLElement).offsetWidth, height: (card as HTMLElement).offsetHeight,
    overflow: card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1,
  })));
  expect(new Set(dimensions.map((d) => d.height)).size).toBe(1);
  expect(new Set(dimensions.map((d) => d.width)).size).toBe(1);
  expect(dimensions.some((d) => d.overflow)).toBe(false);

  // Intermediate scroll positions must give intermediate depths, not a class toggle.
  const depth = await viewport.evaluate(async (el) => {
    const target = el.querySelector('[data-indicator="tonnage"]') as HTMLElement;
    const before = Number(target.style.getPropertyValue("--indicator-scale"));
    el.scrollLeft += 80;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { before, during: Number(target.style.getPropertyValue("--indicator-scale")) };
  });
  expect(depth.during).toBeLessThan(depth.before);
  expect(depth.during).toBeGreaterThan(.95);

  await viewport.focus();
  await page.keyboard.press("End");
  await expect(carousel.getByRole("button", { name: "Indicateurs suivants", exact: true })).toBeDisabled();
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(1000);
  await expect(carousel.locator('[data-indicator="temperature"]')).toHaveAttribute("data-featured", "");
  await carousel.screenshot({ path: testInfo.outputPath("kpi-last.png") });
  await page.keyboard.press("Home");
  await expect(carousel.getByRole("button", { name: "Indicateurs précédents", exact: true })).toBeDisabled();
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeLessThan(1);
  await expect(carousel.locator('[data-indicator="performance"]')).toHaveAttribute("data-featured", "");

  await viewport.scrollIntoViewIfNeeded();
  const rect = await viewport.boundingBox();
  if (!rect) throw new Error("Missing carousel viewport");
  if (testInfo.project.name === "mobile") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: rect.x + rect.width * .85, y: rect.y + 130 }] });
    for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: rect.x + rect.width * (.85 - i * .065), y: rect.y + 130 }] });
    // Holding the finger past the snap delay must not interrupt the gesture.
    await page.waitForTimeout(300);
    const heldPosition = await viewport.evaluate((el) => el.scrollLeft);
    await page.waitForTimeout(250);
    expect(await viewport.evaluate((el) => el.scrollLeft)).toBeCloseTo(heldPosition, 0);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.move(rect.x + rect.width * .75, rect.y + 140);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * .75 - 310, rect.y + 140, { steps: 16 });
    await page.mouse.up();
  }
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  await expect.poll(() => carousel.locator("[data-featured]").count()).toBe(centers);
  await viewport.hover();
  const scrollBeforeWheel = await viewport.evaluate((el) => el.scrollLeft);
  await page.mouse.wheel(300, 0);
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(scrollBeforeWheel + 100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await viewport.focus();
  await page.keyboard.press("End");
  await expect(carousel.locator('[data-indicator="temperature"] .match-indicator-card')).toHaveCSS("transform", "none");
  await page.reload();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await expect(value("injuries")).toHaveText("2");
});

test("le carrousel distingue un PDF absent, une valeur nulle et un indicateur absent", async ({ page }) => {
  let pdf: unknown = null;
  await page.route("**/api/agencies/058/snapshot**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.snapshot.dailyIndicators = pdf;
    await route.fulfill({ response, json: body });
  });
  await login(page);
  const value = (id: string) => page.locator(`[data-indicator="${id}"] .match-indicator-value`);
  await expect(value("arrival")).toHaveText("PDF à importer");
  await expect(value("tonnage")).toHaveText("PDF à importer");
  pdf = { ...dailyIndicators, expedition: { tonnage: 0 }, punctuality: { arrivalPunctuality: 0 } };
  await page.reload();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await expect(value("tonnage")).toHaveText("0 t");
  await expect(value("arrival")).toHaveText("0%");
  await expect(value("departure")).toHaveText("Indisponible");
  await expect(page.locator(".match-indicator-card")).toHaveCount(8);
});

test("le carrousel reste cadré du petit mobile au grand écran et dans chaque ligue", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Le redimensionnement est vérifié sur un seul navigateur.");
  test.setTimeout(90_000);
  await page.route("**/api/agencies/058/snapshot**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.snapshot.dailyIndicators = dailyIndicators;
    await route.fulfill({ response, json: body });
  });
  await login(page);
  for (const width of [2560, 1920, 1280, 768, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const viewport = page.locator(".match-indicators-viewport");
    await viewport.scrollIntoViewIfNeeded();
    await viewport.focus();
    await page.keyboard.press("Home");
    await expect(page.locator('[data-indicator="performance"]')).toHaveAttribute("data-featured", "");
    const layout = await page.locator(".match-indicators").evaluate((root) => {
      const cards = Array.from(root.querySelectorAll<HTMLElement>(".match-indicator-card"));
      const overflow = Array.from(root.querySelectorAll<HTMLElement>(".match-indicator-body, .match-indicator-title, .match-indicator-staff, .match-indicator-source"))
        .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
        .map((el) => ({ name: el.className, text: el.textContent, height: el.clientHeight, scrollHeight: el.scrollHeight }));
      const viewport = root.querySelector(".match-indicators-viewport")!.getBoundingClientRect();
      const featured = Array.from(root.querySelectorAll("[data-featured] .match-indicator-card")).map((el) => el.getBoundingClientRect());
      const center = featured.reduce((sum, rect) => sum + rect.x + rect.width / 2, 0) / featured.length;
      return {
        overflow, pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        rootContained: root.getBoundingClientRect().right <= window.innerWidth + 1,
        centered: Math.abs(center - viewport.x - viewport.width / 2) < 2,
        sameHeight: cards.every((el) => el.offsetHeight === cards[0].offsetHeight),
      };
    });
    if (!layout.rootContained) {
      console.log(await page.locator(".match-indicators").evaluate((el) => {
        const parents = [];
        for (let node: HTMLElement | null = el as HTMLElement; node; node = node.parentElement) {
          const rect = node.getBoundingClientRect();
          const css = getComputedStyle(node);
          parents.push({ node: node.className, x: rect.x, width: rect.width, minWidth: css.minWidth, columns: css.gridTemplateColumns, padding: css.padding });
        }
        return parents;
      }));
    }
    expect(layout, `largeur ${width}`).toEqual({ overflow: [], pageOverflow: false, rootContained: true, centered: true, sameHeight: true });
    await page.locator(".match-indicators").screenshot({ path: testInfo.outputPath(`kpi-${width}.png`) });
  }
  await page.setViewportSize({ width: 1536, height: 1024 });
  for (const [league, tone] of [["bronze", "bronze"], ["argent", "silver"], ["or", "gold"], ["platine", "platinum"]]) {
    await page.getByRole("button", { name: "ADM Administrateur", exact: true }).click();
    await page.locator(`.league-card.${tone} .league-select-button`).click();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await expect(page.locator(`.app-shell.league-${league}`)).toBeVisible();
    await expect(page.locator('[data-indicator="tonnage"] .match-indicator-value')).toHaveText("478 t");
    await page.locator(".match-indicators").getByRole("button", { name: "Afficher Ponctualité arrivage", exact: true }).click();
    await expect(page.locator('[data-indicator="arrival"]')).toHaveAttribute("data-featured", "");
    await page.locator(".match-indicators").screenshot({ path: testInfo.outputPath(`kpi-${league}.png`) });
  }
});
