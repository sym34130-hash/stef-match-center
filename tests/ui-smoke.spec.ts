import { expect, Page, test } from "@playwright/test";

const screens = [
  { name: "01-coup-envoi", button: "01 Coup d'envoi", marker: "01 - Coup d'envoi" },
  { name: "02-feuille-match", button: "02 Feuille de match", marker: "02 - Feuille de match" },
  { name: "03-composition", button: "03 Composition", marker: "03 - Composition" },
  { name: "04-coach", button: "04 Coach", marker: "04 - Coach" },
  { name: "05-causerie", button: "05 Causerie", marker: "CAUSERIE", heading: "Causerie" },
];

test("les vues principales restent lisibles sur desktop, tablette et mobile", async ({ page }, testInfo) => {
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
    if ("heading" in screen) {
      await expect(page.getByRole("heading", { name: screen.heading, exact: true })).toBeVisible();
    } else {
      await expect(page.getByText(screen.marker, { exact: true })).toBeVisible();
    }
    if (screen.name === "02-feuille-match") {
      await expect(page.locator(".match-page.is-threshold-reached")).toHaveCount(1);
      await expect(page.getByText("Célébration activée", { exact: true })).toBeVisible();
    }
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`${screen.name}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }

  await page.locator('button[aria-label="? Guide"]').click();
  await expect(page.getByRole("heading", { name: "Utiliser STEF Match Center de A à Z", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "02 Préparer Excel", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "04 Lire les écrans", exact: true }).click();
  await expect(page.getByText(/DECH est présentée comme Réception/)).toBeVisible();
  await page.getByRole("button", { name: "05 Modifier le plan", exact: true }).click();
  await expect(page.getByText("Ajouter une capture d’écran :", { exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "TV Écran quai", exact: true }).click();
  await expect(page.locator(".tv-mode.is-threshold-reached")).toHaveCount(1);
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
  await page.screenshot({ path: testInfo.outputPath("tv-ecran-quai.png"), fullPage: true, animations: "disabled" });

  await expect(page.getByRole("button", { name: "Mode plein écran", exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("la plage horaire est visible et le contrôle import reste explicite", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("STEF-058");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await expect(page.getByText("pas de 30 min · fin incluse")).toBeVisible();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await expect(page.getByText(/ligne\(s\) concernée\(s\) au total/)).toBeVisible();
  await expect(page.getByText("Une même ligne peut apparaître dans plusieurs contrôles.")).toBeVisible();
});

test("le guide et le retour de l'écran quai restent accessibles avant le premier import", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("01K");
  await page.getByLabel("Code d'accès").fill("STEF-01K");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await expect(page.getByRole("heading", { name: "Le stade est prêt", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "? Guide", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Utiliser STEF Match Center de A à Z", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "TV Écran quai", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aucun match importé", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retour au coup d'envoi", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Le stade est prêt", exact: true })).toBeVisible();
});

test("le nom de l'agence connectée reste correct dans tous les onglets", async ({ page }) => {
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
    await expect(page.getByRole("heading", { name: agency.name, exact: true })).toBeVisible();

    for (const screen of screens) {
      await page.getByRole("button", { name: screen.button, exact: true }).click();
      await expect(page.getByRole("heading", { name: agency.name, exact: true })).toBeVisible();
    }
  }
});

test("le mode brief de la causerie conserve ses zones et ses textes dans le terrain", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("STEF-058");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "05 Causerie", exact: true }).click();
  await page.getByRole("button", { name: "Mode brief", exact: true }).click();
  await expect(page.getByRole("button", { name: "Quitter brief", exact: true })).toBeVisible();

  const briefLayout = await page.evaluate(() => {
    const field = document.querySelector<HTMLElement>(".stadium-field");
    const zones = Array.from(document.querySelectorAll<HTMLElement>(".field-zone"));
    if (!field || zones.length !== 3) return { valid: false };
    const fieldRect = field.getBoundingClientRect();
    return {
      valid: zones.every((zone) => {
        const rect = zone.getBoundingClientRect();
        return rect.left >= fieldRect.left && rect.right <= fieldRect.right && zone.scrollWidth <= zone.clientWidth + 1;
      }),
    };
  });
  expect(briefLayout.valid).toBe(true);
  await assertNoHorizontalOverflow(page);
});

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow, `débordement horizontal à ${await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)}`).toBe(false);
}
