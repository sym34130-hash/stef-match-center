import { normalizeBriefIndicators } from "./brief-layout.mjs";

const LEAGUE_LABELS = Object.freeze({
  bronze: "LIGUE 2",
  argent: "LIGUE 1",
  or: "LDC",
  platine: "CDM",
});
const CRITERIA_KEYS = ["zonageMinutes", "loadingSeconds", "unloadingSeconds", "scoreTargetPercent"];

export function matchExportLeague(leagueId, leagueConfigs) {
  if (!Object.hasOwn(LEAGUE_LABELS, leagueId)) {
    throw new MatchExportError(400, "Ligue invalide ou absente.");
  }
  const config = leagueConfigs.find(item => item?.id === leagueId);
  if (!config || CRITERIA_KEYS.some(key => !Number.isFinite(config[key]) || config[key] <= 0)) {
    throw new MatchExportError(409, "Les critères de la ligue sélectionnée sont indisponibles.");
  }
  return {
    id: leagueId,
    label: LEAGUE_LABELS[leagueId],
    criteria: Object.fromEntries(CRITERIA_KEYS.map(key => [key, config[key]])),
  };
}

export class MatchExportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The caller authenticates the agency first and loads ALL sources under that
 * same agency code. A mismatch is fatal: never silently fall back to another
 * agency, an older match, or KPI values calculated with different thresholds. */
export function matchExportModel({
  agency, snapshot, league, causerie = null, safety = null,
  expectedMatchDate, expectedImportedAt, manualInjuries = null,
}) {
  const agencyCode = String(agency?.code ?? "").trim().toUpperCase();
  if (!agencyCode || !snapshot) {
    throw new MatchExportError(404, "Aucun MATCH disponible pour cette agence.");
  }
  const snapshotAgency = String(snapshot.agency?.code ?? "").trim().toUpperCase();
  const detectedAgency = String(snapshot.agency?.detectedCode ?? "").trim().toUpperCase();
  const pdfAgency = String(snapshot.dailyIndicators?.agencyCode ?? "").trim().toUpperCase();
  if (snapshotAgency !== agencyCode || (detectedAgency && detectedAgency !== agencyCode)
      || (pdfAgency && pdfAgency !== agencyCode)) {
    throw new MatchExportError(409, "Export bloqué : les sources ne correspondent pas à cette agence.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedMatchDate ?? "")
    || snapshot.match?.date !== expectedMatchDate) {
    throw new MatchExportError(409, "Le MATCH a changé. Actualise la feuille de match avant l'export.");
  }
  if (!expectedImportedAt || snapshot.importedAt !== expectedImportedAt) {
    throw new MatchExportError(409, "Une nouvelle importation a eu lieu. Actualise avant l'export.");
  }
  if (CRITERIA_KEYS.some(key => Number(snapshot.performanceCriteria?.[key]) !== league.criteria[key])) {
    throw new MatchExportError(409, "Les KPI de l'instantané ne correspondent pas à la ligue sélectionnée.");
  }
  if (manualInjuries !== null && (!Number.isInteger(manualInjuries) || manualInjuries < 0 || manualInjuries > 99)) {
    throw new MatchExportError(400, "Le nombre de blessures A.T est invalide.");
  }
  const visibleIndicators = normalizeBriefIndicators(causerie?.visibleIndicators, causerie?.visibleIndicatorsVersion ?? 1);
  return {
    agency: { code: agencyCode, name: String(agency.name ?? agencyCode) },
    league,
    match: { ...snapshot.match },
    importedAt: snapshot.importedAt,
    sourceName: snapshot.sourceName,
    criteria: { ...league.criteria },
    score: snapshot.operationalScore ?? null,
    summary: snapshot.summary,
    highlights: snapshot.highlights,
    yellowCards: snapshot.yellowCards ?? [],
    yellowCardAudit: snapshot.yellowCardAudit ?? null,
    dailyIndicators: snapshot.dailyIndicators ?? null,
    hourlyPerformance: snapshot.hourlyPerformance ?? [],
    loadingQuality: snapshot.loadingQuality ?? null,
    unloadingQuality: snapshot.unloadingQuality ?? null,
    unloadingDuelQuality: snapshot.unloadingDuelQuality ?? null,
    loadingScope: snapshot.loadingScope ?? null,
    receptionScope: snapshot.receptionScope ?? null,
    zonageDiagnostic: snapshot.zonageDiagnostic ?? null,
    anomalySummary: snapshot.anomalySummary ?? null,
    excludedTravelCodes: snapshot.excludedTravelCodes ?? [],
    visibleIndicators,
    manualInjuries,
    safety: { lastAccidentDate: safety?.lastAccidentDate ?? null, days: safety?.counter?.days ?? null },
    causerie: {
      team: causerie?.team ?? "",
      manager: causerie?.manager ?? "",
      attack: causerie?.attack ?? [],
      midfield: causerie?.midfield ?? [],
      defense: causerie?.defense ?? [],
      coach: causerie?.coach ?? {},
      mercato: causerie?.mercato ?? "",
      redCards: causerie?.redCards ?? "",
      attachmentCounts: {
        attack: causerie?.attachments?.attack?.length ?? 0,
        midfield: causerie?.attachments?.midfield?.length ?? 0,
        defense: causerie?.attachments?.defense?.length ?? 0,
      },
    },
  };
}
