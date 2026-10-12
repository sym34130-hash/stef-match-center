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

test("API : limite partagée entre session et routes protégées, proxy et cache privé", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "stef-auth-regression-"));
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port),
      STEF_BIND_HOST: "127.0.0.1", STEF_DATA_DIR: temporary,
      STEF_AGENCIES_JSON: JSON.stringify([{ code: "AUDIT", name: "Temporary audit", accessCode: "test-only-not-a-real-secret", canImport: true }]) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  server.stdout.on("data", chunk => { logs += chunk; });
  server.stderr.on("data", chunk => { logs += chunk; });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch { /* Startup only. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, "Temporary API must start");
    const protectedPaths = ["snapshot", "league-configs", "sync-state", "causerie?matchDate=2026-10-11"];
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await fetch(`${base}/api/agencies/AUDIT/${protectedPaths[attempt % protectedPaths.length]}`, {
        headers: { "x-access-code": "invalid", "x-forwarded-for": `198.51.100.${attempt + 1}, 203.0.113.7` },
      });
      assert.equal(response.status, 401);
    }
    const blockedRoute = await fetch(`${base}/api/agencies/AUDIT/snapshot`, {
      headers: { "x-access-code": "invalid", "x-forwarded-for": "198.51.100.99, 203.0.113.7" },
    });
    assert.equal(blockedRoute.status, 429, "Protected routes must not bypass the authentication limiter");
    assert.match(blockedRoute.headers.get("cache-control") ?? "", /no-store/, "Private errors must not be cached");
    const blockedSession = await fetch(`${base}/api/session`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.100, 203.0.113.7" },
      body: JSON.stringify({ agencyCode: "AUDIT", accessCode: "invalid" }),
    });
    assert.equal(blockedSession.status, 429, "Session and header authentication must share the same counter");
    const otherAgency = await fetch(`${base}/api/agencies/OTHER/snapshot`, { headers: { "x-access-code": "invalid", "x-forwarded-for": "203.0.113.7" } });
    assert.equal(otherAgency.status, 401, "Attempts must be isolated by agency");
    const otherIp = await fetch(`${base}/api/agencies/AUDIT/snapshot`, { headers: { "x-access-code": "invalid", "x-forwarded-for": "203.0.113.8" } });
    assert.equal(otherIp.status, 401, "An invalid attempt from another IP must not inherit the blocked client's counter");
    for (let request = 0; request < 25; request++) {
      const legitimate = await fetch(`${base}/api/agencies/AUDIT/sync-state`, { headers: { "x-access-code": "test-only-not-a-real-secret", "x-forwarded-for": "203.0.113.7" } });
      assert.equal(legitimate.status, 200, "Valid authenticated traffic must never be throttled by failed attempts");
    }
    const valid = await fetch(`${base}/api/session`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.8" },
      body: JSON.stringify({ agencyCode: "AUDIT", accessCode: "test-only-not-a-real-secret" }),
    });
    assert.equal(valid.status, 200, "A separate client must still be able to authenticate");
    assert.match(valid.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await valid.text()).includes("test-only-not-a-real-secret"), false, "Session responses must not disclose access codes");
    const malformed = await fetch(`${base}/api/session`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    });
    assert.equal(malformed.status, 400, "Malformed JSON is a client error, not a server failure");
    const unknownAgency = await fetch(`${base}/api/agencies/OTHER/snapshot`, {
      headers: { "x-access-code": "test-only-not-a-real-secret" },
    });
    assert.equal(unknownAgency.status, 401, "An access code must not authorize another agency");
    assert.deepEqual(await fs.readdir(temporary), [], "Rejected calls must not create agency data");
    assert.equal(logs.includes("test-only-not-a-real-secret"), false, "Server logs must not disclose access codes");
  } finally {
    if (server.exitCode === null) {
      const stopped = once(server, "close");
      server.kill("SIGTERM");
      await stopped;
    }
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
