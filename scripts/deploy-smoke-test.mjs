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

  const oversizedPlanResponse = await fetch(`http://localhost:${port}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: "x".repeat(10 * 1024 * 1024) }),
  });
  const oversizedPlanPayload = await oversizedPlanResponse.json();
  assert.equal(oversizedPlanResponse.status, 413, JSON.stringify(oversizedPlanPayload));
  assert.equal(oversizedPlanPayload.title, "REQUÊTE TROP VOLUMINEUSE", "Une requête JSON trop volumineuse doit rester contrôlée");

  const invalidWorkbookForm = new FormData();
  invalidWorkbookForm.append("file", new Blob(["not an xlsx workbook"]), "invalid.xlsx");
  const invalidImportResponse = await fetch(`http://localhost:${port}/api/agencies/${agencyCode}/import`, {
    method: "POST",
    headers: { "x-access-code": accessCode },
    body: invalidWorkbookForm,
  });
  const invalidImportPayload = await invalidImportResponse.json();
  assert.equal(invalidImportResponse.status, 400, JSON.stringify(invalidImportPayload));
  assert.equal(invalidImportPayload.title, "FICHIER NON IMPORTÉ", "Un classeur illisible doit rester une erreur contrôlée");

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
  assert.equal(snapshot.summary.duelWon, 2064, "Duels gagnés recalculés après import API");
  assert.equal(snapshot.summary.duelTotal, 2925, "Dénominateur score après import API");
  assert.equal(snapshot.summary.duelRate, 70.6, "Taux duels gagnés recalculé après import API");
  assert.equal(snapshot.summary.possessionPercent, 50.2, "Possession Zody après import API");
  assert.deepEqual(snapshot.summary.possessionPositions, { zonage: 663, reception: 1131, matched: 568 }, "Positions possession après import API");
  assert.equal(snapshot.match.score, 71, "Score recalculé après import API");
  assert.equal(snapshot.operationalScore.status, "available", "Score opérationnel disponible après import API");
  assert.equal(snapshot.operationalScore.goalsFor, 4, "Score opérationnel marqué après import API");
  assert.equal(snapshot.operationalScore.goalsAgainst, 0, "Score opérationnel encaissé après import API");
  assert.equal(typeof snapshot.operationalScore.indicators.unloadingPercent, "number", "Indicateur déchargement disponible après import API");
  assert.equal(snapshot.loadingQuality.targeted, 34, "Chargements cadrés après import API");
  assert.equal(snapshot.loadingQuality.offTarget, 1, "Chargements non cadrés après import API");
  assert.equal(snapshot.loadingQuality.nonTargetedShots[0].travelCode, "X47890", "Tir non cadré après import API");

  const latestResponse = await fetch(`http://localhost:${port}/api/agencies/${agencyCode}/snapshot`, {
    headers: { "x-access-code": accessCode },
  });
  const latestPayload = await latestResponse.json();
  assert.equal(latestResponse.status, 200, JSON.stringify(latestPayload));
  assert.equal(latestPayload.snapshot.match.score, 71, "Snapshot relu depuis STEF_DATA_DIR");

  const timeRangeResponse = await fetch(`http://localhost:${port}/api/agencies/${agencyCode}/time-range`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": accessCode,
    },
    body: JSON.stringify({ start: "13:00", end: "22:30" }),
  });
  const timeRangePayload = await timeRangeResponse.json();
  assert.equal(timeRangeResponse.status, 200, JSON.stringify(timeRangePayload));
  assert.equal(timeRangePayload.snapshot.summary.operations, 4595, "Opérations après changement de plage");
  assert.equal(timeRangePayload.snapshot.match.periodLabel, "13:00-22:30", "Plage active après changement");
  assert.equal(timeRangePayload.snapshot.match.timeRangeLabel, "13:00 - 22:30", "Libellé de plage affiché après changement");
  assert.equal(timeRangePayload.snapshot.summary.possessionPercent, 50.2, "Possession conservée sur la plage active de référence");
  assert.deepEqual(timeRangePayload.snapshot.summary.possessionPositions, { zonage: 663, reception: 1131, matched: 568 }, "Positions possession sur la plage active de référence");
  assert.deepEqual(
    timeRangePayload.snapshot.hourlyPerformance.map((item) => item.label),
    ["13h", "14h", "15h", "16h", "17h", "18h", "19h", "20h", "21h", "22h"],
    "Graphique horaire borné par la plage active par défaut",
  );
  assert.equal(timeRangePayload.snapshot.compositionPeriods.first.label, "13:00 - 17:45", "Première mi-temps alignée sur la plage active");
  assert.equal(timeRangePayload.snapshot.compositionPeriods.second.label, "17:45 - 22:30", "Deuxième mi-temps alignée sur la plage active");

  const narrowTimeRangeResponse = await fetch(`http://localhost:${port}/api/agencies/${agencyCode}/time-range`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": accessCode,
    },
    body: JSON.stringify({ start: "16:00", end: "18:00" }),
  });
  const narrowTimeRangePayload = await narrowTimeRangeResponse.json();
  assert.equal(narrowTimeRangeResponse.status, 200, JSON.stringify(narrowTimeRangePayload));
  assert.equal(narrowTimeRangePayload.snapshot.summary.operations, 1185, "Opérations après réduction de la plage");
  assert.equal(narrowTimeRangePayload.snapshot.summary.possessionPercent, 34.1, "Possession recalculée après réduction de la plage");
  assert.deepEqual(narrowTimeRangePayload.snapshot.summary.possessionPositions, { zonage: 117, reception: 179, matched: 61 }, "Positions possession après réduction de la plage");
  assert.deepEqual(
    narrowTimeRangePayload.snapshot.hourlyPerformance.map((item) => item.label),
    ["16h", "17h", "18h"],
    "Graphique horaire recalculé après réduction de la plage",
  );

  const wideTimeRangeResponse = await fetch(`http://localhost:${port}/api/agencies/${agencyCode}/time-range`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": accessCode,
    },
    body: JSON.stringify({ start: "08:00", end: "22:30" }),
  });
  const wideTimeRangePayload = await wideTimeRangeResponse.json();
  assert.equal(wideTimeRangeResponse.status, 200, JSON.stringify(wideTimeRangePayload));
  assert.equal(wideTimeRangePayload.snapshot.match.periodLabel, "08:00-22:30", "Nouvelle plage active après élargissement");
  assert.equal(wideTimeRangePayload.snapshot.compositionPeriods.first.label, "08:00 - 15:15", "Première mi-temps recalculée après élargissement");
  assert.equal(wideTimeRangePayload.snapshot.compositionPeriods.second.label, "15:15 - 22:30", "Deuxième mi-temps recalculée après élargissement");

  const invalidTimeRangeResponse = await fetch(`http://localhost:${port}/api/agencies/${agencyCode}/time-range`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": accessCode,
    },
    body: JSON.stringify({ start: "08:15", end: "09:00" }),
  });
  assert.equal(invalidTimeRangeResponse.status, 400, "Une plage qui n'est pas sur 00/30 doit être refusée");

  const tinyAttachment = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
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
        attachments: {
          attack: [tinyAttachment, tinyAttachment],
          midfield: [tinyAttachment],
          defense: [],
        },
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
  assert.equal(causeriePayload.plan.attachments.attack.length, 2, "Les captures multiples de la zone attaque doivent être conservées");
  assert.equal(causeriePayload.plan.attachments.midfield.length, 1, "La capture de la zone milieu doit être conservée");
  assert.equal(causeriePayload.plan.attachments.defense.length, 0, "Une zone sans capture doit rester vide");

  const expectedLatestPath = path.join(dataDir, sanitizeSegment(agencyCode), "latest.json");
  const expectedCauseriePath = path.join(
    dataDir,
    sanitizeSegment(agencyCode),
    "causeries",
    `${sanitizeSegment(snapshot.match.date)}.json`
  );
  assert.equal(await fileExists(expectedLatestPath), true, "latest.json doit être écrit dans STEF_DATA_DIR");
  assert.equal(await fileExists(expectedCauseriePath), true, "La causerie doit être écrite dans STEF_DATA_DIR");
  const savedCauserie = JSON.parse(await fs.readFile(expectedCauseriePath, "utf8"));
  assert.equal(savedCauserie.attachments.attack.length, 2, "Les captures multiples doivent être persistées dans STEF_DATA_DIR");

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
      .filter((entry) => entry.isFile() && isWorkbookFile(entry.name))
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

function isWorkbookFile(name) {
  const normalized = String(name ?? "").toLowerCase();
  return normalized.endsWith(".xlsx") && !normalized.startsWith("~$");
}
