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
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await page.locator(".match-indicators").scrollIntoViewIfNeeded();
}

async function useEmptyMercatoFixture(page: Page) {
  await page.route("**/api/agencies/058/causerie**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ plan: { mercato: "", mercatoProfiles: {} } }),
    });
  });
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
  await useEmptyMercatoFixture(page);
  await login(page);
  const viewport = page.locator(".match-indicators-viewport");
  const carousel = page.locator(".match-indicators");
  const value = (id: string) => carousel.locator(`[data-indicator="${id}"] .match-indicator-value`);
  await expect(carousel.locator(".match-indicator-card")).toHaveCount(8);
  await expect(value("tonnage")).toHaveText("478 t");
  await expect(value("positions")).toHaveText(new Intl.NumberFormat("fr-FR").format(excelPositions));
  await expect(value("arrival")).toHaveText("80%");
  await expect(value("departure")).toHaveText("64,1%");
  await expect(page.locator(".match-score-bubbles").getByText("% duels gagnés", { exact: true })).toBeVisible();
  await expect(page.locator(".match-score-bubble.reception-score-bubble strong")).toHaveText("56,5%");
  await expect(page.getByLabel("KPI intégrés au score")).toContainText("% possession");
  await expect(page.locator(".match-score-bubbles").getByText("% passes réussies", { exact: true })).toBeVisible();
  await expect(page.locator(".match-score-bubble.pass-score-bubble strong")).toHaveText("69,2%");
  await expect(value("temperature")).toHaveText("92,19%");
  await expect(carousel.locator('[data-indicator="arrival"] .match-indicator-card')).toHaveClass(/is-below-target/);
  await expect(carousel.locator('[data-indicator="temperature"] .match-indicator-card')).toHaveClass(/is-below-target/);
  await expect(carousel.locator('[data-indicator="temperature"] .match-indicator-meter')).toBeVisible();
  await expect(carousel.locator('[data-indicator="temperature"] .match-indicator-target')).toHaveCSS("left", /.+/);
  await expect(carousel.locator('[data-indicator="temperature"] .match-indicator-meter-scale')).toHaveText("0%Objectif 100%100%");
  await expect(carousel.locator('[data-indicator="arrival"] .match-indicator-source')).toContainText("objectif 85%");
  await expect(page.locator(".operational-chart-slide")).toHaveCount(5);
  const matchNavigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  await matchNavigation.getByRole("button", { name: "Aller à Statistiques du match" }).click();
  await page.locator(".operational-charts-carousel-dots").getByRole("tab", { name: "Afficher % centres réussis" }).click();
  await expect(page.locator(".operational-charts-carousel").getByText("% centres réussis", { exact: true })).toBeVisible();
  await expect(page.locator(".centers-quality-pie span")).toHaveText("62%");
  await page.locator(".centers-quality-details summary").click();
  await expect(page.locator(".centers-quality-details")).toContainText("taux consolidé de ponctualité destination");
  await page.locator(".operational-charts-carousel-dots").getByRole("tab", { name: "Afficher % duels gagnés" }).click();
  await expect(page.locator(".operational-charts-carousel").getByText("% Duels gagnés", { exact: true })).toBeVisible();
  await matchNavigation.getByRole("button", { name: "Aller à Coup de sifflet final" }).click();
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
  await useEmptyMercatoFixture(page);
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

test("le carrousel KPI revient depuis la dernière vignette sur un écran très large", async ({ page }) => {
  await page.setViewportSize({ width: 2842, height: 620 });
  await page.route("**/api/agencies/058/causerie**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ plan: { mercato: "Camille Martin, Julien Thomas", mercatoProfiles: { "camille martin": "female", "julien thomas": "male" } } }),
    });
  });
  await login(page);
  await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
  const carousel = page.locator(".match-indicators");
  const viewport = page.locator(".match-indicators-viewport");
  await viewport.focus();
  await page.keyboard.press("End");
  await expect(carousel.getByRole("button", { name: "Indicateurs suivants", exact: true })).toBeDisabled();
  await expect(carousel.locator(".match-indicators-navigation > span")).toHaveText("9 / 9");
  const endScroll = await viewport.evaluate((element) => element.scrollLeft);
  await carousel.getByRole("button", { name: "Indicateurs précédents", exact: true }).click();
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeLessThan(endScroll - 20);
  await expect(carousel.locator(".match-indicators-navigation > span")).toHaveText("7–8 / 9");
  await expect(carousel.getByRole("button", { name: "Indicateurs suivants", exact: true })).not.toBeDisabled();
});

test("le masquage d'un voyage recalcule les KPI et reste réversible", async ({ page }) => {
  await useEmptyMercatoFixture(page);
  await login(page);
  const matchNavigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  await matchNavigation.getByRole("button", { name: "Aller à Statistiques du match" }).click();
  await page.locator(".operational-charts-carousel-dots").getByRole("tab", { name: "Afficher % duels gagnés" }).click();
  const details = page.locator(".reception-quality-card .duel-quality-details");
  await details.locator("summary").click();
  const action = page.locator('button[aria-label^="Masquer le voyage "]').first();
  const ariaLabel = await action.getAttribute("aria-label");
  const travelCode = ariaLabel?.replace("Masquer le voyage ", "");
  if (!travelCode) throw new Error("Aucun voyage masquable n'a été trouvé dans les duels perdus.");

  const readSnapshot = () => page.evaluate(async () => {
    const response = await fetch("/api/agencies/058/snapshot", { headers: { "x-access-code": "LOCAL-058-DEV" }, cache: "no-store" });
    return response.json() as Promise<{ snapshot: { excludedTravelCodes: string[]; summary: { operations: number; duelTotal: number }; unloadingDuelQuality?: { lostDuels: Array<{ travelCode: string }> } } }>;
  });
  const before = await readSnapshot();
  try {
    await action.click();
    await expect(page.locator(".travel-exclusion-panel")).toContainText(`Réintégrer ${travelCode}`);
    const hidden = await readSnapshot();
    expect(hidden.snapshot.excludedTravelCodes).toContain(travelCode);
    expect(hidden.snapshot.summary.operations).toBeLessThan(before.snapshot.summary.operations);
    expect(hidden.snapshot.summary.duelTotal).toBeLessThan(before.snapshot.summary.duelTotal);
    expect(hidden.snapshot.unloadingDuelQuality?.lostDuels.some((duel) => duel.travelCode === travelCode)).toBe(false);

    await page.getByRole("button", { name: `Réintégrer ${travelCode}`, exact: true }).click();
    await expect(page.locator(".travel-exclusion-panel")).toHaveCount(0);
    const restored = await readSnapshot();
    expect(restored.snapshot.excludedTravelCodes).toEqual([]);
    expect(restored.snapshot.summary.operations).toBe(before.snapshot.summary.operations);
    expect(restored.snapshot.summary.duelTotal).toBe(before.snapshot.summary.duelTotal);
  } finally {
    // Keep the local agency fixture clean even when an assertion fails.
    await page.evaluate(async (code) => {
      await fetch("/api/agencies/058/travel-exclusions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-code": "LOCAL-058-DEV" },
        body: JSON.stringify({ travelCode: code, excluded: false }),
      });
    }, travelCode);
  }
});

test("le Mercato occupe la première vignette KPI et affiche le profil sélectionné", async ({ page }, testInfo) => {
  await page.route("**/api/agencies/058/causerie**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ plan: { mercato: "Camille Martin, Julien Thomas", mercatoProfiles: { "camille martin": "female", "julien thomas": "male" } } }),
    });
  });
  await login(page);
  const carousel = page.locator(".match-indicators");
  const viewport = page.locator(".match-indicators-viewport");
  await expect(carousel.locator(".match-indicators-track > .match-indicator-slide")).toHaveCount(9);
  await page.getByRole("button", { name: "Afficher le Mercato", exact: true }).click();
  await expect(page.locator(".mercato-carousel-card")).toBeVisible();
  const visibleIndicators = await viewport.evaluate((el) => el.clientWidth >= 640 ? 2 : 1);
  await expect(page.locator(".match-indicators-navigation > span")).toHaveText(visibleIndicators === 2 ? "1–2 / 9" : "1 / 9");
  await expect(viewport.locator(".match-indicators-track > .match-indicator-slide").first()).toHaveAttribute("data-indicator", "mercato");
  const activeMercatoSlide = page.locator('.mercato-kpi-slide:not([aria-hidden="true"])');
  await expect(activeMercatoSlide.locator(".mercato-kpi-flocage")).toHaveText("CAMILLE MARTIN");
  await expect(activeMercatoSlide.locator(".mercato-kpi-photo")).toHaveAttribute("data-profile", "female");
  await expect(activeMercatoSlide.locator(".mercato-kpi-profile")).toHaveText("Femme");
  await expect(page.locator(".mercato-kpi-navigation > span")).toHaveText("1 / 2");
  const matchingTile = await page.locator(".mercato-carousel-card").evaluate((card) => {
    const reference = document.querySelector('[data-indicator="performance"] .match-indicator-card') as HTMLElement;
    return {
      width: (card as HTMLElement).offsetWidth,
      height: (card as HTMLElement).offsetHeight,
      referenceWidth: reference.offsetWidth,
      referenceHeight: reference.offsetHeight,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  expect(Math.abs(matchingTile.width - matchingTile.referenceWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(matchingTile.height - matchingTile.referenceHeight)).toBeLessThanOrEqual(1);
  expect(matchingTile.pageOverflow).toBe(false);
  await page.locator(".mercato-carousel-card").screenshot({ path: testInfo.outputPath("mercato-dans-carrousel-kpi.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Joueur suivant dans le Mercato" }).click();
  const nextMercatoSlide = page.locator('.mercato-kpi-slide:not([aria-hidden="true"])');
  await expect(nextMercatoSlide.locator(".mercato-kpi-profile")).toHaveText("Homme");
  await expect(nextMercatoSlide.locator(".mercato-kpi-photo")).toHaveAttribute("data-profile", "male");
  await page.getByRole("button", { name: "Indicateurs suivants", exact: true }).click();
  await expect(page.locator(".match-indicators-navigation > span")).toHaveText(visibleIndicators === 2 ? "2–3 / 9" : "2 / 9");
  await expect(viewport.locator('[data-indicator="performance"]')).toHaveAttribute("data-featured", "");
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
  await useEmptyMercatoFixture(page);
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
