import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSnapshotFromWorkbook } from "./match-engine.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.STEF_DATA_DIR
  ? path.resolve(process.env.STEF_DATA_DIR)
  : path.join(rootDir, "data", "agencies");
const agenciesPath = path.join(__dirname, "agencies.json");
const port = Number(process.env.PORT ?? 4174);
const uploadLimitMb = readEnvNumber("STEF_UPLOAD_LIMIT_MB", 20);

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimitMb * 1024 * 1024 },
});

app.use(express.json({ limit: "1mb" }));

const agencies = await loadAgencies();

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "STEF Match Center",
    agencies: agencies.length,
    storage: process.env.STEF_DATA_DIR ? "persistent-configured" : "local-default",
    uploadLimitMb,
  });
});

app.post("/api/session", (req, res) => {
  const { agencyCode, accessCode } = req.body ?? {};
  const agency = findAgency(agencyCode, accessCode);
  if (!agency) {
    res.status(401).json({
      title: "ACCÈS REFUSÉ",
      message: "Code agence ou code d'accès incorrect.",
    });
    return;
  }
  res.json({ agency: publicAgency(agency) });
});

app.get("/api/agencies/:agencyCode/snapshot", requireAgency, async (req, res) => {
  const snapshot = await readLatestSnapshot(req.agency.code);
  if (!snapshot) {
    res.status(404).json({
      title: "AUCUN MATCH IMPORTÉ",
      message: "Aucun fichier Excel n'a encore été importé pour cette agence.",
    });
    return;
  }
  res.json({ snapshot });
});

app.get("/api/agencies/:agencyCode/causerie", requireAgency, async (req, res) => {
  const matchDate = sanitizeDate(req.query.matchDate);
  if (!matchDate) {
    res.status(400).json({
      title: "CAUSERIE NON LUE",
      message: "La date du match est nécessaire pour retrouver la causerie.",
    });
    return;
  }
  const plan = await readCauseriePlan(req.agency.code, matchDate);
  res.json({ plan });
});

app.post("/api/agencies/:agencyCode/causerie", requireAgency, async (req, res) => {
  if (!req.agency.canImport) {
    res.status(403).json({
      title: "MODIFICATION NON AUTORISÉE",
      message: "Ce code d'accès permet uniquement de consulter la causerie.",
    });
    return;
  }

  const matchDate = sanitizeDate(req.body?.matchDate);
  if (!matchDate) {
    res.status(400).json({
      title: "CAUSERIE NON ENREGISTRÉE",
      message: "La date du match est nécessaire pour enregistrer la causerie.",
    });
    return;
  }

  const plan = normalizeCauseriePlan(req.body?.plan);
  await saveCauseriePlan(req.agency.code, matchDate, plan);
  res.json({
    message: "PLAN DE JEU ENREGISTRÉ",
    plan,
  });
});

app.post("/api/agencies/:agencyCode/import", requireAgency, upload.single("file"), async (req, res) => {
  if (!req.agency.canImport) {
    res.status(403).json({
      title: "IMPORT NON AUTORISÉ",
      message: "Ce code d'accès permet uniquement de consulter les résultats.",
    });
    return;
  }

  if (!req.file) {
    res.status(400).json({
      title: "FICHIER NON IMPORTÉ",
      message: "Aucun fichier Excel n'a été reçu.",
      action: "Sélectionne un fichier .xlsx et réessaie.",
    });
    return;
  }

  if (!req.file.originalname.toLowerCase().endsWith(".xlsx")) {
    res.status(400).json({
      title: "FICHIER NON IMPORTÉ",
      message: "Le fichier doit être au format .xlsx.",
      action: "Exporte le match au format Excel .xlsx puis réessaie.",
    });
    return;
  }

  const result = buildSnapshotFromWorkbook(req.file.buffer, req.file.originalname, req.agency.code);
  if (!result.ok) {
    res.status(400).json(result.error);
    return;
  }

  await saveImport(req.agency.code, req.file.originalname, req.file.buffer, result.snapshot);
  res.json({
    message: "MATCH ACTUALISÉ",
    snapshot: result.snapshot,
  });
});

const distDir = path.join(rootDir, "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError) {
    const isTooLarge = error.code === "LIMIT_FILE_SIZE";
    res.status(isTooLarge ? 413 : 400).json({
      title: isTooLarge ? "FICHIER TROP LOURD" : "FICHIER NON IMPORTÉ",
      message: isTooLarge
        ? `Le fichier Excel dépasse la limite autorisée de ${uploadLimitMb} Mo.`
        : "Le fichier n'a pas pu être contrôlé avant import.",
      action: isTooLarge
        ? "Réduis le fichier ou augmente la limite d'import côté serveur."
        : "Vérifie le fichier .xlsx puis réessaie.",
    });
    return;
  }
  next(error);
});

app.listen(port, () => {
  console.log(`STEF Match Center API ready on http://localhost:${port}`);
  console.log(`STEF Match Center data directory: ${dataDir}`);
});

async function loadAgencies() {
  if (process.env.STEF_AGENCIES_JSON) {
    const parsed = JSON.parse(process.env.STEF_AGENCIES_JSON);
    if (!Array.isArray(parsed)) {
      throw new Error("STEF_AGENCIES_JSON doit contenir une liste d'agences.");
    }
    return parsed;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("STEF_AGENCIES_JSON est obligatoire en production.");
  }
  const text = await fs.readFile(agenciesPath, "utf8");
  return JSON.parse(text);
}

function readEnvNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function findAgency(agencyCode, accessCode) {
  return agencies.find(
    (agency) =>
      String(agency.code).toUpperCase() === String(agencyCode ?? "").trim().toUpperCase() &&
      String(agency.accessCode) === String(accessCode ?? "").trim()
  );
}

function publicAgency(agency) {
  return {
    code: agency.code,
    name: agency.name,
    canImport: Boolean(agency.canImport),
  };
}

function requireAgency(req, res, next) {
  const agency = findAgency(req.params.agencyCode, req.header("x-access-code"));
  if (!agency) {
    res.status(401).json({
      title: "ACCÈS REFUSÉ",
      message: "Code agence ou code d'accès incorrect.",
    });
    return;
  }
  req.agency = agency;
  next();
}

async function saveImport(agencyCode, originalName, buffer, snapshot) {
  const safeAgency = sanitizeSegment(agencyCode);
  const agencyDir = path.join(dataDir, safeAgency);
  const uploadsDir = path.join(agencyDir, "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = sanitizeSegment(originalName.replace(/\.xlsx$/i, "")) || "match";
  const uploadPath = path.join(uploadsDir, `${stamp}-${safeName}.xlsx`);
  await fs.writeFile(uploadPath, buffer);
  await fs.writeFile(path.join(agencyDir, "latest.json"), JSON.stringify(snapshot, null, 2), "utf8");
}

async function readLatestSnapshot(agencyCode) {
  const latestPath = path.join(dataDir, sanitizeSegment(agencyCode), "latest.json");
  try {
    return JSON.parse(await fs.readFile(latestPath, "utf8"));
  } catch {
    return null;
  }
}

async function readCauseriePlan(agencyCode, matchDate) {
  const causeriePath = path.join(dataDir, sanitizeSegment(agencyCode), "causeries", `${sanitizeSegment(matchDate)}.json`);
  try {
    return JSON.parse(await fs.readFile(causeriePath, "utf8"));
  } catch {
    return null;
  }
}

async function saveCauseriePlan(agencyCode, matchDate, plan) {
  const causerieDir = path.join(dataDir, sanitizeSegment(agencyCode), "causeries");
  await fs.mkdir(causerieDir, { recursive: true });
  await fs.writeFile(
    path.join(causerieDir, `${sanitizeSegment(matchDate)}.json`),
    JSON.stringify(plan, null, 2),
    "utf8"
  );
}

function normalizeCauseriePlan(plan) {
  const input = plan && typeof plan === "object" ? plan : {};
  return {
    team: limitText(input.team, 48),
    manager: limitText(input.manager, 48),
    updatedAt: new Date().toISOString(),
    attack: normalizeLines(input.attack),
    midfield: normalizeLines(input.midfield),
    defense: normalizeLines(input.defense),
    coach: {
      tactic: limitText(input.coach?.tactic, 120),
      priority: limitText(input.coach?.priority, 120),
      arbitration: limitText(input.coach?.arbitration, 120),
      review: limitText(input.coach?.review, 80),
    },
  };
}

function normalizeLines(lines) {
  const clean = Array.isArray(lines)
    ? lines.map((line) => limitText(line, 96)).filter(Boolean).slice(0, 3)
    : [];
  while (clean.length < 3) clean.push("");
  return clean;
}

function limitText(value, maxLength) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function sanitizeDate(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function sanitizeSegment(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
