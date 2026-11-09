import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { chromium } from "@playwright/test";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";

async function port() {
  const sock = net.createServer();
  sock.listen(0, "127.0.0.1");
  await once(sock, "listening");
  const p = sock.address().port;
  await new Promise(resolve => sock.close(resolve));
  return p;
}
async function ready(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Local site did not start: " + url);
}

const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
  ["Operateur", "Date Heure de debut d operation", "Type operation",
    "N position", "Code voyage", "Agence segment", "Type segment",
    "Filtre operateur", "Filtre heure", "Poste", "Poz non zonees", "DZ", "Duels gagnes", "Heure OP"],
  ["Test", "2026-09-17T22:00:00+02:00", "DECHG", "P001", "TR001", "01K", "EX", "", "", "", "", 20/1440, 1, 22],
]), "Données");
const built = buildSnapshotFromWorkbook(
  XLSX.write(book, { type: "buffer", bookType: "xlsx" }),
  "safety-carousel-test.xlsx", "01K",
  { start: "21:30", end: "06:30", criteria: { zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 } },
);
assert.equal(built.ok, true, JSON.stringify(built.error ?? null));

const folder = await fs.mkdtemp(os.tmpdir() + "/stef-safety-carousel-");
const apiPort = await port(), webPort = await port();
const url = `http://127.0.0.1:${webPort}`;
const env = { ...process.env, PORT: String(apiPort), STEF_BIND_HOST: "127.0.0.1",
  STEF_DATA_DIR: folder, NODE_ENV: "test", STEF_AGENCIES_JSON: JSON.stringify([
    { code: "01K", name: "Montpellier", accessCode: "SAFETY-CAROUSEL-TEST", canImport: true },
  ]) };
const api = spawn(process.execPath, ["server/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
const vite = spawn("./node_modules/.bin/vite", ["--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
  { env, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
for (const proc of [api, vite]) proc.stderr.on("data", chunk => { logs += chunk.toString(); });
let browser;
try {
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`), ready(url)]);
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));
    await page.route("**/api/agencies/01K/snapshot**",
      route => route.fulfill({ json: { snapshot: built.snapshot } }));
    await page.goto(url);
    await page.getByLabel("Code agence").selectOption("01K");
    await page.getByLabel("Code d'accès").fill("SAFETY-CAROUSEL-TEST");
    await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();

    const carousel = page.getByRole("group", { name: "Défilement des indicateurs du match" });
    await carousel.waitFor({ state: "visible", timeout: 15000 });
    const slides = page.locator(".match-indicators-track > .match-indicator-slide");
    const safety = slides.filter({ has: page.locator(".match-indicator-card.is-safety") });
    assert.equal(await safety.count(), 1, "One and only one safety vignette in the original carousel");
    assert.equal(await page.locator(".match-indicators-area > .safety-counter").count(), 0,
      "No separate wide safety block");
    const safetyIndex = await safety.evaluate(el => Array.from(el.parentElement.children).indexOf(el));
    const injuryIndex = await page.locator('[data-indicator="injuries"]').evaluate(el => Array.from(el.parentElement.children).indexOf(el));
    assert.equal(safetyIndex, injuryIndex + 1, "Days without AT immediately follows the injuries vignette");

    await page.getByRole("button", { name: "Afficher Jours sans accident du travail" }).click();
    await safety.locator(".safety-card-last-date").getByText("Non renseignée").waitFor({ state: "visible" });
    assert.match(await safety.locator(".match-indicator-value").innerText(), /À renseigner/);

    const geometryBefore = await page.locator(".match-indicator-card").first().evaluate(el => {
      const rect = el.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    });
    const geometrySafety = await safety.locator(".match-indicator-card.is-safety").evaluate(el => {
      const rect = el.getBoundingClientRect();
      return { height: rect.height, width: rect.width, innerWidth: el.clientWidth,
        hasOverflowY: el.scrollHeight > el.clientHeight + 2 };
    });
    assert.ok(Math.abs(geometrySafety.width - geometryBefore.width) < 4,
      viewport.width + "px : Safety vignette must keep carousel card width");
    assert.ok(Math.abs(geometrySafety.height - geometryBefore.height) < 4,
      viewport.width + "px : Safety vignette must keep carousel card height");
    assert.equal(geometrySafety.hasOverflowY, false,
      viewport.width + "px : Safety vignette must fit without cut-off or internal vertical scrollbar");

    const form = safety.locator(".safety-card-form");
    assert.equal(await form.count(), 1);
    assert.ok(await form.locator('input[type="date"]').isVisible());
    await form.locator('input[type="date"]').fill("2026-10-01");
    await form.getByRole("button", { name: "Valider" }).click();

    const safetyResponse = await fetch(`http://127.0.0.1:${apiPort}/api/agencies/01K/safety`,
      { headers: { "x-access-code": "SAFETY-CAROUSEL-TEST" } });
    assert.equal(safetyResponse.status, 200);
    const saved = await safetyResponse.json();
    assert.equal(saved.lastAccidentDate, "2026-10-01");
    await page.waitForFunction(expected => {
      const node = document.querySelector('[data-indicator="accident-free-days"] .match-indicator-value');
      return node?.textContent?.trim() === expected;
    }, String(saved.counter.days), { timeout: 15000 });
    assert.match(await safety.locator(".safety-card-last-date").innerText(), /01\/10\/2026/);

    const after = await safety.locator(".match-indicator-card.is-safety").evaluate(el => ({
      height: el.getBoundingClientRect().height, scrolled: el.scrollHeight > el.clientHeight + 2,
    }));
    assert.equal(after.scrolled, false, viewport.width + "px : No clipped date controls after save");
    assert.deepEqual(errors, [], viewport.width + "px : no frontend JS errors");
    console.log(`Safety counter vignette ${viewport.width}px: compact layout, date saved, days recalculated`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  for (const proc of [api, vite]) {
    if (proc.exitCode === null && proc.signalCode === null) {
      const stopped = once(proc, "close");
      proc.kill("SIGTERM");
      await stopped;
    }
  }
  await fs.rm(folder, { recursive: true, force: true });
  if (logs.includes("Error:")) console.error(logs.slice(-2500));
}
