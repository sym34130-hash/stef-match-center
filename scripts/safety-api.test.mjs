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
const config = [
  { code: "SEC", name: "Safety test", accessCode: "safety-writer-only", canImport: true },
  { code: "SEC", name: "Safety read only", accessCode: "safety-reader-only", canImport: false },
  { code: "OTHER", name: "Other site", accessCode: "other-site-only", canImport: true },
];

async function withApi(writesEnabled, check) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "stef-safety-"));
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port),
      STEF_BIND_HOST: "127.0.0.1", STEF_DATA_DIR: directory,
      ...(writesEnabled === null ? {} : { STEF_SAFETY_WRITES_ENABLED: writesEnabled ? "true" : "false" }),
      STEF_AGENCIES_JSON: JSON.stringify(config) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", chunk => { logs += chunk; });
  child.stderr.on("data", chunk => { logs += chunk; });
  const base = `http://127.0.0.1:${port}/api/agencies`;
  const request = (agency = "SEC", code = "safety-writer-only", method = "GET", body) =>
    fetch(`${base}/${agency}/safety`, {
      method,
      headers: { "x-access-code": code, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break; }
      } catch { /* Starting up. */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, `API starts: ${logs}`);
    await check({ request, directory });
    for (const code of config.map(item => item.accessCode)) {
      assert.equal(logs.includes(code), false);
    }
  } finally {
    if (child.exitCode === null) {
      const stopped = once(child, "close");
      child.kill("SIGTERM");
      await stopped;
    }
    await fs.rm(directory, { force: true, recursive: true });
  }
}

test("C2 API : date manuelle par agence, lecture partagée, historique, révision et non-régression", async () => {
  await withApi(true, async ({ request, directory }) => {
    const initialResponse = await request();
    assert.equal(initialResponse.status, 200);
    const initial = await initialResponse.json();
    assert.equal(initial.lastAccidentDate, null);
    assert.equal(initial.counter.status, "unavailable");
    assert.equal(initial.counter.days, null);
    assert.equal(initial.revision, null);
    assert.equal(initial.editable, true);

    const missingRevision = await request("SEC", "safety-writer-only", "PUT", { lastAccidentDate: "2024-02-29" });
    assert.equal(missingRevision.status, 428);
    const badDate = await request("SEC", "safety-writer-only", "PUT",
      { expectedRevision: null, lastAccidentDate: "2026-02-29" });
    assert.equal(badDate.status, 400);
    const futureDate = await request("SEC", "safety-writer-only", "PUT",
      { expectedRevision: null, lastAccidentDate: "9999-12-31" });
    assert.equal(futureDate.status, 400);
    assert.deepEqual(await fs.readdir(directory), []);

    const first = await request("SEC", "safety-writer-only", "PUT",
      { expectedRevision: null, lastAccidentDate: "2024-02-29" });
    assert.equal(first.status, 200);
    const saved = await first.json();
    assert.equal(saved.lastAccidentDate, "2024-02-29");
    assert.equal(saved.history.length, 1);
    assert.ok(Number.isInteger(saved.counter.days) && saved.counter.days > 0);
    assert.equal(typeof saved.revision, "string");

    const reader = await request("SEC", "safety-reader-only");
    const readerState = await reader.json();
    assert.equal(readerState.lastAccidentDate, "2024-02-29");
    assert.equal(readerState.editable, false);
    assert.equal((await request("SEC", "safety-reader-only", "PUT",
      { expectedRevision: saved.revision, lastAccidentDate: "2024-03-01" })).status, 403);
    assert.equal((await request("OTHER", "other-site-only")).status, 200);
    assert.equal((await (await request("OTHER", "other-site-only")).json()).lastAccidentDate, null);
    assert.equal((await request("OTHER", "safety-writer-only")).status, 401);

    const file = path.join(directory, "SEC", "safety.json");
    const bytes = await fs.readFile(file, "utf8");
    assert.equal((await request("SEC", "safety-writer-only", "PUT",
      { expectedRevision: null, lastAccidentDate: "2024-03-01" })).status, 409);
    assert.equal(await fs.readFile(file, "utf8"), bytes);
    assert.equal((await request("SEC", "safety-writer-only", "PUT",
      { expectedRevision: saved.revision, lastAccidentDate: "2024-03-01" })).status, 400);
    assert.equal(await fs.readFile(file, "utf8"), bytes);

    const updated = await request("SEC", "safety-writer-only", "PUT",
      { expectedRevision: saved.revision, lastAccidentDate: "2024-03-01", reason: "Correction confirmée" });
    assert.equal(updated.status, 200);
    const changed = await updated.json();
    assert.equal(changed.history.length, 2);
    assert.equal(changed.history[1].previousDate, "2024-02-29");
    assert.equal(changed.history[1].newDate, "2024-03-01");
    assert.equal(changed.history[1].reason, "Correction confirmée");
    assert.equal(changed.counter.days, saved.counter.days - 1);
    const repeat = await request("SEC", "safety-writer-only", "PUT",
      { expectedRevision: changed.revision, lastAccidentDate: "2024-03-01" });
    assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).history.length, 2);
    assert.equal((await (await request()).json()).lastAccidentDate, "2024-03-01");
  });
});

test("C2 API : saisie verrouillée uniquement si désactivée explicitement", async () => {
  await withApi(false, async ({ request, directory }) => {
    const initial = await (await request()).json();
    assert.equal(initial.editable, false);
    const denied = await request("SEC", "safety-writer-only", "PUT",
      { expectedRevision: null, lastAccidentDate: "2024-02-29" });
    assert.equal(denied.status, 503);
    assert.deepEqual(await fs.readdir(directory), []);
  });
});

test("C2 API : production sans stockage persistant, date à ressaisir après perte du fichier", async () => {
  await withApi(null, async ({ request, directory }) => {
    const initial = await (await request()).json();
    assert.equal(initial.editable, true, "La production autorise la date manuelle par défaut");
    assert.equal(initial.counter.status, "unavailable");
    assert.equal(initial.counter.days, null);

    const response = await request("SEC", "safety-writer-only", "PUT", {
      expectedRevision: initial.revision,
      lastAccidentDate: "2024-02-29",
    });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.lastAccidentDate, "2024-02-29");
    assert.equal(saved.history.length, 1);
    assert.equal(saved.counter.status, "available");

    // Simulate an ephemeral Render filesystem reset without claiming
    // that the former accident never happened.
    await fs.rm(path.join(directory, "SEC", "safety.json"));
    const afterReset = await (await request()).json();
    assert.equal(afterReset.editable, true);
    assert.equal(afterReset.lastAccidentDate, null);
    assert.equal(afterReset.counter.status, "unavailable");
    assert.equal(afterReset.counter.days, null);
    assert.equal(afterReset.history.length, 0);
    assert.equal(afterReset.revision, null);

    const reentry = await request("SEC", "safety-writer-only", "PUT", {
      expectedRevision: null,
      lastAccidentDate: "2024-02-29",
    });
    assert.equal(reentry.status, 200, "La date peut être saisie de nouveau après réinitialisation");
    assert.equal((await reentry.json()).lastAccidentDate, "2024-02-29");
  });
});
