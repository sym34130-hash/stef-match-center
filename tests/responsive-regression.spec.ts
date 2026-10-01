import { expect, test, type Locator, type Page } from "@playwright/test";

type ViewportCase = {
  name: string;
  width: number;
  height: number;
  reference: boolean;
};

const viewports: ViewportCase[] = [
  { name: "1366x768", width: 1366, height: 768, reference: true },
  { name: "1536x864", width: 1536, height: 864, reference: true },
  { name: "1600x900", width: 1600, height: 900, reference: true },
  { name: "1920x1080", width: 1920, height: 1080, reference: true },
  { name: "2560x1440", width: 2560, height: 1440, reference: true },
  { name: "1366x650", width: 1366, height: 650, reference: false },
  { name: "1536x720", width: 1536, height: 720, reference: false },
  { name: "1920x800", width: 1920, height: 800, reference: false },
  { name: "1920x900", width: 1920, height: 900, reference: false },
];

const matchSlides = [
  "Coup de sifflet final",
  "Cérémonie des performances",
  "Statistiques du match",
  "Brief équipe",
];

test.describe.configure({ mode: "serial", timeout: 8 * 60_000 });

test("recette responsive complète et références visuelles", async ({ page }) => {
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(15_000);
  const browserErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    if (url.includes("/api/") || url.includes("/assets/")) failedRequests.push(`${response.status()} ${url}`);
  });

  const cases = process.env.RESPONSIVE_VIEWPORT_LIMIT ? viewports.slice(0, Number(process.env.RESPONSIVE_VIEWPORT_LIMIT)) : viewports;
  for (const viewport of cases) {
    console.log(`[responsive] ${viewport.name}: ouverture`);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openMatchSheet(page);
    console.log(`[responsive] ${viewport.name}: normal`);
    await expect(page.locator(".match-page")).toBeVisible();
    await assertNoHorizontalOverflow(page, viewport);

    const navigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
    for (let index = 0; index < matchSlides.length; index += 1) {
      await navigation.getByRole("button", { name: `Aller à ${matchSlides[index]}`, exact: true }).click();
      await expect(navigation.locator(".match-carousel-count")).toHaveText(`0${index + 1} / 04`);
      await assertNormalSlide(page, index, viewport);
      if (viewport.reference) await captureReference(page, `normal-slide-${index + 1}`, viewport);
    }

    await navigation.getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
    await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
    console.log(`[responsive] ${viewport.name}: Brief`);
    const exitButton = page.getByRole("button", { name: "Sortir du mode Célébration", exact: true });
    await expect(exitButton).toBeVisible();
    for (let index = 0; index < matchSlides.length; index += 1) {
      await navigation.getByRole("button", { name: `Aller à ${matchSlides[index]}`, exact: true }).click();
      await expect(navigation.locator(".match-carousel-count")).toHaveText(`0${index + 1} / 04`);
      await assertBriefSlide(page, index, viewport, exitButton);
      if (viewport.reference && (index === 0 || index === 2)) {
        await captureReference(page, `brief-slide-${index + 1}`, viewport);
      }
    }

    await exitButton.click();
    await expect(page.getByRole("button", { name: "Mode célébration", exact: true })).toBeVisible();
    await navigation.getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
    await page.getByRole("button", { name: "Composition", exact: true }).click();
    console.log(`[responsive] ${viewport.name}: Composition`);
    await assertComposition(page, viewport);
    if (viewport.reference) await captureReference(page, "composition", viewport);
  }

  expect(browserErrors, "erreurs navigateur pendant la matrice responsive").toEqual([]);
  expect(failedRequests, "requêtes API ou assets en erreur pendant la matrice responsive").toEqual([]);
});

async function openMatchSheet(page: Page) {
  await page.goto("/");
  const loginForm = page.getByLabel("Code agence");
  const matchButton = page.getByRole("button", { name: "02 Feuille de match", exact: true });
  await expect(loginForm.or(matchButton)).toBeVisible({ timeout: 15_000 });
  if (await loginForm.isVisible().catch(() => false)) {
    await loginForm.selectOption("058");
    await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
    await page.getByRole("button", { name: "Accéder au match" }).click();
    await expect(matchButton).toBeVisible({ timeout: 15_000 });
  }
  if (!(await page.locator(".match-page").isVisible().catch(() => false))) await matchButton.click();
  await expect(page.getByRole("navigation", { name: "Navigation de la feuille de match" })).toBeVisible();
}

async function assertNormalSlide(page: Page, slideIndex: number, viewport: ViewportCase) {
  const active = page.locator(".match-slide-panel.is-active");
  await expect(active).toHaveCount(1);
  await expect(active).toBeVisible();
  await assertSlideGeometry(active, `slide normale ${slideIndex + 1}`, viewport, { allowPageVerticalScroll: true });

  const navigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  await assertFullyVisible(navigation.locator(".match-carousel-count"), `compteur normal ${slideIndex + 1}`);
  await assertFullyVisible(navigation.getByRole("button", { name: "Section précédente" }), `flèche précédente normale ${slideIndex + 1}`);
  await assertFullyVisible(navigation.getByRole("button", { name: "Section suivante" }), `flèche suivante normale ${slideIndex + 1}`);

  if (slideIndex === 0) {
    await assertVisibleWithin(active, [".match-result-stage", ".match-indicators-area"], "slide normale 1");
    await assertIndicatorCarousel(page, `slide normale 1 ${viewport.name}`);
  } else if (slideIndex === 1) {
    await assertVisibleWithin(active, [".category-awards-stage", ".award-card"], "slide normale 2");
  } else if (slideIndex === 2) {
    await assertOperationalCarousel(page, `slide normale 3 ${viewport.name}`);
  } else {
    await assertVisibleWithin(active, [".tv-plan-grid", ".tv-action"], "slide normale 4");
  }
}

async function assertBriefSlide(page: Page, slideIndex: number, viewport: ViewportCase, exitButton: Locator) {
  const active = page.locator(".match-page.is-celebration-mode .match-slide-panel.is-active");
  await expect(active).toHaveCount(1);
  await expect(active).toBeVisible();
  await assertSlideGeometry(active, `slide Brief ${slideIndex + 1}`, viewport, { allowPageVerticalScroll: false });
  await assertFullyVisible(exitButton, `sortie Brief slide ${slideIndex + 1}`);

  const navigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  await assertFullyVisible(navigation.locator(".match-carousel-count"), `compteur Brief ${slideIndex + 1}`);
  await assertFullyVisible(navigation.getByRole("button", { name: "Section précédente" }), `flèche précédente Brief ${slideIndex + 1}`);
  await assertFullyVisible(navigation.getByRole("button", { name: "Section suivante" }), `flèche suivante Brief ${slideIndex + 1}`);

  if (slideIndex === 0) {
    await assertVisibleWithin(active, [".match-result-stage", ".match-indicators-area"], "slide Brief 1");
    await assertIndicatorCarousel(page, `slide Brief 1 ${viewport.name}`);
  } else if (slideIndex === 1) {
    await assertVisibleWithin(active, [".category-awards-stage", ".award-card"], "slide Brief 2");
  } else if (slideIndex === 2) {
    await assertOperationalCarousel(page, `slide Brief 3 ${viewport.name}`);
  } else {
    await assertVisibleWithin(active, [".tv-plan-grid", ".tv-action"], "slide Brief 4");
  }
}

async function assertOperationalCarousel(page: Page, label: string) {
  const carousel = page.locator(".operational-charts-carousel");
  await expect(carousel).toBeVisible();
  const tabs = carousel.locator(".operational-charts-carousel-dots [role='tab']");
  await expect(tabs).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await tabs.nth(index).click();
    const activeChart = carousel.locator(".operational-chart-slide.is-active");
    await expect(activeChart).toBeVisible();
    await expect(carousel.locator(".operational-charts-carousel-counter")).toHaveText(`${index + 1} / 4`);
    await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(650);
    const geometry = await activeChart.evaluate((element) => {
      const card = element as HTMLElement;
      const cardRect = card.getBoundingClientRect();
      const carouselViewport = card.closest(".operational-charts-carousel")?.querySelector<HTMLElement>(".operational-charts-carousel-viewport")?.getBoundingClientRect();
      const visuals = [...card.querySelectorAll<HTMLElement>(".performance-chart, .loading-quality-pie")]
        .map((visual) => {
          const rect = visual.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        });
      const visibleText = [...card.querySelectorAll<HTMLElement>("h3, h4, strong, span, summary")]
        .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0).length;
      return {
        card: { left: cardRect.left, right: cardRect.right, top: cardRect.top, bottom: cardRect.bottom },
        viewport: carouselViewport ? { left: carouselViewport.left, right: carouselViewport.right, top: carouselViewport.top, bottom: carouselViewport.bottom } : null,
        visuals,
        scrollWidth: card.scrollWidth,
        clientWidth: card.clientWidth,
        scrollHeight: card.scrollHeight,
        clientHeight: card.clientHeight,
        visibleText,
      };
    });
    expect(geometry.scrollWidth, `${label}: débordement horizontal du graphique ${index + 1}`).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.visibleText, `${label}: texte critique absent du graphique ${index + 1}`).toBeGreaterThan(0);
    expect(geometry.visuals.length, `${label}: aucun visuel de graphique détecté sur la slide ${index + 1}`).toBeGreaterThan(0);
    geometry.visuals.forEach((visual, visualIndex) => {
      const subpixelTolerance = 2;
      expect(visual.left, `${label}: visuel ${visualIndex + 1} de la slide ${index + 1} rogné à gauche`).toBeGreaterThanOrEqual(geometry.card.left - subpixelTolerance);
      expect(visual.right, `${label}: visuel ${visualIndex + 1} de la slide ${index + 1} rogné à droite`).toBeLessThanOrEqual(geometry.card.right + subpixelTolerance);
      expect(visual.top, `${label}: visuel ${visualIndex + 1} de la slide ${index + 1} rogné en haut`).toBeGreaterThanOrEqual(geometry.card.top - subpixelTolerance);
      expect(visual.bottom, `${label}: visuel ${visualIndex + 1} de la slide ${index + 1} rogné en bas`).toBeLessThanOrEqual(geometry.card.bottom + subpixelTolerance);
    });
    if (geometry.viewport) {
      expect(geometry.card.left, `${label}: carte ${index + 1} active coupée à gauche`).toBeGreaterThanOrEqual(geometry.viewport.left - 4);
      expect(geometry.card.right, `${label}: carte ${index + 1} active coupée à droite`).toBeLessThanOrEqual(geometry.viewport.right + 4);
    }
  }
}

async function assertIndicatorCarousel(page: Page, label: string) {
  const carousel = page.locator(".match-page .match-indicators");
  const viewport = carousel.locator(".match-indicators-viewport");
  const navigation = carousel.locator(".match-indicators-navigation");
  await expect(viewport).toBeVisible();
  await viewport.focus();
  await page.keyboard.press("End");
  await expect(navigation.locator("> span")).toHaveText("9 / 9");
  await expect(carousel.getByRole("button", { name: "Indicateurs suivants", exact: true })).toBeDisabled();
  await expect(carousel.getByRole("button", { name: "Indicateurs précédents", exact: true })).not.toBeDisabled();
  await carousel.getByRole("button", { name: "Indicateurs précédents", exact: true }).click();
  await expect(navigation.locator("> span")).not.toHaveText("9 / 9");
  await expect(carousel.getByRole("button", { name: "Indicateurs suivants", exact: true })).not.toBeDisabled();
  await viewport.focus();
  await page.keyboard.press("Home");
  await expect(navigation.locator("> span")).toHaveText(/1(?:–2)? \/ 9/);
  await assertNoHorizontalOverflow(page, { name: label, width: page.viewportSize()?.width ?? 0, height: page.viewportSize()?.height ?? 0, reference: false });
}

async function assertComposition(page: Page, viewport: ViewportCase) {
  const composition = page.locator(".composition-page");
  await expect(composition).toBeVisible();
  const geometry = await composition.evaluate((element) => {
    const header = element.querySelector<HTMLElement>(".composition-header");
    const arena = element.querySelector<HTMLElement>(".composition-arena");
    const pitch = element.querySelector<HTMLElement>(".formation-pitch");
    return {
      position: header ? getComputedStyle(header).position : "missing",
      headerHeight: header?.getBoundingClientRect().height ?? 0,
      arenaHeight: arena?.getBoundingClientRect().height ?? 0,
      pitchHeight: pitch?.getBoundingClientRect().height ?? 0,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(["relative", "static"], `bandeau Composition sticky/fixed à ${viewport.name}`).toContain(geometry.position);
  expect(geometry.headerHeight, `bandeau Composition absent à ${viewport.name}`).toBeGreaterThan(0);
  expect(geometry.arenaHeight, `terrain absent à ${viewport.name}`).toBeGreaterThan(0);
  expect(geometry.pitchHeight, `terrain de jeu absent à ${viewport.name}`).toBeGreaterThan(0);
  expect(geometry.scrollWidth, `Composition déborde horizontalement à ${viewport.name}`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  await assertNoHorizontalOverflow(page, viewport);
}

async function assertSlideGeometry(active: Locator, label: string, viewport: ViewportCase, options: { allowPageVerticalScroll: boolean }) {
  const geometry = await active.evaluate((element) => {
    const root = element as HTMLElement;
    const style = getComputedStyle(root);
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
    };
  });
  expect(geometry.scrollWidth, `${label}: contenu horizontal coupé à ${viewport.name}`).toBeLessThanOrEqual(geometry.clientWidth + 1);
  if (!options.allowPageVerticalScroll || geometry.overflowY !== "visible") {
    expect(geometry.scrollHeight, `${label}: contenu vertical coupé à ${viewport.name}`).toBeLessThanOrEqual(geometry.clientHeight + 1);
  }
}

async function assertVisibleWithin(root: Locator, selectors: string[], label: string) {
  const result = await root.evaluate((element, requestedSelectors) => {
    const rootRect = element.getBoundingClientRect();
    return requestedSelectors.flatMap((selector) => Array.from(element.querySelectorAll<HTMLElement>(selector)).map((child) => {
      const rect = child.getBoundingClientRect();
      return {
        selector,
        width: rect.width,
        height: rect.height,
        left: rect.left - rootRect.left,
        right: rect.right - rootRect.left,
        top: rect.top - rootRect.top,
        bottom: rect.bottom - rootRect.top,
      };
    }));
  }, selectors);
  expect(result.length, `${label}: élément critique absent`).toBeGreaterThan(0);
  for (const item of result) {
    expect(item.width, `${label}: ${item.selector} sans largeur`).toBeGreaterThan(0);
    expect(item.height, `${label}: ${item.selector} sans hauteur`).toBeGreaterThan(0);
    expect(item.left, `${label}: ${item.selector} rogné à gauche`).toBeGreaterThanOrEqual(-1);
    expect(item.right, `${label}: ${item.selector} rogné à droite`).toBeLessThanOrEqual((await root.evaluate((element) => element.clientWidth)) + 1);
  }
}

async function assertFullyVisible(locator: Locator, label: string) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label}: bounding box absent`);
  const viewport = locator.page().viewportSize();
  if (!viewport) throw new Error(`${label}: viewport absent`);
  expect(box.x, `${label}: hors écran à gauche`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label}: hors écran en haut`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label}: hors écran à droite`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height, `${label}: hors écran en bas`).toBeLessThanOrEqual(viewport.height + 1);
}

async function assertNoHorizontalOverflow(page: Page, viewport: ViewportCase) {
  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(geometry.scrollWidth, `débordement horizontal à ${viewport.name}`).toBeLessThanOrEqual(geometry.innerWidth + 1);
  expect(geometry.bodyScrollWidth, `débordement horizontal du body à ${viewport.name}`).toBeLessThanOrEqual(geometry.innerWidth + 1);
}

async function captureReference(page: Page, scene: string, viewport: ViewportCase) {
  await expect(page).toHaveScreenshot(`${viewport.name}-${scene}.png`, {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.02,
    threshold: 0.2,
  });
}
