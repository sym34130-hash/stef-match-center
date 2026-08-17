import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const agencyCode = process.env.DEPLOY_SMOKE_AGENCY ?? "058";
const accessCode = process.env.DEPLOY_SMOKE_ACCESS_CODE ?? "smoke-access";
const workbookPath = process.env.DEPLOY_SMOKE_WORKBOOK
  ? path.resolve(process.env.DEPLOY_SMOKE_WORKBOOK)
  : await findLatestWorkbook(agencyCode);

const port = await getFreePort();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stef-match-center-deploy-"));
const dataDir = path.join(tempRoot, "agencies");
const serverLogs = [];
let server;

try {
  await fs.mkdir(dataDir, { recursive: true });
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      STEF_DATA_DIR: dataDir,
      STEF_UPLOAD_LIMIT_MB: "20",
      STEF_AGENCIES_JSON: JSON.stringify([
        { code: agencyCode, name: `Agence ${agencyCode}`, accessCode, canImport: true },
      ]),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (chunk) => serverLogs.push(chunk.toString()));
  server.stderr.on("data", (chunk) => serverLogs.push(chunk.toString()));

  await waitForHealth(port);

  const sessionResponse = await fetch(`http://localhost:${port}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agencyCode, accessCode }),
  });
  assert.equal(sessionResponse.status, 200, await safeText(sessionResponse));

  const workbook = await fs.readFile(workbookPath);
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([workbook], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    path.basename(workbookPath)
  );

  const importResponse = await fetch(`http://localhost:${port}/api/agencies/${agencyCode}/import`, {
    method: "POST",
    headers: { "x-access-code": accessCode },
    body: formData,
  });
  const importPayload = await importResponse.json();
  assert.equal(importResponse.status, 200, JSON.stringify(importPayload));
  assert.equal(importPayload.message, "MATCH ACTUALISÉ");

  const snapshot = importPayload.snapshot;
  assert.equal(snapshot.summary.operations, 4595, "Opérations filtrées après import API");
  assert.equal(snapshot.summary.positions, 1430, "Positions filtrées après import API");
  assert.equal(snapshot.summary.players, 20, "Joueurs filtrés après import API");
  assert.equal(snapshot.summary.duelWon, 2060, "Duels gagnés après import API");
  assert.equal(snapshot.summary.duelTotal, 2925, "Dénominateur score après import API");
  assert.equal(snapshot.summary.duelRate, 70.4, "Taux duels gagnés après import API");
  assert.equal(snapshot.match.score, 70, "Score après import API");

  const latestResponse = await fetch(`http://localhost:${port}/api/agencies/${agencyCode}/snapshot`, {
    headers: { "x-access-code": accessCode },
  });
  const latestPayload = await latestResponse.json();
  assert.equal(latestResponse.status, 200, JSON.stringify(latestPayload));
  assert.equal(latestPayload.snapshot.match.score, 70, "Snapshot relu depuis STEF_DATA_DIR");

  const causerieResponse = await fetch(`http://localhost:${port}/api/agencies/${agencyCode}/causerie`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": accessCode,
    },
    body: JSON.stringify({
      matchDate: snapshot.match.date,
      plan: {
        team: "Smoke test",
        manager: "QA",
        attack: ["Contrôle import"],
        midfield: ["Contrôle snapshot"],
        defense: ["Contrôle stockage"],
        coach: {
          tactic: "Valider le déploiement",
          priority: "Ne pas dégrader l'import Excel",
          arbitration: "Stop si réconciliation KO",
          review: "Avant partage",
        },
      },
    }),
  });
  const causeriePayload = await causerieResponse.json();
  assert.equal(causerieResponse.status, 200, JSON.stringify(causeriePayload));

  const expectedLatestPath = path.join(dataDir, sanitizeSegment(agencyCode), "latest.json");
  const expectedCauseriePath = path.join(
    dataDir,
    sanitizeSegment(agencyCode),
    "causeries",
    `${sanitizeSegment(snapshot.match.date)}.json`
  );
  assert.equal(await fileExists(expectedLatestPath), true, "latest.json doit être écrit dans STEF_DATA_DIR");
  assert.equal(await fileExists(expectedCauseriePath), true, "La causerie doit être écrite dans STEF_DATA_DIR");

  console.log(`Déploiement smoke test OK - ${path.basename(workbookPath)}`);
  console.log(`Serveur production: port ${port}, stockage temporaire ${dataDir}`);
  console.log(`Score ${snapshot.summary.duelWon}/${snapshot.summary.duelTotal} = ${snapshot.summary.duelRate}%`);
} finally {
  if (server && !server.killed) server.kill("SIGTERM");
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function waitForHealth(targetPort) {
  const deadline = Date.now() + 12_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${targetPort}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Serveur non disponible. ${lastError?.message ?? ""}\n${serverLogs.join("")}`);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      probe.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Port de test non trouvé."));
      });
    });
  });
}

async function findLatestWorkbook(code) {
  const uploadDir = path.join(rootDir, "data", "agencies", sanitizeSegment(code), "uploads");
  const entries = await fs.readdir(uploadDir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".xlsx"))
      .map(async (entry) => {
        const filePath = path.join(uploadDir, entry.name);
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      })
  );
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  assert.ok(files[0], `Aucun classeur importé trouvé pour l'agence ${code}.`);
  return files[0].filePath;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function sanitizeSegment(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
