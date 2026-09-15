import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCompositionViewFromWorkbook, buildSnapshotFromWorkbook, KPI_DICTIONARY_VERSION, normalizePerformanceCriteria, normalizeSnapshotContract, normalizeTimeRange } from "./match-engine.mjs";
import { parse106jPdf } from "./pdf-106j.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.STEF_DATA_DIR
  ? path.resolve(process.env.STEF_DATA_DIR)
  : path.join(rootDir, "data", "agencies");
const agenciesPath = path.join(__dirname, "agencies.json");
const port = Number(process.env.PORT ?? 4174);
const uploadLimitMb = readEnvNumber("STEF_UPLOAD_LIMIT_MB", 20);
const compositionRangeCache = new Map();
const workbookReadPromises = new Map();
const agencyOperationQueues = new Map();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimitMb * 1024 * 1024 },
});

// A plan can contain several resized captures; keep the JSON body bounded but
// large enough for the client-side gallery limit.
app.use(express.json({ limit: "10mb" }));

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

app.get("/api/agencies", (_req, res) => {
  res.json({
    agencies: agencies.map((agency) => ({ code: agency.code, name: agency.name })),
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

app.get("/api/agencies/:agencyCode/league-configs", requireAgency, async (req, res) => {
  try {
    const configs = await readLeagueConfigs(req.agency.code);
    res.set("Cache-Control", "no-store, max-age=0").json({ configs });
  } catch (error) {
    respondInternalError(res, `league-configs:${req.agency.code}`, error);
  }
});

app.put("/api/agencies/:agencyCode/league-configs", requireAgency, async (req, res) => {
  if (!req.agency.canImport) {
    res.status(403).json({ title: "PARAMÈTRES NON MODIFIÉS", message: "Ce code d'accès permet uniquement de consulter les résultats." });
    return;
  }
  try {
    const configs = normalizeLeagueConfigs(req.body?.configs);
    await withAgencyLock(req.agency.code, async () => {
      const agencyDir = path.join(dataDir, sanitizeSegment(req.agency.code));
      await fs.mkdir(agencyDir, { recursive: true });
      await writeJsonAtomic(path.join(agencyDir, "league-configs.json"), configs);
    });
    res.json({ message: "PARAMÈTRES DES LIGUES ACTUALISÉS", configs });
  } catch (error) {
    res.status(400).json({ title: "PARAMÈTRES INVALIDES", message: error instanceof Error ? error.message : "Les paramètres n'ont pas pu être enregistrés." });
  }
});

app.get("/api/agencies/:agencyCode/snapshot", requireAgency, async (req, res) => {
  res.set("Cache-Control", "no-store, max-age=0");
  const snapshot = await withAgencyLock(req.agency.code, () =>
    readLatestSnapshot(req.agency.code, readRequestedPerformanceCriteria(req.query))
  );
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
  const plan = await withAgencyLock(req.agency.code, () => readCauseriePlan(req.agency.code, matchDate));
  res.json({ plan });
});

app.post("/api/agencies/:agencyCode/time-range", requireAgency, async (req, res) => {
  if (!req.agency.canImport) {
    res.status(403).json({
      title: "PLAGE NON MODIFIÉE",
      message: "Ce code d'accès permet uniquement de consulter les résultats.",
    });
    return;
  }

  let period;
  try {
    period = normalizeTimeRange(req.body?.start, req.body?.end);
  } catch (error) {
    res.status(400).json({
      title: "PLAGE HORAIRE INVALIDE",
      message: error instanceof Error ? error.message : "Saisis deux heures au format 00:00 ou 00:30.",
      action: "Le début et la fin doivent être distincts et espacés par pas de 30 minutes.",
    });
    return;
  }

  const agencyDir = path.join(dataDir, sanitizeSegment(req.agency.code));
  try {
    await withAgencyLock(req.agency.code, async () => {
      const [buffer, currentSnapshot] = await Promise.all([
        readWorkbookForBuild(agencyDir),
        readLatestSnapshot(req.agency.code),
      ]);
      const criteria = readRequestedPerformanceCriteria(req.body?.criteria) ?? currentSnapshot?.performanceCriteria;
      const result = buildSnapshotFromWorkbook(
        buffer,
        currentSnapshot?.sourceName ?? "match.xlsx",
        req.agency.code,
        { ...period, criteria, dailyIndicators: currentSnapshot?.dailyIndicators ?? null },
      );
      if (!result.ok) {
        res.status(400).json(result.error);
        return;
      }
      if (result.snapshot.summary.operations === 0) {
        res.status(422).json({
          title: "AUCUNE DONNÉE SUR CETTE PLAGE",
          message: `Aucune opération exploitable entre ${period.start} et ${period.end}.`,
          action: "Choisis une autre plage horaire ou réimporte un fichier couvrant cette période.",
        });
        return;
      }
      result.snapshot.agency.name = req.agency.name;
      await writeJsonAtomic(path.join(agencyDir, "latest.json"), result.snapshot);
      clearCompositionCache(req.agency.code);
      res.json({ message: "PLAGE HORAIRE ACTUALISÉE", snapshot: result.snapshot });
    });
  } catch (error) {
    if (!isMissingSourceError(error)) {
      respondInternalError(res, `time-range:${req.agency.code}`, error);
      return;
    }
    res.status(404).json({
      title: "SOURCE EXCEL INDISPONIBLE",
      message: "Réimporte le dernier fichier Excel avant de modifier la plage horaire.",
    });
  }
});

app.post("/api/agencies/:agencyCode/composition-range", requireAgency, async (req, res) => {
  let period;
  try {
    period = normalizeTimeRange(req.body?.start, req.body?.end);
  } catch (error) {
    res.status(400).json({
      title: "PLAGE DE COMPOSITION INVALIDE",
      message: error instanceof Error ? error.message : "Saisis deux heures au format 00:00 ou 00:30.",
      action: "La sous-plage doit utiliser des pas de 30 minutes.",
    });
    return;
  }

  try {
    await withAgencyLock(req.agency.code, async () => {
      const currentSnapshot = await readLatestSnapshot(req.agency.code);
      if (!currentSnapshot) {
        res.status(404).json({
          title: "AUCUN MATCH IMPORTÉ",
          message: "Importe un fichier Excel avant de choisir une sous-plage de composition.",
        });
        return;
      }

      let activePeriod;
      try {
        activePeriod = normalizeTimeRange(currentSnapshot.match.periodStart, currentSnapshot.match.periodEnd);
      } catch {
        res.status(409).json({
          title: "PLAGE ACTIVE INDISPONIBLE",
          message: "Actualise le match avant de choisir une sous-plage de composition.",
        });
        return;
      }
      if (period.startMinutes < activePeriod.startMinutes || period.endMinutes > activePeriod.endMinutes) {
        res.status(400).json({
          title: "SOUS-PLAGE HORS PÉRIMÈTRE",
          message: `Choisis une sous-plage comprise entre ${activePeriod.start} et ${activePeriod.end}.`,
        });
        return;
      }

      const cacheKey = [req.agency.code, currentSnapshot.sourceName ?? "match.xlsx", period.start, period.end].join("|");
      let calculation = compositionRangeCache.get(cacheKey);
      if (!calculation) {
        calculation = (async () => {
          const buffer = await readWorkbookForBuild(path.join(dataDir, sanitizeSegment(req.agency.code)));
          return buildCompositionViewFromWorkbook(
            buffer,
            currentSnapshot.sourceName ?? "match.xlsx",
            req.agency.code,
            period,
          );
        })().catch((error) => {
          compositionRangeCache.delete(cacheKey);
          throw error;
        });
        compositionRangeCache.set(cacheKey, calculation);
      }
      const result = await calculation;
      if (!result.ok || result.players.length === 0) {
        res.status(422).json({
          title: "AUCUNE DONNÉE SUR CETTE SOUS-PLAGE",
          message: `Aucune opération exploitable entre ${period.start} et ${period.end}.`,
          action: "Choisis une autre sous-plage dans la plage active.",
        });
        return;
      }
      res.json({
        message: "VUE DE COMPOSITION ACTUALISÉE",
        range: { start: period.start, end: period.end, label: `${period.start} - ${period.end}` },
        players: result.players,
      });
    });
  } catch (error) {
    if (!isMissingSourceError(error)) {
      respondInternalError(res, `composition-range:${req.agency.code}`, error);
      return;
    }
    res.status(404).json({
      title: "SOURCE EXCEL INDISPONIBLE",
      message: "Réimporte le dernier fichier Excel avant de choisir une sous-plage.",
    });
  }
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
  await withAgencyLock(req.agency.code, () => saveCauseriePlan(req.agency.code, matchDate, plan));
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
      message: "Aucun fichier n'a été reçu.",
      action: "Sélectionne un fichier Excel .xlsx ou un rapport PDF 106J.",
    });
    return;
  }

  const extension = path.extname(req.file.originalname).toLowerCase();
  if (!extension.endsWith(".xlsx") && extension !== ".pdf") {
    res.status(400).json({
      title: "FICHIER NON IMPORTÉ",
      message: "Le fichier doit être au format .xlsx ou PDF 106J.",
      action: "Sélectionne le bon fichier puis réessaie.",
    });
    return;
  }

  try {
    await withAgencyLock(req.agency.code, async () => {
      const agencyDir = path.join(dataDir, sanitizeSegment(req.agency.code));
      if (extension === ".pdf") {
        const currentSnapshot = await readLatestSnapshot(req.agency.code);
        if (!currentSnapshot) {
          res.status(422).json({ title: "EXCEL REQUIS", message: "Importe d'abord le fichier Excel du match.", action: "Le PDF 106J complète le dernier Excel importé." });
          return;
        }
        const workbook = await readWorkbookForBuild(agencyDir);
        const dailyIndicators = await parse106jPdf(req.file.buffer, req.file.originalname);
        const period = normalizeTimeRange(currentSnapshot.match?.periodStart, currentSnapshot.match?.periodEnd);
        const result = buildSnapshotFromWorkbook(workbook, currentSnapshot.sourceName || "match.xlsx", req.agency.code, { ...period, criteria: currentSnapshot.performanceCriteria, dailyIndicators });
        if (!result.ok) {
          res.status(400).json(result.error);
          return;
        }
        result.snapshot.agency.name = req.agency.name;
        await savePdfImport(req.agency.code, req.file.originalname, req.file.buffer);
        await writeJsonAtomic(path.join(agencyDir, "latest.json"), result.snapshot);
        clearCompositionCache(req.agency.code);
        res.json({ message: "PDF 106J ACTUALISÉ", snapshot: result.snapshot });
        return;
      }

      const dailyIndicators = await readLatestPdfIndicators(agencyDir);
      const result = buildSnapshotFromWorkbook(req.file.buffer, req.file.originalname, req.agency.code, { dailyIndicators });
      if (!result.ok) {
        res.status(400).json(result.error);
        return;
      }

      result.snapshot.agency.name = req.agency.name;
      await saveImport(req.agency.code, req.file.originalname, req.file.buffer, result.snapshot);
      clearCompositionCache(req.agency.code);
      res.json({
        message: dailyIndicators ? "MATCH ET 106J ACTUALISÉS" : "MATCH ACTUALISÉ",
        snapshot: result.snapshot,
      });
    });
  } catch (error) {
    res.status(400).json({
      title: "FICHIER NON IMPORTÉ",
      message: error instanceof Error ? error.message : "Le fichier n'a pas pu être lu ou contrôlé.",
      action: "Vérifie le format du fichier et réessaie.",
    });
  }
});

const distDir = path.join(rootDir, "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((error, _req, res, next) => {
  if (error?.type === "entity.too.large") {
    res.status(413).json({
      title: "REQUÊTE TROP VOLUMINEUSE",
      message: "Le contenu envoyé dépasse la limite autorisée de 10 Mo.",
      action: "Réduis le nombre ou la taille des captures, puis réessaie.",
    });
    return;
  }
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
  if (res.headersSent) {
    next(error);
    return;
  }
  res.status(500).json({
    title: "SERVICE INDISPONIBLE",
    message: "Le serveur n'a pas pu terminer cette opération.",
    action: "Réessaie dans quelques instants ou contacte le responsable.",
  });
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

const DEFAULT_LEAGUE_CONFIGS = [
  { id: "bronze", zonageMinutes: 45, loadingSeconds: 195, unloadingSeconds: 75, scoreTargetPercent: 45 },
  { id: "argent", zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 },
  { id: "or", zonageMinutes: 25, loadingSeconds: 150, unloadingSeconds: 55, scoreTargetPercent: 60 },
  { id: "platine", zonageMinutes: 20, loadingSeconds: 135, unloadingSeconds: 50, scoreTargetPercent: 70 },
];

function normalizeLeagueConfigs(value) {
  if (!Array.isArray(value)) throw new Error("La liste des ligues est invalide.");
  return DEFAULT_LEAGUE_CONFIGS.map((defaultConfig) => {
    const input = value.find((item) => item?.id === defaultConfig.id) ?? {};
    const zonageMinutes = Number(input.zonageMinutes);
    const loadingSeconds = Number(input.loadingSeconds);
    const unloadingSeconds = Number(input.unloadingSeconds);
    const scoreTargetPercent = Number(input.scoreTargetPercent);
    if (![zonageMinutes, loadingSeconds, unloadingSeconds, scoreTargetPercent].every(Number.isFinite)) {
      throw new Error(`Paramètres incomplets pour la ligue ${defaultConfig.id}.`);
    }
    return {
      id: defaultConfig.id,
      zonageMinutes: Math.max(1, Math.round(zonageMinutes)),
      loadingSeconds: Math.max(1, Math.round(loadingSeconds)),
      unloadingSeconds: Math.max(1, Math.round(unloadingSeconds)),
      scoreTargetPercent: Math.min(100, Math.max(1, Math.round(scoreTargetPercent))),
    };
  });
}

async function readLeagueConfigs(agencyCode) {
  const configPath = path.join(dataDir, sanitizeSegment(agencyCode), "league-configs.json");
  try {
    return normalizeLeagueConfigs(JSON.parse(await fs.readFile(configPath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return DEFAULT_LEAGUE_CONFIGS.map((config) => ({ ...config }));
    throw error;
  }
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

function isMissingSourceError(error) {
  return error?.code === "ENOENT" || error?.message === "Aucun Excel disponible.";
}

function respondInternalError(res, scope, error) {
  console.error(`[${scope}]`, error);
  if (res.headersSent) return;
  res.status(500).json({
    title: "SERVICE INDISPONIBLE",
    message: "Le serveur n'a pas pu terminer cette opération.",
    action: "Réessaie dans quelques instants ou contacte le responsable.",
  });
}

async function saveImport(agencyCode, originalName, buffer, snapshot) {
  const safeAgency = sanitizeSegment(agencyCode);
  const agencyDir = path.join(dataDir, safeAgency);
  const uploadsDir = path.join(agencyDir, "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = sanitizeSegment(originalName.replace(/\.xlsx$/i, "")) || "match";
  const uploadPath = path.join(uploadsDir, `${stamp}-${safeName}.xlsx`);
  workbookReadPromises.delete(agencyDir);
  await writeFileAtomic(uploadPath, buffer);
  await writeFileAtomic(path.join(agencyDir, "latest.xlsx"), buffer);
  await writeJsonAtomic(path.join(agencyDir, "latest.json"), snapshot);
  workbookReadPromises.delete(agencyDir);
}

async function savePdfImport(agencyCode, originalName, buffer) {
  const safeAgency = sanitizeSegment(agencyCode);
  const agencyDir = path.join(dataDir, safeAgency);
  const uploadsDir = path.join(agencyDir, "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = sanitizeSegment(originalName.replace(/\.pdf$/i, "")) || "indicateurs-106j";
  await writeFileAtomic(path.join(uploadsDir, `${stamp}-${safeName}.pdf`), buffer);
  await writeFileAtomic(path.join(agencyDir, "latest-106j.pdf"), buffer);
}

async function readLatestPdfIndicators(agencyDir) {
  try {
    const pdfPath = path.join(agencyDir, "latest-106j.pdf");
    const buffer = await fs.readFile(pdfPath);
    return await parse106jPdf(buffer, "latest-106j.pdf");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readLatestSnapshot(agencyCode, requestedCriteria = null) {
  const agencyDir = path.join(dataDir, sanitizeSegment(agencyCode));
  const latestPath = path.join(agencyDir, "latest.json");
  try {
    let snapshot = normalizeSnapshotContract(JSON.parse(await fs.readFile(latestPath, "utf8")));
    const agency = agencies.find((item) => String(item.code).toUpperCase() === String(agencyCode).toUpperCase());
    let shouldPersistRebuiltSnapshot = false;
    const operationalScoreNeedsRefresh =
      !snapshot.operationalScore ||
      !["available", "unavailable"].includes(snapshot.operationalScore.status) ||
      snapshot.operationalScore.targetPercent === undefined ||
      !snapshot.operationalScore.indicators ||
      snapshot.operationalScore.indicators.unloadingPercent === undefined ||
      (!["available", "unavailable"].includes(snapshot.operationalScore.loading?.status) ||
        snapshot.operationalScore.loading?.scored === undefined ||
        snapshot.operationalScore.loading?.conceded === undefined);
    const snapshotNeedsRefresh =
      snapshot.kpiDictionaryVersion !== KPI_DICTIONARY_VERSION ||
      !Array.isArray(snapshot.hourlyPerformance) ||
      !snapshot.compositionPeriods?.quarters ||
      !snapshot.loadingQuality ||
      !Array.isArray(snapshot.loadingQuality.loadingDetails) ||
      !snapshot.unloadingQuality ||
      snapshot.unloadingQuality.targetedPercent === undefined ||
      snapshot.unloadingQuality.offTargetPercent === undefined ||
      !snapshot.unloadingDuelQuality ||
      !snapshot.duelQuality ||
      operationalScoreNeedsRefresh;

    const storedCriteriaMatchesRequest = requestedCriteria
      ? Object.entries(requestedCriteria).every(([key, value]) => snapshot.performanceCriteria?.[key] === value)
      : false;
    if (requestedCriteria && (!storedCriteriaMatchesRequest || snapshotNeedsRefresh)) {
      try {
        const workbook = await readWorkbookForBuild(agencyDir);
        const dailyIndicators = await readLatestPdfIndicators(agencyDir);
        const period = normalizeTimeRange(snapshot.match?.periodStart, snapshot.match?.periodEnd);
        const rebuilt = buildSnapshotFromWorkbook(
          workbook,
          snapshot.sourceName || "match.xlsx",
          agency?.code || agencyCode,
          { ...period, criteria: requestedCriteria, dailyIndicators },
        );
        if (rebuilt.ok) {
          snapshot = rebuilt.snapshot;
          shouldPersistRebuiltSnapshot = storedCriteriaMatchesRequest;
        } else if (!storedCriteriaMatchesRequest || snapshotNeedsRefresh) {
          return null;
        }
      } catch {
        // Never show a snapshot calculated with another league's criteria.
        if (!storedCriteriaMatchesRequest || snapshotNeedsRefresh) return null;
      }
    }

    // Older snapshots predate the hourly chart and half-time composition.
    // Rebuild them once from the latest workbook so new views work without a second import.
    if (!requestedCriteria && snapshotNeedsRefresh) {
      try {
        const workbook = await readWorkbookForBuild(agencyDir);
        const dailyIndicators = await readLatestPdfIndicators(agencyDir);
        const storedCriteria = normalizePerformanceCriteria(snapshot.performanceCriteria);
        const period = normalizeTimeRange(snapshot.match?.periodStart, snapshot.match?.periodEnd);
        const rebuilt = buildSnapshotFromWorkbook(
          workbook,
          snapshot.sourceName || "match.xlsx",
          agency?.code || agencyCode,
          { ...period, criteria: storedCriteria, dailyIndicators },
        );
        if (rebuilt.ok) {
          snapshot = rebuilt.snapshot;
          await writeJsonAtomic(latestPath, snapshot);
        }
      } catch {
        // Keep serving the existing snapshot if its source workbook is absent.
      }
    }

    if (agency) {
      snapshot.agency.code = agency.code;
      snapshot.agency.name = agency.name;
    }
    if (shouldPersistRebuiltSnapshot) {
      await writeJsonAtomic(latestPath, snapshot);
    }
    return snapshot;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    console.error(`[snapshot:${agencyCode}]`, error);
    throw error;
  }
}

function readWorkbookForBuild(agencyDir) {
  if (workbookReadPromises.has(agencyDir)) return workbookReadPromises.get(agencyDir);
  const readPromise = readLatestWorkbook(agencyDir).catch((error) => {
    if (workbookReadPromises.get(agencyDir) === readPromise) workbookReadPromises.delete(agencyDir);
    throw error;
  });
  workbookReadPromises.set(agencyDir, readPromise);
  return readPromise;
}

function withAgencyLock(agencyCode, operation) {
  const key = sanitizeSegment(agencyCode).toUpperCase();
  const previous = agencyOperationQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  let tracked;
  tracked = current.finally(() => {
    if (agencyOperationQueues.get(key) === tracked) agencyOperationQueues.delete(key);
  });
  agencyOperationQueues.set(key, tracked);
  return tracked;
}

function clearCompositionCache(agencyCode) {
  const prefix = `${String(agencyCode).toUpperCase()}|`;
  for (const key of compositionRangeCache.keys()) {
    if (key.toUpperCase().startsWith(prefix)) compositionRangeCache.delete(key);
  }
}

function readRequestedPerformanceCriteria(value) {
  if (!value || typeof value !== "object") return null;
  const hasCriteria = ["zonageMinutes", "loadingSeconds", "unloadingSeconds", "scoreTargetPercent"].some((key) => Object.hasOwn(value, key));
  return hasCriteria ? normalizePerformanceCriteria(value) : null;
}

async function readLatestWorkbook(agencyDir) {
  try {
    return await fs.readFile(path.join(agencyDir, "latest.xlsx"));
  } catch {
    const uploadsDir = path.join(agencyDir, "uploads");
    const entries = await fs.readdir(uploadsDir, { withFileTypes: true });
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && isWorkbookFile(entry.name))
        .map(async (entry) => {
          const filePath = path.join(uploadsDir, entry.name);
          const stat = await fs.stat(filePath);
          return { filePath, mtimeMs: stat.mtimeMs };
        })
    );
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (!candidates[0]) throw new Error("Aucun Excel disponible.");
    return fs.readFile(candidates[0].filePath);
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
  await writeJsonAtomic(path.join(causerieDir, `${sanitizeSegment(matchDate)}.json`), plan);
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
    attachments: {
      attack: normalizeAttachments(input.attachments?.attack),
      midfield: normalizeAttachments(input.attachments?.midfield),
      defense: normalizeAttachments(input.attachments?.defense),
    },
    mercato: limitText(input.mercato, 240),
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
    ? lines.map((line) => limitMultilineText(line, 500)).filter(Boolean).slice(0, 3)
    : [];
  while (clean.length < 3) clean.push("");
  return clean;
}

function normalizeAttachments(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((image) => /^data:image\/(jpeg|png|webp);base64,/.test(image) && image.length <= 260_000)
    .slice(0, 12);
}

function limitMultilineText(value, maxLength) {
  return String(value ?? "").trim().replace(/[^\S\r\n]+/g, " ").slice(0, maxLength);
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

function isWorkbookFile(name) {
  const normalized = String(name ?? "").toLowerCase();
  return normalized.endsWith(".xlsx") && !normalized.startsWith("~$");
}

async function writeJsonAtomic(filePath, value) {
  return writeFileAtomic(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writeFileAtomic(filePath, data, encoding) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, data, encoding);
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}
