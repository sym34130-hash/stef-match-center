import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import * as XLSX from "xlsx";

async function freePort() {
  const s = net.createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const port = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return port;
}

async function ready(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch { /* process starting */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Server never became available: ${url}`);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "stef-browser-integrity-"));
const apiPort = await freePort();
const webPort = await freePort();
const baseURL = `http://127.0.0.1:${webPort}`;
const commonEnv = {
  ...process.env, PORT: String(apiPort), VITE_PORT: String(webPort),
  STEF_BIND_HOST: "127.0.0.1", STEF_DATA_DIR: root,
  NODE_ENV: "test",
  STEF_AGENCIES_JSON: JSON.stringify([
    { code: "01K", name: "Montpellier", accessCode: "INTEGRATION-01K", canImport: true },
    { code: "05R", name: "Toulouse", accessCode: "INTEGRATION-05R", canImport: true },
  ]),
};
const api = spawn(process.execPath, ["server/index.mjs"], { env: commonEnv, stdio: ["ignore", "pipe", "pipe"] });
const vite = spawn("./node_modules/.bin/vite", ["--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { env: commonEnv, stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
for (const proc of [api, vite]) proc.stderr.on("data", chunk => { stderr += chunk.toString(); });
let browser;
try {
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`), ready(baseURL)]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Opérateur", "Date heure de début d'opération", "Type d'opération",
      "N° Position", "Code Voyage", "Agence Segment", "Type Segment",
      "Filtre opérateur", "Filtre heure", "Poste", "Poz non zonées", "DZ", "Duels gagnés"],
    ["OP TEST", "17/09/2026 22:00:00", "DECHG", "P001", "TRIP-001", "05R", "Test", "", "", "", "", "", ""],
  ]), "Données");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));
    await page.goto(baseURL);
    await page.getByLabel("Code agence").selectOption("01K");
    await page.getByLabel("Code d'accès").fill("INTEGRATION-01K");
    await page.getByRole("button", { name: "Accéder au match" }).click();
    await page.getByRole("button", { name: "MAJ Import", exact: true }).click();
    await page.locator(".import-source-drop-zone input[type=file]").first()
      .setInputFiles({ name: "multisegment.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
    await page.getByRole("button", { name: "Contrôler et importer Excel" }).click();
    const confirmation = page.getByRole("alert", { name: "Confirmation d’agence requise" });
    await confirmation.waitFor({ state: "visible", timeout: 20000 });
    assert.match(await confirmation.innerText(), /05R/);
    const before = await fetch(`http://127.0.0.1:${apiPort}/api/agencies/01K/snapshot`, { headers: { "x-access-code": "INTEGRATION-01K" } });
    if (viewport.width === 1366) assert.equal(before.status, 404);
    await confirmation.getByRole("button", { name: "Je confirme que ce fichier appartient à mon agence" }).click();
    await page.getByText("MATCH ACTUALISÉ", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
    assert.deepEqual(errors, [], `Unexpected React errors at ${viewport.width}px`);
    console.log(`Browser: login, upload, agency confirmation, completed import at ${viewport.width}px: OK`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  for (const proc of [api, vite]) {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGTERM");
      await Promise.race([once(proc, "close"), new Promise(resolve => setTimeout(resolve, 2000))]);
    }
  }
  await fs.rm(root, { recursive: true, force: true });
  if (stderr) console.log("Server diagnostics:", stderr.slice(-1200));
}
