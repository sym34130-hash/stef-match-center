import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";

function workbook(position) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Opérateur", "Date heure de début d'opération", "Type d'opération",
      "N° Position", "Code Voyage", "Agence Segment", "Type Segment",
      "Filtre opérateur", "Filtre heure", "Poste", "Poz non zonées", "DZ", "Duels gagnés"],
    ["OP TEST", "17/09/2026 22:00:00", "DECHG", position, "TEST-01", "05R", "Test", "", "", "", "", "", ""],
  ]), "Données");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}


function small106jPdf(referenceDate) {
  const stream = [
    "BT /F1 12 Tf 48 744 Td",
    `(SIE.106J Date de reference de calcul : ${referenceDate}) Tj`,
    "0 -22 Td (Taux de ponctualite Arrivage % 81,00 %) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

test("A03 HTTP: confirmation signée, fichier et agence liés, aucune écriture avant accord", { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "stef-data-integrity-"));
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const agencies = ["01K", "04P", "05R"].map(code => ({
    code, name: `Test ${code}`, accessCode: `test-${code}`, canImport: true,
  }));
  const proc = spawn(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), STEF_BIND_HOST: "127.0.0.1",
      STEF_DATA_DIR: root, NODE_ENV: "production", STEF_AGENCIES_JSON: JSON.stringify(agencies) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  proc.stderr.on("data", value => { errors += value.toString(); });
  try {
    let ready = false;
    for (let i = 0; i < 70; i++) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; }
      } catch { /* test server starting */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `Temporary server must start: ${errors}`);
    const send = async (code, bytes, confirmation = null) => {
      const body = new FormData();
      body.append("file", new Blob([bytes]), "source.xlsx");
      if (confirmation) body.append("agencyConfirmation", confirmation);
      const response = await fetch(`${base}/api/agencies/${code}/import`, {
        method: "POST", headers: { "x-access-code": `test-${code}` }, body,
      });
      return { status: response.status, payload: await response.json() };
    };

    const original = workbook("P001");
    const first = await send("01K", original);
    assert.equal(first.status, 409, JSON.stringify(first.payload));
    assert.equal(first.payload.detectedAgency, "05R");
    assert.match(first.payload.agencyConfirmation, /^[0-9a-f]{64}$/);

    const snapshotBefore = await fetch(`${base}/api/agencies/01K/snapshot`, {
      headers: { "x-access-code": "test-01K" },
    });
    assert.equal(snapshotBefore.status, 404, "Rejected import must not create a snapshot");
    await assert.rejects(fs.access(path.join(root, "01K", "latest.xlsx")), { code: "ENOENT" });

    const altered = await send("01K", workbook("P002"), first.payload.agencyConfirmation);
    assert.equal(altered.status, 409, "Approval for a different XLSX must not work");
    const otherAgency = await send("04P", original, first.payload.agencyConfirmation);
    assert.equal(otherAgency.status, 409, "Approval for another agency must not work");

    const approved = await send("01K", original, first.payload.agencyConfirmation);
    assert.equal(approved.status, 200, JSON.stringify(approved.payload));
    assert.equal(approved.payload.snapshot.agency.code, "01K");
    assert.equal(approved.payload.snapshot.agency.detectedCode, "05R");
    await fs.access(path.join(root, "01K", "latest.xlsx"));
    await assert.rejects(fs.access(path.join(root, "04P", "latest.xlsx")), { code: "ENOENT" });

    // A01/A02: the complete HTTP PDF import path rejects another day and
    // preserves the real upload timestamp when rereading a matching report.
    const sendPdf = async (referenceDate) => {
      const form = new FormData();
      form.append("file", new Blob([small106jPdf(referenceDate)], { type: "application/pdf" }), "106J-test.pdf");
      const response = await fetch(`${base}/api/agencies/01K/import`, {
        method: "POST", headers: { "x-access-code": "test-01K" }, body: form,
      });
      return { status: response.status, payload: await response.json() };
    };
    const wrongPdf = await sendPdf("20 septembre 2026");
    assert.equal(wrongPdf.status, 422, JSON.stringify(wrongPdf.payload));
    await assert.rejects(fs.access(path.join(root, "01K", "latest-106j.pdf")), { code: "ENOENT" });
    const correctPdf = await sendPdf("18 septembre 2026");
    assert.equal(correctPdf.status, 200, JSON.stringify(correctPdf.payload));
    const savedAt = correctPdf.payload.snapshot.dailyIndicators?.importedAt;
    assert.match(savedAt, /^2026-\d{2}-\d{2}T/);
    assert.equal(correctPdf.payload.snapshot.dailyIndicators.referenceDate, "18 septembre 2026");
    const reread = await fetch(`${base}/api/agencies/01K/snapshot`, { headers: { "x-access-code": "test-01K" } });
    assert.equal(reread.status, 200);
    assert.equal((await reread.json()).snapshot.dailyIndicators?.importedAt, savedAt);


    // A05: one-time non-destructive migration of an old UTC-keyed Causerie.
    const agencyDir = path.join(root, "01K");
    const current = approved.payload.snapshot;
    current.match.date = "2026-09-18";
    current.match.legacyDate = "2026-09-17";
    await fs.writeFile(path.join(agencyDir, "latest.json"), JSON.stringify(current));
    const briefsDir = path.join(agencyDir, "causeries");
    await fs.mkdir(briefsDir, { recursive: true });
    const legacyPath = path.join(briefsDir, "2026-09-17.json");
    const newPath = path.join(briefsDir, "2026-09-18.json");
    const oldContents = JSON.stringify({
      briefLayoutVersion: 2, team: "EQUIPE", manager: "TEST",
      attack: ["Instruction conservée"], midfield: [], defense: [],
      attachments: { attack: [], midfield: [], defense: [] },
    });
    await fs.writeFile(legacyPath, oldContents);
    const migrated = await fetch(`${base}/api/agencies/01K/causerie?matchDate=2026-09-18`, {
      headers: { "x-access-code": "test-01K" },
    });
    assert.equal(migrated.status, 200);
    const state = await migrated.json();
    assert.deepEqual(state.plan.attack, ["Instruction conservée"]);
    assert.equal(await fs.readFile(legacyPath, "utf8"), oldContents, "Legacy brief must remain untouched");
    assert.equal(await fs.readFile(newPath, "utf8"), oldContents, "New date must receive the same brief");
    const secondRead = await fetch(`${base}/api/agencies/01K/causerie?matchDate=2026-09-18`, {
      headers: { "x-access-code": "test-01K" },
    });
    assert.equal(secondRead.status, 200);
    assert.equal((await secondRead.json()).causerieRevision, state.causerieRevision,
      "Repeated migration must not rewrite the same brief");

    // A05: a legacy UTC-keyed voyage exclusion must still apply after Paris-date migration.
    const midnightBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(midnightBook, XLSX.utils.aoa_to_sheet([
      ["Opérateur", "Date heure de début d'opération", "Type d'opération",
        "N° Position", "Code Voyage", "Agence Segment", "Type Segment",
        "Filtre opérateur", "Filtre heure", "Poste", "Poz non zonées", "DZ", "Duels gagnés"],
      ["OP TEST", "18/09/2026 00:30:00", "DECHG", "P101", "TRIP-A", "01K", "Test", "", "", "", "", "", ""],
      ["OP TEST", "18/09/2026 00:45:00", "DECHG", "P102", "TRIP-B", "01K", "Test", "", "", "", "", "", ""],
    ]), "Données");
    const midnightXlsx = XLSX.write(midnightBook, { type: "buffer", bookType: "xlsx" });
    const snapshotResult = buildSnapshotFromWorkbook(midnightXlsx, "midnight.xlsx", "01K",
      { start: "00:00", end: "02:00" });
    assert.equal(snapshotResult.ok, true, JSON.stringify(snapshotResult.error));
    assert.equal(snapshotResult.snapshot.match.date, "2026-09-18");
    assert.equal(snapshotResult.snapshot.match.legacyDate, "2026-09-17");
    await fs.writeFile(path.join(agencyDir, "latest.xlsx"), midnightXlsx);
    await fs.writeFile(path.join(agencyDir, "latest.json"), JSON.stringify(snapshotResult.snapshot));
    const legacyScope = "2026-09-17|00:00|02:00";
    const currentScope = "2026-09-18|00:00|02:00";
    await fs.writeFile(path.join(agencyDir, "travel-exclusions.json"), JSON.stringify({
      version: 1, scopes: { [legacyScope]: ["TRIP-A"] },
    }));
    const rangeResponse = await fetch(`${base}/api/agencies/01K/time-range`, {
      method: "POST",
      headers: { "x-access-code": "test-01K", "Content-Type": "application/json" },
      body: JSON.stringify({ start: "00:00", end: "02:00" }),
    });
    assert.equal(rangeResponse.status, 200, await rangeResponse.text().then(value => value.slice(0, 1000)));
    // Use a fresh request for the persisted result since the response body is consumed above.
    const currentResponse = await fetch(`${base}/api/agencies/01K/snapshot`, {
      headers: { "x-access-code": "test-01K" },
    });
    assert.equal(currentResponse.status, 200);
    const scoped = (await currentResponse.json()).snapshot;
    assert.deepEqual(scoped.excludedTravelCodes, ["TRIP-A"]);
    assert.equal(scoped.summary.operations, 1);
    const scopes = JSON.parse(await fs.readFile(path.join(agencyDir, "travel-exclusions.json"), "utf8")).scopes;
    assert.deepEqual(scopes[legacyScope], ["TRIP-A"], "Old exclusion state must remain intact");
    assert.equal(scopes[currentScope], undefined, "Read-through must not overwrite source scope");


  } finally {
    if (proc.exitCode === null) {
      const closed = once(proc, "close");
      proc.kill("SIGTERM");
      await closed;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
