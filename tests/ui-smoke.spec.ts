import { expect, Page, test } from "@playwright/test";

const screens = [
  { name: "01-coup-envoi", button: "01 Coup d'envoi", marker: "01 - Coup d'envoi" },
  { name: "02-feuille-match", button: "02 Feuille de match", marker: "02 - Feuille de match" },
  { name: "03-composition", button: "03 Composition", marker: "03 - Composition" },
  { name: "04-coach", button: "04 Coach", marker: "04 - Coach" },
  { name: "05-brief-equipe", button: "05 BRIEF ÉQUIPE", marker: "BRIEF ÉQUIPE" },
];

test("les vues principales restent lisibles sur desktop, tablette et mobile", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.route("**/api/agencies/058/causerie**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ plan: null }),
      });
      return;
    }
    const body = route.request().postDataJSON() as { plan?: Record<string, unknown> };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "PLAN DE JEU TEST", plan: body.plan }),
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("STEF-058");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await expect(page.getByRole("heading", { name: "Agen - 058", exact: true })).toBeVisible();

  for (const screen of screens) {
    await page.getByRole("button", { name: screen.button, exact: true }).click();
    if (screen.name === "05-brief-equipe") {
      await expect(page.locator(".tv-mode")).toHaveCount(1);
      await expect(page.locator(".tv-plan-empty-state")).toHaveCount(3);
      await expect(page.locator(".tv-grid").getByText("OPÉRATIONS", { exact: true })).toHaveCount(0);
      await expect(page.locator(".tv-plan-column")).toHaveCount(3);
      await expect(page.getByText("SAV", { exact: true })).toBeVisible();
      await expect(page.getByText("Expédition", { exact: true })).toBeVisible();
      await expect(page.getByText("Ramasse & emballage", { exact: true })).toBeVisible();
      await expect(page.getByText("Brief à renseigner", { exact: true })).toHaveCount(3);
    } else if ("heading" in screen) {
      await expect(page.getByRole("heading", { name: screen.heading, exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("main").getByText(screen.marker, { exact: true })).toBeVisible();
    }
    if (screen.name === "03-composition") {
      const compositionViewport = await page.evaluate(() => {
        const navigation = document.querySelector<HTMLElement>(".sidebar");
        const header = document.querySelector<HTMLElement>(".composition-header");
        const headerTop = header?.getBoundingClientRect().top ?? -1;
        const navigationBottom = navigation?.getBoundingClientRect().bottom ?? 0;
        return {
          scrollY: window.scrollY,
          noMobileOverlap: window.innerWidth > 900 || headerTop >= navigationBottom - 1,
        };
      });
      expect(compositionViewport.scrollY).toBe(0);
      expect(compositionViewport.noMobileOverlap).toBe(true);
    }
    if (screen.name === "04-coach") {
      await expect(page.locator(".coach-written-plan").getByText("À écrire", { exact: true })).toHaveCount(3);
      await expect(page.locator(".coach-written-plan").getByText("À planifier", { exact: true })).toHaveCount(1);
    }
    if (screen.name === "02-feuille-match") {
      await expect(page.locator(".match-page.is-threshold-reached")).toHaveCount(1);
      await expect(page.getByText("Célébration activée", { exact: true })).toBeVisible();
      await expect(page.locator(".match-score-bubble")).toHaveCount(4);
      const matchBubbleLayout = await page.evaluate(() => {
        const bubbles = Array.from(document.querySelectorAll<HTMLElement>(".match-score-bubble"));
        const sizes = bubbles.map((bubble) => {
          const rect = bubble.getBoundingClientRect();
          return {
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
            overflow: bubble.scrollHeight > bubble.clientHeight + 1,
          };
        });
        return {
          widths: sizes.map(({ width }) => width),
          heights: sizes.map(({ height }) => height),
          // Equal CSS grid tracks can differ by a fraction of a rendered pixel.
          sameWidth: sizes.every(({ width }) => Math.abs(width - sizes[0].width) < 1),
          sameHeight: sizes.every(({ height }) => Math.abs(height - sizes[0].height) < 1),
          overflow: sizes.some(({ overflow }) => overflow),
        };
      });
      expect(matchBubbleLayout.sameWidth).toBe(true);
      expect(matchBubbleLayout.sameHeight).toBe(true);
      expect(matchBubbleLayout.overflow).toBe(false);
      await expect(page.locator(".match-score-bubbles").getByText("% duels gagnés", { exact: true })).toBeVisible();
      await expect(page.getByText("% chargements cadrés", { exact: true })).toBeVisible();
      await expect(page.locator(".loading-score-bubble strong")).toHaveText("94,3%");
      await expect(page.locator(".unloading-score-bubble")).toBeVisible();
      await expect(page.locator(".match-score-bubbles").getByText("% déchargements dans la cible", { exact: true })).toBeVisible();
      await expect(page.locator(".football-score-panel")).toHaveCount(1);
      await expect(page.locator(".football-score-side-for strong")).toHaveText("4");
      await expect(page.locator(".football-score-side-against strong")).toHaveText("0");
      await expect(page.getByText("Indicateurs atteints", { exact: true })).toBeVisible();
      await expect(page.getByText("Indicateurs sous l'objectif", { exact: true })).toBeVisible();
      await expect(page.locator(".match-score-bubbles").getByText("% possession Zody", { exact: true })).toBeVisible();
      await expect(page.locator(".team-motivation-message")).toHaveText("Excellente dynamique. On garde l'intensité jusqu'au bout.");
      await expect(page.locator(".match-result-actions")).toHaveCount(0);
      await expect(page.locator(".match-indicators").getByText("NB DE BLESSURES (A.T)", { exact: true })).toBeVisible();
      await expect(page.locator(".match-indicators").getByText("Duels gagnés", { exact: true })).toHaveCount(0);
      await expect(page.locator(".real-staff-metric").getByText("À renseigner", { exact: true })).toBeVisible();
      await expect(page.locator('[data-indicator="tonnage"] .match-indicator-value')).toHaveText("PDF à importer");
      await page.getByRole("button", { name: "Modifier les chiffres", exact: true }).click();
      await expect(page.getByLabel("Nombre de blessures A.T")).toBeVisible();
      await expect(page.locator(".match-indicators-editor").getByLabel("Effectif prévu du jour")).toBeVisible();
      await page.getByLabel("Nombre de blessures A.T").selectOption("2");
      await page.getByLabel("Effectif prévu du jour").fill("22");
      await page.getByRole("button", { name: "Enregistrer les chiffres", exact: true }).click();
      await expect(page.locator('[data-indicator="injuries"] .match-indicator-value')).toHaveText("2");
      await expect(page.locator(".real-staff-metric strong")).toHaveText(/\d+,\d+%/);
      await expect(page.locator('[data-indicator="tonnage"] .match-indicator-value')).toHaveText("PDF à importer");
      await expect(page.locator(".category-awards .award-card:not(.polyvalent) .award-copy > b")).toHaveCount(0);
      await expect(page.locator(".category-awards .award-card.polyvalent .award-copy > b")).toHaveCount(0);
      const awardOrder = await page.locator(".category-awards .award-card").evaluateAll((cards) => cards.map((card) => card.classList.contains("polyvalent") ? "polyvalent" : ["attack", "defense", "midfield"].find((kind) => card.classList.contains(kind))));
      expect(awardOrder).toEqual(["attack", "defense", "midfield", "polyvalent"]);
      await expect(page.locator(".award-card.polyvalent .award-challenger")).toHaveCount(2);
      await expect(page.locator(".operational-charts-carousel").getByText("Chargements contrôlés", { exact: true })).toBeVisible();
      await expect(page.locator(".loading-duel-quality-card .duel-quality-details summary")).toContainText("Voir les duels");
      await expect(page.locator(".operational-chart-slide")).toHaveCount(3);
      const qualityCarouselLayout = await page.evaluate(() => {
        const viewport = document.querySelector<HTMLElement>(".operational-charts-carousel-viewport");
        const slides = Array.from(document.querySelectorAll<HTMLElement>(".operational-chart-slide"));
        const cards = slides.map((slide) => slide.firstElementChild as HTMLElement | null).filter((card): card is HTMLElement => Boolean(card));
        const widths = slides.map((slide) => slide.offsetWidth);
        const heights = cards.map((card) => card.offsetHeight);
        return {
          slideCount: slides.length,
          sameSlideWidth: widths.every((width) => width === widths[0]),
          sameCardHeight: heights.every((height) => height === heights[0]),
          horizontalOverflow: Boolean(viewport && viewport.scrollWidth > viewport.clientWidth + 1),
        };
      });
      expect(qualityCarouselLayout).toEqual({ slideCount: 3, sameSlideWidth: true, sameCardHeight: true, horizontalOverflow: true });
      await page.getByRole("button", { name: "Graphique suivant", exact: true }).click();
      await expect(page.locator(".operational-charts-carousel-counter")).toHaveText("2 / 3");
      await expect(page.locator(".operational-charts-carousel-dots button.is-active")).toHaveCount(1);
      await expect(page.locator(".loading-duel-quality-card .duel-quality-details summary")).toContainText("Voir les duels");
      await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
      await expect(page.getByRole("button", { name: "Sortir du mode Célébration", exact: true })).toBeVisible();
      const celebrationLayout = await page.evaluate(() => {
        const ceremony = document.querySelector<HTMLElement>(".match-ceremony");
        const kpis = Array.from(document.querySelectorAll<HTMLElement>(".match-indicator-card"));
        return {
          ceremonyMinHeight: ceremony ? getComputedStyle(ceremony).minHeight : "",
          kpiVisible: kpis.every((kpi) => kpi.getBoundingClientRect().height > 0),
          maxKpiHeight: Math.max(...kpis.map((kpi) => kpi.getBoundingClientRect().height)),
        };
      });
      expect(celebrationLayout.ceremonyMinHeight).toBe("auto");
      expect(celebrationLayout.kpiVisible).toBe(true);
      expect(celebrationLayout.maxKpiHeight).toBeLessThanOrEqual(352);
      await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
    }
    if (screen.name === "03-composition") {
      await expect(page.getByRole("button", { name: "Match complet", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "1ère mi-temps", exact: true }).click();
      await expect(page.locator(".composition-scoreboard small")).toContainText("13:00 - 17:45");
      await expect(page.getByText("Vue affichée : 13:00 - 17:45", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "2ème mi-temps", exact: true }).click();
      await expect(page.locator(".composition-scoreboard small")).toContainText("17:45 - 22:30");
      await expect(page.getByText("Vue affichée : 17:45 - 22:30", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "1er quart", exact: true }).click();
      await expect(page.getByText("Vue affichée : 13:00 - 15:22:30", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "4e quart", exact: true }).click();
      await expect(page.getByText("Vue affichée : 20:07:30 - 22:30", { exact: true })).toBeVisible();
      if (await page.evaluate(() => window.innerWidth <= 900)) {
        const compactControls = await page.evaluate(() => {
          const controls = document.querySelector<HTMLElement>(".composition-period-controls");
          const switches = Array.from(document.querySelectorAll<HTMLElement>(".composition-half-switch"));
          return {
            display: controls ? getComputedStyle(controls).display : "",
            switchesScrollable: switches.length === 2 && switches.every((item) => getComputedStyle(item).overflowX === "auto"),
            buttonsStayOnRow: switches.length === 2 && switches.every((item) => getComputedStyle(item).flexWrap === "nowrap"),
          };
        });
        expect(compactControls).toEqual({ display: "grid", switchesScrollable: true, buttonsStayOnRow: true });
      }
      await page.getByLabel("Début de la vue personnalisée").fill("14:00");
      await page.getByLabel("Fin de la vue personnalisée").fill("15:00");
      await page.getByRole("button", { name: "Afficher", exact: true }).click();
      await expect(page.getByText("Vue affichée : 14:00 - 15:00", { exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Début", exact: true })).toHaveValue("13:00");
      await expect(page.getByRole("textbox", { name: "Fin", exact: true })).toHaveValue("22:30");
      await page.getByRole("button", { name: "Mode terrain", exact: true }).click();
      await expect(page.locator(".composition-page.is-field-mode")).toHaveCount(1);
      const fieldLayout = await page.evaluate(() => {
        const header = document.querySelector<HTMLElement>(".composition-page.is-field-mode .composition-header");
        const actions = document.querySelector<HTMLElement>(".composition-page.is-field-mode .composition-header-actions");
        return {
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          headerContained: Boolean(header && header.scrollWidth <= header.clientWidth + 1),
          actionsContained: Boolean(actions && actions.scrollWidth <= actions.clientWidth + 1),
        };
      });
      expect(fieldLayout).toEqual({ pageOverflow: false, headerContained: true, actionsContained: true });
      await page.getByRole("button", { name: "Sortir du mode Terrain", exact: true }).click();
      await page.getByRole("button", { name: "Match complet", exact: true }).click();
    }
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`${screen.name}.png`),
      fullPage: false,
      animations: "disabled",
    });
  }

  await page.getByRole("button", { name: "Quitter le brief équipe", exact: true }).click();
  await page.locator('button[aria-label="? Guide"]').click();
  await expect(page.getByRole("heading", { name: "Utiliser STEF Match Center de A à Z", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "02 Préparer Excel", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "04 Lire les écrans", exact: true }).click();
  await expect(page.getByText(/activité Réception correspond au scan de la palette/)).toBeVisible();
  await page.getByRole("button", { name: "05 Modifier le plan", exact: true }).click();
  await expect(page.getByText("Ajouter une capture d’écran :", { exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
  await expect(page.locator(".tv-mode")).toHaveCount(1);
  await expect(page.locator(".tv-match-ceremony")).toHaveCount(0);
  await expect(page.locator(".tv-key-players")).toHaveCount(0);
  await expect(page.locator(".tv-plan-column")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Mode plein écran", exact: true })).toBeVisible();
  await expect(page.locator(".tv-action-heading").getByText("BRIEF ÉQUIPE", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Écrire", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Écrire", exact: true }).click();
  await expect(page.locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]')).toHaveCount(3);
  await expect(page.getByLabel("SAV, contenu du brief")).toBeVisible();
  await page.getByLabel("SAV, capture d'écran").setInputFiles([
    {
      name: "capture-1.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    },
    {
      name: "capture-2.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    },
  ]);
  await expect(page.getByAltText("Capture du brief SAV 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agrandir la capture SAV 2", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agrandir la capture SAV 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Agrandir la capture SAV 1", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Capture agrandie SAV · capture 1", exact: true })).toBeVisible();
  await expect(page.getByAltText("Capture agrandie du brief SAV")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Capture agrandie SAV · capture 1", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.getByRole("button", { name: "Écrire", exact: true }).click();
  for (const label of ["SAV", "Expédition", "Ramasse & emballage"]) {
    await page.getByLabel(`${label}, contenu du brief`).fill("");
  }
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(".tv-plan-empty-state")).toHaveCount(3);
  await expect(page.getByText("Brief à renseigner", { exact: true })).toHaveCount(3);
  const planLayout = await page.evaluate(() => {
    const columns = Array.from(document.querySelectorAll<HTMLElement>(".tv-plan-column"));
    const minHeight = window.innerWidth <= 900 ? 180 : 220;
    return {
      count: columns.length,
      tallEnough: columns.every((column) => column.clientHeight >= minHeight),
      contained: columns.every((column) => column.scrollWidth <= column.clientWidth + 1),
    };
  });
  expect(planLayout).toEqual({ count: 3, tallEnough: true, contained: true });
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("tv-ecran-quai.png"), fullPage: false, animations: "disabled" });

  await expect(page.getByRole("button", { name: "Mode plein écran", exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("la plage horaire et le graphique horaire restent explicites", async ({ page }) => {
  test.setTimeout(120_000);
  let baseSnapshot: Record<string, any> | null = null;
  await page.route(/\/api\/agencies\/058\/snapshot(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    baseSnapshot = payload.snapshot;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.route("**/api/agencies/058/time-range", async (route) => {
    const request = route.request().postDataJSON() as { start: string; end: string };
    if (!baseSnapshot) throw new Error("Le snapshot de test n'est pas disponible.");
    const snapshot = JSON.parse(JSON.stringify(baseSnapshot)) as Record<string, any>;
    const rangeLabel = `${request.start} - ${request.end}`;
    snapshot.match = {
      ...snapshot.match,
      periodStart: request.start,
      periodEnd: request.end,
      periodLabel: `${request.start}-${request.end}`,
      timeRangeLabel: rangeLabel,
    };
    if (request.start === "13:00" && request.end === "22:30") {
      snapshot.summary = { ...snapshot.summary, passRate: 69.2 };
      snapshot.hourlyPerformance = [
        { hour: 13, won: 99, total: 245, label: "13h", rate: 40.4 },
        { hour: 14, won: 329, total: 467, label: "14h", rate: 70.4 },
        { hour: 15, won: 354, total: 427, label: "15h", rate: 82.9 },
        { hour: 16, won: 263, total: 447, label: "16h", rate: 58.8 },
        { hour: 17, won: 151, total: 288, label: "17h", rate: 52.4 },
        { hour: 18, won: 173, total: 238, label: "18h", rate: 72.7 },
        { hour: 19, won: 172, total: 200, label: "19h", rate: 86 },
        { hour: 20, won: 266, total: 304, label: "20h", rate: 87.5 },
        { hour: 21, won: 237, total: 289, label: "21h", rate: 82 },
        { hour: 22, won: 16, total: 20, label: "22h", rate: 80 },
      ];
    } else if (request.start === "16:00" && request.end === "18:00") {
      snapshot.summary = { ...snapshot.summary, passRate: 59.4 };
      snapshot.hourlyPerformance = [
        { hour: 16, won: 263, total: 447, label: "16h", rate: 58.8 },
        { hour: 17, won: 151, total: 288, label: "17h", rate: 52.4 },
        { hour: 18, won: 6, total: 7, label: "18h", rate: 85.7 },
      ];
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "PLAGE HORAIRE ACTUALISÉE", snapshot }),
    });
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("STEF-058");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await expect(page.getByText("pas de 30 min · fin incluse")).toBeVisible();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await expect(page.locator(".performance-chart-panel")).toBeVisible();
  await expect(page.getByRole("img", { name: "Évolution horaire du pourcentage de passes réussies" })).toBeVisible();
  await expect(page.getByText("Donnée Excel Feuille de match, heure par heure", { exact: true })).toBeVisible();
  await expect(page.locator(".performance-chart-total b")).toHaveText("69,2%");

  await page.locator(".time-range-control input").nth(0).fill("13:00");
  await page.locator(".time-range-control input").nth(1).fill("22:30");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(page.locator(".time-range-control input").nth(0)).toHaveValue("13:00");
  await expect(page.locator(".time-range-control input").nth(1)).toHaveValue("22:30");
  const initialHours = await page.locator(".performance-chart-hour").allTextContents();
  expect(initialHours).not.toContain("00h");
  expect(initialHours).toEqual(["13h", "14h", "16h", "17h", "18h", "19h", "20h", "21h", "22h"]);

  await page.locator(".time-range-control input").nth(0).fill("16:00");
  await page.locator(".time-range-control input").nth(1).fill("18:00");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(page.locator(".time-range-control input").nth(0)).toHaveValue("16:00");
  await expect(page.locator(".time-range-control input").nth(1)).toHaveValue("18:00");
  await expect(page.locator(".performance-chart-hour")).toHaveText(["16h", "17h", "18h"]);
  expect(await page.locator(".performance-chart-hour").allTextContents()).not.toContain("00h");
  await expect(page.locator(".performance-chart-total b")).toHaveText("59,4%");
});

test("le guide et le retour du brief équipe restent accessibles avant le premier import", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("05R");
  await page.getByLabel("Code d'accès").fill("STEF-05R");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await expect(page.getByRole("heading", { name: "Le stade est prêt", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "? Guide", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Utiliser STEF Match Center de A à Z", exact: true })).toBeVisible();
  await page.locator(".guide-nav-item").filter({ hasText: "Administrateur" }).click();
  await expect(page.getByRole("heading", { name: "Régler les ligues et leurs standards", exact: true })).toBeVisible();
  await expect(page.locator(".guide-league-card")).toHaveCount(4);
  expect(await page.locator(".guide-league-card").evaluateAll((cards) => cards.every((card) => card.scrollWidth <= card.clientWidth))).toBe(true);

  await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aucun match importé", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retour au coup d'envoi", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Le stade est prêt", exact: true })).toBeVisible();
});

test("une ligue reste sélectionnable avant le premier import", async ({ page }) => {
  await page.route("**/api/agencies/058/snapshot**", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ title: "AUCUN MATCH IMPORTÉ", message: "Aucun fichier Excel n'a encore été importé pour cette agence." }),
    });
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("STEF-058");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "ADM Administrateur", exact: true }).click();
  await page.getByRole("button", { name: "Activer", exact: true }).last().click();
  await expect(page.locator(".administrator-active-badge strong")).toHaveText("Platine");
  await expect(page.locator(".app-shell")).toHaveClass(/league-platine/);
  await expect(page.getByText("Ligue activée. Importe un match pour appliquer ses objectifs.", { exact: true })).toBeVisible();
});

test("l'administrateur conserve ses règles par agence et synchronise ses animations", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("STEF-058");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "ADM Administrateur", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Centre de pilotage des ligues", exact: true })).toBeVisible();
  await expect(page.locator(".administrator-rule-strip select")).toHaveCount(3);
  await expect(page.locator(".league-card .league-values select")).toHaveCount(12);
  await expect(page.locator(".administrator-rule-strip")).not.toContainText("Position");
  await expect(page.getByLabel("Cible zonage Argent")).toHaveValue("30");
  await expect(page.getByLabel("Modifier chargement Argent")).toHaveValue("00:02:45");
  await expect(page.getByLabel("Temps déchargement Argent")).toHaveValue("00:01:00");
  await expect(page.getByLabel("Modifier déchargement Argent")).toHaveValue("00:01:00");
  await expect(page.getByLabel("Objectif score Argent").first()).toHaveValue("50");
  await page.getByLabel("Cible zonage Argent").selectOption("31");
  await expect(page.getByLabel("Cible zonage Argent")).toHaveValue("31");

  await page.getByRole("button", { name: "Activer", exact: true }).last().click();
  await expect(page.locator(".administrator-active-badge strong")).toHaveText("Platine");
  await expect(page.locator(".app-shell")).toHaveClass(/league-platine/);
  await expect(page.locator(".top-league-badge")).toContainText("Platine");
  const animationState = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".league-card"));
    const reflections = cards.map((card) => getComputedStyle(card, "::after"));
    const valueRows = Array.from(document.querySelectorAll<HTMLElement>(".league-card .league-values"));
    return {
      reflectionDurations: reflections.map((style) => style.animationDuration),
      reflectionDelays: reflections.map((style) => style.animationDelay),
      sceneAnimation: getComputedStyle(document.querySelector<HTMLElement>(".administrator-scene")!, "::after").display,
      sceneBackground: getComputedStyle(document.querySelector<HTMLElement>(".administrator-scene")!).backgroundImage,
      cardOverflow: cards.every((card) => getComputedStyle(card).overflow === "hidden"),
      criteriaRows: valueRows.length === 4 && valueRows.every((row) => getComputedStyle(row).gridTemplateColumns.split(" ").length === 1 && row.querySelectorAll("label").length === 4),
    };
  });
  expect(animationState).toEqual({
    reflectionDurations: ["6.5s", "6.5s", "6.5s", "6.5s"],
    reflectionDelays: ["0s", "0s", "0s", "0s"],
    sceneAnimation: "none",
    sceneBackground: expect.stringContaining("administrator-coach-office.png"),
    cardOverflow: true,
    criteriaRows: true,
  });

  await page.reload();
  await expect(page.locator(".agency-pill")).toContainText("Agen - 058");
  await page.getByRole("button", { name: "ADM Administrateur", exact: true }).click();
  await expect(page.locator(".administrator-page")).toBeVisible();
  await expect(page.getByLabel("Modifier zonage Argent")).toHaveValue("31");
  await expect(page.getByLabel("Modifier chargement Argent")).toHaveValue("00:02:45");
  await expect(page.getByLabel("Temps déchargement Platine")).toHaveValue("00:00:50");
  await expect(page.getByLabel("Modifier déchargement Argent")).toHaveValue("00:01:00");
  await expect(page.locator(".administrator-active-badge strong")).toHaveText("Platine");
  await expect(page.locator(".app-shell")).toHaveClass(/league-platine/);
  await expect(page.locator(".top-league-badge")).toContainText("Platine");

  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await expect(page.locator(".football-score-side-for strong")).toHaveText("1");
  await expect(page.locator(".football-score-side-against strong")).toHaveText("3");
  await expect(page.getByText("Célébration activée", { exact: true })).toHaveCount(0);
});

test("le nom de l'agence connectée reste correct dans tous les onglets", async ({ page }) => {
  test.setTimeout(120_000);
  const agencies = [
    { code: "058", accessCode: "STEF-058", name: "Agen - 058" },
    { code: "01K", accessCode: "STEF-01K", name: "Montpellier" },
    { code: "05R", accessCode: "STEF-05R", name: "Toulouse" },
    { code: "04P", accessCode: "STEF-04P", name: "Bordeaux" },
  ];

  for (const agency of agencies) {
    await page.goto("/");
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.getByLabel("Code agence").selectOption(agency.code);
    await expect(page.getByLabel("Code agence")).toHaveValue(agency.code);
    await page.getByLabel("Code d'accès").fill(agency.accessCode);
    await page.getByRole("button", { name: "Accéder au match" }).click();
    await expect(page.locator(".agency-pill")).toContainText(agency.name);

    for (const screen of screens) {
      await page.getByRole("button", { name: screen.button, exact: true }).click();
      if (screen.name === "05-brief-equipe") {
        if (await page.locator(".tv-mode").count()) {
          await expect(page.getByRole("button", { name: "Quitter le brief équipe", exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Quitter le brief équipe", exact: true }).click();
        } else {
          await expect(page.getByRole("heading", { name: "Aucun match importé", exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Retour au coup d'envoi", exact: true }).click();
        }
      } else {
        await expect(page.locator(".agency-pill")).toContainText(agency.name);
      }
    }
  }
});

test("le brief équipe porte ses zones et son mode plein écran", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("STEF-058");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
  await expect(page.locator(".tv-mode")).toHaveCount(1);
  await expect(page.locator(".tv-match-ceremony")).toHaveCount(0);
  await expect(page.locator(".tv-key-players")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mode plein écran", exact: true })).toBeVisible();
  await expect(page.locator(".tv-action-heading").getByText("BRIEF ÉQUIPE", { exact: true })).toBeVisible();
  await expect(page.locator(".tv-plan-column")).toHaveCount(3);
  await expect(page.getByText("SAV", { exact: true })).toBeVisible();
  await expect(page.getByText("Expédition", { exact: true })).toBeVisible();
  await expect(page.getByText("Ramasse & emballage", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quitter le brief équipe", exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow, `débordement horizontal à ${await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)}`).toBe(false);
}
