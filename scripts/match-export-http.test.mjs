import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import * as XLSX from "xlsx";
import pdfParse from "pdf-parse";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";

async function freePort() {
  const sock = net.createServer();
  sock.listen(0, "127.0.0.1");
  await once(sock, "listening");
  const number = sock.address().port;
  await new Promise(resolve => sock.close(resolve));
  return number;
}
async function waitHealth(url) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url + "/api/health")).ok) return; } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("API did not become ready");
}
function workbook(code) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Operateur", "Date Heure de debut d operation", "Type operation",
      "N position", "Code voyage", "Agence segment", "Type segment",
      "Filtre operateur", "Filtre heure", "Poste", "Poz non zonees", "DZ", "Duels gagnes", "Heure OP"],
    ["OPERATEUR-" + code, "2026-09-17T22:00:00+02:00", "DECHG",
      "P001", "VOYAGE-" + code, code, "EX", "", "", "", "", 20 / 1440, 1, 22],
  ]);
  XLSX.utils.book_append_sheet(book, sheet, "Données");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}
test("Lot E HTTP: only the authenticated agency can receive its own match PDF", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "stef-lot-e-"));
  const port = await freePort(), base = "http://127.0.0.1:" + port;
  let server = null, stderr = "";
  try {
    const criteria = { zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 };
    const snapshots = {};
    for (const code of ["058", "059"]) {
      const binary = workbook(code);
      const built = buildSnapshotFromWorkbook(binary, "match-" + code + ".xlsx", code, {
        start: "21:30", end: "06:30", criteria,
      });
      assert.equal(built.ok, true, "Synthetic Excel must produce snapshot for agency " + code);
      snapshots[code] = built.snapshot;
      await fs.mkdir(path.join(dataDir, code), { recursive: true });
      await fs.writeFile(path.join(dataDir, code, "latest.json"), JSON.stringify(built.snapshot));
      await fs.writeFile(path.join(dataDir, code, "latest.xlsx"), binary);
      const causeriesDir = path.join(dataDir, code, "causeries");
      await fs.mkdir(causeriesDir, { recursive: true });
      await fs.writeFile(path.join(causeriesDir, built.snapshot.match.date + ".json"), JSON.stringify({
        briefLayoutVersion: 2, visibleIndicatorsVersion: 2,
        visibleIndicators: ["positions", "accident-free-days"],
        team: "EQUIPE-" + code, manager: "RESPONSABLE-" + code,
        attack: ["CONSIGNE-ATTAQUE-" + code], midfield: ["CONSIGNE-MILIEU-" + code],
        defense: ["CONSIGNE-DEFENSE-" + code],
        coach: { tactic: "PRIORITE-" + code, priority: "SURVEILLER-" + code },
        attachments: { attack: [], midfield: [], defense: [] },
      }));
      await fs.writeFile(path.join(dataDir, code, "safety.json"), JSON.stringify({
        lastAccidentDate: code === "058" ? "2026-09-05" : "2026-09-06",
      }));
    }
    server = spawn(process.execPath, ["server/index.mjs"], {
      env: { ...process.env, STEF_DATA_DIR: dataDir, PORT: String(port),
        STEF_BIND_HOST: "127.0.0.1", NODE_ENV: "test",
        STEF_AGENCIES_JSON: JSON.stringify([
          { code: "058", name: "AGENCE-058", accessCode: "SECRET-058", canImport: true },
          { code: "059", name: "AGENCE-059", accessCode: "SECRET-059", canImport: true },
        ]),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stderr.on("data", chunk => { stderr += chunk.toString(); });
    await waitHealth(base);
    const query = code => new URLSearchParams({
      leagueId: "argent", matchDate: snapshots[code].match.date,
      importedAt: snapshots[code].importedAt,
      zonageMinutes: "30", loadingSeconds: "165", unloadingSeconds: "60", scoreTargetPercent: "50",
    });
    const uri = code => base + "/api/agencies/" + code + "/export/match.pdf?" + query(code);
    const blocked = await fetch(uri("059"), { headers: { "x-access-code": "SECRET-058" } });
    assert.equal(blocked.status, 401, "An agency's access code must not open another agency PDF");
    assert.notEqual(blocked.headers.get("Content-Type")?.includes("application/pdf"), true);
    const missing = await fetch(uri("058"));
    assert.equal(missing.status, 401);
    const badDate = await fetch(base + "/api/agencies/058/export/match.pdf?" + new URLSearchParams({
      leagueId: "argent", matchDate: "2026-10-01", importedAt: snapshots["058"].importedAt,
      zonageMinutes: "30", loadingSeconds: "165", unloadingSeconds: "60", scoreTargetPercent: "50",
    }), { headers: { "x-access-code": "SECRET-058" } });
    assert.equal(badDate.status, 409);
    // Client and stored criteria must match, and an obsolete import must fail.
    const mismatchedThreshold = new URLSearchParams(query("058"));
    mismatchedThreshold.set("loadingSeconds", "150");
    const badCriteria = await fetch(base + "/api/agencies/058/export/match.pdf?" + mismatchedThreshold,
      { headers: { "x-access-code": "SECRET-058" } });
    assert.equal(badCriteria.status, 409, "Different league KPI must never be silently exported");
    const staleImport = new URLSearchParams(query("058"));
    staleImport.set("importedAt", "2024-01-01T00:00:00.000Z");
    assert.equal((await fetch(base + "/api/agencies/058/export/match.pdf?" + staleImport,
      { headers: { "x-access-code": "SECRET-058" } })).status, 409);
    for (const code of ["058", "059"]) {
      const response = await fetch(uri(code), { headers: { "x-access-code": "SECRET-" + code } });
      if (response.status !== 200) {
        const description = await response.text();
        assert.fail("Valid PDF for agency " + code + " expected 200, got " + response.status + ": " + description);
      }
      assert.match(response.headers.get("Content-Type") ?? "", /application\/pdf/);
      assert.match(response.headers.get("Content-Disposition") ?? "", new RegExp("STEF_MATCH_" + code));
      assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
      const data = Buffer.from(await response.arrayBuffer());
      const parsed = await pdfParse(data);
      assert.match(parsed.text, new RegExp("AGENCE-" + code));
      assert.match(parsed.text, new RegExp("EQUIPE-" + code));
      assert.match(parsed.text, new RegExp("CONSIGNE-ATTAQUE-" + code));
      assert.match(parsed.text, new RegExp("PRIORITE-" + code));
      assert.doesNotMatch(parsed.text, /Tonnage distribution/i, "Hidden KPI must not be exported");
      const other = code === "058" ? "059" : "058";
      assert.doesNotMatch(parsed.text, new RegExp("AGENCE-" + other + "|EQUIPE-" + other + "|CONSIGNE-ATTAQUE-" + other));
    }
    // Switching league triggers a workbook rebuild. The original import stamp
    // must remain stable, otherwise the export would always return 409.
    const orQuery = new URLSearchParams(query("058"));
    orQuery.set("leagueId", "or");
    orQuery.set("zonageMinutes", "25");
    orQuery.set("loadingSeconds", "150");
    orQuery.set("unloadingSeconds", "55");
    orQuery.set("scoreTargetPercent", "60");
    const orResponse = await fetch(base + "/api/agencies/058/export/match.pdf?" + orQuery,
      { headers: { "x-access-code": "SECRET-058" } });
    assert.equal(orResponse.status, 200, "Switching league must not change the source import timestamp");
    const orPdf = await pdfParse(Buffer.from(await orResponse.arrayBuffer()));
    assert.match(orPdf.text, /LDC/);
    assert.match(orPdf.text, /CHG <= 150 s\/poz/);
    assert.match(orPdf.text, /CONSIGNE-ATTAQUE-058/);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const stopped = once(server, "close");
      server.kill("SIGTERM");
      await stopped;
    }
    await fs.rm(dataDir, { recursive: true, force: true });
    if (stderr.includes("Error:")) console.error(stderr.slice(-1200));
  }
});
