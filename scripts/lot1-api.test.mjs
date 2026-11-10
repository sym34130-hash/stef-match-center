import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const accessCode = "lot1-local-test-only";
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// Add a valid ancillary PNG text chunk to exercise exact data-URL size limits.
function pngDataUrl(length) {
  const png = Buffer.from(tinyPng.split(",")[1], "base64");
  const bytes = (length - 22) / 4 * 3;
  const content = Buffer.concat([Buffer.from("tEXtNote\0"), Buffer.alloc(bytes - png.length - 12 - 5, 65)]);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(content.length - 4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return `data:image/png;base64,${Buffer.concat([png.subarray(0, -12), size, content, checksum, png.subarray(-12)]).toString("base64")}`;
}

async function withApi(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "stef-lot1-api-"));
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), STEF_BIND_HOST: "127.0.0.1", STEF_DATA_DIR: directory,
      STEF_AGENCIES_JSON: JSON.stringify([{ code: "TEST", name: "Local test", accessCode, canImport: true }]) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  server.stdout.on("data", chunk => { logs += chunk; });
  server.stderr.on("data", chunk => { logs += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const headers = { "Content-Type": "application/json", "x-access-code": accessCode };
  const request = (endpoint, method = "GET", body) => fetch(`${base}/api/agencies/TEST/${endpoint}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch { /* Startup only. */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, "Isolated API starts");
    await run({ base, directory, request, headers });
    assert.equal(logs.includes(accessCode), false, "No access code in server logs");
  } finally {
    if (server.exitCode === null) { const stopped = once(server, "close"); server.kill("SIGTERM"); await stopped; }
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("1A: JSON normal accepté, compression refusée avant traitement, serveur disponible", async () => {
  await withApi(async ({ base, directory }) => {
    const login = JSON.stringify({ agencyCode: "TEST", accessCode });
    const headers = { "Content-Type": "application/json" };
    const normal = await fetch(`${base}/api/session`, { method: "POST", headers, body: login });
    assert.equal(normal.status, 200);
    for (const [encoding, compress] of [["gzip", gzipSync], ["deflate", deflateSync], ["br", brotliCompressSync]]) {
      for (const body of [compress(Buffer.from(login)), Buffer.from("not-compressed")]) {
        const response = await fetch(`${base}/api/session`, { method: "POST", headers: { ...headers, "Content-Encoding": encoding }, body });
        assert.equal(response.status, 415, encoding);
        assert.match((await response.json()).message, /compress/i);
      }
    }
    const invalid = await fetch(`${base}/api/session`, { method: "POST", headers, body: "{" });
    assert.equal(invalid.status, 400);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.deepEqual(await fs.readdir(directory), [], "No writes on rejected payloads");
  });
});

test("1B: précondition obligatoire, conflit concurrent et document intégral préservé", async () => {
  await withApi(async ({ directory, request }) => {
    const initial = await (await request("league-configs")).json();
    assert.equal((await request("league-configs", "PUT", { configs: initial.configs })).status, 428);
    assert.deepEqual(await fs.readdir(directory), []);
    const a = structuredClone(initial.configs), b = structuredClone(initial.configs);
    a[0].zonageMinutes = 46;
    a[2].loadingSeconds = 148;
    b[1].zonageMinutes = 31;
    const first = await request("league-configs", "PUT", { configs: a, expectedRevision: initial.leagueConfigRevision });
    assert.equal(first.status, 200);
    const saved = await first.json();
    assert.equal(typeof saved.leagueConfigRevision, "string");
    const file = path.join(directory, "TEST", "league-configs.json");
    const bytes = await fs.readFile(file, "utf8");
    const stale = await request("league-configs", "PUT", { configs: b, expectedRevision: initial.leagueConfigRevision });
    assert.equal(stale.status, 409);
    const conflict = await stale.json();
    assert.deepEqual(conflict.configs, a);
    assert.equal(conflict.leagueConfigRevision, saved.leagueConfigRevision);
    assert.equal(await fs.readFile(file, "utf8"), bytes);
    assert.deepEqual((await (await request("league-configs")).json()).configs, a);
    const retry = await request("league-configs", "PUT", { configs: b, expectedRevision: saved.leagueConfigRevision });
    assert.equal(retry.status, 200, "Explicit reload/reapply with current revision remains possible");
  });
});

test("1C: captures trop grandes ou invalides rejetées sans altérer le Brief", async () => {
  await withApi(async ({ directory, request }) => {
    const save = (plan, expectedRevision) => request("causerie", "POST", { matchDate: "2026-10-12", expectedRevision, plan });
    const plan = { briefLayoutVersion: 2, attack: ["Original"], attachments: { attack: [tinyPng] } };
    const first = await save(plan, null);
    assert.equal(first.status, 200);
    let current = await first.json();
    const under = pngDataUrl(259_998);
    assert.equal(under.length, 259_998);
    const nearLimit = await save({ ...plan, attachments: { attack: [under] } }, current.causerieRevision);
    assert.equal(nearLimit.status, 200);
    current = await nearLimit.json();
    assert.deepEqual(current.plan.attachments.attack, [under]);
    const file = path.join(directory, "TEST", "causeries", "2026-10-12.json");
    const bytes = await fs.readFile(file, "utf8");
    for (const image of [pngDataUrl(260_002), pngDataUrl(1_203_534), "data:image/png;base64,not-base64!", "data:image/png;base64,aGVsbG8=", 42, { invalid: true }]) {
      const response = await save({ ...plan, attack: ["Must not replace original"], attachments: { attack: [image] } }, current.causerieRevision);
      assert.equal(response.status, 400);
      assert.match((await response.json()).message, /capture/i);
      assert.equal(await fs.readFile(file, "utf8"), bytes);
    }
    const reread = await (await request("causerie?matchDate=2026-10-12")).json();
    assert.deepEqual(reread.plan, current.plan);
    assert.equal(reread.causerieRevision, current.causerieRevision);
  });
});

test("1D: dates du Brief strictement calendaires, refus sans création de fichier", async () => {
  await withApi(async ({ directory, request }) => {
    for (const matchDate of ["2026-99-99", "2026-02-31", "2026-02-29", "2100-02-29", "2026-04-31", "0000-01-01", ""]) {
      assert.equal((await request("causerie", "POST", { matchDate, expectedRevision: null, plan: { attack: ["Invalid"] } })).status, 400, matchDate);
      assert.equal((await request(`causerie?matchDate=${matchDate}`)).status, 400, matchDate);
    }
    assert.deepEqual(await fs.readdir(directory), []);
    for (const matchDate of ["2024-02-29", "2000-02-29", "2026-04-30", "2026-12-31"]) {
      assert.equal((await request("causerie", "POST", { matchDate, expectedRevision: null, plan: { attack: ["Valid"] } })).status, 200, matchDate);
    }
  });
});

test("1E: entrées auth surdimensionnées regroupées, refus bornés et client valide préservé", async () => {
  await withApi(async ({ base, directory }) => {
    const headers = { "Content-Type": "application/json" };
    for (let index = 0; index < 21; index++) {
      const response = await fetch(`${base}/api/session`, { method: "POST", headers,
        body: JSON.stringify({ agencyCode: `${"X".repeat(65536)}${index}`, accessCode: "invalid" }) });
      assert.equal(response.status, index < 20 ? 401 : 429);
    }
    const invalidCode = await fetch(`${base}/api/session`, { method: "POST", headers,
      body: JSON.stringify({ agencyCode: "TEST", accessCode: "Y".repeat(65536) }) });
    assert.equal(invalidCode.status, 401);
    const valid = await fetch(`${base}/api/session`, { method: "POST", headers, body: JSON.stringify({ agencyCode: "TEST", accessCode }) });
    assert.equal(valid.status, 200);
    assert.deepEqual(await fs.readdir(directory), []);
  });
});

test("1F: limite JSON effective de 14 Mio et message 413 cohérent", async () => {
  await withApi(async ({ base, directory }) => {
    const headers = { "Content-Type": "application/json" };
    const under = await fetch(`${base}/api/session`, { method: "POST", headers,
      body: JSON.stringify({ agencyCode: "TEST", accessCode: "wrong", padding: "x".repeat(13 * 1024 * 1024) }) });
    assert.equal(under.status, 401, "The body below 14 MiB is parsed normally");
    const over = await fetch(`${base}/api/session`, { method: "POST", headers, body: JSON.stringify({ padding: "x".repeat(14 * 1024 * 1024) }) });
    assert.equal(over.status, 413);
    assert.match((await over.json()).message, /14 Mio/);
    assert.deepEqual(await fs.readdir(directory), []);
  });
});

test("5S: imports multipart invalides, trop volumineux et interrompus préservent les données", async () => {
  await withApi(async ({ base, directory }) => {
    const endpoint = `${base}/api/agencies/TEST/import`;
    const upload = async (name, content) => {
      const body = new FormData();
      body.append("file", new Blob([content]), name);
      return fetch(endpoint, { method: "POST", headers: { "x-access-code": accessCode }, body });
    };

    assert.equal((await upload("invalid.txt", "not an Excel file")).status, 400);
    assert.equal((await upload("too-large.xlsx", Buffer.alloc(21 * 1024 * 1024))).status, 413);

    const aborted = http.request(endpoint, {
      method: "POST",
      headers: {
        "x-access-code": accessCode,
        "Content-Type": "multipart/form-data; boundary=aborted-upload",
        "Content-Length": 1024 * 1024,
      },
    });
    aborted.on("error", () => {});
    const closed = new Promise(resolve => aborted.once("close", resolve));
    await new Promise(resolve => aborted.once("socket", socket => socket.once("connect", resolve)));
    await new Promise(resolve => aborted.write("--aborted-upload\r\nContent-Disposition: form-data; name=\"file\"; filename=\"partial.xlsx\"\r\n\r\npartial", resolve));
    aborted.destroy();
    await closed;

    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.deepEqual(await fs.readdir(directory), [], "Rejected and aborted imports must not create agency files");
  });
});

test("AT : lecture héritée, enregistrement, masquage durable et isolation par match", async () => {
  await withApi(async ({ directory, request }) => {
    const matchDate = "2026-11-10";
    const file = path.join(directory, "TEST", "causeries", `${matchDate}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const historical = JSON.stringify({
      briefLayoutVersion: 2, visibleIndicators: ["performance", "positions"],
      coach: { priority: "Ne pas toucher aux consignes" },
    });
    await fs.writeFile(file, historical, "utf8");

    const response = await request(`causerie?matchDate=${matchDate}`);
    assert.equal(response.status, 200);
    const initial = await response.json();
    assert.deepEqual(initial.plan.visibleIndicators, ["performance", "accident-free-days", "positions"]);
    assert.equal(initial.plan.visibleIndicatorsVersion, 2);
    assert.equal(await fs.readFile(file, "utf8"), historical, "La lecture ne modifie pas le fichier historique");

    const migrated = await request("causerie", "POST", {
      matchDate, expectedRevision: initial.causerieRevision, plan: initial.plan,
    });
    assert.equal(migrated.status, 200);
    const saved = await migrated.json();
    assert.deepEqual(saved.plan.visibleIndicators, ["performance", "accident-free-days", "positions"]);
    assert.equal(saved.plan.coach.priority, "Ne pas toucher aux consignes");

    const hidden = await request("causerie", "POST", {
      matchDate, expectedRevision: saved.causerieRevision,
      plan: { ...saved.plan, visibleIndicators: ["performance", "positions"] },
    });
    assert.equal(hidden.status, 200);
    const afterHide = await hidden.json();
    assert.deepEqual(afterHide.plan.visibleIndicators, ["performance", "positions"]);
    assert.equal(afterHide.plan.visibleIndicatorsVersion, 2);
    assert.deepEqual((await (await request(`causerie?matchDate=${matchDate}`)).json()).plan.visibleIndicators,
      ["performance", "positions"], "Une désactivation enregistrée reste désactivée");
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).visibleIndicators, ["performance", "positions"]);

    const otherMatch = await request("causerie", "POST", {
      matchDate: "2026-11-11", expectedRevision: null, plan: { visibleIndicators: ["departure"] },
    });
    assert.equal(otherMatch.status, 200);
    assert.deepEqual((await otherMatch.json()).plan.visibleIndicators,
      ["accident-free-days", "departure"], "Un ancien plan migré dans un autre match n'hérite pas du masquage");
    assert.deepEqual((await (await request(`causerie?matchDate=${matchDate}`)).json()).plan.visibleIndicators,
      ["performance", "positions"]);
  });
});
