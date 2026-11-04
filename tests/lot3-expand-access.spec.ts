import { expect, test, type Page } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

async function enterMatch(page: Page) {
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption("058");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  return page.getByRole("navigation", { name: "Navigation de la feuille de match" });
}

test("Agrandir accessible par navigation normale, souris et Tab sans recentrage préalable", async ({ page }, info) => {
  const navigation = await enterMatch(page);
  const expand = page.getByRole("button", { name: "Agrandir le graphique", exact: true });
  const dialog = page.getByRole("dialog", { name: "Graphique Performance horaire agrandi", exact: true });
  for (const mode of ["normal", "celebration"]) {
    if (mode === "celebration") {
      await navigation.getByRole("button", { name: "Aller à Coup de sifflet final", exact: true }).click();
      await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
    }
    await navigation.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
    console.log(JSON.stringify({ project: info.project.name, mode, trigger: await expand.boundingBox() }));
    await page.screenshot({ path: info.outputPath(`${mode}-avant-activation.png`) });
    // Exercise the actual journey: no evaluate-scroll, forced click or focus shortcut.
    await expand.click({ timeout: 5_000 });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(expand).toBeFocused();
    await page.keyboard.press("Tab");
    let reached = false;
    for (let step = 0; step < 200; step += 1) {
      if (await expand.evaluate(element => element === document.activeElement)) { reached = true; break; }
      await page.keyboard.press("Tab");
    }
    expect(reached, `${mode}: Agrandir atteignable avec Tab`).toBe(true);
    expect(await expand.evaluate(element => element.matches(":focus-visible"))).toBe(true);
    await expect(expand).toBeInViewport();
    expect(await expand.evaluate(element => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return !!hit && element.contains(hit);
    }), `${mode}: focus Agrandir non recouvert par la navigation`).toBe(true);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(expand).toBeFocused();
  }
});

for (const mode of ["normal", "celebration"]) {
  test(`Parcours voyages puis Agrandir sans recentrage : ${mode}`, async ({ page }, info) => {
    const navigation = await enterMatch(page);
    if (mode === "celebration") await page.getByRole("button", { name: "Mode célébration", exact: true }).click();
    await navigation.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
    const events: string[] = [];
    page.on("console", message => { if (message.text().startsWith("LOT3_PROBE ")) events.push(message.text().slice(11)); });
    await page.evaluate(() => {
      const trigger = document.querySelector(".performance-chart-panel > .performance-chart .performance-chart-travels")!;
      const log = (type: string) => console.debug("LOT3_PROBE " + JSON.stringify({
        type, time: performance.now(), scrollY, anchorTop: trigger.getBoundingClientRect().top,
        expanded: trigger.getAttribute("aria-expanded"), dialog: !!document.querySelector(".hourly-arrivals-detail"),
      }));
      let previous = false;
      new MutationObserver(() => {
        const current = !!document.querySelector(".hourly-arrivals-detail");
        if (current !== previous) { previous = current; log(current ? "dialog-open" : "dialog-close"); }
      }).observe(document.body, { childList: true, subtree: true });
      document.addEventListener("scroll", () => log("scroll"), true);
      trigger.addEventListener("click", () => log("click"));
    });
    try {
      const arrivals = page.locator(".performance-chart-panel > .performance-chart .performance-chart-travels").first();
      await arrivals.click();
      await expect(arrivals).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("dialog", { name: /^Voyages arrivés à / })).toBeVisible();
      await arrivals.evaluate((element) => element.dispatchEvent(new Event("scroll", { bubbles: true })));
      await expect(page.getByRole("dialog", { name: /^Voyages arrivés à / })).toBeVisible();
      if (mode === "normal" && info.project.name === "mobile") {
        const moved = await arrivals.evaluate((element) => {
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (parent.scrollHeight <= parent.clientHeight + 20 || (parent !== document.documentElement && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY))) continue;
            const before = parent.scrollTop;
            parent.scrollTop = before + (before < parent.scrollHeight - parent.clientHeight - 20 ? 20 : -20);
            return parent.scrollTop !== before;
          }
          return false;
        });
        expect(moved, "un vrai défilement est possible sur mobile").toBe(true);
        await expect(page.getByRole("dialog", { name: /^Voyages arrivés à / })).not.toBeVisible();
        await arrivals.click();
        await expect(page.getByRole("dialog", { name: /^Voyages arrivés à / })).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Agrandir le graphique", exact: true }).click({ timeout: 5_000 });
      await expect(page.getByRole("dialog", { name: "Graphique Performance horaire agrandi", exact: true })).toBeVisible();
    } finally {
      await page.screenshot({ path: info.outputPath(`${mode}-parcours-voyages.png`) });
      await info.attach("chronologie-clic-scroll-dialog", { body: JSON.stringify(events.map(event => JSON.parse(event)), null, 2), contentType: "application/json" });
    }
  });
}
