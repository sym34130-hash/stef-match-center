/**
 * Lot E — immutable agency-scoped identity for a MATCH PDF export.
 * This module has no storage or network access; callers must supply the
 * already-authenticated, already-rendered match and may not merge agencies.
 */
const LEAGUE_LABELS = Object.freeze({
  bronze: "LIGUE 2",
  argent: "LIGUE 1",
  or: "LDC",
  platine: "CDM",
});
const CARD_IDS = Object.freeze([
  "performance", "injuries", "tonnage-distribution", "tonnage-expedition",
  "positions", "arrival", "departure", "destination", "temperature",
]);

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Export impossible : ${field} manquant.`);
  return value.trim();
}
function agencyCode(value) { return requireText(value, "code agence").toUpperCase(); }
function sameAgency(source, target) { return agencyCode(source) === agencyCode(target); }
function safeFilename(value) { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72); }

/**
 * @param {{
 *  sessionAgency: {code: string, name: string},
 *  snapshot: any,
 *  league: {id: string, label?: string, zonageMinutes:number, loadingSeconds:number, unloadingSeconds:number, scoreTargetPercent:number},
 *  briefPlan: null | {visibleIndicators?:string[], updatedAt?: string|null},
 *  briefPlanScope: string,
 *  kpis: {injuriesValue:string, expectedPlayersValue:string},
 *  generatedAt?: string
 * }} input
 */
export function buildMatchExportIdentity(input) {
  const { sessionAgency, snapshot, league, briefPlan, briefPlanScope, kpis } = input;
  if (!sessionAgency || !snapshot || !league) throw new Error("Export impossible : contexte incomplet.");
  const code = agencyCode(sessionAgency.code);
  if (!sameAgency(snapshot.agency?.code, code)) {
    throw new Error("Export bloqué : les données du MATCH ne correspondent pas à l'agence connectée.");
  }
  const pdfAgency = snapshot.dailyIndicators?.agencyCode;
  if (snapshot.dailyIndicators && !pdfAgency) {
    throw new Error("Export bloqué : l'agence du PDF 106J n'est pas identifiable.");
  }
  if (pdfAgency && !sameAgency(pdfAgency, code)) {
    throw new Error("Export bloqué : le PDF 106J provient d'une autre agence.");
  }
  if (!Object.hasOwn(LEAGUE_LABELS, league.id)) throw new Error("Export bloqué : ligue inconnue.");
  const date = requireText(snapshot.match?.date, "date du MATCH");
  const importedAt = requireText(snapshot.importedAt, "révision de l'import");
  const sourceName = requireText(snapshot.sourceName, "source Excel");
  const expectedScope = [code, date, importedAt].join(":");
  if (briefPlanScope !== expectedScope) {
    throw new Error("Export bloqué : le brief n'est pas associé à cette version du MATCH.");
  }
  const criteria = snapshot.performanceCriteria ?? league;
  const numbers = ["zonageMinutes", "loadingSeconds", "unloadingSeconds", "scoreTargetPercent"];
  for (const key of numbers) {
    if (!Number.isFinite(criteria[key])) throw new Error(`Export bloqué : critère ${key} invalide.`);
  }
  const cards = Array.isArray(briefPlan?.visibleIndicators)
    ? CARD_IDS.filter(id => briefPlan.visibleIndicators.includes(id))
    : [...CARD_IDS];
  // The days-without-accident card is part of the MATCH regardless of visibility preferences.
  const visibleCards = [...cards, "accident-free-days"];
  const identity = {
    agencyCode: code,
    agencyName: requireText(sessionAgency.name, "nom agence"),
    leagueId: league.id,
    leagueLabel: LEAGUE_LABELS[league.id],
    matchDate: date,
    importedAt,
    sourceName,
    performanceCriteria: {
      zonageMinutes: criteria.zonageMinutes,
      loadingSeconds: criteria.loadingSeconds,
      unloadingSeconds: criteria.unloadingSeconds,
      scoreTargetPercent: criteria.scoreTargetPercent,
    },
    criteriaSource: snapshot.performanceCriteria ? "snapshot" : "league",
    indicators: visibleCards,
    manualKpis: {
      injuriesValue: String(kpis?.injuriesValue ?? ""),
      expectedPlayersValue: String(kpis?.expectedPlayersValue ?? ""),
    },
    briefScope: expectedScope,
    briefUpdatedAt: briefPlan?.updatedAt ?? null,
    pdf106j: snapshot.dailyIndicators ? {
      agencyCode: pdfAgency ?? null,
      referenceDate: snapshot.dailyIndicators.referenceDate ?? null,
      sourceName: snapshot.dailyIndicators.sourceName ?? "",
    } : null,
  };
  const signature = JSON.stringify(identity);
  return Object.freeze({
    ...identity,
    signature,
    filename: `STEF-MATCH-${safeFilename(code)}-${safeFilename(date)}-${LEAGUE_LABELS[league.id].replace(/\s/g, "-")}.pdf`,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  });
}

/** Fail closed if the authenticated agency, selected league, or match has changed. */
export function assertMatchExportStillCurrent(exportIdentity, nextInput) {
  const current = buildMatchExportIdentity(nextInput);
  if (current.signature !== exportIdentity.signature) {
    throw new Error("Le MATCH, la ligue ou les paramètres ont changé pendant l'export. Relance le téléchargement.");
  }
  return true;
}
