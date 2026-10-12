import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("import partiel : sources KPI manquantes explicites, pas de message match prêt", async ({ page }) => {
  const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  const warning = "Tirs cadrés indisponible : Source Excel absente ou incomplète. Source requise : TCD PPT.";
  snapshot.validation.importReadiness = { status: "partial", unavailableKpis: [{ id: "loadingPercent", label: "Tirs cadrés", source: "TCD PPT", reason: "Source Excel absente ou incomplète" }] };
  snapshot.validation.warnings = [warning];
  snapshot.operationalScore.status = "unavailable";
  snapshot.operationalScore.indicators.loadingPercent = null;
  await page.route("**/api/agencies/058/import", route => route.fulfill({ json: { snapshot } }));
  await page.goto("/");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
  await page.getByRole("button", { name: "MAJ Import", exact: true }).click();
  await page.locator('input[type="file"][accept=".xlsx"]').setInputFiles({ name: "partiel.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("fixture interceptée") });
  await page.getByRole("button", { name: "Contrôler et importer Excel", exact: true }).click();
  await expect(page.locator(".import-result")).toContainText("IMPORT PARTIEL");
  await expect(page.locator(".import-result")).toContainText("le score opérationnel ne peut pas être calculé");
  await expect(page.locator(".import-result")).toContainText(warning);
  await expect(page.getByText("Le match est prêt.", { exact: true })).toHaveCount(0);
});

test("concurrence Brief : deux contextes, refus 409 et reprise après relecture", async ({ browser, baseURL }) => {
  const a = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-access-code": "LOCAL-058-DEV" } });
  const b = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-access-code": "LOCAL-058-DEV" } });
  const endpoint = "/api/agencies/058/causerie";
  const matchDate = "2099-10-12";
  const read = async (context: typeof a) => (await (await context.request.get(`${endpoint}?matchDate=${matchDate}`)).json());
  try {
    const initial = await read(a);
    expect((await a.request.post(endpoint, { data: { matchDate, expectedRevision: initial.causerieRevision, plan: { briefLayoutVersion: 2, attack: ["Initial"] } } })).status()).toBe(200);
    const r1a = await read(a), r1b = await read(b);
    expect(r1a.causerieRevision).toBe(r1b.causerieRevision);
    const saved = await a.request.post(endpoint, { data: { matchDate, expectedRevision: r1a.causerieRevision, plan: { ...r1a.plan, attack: ["Consigne A"] } } });
    expect(saved.status()).toBe(200);
    const r2 = await saved.json();
    expect(r2.causerieRevision).not.toBe(r1a.causerieRevision);
    const stale = await b.request.post(endpoint, { data: { matchDate, expectedRevision: r1b.causerieRevision, plan: { ...r1b.plan, defense: ["Consigne B"] } } });
    expect(stale.status()).toBe(409);
    expect((await read(a)).plan.attack[0]).toBe("Consigne A");
    const fresh = await read(b);
    expect(fresh.causerieRevision).toBe(r2.causerieRevision);
    expect((await b.request.post(endpoint, { data: { matchDate, expectedRevision: fresh.causerieRevision, plan: { ...fresh.plan, defense: ["Consigne B"] } } })).status()).toBe(200);
    expect((await read(a)).plan.attack[0]).toBe("Consigne A");
    expect((await a.request.post(endpoint, { data: { matchDate, plan: fresh.plan } })).status()).toBe(428);
  } finally { await a.close(); await b.close(); }
});

test("conflit UI : saisie conservée et abandon explicite avant relecture", async ({ page }) => {
  const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  let revision = "R1";
  let plan = { briefLayoutVersion: 2, attack: ["Initial"], midfield: [], defense: [] };
  await page.route("**/api/agencies/058/snapshot**", route => route.fulfill({ json: { snapshot } }));
  await page.route("**/api/agencies/058/causerie**", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.expectedRevision !== revision) { await route.fulfill({ status: 409, json: { message: "Une autre modification a été enregistrée.", plan, causerieRevision: revision } }); return; }
      plan = body.plan; revision = "R3";
    }
    await route.fulfill({ json: { plan, causerieRevision: revision } });
  });
  await page.goto("/");
  await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
  await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
  await expect(page.locator(".tv-plan-column.attack .tv-plan-content")).toHaveText("Initial");
  await page.getByRole("button", { name: "Écrire", exact: true }).click();
  const input = page.getByLabel("SAV, contenu du brief");
  await input.fill("Brouillon local B");
  plan = { ...plan, attack: ["Consigne A"] }; revision = "R2";
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Ta saisie locale est conservée");
  await expect(input).toHaveValue("Brouillon local B");
  expect(plan.attack).toEqual(["Consigne A"]);
  await page.getByRole("button", { name: "Abandonner ma saisie et charger la version serveur", exact: true }).click();
  await expect(page.locator(".tv-plan-column.attack .tv-plan-content")).toHaveText("Consigne A");
  await page.getByRole("button", { name: "Écrire", exact: true }).click();
  await input.fill("Version après relecture");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Écrire", exact: true })).toBeVisible();
  expect(revision).toBe("R3");
});

test("lightbox : focus, inert, Tab, Shift+Tab, Escape et retour au déclencheur", async ({ page }) => {
  const snapshot = JSON.parse(readFileSync("data/agencies/058/latest.json", "utf8"));
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  await page.route("**/api/agencies/058/snapshot**", route => route.fulfill({ json: { snapshot } }));
  await page.route("**/api/agencies/058/causerie**", route => route.fulfill({ json: { causerieRevision: "R1", plan: { briefLayoutVersion: 2, attack: ["SAV"], attachments: { attack: [image] } } } }));
  await page.goto("/"); await page.getByLabel("Code d'accès").fill("LOCAL-058-DEV");
  await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
  await page.getByRole("button", { name: "05 BRIEF ÉQUIPE", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Agrandir la capture SAV 1", exact: true });
  await trigger.click();
  const close = page.getByRole("button", { name: "Fermer la capture agrandie", exact: true });
  await expect(close).toBeFocused();
  expect(await page.locator("#root").evaluate(element => (element as HTMLElement).inert)).toBe(true);
  await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(close).toBeFocused();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog", { name: /Capture agrandie/ })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.locator("#root").evaluate(element => (element as HTMLElement).inert)).toBe(false);
  await trigger.click(); await close.click(); await expect(trigger).toBeFocused();
});
