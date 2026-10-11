import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

test("captures du brief : texte prioritaire, galerie indépendante et édition conservée", async ({ page }, info) => {
  test.setTimeout(600_000);
  const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/agencies/058/snapshot**", (route) => route.fulfill({ json: { snapshot } }));
  await page.route("**/api/agencies/058/causerie**", async (route) => {
    if (route.request().method() === "POST") saved = route.request().postDataJSON().plan;
    await route.fulfill({ json: { plan: saved } });
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#123b60"; context.fillRect(0, 0, 640, 360);
    context.fillStyle = "#fff"; context.font = "28px sans-serif"; context.fillText("Capture de test", 30, 70);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const image = { name: "capture.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") };
  const sizes = info.project.name === "desktop" ? [[1366,768],[1440,900],[1536,864],[1920,1080]] : [[info.project.use.viewport!.width, info.project.use.viewport!.height]];
  for (const [width,height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const screen of ["match", "celebration", "brief", "fullscreen"]) {
      if (await page.locator(".tv-mode").count()) await page.getByRole("button", { name: "Quitter le brief équipe", exact: true }).click();
      if (await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).count()) await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
      await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
      const nav = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
      await nav.getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
      if (screen === "celebration") await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
      await nav.getByRole("button", { name: "Aller à Brief équipe", exact: true }).click();
      if (screen === "brief" || screen === "fullscreen") {
        await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
        if (screen === "fullscreen") await page.getByRole("button", { name: "Mode plein écran", exact: true }).click();
      }
      await page.getByRole("button", { name: "Écrire", exact: true }).click();
      for (const label of ["SAV", "Expédition", "SST"]) {
        const column = page.locator(".tv-plan-column").filter({ has: page.getByLabel(`${label}, contenu du brief`) });
        await column.evaluate((element) => Promise.all(element.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
        while (await column.locator(".tv-plan-image-item").count()) await column.getByRole("button", { name: /^Supprimer la capture/ }).last().click();
        const text = page.getByLabel(`${label}, contenu du brief`);
        for (const long of [false,true]) {
          const value = long ? Array.from({length:12}, (_, i) => `Consigne ${i + 1} : vérifier le flux et transmettre les anomalies.`).join("\n").slice(0,500) : "Vérifier les priorités.";
          await text.fill(value);
          let textBox: { top: number; height: number } | null = null;
          for (const count of [0,1,3]) {
            if (count) await page.getByLabel(`${label}, capture d'écran`).setInputFiles(Array.from({length:count === 1 ? 1 : 2}, () => image));
            await expect(column.locator(".tv-plan-image-item")).toHaveCount(count);
            const geometry = await column.evaluate((element) => {
              const text = element.querySelector("textarea")!;
              const upload = element.querySelector(".tv-plan-image-upload")!;
              const a = text.getBoundingClientRect(), b = upload.getBoundingClientRect();
              const gallery = element.querySelector(".tv-plan-image-gallery");
              const g = gallery?.getBoundingClientRect();
              return { top: a.top, columnTop: element.getBoundingClientRect().top, scrollTop: element.scrollTop, transform: getComputedStyle(element).transform, height: a.height, collision: a.bottom > b.top + 1, galleryCollision: !!g && b.bottom > g.top + 1,
                galleryScrollable: !!gallery && gallery.scrollHeight > gallery.clientHeight, horizontal: element.scrollWidth > element.clientWidth + 1 };
            });
            expect(geometry.collision, JSON.stringify({width,height,screen,label,long,count,geometry})).toBe(false);
            expect(geometry.height).toBeGreaterThanOrEqual(118);
            expect(geometry.galleryCollision).toBe(false);
            expect(geometry.horizontal).toBe(false);
            if (!textBox) textBox = geometry;
            expect(Math.abs(geometry.top - textBox.top), JSON.stringify({width,height,screen,label,long,count,geometry,textBox})).toBeLessThan(1);
            expect(geometry.height).toBe(textBox.height);
            if (count === 3) expect(geometry.galleryScrollable).toBe(true);
            await expect(text).toHaveValue(value);
          }
          await column.evaluate((element) => { element.scrollTop = 0; element.querySelector("textarea")!.scrollTop = 0; });
          await column.screenshot({ path: info.outputPath(`${width}-${height}-${screen}-${label}-${long}.png`) });
          for (let count = 3; count > 0; count--) {
            await column.getByRole("button", { name: /^Supprimer la capture/ }).last().click();
            await expect(column.locator(".tv-plan-image-item")).toHaveCount(count - 1);
          }
        }
      }
      await page.getByLabel("SAV, capture d'écran").setInputFiles([image,image,image]);
      await expect(page.locator(".tv-plan-image-item")).toHaveCount(3);
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await expect(page.getByRole("button", { name: "Écrire", exact: true })).toBeVisible();
      await expect(page.locator(".tv-plan-image-gallery img")).toHaveCount(3);
      await expect(page.locator(".tv-plan-content").first()).toContainText("Consigne 1");
      await page.getByRole("button", { name: "Écrire", exact: true }).click();
      const original = await page.getByLabel("SAV, contenu du brief").inputValue();
      await page.getByLabel("SAV, contenu du brief").fill("Modification annulée");
      await page.getByRole("button", { name: "Supprimer la capture SAV 1", exact: true }).click();
      await page.getByRole("button", { name: "Annuler", exact: true }).click();
      await expect(page.locator(".tv-plan-content").first()).toHaveText(original);
      await expect(page.locator(".tv-plan-image-gallery img")).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (screen === "fullscreen") await page.getByRole("button", { name: "Quitter le plein écran", exact: true }).click();
    }
  }
});
