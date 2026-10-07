import { expect, test, type Locator, type Page } from "@playwright/test";

type ViewportCase = {
  name: string;
  width: number;
  height: number;
  reference: boolean;
};

const viewports: ViewportCase[] = [
  { name: "1366x768", width: 1366, height: 768, reference: true },
  { name: "1440x900", width: 1440, height: 900, reference: true },
  { name: "1536x864", width: 1536, height: 864, reference: true },
  { name: "1600x900", width: 1600, height: 900, reference: true },
  { name: "1920x1080", width: 1920, height: 1080, reference: true },
  { name: "2560x1440", width: 2560, height: 1440, reference: true },
  { name: "1366x650", width: 1366, height: 650, reference: false },
  { name: "1536x720", width: 1536, height: 720, reference: false },
  { name: "1920x800", width: 1920, height: 800, reference: false },
  { name: "1920x900", width: 1920, height: 900, reference: false },
  { name: "1024x768", width: 1024, height: 768, reference: false },
  { name: "1180x640", width: 1180, height: 640, reference: false },
  { name: "2560x800", width: 2560, height: 800, reference: false },
];

const matchSlides = [
  "Coup de sifflet final",
  "Cérémonie des performances",
  "Statistiques du match",
  "Brief équipe",
];

test.describe.configure({ mode: "serial", timeout: 8 * 60_000 });

test.beforeEach(async ({ page }) => {
  // Stabilize only import metadata used by the visual header, not KPI data.
  await page.route("**/api/agencies/058/snapshot**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.snapshot) body.snapshot.importedAt = "2026-10-06T06:00:00.000Z";
    await route.fulfill({ response, json: body });
  });
});

test("contrat structurel : collisions ciblées et textes longs", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-10-06T08:00:00+02:00"));
  const screens = ["01 Coup d'envoi", "03 Composition", "04 Coach", "05 BRIEF ÉQUIPE", "Import", "Guide", "Administrateur"];
  for (const viewport of viewports) {
    console.log(`[structure] ${viewport.name}`);
    await page.setViewportSize(viewport);
    await openMatchSheet(page);
    const navigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
    for (const slide of matchSlides) {
      await navigation.getByRole("button", { name: `Aller à ${slide}`, exact: true }).click();
      await page.waitForTimeout(350);
      await assertNoHorizontalOverflow(page, viewport);
      await assertFunctionalCollisions(page, `${viewport.name} / ${slide}`);
    }
    await navigation.getByRole("button", { name: `Aller à ${matchSlides[0]}`, exact: true }).click();
    // DOM-only fixture: no saved plan, API write or business value is changed.
    await page.locator(".match-indicator-card:not(.is-mercato)").evaluateAll((cards) => {
      for (const card of cards) {
        const title = card.querySelector("h3");
        const source = card.querySelector(".match-indicator-source");
        if (title) title.textContent = "Indicateur opérationnel avec un intitulé volontairement long pour contrôler le retour à la ligne";
        if (source) source.textContent = "Source documentaire de test avec une référence longue et plusieurs précisions opérationnelles à conserver intégralement.";
      }
    });
    await assertFunctionalCollisions(page, `${viewport.name} / KPI longs`);
    await assertTextNotClipped(page, ".match-indicator-card:not(.is-mercato)", viewport.name);
    if (viewport.reference) await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-long-kpi.png`), fullPage: true });
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await assertFullyVisible(navigation.locator(".match-carousel-count"), `${viewport.name} / compteur après défilement`);
    await assertFullyVisible(navigation.getByRole("button", { name: "Section suivante", exact: true }), `${viewport.name} / navigation après défilement`);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
    await assertFunctionalCollisions(page, `${viewport.name} / KPI longs en célébration`);
    await assertTextNotClipped(page, ".match-indicator-card:not(.is-mercato)", `${viewport.name} / célébration`);
    await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
    for (const screen of screens) {
      // Secondary navigation items include a small MAJ/ADM prefix.
      await page.locator(".sidebar").getByRole("button", { name: screen, exact: !["Import", "Guide", "Administrateur"].includes(screen) }).click();
      await page.waitForTimeout(350);
      await assertNoHorizontalOverflow(page, viewport);
      await assertFunctionalCollisions(page, `${viewport.name} / ${screen}`);
      if (screen === "03 Composition") {
        await page.locator(".formation-player-copy strong").evaluateAll((nodes) => {
          for (const node of nodes) node.textContent = "Alexandre Jean-Baptiste Dupont-Martin";
        });
        await assertFunctionalCollisions(page, `${viewport.name} / noms longs`);
        await assertTextNotClipped(page, ".formation-player", viewport.name);
        await page.getByRole("button", { name: "Mode terrain", exact: true }).click();
        await assertNoHorizontalOverflow(page, viewport);
        await assertFunctionalCollisions(page, `${viewport.name} / mode terrain`);
        await assertTextNotClipped(page, ".formation-player", `${viewport.name} / mode terrain`);
        await page.getByRole("button", { name: "Sortir du mode Terrain", exact: true }).click();
      }
      if (screen === "04 Coach" || screen === "05 BRIEF ÉQUIPE") {
        const selector = screen === "04 Coach" ? ".coach-action-entry" : ".tv-plan-column";
        await page.locator(selector).evaluateAll((nodes) => {
          for (const node of nodes) {
            const text = node.matches(".tv-plan-column") ? node.querySelector(".tv-plan-content, .tv-plan-empty-state") : node;
            if (text) {
              const content = "Consigne de test : vérifier les priorités et les responsabilités avec chaque équipe avant la prochaine opération. ".repeat(8);
              if (text.matches(".tv-plan-empty-state")) {
                const replacement = document.createElement("span");
                replacement.className = "tv-plan-content";
                replacement.textContent = content;
                text.replaceWith(replacement);
              } else text.textContent = content;
            }
          }
        });
        await assertFunctionalCollisions(page, `${viewport.name} / consignes longues`);
        await assertTextNotClipped(page, selector, viewport.name);
        if (screen === "04 Coach") {
          await page.getByRole("button", { name: "Mode briefing", exact: true }).click();
          await assertNoHorizontalOverflow(page, viewport);
          await assertFunctionalCollisions(page, `${viewport.name} / Coach briefing`);
          await assertTextNotClipped(page, selector, `${viewport.name} / Coach briefing`);
          await page.getByRole("button", { name: "Quitter le mode plein écran", exact: true }).click();
        }
      }
      if (viewport.reference) await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-${screen.replace(/[^a-z0-9]/gi, "-")}.png`), fullPage: true });
      if (screen === "05 BRIEF ÉQUIPE") await page.getByRole("button", { name: "Quitter le brief équipe", exact: true }).click();
    }
  }
});

async function assertFunctionalCollisions(page: Page, label: string) {
  const collisions = await page.evaluate(() => {
    const selectors = [
      ".top-bar", ".top-actions", ".time-range-control", ".match-carousel-navigation",
      ".kickoff-header", ".kickoff-header-actions", ".tv-header",
      ".match-ceremony-header", ".match-section-heading", ".awards-heading",
      ".match-indicators-heading", ".match-indicators-navigation",
      ".match-indicator-card:not(.is-mercato)", ".match-score-bubble",
      ".formation-player-copy", ".formation-row", ".formation-rows", ".formation-zone", ".formation-pitch",
      ".composition-layout", ".composition-header", ".coach-decision-header",
      ".coach-section-heading", ".coach-plan-heading", ".coach-action-card",
      ".tv-action-heading", ".tv-plan-grid", ".tv-plan-column", ".match-coach-plan > header",
      ".match-carousel-controls", ".operational-charts-carousel-toolbar",
    ];
    return selectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)].flatMap((parent) => {
      if (!parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return [];
      if (parent.closest(".match-slide-panel:not(.is-active)")) return [];
      const children = [...parent.children].filter((child) => child instanceof HTMLElement && child.getAttribute("aria-hidden") !== "true" && child.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) as HTMLElement[];
      return children.flatMap((child, i) => children.slice(i + 1).flatMap((other) => {
        const a = child.getBoundingClientRect();
        const b = other.getBoundingClientRect();
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return x > 2 && y > 2 ? [`${selector}: ${child.className || child.tagName} / ${other.className || other.tagName} (${Math.round(x)}x${Math.round(y)})`] : [];
      }));
    }));
  });
  expect(collisions, `${label}: collisions fonctionnelles`).toEqual([]);
}

async function assertTextNotClipped(page: Page, selector: string, label: string) {
  const clipped = await page.locator(selector).evaluateAll((parents) => parents.flatMap((parent) => {
    const root = parent as HTMLElement;
    const style = getComputedStyle(root);
    if (/hidden|clip/.test(style.overflowY) && root.scrollHeight > root.clientHeight + 2) return [`${root.className}: contenu vertical masqué`];
    const descendants = [...root.querySelectorAll<HTMLElement>("h3, strong, small, p, .tv-plan-content")];
    return descendants.flatMap((node) => {
      if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return [];
      const box = node.getBoundingClientRect();
      const bounds = root.getBoundingClientRect();
      const hidden = /hidden|clip/.test(style.overflowY);
      return (hidden && (box.bottom > bounds.bottom + 2 || box.top < bounds.top - 2)) || (getComputedStyle(node).display !== "inline" && node.scrollWidth > node.clientWidth + 2)
        ? [node.textContent?.slice(0, 80)] : [];
    });
  }));
  expect(clipped, `${label}: texte rogné dans ${selector}`).toEqual([]);
}

test("recette responsive complète et références visuelles", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-06T08:00:00+02:00"));
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
  await assertFunctionalCollisions(page, `${viewport.name} / Brief ${slideIndex + 1}`);
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
    await expect(carousel.locator(".operational-charts-carousel-counter")).toHaveText(`${index + 1} / 4`);
    await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
    await assertTextNotClipped(page, ".operational-chart-slide.is-active > .performance-chart-panel, .operational-chart-slide.is-active > .loading-quality-card, .operational-chart-slide.is-active > .duel-quality-card", label);
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
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath(`${viewport.name}-${scene}-full.png`), fullPage: !scene.startsWith("brief-") });
  // Keep every comparison strict, but finish the geometry matrix even when
  // an older image differs. Soft failures still fail the test.
  await expect.soft(page).toHaveScreenshot(`${viewport.name}-${scene}.png`, {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.02,
    threshold: 0.2,
  });
}
