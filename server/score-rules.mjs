/**
 * Agency/league-scoped score rules. Independent of operational KPI arithmetic:
 * changes affect the football score, never the reference score or source data.
 */
export const SCORE_RULES_VERSION = 1;
export const SCORE_KPI_CATALOG = Object.freeze([
  { id: "passRate", label: "Passes réussies", source: "Excel" },
  { id: "loadingPercent", label: "Tirs cadrés", source: "Excel" },
  { id: "unloadingPercent", label: "Duels gagnés", source: "Excel" },
  { id: "possessionPercent", label: "Possession", source: "Excel" },
  { id: "arrivalPunctuality", label: "Ponctualité arrivage", source: "106J" },
  { id: "departurePunctuality", label: "Ponctualité départ", source: "106J" },
  { id: "destinationPunctuality", label: "Ponctualité destination", source: "106J" },
  { id: "temperatureReturn", label: "Température retour ramasse", source: "106J" },
]);
export const DEFAULT_SCORE_INDICATOR_IDS = Object.freeze([
  "passRate", "loadingPercent", "unloadingPercent", "possessionPercent",
]);
const KNOWN = new Map(SCORE_KPI_CATALOG.map(item => [item.id, item]));
const LEAGUES = new Set(["bronze", "argent", "or", "platine"]);
export class ScoreRulesError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ScoreRulesError";
    this.status = status;
  }
}

export function assertScoreLeagueId(id) {
  if (typeof id !== "string" || !LEAGUES.has(id))
    throw new ScoreRulesError(400, "Ligue du score inconnue.");
  return id;
}

export function defaultScoreRules() {
  return { version: SCORE_RULES_VERSION,
    indicators: DEFAULT_SCORE_INDICATOR_IDS.map(id => ({
      id, targetPercent: null, goalsFor: 1, goalsAgainst: 1,
    })),
  };
}

/** null targetPercent inherits the league's active scoreTargetPercent. */
export function normalizeScoreRules(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || input.version !== SCORE_RULES_VERSION
    || !Array.isArray(input.indicators)
    || input.indicators.length < 2 || input.indicators.length > 6)
    throw new ScoreRulesError(400, "Sélectionne entre 2 et 6 KPI valides pour le score.");
  const seen = new Set();
  const indicators = input.indicators.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || typeof item.id !== "string" || !KNOWN.has(item.id) || seen.has(item.id))
      throw new ScoreRulesError(400, "Indicateur inconnu ou présent plusieurs fois.");
    seen.add(item.id);
    if (item.targetPercent !== null
      && (!Number.isInteger(item.targetPercent) || item.targetPercent < 1 || item.targetPercent > 100))
      throw new ScoreRulesError(400, "L'objectif doit être compris entre 1 et 100 %.");
    if (!Number.isInteger(item.goalsFor) || item.goalsFor < 1 || item.goalsFor > 3
      || !Number.isInteger(item.goalsAgainst) || item.goalsAgainst < 1 || item.goalsAgainst > 3)
      throw new ScoreRulesError(400, "Le poids doit être compris entre 1 et 3 buts.");
    return { id:item.id, targetPercent:item.targetPercent,
      goalsFor:item.goalsFor, goalsAgainst:item.goalsAgainst };
  });
  return { version:SCORE_RULES_VERSION, indicators };
}

function operationalDay(value) {
  if (typeof value !== "string") return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (iso) return iso[0];
  const french = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/.exec(plain(value));
  if (!french) return null;
  const month = MONTHS_FR.indexOf(french[2]);
  if (month < 0) return null;
  return french[3]+"-"+String(month+1).padStart(2,"0")+"-"+french[1].padStart(2,"0");
}

function observedValue(snapshot, id) {
  const catalog = KNOWN.get(id);
  if (catalog.source === "Excel") {
    return { value:snapshot?.operationalScore?.indicators?.[id] ?? null,
      source:"Excel", sourceDate:snapshot?.match?.date ?? null, reason:null };
  }
  const indicators=snapshot?.dailyIndicators;
  // A 106J may legitimately describe another day than the operational Excel.
  // The importing agency explicitly selects its 106J: date is provenance,
  // never an automatic reason to concede or block its valid measurements.
  // Agency isolation stays enforced by the authenticated snapshot endpoint.
  return { value:indicators?.punctuality?.[id] ?? null,
    source:"106J", sourceDate:indicators?.referenceDate ?? null, reason:null };
}

export function evaluateScoreRules(snapshot, rules, leagueTargetPercent) {
  const profile = normalizeScoreRules(rules);
  if (!Number.isFinite(leagueTargetPercent)
    || leagueTargetPercent < 1 || leagueTargetPercent > 100)
    throw new ScoreRulesError(400, "L'objectif de la ligue est invalide.");
  const indicators=profile.indicators.map(item => {
    const observed=observedValue(snapshot, item.id);
    const value=observed.value;
    const available=typeof value === "number" && Number.isFinite(value) && value>=0 && value<=100;
    const targetPercent=item.targetPercent ?? leagueTargetPercent;
    const reached=available ? value>targetPercent : null; // equality concedes
    return { ...item, label:KNOWN.get(item.id).label,
      targetPercent, value:available?value:null, reached,
      awardedGoals:reached===true?item.goalsFor:0,
      concededGoals:reached===false?item.goalsAgainst:0,
      source:observed.source, sourceDate:observed.sourceDate,
      reason: available?null:observed.reason??"Donnée indisponible sur ce MATCH." };
  });
  const missingIndicators=indicators.filter(item=>item.reached===null)
    .map(item=>({id:item.id,label:item.label,reason:item.reason}));
  const complete=missingIndicators.length===0;
  return {
    status:complete?"available":"unavailable",
    goalsFor:complete?indicators.reduce((n,item)=>n+item.awardedGoals,0):null,
    goalsAgainst:complete?indicators.reduce((n,item)=>n+item.concededGoals,0):null,
    possibleGoalsFor:indicators.reduce((n,item)=>n+item.goalsFor,0),
    possibleGoalsAgainst:indicators.reduce((n,item)=>n+item.goalsAgainst,0),
    missingIndicators, indicators,
    referenceScore: {
      status:snapshot?.operationalScore?.status??"unavailable",
      goalsFor:snapshot?.operationalScore?.goalsFor??null,
      goalsAgainst:snapshot?.operationalScore?.goalsAgainst??null,
    },
  };
}
