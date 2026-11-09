import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("1B : sauvegarde habituelle puis réponses anciennes et navigations successives", async ({ page }) => {
  const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  let configs = [
    { id: "bronze", zonageMinutes: 45, loadingSeconds: 195, unloadingSeconds: 75, scoreTargetPercent: 45 },
    { id: "argent", zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 },
    { id: "or", zonageMinutes: 25, loadingSeconds: 150, unloadingSeconds: 55, scoreTargetPercent: 60 },
    { id: "platine", zonageMinutes: 20, loadingSeconds: 135, unloadingSeconds: 50, scoreTargetPercent: 70 },
  ];
  let writes = 0;
  let revision = "0";
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/agencies/058/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/league-configs")) {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        expect(body.expectedRevision).toBe(revision);
        writes++;
        if (writes === 2) await gate;
        configs = body.configs;
        revision = String(writes);
      }
      return route.fulfill({ json: { configs, leagueConfigRevision: revision } });
    }
    if (path.endsWith("/sync-state")) return route.fulfill({ json: { snapshotRevision: "snapshot", leagueConfigRevision: revision, causerieRevision: null } });
    if (path.endsWith("/snapshot") || path.endsWith("/time-range")) return route.fulfill({ json: { snapshot } });
    return route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "ADM Administrateur", exact: true }).click();
  const badge = page.locator(".administrator-active-badge strong");
  const field = page.getByLabel("Cible zonage LIGUE 1", { exact: true });
  await field.selectOption("27");
  await expect.poll(() => revision).toBe("1");
  await expect(badge).toHaveText("LIGUE 1");
  await expect(field).toHaveValue("27");
  await field.selectOption("28");
  await expect.poll(() => writes).toBe(2);
  await field.selectOption("29");
  const cards = page.locator(".league-grid .league-card");
  await cards.last().getByRole("button", { name: "Activer", exact: true }).click();
  await expect(badge).toHaveText("CDM");
  await cards.first().getByRole("button", { name: "Activer", exact: true }).click();
  await expect(badge).not.toHaveText("CDM");
  await cards.last().getByRole("button", { name: "Activer", exact: true }).click();
  await expect(badge).toHaveText("CDM");
  release();
  await expect.poll(() => revision).toBe("3");
  expect(configs.find(config => config.id === "argent")?.zonageMinutes).toBe(29);
  await expect(badge).toHaveText("CDM");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("1B : conflit ligues, saisie conservée au polling, rechargement explicite et reprise", async ({ page }) => {
  const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  let revision = "one";
  let configs = [
    { id: "bronze", zonageMinutes: 45, loadingSeconds: 195, unloadingSeconds: 75, scoreTargetPercent: 45 },
    { id: "argent", zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 },
    { id: "or", zonageMinutes: 25, loadingSeconds: 150, unloadingSeconds: 55, scoreTargetPercent: 60 },
    { id: "platine", zonageMinutes: 20, loadingSeconds: 135, unloadingSeconds: 50, scoreTargetPercent: 70 },
  ];
  let writes = 0;
  let releaseSecondSave: () => void = () => {};
  const secondSaveGate = new Promise<void>(resolve => { releaseSecondSave = resolve; });
  await page.clock.install();
  await page.route("**/api/agencies/058/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/league-configs")) {
      if (route.request().method() === "PUT") {
        writes++;
        const body = route.request().postDataJSON();
        if (writes === 1) {
          expect(body.expectedRevision).toBe("one");
          configs = configs.map(config => config.id === "argent" ? { ...config, zonageMinutes: 31, loadingSeconds: 150 } : config);
          revision = "two";
          return route.fulfill({ status: 409, json: { configs, leagueConfigRevision: revision, message: "Les paramètres ont été modifiés par un autre utilisateur. Ta saisie est conservée." } });
        }
        expect(body.expectedRevision).toBe("two");
        expect(body.configs.find((config: { id: string }) => config.id === "argent").loadingSeconds).toBe(150);
        await secondSaveGate;
        configs = body.configs;
        revision = "three";
      }
      return route.fulfill({ json: { configs, leagueConfigRevision: revision } });
    }
    if (path.endsWith("/sync-state")) return route.fulfill({ json: { snapshotRevision: "snapshot", leagueConfigRevision: revision, causerieRevision: null } });
    if (path.endsWith("/snapshot") || path.endsWith("/time-range")) return route.fulfill({ json: { snapshot } });
    return route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "ADM Administrateur", exact: true }).click();
  const field = page.getByLabel("Cible zonage LIGUE 1", { exact: true });
  await field.selectOption("27");
  await expect(page.getByRole("alert")).toContainText("Ta saisie est conservée");
  await expect(field).toHaveValue("27");
  await page.clock.runFor(15_000);
  await expect(field).toHaveValue("27");
  expect(writes).toBe(1);
  await field.selectOption("28");
  await expect(page.getByRole("alert")).toBeVisible();
  expect(writes).toBe(1);
  await page.getByRole("button", { name: "Recharger la version serveur (remplacer ma saisie)", exact: true }).click();
  await expect(field).toHaveValue("31");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await field.selectOption("28");
  await expect.poll(() => writes).toBe(2);
  await expect(field).toHaveValue("28");
  await page.locator(".league-grid .league-card").last().getByRole("button", { name: "Activer", exact: true }).click();
  await expect(page.locator(".administrator-active-badge strong")).toHaveText("CDM");
  const completed = page.waitForResponse(response => response.url().endsWith("/league-configs") && response.request().method() === "PUT" && response.status() === 200);
  releaseSecondSave();
  await completed;
  await page.clock.runFor(1000);
  await expect(page.locator(".administrator-active-badge strong")).toHaveText("CDM");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const screen of ["Brief équipe", "Feuille de match"]) {
  test(`1C : ${screen}, capture refusée explicitement, brouillon conservé et Annuler restaure`, async ({ page }) => {
    const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const plan = { briefLayoutVersion: 2, attack: ["Texte sauvegardé"], attachments: { attack: [image] } };
    await page.route("**/api/agencies/058/snapshot**", route => route.fulfill({ json: { snapshot } }));
    await page.route("**/api/agencies/058/causerie**", route => route.request().method() === "POST"
      ? route.fulfill({ status: 400, json: { message: "Une capture dépasse la taille autorisée. Le plan précédent est conservé." } })
      : route.fulfill({ json: { plan, causerieRevision: "saved" } }));
    await page.goto("/");
    await page.getByLabel("Code agence").selectOption("058");
    await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
    await page.getByRole("button", { name: "Accéder au match" }).click();
    if (screen === "Brief équipe") await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
    else {
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      await page.getByRole("button", { name: "Aller à Brief équipe", exact: true }).click();
    }
    await expect(page.locator(".tv-plan-column.attack .tv-plan-content")).toHaveText("Texte sauvegardé");
    await page.getByRole("button", { name: "Écrire", exact: true }).click();
    const field = page.getByLabel("Service client, contenu du brief");
    await field.fill("Brouillon non enregistré");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Une capture dépasse");
    await expect(field).toHaveValue("Brouillon non enregistré");
    await expect(page.getByRole("button", { name: "Supprimer la capture Service client 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
    await expect(page.locator(".tv-plan-column.attack .tv-plan-content")).toHaveText("Texte sauvegardé");
  });
}

test.describe("Horaires français sur un poste à Tokyo", () => {
  test.use({ timezoneId: "Asia/Tokyo" });
  test("1D : actualisation affichée en Europe/Paris, sans dépendre du poste", async ({ page }) => {
    const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
    snapshot.importedAt = "2026-01-12T14:05:00.000Z";
    await page.route("**/api/agencies/058/snapshot**", route => route.fulfill({ json: { snapshot } }));
    await page.goto("/");
    await page.getByLabel("Code agence").selectOption("058");
    await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
    await page.getByRole("button", { name: "Accéder au match" }).click();
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("Asia/Tokyo");
    await expect(page.getByText("Dernière actualisation : 12/01 15:05", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Dernière actualisation : 12/01 23:05", { exact: true })).toHaveCount(0);
  });
});

for (const editor of ["priorités", "discipline"]) {
  test(`1C : Coach ${editor}, un refus Causerie conserve l'éditeur sans fausse sauvegarde`, async ({ page }) => {
    const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
    await page.route("**/api/agencies/058/snapshot**", route => route.fulfill({ json: { snapshot } }));
    await page.route("**/api/agencies/058/causerie**", route => route.request().method() === "POST"
      ? route.fulfill({ status: 400, json: { message: "Une capture est invalide. Le plan précédent est conservé." } })
      : route.fulfill({ json: { plan: { briefLayoutVersion: 2, coach: { tactic: "Consigne serveur" }, redCards: "Ancienne saisie" }, causerieRevision: "saved" } }));
    await page.goto("/");
    await page.getByLabel("Code agence").selectOption("058");
    await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
    await page.getByRole("button", { name: "Accéder au match" }).click();
    await page.getByRole("button", { name: "04 Coach", exact: true }).click();
    const section = page.locator(editor === "priorités" ? ".coach-actions-section" : ".coach-red-list");
    await section.getByRole("button", { name: editor === "priorités" ? "Écrire" : "Saisir", exact: true }).click();
    const input = page.getByLabel(editor === "priorités" ? "Priorité terrain, consigne du chef de quai" : "Cartons rouges manuels", { exact: true });
    await input.fill("Brouillon à conserver");
    await section.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.locator(".coach-board-feedback")).toContainText("Une capture est invalide");
    await expect(input).toHaveValue("Brouillon à conserver");
    await expect(page.locator(".coach-board-feedback")).not.toContainText("Sauvegarde locale uniquement");
    await section.getByRole("button", { name: "Annuler", exact: true }).click();
    await expect(editor === "priorités" ? section.locator(".coach-action-entry").first() : section.locator("li b").first()).toHaveText(editor === "priorités" ? "Consigne serveur" : "Ancienne saisie");
  });
}
