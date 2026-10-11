import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

test("Brief v2 : migration sans perte, SST indépendant et relecture", async ({ page }, info) => {
  test.setTimeout(180_000);
  const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  const expedition = Array.from({ length: 3 }, (_, i) => `E${i}`.padEnd(500, "E"));
  const ramasse = Array.from({ length: 3 }, (_, i) => `R${i}`.padEnd(500, "R"));
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  let stored: Record<string, unknown> = {
    attack: ["Consigne SAV"], midfield: expedition, defense: ramasse,
    attachments: { attack: [], midfield: Array(12).fill(image), defense: Array(12).fill(image) },
  };
  await page.route("**/api/agencies/058/snapshot**", (route) => route.fulfill({ json: { snapshot } }));
  await page.route("**/api/agencies/058/causerie**", async (route) => {
    if (route.request().method() === "POST") stored = route.request().postDataJSON().plan;
    await route.fulfill({ json: { plan: stored } });
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
  await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
  const exp = page.locator(".tv-plan-column.midfield");
  const sst = page.locator(".tv-plan-column.defense");
  await expect(page.locator(".tv-plan-column > b")).toHaveText(["SAV", "EXPÉDITION / RAMASSE & EMBALLAGE", "SST"]);
  await expect(exp.locator(".tv-plan-content")).toHaveText([...expedition, ...ramasse].join("\n"));
  await expect(exp.locator("img")).toHaveCount(24);
  await expect(sst.locator(".tv-plan-empty-state")).toBeVisible();
  await expect(sst.locator("img")).toHaveCount(0);
  for (const index of [1, 13]) {
    await exp.getByRole("button", { name: `Agrandir la capture EXPÉDITION / RAMASSE & EMBALLAGE ${index}`, exact: true }).click();
    await expect(page.getByRole("dialog", { name: `Capture agrandie EXPÉDITION / RAMASSE & EMBALLAGE · capture ${index}`, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Écrire", exact: true }).click();
  await expect(page.getByLabel("EXPÉDITION / RAMASSE & EMBALLAGE, contenu du brief")).toHaveValue([...expedition, ...ramasse].join("\n"));
  await page.getByLabel("SST, contenu du brief").fill("Brief sécurité");
  await page.getByLabel("SST, capture d'écran").setInputFiles({ name: "sst.png", mimeType: "image/png", buffer: Buffer.from(image.split(",")[1], "base64") });
  await expect(sst.locator(".tv-plan-image-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Écrire", exact: true })).toBeVisible();
  expect(stored.briefLayoutVersion).toBe(2);
  await page.reload();
  await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
  await expect(sst.locator(".tv-plan-content")).toHaveText("Brief sécurité");
  await expect(sst.locator("img")).toHaveCount(1);
  await expect(exp.locator(".tv-plan-content")).toHaveText([...expedition, ...ramasse].join("\n"));
  await expect(exp.locator("img")).toHaveCount(24);
  await page.getByRole("button", { name: "Écrire", exact: true }).click();
  const editedExpedition = [...expedition, ...ramasse].join("\n").replace(/^E0/, "EX");
  await page.getByLabel("EXPÉDITION / RAMASSE & EMBALLAGE, contenu du brief").fill(editedExpedition);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(sst.locator(".tv-plan-content")).toHaveText("Brief sécurité");
  await expect(sst.locator("img")).toHaveCount(1);
  const sizes = info.project.name === "desktop" ? [[1366,768],[1440,900],[1536,864],[1920,1080]] : [[info.project.use.viewport!.width,info.project.use.viewport!.height]];
  for (const withCaptures of [true,false]) {
    if (!withCaptures) {
      await page.getByRole("button", { name: "Écrire", exact: true }).click();
      while (await exp.locator(".tv-plan-image-item").count()) await exp.getByRole("button", { name: /^Supprimer la capture/ }).last().click();
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await expect(page.getByRole("button", { name: "Écrire", exact: true })).toBeVisible();
    }
    for (const [width,height] of sizes) {
      await page.setViewportSize({width,height});
      await page.getByRole("button", { name: "Quitter le brief équipe", exact: true }).click();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      const nav = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
      for (const celebration of [false,true]) {
        await nav.getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
        if (celebration) await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
        await nav.getByRole("button", { name: "Aller à Brief équipe", exact: true }).click();
        await expect(sst.locator("b")).toHaveText("SST");
        await expect(exp.locator("b")).toHaveText("EXPÉDITION / RAMASSE & EMBALLAGE");
        expect(await exp.locator("b").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await expect(exp.locator(".tv-plan-content")).toHaveText(editedExpedition);
        await expect(exp.locator("img")).toHaveCount(withCaptures ? 24 : 0);
        await expect(sst.locator(".tv-plan-content")).toHaveText("Brief sécurité");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        expect(await exp.locator(".tv-plan-content").evaluate((el) => el.scrollHeight <= el.clientHeight + 1), `${width} ${height} texte intégral, captures=${withCaptures}`).toBe(true);
        if (withCaptures) expect(await exp.locator(".tv-plan-image-gallery").evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
        await page.screenshot({ path: info.outputPath(`${width}-${height}-${celebration ? "celebration" : "normal"}-${withCaptures}-brief-v2.png`) });
        if (celebration) await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
      }
      await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
    }
  }
});

test("Nouveau brief : trois zones explicites et SST indépendant", async ({ page }) => {
  const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  let stored: Record<string, unknown> | null = null;
  await page.route("**/api/agencies/058/snapshot**", route => route.fulfill({ json: { snapshot } }));
  await page.route("**/api/agencies/058/causerie**", async route => {
    if (route.request().method() === "POST") stored = route.request().postDataJSON().plan;
    await route.fulfill({ json: { plan: stored } });
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
  await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
  await expect(page.locator(".tv-plan-column > b")).toHaveText(["SAV", "EXPÉDITION / RAMASSE & EMBALLAGE", "SST"]);
  await expect(page.locator(".tv-plan-empty-state")).toHaveCount(3);
  await page.getByRole("button", { name: "Écrire", exact: true }).click();
  await page.getByLabel("EXPÉDITION / RAMASSE & EMBALLAGE, contenu du brief").fill("Consignes expédition\nConsignes ramasse et emballage");
  await page.getByLabel("SST, contenu du brief").fill("Consignes sécurité indépendantes");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Écrire", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
  await expect(page.locator(".midfield .tv-plan-content")).toHaveText("Consignes expédition\nConsignes ramasse et emballage");
  await expect(page.locator(".defense .tv-plan-content")).toHaveText("Consignes sécurité indépendantes");
});
