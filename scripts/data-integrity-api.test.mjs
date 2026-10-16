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


// The template is a tiny deterministic, synthetic ReportLab PDF with a valid
// cross-reference table. Replacement dates are same-length ASCII strings.
const pdfTemplate = "JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA2MTIgNzkyIF0gL1BhcmVudCA2IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNiAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMDAwMTAxMDAwMDAwKzAwJzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMDAwMTAxMDAwMDAwKzAwJzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovTGVuZ3RoIDIyNgo+PgpzdHJlYW0KMSAwIDAgMSAwIDAgY20gIEJUIC9GMSAxMiBUZiAxNC40IFRMIEVUCkJUIC9GMSAxMiBUZiAxNC40IFRMIEVUCkJUIDEgMCAwIDEgNTAgNzQwIFRtIChTSUUuMTA2SiBEYXRlIGRlIHJlZmVyZW5jZSBkZSBjYWxjdWwgOiAxOCBzZXB0ZW1icmUgMjAyNikgVGogVCogRVQKQlQgMSAwIDAgMSA1MCA3MjAgVG0gKFRhdXggZGUgcG9uY3R1YWxpdGUgQXJyaXZhZ2UgJSA4MSwwMCAlKSBUaiBUKiBFVAogCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDYxIDAwMDAwIG4gCjAwMDAwMDAwOTIgMDAwMDAgbiAKMDAwMDAwMDE5OSAwMDAwMCBuIAowMDAwMDAwMzkyIDAwMDAwIG4gCjAwMDAwMDA0NjAgMDAwMDAgbiAKMDAwMDAwMDcyMSAwMDAwMCBuIAowMDAwMDAwNzgwIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPDFjMTc4MTk4ZmJkZmE1MWIyNTk5NWQ4OWQ0MTAyMDQzPjwxYzE3ODE5OGZiZGZhNTFiMjU5OTVkODlkNDEwMjA0Mz5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNSAwIFIKL1Jvb3QgNCAwIFIKL1NpemUgOAo+PgpzdGFydHhyZWYKMTA1NgolJUVPRgo=";
function small106jPdf(referenceDate, agencyCode = null) {
  const original = "18 septembre 2026";
  if (referenceDate.length !== original.length) throw new Error("PDF fixture needs an equally sized date");
  let pdf = Buffer.from(pdfTemplate, "base64").toString("latin1");
  if (!pdf.includes(original)) throw new Error("PDF template date not found");
  const originalByteLength = pdf.length;
  if (agencyCode) {
    // Add an agency Site line inside the valid synthetic PDF stream. Update its
    // byte length and the cross-reference start offset; no private 106J is used.
    const addedText = `BT 1 0 0 1 50 700 Tm (Site : STEF Transport AGEN [${agencyCode}]) Tj T* ET\n`;
    const length = pdf.match(/\\/Length (\\d+)/);
    if (!length || !pdf.includes("endstream")) throw new Error("PDF fixture has no editable stream");
    pdf = pdf.replace("endstream", addedText + "endstream");
    pdf = pdf.replace(length[0], `/Length ${Number(length[1]) + addedText.length}`);
  }
  // pdf-parse 1.1.1's historical PDF.js can mishandle a pooled small Buffer.
  // Pad the synthetic file with a legal PDF comment and update startxref,
  // so Multer creates a dedicated (>8k) underlying ArrayBuffer.
  const marker = "\nxref\n";
  const idx = pdf.indexOf(marker);
  const oldXref = pdf.match(/startxref\n(\d+)\n/);
  if (idx < 0 || !oldXref) throw new Error("PDF fixture lacks an xref table");
  const padding = "%" + " ".repeat(8192) + "\n";
  pdf = pdf.slice(0, idx + 1) + padding + pdf.slice(idx + 1);
  pdf = pdf.replace(/startxref\n\d+\n/, `startxref\n${Number(oldXref[1]) + (pdf.length - originalByteLength)}\n`);
  return Buffer.from(pdf.replace(original, referenceDate), "latin1");
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

    // A01/A02: the HTTP API accepts another reference day with a warning,
    // and preserves the original upload timestamp across snapshot re-reads.
    const sendPdf = async (referenceDate, sourceAgency = null) => {
      const form = new FormData();
      form.append("file", new Blob([small106jPdf(referenceDate, sourceAgency)], { type: "application/pdf" }), "106J-test.pdf");
      const response = await fetch(`${base}/api/agencies/01K/import`, {
        method: "POST", headers: { "x-access-code": "test-01K" }, body: form,
      });
      return { status: response.status, payload: await response.json() };
    };
    const wrongPdf = await sendPdf("20 septembre 2026");
    assert.equal(wrongPdf.status, 200, JSON.stringify(wrongPdf.payload));
    assert.equal(wrongPdf.payload.pdfAssociation?.status, "mismatched");
    assert.equal(wrongPdf.payload.snapshot.dailyIndicators.referenceDate, "20 septembre 2026");
    await fs.access(path.join(root, "01K", "latest-106j.pdf"));
    const wrongReread = await fetch(`${base}/api/agencies/01K/snapshot`, { headers: { "x-access-code": "test-01K" } });
    assert.equal(wrongReread.status, 200);
    assert.equal((await wrongReread.json()).snapshot.dailyIndicators?.referenceDate, "20 septembre 2026");
    const foreignPdf = await sendPdf("17 septembre 2026", "0058");
    assert.equal(foreignPdf.status, 200, JSON.stringify(foreignPdf.payload));
    assert.equal(foreignPdf.payload.pdfAssociation?.status, "mismatched-agency");
    assert.match(foreignPdf.payload.pdfAssociation.message, /Import autorisé/i);
    assert.equal(foreignPdf.payload.snapshot.dailyIndicators.agencyCode, "0058");
    assert.equal(foreignPdf.payload.snapshot.agency.code, "01K", "PDF must not change the workspace agency");
    const foreignReread = await fetch(`${base}/api/agencies/01K/snapshot`, { headers: { "x-access-code": "test-01K" } });
    assert.equal(foreignReread.status, 200);
    assert.equal((await foreignReread.json()).snapshot.dailyIndicators?.agencyCode, "0058");
    const correctPdf = await sendPdf("17 septembre 2026");
    assert.equal(correctPdf.status, 200, JSON.stringify(correctPdf.payload));
    const savedAt = correctPdf.payload.snapshot.dailyIndicators?.importedAt;
    assert.match(savedAt, /^2026-\d{2}-\d{2}T/);
    assert.equal(correctPdf.payload.snapshot.dailyIndicators.referenceDate, "17 septembre 2026");
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
    // Replace the Excel through the normal API, which also invalidates the
    // in-memory workbook cache; do not directly overwrite a cached source.
    const nextExcel = await send("01K", midnightXlsx);
    assert.equal(nextExcel.status, 200, JSON.stringify(nextExcel.payload));
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
