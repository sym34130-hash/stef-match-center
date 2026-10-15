import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as XLSX from "xlsx";

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
  } finally {
    if (proc.exitCode === null) {
      const closed = once(proc, "close");
      proc.kill("SIGTERM");
      await closed;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
