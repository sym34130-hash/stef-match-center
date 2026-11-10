import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";
import { buildMatchExportIdentity } from "../server/match-export-identity.mjs";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

async function allocatePort() {
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  const port = address.port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function waitForHealth(url) {
  for (let i = 0; i < 130; i++) {
    try { const res = await fetch(url); if (res.ok) return; } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("PDF test server startup failed");
}
function makeFixture(code) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Operateur", "Date Heure de debut d operation", "Type operation",
     "N position", "Code voyage", "Agence segment", "Type segment",
     "Filtre operateur", "Filtre heure", "Poste", "Poz non zonees", "DZ", "Duels gagnes", "Heure OP"],
    [`OPERATEUR-${code}`, "2026-09-17T22:00:00+02:00", "DECHG", "P001", "TR001",
      code, "EX", "", "", "", "", 20/1440, 1, 22],
  ]), "Données");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const criteria = { zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 };
  const result = buildSnapshotFromWorkbook(buffer, `MATCH-${code}.xlsx`, code,
    { start: "21:30", end: "06:30", criteria });
  assert.equal(result.ok, true, JSON.stringify(result.error ?? null));
  return { buffer, snapshot: result.snapshot, criteria };
}

const folder = await fs.mkdtemp(path.join(os.tmpdir(), "stef-match-pdf-test-"));
const servicePort = await allocatePort();
const fixtures = new Map();
for (const code of ["058", "059"]) {
  const fixture = makeFixture(code);
  fixtures.set(code, fixture);
  const agencyDir = path.join(folder, code);
  await fs.mkdir(agencyDir, { recursive: true });
  await fs.writeFile(path.join(agencyDir, "latest.json"), JSON.stringify(fixture.snapshot));
  await fs.writeFile(path.join(agencyDir, "latest.xlsx"), fixture.buffer);
}
const env = { ...process.env, PORT: String(servicePort), STEF_BIND_HOST: "127.0.0.1",
  STEF_DATA_DIR: folder, NODE_ENV: "test",
  STEF_AGENCIES_JSON: JSON.stringify([
    { code:"058", name:"Site alpha 058", accessCode:"PDF-058-ACCESS", canImport:true },
    { code:"059", name:"Site beta 059", accessCode:"PDF-059-ACCESS", canImport:true },
  ]) };
const server = spawn(process.execPath, ["server/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
server.stderr.on("data", chunk => { logs += chunk.toString(); });
const api = `http://127.0.0.1:${servicePort}`;

async function request(code, credentials, body) {
  return fetch(`${api}/api/agencies/${code}/match-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-code": credentials },
    body: JSON.stringify(body),
  });
}
try {
  await waitForHealth(`${api}/api/health`);
  const fixture = fixtures.get("058");
  const body = { matchDate: fixture.snapshot.match.date, importedAt: fixture.snapshot.importedAt,
    sourceName: fixture.snapshot.sourceName, leagueId:"argent", criteria: fixture.criteria,
    kpis:{ injuriesValue:"1", expectedPlayersValue:"3" } };

  const wrongAgency = await request("059", "PDF-058-ACCESS", body);
  assert.equal(wrongAgency.status, 401, "Agency 058 credential cannot render a 059 PDF");

  const stale = await request("058", "PDF-058-ACCESS", { ...body, matchDate:"2026-09-10" });
  assert.equal(stale.status, 409, "Wrong match date must fail before Chromium");

  const identity = buildMatchExportIdentity({
    sessionAgency:{ code:"058", name:"Site alpha 058" },
    snapshot:fixture.snapshot,
    league:{ id:"argent", ...fixture.criteria },
    briefPlan:null,
    briefPlanScope:`058:${fixture.snapshot.match.date}:${fixture.snapshot.importedAt}`,
    kpis:body.kpis,
  });
  assert.ok(identity.filename.endsWith(".pdf"));
  const response = await request("058", "PDF-058-ACCESS", body);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Valid agency PDF failed: HTTP ${response.status} ${detail}. ${logs.slice(-2200)}`);
  }
  assert.match(response.headers.get("content-type") ?? "", /application\/pdf/);
  assert.match(response.headers.get("content-disposition") ?? "", /STEF-MATCH-058/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-", "Must download a real PDF");
  assert.ok(bytes.byteLength > 6000, "PDF must contain content");
  const parsed = await pdfParse(bytes);
  assert.ok(parsed.numpages >= 4, `Expected multi-page full MATCH, got ${parsed.numpages}`);
  assert.match(parsed.text, /STEF MATCH CENTER/);
  assert.match(parsed.text, /058/);
  assert.ok(!parsed.text.includes("Site beta 059"), "PDF must not mention second agency");
  assert.match(parsed.text, /Le collectif en chiffres/i);
  assert.match(parsed.text, /Cérémonie des performances/i);
  assert.match(parsed.text, /Lecture opérationnelle/i);
  console.log(`Lot E PDF: ${bytes.byteLength} bytes, ${parsed.numpages} pages, agency 058 only, league argent`);
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, "close");
    server.kill("SIGTERM");
    await stopped;
  }
  await fs.rm(folder, { recursive: true, force: true });
}
