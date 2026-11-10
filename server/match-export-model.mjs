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

/** Match the ceremony's attack / defense / midfield / polyvalence winners.
 * Challengers follow the same ranking rules as buildAwardChallengers in App.tsx. */
export function matchExportAwards(snapshot) {
  const candidates = Array.isArray(snapshot?.players) ? snapshot.players : [];
  const highlights = snapshot?.highlights ?? {};
  const winners = [highlights.bestScorer, highlights.defensiveWall, highlights.bestPasser]
    .filter(Boolean).map(item => item.name);
  const polyvalents = candidates.filter(player => player.operationTypes >= 2 && !winners.includes(player.name))
    .sort((a, b) => b.polyvalence - a.polyvalence || b.operations - a.operations);
  const selected = polyvalents[0] ?? null;
  const awards = [
    { kind: "attack", label: "Meilleur buteur", leader: highlights.bestScorer },
    { kind: "midfield", label: "Meilleur passeur", leader: highlights.bestPasser },
    { kind: "defense", label: "Meilleur defenseur", leader: highlights.defensiveWall },
    { kind: "polyvalent", label: "Meilleur polyvalent", leader: selected },
  ].filter(award => award.leader);
  const mid = awards.findIndex(award => award.kind === "midfield");
  const def = awards.findIndex(award => award.kind === "defense");
  if (mid !== -1 && def !== -1) [awards[mid], awards[def]] = [awards[def], awards[mid]];
  return awards.map(award => {
    const player = candidates.find(item => item.name === award.leader.name) ?? null;
    const type = award.kind === "attack" ? "CHG"
      : award.kind === "midfield" ? "ZONAGE" : award.kind === "defense" ? "DECHG" : null;
    const operationCount = item => type ? (item.byType?.[type] ?? 0) : item.polyvalence;
    const positionCount = item => type ? (item.positionsByType?.[type] ?? 0) : item.positions;
    const eligible = award.kind === "polyvalent"
      ? candidates.filter(item => item.operationTypes >= 2
        && !awards.filter(value => value.kind !== "polyvalent").some(value => value.leader.name === item.name))
      : candidates;
    const ranked = eligible.filter(item => item.name !== award.leader.name
      && (type ? operationCount(item) > 0 : item.operationTypes >= 2))
      .sort((a, b) => (type ? positionCount(b) - positionCount(a) : 0)
        || operationCount(b) - operationCount(a)
        || b.operations - a.operations || a.name.localeCompare(b.name, "fr"))
      .slice(0, 2);
    return {
      kind: award.kind, label: award.label,
      name: award.leader.name, role: player?.role ?? award.leader.role ?? "",
      value: award.kind === "polyvalent" ? award.leader.polyvalence : player ? positionCount(player) : 0,
      valueLabel: award.kind === "polyvalent" ? "polyvalence (%)"
        : type === "DECHG" ? "positions RECEPTION" : "positions " + type,
      challengers: ranked.map(item => ({
        name: item.name,
        value: award.kind === "polyvalent" ? item.polyvalence : positionCount(item),
      })),
    };
  });
}

/** The caller authenticates the agency first and loads ALL sources under that
 * same agency code. A mismatch is fatal: never silently fall back to another
 * agency, an older match, or KPI values calculated with different thresholds. */
export function matchExportModel({
  agency, snapshot, league, causerie = null, safety = null,
  expectedMatchDate, expectedImportedAt, manualInjuries = null, manualExpectedPlayers = null,
  pdfProfile = null,
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
  // Some chart metrics carry their own persisted targets. Checking only the
  // high-level performanceCriteria can otherwise print a graph computed with
  // an older league's threshold alongside the active league scoreboard.
  const embeddedThresholds = [
    ["score", snapshot.operationalScore?.targetPercent, league.criteria.scoreTargetPercent],
    ["chargement", snapshot.operationalScore?.loading?.targetSeconds, league.criteria.loadingSeconds],
    ["réception", snapshot.unloadingHourlyAnalysis?.targetSeconds, league.criteria.unloadingSeconds],
    ["zonage", snapshot.zonageDiagnostic?.targetMinutes, league.criteria.zonageMinutes],
  ];
  const stale = embeddedThresholds.find(([, recorded, active]) => Number.isFinite(recorded) && recorded !== active);
  if (stale) {
    throw new MatchExportError(409,
      `Le seuil ${stale[0]} du graphique ne correspond plus à la ligue active. Actualise le MATCH avant l'export.`);
  }
  if (manualInjuries !== null && (!Number.isInteger(manualInjuries) || manualInjuries < 0 || manualInjuries > 99)) {
    throw new MatchExportError(400, "Le nombre de blessures A.T est invalide.");
  }
  if (manualExpectedPlayers !== null && (!Number.isInteger(manualExpectedPlayers) || manualExpectedPlayers < 1 || manualExpectedPlayers > 100000)) {
    throw new MatchExportError(400, "L\u0027effectif prévu est invalide.");
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
    awards: matchExportAwards(snapshot),
    yellowCards: snapshot.yellowCards ?? [],
    yellowCardAudit: snapshot.yellowCardAudit ?? null,
    dailyIndicators: snapshot.dailyIndicators ?? null,
    hourlyPerformance: snapshot.hourlyPerformance ?? [],
    unloadingHourlyAnalysis: snapshot.unloadingHourlyAnalysis ?? null,
    loadingQuality: snapshot.loadingQuality ?? null,
    unloadingQuality: snapshot.unloadingQuality ?? null,
    unloadingDuelQuality: snapshot.unloadingDuelQuality ?? null,
    loadingScope: snapshot.loadingScope ?? null,
    receptionScope: snapshot.receptionScope ?? null,
    zonageDiagnostic: snapshot.zonageDiagnostic ?? null,
    anomalySummary: snapshot.anomalySummary ?? null,
    excludedTravelCodes: snapshot.excludedTravelCodes ?? [],
    visibleIndicators,
    pdfProfile,
    manualInjuries,
    manualExpectedPlayers,
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
      attachments: {
        attack: Array.isArray(causerie?.attachments?.attack) ? causerie.attachments.attack : [],
        midfield: Array.isArray(causerie?.attachments?.midfield) ? causerie.attachments.midfield : [],
        defense: Array.isArray(causerie?.attachments?.defense) ? causerie.attachments.defense : [],
      },
      attachmentCounts: {
        attack: causerie?.attachments?.attack?.length ?? 0,
        midfield: causerie?.attachments?.midfield?.length ?? 0,
        defense: causerie?.attachments?.defense?.length ?? 0,
      },
    },
  };
}
