import { readFileSync } from "node:fs";
import { expect, Page, test } from "@playwright/test";
import type { Snapshot } from "../src/types";

const screens = [
  { name: "01-coup-envoi", button: "01 Coup d'envoi", marker: "01 - Coup d'envoi" },
  { name: "02-feuille-match", button: "02 Feuille de match", marker: "02 - Feuille de match" },
  { name: "03-composition", button: "03 Composition", marker: "03 - Composition" },
  { name: "04-coach", button: "04 Coach", marker: "04 - Coach" },
  { name: "05-brief-equipe", button: "05 BRIEF ÉQUIPE", marker: "BRIEF ÉQUIPE" },
];

test.afterEach(async ({ page }, testInfo) => {
  if (!testInfo.title.startsWith("l'administrateur conserve ses règles")) return;
  const response = await page.evaluate(async () => {
    const result = await fetch("/api/agencies/058/league-configs", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-access-code": "LOCAL-058-DEV" },
      body: JSON.stringify({ configs: [
        { id: "bronze", zonageMinutes: 45, loadingSeconds: 195, unloadingSeconds: 75, scoreTargetPercent: 45 },
        { id: "argent", zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 },
        { id: "or", zonageMinutes: 25, loadingSeconds: 150, unloadingSeconds: 55, scoreTargetPercent: 60 },
        { id: "platine", zonageMinutes: 20, loadingSeconds: 135, unloadingSeconds: 50, scoreTargetPercent: 70 },
      ] }),
    });
    return { ok: result.ok, status: result.status };
  });
  if (!response.ok) throw new Error(`Impossible de restaurer les paramètres de test (${response.status}).`);
});

test("les vues principales restent lisibles sur desktop, tablette et mobile", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  let savedCauseriePlan: Record<string, unknown> | null = null;
  let stripMercatoProfilesOnNextSave = false;
  const consoleErrors: string[] = [];
  const reactWarnings: string[] = [];
  const pageErrors: string[] = [];
  const mercatoNetworkErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
    if (message.type() === "warning" && /react|each child|unique.*key|hydration/i.test(message.text())) reactWarnings.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (/\/api\/agencies\/058\/causerie|\/assets\/mercato-player-/.test(request.url())) {
      mercatoNetworkErrors.push(`${request.url()}: ${request.failure()?.errorText ?? "requête échouée"}`);
    }
  });
  page.on("response", (response) => {
    if (/\/api\/agencies\/058\/causerie|\/assets\/mercato-player-/.test(response.url()) && !response.ok()) {
      mercatoNetworkErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.route("**/api/agencies/058/snapshot**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    // This scenario explicitly covers the first-import state and must not
    // depend on the developer's persisted local PDF import.
    body.snapshot.dailyIndicators = null;
    body.snapshot.yellowCards = [{ playerName: "Camille Martin", time: "18:42:00", reason: "Chargement à quai", travelCode: "ECHO123" }];
    await route.fulfill({ response, json: body });
  });
  await page.route("**/api/agencies/058/causerie**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ plan: savedCauseriePlan }),
      });
      return;
    }
    const body = route.request().postDataJSON() as { plan?: Record<string, unknown> };
    const requestPlan = body.plan ?? null;
    const responsePlan = stripMercatoProfilesOnNextSave && requestPlan
      ? { ...requestPlan, mercatoProfiles: {} }
      : requestPlan;
    stripMercatoProfilesOnNextSave = false;
    savedCauseriePlan = responsePlan;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "PLAN DE JEU TEST", plan: responsePlan }),
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
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
      await expect(page.getByText("EXPÉDITION / RAMASSE & EMBALLAGE", { exact: true })).toBeVisible();
      await expect(page.getByText("SST", { exact: true })).toBeVisible();
      await expect(page.getByText("Brief à renseigner", { exact: true })).toHaveCount(3);
    } else if (screen.name === "02-feuille-match") {
      await expect(page.locator(".match-ceremony.is-active")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Navigation de la feuille de match" }).locator(".match-carousel-heading > strong")).toHaveText("Coup de sifflet final");
    } else if ("heading" in screen) {
      await expect(page.getByRole("heading", { name: screen.heading, exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("main").getByText(screen.marker, { exact: true })).toBeVisible();
    }
    if (screen.name === "01-coup-envoi") {
      const playButton = page.getByRole("button", { name: "Écouter la musique sur YouTube", exact: true });
      await expect(playButton).toHaveAttribute("aria-expanded", "false");
      await playButton.click();
      const player = page.locator(".kickoff-music-player iframe");
      await expect(player).toBeVisible();
      await expect(player).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/ttjGFkand7s/);
      const playerSize = await player.evaluate((iframe) => {
        const { width, height } = iframe.getBoundingClientRect();
        return { width, height };
      });
      expect(playerSize.width).toBeGreaterThanOrEqual(200);
      expect(playerSize.height).toBeGreaterThanOrEqual(200);
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".match-ceremony.is-active")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Navigation de la feuille de match" }).locator(".match-carousel-heading > strong")).toHaveText("Coup de sifflet final");
      await expect(player).toBeVisible();
    }
    if (screen.name === "02-feuille-match") {
      const player = page.locator(".kickoff-music-player iframe");
      await expect(player).toBeVisible();
      await expect(page.locator(".yellow-cards-panel .yellow-cards-heading strong")).toHaveText("1");
      await expect(page.locator(".red-cards-panel")).toHaveCount(0);
      await expect(page.locator(".yellow-cards-disclosure")).not.toHaveAttribute("open", "");
      await page.locator(".yellow-cards-disclosure summary").click();
      await expect(page.locator(".yellow-cards-disclosure")).toHaveAttribute("open", "");
      await expect(page.locator(".yellow-cards-disclosure")).toContainText("Camille Martin");
      const closeButton = page.getByRole("button", { name: "Fermer le lecteur YouTube", exact: true });
      await expect(closeButton).toHaveAttribute("aria-expanded", "true");
      await closeButton.click();
      await expect(player).toHaveCount(0);
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
      await expect(page.getByRole("heading", { name: "Plan d'action du jour", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Les repères du jour", exact: true })).toBeVisible();
      await expect(page.locator(".coach-context-list div")).toHaveCount(4);
      await expect(page.getByText("La feuille de match détaille les indicateurs.", { exact: false })).toBeVisible();
      await expect(page.locator(".coach-actions-grid .coach-action-card")).toHaveCount(3);
      await expect(page.locator(".coach-discipline-panel")).toBeVisible();
      await expect(page.getByText("Cartons jaunes", { exact: true })).toBeVisible();
      await expect(page.locator(".coach-yellow-list")).toContainText("Camille Martin");
      await expect(page.locator(".coach-yellow-list")).toContainText("18:42:00 · Chargement à quai · ECHO123");
      await expect(page.getByText("Cartons rouges", { exact: true })).toBeVisible();
      await expect(page.getByText("Aucun carton rouge saisi manuellement.", { exact: true })).toBeVisible();
      await expect(page.getByText("Ligue active", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Mode briefing", exact: true })).toBeVisible();
      await expect(page.locator(".coach-action-entry.is-empty")).toHaveCount(3);
      await expect(page.getByText("À planifier", { exact: true })).toHaveCount(1);
      await page.getByRole("button", { name: "Écrire", exact: true }).click();
      await expect(page.locator(".coach-action-input textarea")).toHaveCount(3);
      await expect(page.getByLabel("Nouvel arrivant du mercato")).toHaveCount(0);
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await expect(page.getByLabel("Nouvel arrivant du mercato")).toBeVisible();
      await expect(page.getByLabel("Priorité terrain, consigne du chef de quai")).toBeVisible();
      await page.getByLabel("Priorité terrain, consigne du chef de quai").fill("Sécuriser les positions prioritaires.");
      await page.getByLabel("Zone à surveiller, consigne du chef de quai").fill("Suivre le voyage critique.");
      await page.getByLabel("Équilibre d'équipe, consigne du chef de quai").fill("Renforcer la ligne en tension.");
      await page.getByLabel("Nouvel arrivant du mercato").fill("Accueillir Camille Martin, nouveau renfort de l'équipe.");
      await expect(page.getByRole("button", { name: "Femme pour Camille Martin" })).toHaveAttribute("aria-pressed", "false");
      await page.getByRole("button", { name: "Femme pour Camille Martin" }).click();
      await expect(page.getByRole("button", { name: "Femme pour Camille Martin" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Femme pour Camille Martin" }).click();
      await expect(page.getByRole("button", { name: "Femme pour Camille Martin" })).toHaveAttribute("aria-pressed", "true");
      expect(savedCauseriePlan).toBeNull();
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await expect.poll(() => savedCauseriePlan?.mercatoProfiles).toEqual({ "camille martin": "female" });
      await expect(page.getByRole("status")).toContainText("Mercato enregistré");
      await page.getByLabel("Prochaine revue du plan").fill("18:30");
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await expect(page.locator(".coach-action-entry").nth(0)).toHaveText("Sécuriser les positions prioritaires.");
      await expect(page.locator(".coach-action-entry").nth(1)).toHaveText("Suivre le voyage critique.");
      await expect(page.locator(".coach-action-entry").nth(2)).toHaveText("Renforcer la ligne en tension.");
      await expect(page.locator(".coach-mercato-entry")).toHaveText("Accueillir Camille Martin, nouveau renfort de l'équipe.");
      expect(savedCauseriePlan?.mercatoProfiles).toEqual({ "camille martin": "female" });
      await expect(page.locator(".coach-review-line strong")).toHaveText("18:30");
      await page.getByRole("button", { name: "Saisir", exact: true }).click();
      await page.getByLabel("Cartons rouges manuels").fill("Camille Martin · 18:42 · règle SST");
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await expect(page.locator(".coach-red-list")).toContainText("Camille Martin · 18:42 · règle SST");
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".red-cards-panel")).toBeVisible();
      await expect(page.locator(".red-cards-heading strong")).toHaveText("1");
      await page.locator(".red-cards-disclosure summary").click();
      await expect(page.locator(".red-cards-disclosure")).toContainText("Camille Martin · 18:42 · règle SST");
      const disciplineLayout = await page.locator(".yellow-cards-panel").evaluate((element) => {
        const yellow = element.querySelector(".yellow-cards-content")!.getBoundingClientRect();
        const red = element.querySelector(".red-cards-panel")!.getBoundingClientRect();
        return { sameRow: Math.abs(yellow.top - red.top) < 1, separated: red.left >= yellow.right };
      });
      expect(disciplineLayout).toEqual({ sameRow: true, separated: true });
      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Saisir", exact: true }).click();
      await page.getByLabel("Cartons rouges manuels").fill("   ");
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".red-cards-panel")).toHaveCount(0);
      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Saisir", exact: true }).click();
      await page.getByLabel("Cartons rouges manuels").fill("Camille Martin · 18:42 · règle SST");
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      const coachFieldsBeforeProfileUpdate = {
        attack: savedCauseriePlan?.attack,
        midfield: savedCauseriePlan?.midfield,
        defense: savedCauseriePlan?.defense,
        attachments: savedCauseriePlan?.attachments,
        coach: savedCauseriePlan?.coach,
        redCards: savedCauseriePlan?.redCards,
      };
      const coachLayout = await page.evaluate(() => {
        const pageElement = document.querySelector<HTMLElement>(".coach-decision-page");
        const contextRows = Array.from(document.querySelectorAll<HTMLElement>(".coach-context-list div"));
        return {
          noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
          contextRowsVisible: contextRows.length === 4 && contextRows.every((row) => row.getBoundingClientRect().height > 0),
          sceneContained: Boolean(pageElement && pageElement.scrollWidth <= pageElement.clientWidth + 1),
        };
      });
      expect(coachLayout).toEqual({ noHorizontalOverflow: true, contextRowsVisible: true, sceneContained: true });
      await page.reload();
      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await expect(page.getByLabel("Nouvel arrivant du mercato")).toHaveCount(0);
      await expect(page.locator(".coach-mercato-entry")).toHaveText("Accueillir Camille Martin, nouveau renfort de l'équipe.");
      await expect(page.locator(".coach-red-list")).toContainText("Camille Martin · 18:42 · règle SST");
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await expect(page.getByRole("button", { name: "Femme pour Camille Martin" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Homme pour Camille Martin" }).click();
      await expect(page.getByRole("button", { name: "Homme pour Camille Martin" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Annuler la modification du Mercato" }).click();
      expect(savedCauseriePlan?.mercatoProfiles).toEqual({ "camille martin": "female" });

      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-carousel-card")).toHaveCount(1);
      await expect(page.locator(".match-indicators-track > .match-indicator-slide")).toHaveCount(9);
      await expect(page.locator(".match-indicators-track > .match-indicator-slide").first()).toHaveAttribute("data-indicator", "mercato");
      await expect(page.locator(".match-indicators-navigation > span")).toHaveText(/\/ 9$/);
      await expect(page.locator(".mercato-kpi-slide")).toHaveCount(1);
      await expect(page.locator(".mercato-kpi-subtitle")).toHaveText("Nouveau joueur");
      await expect(page.locator(".mercato-kpi-navigation")).toHaveCount(0);
      await expect(page.locator(".mercato-kpi-flocage-index")).toHaveCount(0);
      await expect(page.locator(".mercato-kpi-flocage")).toHaveText("CAMILLE MARTIN");
      await expect(page.locator(".mercato-kpi-flocage")).toHaveAttribute("aria-label", "Flocage : Camille Martin");
      await expect(page.locator(".mercato-kpi-photo")).toHaveAttribute("data-profile", "female");
      await expect(page.locator(".mercato-kpi-photo")).toHaveAttribute("src", "/assets/mercato-player-female.jpg");
      await expect(page.locator(".mercato-kpi-slide")).not.toContainText("Accueillir Camille Martin");
      await expect.poll(() => page.locator(".mercato-kpi-photo").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      await page.locator(".mercato-carousel-card").screenshot({ path: testInfo.outputPath("mercato-un-joueur.png"), animations: "disabled" });
      const outerCounter = page.locator(".match-indicators-navigation > span");
      const outerCounterBefore = await outerCounter.innerText();
      await page.getByRole("button", { name: "Indicateurs suivants" }).click();
      await expect(outerCounter).not.toHaveText(outerCounterBefore);

      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByRole("button", { name: "Homme pour Camille Martin" }).click();
      stripMercatoProfilesOnNextSave = true;
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await expect(page.locator(".coach-mercato-profile-feedback")).toContainText("Le serveur n'a pas conservé les choix Femme/Homme");
      expect(savedCauseriePlan?.mercatoProfiles).toEqual({});
      await expect(page.getByRole("button", { name: "Homme pour Camille Martin" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await expect.poll(() => savedCauseriePlan?.mercatoProfiles).toEqual({ "camille martin": "male" });
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-photo")).toHaveAttribute("data-profile", "male");
      await expect(page.locator(".mercato-kpi-photo")).toHaveAttribute("src", "/assets/mercato-player-male.jpg");
      await page.reload();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-photo")).toHaveAttribute("data-profile", "male");
      await expect(page.locator(".mercato-kpi-photo")).toHaveAttribute("src", "/assets/mercato-player-male.jpg");
      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByRole("button", { name: "Femme pour Camille Martin" }).click();
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await expect.poll(() => savedCauseriePlan?.mercatoProfiles).toEqual({ "camille martin": "female" });
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-photo")).toHaveAttribute("data-profile", "female");
      await expect(page.locator(".mercato-kpi-photo")).toHaveAttribute("src", "/assets/mercato-player-female.jpg");

      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByLabel("Nouvel arrivant du mercato").fill("Accueillir Camille Martin, nouveau renfort de l'équipe.\nAccueillir Julien Thomas, nouveau joueur de l'équipe.");
      await expect(page.getByRole("button", { name: "Femme pour Camille Martin" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Homme pour Julien Thomas" })).toHaveAttribute("aria-pressed", "false");
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await expect(page.locator(".coach-mercato-profile-feedback")).toContainText("1 profil à choisir");
      expect(savedCauseriePlan?.mercato).toBe("Accueillir Camille Martin, nouveau renfort de l'équipe.");
      await page.getByRole("button", { name: "Homme pour Julien Thomas" }).click();
      await expect(page.getByRole("button", { name: "Homme pour Julien Thomas" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-slide")).toHaveCount(2);
      await expect(page.locator(".mercato-kpi-subtitle")).toHaveText(["Nouveaux joueurs", "Nouveaux joueurs"]);
      await expect(page.locator(".mercato-kpi-navigation button")).toHaveCount(2);
      await page.locator(".mercato-kpi-viewport").focus();
      const outerPositionBeforeKeyboard = await page.locator(".match-indicators-viewport").evaluate((element: HTMLElement) => element.scrollLeft);
      await page.keyboard.press("ArrowRight");
      await expect(page.locator(".mercato-kpi-navigation > span")).toHaveText("2 / 2");
      await page.keyboard.press("ArrowLeft");
      await expect(page.locator(".mercato-kpi-navigation > span")).toHaveText("1 / 2");
      const outerPositionAfterKeyboard = await page.locator(".match-indicators-viewport").evaluate((element: HTMLElement) => element.scrollLeft);
      expect(Math.abs(outerPositionAfterKeyboard - outerPositionBeforeKeyboard)).toBeLessThanOrEqual(2);
      await expect(page.locator(".mercato-kpi-photo").nth(0)).toHaveAttribute("data-profile", "female");
      await expect(page.locator(".mercato-kpi-photo").nth(0)).toHaveAttribute("src", "/assets/mercato-player-female.jpg");
      await page.getByRole("button", { name: "Joueur suivant dans le Mercato", exact: true }).click();
      await expect(page.locator(".mercato-kpi-navigation > span")).toHaveText("2 / 2");
      await expect(page.locator(".mercato-kpi-slide").nth(1)).toHaveAttribute("aria-hidden", "false");
      await expect(page.locator(".mercato-kpi-photo").nth(1)).toHaveAttribute("data-profile", "male");
      await expect(page.locator(".mercato-kpi-photo").nth(1)).toHaveAttribute("src", "/assets/mercato-player-male.jpg");
      await expect.poll(() => page.locator(".mercato-kpi-photo").nth(1).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByRole("button", { name: "Homme pour Camille Martin" }).click();
      await page.getByRole("button", { name: "Homme pour Julien Thomas" }).click();
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await expect.poll(() => savedCauseriePlan?.mercatoProfiles).toEqual({ "camille martin": "male", "julien thomas": "male" });
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-photo").evaluateAll((images) => images.map((image) => image.getAttribute("data-profile")))).resolves.toEqual(["male", "male"]);
      await expect(page.locator(".mercato-kpi-photo").evaluateAll((images) => images.map((image) => new URL((image as HTMLImageElement).src).pathname))).resolves.toEqual(["/assets/mercato-player-male.jpg", "/assets/mercato-player-male.jpg"]);
      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByRole("button", { name: "Femme pour Camille Martin" }).click();
      await page.getByRole("button", { name: "Femme pour Julien Thomas" }).click();
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await expect.poll(() => savedCauseriePlan?.mercatoProfiles).toEqual({ "camille martin": "female", "julien thomas": "female" });
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-photo").evaluateAll((images) => images.map((image) => image.getAttribute("data-profile")))).resolves.toEqual(["female", "female"]);
      await expect(page.locator(".mercato-kpi-photo").evaluateAll((images) => images.map((image) => new URL((image as HTMLImageElement).src).pathname))).resolves.toEqual(["/assets/mercato-player-female.jpg", "/assets/mercato-player-female.jpg"]);
      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByRole("button", { name: "Femme pour Camille Martin" }).click();
      await page.getByRole("button", { name: "Homme pour Julien Thomas" }).click();
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await expect.poll(() => savedCauseriePlan?.mercatoProfiles).toEqual({ "camille martin": "female", "julien thomas": "male" });
      expect(savedCauseriePlan?.mercatoProfiles).toEqual({ "camille martin": "female", "julien thomas": "male" });
      expect(savedCauseriePlan?.redCards).toBe("Camille Martin · 18:42 · règle SST");
      expect(savedCauseriePlan?.coach).toEqual(expect.objectContaining({ tactic: expect.any(String) }));

      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await page.getByRole("button", { name: "Joueur suivant dans le Mercato", exact: true }).click();
      await expect(page.locator(".mercato-kpi-photo").nth(1)).toHaveAttribute("data-profile", "male");
      await expect(page.locator(".mercato-kpi-photo").nth(1)).toHaveAttribute("src", "/assets/mercato-player-male.jpg");
      await expect.poll(() => page.locator(".mercato-kpi-photo").nth(1).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      expect(savedCauseriePlan).toEqual(expect.objectContaining(coachFieldsBeforeProfileUpdate));
      await page.waitForFunction(() => {
        const viewport = document.querySelector<HTMLElement>(".mercato-kpi-viewport");
        return Boolean(viewport && viewport.scrollLeft >= viewport.clientWidth - 2);
      });
      const mercatoLayout = await page.evaluate(() => ({
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        cardContained: (() => {
          const card = document.querySelector<HTMLElement>(".mercato-carousel-card");
          return Boolean(card && card.scrollWidth <= card.clientWidth + 1 && card.scrollHeight <= card.clientHeight + 1);
        })(),
      }));
      expect(mercatoLayout).toEqual({ noHorizontalOverflow: true, cardContained: true });
      await page.locator(".mercato-carousel-card").screenshot({ path: testInfo.outputPath("mercato-plusieurs-joueurs.png"), animations: "disabled" });

      savedCauseriePlan = { ...savedCauseriePlan!, mercatoProfiles: {} };
      await page.reload();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-profile-needed")).toHaveCount(2);
      await expect(page.locator(".mercato-kpi-photo, .mercato-kpi-flocage")).toHaveCount(0);
      await expect(page.getByText("Choisir Femme ou Homme dans Coach pour afficher la photo.", { exact: true })).toHaveCount(2);

      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await expect(page.locator(".coach-mercato-profile-feedback")).toContainText("Camille Martin, Julien Thomas");
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByLabel("Nouvel arrivant du mercato").fill("Jean Dupont et Marie Martin rejoignent l'équipe.");
      await page.getByRole("button", { name: "Homme pour Jean Dupont" }).click();
      await page.getByRole("button", { name: "Femme pour Marie Martin" }).click();
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-slide")).toHaveCount(2);
      await expect(page.locator(".mercato-kpi-flocage").allTextContents()).resolves.toEqual(["JEAN DUPONT", "MARIE MARTIN"]);
      await expect(page.locator(".mercato-carousel-card h3")).toHaveCount(0);

      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByLabel("Nouvel arrivant du mercato").fill("Jean Dupont, Marie Martin, Alex Renaud\nJean Dupont");
      await page.getByRole("button", { name: "Homme pour Jean Dupont" }).click();
      await page.getByRole("button", { name: "Femme pour Marie Martin" }).click();
      await page.getByRole("button", { name: "Homme pour Alex Renaud" }).click();
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-slide")).toHaveCount(3);
      await expect(page.locator(".mercato-kpi-subtitle")).toHaveText(["Nouveaux joueurs", "Nouveaux joueurs", "Nouveaux joueurs"]);
      await expect(page.locator(".mercato-kpi-flocage").allTextContents()).resolves.toEqual(["JEAN DUPONT", "MARIE MARTIN", "ALEX RENAUD"]);
      await page.getByRole("button", { name: "Joueur suivant dans le Mercato", exact: true }).click();
      await page.getByRole("button", { name: "Joueur suivant dans le Mercato", exact: true }).click();
      await expect(page.locator(".mercato-kpi-navigation > span")).toHaveText("3 / 3");
      await expect(page.locator(".mercato-kpi-slide").nth(2)).toHaveAttribute("aria-hidden", "false");

      const longNames = "Jean-Baptiste Martin, Marie-Anne O'Connor, Alexandre Jean-Pierre de la Fontaine";
      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByLabel("Nouvel arrivant du mercato").fill(longNames);
      await page.getByRole("button", { name: "Homme pour Jean-Baptiste Martin" }).click();
      await page.getByRole("button", { name: "Femme pour Marie-Anne O'Connor" }).click();
      await page.getByRole("button", { name: "Homme pour Alexandre Jean-Pierre de la Fontaine" }).click();
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-slide")).toHaveCount(3);
      await expect(page.locator(".mercato-kpi-flocage").allTextContents()).resolves.toEqual([
        "JEAN-BAPTISTE MARTIN",
        "MARIE-ANNE O'CONNOR",
        "ALEXANDRE JEAN-PIERRE DE LA FONTAINE",
      ]);
      const flocageFontSizes = await page.locator(".mercato-kpi-flocage > text").evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("font-size"))));
      expect(flocageFontSizes.every((size) => Number.isFinite(size) && size >= 6)).toBe(true);
      expect(flocageFontSizes[2]).toBeLessThan(flocageFontSizes[0]);
      const longNameLayout = await page.locator(".mercato-carousel-card").evaluateAll((cards) => cards.every((card) => {
        const element = card as HTMLElement;
        return element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1;
      }));
      expect(longNameLayout).toBe(true);

      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByLabel("Nouvel arrivant du mercato").fill("Zoé Martin");
      await page.getByRole("button", { name: "Femme pour Zoé Martin" }).click();
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-slide")).toHaveCount(1);
      await expect(page.locator(".mercato-kpi-flocage")).toHaveText("ZOÉ MARTIN");
      await expect(page.locator(".mercato-kpi-navigation")).toHaveCount(0);

      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByLabel("Nouvel arrivant du mercato").fill("Zoé Durand");
      await page.getByRole("button", { name: "Femme pour Zoé Durand" }).click();
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-flocage")).toHaveText("ZOÉ DURAND");
      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByLabel("Nouvel arrivant du mercato").fill("Emma Durand");
      await page.getByRole("button", { name: "Femme pour Emma Durand" }).click();
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-flocage")).toHaveText("EMMA DURAND");

      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByLabel("Nouvel arrivant du mercato").fill("");
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator('[data-indicator="mercato"]')).toHaveCount(0);
      await expect(page.locator(".match-indicators-track > .match-indicator-slide")).toHaveCount(8);
      await expect(page.locator(".match-kpi-wrap")).toBeVisible();

      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await page.getByRole("button", { name: "Écrire le Mercato" }).click();
      await page.getByLabel("Nouvel arrivant du mercato").fill("Manon Petit\nSamuel Leclerc");
      await page.getByRole("button", { name: "Femme pour Manon Petit" }).click();
      await page.getByRole("button", { name: "Homme pour Samuel Leclerc" }).click();
      await page.getByRole("button", { name: "Enregistrer le Mercato" }).click();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-slide")).toHaveCount(2);
      await page.reload();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await expect(page.locator(".mercato-kpi-slide")).toHaveCount(2);
      await expect(page.locator(".mercato-kpi-flocage").allTextContents()).resolves.toEqual(["MANON PETIT", "SAMUEL LECLERC"]);
      await expect(page.locator(".mercato-kpi-photo").evaluateAll((images) => images.map((image) => image.getAttribute("data-profile")))).resolves.toEqual(["female", "male"]);

      if (testInfo.project.name === "mobile") {
        await page.locator(".mercato-kpi-viewport").scrollIntoViewIfNeeded();
        const outerScrollBefore = await page.locator(".match-indicators-viewport").evaluate((element: HTMLElement) => element.scrollLeft);
        const bounds = await page.locator(".mercato-kpi-viewport").boundingBox();
        expect(bounds).not.toBeNull();
        const client = await page.context().newCDPSession(page);
        const startX = Math.round(bounds!.x + bounds!.width * 0.86);
        const endX = Math.round(bounds!.x + bounds!.width * 0.14);
        const y = Math.round(bounds!.y + bounds!.height * 0.5);
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: startX, y }] });
        await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: Math.round((startX + endX) / 2), y }] });
        await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: endX, y }] });
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect(page.locator(".mercato-kpi-navigation > span")).toHaveText("2 / 2");
        const outerScrollAfter = await page.locator(".match-indicators-viewport").evaluate((element: HTMLElement) => element.scrollLeft);
        expect(Math.abs(outerScrollAfter - outerScrollBefore)).toBeLessThanOrEqual(2);
        await client.detach();
      }

      if (testInfo.project.name === "desktop") {
        for (const viewport of [
          { width: 1920, height: 1080 },
          { width: 1366, height: 768 },
          { width: 1024, height: 768 },
          { width: 390, height: 844 },
        ]) {
          await page.setViewportSize(viewport);
          const responsiveLayout = await page.evaluate(() => {
            const card = document.querySelector<HTMLElement>(".mercato-carousel-card");
            const viewportElement = document.querySelector<HTMLElement>(".mercato-kpi-viewport");
            return {
              documentFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
              cardFits: Boolean(card && card.scrollWidth <= card.clientWidth + 1 && card.scrollHeight <= card.clientHeight + 1),
              carouselFits: Boolean(viewportElement && viewportElement.clientWidth > 0),
              cardFitsSection: Boolean(card && card.parentElement && Math.abs(card.getBoundingClientRect().width - card.parentElement.getBoundingClientRect().width) < 1),
            };
          });
          expect(responsiveLayout).toEqual({ documentFits: true, cardFits: true, carouselFits: true, cardFitsSection: true });
        }
      }

      const projectViewport = testInfo.project.name === "desktop"
        ? { width: 1536, height: 1024 }
        : testInfo.project.name === "tablet"
          ? { width: 1024, height: 768 }
          : { width: 390, height: 844 };
      await page.setViewportSize(projectViewport);
      await page.getByRole("button", { name: "04 Coach", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Plan d'action du jour", exact: true })).toBeVisible();

      expect(consoleErrors).toEqual([]);
      expect(reactWarnings).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(mercatoNetworkErrors).toEqual([]);
    }
    if (screen.name === "02-feuille-match") {
      await expect(page.locator('[data-indicator="mercato"]')).toHaveCount(0);
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
      await expect(page.locator(".match-score-bubbles").getByText("% passes réussies", { exact: true })).toBeVisible();
      await expect(page.locator(".match-score-bubble.pass-score-bubble strong")).toHaveText("69,2%");
      await expect(page.locator(".match-score-bubbles").getByText("% tirs cadrés", { exact: true })).toBeVisible();
      await expect(page.locator(".loading-score-bubble")).toContainText("Voyages chargés en 2 min 45 ou moins par position");
      await expect(page.locator(".loading-score-bubble strong")).toHaveText("94,3%");
      await expect(page.locator(".football-score-panel")).toHaveCount(1);
      await expect(page.locator(".football-score-side-for strong")).toHaveText("4");
      await expect(page.locator(".football-score-side-against strong")).toHaveText("0");
      await expect(page.getByLabel("KPI intégrés au score")).toContainText("% duels gagnés");
      await expect(page.getByText("Indicateurs atteints", { exact: true })).toBeVisible();
      await expect(page.getByText("Indicateurs sous l'objectif", { exact: true })).toBeVisible();
      await expect(page.locator(".match-score-bubbles").getByText("% possession", { exact: true })).toBeVisible();
      await expect(page.locator(".match-score-bubbles").getByText("% duels gagnés", { exact: true })).toBeVisible();
      const matchCarouselNavigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
      await matchCarouselNavigation.getByRole("button", { name: "Aller à Statistiques du match" }).click();
      await expect(matchCarouselNavigation.locator(".match-carousel-count")).toHaveText("03 / 04");
      await page.locator(".operational-charts-carousel-dots").getByRole("tab", { name: "Afficher % duels gagnés" }).click();
      await expect(page.locator(".operational-charts-carousel-counter")).toHaveText("2 / 4");
      await expect(page.locator(".operational-charts-carousel").getByText("% Duels gagnés", { exact: true })).toBeVisible();
      await page.locator(".operational-charts-carousel-dots").getByRole("tab", { name: "Afficher % tirs cadrés" }).click();
      await expect(page.locator(".operational-charts-carousel-counter")).toHaveText("3 / 4");
      await expect(page.locator(".operational-charts-carousel").getByText("% tirs cadrés", { exact: true })).toBeVisible();
      await expect(page.locator(".loading-duel-quality-card .duel-quality-details summary")).toContainText("Voir les duels perdus");
      await expect(page.locator(".operational-chart-slide")).toHaveCount(4);
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
      expect(qualityCarouselLayout).toEqual({ slideCount: 4, sameSlideWidth: true, sameCardHeight: true, horizontalOverflow: true });
      await page.getByRole("button", { name: "Graphique précédent", exact: true }).click();
      await expect(page.locator(".operational-charts-carousel-counter")).toHaveText("2 / 4");
      await expect(page.locator(".operational-charts-carousel-dots button.is-active")).toHaveCount(1);
      await expect(page.locator(".loading-duel-quality-card .duel-quality-details summary")).toContainText("Voir les duels perdus");
      await matchCarouselNavigation.getByRole("button", { name: "Aller à Coup de sifflet final" }).click();
      await expect(matchCarouselNavigation.locator(".match-carousel-count")).toHaveText("01 / 04");
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
      await expect(page.locator(".category-awards .award-copy > small")).toHaveCount(0);
      await expect(page.locator(".category-awards")).not.toContainText("Meilleur(e)");
      const awardOrder = await page.locator(".category-awards .award-card").evaluateAll((cards) => cards.map((card) => card.classList.contains("polyvalent") ? "polyvalent" : ["attack", "defense", "midfield"].find((kind) => card.classList.contains(kind))));
      expect(awardOrder).toEqual(["attack", "defense", "midfield", "polyvalent"]);
      await expect(page.locator(".category-awards .award-leader-score")).toHaveCount(4);
      await expect(page.locator(".award-card.attack .award-leader-score b")).toHaveText("239");
      await expect(page.locator(".award-card.attack .award-leader-score small")).toHaveText("positions CHG");
      await expect(page.locator(".award-card.attack .award-copy > i")).toHaveText("Meilleur buteur");
      await expect(page.locator(".award-card.attack .award-copy > strong")).toHaveText("JEAN LUC LASSORT");
      await expect(page.locator(".award-card.midfield:not(.polyvalent) .award-leader-score b")).toHaveText("236");
      await expect(page.locator(".award-card.midfield:not(.polyvalent) .award-leader-score small")).toHaveText("positions ZONAGE");
      await expect(page.locator(".award-card.midfield:not(.polyvalent) .award-copy > i")).toHaveText("Meilleur passeur");
      await expect(page.locator(".award-card.midfield:not(.polyvalent) .award-copy > strong")).toHaveText("MORGAN JOUY");
      await expect(page.locator(".award-card.defense .award-copy > i")).toHaveText("Meilleur défenseur");
      await expect(page.locator(".award-card.polyvalent .award-copy > i")).toHaveText("Meilleur polyvalent");
      await expect(page.locator(".award-card.defense .award-copy > strong")).toHaveText("SYLVIE JACQUIER");
      await expect(page.locator(".award-card.polyvalent .award-leader-score b")).toHaveText(/\d+%/);
      await expect(page.locator(".award-card.polyvalent .award-leader-score small")).toHaveText("polyvalence");
      await expect(page.locator(".award-card.polyvalent .award-copy strong")).toHaveText("JÉRÔME COLOMBI");
      await expect(page.locator(".award-card.polyvalent .award-leader-score b")).toHaveText("31%");
      await expect(page.locator(".award-card.polyvalent .award-challenger")).toHaveCount(2);
      await expect(page.locator(".award-card.midfield .award-challenger").first()).toContainText("227 poz · -9 avec le premier");
      for (const kind of ["attack", "midfield", "defense"]) {
        const card = page.locator(`.award-card.${kind}:not(.polyvalent)`);
        const leaderPositions = Number((await card.locator(".award-leader-score b").textContent() ?? "").replace(/\D/g, ""));
        const challengerPositions = (await card.locator(".award-challenger small").allTextContents()).map((text) => Number(text.split(" poz")[0].replace(/\D/g, "")));
        expect(challengerPositions.every((positions) => positions <= leaderPositions), JSON.stringify({ kind, leaderPositions, challengerPositions })).toBe(true);
        expect(challengerPositions).toEqual([...challengerPositions].sort((a, b) => b - a));
      }
      await expect(page.locator(".award-card.polyvalent .award-challenger").first()).toContainText("% polyvalence");
      await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
      await expect(page.getByRole("button", { name: "Sortir du mode Célébration", exact: true })).toBeVisible();
      const celebrationLayout = await page.evaluate(() => {
        const ceremony = document.querySelector<HTMLElement>(".match-ceremony");
        const kpis = Array.from(document.querySelectorAll<HTMLElement>(".match-indicator-card"));
        const score = document.querySelector<HTMLElement>(".match-page.is-celebration-mode .football-score-panel");
        const kpiBubble = document.querySelector<HTMLElement>(".match-page.is-celebration-mode .match-score-bubble");
        return {
          ceremonyMinHeight: ceremony ? getComputedStyle(ceremony).minHeight : "",
          kpiVisible: kpis.every((kpi) => kpi.getBoundingClientRect().height > 0),
          maxKpiHeight: Math.max(...kpis.map((kpi) => kpi.getBoundingClientRect().height)),
          scoreWidth: score ? Math.round(score.getBoundingClientRect().width) : 0,
          kpiBorderAnimation: kpiBubble ? getComputedStyle(kpiBubble).animationName : "",
        };
      });
      // Browsers resolve min-height:auto to 0px in getComputedStyle().
      expect(celebrationLayout.ceremonyMinHeight).toBe("0px");
      expect(celebrationLayout.kpiVisible).toBe(true);
      expect(celebrationLayout.maxKpiHeight).toBeLessThanOrEqual(352);
      if (screen.name === "desktop" || screen.name === "tablet") {
        expect(celebrationLayout.scoreWidth).toBeGreaterThanOrEqual(300);
      }
      const reducedMotion = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      if (reducedMotion) {
        expect(celebrationLayout.kpiBorderAnimation).toBe("none");
      } else {
        expect(celebrationLayout.kpiBorderAnimation).toContain("match-kpi-border-pulse");
      }
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
      await page.getByLabel("Début de la vue personnalisée").selectOption("14:00");
      await page.getByLabel("Fin de la vue personnalisée").selectOption("15:00");
      await page.getByRole("button", { name: "Afficher", exact: true }).click();
      await expect(page.getByText("Vue affichée : 14:00 - 15:00", { exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Début", exact: true })).toHaveValue("13:00");
      await expect(page.getByRole("combobox", { name: "Fin", exact: true })).toHaveValue("22:30");
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
  for (const label of ["SAV", "EXPÉDITION / RAMASSE & EMBALLAGE", "SST"]) {
    await page.getByLabel(`${label}, contenu du brief`).fill("");
  }
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(".tv-plan-empty-state")).toHaveCount(3);
  await expect(page.getByText("Brief à renseigner", { exact: true })).toHaveCount(3);
  const planLayout = await page.evaluate(() => {
    const columns = Array.from(document.querySelectorAll<HTMLElement>(".tv-plan-column"));
    return {
      count: columns.length,
      tallEnough: columns.every((column) => column.clientHeight >= 100),
      contained: columns.every((column) => column.scrollWidth <= column.clientWidth + 1),
      textVisible: columns.every((column) => column.scrollHeight <= column.clientHeight + 1),
    };
  });
  expect(planLayout).toEqual({ count: 3, tallEnough: true, contained: true, textVisible: true });
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("tv-ecran-quai.png"), fullPage: false, animations: "disabled" });

  await expect(page.getByRole("button", { name: "Mode plein écran", exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("les huit onglets restent sans débordement aux largeurs intermédiaires et mobiles", async ({ page }) => {
  test.setTimeout(180_000);
  const viewports = [
    { width: 1366, height: 768 },
    { width: 820, height: 1180 },
    { width: 768, height: 1024 },
    { width: 360, height: 800 },
    { width: 320, height: 740 },
  ];
  const viewButtons = [
    "01 Coup d'envoi",
    "02 Feuille de match",
    "03 Composition",
    "04 Coach",
    "05 BRIEF ÉQUIPE",
    "MAJ Import",
    "? Guide",
    "ADM Administrateur",
  ];

  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await expect(page.locator(".agency-pill")).toContainText("Agen - 058");

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const buttonName of viewButtons) {
      await page.getByRole("button", { name: buttonName, exact: true }).click();
      await expect(page.locator(".nav-item.active")).toHaveAttribute("aria-label", buttonName);
      await assertNoHorizontalOverflow(page);
      if (buttonName === "05 BRIEF ÉQUIPE") {
        await page.getByRole("button", { name: "Quitter le brief équipe", exact: true }).click();
        await assertNoHorizontalOverflow(page);
      }
    }
  }
});

test("la plage horaire et le graphique horaire restent explicites", async ({ page }) => {
  test.setTimeout(120_000);
  let baseSnapshot: Snapshot | null = null;
  await page.route(/\/api\/agencies\/058\/snapshot(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    baseSnapshot = payload.snapshot;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.route("**/api/agencies/058/time-range", async (route) => {
    const request = route.request().postDataJSON() as { start: string; end: string };
    if (!baseSnapshot) throw new Error("Le snapshot de test n'est pas disponible.");
    const snapshot = JSON.parse(JSON.stringify(baseSnapshot)) as Snapshot;
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
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await expect(page.getByText("pas de 30 min · fin incluse")).toBeVisible();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  const matchNavigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  await matchNavigation.getByRole("button", { name: "Aller à Statistiques du match" }).click();
  await expect(page.locator(".performance-chart-panel")).toBeVisible();
  await expect(page.getByRole("group", { name: "Évolution horaire du pourcentage de passes réussies" })).toBeVisible();
  await expect(page.getByText("Donnée Excel Feuille de match, heure par heure", { exact: true })).toBeVisible();
  await expect(page.locator(".performance-chart-total b")).toHaveText("69,2%");

  await page.locator(".time-range-control select").nth(0).selectOption("13:00");
  await page.locator(".time-range-control select").nth(1).selectOption("22:30");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(page.locator(".time-range-control select").nth(0)).toHaveValue("13:00");
  await expect(page.locator(".time-range-control select").nth(1)).toHaveValue("22:30");
  await expect(matchNavigation.locator(".match-carousel-count")).toHaveText("03 / 04");
  const initialHours = await page.locator(".performance-chart-hour").allTextContents();
  expect(initialHours).not.toContain("00h");
  expect(initialHours).toEqual(["13h", "14h", "16h", "17h", "18h", "19h", "20h", "21h", "22h"]);

  await page.locator(".time-range-control select").nth(0).selectOption("16:00");
  await page.locator(".time-range-control select").nth(1).selectOption("18:00");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(page.locator(".time-range-control select").nth(0)).toHaveValue("16:00");
  await expect(page.locator(".time-range-control select").nth(1)).toHaveValue("18:00");
  await expect(matchNavigation.locator(".match-carousel-count")).toHaveText("03 / 04");
  await expect(page.locator(".performance-chart-hour")).toHaveText(["16h", "17h", "18h"]);
  expect(await page.locator(".performance-chart-hour").allTextContents()).not.toContain("00h");
  await expect(page.locator(".performance-chart-total b")).toHaveText("59,4%");

  await page.locator(".time-range-control select").nth(0).selectOption("22:30");
  await page.locator(".time-range-control select").nth(1).selectOption("06:00");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(page.locator(".time-range-control select").nth(0)).toHaveValue("22:30");
  await expect(page.locator(".time-range-control select").nth(1)).toHaveValue("06:00");
  await expect(matchNavigation.locator(".match-carousel-count")).toHaveText("03 / 04");
});

test("le plan de jeu saisi dans Coach reste séparé sous le brief de la feuille de match", async ({ page }) => {
  let savedPlan: Record<string, unknown> | null = null;
  await page.route("**/api/agencies/058/causerie**", async (route) => {
    if (route.request().method() === "POST") savedPlan = route.request().postDataJSON().plan;
    await route.fulfill({ status: 200, json: { plan: savedPlan } });
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "04 Coach", exact: true }).click();
  await page.getByRole("button", { name: "Écrire", exact: true }).click();
  await page.getByLabel("Priorité terrain, consigne du chef de quai").fill("Sécuriser le prochain départ.");
  await page.getByLabel("Zone à surveiller, consigne du chef de quai").fill("Contrôler la zone de réception.");
  await page.getByLabel("Équilibre d'équipe, consigne du chef de quai").fill("Renforcer le zonage.");
  await page.getByLabel("Prochaine revue du plan").fill("18:30");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await page.getByRole("button", { name: "Aller à Brief équipe", exact: true }).click();
  const coachPlan = page.locator(".match-coach-plan");
  await expect(coachPlan).toContainText("Sécuriser le prochain départ.");
  await expect(coachPlan).toContainText("Contrôler la zone de réception.");
  await expect(coachPlan).toContainText("Renforcer le zonage.");
  await expect(coachPlan).toContainText("18:30");
  await expect(coachPlan.locator("textarea,input")).toHaveCount(0);
  const slide = page.locator(".match-brief-slide");
  await expect(slide.locator(".tv-action")).not.toContainText("Sécuriser le prochain départ.");
  const separate = await slide.evaluate((element) => {
    const brief = element.querySelector(".tv-action")!.getBoundingClientRect();
    const coach = element.querySelector(".match-coach-plan")!.getBoundingClientRect();
    return coach.top >= brief.bottom + 12;
  });
  expect(separate).toBe(true);
  await slide.getByRole("button", { name: "Écrire", exact: true }).click();
  await page.getByLabel("SAV, contenu du brief").fill("Traiter les retours clients.");
  await slide.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(slide.locator(".tv-action")).toContainText("Traiter les retours clients.");
  await expect(coachPlan).not.toContainText("Traiter les retours clients.");
  await expect(coachPlan).toContainText("Sécuriser le prochain départ.");
  await coachPlan.getByRole("button", { name: "Coach", exact: true }).click();
  await expect(page.locator(".coach-action-entry").first()).toHaveText("Sécuriser le prochain départ.");
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await page.getByRole("button", { name: "Aller à Brief équipe", exact: true }).click();
  await expect(slide.locator(".tv-action")).toContainText("Traiter les retours clients.");
  await expect(coachPlan).toContainText("Sécuriser le prochain départ.");
  await page.screenshot({ path: test.info().outputPath("brief-et-plan-de-jeu.png"), fullPage: true });
  await assertNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
  await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
  await page.getByRole("button", { name: "Aller à Brief équipe", exact: true }).click();
  await coachPlan.scrollIntoViewIfNeeded();
  await expect(coachPlan).toBeVisible();
  expect(await slide.evaluate((element) => {
    const brief = element.querySelector(".tv-action")!.getBoundingClientRect();
    const coach = element.querySelector(".match-coach-plan")!.getBoundingClientRect();
    return coach.top >= brief.bottom + 12;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("brief-et-plan-de-jeu-celebration.png"), fullPage: true });
  await assertNoHorizontalOverflow(page);
});

test("le guide et le retour du brief équipe restent accessibles avant le premier import", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("05R");
  await page.getByLabel("Code d'accès").fill("LOCAL-05R-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await expect(page.getByRole("heading", { name: "Le stade est prêt", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "? Guide", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Utiliser STEF Match Center de A à Z", exact: true })).toBeVisible();
  await expect(page.locator(".guide-page")).not.toContainText(/STEF-(?:058|01K|05R|04P)/);
  await expect(page.locator(".guide-page")).toContainText("code d’accès qui vous a été transmis séparément");
  await page.locator(".guide-nav-item").filter({ hasText: "Administrateur" }).click();
  await expect(page.getByRole("heading", { name: "Régler les ligues et leurs standards", exact: true })).toBeVisible();
  await expect(page.locator(".guide-league-card")).toHaveCount(4);
  expect(await page.locator(".guide-league-card").evaluateAll((cards) => cards.every((card) => card.scrollWidth <= card.clientWidth))).toBe(true);

  await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aucun match importé", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retour au coup d'envoi", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Le stade est prêt", exact: true })).toBeVisible();
});

test("la feuille de match affiche le score et les KPI du snapshot canonique", async ({ page }) => {
  await page.route("**/api/agencies/058/snapshot**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const canonical = body.snapshot.operationalScore;
    body.snapshot.summary.passRate = 10;
    body.snapshot.loadingQuality.targetedPercent = 10;
    body.snapshot.unloadingQuality.targetedPercent = 10;
    body.snapshot.summary.possessionPercent = 10;
    body.snapshot.operationalScore = {
      ...canonical,
      status: "available",
      targetPercent: 50,
      goalsFor: 4,
      goalsAgainst: 0,
      indicators: { passRate: 99, loadingPercent: 98, unloadingPercent: 97, possessionPercent: 96 },
    };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await expect(page.locator(".football-score-side-for strong")).toHaveText("4");
  await expect(page.locator(".football-score-side-against strong")).toHaveText("0");
  await expect(page.locator(".pass-score-bubble strong")).toHaveText("99%");
  await expect(page.locator(".loading-score-bubble strong")).toHaveText("98%");
  await expect(page.locator(".reception-score-bubble strong")).toHaveText("97%");
  await expect(page.locator(".possession-score-bubble strong")).toHaveText("96%");
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
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "ADM Administrateur", exact: true }).click();
  await page.getByRole("button", { name: "Activer", exact: true }).last().click();
  await expect(page.locator(".administrator-active-badge strong")).toHaveText("Platine");
  await expect(page.locator(".app-shell")).toHaveClass(/league-platine/);
  await expect(page.getByText("Ligue activée. Importe un match pour appliquer ses objectifs.", { exact: true })).toBeVisible();
});

test("un recalcul de ligue indisponible conserve les résultats et la ligue actifs", async ({ page }) => {
  let rejectedLeagueRequest = false;
  await page.route("**/api/agencies/058/snapshot**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get("zonageMinutes") === "20") {
      rejectedLeagueRequest = true;
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ title: "AUCUN MATCH IMPORTÉ", message: "Aucun fichier Excel n'a encore été importé pour cette agence." }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await expect(page.locator(".top-league-badge")).toContainText("Argent");

  await page.getByRole("button", { name: "ADM Administrateur", exact: true }).click();
  await page.getByRole("button", { name: "Activer", exact: true }).last().click();

  expect(rejectedLeagueRequest).toBe(true);
  await expect(page.locator(".top-league-badge")).toContainText("Argent");
  await expect(page.locator(".administrator-active-badge strong")).toHaveText("Argent");
  await expect(page.locator(".top-status-message")).toContainText("Les résultats et la ligue actuels sont conservés.");

  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await expect(page.locator(".match-page")).toBeVisible();
});

test("la synchronisation ne recharge les données que si leur révision change", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Le contrôle de polling est exécuté une fois sur desktop.");
  await page.clock.install();

  const snapshotFixture = JSON.parse(readFileSync(new URL("../data/agencies/058/latest.json", import.meta.url), "utf8")) as Snapshot;
  let servedSnapshot = snapshotFixture;
  let syncState = { snapshotRevision: "snapshot-v1", leagueConfigRevision: "config-v1", causerieRevision: null as string | null };
  let syncStateRequests = 0;
  let snapshotRequests = 0;
  let leagueConfigRequests = 0;
  let causerieRequests = 0;
  let causeriePlan: Record<string, unknown> | null = null;
  const syncEvents: string[] = [];
  await page.route("**/api/agencies/058/sync-state**", async (route) => {
    syncStateRequests += 1;
    syncEvents.push(`state:${syncState.snapshotRevision}/${syncState.leagueConfigRevision}/${syncState.causerieRevision}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(syncState) });
  });
  await page.route("**/api/agencies/058/causerie**", async (route) => {
    causerieRequests += 1;
    syncEvents.push(`causerie:${causerieRequests}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plan: causeriePlan }) });
  });
  await page.route("**/api/agencies/058/snapshot**", async (route) => {
    snapshotRequests += 1;
    syncEvents.push("snapshot:200");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ snapshot: servedSnapshot }),
    });
  });
  await page.route("**/api/agencies/058/league-configs", async (route) => {
    if (route.request().method() === "GET") {
      leagueConfigRequests += 1;
      syncEvents.push("configs");
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await expect(page.getByRole("heading", { name: "Agen - 058", exact: true })).toBeVisible();
  expect(snapshotRequests).toBe(1);
  expect(leagueConfigRequests).toBe(1);

  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await expect(page.locator(".match-page")).toBeVisible();
  await expect.poll(() => causerieRequests).toBeGreaterThanOrEqual(1);

  await page.clock.runFor(15_000);
  await expect.poll(() => syncStateRequests).toBeGreaterThanOrEqual(2);
  expect(snapshotRequests).toBe(1);
  expect(leagueConfigRequests).toBe(1);

  const visiblePollCount = syncStateRequests;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  });
  await page.clock.runFor(15_000);
  expect(syncStateRequests).toBe(visiblePollCount);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => syncStateRequests).toBe(visiblePollCount + 1);

  await page.locator(".match-carousel-progress").getByRole("button", { name: "Aller à Statistiques du match" }).click();
  await expect(page.locator(".match-carousel-count")).toHaveText("03 / 04");
  servedSnapshot = { ...snapshotFixture, importedAt: new Date(Date.parse(snapshotFixture.importedAt) + 60_000).toISOString() };
  syncState = { ...syncState, snapshotRevision: "snapshot-v2" };
  await page.clock.runFor(15_000);
  await expect.poll(() => snapshotRequests).toBe(2);
  await expect(page.locator(".match-carousel-count")).toHaveText("03 / 04");
  expect(leagueConfigRequests).toBe(1);

  syncState = { ...syncState, leagueConfigRevision: "config-v2" };
  await page.clock.runFor(15_000);
  await expect.poll(() => leagueConfigRequests).toBe(2);
  await expect.poll(() => snapshotRequests).toBe(3);

  const completedSyncPolls = syncStateRequests;
  await page.clock.runFor(15_000);
  await expect.poll(() => syncStateRequests).toBe(completedSyncPolls + 1);
  expect(leagueConfigRequests, syncEvents.join(" -> ")).toBe(2);
  expect(snapshotRequests, syncEvents.join(" -> ")).toBe(3);

  const previousCauserieRequests = causerieRequests;
  await page.locator(".match-carousel-progress").getByRole("button", { name: "Aller à Coup de sifflet final" }).click();
  await expect(page.locator(".match-carousel-count")).toHaveText("01 / 04");
  causeriePlan = { mercato: "Camille Martin - nouvel arrivant", mercatoProfiles: { "camille martin": "female" } };
  syncState = { ...syncState, causerieRevision: "causerie-v2" };
  await page.clock.runFor(15_000);
  await expect.poll(() => causerieRequests).toBe(previousCauserieRequests + 1);
  await expect(page.locator(".mercato-carousel-card .mercato-kpi-subtitle")).toHaveText("Nouveau joueur");
  await expect(page.locator(".mercato-carousel-card .mercato-kpi-profile")).toHaveText("Femme");

  await page.locator(".match-carousel-progress").getByRole("button", { name: "Aller à Brief équipe" }).click();
  await page.getByRole("button", { name: "Écrire", exact: true }).click();
  const briefDraft = page.getByLabel("SAV, contenu du brief");
  await briefDraft.fill("Consigne saisie en cours");
  const beforeSecondCauserieRefresh = causerieRequests;
  causeriePlan = {
    mercato: "Camille Martin - nouvel arrivant",
    mercatoProfiles: { "camille martin": "female" },
    attack: ["Mise à jour distante"],
    midfield: [],
    defense: [],
  };
  syncState = { ...syncState, causerieRevision: "causerie-v3" };
  await page.clock.runFor(15_000);
  await expect.poll(() => causerieRequests).toBe(beforeSecondCauserieRefresh + 1);
  await expect(briefDraft).toHaveValue("Consigne saisie en cours");
});

test("l'administrateur conserve ses règles par agence et synchronise ses animations", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "ADM Administrateur", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Centre de pilotage des ligues", exact: true })).toBeVisible();
  await expect(page.locator(".administrator-rule-strip select")).toHaveCount(3);
  await expect(page.locator(".league-card .league-values select")).toHaveCount(12);
  await expect(page.locator(".administrator-rule-strip")).not.toContainText("Position");
  await expect(page.getByLabel("Cible zonage Argent")).toHaveValue("30");
  await expect(page.getByLabel("Modifier chargement Argent")).toHaveValue("00:02:45");
  await expect(page.getByLabel("Modifier réception Argent")).toHaveValue("00:01:00");
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
  await expect(page.getByLabel("Modifier réception Argent")).toHaveValue("00:01:00");
  await expect(page.locator(".administrator-active-badge strong")).toHaveText("Platine");
  await expect(page.locator(".app-shell")).toHaveClass(/league-platine/);
  await expect(page.locator(".top-league-badge")).toContainText("Platine");

  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await expect(page.locator(".football-score-side-for strong")).toHaveText("1");
  await expect(page.locator(".football-score-side-against strong")).toHaveText("3");
  await expect(page.getByText("Célébration activée", { exact: true })).toHaveCount(0);
});

test("le catalogue de secours conserve les six agences sans API disponible", async ({ page }) => {
  await page.route("**/api/agencies", route => route.abort());
  await page.goto("/");
  const options = page.getByLabel("Code agence").locator("option");
  await expect(options).toHaveCount(6);
  await expect(options).toHaveText(["Agen - 058", "Montpellier - 01K", "Toulouse - 05R", "Bordeaux - 04P", "Lyon - R3A", "Brive - 04H"]);
});

test("Lyon et Brive : connexion et premier état sans import", async ({ page }) => {
  for (const code of ["R3A", "04H"]) {
    await page.goto("/");
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.getByLabel("Code agence").selectOption(code);
    await page.getByLabel("Code d'accès").fill("WRONG-TEST-ONLY");
    const rejected = page.waitForResponse(response => response.url().endsWith("/api/session") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Accéder au match" }).click();
    expect((await rejected).status()).toBe(401);
    await expect(page.getByLabel("Code agence")).toBeVisible();
    await page.getByLabel("Code d'accès").fill(`LOCAL-${code}-DEV`);
    await page.getByRole("button", { name: "Accéder au match" }).click();
    await expect(page.locator(".agency-pill")).toContainText(code);
    await expect(page.getByRole("heading", { name: "Le stade est prêt", exact: true })).toBeVisible();
    await expect(page.getByText("Aucun match importé", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Aucun match importé", exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  }
});

test("le nom de l'agence connectée reste correct dans tous les onglets", async ({ page }) => {
  test.setTimeout(120_000);
  const agencies = [
    { code: "058", accessCode: "LOCAL-058-DEV", name: "Agen - 058" },
    { code: "01K", accessCode: "LOCAL-01K-DEV", name: "Montpellier" },
    { code: "05R", accessCode: "LOCAL-05R-DEV", name: "Toulouse" },
    { code: "04P", accessCode: "LOCAL-04P-DEV", name: "Bordeaux" },
    { code: "R3A", accessCode: "LOCAL-R3A-DEV", name: "Lyon - R3A" },
    { code: "04H", accessCode: "LOCAL-04H-DEV", name: "Brive - 04H" },
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
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
  await expect(page.locator(".tv-mode")).toHaveCount(1);
  await expect(page.locator(".tv-match-ceremony")).toHaveCount(0);
  await expect(page.locator(".tv-key-players")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mode plein écran", exact: true })).toBeVisible();
  await expect(page.locator(".tv-action-heading").getByText("BRIEF ÉQUIPE", { exact: true })).toBeVisible();
  await expect(page.locator(".tv-plan-column")).toHaveCount(3);
  await expect(page.getByText("SAV", { exact: true })).toBeVisible();
  await expect(page.getByText("EXPÉDITION / RAMASSE & EMBALLAGE", { exact: true })).toBeVisible();
  await expect(page.getByText("SST", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quitter le brief équipe", exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("la feuille de match défile entre ses quatre sections sans empiler les vues", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();

  const viewport = page.locator(".match-slide-viewport");
  const navigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  const assertActiveSlideFits = async () => {
    if (testInfo.project.name === "mobile") return;
    const geometry = await viewport.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const selectors = [
        ".match-result-stage", ".match-kpi-actions", ".special-awards", ".award-card",
        ".operational-charts-carousel", ".match-brief-slide .tv-plan-grid",
      ];
      const clipped = selectors.flatMap((selector) => Array.from(element.querySelectorAll<HTMLElement>(`.match-slide-panel.is-active ${selector}`)))
        .filter((child) => {
          const rect = child.getBoundingClientRect();
          return rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1;
        })
        .map((child) => ({ className: child.className, top: Math.round(child.getBoundingClientRect().top), bottom: Math.round(child.getBoundingClientRect().bottom) }));
      return { height: element.clientHeight, content: element.scrollHeight, clipped };
    });
    expect(geometry.content, `la slide active dépasse de ${geometry.content - geometry.height}px`).toBeLessThanOrEqual(geometry.height + 1);
    expect(geometry.clipped, "des éléments interactifs ou des cartes sont coupés par le viewport").toEqual([]);
  };
  await expect(navigation).toBeVisible();
  await expect(navigation.locator(".match-carousel-count")).toHaveText("01 / 04");
  await expect(page.locator(".match-slide-panel.is-active")).toHaveCount(1);
  await expect(page.locator(".match-ceremony")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Le collectif en chiffres", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("match-slide-1-coup-de-sifflet.png"), fullPage: false, animations: "disabled" });
  await assertActiveSlideFits();

  await navigation.getByRole("button", { name: "Section suivante" }).click();
  await expect(navigation.locator(".match-carousel-count")).toHaveText("02 / 04");
  await expect(page.locator(".awards-ceremony")).toBeVisible();
  await expect(page.locator(".match-ceremony")).toHaveAttribute("aria-hidden", "true");
  await page.screenshot({ path: testInfo.outputPath("match-slide-2-performances.png"), fullPage: false, animations: "disabled" });
  await assertActiveSlideFits();

  await viewport.focus();
  await page.keyboard.press("ArrowRight");
  await expect(navigation.locator(".match-carousel-count")).toHaveText("03 / 04");
  await expect(page.locator(".match-statistics-section")).toBeVisible();
  await expect(page.locator(".operational-charts-carousel")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("match-slide-3-statistiques.png"), fullPage: false, animations: "disabled" });
  await assertActiveSlideFits();

  await navigation.getByRole("button", { name: "Section suivante" }).click();
  await expect(navigation.locator(".match-carousel-count")).toHaveText("04 / 04");
  await expect(navigation.getByRole("button", { name: "Aller à Brief équipe" })).toHaveAttribute("aria-current", "step");
  await expect(page.locator(".match-brief-slide .tv-action")).toBeVisible();
  await expect(page.locator(".tv-plan-column")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Écrire", exact: true })).toBeVisible();
  await expect.poll(() => navigation.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
  await expect.poll(() => page.locator(".match-brief-slide .tv-plan-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(testInfo.project.name === "mobile" ? 1 : 3);
  const briefColumnHeight = await page.locator(".match-brief-slide .tv-plan-column").first().evaluate((element) => element.getBoundingClientRect().height);
  const expectedBriefColumnHeight = testInfo.project.name === "mobile" ? 160 : Math.min(410, Math.max(220, testInfo.project.name === "tablet" ? 768 : 1024) * 0.4);
  expect(briefColumnHeight).toBeGreaterThanOrEqual(expectedBriefColumnHeight - 1);
  await page.screenshot({ path: testInfo.outputPath("match-slide-4-brief.png"), fullPage: false, animations: "disabled" });
  await assertActiveSlideFits();

  await navigation.getByRole("button", { name: "Section précédente" }).click();
  await expect(navigation.locator(".match-carousel-count")).toHaveText("03 / 04");
  await expect(page.locator(".match-indicators .match-indicator-card:not(.is-mercato)")).toHaveCount(8);
  await expect(page.locator(".match-indicators .mercato-carousel-card")).toHaveCount(1);
  // Normal mode is a readable document, not a viewport-fitted presentation.
  // Keep the non-clipping checks above and verify the extra height is reachable.
  const pageGeometry = await page.evaluate(() => ({
    viewport: window.innerHeight,
    document: document.documentElement.scrollHeight,
    overflowY: getComputedStyle(document.querySelector(".main-area")!).overflowY,
  }));
  if (pageGeometry.document > pageGeometry.viewport + 1) {
    expect(pageGeometry.overflowY, "le mode normal ne doit pas masquer la hauteur supplémentaire").not.toMatch(/hidden|clip/);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1), {
      message: "le bas du document doit rester accessible par défilement",
    }).toBe(true);
  }
  await assertNoHorizontalOverflow(page);
});

test("le mode Célébration reste quittable sur chaque slide et garde le graphique actif visible", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await page.getByRole("button", { name: "Mode célébration", exact: true }).click();

  const navigation = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  const exitButton = page.getByRole("button", { name: "Sortir du mode Célébration", exact: true });
  await expect(exitButton).toBeVisible();
  await navigation.getByRole("button", { name: "Aller à Cérémonie des performances" }).click();
  await expect(exitButton).toBeVisible();
  await navigation.getByRole("button", { name: "Aller à Statistiques du match" }).click();
  await expect(exitButton).toBeVisible();
  await expect(page.locator(".operational-chart-slide.is-active .performance-chart")).toBeVisible();

  if (testInfo.project.name !== "mobile") {
    const chartGeometry = await page.locator(".operational-chart-slide.is-active .performance-chart").evaluate((element) => {
      const chart = element.getBoundingClientRect();
      const viewport = element.closest(".match-slide-viewport")?.getBoundingClientRect();
      return { chartBottom: chart.bottom, viewportBottom: viewport?.bottom ?? 0, chartRight: chart.right, viewportRight: viewport?.right ?? 0 };
    });
    expect(chartGeometry.chartBottom).toBeLessThanOrEqual(chartGeometry.viewportBottom + 1);
    expect(chartGeometry.chartRight).toBeLessThanOrEqual(chartGeometry.viewportRight + 1);
  }

  await navigation.getByRole("button", { name: "Aller à Brief équipe" }).click();
  await expect(exitButton).toBeVisible();
  await exitButton.click();
  await expect(page.locator("body.match-celebration-active")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mode célébration", exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow, `débordement horizontal à ${await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)}`).toBe(false);
}
