import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agencies = [
  { code: "LIT", name: "Agency LIT", accessCode: "write-lit", canImport: true },
  { code: "LIT", name: "Reader LIT", accessCode: "read-lit", canImport: false },
  { code: "OTH", name: "Other agency", accessCode: "write-other", canImport: true },
];

async function withServer(writes, run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "stef-litigation-"));
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port),
      STEF_BIND_HOST: "127.0.0.1", STEF_DATA_DIR: directory,
      STEF_LITIGATION_WRITES_ENABLED: writes ? "true" : "false",
      STEF_AGENCIES_JSON: JSON.stringify(agencies) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", chunk => { logs += chunk; });
  child.stderr.on("data", chunk => { logs += chunk; });
  const base = `http://127.0.0.1:${port}/api/agencies`;
  const request = (agency = "LIT", access = "write-lit", method = "GET", body) =>
    fetch(`${base}/${agency}/litigations`, {
      method, headers: { "x-access-code": access, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const readSafety = (agency = "LIT", access = "write-lit") =>
    fetch(`${base}/${agency}/safety`, {
      headers: { "x-access-code": access },
    });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break; } }
      catch { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, logs);
    await run({ directory, request, readSafety });
    assert.equal(logs.includes("write-lit"), false);
  } finally {
    if (child.exitCode === null) {
      const close = once(child, "close");
      child.kill("SIGTERM");
      await close;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const litige = {
  reference: "LIT-2026-001",
  travelCode: "VOY-123",
  description: "Écart de livraison confirmé",
  openedAt: "2026-10-01",
  status: "open",
  closedAt: null,
};

test("C3 : aucun litige inventé, CRUD sans suppression, statuts et historique", async () => {
  await withServer(true, async ({ request, directory }) => {
    const original = await (await request()).json();
    assert.equal(original.sourceAvailable, false);
    assert.equal(original.totals, null);
    assert.equal(original.revision, null);
    const missing = await request("LIT", "write-lit", "PUT", { record: litige });
    assert.equal(missing.status, 428);
    assert.deepEqual(await fs.readdir(directory), []);
    const invalid = await request("LIT", "write-lit", "PUT", {
      record: { ...litige, openedAt: "2026-02-30" }, expectedRevision: null,
    });
    assert.equal(invalid.status, 400);
    const invalidFuture = await request("LIT", "write-lit", "PUT", {
      record: { ...litige, openedAt: "9999-12-31" }, expectedRevision: null,
    });
    assert.equal(invalidFuture.status, 400);
    const invalidClose = await request("LIT", "write-lit", "PUT", {
      record: { ...litige, status: "closed", closedAt: "2026-09-30" }, expectedRevision: null,
    });
    assert.equal(invalidClose.status, 400);
    assert.deepEqual(await fs.readdir(directory), []);

    const first = await request("LIT", "write-lit", "PUT", { record: litige, expectedRevision: null });
    assert.equal(first.status, 200);
    const state = await first.json();
    assert.equal(state.totals.total, 1);
    assert.equal(state.totals.open, 1);
    assert.equal(state.totals.closed, 0);
    assert.equal(state.records[0].reference, litige.reference);
    assert.equal(state.history.length, 1);

    const read = await (await request("LIT", "read-lit")).json();
    assert.equal(read.totals.total, 1);
    assert.equal(read.editable, false);
    assert.equal((await request("LIT", "read-lit", "PUT",
      { record: litige, expectedRevision: state.revision })).status, 403);
    assert.equal((await (await request("OTH", "write-other")).json()).totals, null);
    assert.equal((await request("OTH", "write-lit")).status, 401);

    const pathToFile = path.join(directory, "LIT", "litigations.json");
    const bytes = await fs.readFile(pathToFile, "utf8");
    const stale = await request("LIT", "write-lit", "PUT", {
      record: { ...litige, status: "closed", closedAt: "2026-10-05" }, expectedRevision: null,
    });
    assert.equal(stale.status, 409);
    assert.equal(await fs.readFile(pathToFile, "utf8"), bytes);

    const badCorrection = await request("LIT", "write-lit", "PUT", {
      record: { ...litige, status: "closed", closedAt: "2026-10-05" }, expectedRevision: state.revision,
    });
    assert.equal(badCorrection.status, 400);
    assert.equal(await fs.readFile(pathToFile, "utf8"), bytes);

    const closed = await request("LIT", "write-lit", "PUT", {
      record: { ...litige, status: "closed", closedAt: "2026-10-05" },
      expectedRevision: state.revision, changeReason: "Litige clôturé après confirmation",
    });
    assert.equal(closed.status, 200);
    const changed = await closed.json();
    assert.equal(changed.totals.open, 0);
    assert.equal(changed.totals.closed, 1);
    assert.equal(changed.history.length, 2);
    assert.equal(changed.history[1].previous.status, "open");
    assert.equal(changed.history[1].current.status, "closed");
    assert.equal(changed.history[1].reason, "Litige clôturé après confirmation");

    const duplicateRef = await request("LIT", "write-lit", "PUT", {
      expectedRevision: changed.revision,
      record: { ...litige, reference: "lit-2026-001", description: "Autre description" },
      changeReason: "Correction de saisie",
    });
    assert.equal(duplicateRef.status, 200);
    const corrected = await duplicateRef.json();
    assert.equal(corrected.totals.total, 1, "Case-insensitive reference cannot duplicate a litigation.");
    assert.equal(corrected.history.length, 3);
  });
});

test("C3 : écritures interdites sur une production sans stockage garanti", async () => {
  await withServer(false, async ({ request, readSafety, directory }) => {
    const initial = await (await request()).json();
    assert.equal(initial.editable, false);
    const safety = await (await readSafety()).json();
    assert.equal(safety.editable, true, "Temporary safety date allowed by default must not unlock litigation writes");
    assert.equal((await request("LIT", "write-lit", "PUT",
      { expectedRevision: null, record: litige })).status, 503);
    assert.deepEqual(await fs.readdir(directory), []);
  });
});
