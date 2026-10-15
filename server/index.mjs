import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCompositionViewFromWorkbook, buildSnapshotFromWorkbook, isTimeRangeWithin, KPI_DICTIONARY_VERSION, normalizePerformanceCriteria, normalizeSnapshotContract, normalizeTimeRange } from "./match-engine.mjs";
import { parse106jPdf } from "./pdf-106j.mjs";
import { operationalAnalysisNeedsRefresh } from "./operational-analysis.mjs";
import { BRIEF_LAYOUT_VERSION, BRIEF_TEXT_LIMITS, BRIEF_CAPTURE_LIMITS, migrateBriefLayout } from "./brief-layout.mjs";

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
const compositionRangeCacheLimit = 64;
const workbookReadPromises = new Map();
const agencyOperationQueues = new Map();
const failedSessionAttempts = new Map();
const sessionRateLimitWindowMs = 15 * 60 * 1000;
const maxFailedSessionAttempts = 20;
const importConfirmationSecret = randomBytes(32);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimitMb * 1024 * 1024 },
});

app.use(securityHeaders);

// A plan can contain several resized captures; keep the JSON body bounded but
// large enough for the client-side gallery limit.
app.use(express.json({ limit: "14mb" }));

const agencies = await loadAgencies();

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "STEF Match Center",
    agencies: agencies.length,
    // The application can report its configured path, but cannot prove that
    // the hosting provider mounted it on persistent storage.
    storage: process.env.STEF_DATA_DIR ? "configured-path" : "local-default",
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
  const sessionKey = sessionAttemptKey(req, agencyCode);
  const agency = findAgency(agencyCode, accessCode);
  if (!agency && isSessionRateLimited(sessionKey)) {
    res.status(429).json({
      title: "TROP DE TENTATIVES",
      message: "Trop d'essais de connexion. Réessaie dans quelques minutes.",
    });
    return;
  }
  if (!agency) {
    registerFailedSessionAttempt(sessionKey);
    res.status(401).json({
      title: "ACCÈS REFUSÉ",
      message: "Code agence ou code d'accès incorrect.",
    });
    return;
  }
  clearFailedSessionAttempts(sessionKey);
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

app.get("/api/agencies/:agencyCode/sync-state", requireAgency, async (req, res) => {
  try {
    const agencyDir = path.join(dataDir, sanitizeSegment(req.agency.code));
    const matchDate = sanitizeDate(req.query.matchDate);
    const causeriePath = matchDate
      ? path.join(agencyDir, "causeries", `${sanitizeSegment(matchDate)}.json`)
      : null;
    const [snapshotRevision, leagueConfigRevision, causerieRevision] = await Promise.all([
      readFileRevision(path.join(agencyDir, "latest.json")),
      readFileRevision(path.join(agencyDir, "league-configs.json")),
      causeriePath ? readFileRevision(causeriePath) : null,
    ]);
    res.set("Cache-Control", "no-store, max-age=0").json({ snapshotRevision, leagueConfigRevision, causerieRevision });
  } catch (error) {
    respondInternalError(res, `sync-state:${req.agency.code}`, error);
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
  res.set("Cache-Control", "no-store, max-age=0");
  const matchDate = sanitizeDate(req.query.matchDate);
  if (!matchDate) {
    res.status(400).json({
      title: "CAUSERIE NON LUE",
      message: "La date du match est nécessaire pour retrouver la causerie.",
    });
    return;
  }
  const state = await withAgencyLock(req.agency.code, () => readCauserieState(req.agency.code, matchDate));
  res.json(state);
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
      const excludedTravelCodes = await readExcludedTravelCodesForSnapshot(req.agency.code, currentSnapshot, period);
      const result = buildSnapshotFromWorkbook(
        buffer,
        currentSnapshot?.sourceName ?? "match.xlsx",
        req.agency.code,
        { ...period, criteria, dailyIndicators: currentSnapshot?.dailyIndicators ?? null, excludedTravelCodes },
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

app.post("/api/agencies/:agencyCode/travel-exclusions", requireAgency, async (req, res) => {
  if (!req.agency.canImport) {
    res.status(403).json({
      title: "PÉRIMÈTRE NON MODIFIÉ",
      message: "Ce code d'accès permet uniquement de consulter les résultats.",
    });
    return;
  }

  const travelCode = normalizeTravelCode(req.body?.travelCode);
  const excluded = req.body?.excluded === true;
  if (!travelCode) {
    res.status(400).json({
      title: "VOYAGE NON IDENTIFIÉ",
      message: "Le code voyage est nécessaire pour modifier le périmètre d'analyse.",
    });
    return;
  }

  try {
    await withAgencyLock(req.agency.code, async () => {
      const agencyDir = path.join(dataDir, sanitizeSegment(req.agency.code));
      const currentSnapshot = await readLatestSnapshot(req.agency.code);
      if (!currentSnapshot) {
        res.status(404).json({ title: "AUCUN MATCH IMPORTÉ", message: "Importe un fichier Excel avant de modifier le périmètre." });
        return;
      }
      const scopeKey = travelExclusionScopeKey(currentSnapshot);
      if (!scopeKey) {
        res.status(409).json({ title: "PÉRIMÈTRE INDISPONIBLE", message: "La période active ne permet pas d'identifier le périmètre à modifier." });
        return;
      }

      const state = await readTravelExclusionState(req.agency.code);
      const currentExcluded = new Set(await readExcludedTravelCodesForSnapshot(req.agency.code, currentSnapshot));
      const knownTravelCodes = new Set([
        ...(currentSnapshot.positions ?? []).map((position) => normalizeTravelCode(position.travelCode)),
        ...(currentSnapshot.loadingQuality?.loadingDetails ?? []).map((item) => normalizeTravelCode(item.travelCode)),
        ...(currentSnapshot.loadingQuality?.nonTargetedShots ?? []).map((item) => normalizeTravelCode(item.travelCode)),
        ...(currentSnapshot.unloadingDuelQuality?.duels ?? []).map((item) => normalizeTravelCode(item.travelCode)),
        ...(currentSnapshot.unloadingDuelQuality?.lostDuels ?? []).map((item) => normalizeTravelCode(item.travelCode)),
        ...currentExcluded,
      ]);
      knownTravelCodes.delete("");
      if (!knownTravelCodes.has(travelCode)) {
        res.status(404).json({ title: "VOYAGE INTROUVABLE", message: `Le voyage ${travelCode} n'est pas présent dans la période active.` });
        return;
      }

      if (excluded) currentExcluded.add(travelCode);
      else currentExcluded.delete(travelCode);
      const nextExcluded = normalizeTravelCodeList(currentExcluded);
      state.scopes[scopeKey] = nextExcluded;

      const workbook = await readWorkbookForBuild(agencyDir);
      const period = normalizeTimeRange(currentSnapshot.match.periodStart, currentSnapshot.match.periodEnd);
      const result = buildSnapshotFromWorkbook(
        workbook,
        currentSnapshot.sourceName || "match.xlsx",
        req.agency.code,
        {
          ...period,
          criteria: currentSnapshot.performanceCriteria,
          dailyIndicators: currentSnapshot.dailyIndicators ?? null,
          excludedTravelCodes: nextExcluded,
        },
      );
      if (!result.ok) {
        res.status(400).json(result.error);
        return;
      }
      result.snapshot.agency.name = req.agency.name;
      await writeTravelExclusionState(req.agency.code, state);
      await writeJsonAtomic(path.join(agencyDir, "latest.json"), result.snapshot);
      clearCompositionCache(req.agency.code);
      res.json({
        message: excluded ? `Voyage ${travelCode} masqué de l'analyse.` : `Voyage ${travelCode} réintégré dans l'analyse.`,
        snapshot: result.snapshot,
      });
    });
  } catch (error) {
    if (!isMissingSourceError(error)) {
      respondInternalError(res, `travel-exclusions:${req.agency.code}`, error);
      return;
    }
    res.status(404).json({ title: "SOURCE EXCEL INDISPONIBLE", message: "Réimporte le dernier fichier Excel avant de modifier le périmètre." });
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
      if (!isTimeRangeWithin(period, activePeriod)) {
        res.status(400).json({
          title: "SOUS-PLAGE HORS PÉRIMÈTRE",
          message: `Choisis une sous-plage comprise entre ${activePeriod.start} et ${activePeriod.end}.`,
        });
        return;
      }

      const excludedTravelCodes = await readExcludedTravelCodesForSnapshot(req.agency.code, currentSnapshot, period);
      const cacheKey = [req.agency.code, currentSnapshot.sourceName ?? "match.xlsx", period.start, period.end, excludedTravelCodes.join(",")].join("|");
      let calculation = compositionRangeCache.get(cacheKey);
      if (!calculation) {
        calculation = (async () => {
          const buffer = await readWorkbookForBuild(path.join(dataDir, sanitizeSegment(req.agency.code)));
          return buildCompositionViewFromWorkbook(
            buffer,
            currentSnapshot.sourceName ?? "match.xlsx",
            req.agency.code,
            { ...period, excludedTravelCodes },
          );
        })().catch((error) => {
          compositionRangeCache.delete(cacheKey);
          throw error;
        });
        compositionRangeCache.set(cacheKey, calculation);
        while (compositionRangeCache.size > compositionRangeCacheLimit) {
          const oldestKey = compositionRangeCache.keys().next().value;
          if (oldestKey === undefined) break;
          compositionRangeCache.delete(oldestKey);
        }
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

  const layout = migrateBriefLayout(req.body?.plan);
  const oversizedZone = ["attack", "midfield", "defense"].find((zone) =>
    layout[zone].filter(Boolean).join("\n").length > BRIEF_TEXT_LIMITS[zone]
    || layout.attachments[zone].length > BRIEF_CAPTURE_LIMITS[zone]);
  if (oversizedZone) {
    res.status(400).json({ title: "BRIEF NON ENREGISTRÉ", message: "La capacité de texte ou de captures d'une zone est dépassée. Aucun contenu n'a été supprimé." });
    return;
  }
  const plan = normalizeCauseriePlan(layout);
  if (req.body.expectedRevision !== null && typeof req.body.expectedRevision !== "string") {
    res.status(428).json({ message: "Recharge la causerie avant de l'enregistrer : sa révision est nécessaire." });
    return;
  }
  await withAgencyLock(req.agency.code, async () => {
    const current = await readCauserieState(req.agency.code, matchDate);
    if (req.body.expectedRevision !== current.causerieRevision) {
      res.status(409).json({ ...current, message: "Une autre modification a été enregistrée. Ta saisie est conservée ; recharge explicitement la version serveur avant de reprendre." });
      return;
    }
    await saveCauseriePlan(req.agency.code, matchDate, plan);
    res.json({ message: "PLAN DE JEU ENREGISTRÉ", ...await readCauserieState(req.agency.code, matchDate) });
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
        const dailyIndicators = await parse106jPdf(req.file.buffer, req.file.originalname, { uploadedAt: new Date().toISOString() });
        const association = pdfAssociation(dailyIndicators, currentSnapshot);
        if (association.status !== "matched") {
          res.status(422).json({ title: "PDF NON ASSOCIÉ", message: association.message, action: "Vérifie la date de référence du rapport et importe un PDF correspondant à la nuit du match." });
          return;
        }
        const period = normalizeTimeRange(currentSnapshot.match?.periodStart, currentSnapshot.match?.periodEnd);
        const excludedTravelCodes = await readExcludedTravelCodesForSnapshot(req.agency.code, currentSnapshot, period);
        const result = buildSnapshotFromWorkbook(workbook, currentSnapshot.sourceName || "match.xlsx", req.agency.code, { ...period, criteria: currentSnapshot.performanceCriteria, dailyIndicators, excludedTravelCodes });
        if (!result.ok) {
          res.status(400).json(result.error);
          return;
        }
        result.snapshot.agency.name = req.agency.name;
        await savePdfImport(req.agency.code, req.file.originalname, req.file.buffer, dailyIndicators.importedAt);
        await writeJsonAtomic(path.join(agencyDir, "latest.json"), result.snapshot);
        clearCompositionCache(req.agency.code);
        res.json({ message: "PDF 106J ACTUALISÉ", snapshot: result.snapshot });
        return;
      }

      const initialResult = buildSnapshotFromWorkbook(req.file.buffer, req.file.originalname, req.agency.code);
      if (!initialResult.ok) { res.status(400).json(initialResult.error); return; }
      const mismatch = initialResult.snapshot.agency.detectedCode && initialResult.snapshot.agency.detectedCode !== req.agency.code;
      if (mismatch) {
        const fingerprint = createHash("sha256").update(req.file.buffer).digest("hex");
        const signed = createHmac("sha256", importConfirmationSecret).update(`${req.agency.code}:${fingerprint}`).digest("hex");
        const provided = String(req.body?.agencyConfirmation ?? "");
        const isConfirmed = /^[0-9a-f]{64}$/.test(provided) && timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(signed, "hex"));
        if (!isConfirmed) {
          res.status(409).json({
            title: "AGENCE À CONFIRMER",
            message: `Ce classeur présente majoritairement des segments ${initialResult.snapshot.agency.detectedCode}, différents de l’espace ${req.agency.code}. Les segments ne prouvent pas à eux seuls l’origine du fichier.`,
            action: "Vérifie l’agence d’origine du classeur, puis confirme explicitement si ce fichier appartient bien à ton espace.",
            agencyConfirmation: signed,
            detectedAgency: initialResult.snapshot.agency.detectedCode,
            targetAgency: req.agency.code,
          });
          return;
        }
      }
      const lastPdf = await readLatestPdfIndicators(agencyDir);
      const association = lastPdf ? pdfAssociation(lastPdf, initialResult.snapshot) : null;
      const dailyIndicators = association?.status === "matched" ? lastPdf : null;
      const result = dailyIndicators
        ? buildSnapshotFromWorkbook(req.file.buffer, req.file.originalname, req.agency.code, { dailyIndicators })
        : initialResult;
      if (!result.ok) {
        res.status(400).json(result.error);
        return;
      }

      result.snapshot.agency.name = req.agency.name;
      const excludedTravelCodes = await readExcludedTravelCodesForSnapshot(req.agency.code, result.snapshot);
      const scopedResult = excludedTravelCodes.length > 0
        ? buildSnapshotFromWorkbook(req.file.buffer, req.file.originalname, req.agency.code, {
            start: result.snapshot.match.periodStart,
            end: result.snapshot.match.periodEnd,
            criteria: result.snapshot.performanceCriteria,
            dailyIndicators,
            excludedTravelCodes,
          })
        : result;
      if (!scopedResult.ok) {
        res.status(400).json(scopedResult.error);
        return;
      }
      scopedResult.snapshot.agency.name = req.agency.name;
      await saveImport(req.agency.code, req.file.originalname, req.file.buffer, scopedResult.snapshot);
      clearCompositionCache(req.agency.code);
      res.json({
        message: dailyIndicators ? "MATCH ET 106J ACTUALISÉS" : "MATCH ACTUALISÉ",
        pdfAssociation: association,
        snapshot: scopedResult.snapshot,
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
  app.use("/assets", express.static(path.join(distDir, "assets"), {
    immutable: true,
    maxAge: "1y",
  }));
  app.use(express.static(distDir, {
    setHeaders(res, filePath) {
      if (path.basename(filePath) === "index.html") {
        res.set("Cache-Control", "no-store, max-age=0");
      }
    },
  }));
  app.use("/api", (_req, res) => {
    res.status(404).json({
      title: "API INTROUVABLE",
      message: "Cette route API n'existe pas.",
    });
  });
  app.get(/.*/, (_req, res) => {
    res.set("Cache-Control", "no-store, max-age=0");
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((error, _req, res, next) => {
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({ title: "REQUÊTE INVALIDE", message: "Le contenu JSON envoyé est invalide." });
    return;
  }
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

const onListening = () => {
  console.log(`STEF Match Center API ready on http://localhost:${port}`);
  console.log(`STEF Match Center data directory: ${dataDir}`);
};

const bindHost = process.env.STEF_BIND_HOST?.trim();
if (bindHost) app.listen(port, bindHost, onListening);
else app.listen(port, onListening);

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

function securityHeaders(req, res, next) {
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    res.set("Cache-Control", "no-store, max-age=0");
  }
  res.set({
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src https://www.youtube-nocookie.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  next();
}

function sessionAttemptKey(req, agencyCode) {
  // Express resolves the client from the trusted proxy hop, not the untrusted first header entry.
  const ip = req.ip || "unknown";
  return `${ip}:${String(agencyCode ?? "").trim().toUpperCase() || "unknown"}`;
}

function isSessionRateLimited(key) {
  const entry = failedSessionAttempts.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    failedSessionAttempts.delete(key);
    return false;
  }
  return entry.count >= maxFailedSessionAttempts;
}

function registerFailedSessionAttempt(key) {
  const now = Date.now();
  const current = failedSessionAttempts.get(key);
  if (!current || current.resetAt <= now) {
    failedSessionAttempts.set(key, { count: 1, resetAt: now + sessionRateLimitWindowMs });
    return;
  }
  failedSessionAttempts.set(key, { count: current.count + 1, resetAt: current.resetAt });
}

function clearFailedSessionAttempts(key) {
  failedSessionAttempts.delete(key);
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

async function readFileRevision(filePath) {
  try {
    const stats = await fs.stat(filePath, { bigint: true });
    return `${stats.ino}:${stats.size}:${stats.mtimeNs}`;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function requireAgency(req, res, next) {
  const sessionKey = sessionAttemptKey(req, req.params.agencyCode);
  const agency = findAgency(req.params.agencyCode, req.header("x-access-code"));
  if (!agency && isSessionRateLimited(sessionKey)) {
    res.status(429).json({ title: "TROP DE TENTATIVES", message: "Trop d'essais de connexion. Réessaie dans quelques minutes." });
    return;
  }
  if (!agency) {
    registerFailedSessionAttempt(sessionKey);
    res.status(401).json({
      title: "ACCÈS REFUSÉ",
      message: "Code agence ou code d'accès incorrect.",
    });
    return;
  }
  clearFailedSessionAttempts(sessionKey);
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

async function savePdfImport(agencyCode, originalName, buffer, uploadedAt) {
  const safeAgency = sanitizeSegment(agencyCode);
  const agencyDir = path.join(dataDir, safeAgency);
  const uploadsDir = path.join(agencyDir, "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = sanitizeSegment(originalName.replace(/\.pdf$/i, "")) || "indicateurs-106j";
  await writeFileAtomic(path.join(uploadsDir, `${stamp}-${safeName}.pdf`), buffer);
  await writeFileAtomic(path.join(agencyDir, "latest-106j.pdf"), buffer);
  await writeJsonAtomic(path.join(agencyDir, "latest-106j-meta.json"), { uploadedAt, sourceName: originalName });
}


// An unverified PDF must never be silently presented as the current day's figures.
// A night may legitimately cross midnight, so either civil date of that night qualifies.
const PDF_MONTHS = new Map(Object.entries({
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
}));
function pdfReferenceDay(referenceDate) {
  const normalized = String(referenceDate ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const match = normalized.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const month = PDF_MONTHS.get(match[2]);
  if (!month) return null;
  const iso = `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return Number.isFinite(Date.parse(`${iso}T12:00:00Z`)) && new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}
function parisDay(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function pdfAssociation(pdf, snapshot) {
  const date = pdfReferenceDay(pdf?.referenceDate);
  const night = snapshot?.zonageDiagnostic?.night ?? snapshot?.anomalySummary?.night;
  const start = night?.startDate ?? parisDay(snapshot?.match?.firstOperation);
  const end = night?.endDate ?? parisDay(snapshot?.match?.lastOperation);
  if (!date || !start || !end) return {
    status: "unverified", referenceDate: pdf?.referenceDate ?? null,
    message: "Impossible de vérifier automatiquement la correspondance entre le PDF 106J et la date du match.",
  };
  if (date !== start && date !== end) return {
    status: "mismatched", referenceDate: pdf.referenceDate,
    message: `Le rapport 106J correspond au ${pdf.referenceDate}, hors des dates d'exploitation ${start} à ${end}.`,
  };
  return { status: "matched", referenceDate: pdf.referenceDate, message: "PDF associé à la nuit du match." };
}

async function readLatestPdfIndicators(agencyDir) {
  try {
    const pdfPath = path.join(agencyDir, "latest-106j.pdf");
    const buffer = await fs.readFile(pdfPath);
    let uploadedAt = null;
    let sourceName = "latest-106j.pdf";
    try {
      const meta = JSON.parse(await fs.readFile(path.join(agencyDir, "latest-106j-meta.json"), "utf8"));
      if (typeof meta.uploadedAt === "string" && Number.isFinite(Date.parse(meta.uploadedAt))) uploadedAt = meta.uploadedAt;
      if (typeof meta.sourceName === "string" && meta.sourceName) sourceName = meta.sourceName;
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
    return await parse106jPdf(buffer, sourceName, { uploadedAt });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const OPERATIONAL_SCORE_INDICATOR_KEYS = ["passRate", "loadingPercent", "unloadingPercent", "possessionPercent"];

function sameNullableNumber(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return left == null && right == null;
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

function operationalScoreContractNeedsRefresh(snapshot) {
  const score = snapshot?.operationalScore;
  const criteria = normalizePerformanceCriteria(snapshot?.performanceCriteria);
  if (!score || !["available", "unavailable"].includes(score.status)) return true;
  if (!Number.isFinite(score.targetPercent) || score.targetPercent !== criteria.scoreTargetPercent) return true;

  const indicators = score.indicators;
  if (!indicators || Object.keys(indicators).length !== OPERATIONAL_SCORE_INDICATOR_KEYS.length) return true;
  if (OPERATIONAL_SCORE_INDICATOR_KEYS.some((key) => !Object.hasOwn(indicators, key))) return true;
  if (Object.hasOwn(indicators, "duelRate")) return true;

  const expectedIndicators = {
    passRate: snapshot.summary?.passRate ?? null,
    loadingPercent: snapshot.loadingQuality?.targetedPercent ?? null,
    unloadingPercent: snapshot.unloadingQuality?.targetedPercent ?? null,
    possessionPercent: snapshot.summary?.possessionPercent ?? null,
  };
  if (OPERATIONAL_SCORE_INDICATOR_KEYS.some((key) => !sameNullableNumber(indicators[key], expectedIndicators[key]))) return true;

  const values = OPERATIONAL_SCORE_INDICATOR_KEYS.map((key) => indicators[key]);
  const expectedAvailable = values.every((value) => Number.isFinite(value));
  if (score.status !== (expectedAvailable ? "available" : "unavailable")) return true;
  if (expectedAvailable) {
    const expectedGoalsFor = values.filter((value) => value > score.targetPercent).length;
    if (!Number.isInteger(score.goalsFor) || score.goalsFor !== expectedGoalsFor) return true;
    if (!Number.isInteger(score.goalsAgainst) || score.goalsAgainst !== values.length - expectedGoalsFor) return true;
  } else if (score.goalsFor !== null || score.goalsAgainst !== null) {
    return true;
  }

  const loading = score.loading;
  const loadingQuality = snapshot.loadingQuality;
  const expectedScored = Number.isFinite(loadingQuality?.targeted) ? Math.round(loadingQuality.targeted) : null;
  const expectedConceded = Number.isFinite(loadingQuality?.offTarget) ? Math.round(loadingQuality.offTarget) : null;
  if (!loading || !["available", "unavailable"].includes(loading.status)) return true;
  if (!Number.isFinite(loading.targetSeconds) || loading.targetSeconds !== criteria.loadingSeconds) return true;
  if (loading.scored !== expectedScored || loading.conceded !== expectedConceded) return true;
  const expectedLoadingAvailable = expectedScored !== null && expectedConceded !== null && expectedScored + expectedConceded > 0;
  return loading.status !== (expectedLoadingAvailable ? "available" : "unavailable");
}

async function readLatestSnapshot(agencyCode, requestedCriteria = null) {
  const agencyDir = path.join(dataDir, sanitizeSegment(agencyCode));
  const latestPath = path.join(agencyDir, "latest.json");
  try {
    let snapshot = normalizeSnapshotContract(JSON.parse(await fs.readFile(latestPath, "utf8")));
    const agency = agencies.find((item) => String(item.code).toUpperCase() === String(agencyCode).toUpperCase());
    const persistedExcludedTravelCodes = await readExcludedTravelCodesForSnapshot(agencyCode, snapshot);
    let shouldPersistRebuiltSnapshot = false;
    const exclusionsChanged = !sameTravelCodeList(snapshot.excludedTravelCodes, persistedExcludedTravelCodes);
    const operationalScoreNeedsRefresh = operationalScoreContractNeedsRefresh(snapshot);
    const punctuality = snapshot.dailyIndicators?.punctuality;
    const dailyIndicatorTargetsNeedRefresh = Boolean(
      punctuality &&
      Object.keys(punctuality).length > 0 &&
      Object.keys(punctuality).some((key) => !Number.isFinite(snapshot.dailyIndicators?.punctualityTargets?.[key])),
    );
    const analysisNeedsRefresh = operationalAnalysisNeedsRefresh(snapshot);
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
      operationalScoreNeedsRefresh ||
      dailyIndicatorTargetsNeedRefresh ||
      exclusionsChanged;

    const storedCriteriaMatchesRequest = requestedCriteria
      ? Object.entries(requestedCriteria).every(([key, value]) => snapshot.performanceCriteria?.[key] === value)
      : false;
    if (requestedCriteria && (!storedCriteriaMatchesRequest || snapshotNeedsRefresh || analysisNeedsRefresh)) {
      try {
        const workbook = await readWorkbookForBuild(agencyDir);
        const pdfCandidate = (await readLatestPdfIndicators(agencyDir)) ?? snapshot.dailyIndicators ?? null;
        const dailyIndicators = pdfCandidate && pdfAssociation(pdfCandidate, snapshot).status === "matched" ? pdfCandidate : null;
        const period = normalizeTimeRange(snapshot.match?.periodStart, snapshot.match?.periodEnd);
        const rebuilt = buildSnapshotFromWorkbook(
          workbook,
          snapshot.sourceName || "match.xlsx",
          agency?.code || agencyCode,
          { ...period, criteria: requestedCriteria, dailyIndicators, excludedTravelCodes: persistedExcludedTravelCodes },
        );
        if (rebuilt.ok) {
          snapshot = rebuilt.snapshot;
          shouldPersistRebuiltSnapshot = storedCriteriaMatchesRequest;
        } else if (!storedCriteriaMatchesRequest || snapshotNeedsRefresh) {
          return null;
        }
      } catch (error) {
        // Never show a snapshot calculated with another league's criteria.
        if (!isMissingSourceError(error)) throw error;
        if (!storedCriteriaMatchesRequest || snapshotNeedsRefresh) return null;
      }
    }

    // Older snapshots predate the hourly chart and half-time composition.
    // Rebuild them once from the latest workbook so new views work without a second import.
    if (!requestedCriteria && (snapshotNeedsRefresh || analysisNeedsRefresh)) {
      try {
        const workbook = await readWorkbookForBuild(agencyDir);
        const pdfCandidate = (await readLatestPdfIndicators(agencyDir)) ?? snapshot.dailyIndicators ?? null;
        const dailyIndicators = pdfCandidate && pdfAssociation(pdfCandidate, snapshot).status === "matched" ? pdfCandidate : null;
        const storedCriteria = normalizePerformanceCriteria(snapshot.performanceCriteria);
        const period = normalizeTimeRange(snapshot.match?.periodStart, snapshot.match?.periodEnd);
        const rebuilt = buildSnapshotFromWorkbook(
          workbook,
          snapshot.sourceName || "match.xlsx",
          agency?.code || agencyCode,
          { ...period, criteria: storedCriteria, dailyIndicators, excludedTravelCodes: persistedExcludedTravelCodes },
        );
        if (rebuilt.ok) {
          snapshot = rebuilt.snapshot;
          await writeJsonAtomic(latestPath, snapshot);
        }
      } catch (error) {
        // Keep serving the existing snapshot if its source workbook is absent.
        if (!isMissingSourceError(error)) throw error;
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

const TRAVEL_EXCLUSION_STATE_VERSION = 1;

function normalizeTravelCode(value) {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 120) : "";
}

function normalizeTravelCodeList(value) {
  return Array.from(new Set(
    (value instanceof Set ? Array.from(value) : Array.isArray(value) ? value : [])
      .map(normalizeTravelCode)
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right, "fr"));
}

function travelExclusionScopeKey(snapshot, period = null) {
  const date = normalizeTravelCode(snapshot?.match?.date);
  const start = normalizeTravelCode(period?.start ?? snapshot?.match?.periodStart);
  const end = normalizeTravelCode(period?.end ?? snapshot?.match?.periodEnd);
  return date && start && end ? `${date}|${start}|${end}` : null;
}

function travelExclusionStatePath(agencyCode) {
  return path.join(dataDir, sanitizeSegment(agencyCode), "travel-exclusions.json");
}

async function readTravelExclusionState(agencyCode) {
  try {
    const parsed = JSON.parse(await fs.readFile(travelExclusionStatePath(agencyCode), "utf8"));
    const scopes = parsed && typeof parsed.scopes === "object" && !Array.isArray(parsed.scopes) ? parsed.scopes : {};
    return {
      version: TRAVEL_EXCLUSION_STATE_VERSION,
      scopes: Object.fromEntries(Object.entries(scopes).map(([key, value]) => [key, normalizeTravelCodeList(value)])),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: TRAVEL_EXCLUSION_STATE_VERSION, scopes: {} };
    throw error;
  }
}

async function writeTravelExclusionState(agencyCode, state) {
  const scopes = state && typeof state.scopes === "object" && !Array.isArray(state.scopes) ? state.scopes : {};
  await writeJsonAtomic(travelExclusionStatePath(agencyCode), {
    version: TRAVEL_EXCLUSION_STATE_VERSION,
    scopes: Object.fromEntries(Object.entries(scopes).map(([key, value]) => [key, normalizeTravelCodeList(value)])),
  });
}

async function readExcludedTravelCodesForSnapshot(agencyCode, snapshot, period = null) {
  const state = await readTravelExclusionState(agencyCode);
  const scopeKey = travelExclusionScopeKey(snapshot, period);
  if (!scopeKey) return normalizeTravelCodeList(snapshot?.excludedTravelCodes);
  const stored = state.scopes[scopeKey];
  if (Array.isArray(stored)) return stored;
  const oldDate = snapshot?.match?.legacyDate;
  if (oldDate && oldDate !== snapshot?.match?.date) {
    const oldKey = travelExclusionScopeKey({ ...snapshot, match: { ...snapshot.match, date: oldDate } }, period);
    if (oldKey && Array.isArray(state.scopes[oldKey])) return state.scopes[oldKey];
  }

  // Migrate the field that was briefly stored directly in latest.json before
  // the per-scope state file existed. Source workbooks remain untouched.
  const legacy = normalizeTravelCodeList(snapshot?.excludedTravelCodes);
  if (legacy.length > 0) {
    state.scopes[scopeKey] = legacy;
    await writeTravelExclusionState(agencyCode, state);
  }
  return legacy;
}

function sameTravelCodeList(left, right) {
  const normalizedLeft = normalizeTravelCodeList(left);
  const normalizedRight = normalizeTravelCodeList(right);
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function readRequestedPerformanceCriteria(value) {
  if (!value || typeof value !== "object") return null;
  const hasCriteria = ["zonageMinutes", "loadingSeconds", "unloadingSeconds", "scoreTargetPercent"].some((key) => Object.hasOwn(value, key));
  return hasCriteria ? normalizePerformanceCriteria(value) : null;
}

async function readLatestWorkbook(agencyDir) {
  try {
    return await fs.readFile(path.join(agencyDir, "latest.xlsx"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
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
    if (!candidates[0]) throw new Error("Aucun Excel disponible.", { cause: error });
    return fs.readFile(candidates[0].filePath);
  }
}

async function readCauserieState(agencyCode, matchDate) {
  const plan = await readCauseriePlan(agencyCode, matchDate);
  const file = path.join(dataDir, sanitizeSegment(agencyCode), "causeries", `${sanitizeSegment(matchDate)}.json`);
  return { plan, causerieRevision: await readFileRevision(file) };
}

async function readCauseriePlan(agencyCode, matchDate) {
  const causeriePath = path.join(dataDir, sanitizeSegment(agencyCode), "causeries", `${sanitizeSegment(matchDate)}.json`);
  // Read-through migration: copy the historical UTC-date brief only if the new
  // operational-date file is absent; keep the old source file intact.
  try {
    await fs.access(causeriePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const agencyDir = path.join(dataDir, sanitizeSegment(agencyCode));
    try {
      const current = JSON.parse(await fs.readFile(path.join(agencyDir, "latest.json"), "utf8"));
      const former = current?.match?.legacyDate;
      if (current?.match?.date === matchDate && former && former !== matchDate) {
        const legacyPath = path.join(agencyDir, "causeries", `${sanitizeSegment(former)}.json`);
        const oldPlan = await fs.readFile(legacyPath, "utf8");
        await writeFileAtomic(causeriePath, oldPlan, "utf8");
      }
    } catch (migrationError) {
      if (migrationError?.code !== "ENOENT") throw migrationError;
    }
  }
  try {
    const stored = JSON.parse(await fs.readFile(causeriePath, "utf8"));
    const migrated = migrateBriefLayout(stored);
    if (!(Number(stored?.briefLayoutVersion) >= BRIEF_LAYOUT_VERSION)) {
      await saveCauseriePlan(agencyCode, matchDate, migrated);
    }
    return migrated;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return null;
  }
}

async function saveCauseriePlan(agencyCode, matchDate, plan) {
  const causerieDir = path.join(dataDir, sanitizeSegment(agencyCode), "causeries");
  await fs.mkdir(causerieDir, { recursive: true });
  await writeJsonAtomic(path.join(causerieDir, `${sanitizeSegment(matchDate)}.json`), plan);
}

function normalizeCauseriePlan(plan) {
  const input = migrateBriefLayout(plan);
  return {
    briefLayoutVersion: BRIEF_LAYOUT_VERSION,
    team: limitText(input.team, 48),
    manager: limitText(input.manager, 48),
    updatedAt: new Date().toISOString(),
    attack: normalizeLines(input.attack),
    midfield: normalizeLines(input.midfield),
    defense: normalizeLines(input.defense),
    attachments: {
      attack: normalizeAttachments(input.attachments?.attack),
      midfield: normalizeAttachments(input.attachments?.midfield, BRIEF_CAPTURE_LIMITS.midfield),
      defense: normalizeAttachments(input.attachments?.defense),
    },
    mercato: limitMultilineText(input.mercato, 240),
    mercatoProfiles: normalizeMercatoProfiles(input.mercatoProfiles),
    redCards: limitMultilineText(input.redCards, 1000),
    coach: {
      tactic: limitText(input.coach?.tactic, 120),
      priority: limitText(input.coach?.priority, 120),
      arbitration: limitText(input.coach?.arbitration, 120),
      review: limitText(input.coach?.review, 80),
    },
  };
}

function normalizeMercatoProfiles(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, profile]) => [
      key.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR").slice(0, 240),
      profile,
    ])
    .filter(([key, profile]) => key && (profile === "female" || profile === "male")));
}

function normalizeLines(lines) {
  const clean = Array.isArray(lines)
    ? lines.filter((line) => typeof line === "string" && line.trim())
    : [];
  while (clean.length < 3) clean.push("");
  return clean;
}

function normalizeAttachments(value, limit = 12) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((image) => /^data:image\/(jpeg|png|webp);base64,/.test(image) && image.length <= 260_000)
    .slice(0, limit);
}

function limitMultilineText(value, maxLength) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim().replace(/[^\S\n]+/g, " ").slice(0, maxLength);
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
