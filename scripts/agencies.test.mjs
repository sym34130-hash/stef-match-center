import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as XLSX from "xlsx";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await fs.readFile(path.join(root, "server/agencies.json"), "utf8"));

function workbookFor(code) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Opérateur", "Date/Heure de début d'opération", "Type d'opération", "N° Position", "Code Voyage", "Agence Segment", "Type Segment", "Filtre opérateur", "Filtre heure", "Poste", "Poz non zonées", "DZ", "Duels gagnés"],
    ["TEST ONLY", new Date("2026-10-12T14:00:00Z"), "DECHG", `${code}-P1`, `${code}-TRAVEL`, code, "TEST", "", "", "", "", 30, 1],
    ["TEST ONLY", new Date("2026-10-12T14:02:00Z"), "ZONAGE", `${code}-P1`, `${code}-TRAVEL`, code, "TEST", "", "", "", "", 30, 1],
  ]), "Données");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

async function withServer(agencies, run) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "stef-agencies-test-"));
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), STEF_BIND_HOST: "127.0.0.1", STEF_DATA_DIR: temporary, STEF_AGENCIES_JSON: JSON.stringify(agencies) },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch { /* Temporary server startup. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, "Temporary API must start");
    const request = async (code, endpoint, options = {}, credentials = code) => {
      const agency = agencies.find(item => item.code === credentials);
      return fetch(`${base}/api/agencies/${code}/${endpoint}`, { ...options, headers: { "x-access-code": agency.accessCode, ...options.headers } });
    };
    await run({ base, request, temporary });
  } finally {
    if (server.exitCode === null) {
      const stopped = once(server, "close");
      server.kill("SIGTERM");
      await stopped;
    }
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("six agences : catalogue public, connexion, état vide et isolation R3A / 04H", async () => {
  assert.deepEqual(catalog.map(item => item.code), ["058", "01K", "05R", "04P", "R3A", "04H"]);
  assert.ok(catalog.every(item => item.accessCode === `LOCAL-${item.code}-DEV`));
  await withServer(catalog, async ({ base, request, temporary }) => {
    const publicCatalog = await (await fetch(`${base}/api/agencies`)).json();
    assert.deepEqual(publicCatalog.agencies, catalog.map(({ code, name }) => ({ code, name })));
    for (const agency of catalog) {
      assert.equal(JSON.stringify(publicCatalog).includes(agency.accessCode), false);
      const session = await fetch(`${base}/api/session`, json("POST", { agencyCode: agency.code, accessCode: agency.accessCode }));
      assert.equal(session.status, 200);
      assert.deepEqual((await session.json()).agency, { code: agency.code, name: agency.name, canImport: true });
    }
    for (const code of ["R3A", "04H"]) {
      const wrong = await fetch(`${base}/api/session`, json("POST", { agencyCode: code, accessCode: "WRONG-TEST-ONLY" }));
      assert.equal(wrong.status, 401);
      const empty = await request(code, "snapshot");
      assert.equal(empty.status, 404);
      assert.equal((await empty.json()).title, "AUCUN MATCH IMPORTÉ");
      const other = code === "R3A" ? "04H" : "R3A";
      for (const endpoint of ["snapshot", "league-configs", "causerie?matchDate=2026-10-12", "sync-state"]) {
        assert.equal((await request(code, endpoint, {}, other)).status, 401);
      }
    }
    assert.deepEqual(await fs.readdir(temporary), [], "Reading empty agencies must not clone or create data");
    const originalConfigs = (await (await request("04H", "league-configs")).json()).configs;
    for (const [index, code] of ["R3A", "04H"].entries()) {
      const configs = originalConfigs.map(item => ({ ...item, zonageMinutes: item.zonageMinutes + index + 1 }));
      assert.equal((await request(code, "league-configs", json("PUT", { configs }))).status, 200);
      const saved = await request(code, "causerie", json("POST", { matchDate: "2026-10-12", expectedRevision: null, plan: { briefLayoutVersion: 2, attack: [code, "", ""] } }));
      assert.equal(saved.status, 200, await saved.clone().text());
      const body = new FormData();
      body.append("file", new Blob([workbookFor(code)]), `${code}-test.xlsx`);
      const imported = await request(code, "import", { method: "POST", body });
      assert.equal(imported.status, 200, await imported.clone().text());
      const snapshot = (await imported.json()).snapshot;
      assert.equal(snapshot.agency.code, code);
      assert.ok(snapshot.positions.some(item => item.travelCode === `${code}-TRAVEL`));
      assert.ok(snapshot.positions.every(item => item.travelCode === `${code}-TRAVEL`));
      if (code === "R3A") {
        assert.equal((await request("04H", "snapshot")).status, 404, "Lyon import must not create Brive snapshot");
        assert.deepEqual((await (await request("04H", "league-configs")).json()).configs, originalConfigs);
      }
    }
    const briveBefore = await fs.readFile(path.join(temporary, "04H/latest.json"));
    const exclusion = await request("R3A", "travel-exclusions", json("POST", { travelCode: "R3A-TRAVEL", excluded: true }));
    assert.equal(exclusion.status, 200, await exclusion.clone().text());
    assert.deepEqual(await fs.readFile(path.join(temporary, "04H/latest.json")), briveBefore, "Lyon exclusion must not alter Brive");
    for (const [index, code] of ["R3A", "04H"].entries()) {
      const brief = await (await request(code, "causerie?matchDate=2026-10-12")).json();
      assert.equal(brief.plan.attack[0], code);
      const configs = (await (await request(code, "league-configs")).json()).configs;
      assert.equal(configs[0].zonageMinutes, originalConfigs[0].zonageMinutes + index + 1);
      const other = code === "R3A" ? "04H" : "R3A";
      assert.equal((await request(code, "snapshot", {}, other)).status, 401);
      for (const endpoint of ["import", "causerie", "travel-exclusions"]) {
        assert.equal((await request(code, endpoint, json("POST", {}), other)).status, 401);
      }
      assert.equal((await request(code, "league-configs", json("PUT", {}), other)).status, 401);
      assert.deepEqual(await fs.readFile(path.join(temporary, code, "latest.xlsx")), workbookFor(code));
    }
    assert.deepEqual((await fs.readdir(temporary)).sort(), ["04H", "R3A"]);
  });
});

test("nouvelles agences : canImport false interdit les écritures sans bloquer la consultation", async () => {
  await withServer(catalog.map(item => ({ ...item, canImport: false })), async ({ base, request, temporary }) => {
    for (const code of ["R3A", "04H"]) {
      const session = await fetch(`${base}/api/session`, json("POST", { agencyCode: code, accessCode: `LOCAL-${code}-DEV` }));
      assert.equal((await session.json()).agency.canImport, false);
      assert.equal((await request(code, "sync-state")).status, 200);
      for (const [endpoint, method] of [["import", "POST"], ["causerie", "POST"], ["league-configs", "PUT"], ["travel-exclusions", "POST"]]) {
        assert.equal((await request(code, endpoint, json(method, {}))).status, 403);
      }
    }
    assert.deepEqual(await fs.readdir(temporary), []);
  });
});
