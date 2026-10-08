import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Snapshot } from "../src/types";

test.use({ reducedMotion: "reduce" });

test("cérémonie : quatre fiches alignées, noms longs et gagnants distincts", async ({ page }, info) => {
  test.setTimeout(180_000);
  const snapshot: Snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  const winners = [snapshot.highlights.bestScorer, snapshot.highlights.defensiveWall, snapshot.highlights.bestPasser].map((item) => item!.name);
  const expected = snapshot.players.filter((player) => player.operationTypes >= 2 && !winners.includes(player.name))
    .sort((a, b) => b.polyvalence - a.polyvalence || b.operations - a.operations)[0];
  await page.route("**/api/agencies/058/snapshot**", (route) => route.fulfill({ json: { snapshot } }));
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  const sizes = info.project.name === "desktop" ? [[1366,768],[1440,900],[1536,864],[1600,900],[1920,1080],[2560,1440],[1024,768]] : [[info.project.use.viewport!.width, info.project.use.viewport!.height]];
  for (const [width,height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const mode of ["normal", "celebration"]) {
      if (mode === "celebration") {
        await nav.getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
        await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
      }
      await nav.getByRole("button", { name: "Aller à Cérémonie des performances", exact: true }).click();
      const cards = page.locator(".category-awards button.award-card");
      await expect(cards).toHaveCount(4);
      await expect(page.locator(".award-card.polyvalent .award-copy > strong")).toHaveText(expected.name);
      const names = await cards.locator(".award-copy > strong").allTextContents();
      expect(new Set(names).size).toBe(4);
      for (const long of [false, true]) {
        if (long) await cards.evaluateAll((elements) => elements.forEach((card) => {
          const leader = card.querySelector(".award-copy > strong")!;
          leader.setAttribute("data-original", leader.textContent!);
          leader.textContent = "MARIAN-IONUT OLARIU";
          card.querySelectorAll(".award-challenger b").forEach((name) => { name.setAttribute("data-original", name.textContent!); name.textContent = "MOHAMMED EL ABDERRAHMANE"; });
        }));
        const boxes = await cards.evaluateAll((elements) => elements.map((card) => {
          const box = card.getBoundingClientRect();
          const cta = card.querySelector(".award-footer > em")!.getBoundingClientRect();
          const challenger = card.querySelector(".award-challengers")!.getBoundingClientRect();
          const footer = card.querySelector(".award-footer")!.getBoundingClientRect();
          return { height: box.height, top: box.top, y: cta.y, contained: cta.bottom <= box.bottom + 1, collision: challenger.bottom > footer.top + 1, overflow: card.scrollWidth > card.clientWidth + 1 };
        }));
        expect(boxes.every((box) => box.contained && !box.collision && !box.overflow), JSON.stringify({width,height,mode,long,boxes})).toBe(true);
        for (let index = 0; index < 4; index++) {
          const cta = cards.nth(index).locator(".award-footer > em");
          await cta.scrollIntoViewIfNeeded();
          expect(await cta.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return element.closest(".award-card")!.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          }), `CTA accessible ${width}x${height} ${mode} ${index}`).toBe(true);
        }
        for (const box of boxes) for (const other of boxes.filter((item) => Math.abs(item.top - box.top) < 1)) {
          expect(Math.abs(box.y - other.y)).toBeLessThan(1);
          expect(Math.abs(box.height - other.height)).toBeLessThan(1);
        }
        await page.locator(".category-awards").screenshot({ path: info.outputPath(`${width}-${height}-${mode}-${long}.png`) });
      }
      await cards.evaluateAll((elements) => elements.forEach((card) => card.querySelectorAll("[data-original]").forEach((element) => { element.textContent = element.getAttribute("data-original"); })));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (mode === "celebration") await page.getByRole("button", { name: "Sortir du mode Célébration", exact: true }).click();
    }
  }
  await nav.getByRole("button", { name: "Aller à Cérémonie des performances", exact: true }).click();
  for (let index = 0; index < 4; index++) {
    const card = page.locator(".category-awards button.award-card").nth(index);
    const name = await card.locator(".award-copy > strong").textContent();
    await card.locator(".award-footer > em").click();
    await expect(page.locator(".player-identity h2")).toHaveText(name!);
    await page.getByRole("button", { name: "Retour terrain", exact: true }).click();
    await nav.getByRole("button", { name: "Aller à Cérémonie des performances", exact: true }).click();
  }
});
