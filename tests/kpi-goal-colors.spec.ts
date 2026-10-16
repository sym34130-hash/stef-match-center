import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Snapshot } from "../src/types";

test.use({ reducedMotion: "reduce" });

const source: Snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
const metrics = { passRate: 50, loadingPercent: 60, unloadingPercent: 50.1, possessionPercent: 49.9 };

for (const league of [
  { name: "Argent", id: "argent", target: 50, conceded: ["pass-score-bubble", "possession-score-bubble"] },
  { name: "Or", id: "or", target: 60, conceded: ["pass-score-bubble", "loading-score-bubble", "reception-score-bubble", "possession-score-bubble"] },
]) {
  test(`Red KPI warnings match ${league.name} league and football conceded goals`, async ({ page }) => {
    await page.addInitScript((id) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("stef-match-active-league-058", id);
    }, league.id);
    const won = Object.values(metrics).filter(value => value > league.target).length;
    const snapshot: Snapshot = {
      ...source,
      performanceCriteria: { ...source.performanceCriteria!, scoreTargetPercent: league.target },
      operationalScore: {
        ...source.operationalScore!,
        status: "available",
        targetPercent: league.target,
        goalsFor: won,
        goalsAgainst: 4 - won,
        indicators: metrics,
      },
    };
    await page.route("**/api/agencies/058/snapshot**", route => route.fulfill({ json: { snapshot } }));
    await page.goto("/");
    await page.getByLabel("Code agence").selectOption("058");
    await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
    await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();

    const scoreboard = page.locator(".match-score-bubbles");
    for (const cls of ["pass-score-bubble", "loading-score-bubble", "reception-score-bubble", "possession-score-bubble"]) {
      const card = scoreboard.locator("." + cls);
      const conceded = league.conceded.includes(cls);
      await expect(card).toHaveClass(conceded ? /is-goal-conceded/ : /match-score-bubble/);
      if (conceded) {
        await expect(card.locator(".match-score-goal-warning")).toContainText("But encaissé");
        await expect(card.locator(".match-score-goal-warning")).toContainText(`objectif > ${league.target} %`);
        await expect(card.locator("strong")).toHaveCSS("color", "rgb(255, 120, 138)");
      } else {
        await expect(card).not.toHaveClass(/is-goal-conceded/);
        await expect(card.locator(".match-score-goal-warning")).toHaveCount(0);
      }
    }
    await expect(scoreboard.locator(".is-goal-conceded")).toHaveCount(4 - won);

    await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
    await expect(scoreboard.locator(".is-goal-conceded")).toHaveCount(4 - won);
  });
}
