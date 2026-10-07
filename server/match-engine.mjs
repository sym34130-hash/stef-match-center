import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

const REQUIRED_COLUMNS = {
  operator: ["operateur"],
  startedAt: ["date heure de debut d operation", "date heure debut operation"],
  operationType: ["type d operation", "type operation"],
  position: ["n position", "numero position", "position"],
  travelCode: ["code voyage", "voyage"],
  agencySegment: ["agence segment", "agence"],
  segmentType: ["type segment"],
  operatorFilter: ["filtre operateur"],
  hourFilter: ["filtre heure"],
  post: ["poste"],
  unzonedFilter: ["poz non zonees", "positions non zonees"],
  dz: ["dz"],
  duelWonFlag: ["duels gagnes", "duel gagne"],
};

const OPERATION_ROLE = {
  CHG: "Attaquant",
  ZONAGE: "Milieu",
  DECHG: "Défenseur",
};

const ROLE_LABELS = ["Attaquant", "Milieu", "Défenseur"];
const DEFAULT_PERFORMANCE_CRITERIA = Object.freeze({
  zonageMinutes: 30,
  loadingSeconds: 165,
  unloadingSeconds: 60,
  scoreTargetPercent: 50,
});
const DEFAULT_PERIOD_START = "13:00";
const DEFAULT_PERIOD_END = "22:30";
// Increment when a persisted snapshot's calculation semantics change so the
// API rebuilds older snapshots instead of serving stale KPI values.
export const KPI_DICTIONARY_VERSION = 19;

const WORKBOOK_PARSE_CACHE_LIMIT = 6;
const workbookParseCache = new Map();
const SNAPSHOT_BUILD_CACHE_LIMIT = 24;
const snapshotBuildCache = new Map();
const parisOffsetCache = new Map();

export function normalizePerformanceCriteria(input = {}) {
  return {
    zonageMinutes: normalizePositiveInteger(input.zonageMinutes, DEFAULT_PERFORMANCE_CRITERIA.zonageMinutes),
    loadingSeconds: normalizePositiveInteger(input.loadingSeconds, DEFAULT_PERFORMANCE_CRITERIA.loadingSeconds),
    unloadingSeconds: normalizePositiveInteger(input.unloadingSeconds, DEFAULT_PERFORMANCE_CRITERIA.unloadingSeconds),
    scoreTargetPercent: Math.min(100, normalizePositiveInteger(input.scoreTargetPercent, DEFAULT_PERFORMANCE_CRITERIA.scoreTargetPercent)),
  };
}

function normalizePositiveInteger(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? Math.round(numericValue) : fallback;
}

function normalizeTravelCodes(value) {
  return new Set(
    Array.isArray(value)
      ? value.map((code) => cleanText(code)).filter(Boolean)
      : [],
  );
}

export function normalizeTimeRange(start = DEFAULT_PERIOD_START, end = DEFAULT_PERIOD_END) {
  const startMinutes = parseTimeInput(start);
  const endMinutes = parseTimeInput(end);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
    throw new Error("La plage horaire doit être comprise entre deux heures valides, par pas de 30 minutes.");
  }
  const isOvernight = endMinutes < startMinutes;
  return {
    start: formatTimeInput(startMinutes),
    end: formatTimeInput(endMinutes),
    startMinutes,
    endMinutes,
    durationMinutes: isOvernight ? 1440 - startMinutes + endMinutes : endMinutes - startMinutes,
    isOvernight,
    label: `${formatTimeInput(startMinutes)}-${formatTimeInput(endMinutes)}`,
  };
}

export function isTimeRangeWithin(period, activePeriod) {
  if (!period || !activePeriod) return false;
  const duration = period.durationMinutes ?? (period.endMinutes >= period.startMinutes
    ? period.endMinutes - period.startMinutes
    : 1440 - period.startMinutes + period.endMinutes);
  const activeDuration = activePeriod.durationMinutes ?? (activePeriod.endMinutes >= activePeriod.startMinutes
    ? activePeriod.endMinutes - activePeriod.startMinutes
    : 1440 - activePeriod.startMinutes + activePeriod.endMinutes);
  if (duration > activeDuration) return false;

  const offset = activePeriod.isOvernight && period.startMinutes < activePeriod.startMinutes
    ? period.startMinutes + 1440 - activePeriod.startMinutes
    : period.startMinutes - activePeriod.startMinutes;
  return offset >= 0 && offset + duration <= activeDuration;
}

export const KPI_DICTIONARY = [
  {
    id: "match.operations",
    label: "Opérations",
    source: "Données!A:G",
    formula: "COUNTROWS(Données) avec Filtre opérateur vide et heure de début comprise dans la plage active (fin incluse)",
    denominator: "Lignes Excel retenues dans le match",
    display: "Volume filtré du match",
  },
  {
    id: "match.positions",
    label: "Positions",
    source: "Données",
    formula: "DISTINCTCOUNT(N° Position) avec Filtre opérateur vide et heure de début comprise dans la plage active (fin incluse)",
    denominator: "Positions distinctes du match filtré",
    display: "Positions retenues dans le match",
  },
  {
    id: "match.players",
    label: "Joueurs",
    source: "Données",
    formula: "DISTINCTCOUNT(Opérateur) avec Filtre opérateur vide et heure de début comprise dans la plage active (fin incluse)",
    denominator: "Opérateurs retenus par l'Excel",
    display: "Joueurs actifs",
  },
  {
    id: "score.duels",
    label: "Duels gagnés",
    source: "Données!R:T",
    formula: "SUM(indicateur gagné) / COUNT(indicateur disponible) après Filtre opérateur vide, plage active (fin incluse) et exclusion Poz non zonées ; DZ <= cible zonage active lorsqu'il est renseigné, sinon le drapeau Duels gagnés",
    denominator: "Lignes éligibles au score Excel",
    display: "Score collectif",
  },
  {
    id: "score.passesHourly",
    label: "Passes réussies par heure",
    source: "X!FD:FG (source chart1)",
    formula: "Reprise de X!FG par heure X!FF ; contrôle de cohérence EX / (EW + EX) via le bloc horaire X!EV:EZ",
    denominator: "Lignes horaires présentes dans la table graphique Excel",
    display: "Courbe horaire % passes réussies",
  },
  {
    id: "score.operational",
    label: "Score opérationnel",
    source: "Données!R:T + TCD PPT!U + Données filtrées DECHG/ZONAGE",
    formula: "Nombre des 4 indicateurs dont le pourcentage dépasse strictement l'objectif de la ligue - indicateurs atteints / indicateurs sous objectif",
    denominator: "4 indicateurs disponibles : passes réussies, tirs cadrés, duels gagnés et possession",
    display: "Score au format football",
  },
  {
    id: "score.loading",
    label: "Tirs cadrés",
    source: "TCD PPT!U",
    formula: "COUNT des voyages éligibles dont le temps moyen par position est <= au seuil de chargement actif",
    denominator: "Voyages CHG avec au moins 15 positions et une durée positive dans la plage active",
    display: "Part des tirs cadrés dans le délai cible",
  },
  {
    id: "score.possession",
    label: "Possession",
    source: "Données filtrées",
    formula: "Positions RECEPTION uniques ayant aussi un ZONAGE / positions RECEPTION uniques, dans le même périmètre actif",
    denominator: "Positions distinctes de réception (DECHG) du match filtré",
    display: "Part des réceptions associées à un zonage, bornée entre 0 et 100 %",
  },
  {
    id: "player.volumeIndex",
    label: "Indice volume",
    source: "Données",
    formula: "Opérations du joueur / opérations du joueur de référence * 100",
    denominator: "Plus gros volume joueur du match filtré",
    display: "Volume vs référence",
  },
  {
    id: "player.polyvalence",
    label: "Polyvalence",
    source: "Données",
    formula: "0 si le joueur n'exerce qu'une activité ; sinon moyenne des volumes CHG, ZONAGE et DECHG rapportés au meilleur volume de chaque activité",
    denominator: "Meilleur volume observé dans chaque activité du match filtré",
    display: "Diversité et volume multi-activité",
  },
  {
    id: "highlights.winningValue",
    label: "Valeur KPI gagnante",
    source: "Données",
    formula: "MAX du KPI concerné : total, CHG, ZONAGE ou DECHG selon la distinction",
    denominator: "Joueurs du match filtré",
    display: "Valeur du KPI, pas volume total générique",
  },
  {
    id: "composition.roles",
    label: "Répartition terrain",
    source: "Données!P + Données!C",
    formula: "Match complet : DISTINCTCOUNT(Opérateur) par Poste ; mi-temps, quart-temps et plage personnalisée : poste dominant de chaque joueur selon son activité CHG, ZONAGE ou DECHG dans la période affichée",
    denominator: "Joueurs actifs du match filtré ou de la sous-plage sélectionnée",
    display: "Équilibre de la composition",
  },
];

export function buildSnapshotFromWorkbook(buffer, sourceName, expectedAgencyCode, periodInput = {}) {
  const compositionOnly = periodInput.compositionOnly === true;
  const criteria = normalizePerformanceCriteria(periodInput.criteria);
  const excludedTravelCodes = normalizeTravelCodes(periodInput.excludedTravelCodes);
  const parsed = parseWorkbookSource(buffer);
  if (!parsed.ok) return parsed;

  const { isDerivedTemplate, rows, sourceValidation, missingColumns, rawWorkbook } = parsed;
  const autoPeriod = periodInput.start === undefined && periodInput.end === undefined
    ? inferOvernightPeriod(rows)
    : null;
  const period = normalizeTimeRange(
    periodInput.start ?? autoPeriod?.start ?? DEFAULT_PERIOD_START,
    periodInput.end ?? autoPeriod?.end ?? DEFAULT_PERIOD_END,
  );
  // The cached Excel "Filtre heure" is not authoritative in the current
  // workbook: Feuille de match contains an error in the lookup that feeds it.
  // Always apply the selected clock window to the parsed start date instead.
  period.useExcelPeriod = false;
  period.useDerivedRows = isDerivedTemplate;
  const buildCacheKey = [
    parsed.cacheKey,
    expectedAgencyCode ?? "",
    period.label,
    period.useExcelPeriod ? "excel-period" : "clock-period",
    `criteria-${criteria.zonageMinutes}-${criteria.loadingSeconds}-${criteria.unloadingSeconds}-${criteria.scoreTargetPercent}`,
    `excluded-${Array.from(excludedTravelCodes).sort().join(",")}`,
    `106j-${periodInput.dailyIndicators?.importedAt ?? "none"}`,
    compositionOnly ? "composition" : "snapshot",
  ].join("|");
  const cachedSnapshot = snapshotBuildCache.get(buildCacheKey);
  if (cachedSnapshot) {
    snapshotBuildCache.delete(buildCacheKey);
    snapshotBuildCache.set(buildCacheKey, cachedSnapshot);
    if (compositionOnly) return cachedSnapshot;
    return {
      ok: true,
      snapshot: {
        ...cachedSnapshot.snapshot,
        sourceName,
        importedAt: new Date().toISOString(),
      },
    };
  }

  if (missingColumns.length > 0) {
    return {
      ok: false,
      error: userError(
        "FICHIER NON IMPORTÉ",
        `Colonne obligatoire absente : ${missingColumns.join(", ")}.`
      ),
    };
  }
  if (sourceValidation.rowCount === 0 || rows.length === 0) {
    return {
      ok: false,
      error: userError("FICHIER NON IMPORTÉ", "Aucune opération exploitable n'a été trouvée."),
    };
  }

  const validation = {
    ...sourceValidation,
    warnings: [],
  };

  if (validation.criticalMissingRows > 0) {
    validation.warnings.push(`${validation.criticalMissingRows} ligne(s) avec une donnée critique manquante.`);
  }
  if (validation.invalidDateRows > 0) {
    validation.warnings.push(`${validation.invalidDateRows} date(s) non lisible(s).`);
  }
  if (validation.unknownOperationRows > 0) {
    validation.warnings.push(`${validation.unknownOperationRows} type(s) d'opération non reconnu(s).`);
  }
  if (validation.duplicateRows > 0) {
    validation.warnings.push(`${validation.duplicateRows} doublon(s) potentiel(s) détecté(s).`);
  }

  const filterStats = buildFilterStats(rows, period, criteria, excludedTravelCodes);
  validation.filterStats = filterStats;
  validation.kpiRules = {
    matchFilter: `Filtre opérateur + plage ${period.label} (fin incluse)`,
    scoringFilter: `Filtre opérateur + plage ${period.label} (fin incluse) + exclusion Poz non zonées`,
    zonageTarget: `${criteria.zonageMinutes} minutes`,
    loadingTarget: formatDuration(criteria.loadingSeconds),
    unloadingTarget: formatDuration(criteria.unloadingSeconds),
    scoreIndicators: "4 indicateurs : passes réussies, tirs cadrés, duels gagnés et possession",
    scoreTarget: `${criteria.scoreTargetPercent}% par indicateur`,
    period: period.label,
  };
  if (filterStats.matchRows === 0) {
    validation.warnings.push(`Aucune ligne ne passe le filtre opérateur + plage ${period.label}.`);
  }
  if (filterStats.scoringRows === 0) {
    validation.warnings.push("Aucune ligne éligible au score après exclusion des positions non zonées.");
  }

  const matchRows = rows.filter((row) => isMatchRow(row, period) && !excludedTravelCodes.has(row.travelCode));
  const scoringRows = isDerivedTemplate
    ? buildDerivedScoringRows(matchRows, criteria.zonageMinutes * 60)
    : buildScoringRows(matchRows, period, criteria.zonageMinutes * 60);
  if (compositionOnly) {
    const compositionResult = {
      ok: true,
      period,
      // A custom composition is a period-scoped view: recalculate each
      // player's current line from the activities present in that range.
      players: buildPlayers(matchRows, { periodScopedRole: true }),
      compositionPeriods: buildCompositionPeriods(matchRows, period),
    };
    snapshotBuildCache.set(buildCacheKey, compositionResult);
    while (snapshotBuildCache.size > SNAPSHOT_BUILD_CACHE_LIMIT) {
      snapshotBuildCache.delete(snapshotBuildCache.keys().next().value);
    }
    return compositionResult;
  }
  const agencyCounts = countBy(matchRows.length > 0 ? matchRows : rows, (row) => row.agencySegment || "Non renseignée");
  const detectedAgency = isDerivedTemplate
    ? expectedAgencyCode
    : topEntry(agencyCounts)?.key ?? expectedAgencyCode;
  if (expectedAgencyCode && detectedAgency && detectedAgency !== expectedAgencyCode) {
    validation.warnings.push(
      `Agence majoritaire détectée : ${detectedAgency}. Espace importé : ${expectedAgencyCode}.`
    );
  }

  const snapshot = buildMatchSnapshot({
    sourceRows: rows,
    matchRows,
    scoringRows,
    sourceName,
    expectedAgencyCode,
    detectedAgency,
    validation,
    filterStats,
    period,
    criteria,
    hourlyPassPerformance: buildHourlyPassPerformance(rawWorkbook, period, rows.filter((row) => !excludedTravelCodes.has(row.travelCode))),
    loadingQuality: buildLoadingQualityFromTcd(rawWorkbook, period, criteria.loadingSeconds, excludedTravelCodes),
    unloadingDuelQuality: buildUnloadingDuelQuality(rawWorkbook, period, matchRows, excludedTravelCodes),
    unloadingQuality: buildUnloadingQuality(matchRows, criteria.unloadingSeconds),
    yellowCards: buildYellowCards(rawWorkbook, period, excludedTravelCodes),
    excludedTravelCodes,
    dailyIndicators: periodInput.dailyIndicators ?? null,
  });

  const result = { ok: true, snapshot };
  snapshotBuildCache.set(buildCacheKey, result);
  while (snapshotBuildCache.size > SNAPSHOT_BUILD_CACHE_LIMIT) {
    snapshotBuildCache.delete(snapshotBuildCache.keys().next().value);
  }
  return result;
}

function parseWorkbookSource(buffer) {
  const cacheKey = createHash("sha1").update(buffer).digest("hex");
  const cached = workbookParseCache.get(cacheKey);
  if (cached) {
    workbookParseCache.delete(cacheKey);
    workbookParseCache.set(cacheKey, cached);
    return cached;
  }

  const workbook = XLSX.read(buffer, {
    type: "buffer",
    // Parse Excel date serials ourselves so library timezone defaults cannot
    // shift the operator-selected Paris time window.
    cellDates: false,
    cellFormula: false,
    cellNF: false,
    cellStyles: false,
  });
  // The raw workbook also provides the displayed values used for durations.
  const rawWorkbook = workbook;
  const dataSheetName = findDataSheet(workbook.SheetNames);
  if (!dataSheetName) {
    return {
      ok: false,
      error: userError("FICHIER NON IMPORTÉ", "L'onglet “Données” est absent."),
    };
  }

  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[dataSheetName], {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
  const rawMatrix = matrix;
  if (matrix.length < 2) {
    return {
      ok: false,
      error: userError("FICHIER NON IMPORTÉ", "L'onglet “Données” ne contient aucune ligne exploitable."),
    };
  }

  const headerRow = matrix[0].map((value) => String(value ?? ""));
  const columnMap = mapColumns(headerRow);
  const missingColumns = Object.entries(REQUIRED_COLUMNS)
    .filter(([key]) => columnMap[key] === undefined)
    .map(([, aliases]) => aliases[0]);
  const isDerivedTemplate = isNewDataTemplate(headerRow) && !hasUsableCalculatedColumns(rawMatrix.slice(1), columnMap);
  const sourceValidation = {
    rowCount: 0,
    criticalMissingRows: 0,
    invalidDateRows: 0,
    unknownOperationRows: 0,
    duplicateRows: 0,
    issueRows: 0,
  };
  const rows = [];
  const duplicateKeys = new Set();
  const duplicatedKeys = new Set();
  const issueRowIndexes = new Set();

  for (let index = 1; index < matrix.length; index += 1) {
    const row = matrix[index];
    const raw = readRow(row, columnMap);
    const rawValues = readRow(rawMatrix[index] ?? [], columnMap);
    // A:G are the source fields. H:T contain formulas copied below the real
    // import range and must not be treated as additional source records.
    const hasSourceContent = [
      raw.operator,
      raw.startedAt,
      raw.operationType,
      raw.position,
      raw.travelCode,
      raw.agencySegment,
      raw.segmentType,
    ].some((value) => String(value ?? "").trim() !== "");
    if (!hasSourceContent) continue;

    sourceValidation.rowCount += 1;

    const operator = cleanText(raw.operator);
    const operationType = cleanText(raw.operationType).toUpperCase();
    const position = cleanText(raw.position);
    const travelCode = cleanText(raw.travelCode);
    const agencySegment = cleanText(raw.agencySegment);
    const segmentType = cleanText(raw.segmentType);
    const operatorFilter = cleanText(raw.operatorFilter);
    const hourFilter = cleanText(raw.hourFilter);
    const post = isDerivedTemplate
      ? OPERATION_ROLE[operationType] || "Joueur"
      : cleanRole(raw.post) || OPERATION_ROLE[operationType] || "Joueur";
    const unzonedFilter = isDerivedTemplate ? "" : cleanText(raw.unzonedFilter);
    const dzCell = rawWorkbook.Sheets[dataSheetName]?.[XLSX.utils.encode_cell({ r: index, c: columnMap.dz })];
    const dz = isDerivedTemplate ? null : parseDurationSeconds(rawValues.dz, dzCell?.w);
    const duelWonFlag = isDerivedTemplate ? null : parseDuelFlag(raw.duelWonFlag);
    const startedAt = parseExcelDate(raw.startedAt);

    const hasCriticalIssue = !operator || !operationType || !position || !raw.startedAt;
    const hasInvalidDate = !startedAt;
    if (hasCriticalIssue) sourceValidation.criticalMissingRows += 1;
    if (hasInvalidDate) sourceValidation.invalidDateRows += 1;
    if (hasCriticalIssue || hasInvalidDate) issueRowIndexes.add(index);
    if (operationType && !OPERATION_ROLE[operationType]) sourceValidation.unknownOperationRows += 1;

    const duplicateKey = [operator, operationType, position, startedAt?.toISOString() ?? raw.startedAt].join("|");
    if (duplicateKeys.has(duplicateKey)) duplicatedKeys.add(duplicateKey);
    duplicateKeys.add(duplicateKey);

    if (operator && operationType && position && startedAt && OPERATION_ROLE[operationType]) {
      rows.push({
        operator,
        operationType,
        position,
        travelCode,
        hourOperation: parseNumber(columnMap.hourOperation === undefined ? null : row[columnMap.hourOperation]),
        agencySegment,
        segmentType,
        operatorFilter,
        hourFilter,
        post,
        unzonedFilter,
        dz,
        duelWonFlag,
        startedAt,
      });
    }
  }

  sourceValidation.duplicateRows = duplicatedKeys.size;
  sourceValidation.issueRows = issueRowIndexes.size;
  const parsed = {
    ok: true,
    cacheKey,
    workbook,
    rawWorkbook,
    matrix,
    rawMatrix,
    columnMap,
    missingColumns,
    isDerivedTemplate,
    rows,
    sourceValidation,
  };
  workbookParseCache.set(cacheKey, parsed);
  while (workbookParseCache.size > WORKBOOK_PARSE_CACHE_LIMIT) {
    workbookParseCache.delete(workbookParseCache.keys().next().value);
  }
  return parsed;
}

export function buildCompositionViewFromWorkbook(buffer, sourceName, expectedAgencyCode, periodInput = {}) {
  return buildSnapshotFromWorkbook(buffer, sourceName, expectedAgencyCode, {
    ...periodInput,
    compositionOnly: true,
  });
}

export function normalizeSnapshotContract(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.players)) return snapshot;
  const categoryLeaders = selectCategoryLeaders(snapshot.players);
  const performanceCriteria = normalizePerformanceCriteria(snapshot.performanceCriteria);
  const summary = snapshot.summary
    ? {
        ...snapshot.summary,
        possessionPercent: snapshot.summary.possessionPercent ?? null,
        possessionPositions: {
          zonage: snapshot.summary.possessionPositions?.zonage ?? 0,
          reception: snapshot.summary.possessionPositions?.reception ?? 0,
          matched: snapshot.summary.possessionPositions?.matched ?? null,
        },
      }
    : snapshot.summary;
  const validation = snapshot.validation
    ? {
        ...snapshot.validation,
        issueRows:
          snapshot.validation.issueRows ??
          Math.max(
            snapshot.validation.criticalMissingRows ?? 0,
            snapshot.validation.invalidDateRows ?? 0,
            snapshot.validation.unknownOperationRows ?? 0,
          ),
      }
    : snapshot.validation;
  return {
    ...snapshot,
    performanceCriteria,
    summary,
    validation,
    highlights: {
      ...(snapshot.highlights ?? {}),
      ...buildCategoryHighlights(categoryLeaders),
    },
  };
}

function buildMatchSnapshot({ sourceRows, matchRows, scoringRows, sourceName, expectedAgencyCode, detectedAgency, validation, filterStats, period, criteria, hourlyPassPerformance, loadingQuality, unloadingDuelQuality, unloadingQuality, yellowCards, dailyIndicators, excludedTravelCodes }) {
  const importedAt = new Date();
  const firstOperation = minDate(matchRows.map((row) => row.startedAt));
  const lastOperation = maxDate(matchRows.map((row) => row.startedAt));
  const operationCounts = countBy(matchRows, (row) => row.operationType);
  const positions = buildPositions(matchRows, period, scoringRows, criteria);
  const players = buildPlayers(matchRows);
  const topPlayers = sortDesc(players, "operations");
  const categoryLeaders = selectCategoryLeaders(players);
  const duelWon = scoringRows.filter((row) => row.duelWonFlag === 1).length;
  const duelTotal = scoringRows.filter((row) => row.duelWonFlag === 0 || row.duelWonFlag === 1).length;
  const duelRate = duelTotal > 0 ? percent(duelWon, duelTotal) : null;
  const possession = buildPossessionScore(matchRows);
  const score = duelRate === null ? null : Math.round(duelRate);
  const operationalScore = buildOperationalScore(
    hourlyPassPerformance.totalRate,
    loadingQuality,
    unloadingQuality,
    possession.percent,
    criteria.loadingSeconds,
    criteria.scoreTargetPercent,
  );
  const status = statusFromOperationalScore(operationalScore);
  const totalOperations = matchRows.length;
  const averageOperations = totalOperations / Math.max(players.length, 1);
  const roleCounts = countBy(players, (player) => player.role);

  const roleDistribution = ROLE_LABELS.map((role) => ({
    role,
    count: roleCounts[role] ?? 0,
    percent: percent(roleCounts[role] ?? 0, players.length),
  }));

  const openDuelRows = scoringRows.filter((row) => row.duelWonFlag === 0);
  const travelRisks = Object.entries(
    openDuelRows.reduce((acc, row) => {
      const code = row.travelCode || "Non renseigné";
      acc[code] = (acc[code] ?? 0) + 1;
      return acc;
    }, {})
  )
    .map(([travelCode, delayedPositions]) => ({ travelCode, delayedPositions }))
    .sort((a, b) => b.delayedPositions - a.delayedPositions)
    .slice(0, 8);

  const specialists = players
    .filter((player) => player.dominantShare >= 90 && player.operations >= Math.max(10, averageOperations * 0.4))
    .sort((a, b) => b.dominantShare - a.dominantShare)
    .slice(0, 6);

  const polyvalents = players
    .filter((player) => player.operationTypes >= 2)
    .sort((a, b) => b.polyvalence - a.polyvalence || b.operations - a.operations)
    .slice(0, 6);

  const progressPlayers = players
    .filter((player) => player.operations < averageOperations * 0.65)
    .sort((a, b) => a.operations - b.operations)
    .slice(0, 5);

  const weakRole = roleDistribution.reduce((min, current) => (current.count < min.count ? current : min), roleDistribution[0]);
  return {
    version: 1,
    sourceName,
    importedAt: importedAt.toISOString(),
    excludedTravelCodes: Array.from(excludedTravelCodes ?? []).sort((left, right) => left.localeCompare(right, "fr")),
    agency: {
      code: expectedAgencyCode || detectedAgency || "AGENCE",
      detectedCode: detectedAgency,
      name: `Agence ${expectedAgencyCode || detectedAgency || ""}`.trim(),
    },
    match: {
      date: firstOperation ? firstOperation.toISOString().slice(0, 10) : importedAt.toISOString().slice(0, 10),
      firstOperation: firstOperation?.toISOString() ?? null,
      lastOperation: lastOperation?.toISOString() ?? null,
      // This label describes the operator-selected window. The actual first
      // and last operation remain available separately for data provenance.
      timeRangeLabel: `${period.start} - ${period.end}`,
      score,
      status,
      objective: `Tenir le délai cible de zonage à ${criteria.zonageMinutes} minutes.`,
      dzTargetMinutes: criteria.zonageMinutes,
      periodStart: period.start,
      periodEnd: period.end,
      periodLabel: period.label,
      filterDescription: `Filtre opérateur + plage ${period.label}`,
      scoringFilterDescription: `Filtre opérateur + plage ${period.label} + exclusion Poz non zonées + DZ <= ${criteria.zonageMinutes} min lorsque renseigné`,
    },
    summary: {
      operations: totalOperations,
      positions: positions.length,
      players: players.length,
      travels: new Set(matchRows.map((row) => row.travelCode).filter(Boolean)).size,
      duelWon,
      duelTotal,
      duelRate,
      passRate: hourlyPassPerformance.totalRate,
      tonnage: dailyIndicators?.expedition?.tonnage ?? null,
      possessionPercent: possession.percent,
      possessionPositions: {
        zonage: possession.zonagePositions,
        reception: possession.receptionPositions,
        matched: possession.matchedPositions,
      },
      operationCounts,
      roleDistribution,
      sourceRows: sourceRows.length,
      scoringRows: scoringRows.length,
      excludedByPeriod: filterStats.excludedByPeriod,
      excludedByOperator: filterStats.excludedByOperator,
      excludedByTravel: filterStats.excludedByTravel ?? 0,
      excludedFromScore: filterStats.excludedFromScore,
    },
    hourlyPerformance: hourlyPassPerformance.items,
    loadingQuality,
    unloadingDuelQuality,
    unloadingQuality,
    operationalScore,
    yellowCards,
    dailyIndicators,
    duelQuality: buildDuelQuality(scoringRows, matchRows, positions, duelWon, duelTotal),
    compositionPeriods: buildCompositionPeriods(matchRows, period),
    highlights: buildCategoryHighlights(categoryLeaders),
    players,
    positions,
    coach: {
      playersInForm: topPlayers.slice(0, 5),
      polyvalents,
      specialists,
      progressPlayers,
      alerts: buildAlerts({ validation, openDuelRows, duelTotal, weakRole }),
      travelRisks,
    },
    causerie: buildCauserie({
      passRate: hourlyPassPerformance.totalRate,
      loadingPercent: loadingQuality.targetedPercent,
      unloadingPercent: unloadingQuality.targetedPercent,
      possessionPercent: possession.percent,
      scoreTargetPercent: criteria.scoreTargetPercent,
      openDuelRows,
      weakRole,
      validation,
      zonageMinutes: criteria.zonageMinutes,
    }),
    performanceCriteria: criteria,
    validation,
    kpiDictionaryVersion: KPI_DICTIONARY_VERSION,
  };
}

function buildDuelQuality(scoringRows, matchRows, positions, duelWon, duelTotal) {
  const lostRows = scoringRows.filter((row) => row.duelWonFlag === 0);
  const lostPositionIds = new Set(lostRows.map((row) => row.position));
  const travelGroups = new Map();
  const allTravelRows = new Map();
  for (const row of matchRows) {
    const travelCode = row.travelCode || "Non renseigné";
    if (!allTravelRows.has(travelCode)) allTravelRows.set(travelCode, []);
    allTravelRows.get(travelCode).push(row);
  }
  for (const position of positions.filter((item) => lostPositionIds.has(item.id))) {
    const travelCode = position.travelCode || "Non renseigné";
    if (!travelGroups.has(travelCode)) {
      travelGroups.set(travelCode, {
        travelCode,
        agency: position.agencySegment || "Non renseignée",
        positions: 0,
        firstOperation: null,
        lastOperation: null,
      });
    }
    const group = travelGroups.get(travelCode);
    group.positions += 1;
    const first = new Date(position.firstOperation);
    const last = new Date(position.lastOperation);
    group.firstOperation = minDate([group.firstOperation, first]);
    group.lastOperation = maxDate([group.lastOperation, last]);
  }

  const lostDuels = Array.from(travelGroups.values())
    .map((group) => {
      const travelRows = allTravelRows.get(group.travelCode) ?? [];
      const first = minDate([group.firstOperation, minDate(travelRows.map((row) => row.startedAt))]);
      const last = maxDate([group.lastOperation, maxDate(travelRows.map((row) => row.startedAt))]);
      const elapsedSeconds = first && last ? Math.max(0, Math.round((last.getTime() - first.getTime()) / 1000)) : 0;
      return {
        travelCode: group.travelCode,
        agency: group.agency,
        time: formatDateClock(first),
        positions: group.positions,
        timePerPosition: formatDuration(Math.round(elapsedSeconds / Math.max(group.positions, 1))),
      };
    })
    .sort((a, b) => b.positions - a.positions || a.travelCode.localeCompare(b.travelCode, "fr"))
    .slice(0, 14);

  return {
    won: duelWon,
    lost: Math.max(0, duelTotal - duelWon),
    wonPercent: duelTotal > 0 ? percent(duelWon, duelTotal) : null,
    lostPercent: duelTotal > 0 ? percent(Math.max(0, duelTotal - duelWon), duelTotal) : null,
    lostDuels,
  };
}

function formatDateClock(date) {
  if (!date) return "Non renseignée";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildLoadingQualityFromTcd(workbook, period, configuredTargetSeconds, excludedTravelCodes = new Set()) {
  const targetSeconds = normalizePositiveInteger(configuredTargetSeconds, DEFAULT_PERFORMANCE_CRITERIA.loadingSeconds);
  const empty = {
    targeted: 0,
    offTarget: 0,
    targetedPercent: null,
    offTargetPercent: null,
    targetTimePerPosition: formatDuration(targetSeconds),
    averageTimePerPositionSeconds: null,
    loadingDetails: [],
    nonTargetedShots: [],
  };
  const sheetName = workbook?.SheetNames?.find((name) => normalizeKey(name) === "tcd ppt");
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) return empty;

  const anchor = Object.entries(sheet).find(([address, cell]) => !address.startsWith("!") && normalizeKey(cell?.v) === "chargement");
  if (!anchor) return empty;
  const anchorCell = XLSX.utils.decode_cell(anchor[0]);
  let header;
  for (let row = anchorCell.r; row <= anchorCell.r + 16 && !header; row += 1) {
    const cells = [];
    for (let col = anchorCell.c; col <= anchorCell.c + 14; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const value = normalizeKey(sheet[address]?.v);
      if (value) cells.push({ col, value });
    }
    if (cells.some((cell) => cell.value === "code voyage") && cells.some((cell) => cell.value === "tc") && cells.some((cell) => cell.value === "tc poz")) {
      header = { row, cells };
    }
  }
  if (!header) return empty;
  const findColumn = (predicate) => header.cells.find((cell) => predicate(cell.value))?.col;
  const travelColumn = findColumn((value) => value === "code voyage");
  const startColumn = findColumn((value) => value.startsWith("min de date heure de debut d operation"));
  const positionsColumn = findColumn((value) => value === "nombre de n position");
  const totalTimeColumn = findColumn((value) => value === "tc");
  // In TCD PPT, U is the raw TC/S value. V is a separately filtered display
  // formula and must not be used as the source for the KPI.
  const timePerPositionColumn = totalTimeColumn === undefined ? undefined : totalTimeColumn + 1;
  const commentColumn = findColumn((value) => value === "commentaire");
  const loadingDetailsByTravel = readLoadingDetails(workbook);
  const strikeLexicon = new Map();
  for (let row = 1; row <= 8; row += 1) {
    // SheetJS columns are zero-indexed: Excel X:Y are c:23 and c:24.
    const rawCode = sheet[XLSX.utils.encode_cell({ r: row, c: 23 })]?.v;
    const label = cleanText(sheet[XLSX.utils.encode_cell({ r: row, c: 24 })]?.v);
    const numericCode = parseNumber(rawCode);
    if (Number.isInteger(numericCode) && numericCode >= 0 && label) {
      const code = String(numericCode);
      strikeLexicon.set(normalizeKey(code), label);
      strikeLexicon.set(normalizeKey(label), label);
    }
  }
  if ([travelColumn, startColumn, positionsColumn, totalTimeColumn, timePerPositionColumn].some((value) => value === undefined)) return empty;

  const loadingDetails = [];
  const loadingDurations = [];
  const lastRow = sheetEndRow(sheet, header.row + 1);
  for (let row = header.row + 1; row <= lastRow; row += 1) {
    const travel = cleanText(sheet[XLSX.utils.encode_cell({ r: row, c: travelColumn })]?.v);
    const timePerPositionCell = sheet[XLSX.utils.encode_cell({ r: row, c: timePerPositionColumn })];
    const timePerPositionSeconds = parseDurationSeconds(timePerPositionCell?.v, timePerPositionCell?.w);
    const positions = parseNumber(sheet[XLSX.utils.encode_cell({ r: row, c: positionsColumn })]?.v);
    if (!travel || excludedTravelCodes.has(travel) || !Number.isFinite(positions) || positions < 15 || !Number.isFinite(timePerPositionSeconds) || timePerPositionSeconds <= 0) continue;
    const start = parseExcelDate(sheet[XLSX.utils.encode_cell({ r: row, c: startColumn })]?.v);
    if (!isInActiveTimeRange(start, period)) continue;
    const result = timePerPositionSeconds <= targetSeconds ? "cadré" : "non cadré";
    const rawWhere = commentColumn === undefined ? "" : cleanText(sheet[XLSX.utils.encode_cell({ r: row, c: commentColumn })]?.v);
    const sourceDetail = loadingDetailsByTravel.get(travel);
    const where = strikeLexicon.get(normalizeKey(rawWhere)) ?? (rawWhere || sourceDetail?.where || "");
    loadingDetails.push({
      travelCode: travel,
      time: formatDateClock(start),
      positions: cleanText(sheet[XLSX.utils.encode_cell({ r: row, c: positionsColumn })]?.v),
      timePerPosition: formatDuration(timePerPositionSeconds),
      where,
      result,
    });
    loadingDurations.push(timePerPositionSeconds);
  }
  const targeted = loadingDetails.filter((detail) => detail.result === "cadré").length;
  const offTarget = loadingDetails.length - targeted;
  const averageTimePerPositionSeconds = loadingDetails.length > 0
    ? Math.round(loadingDurations.reduce((sum, seconds) => sum + seconds, 0) / loadingDurations.length)
    : null;
  loadingDetails.sort(compareTimePerPositionDescending);
  return {
    targeted,
    offTarget,
    targetedPercent: loadingDetails.length > 0 ? percent(targeted, loadingDetails.length) : null,
    offTargetPercent: loadingDetails.length > 0 ? percent(offTarget, loadingDetails.length) : null,
    targetTimePerPosition: formatDuration(targetSeconds),
    averageTimePerPositionSeconds,
    loadingDetails,
    nonTargetedShots: loadingDetails.filter((detail) => detail.result === "non cadré"),
  };
}

function sheetEndRow(sheet, fallbackRow) {
  const reference = sheet?.["!ref"];
  if (!reference) return fallbackRow;
  try {
    return Math.max(fallbackRow, XLSX.utils.decode_range(reference).e.r);
  } catch {
    return fallbackRow;
  }
}

function resolveUnloadingAgencies(matchRows) {
  const candidatesByTravel = new Map();
  // matchRows already respects the active period, operator filter and exclusions.
  for (const row of matchRows) {
    if (row.operationType !== "DECHG" || !row.travelCode || !row.agencySegment) continue;
    if (!candidatesByTravel.has(row.travelCode)) candidatesByTravel.set(row.travelCode, new Map());
    const candidates = candidatesByTravel.get(row.travelCode);
    const candidate = candidates.get(row.agencySegment) ?? { count: 0, firstAt: Infinity };
    candidate.count += 1;
    candidate.firstAt = Math.min(candidate.firstAt, row.startedAt.getTime());
    candidates.set(row.agencySegment, candidate);
  }
  const agencies = new Map();
  for (const [travel, candidates] of candidatesByTravel) {
    let best = null;
    for (const [agency, candidate] of candidates) {
      // Ties use the earliest DECHG; identical timestamps keep source row order.
      if (!best || candidate.count > best.count || (candidate.count === best.count && candidate.firstAt < best.firstAt)) {
        best = { agency, ...candidate };
      }
    }
    agencies.set(travel, best.agency);
  }
  return agencies;
}

function buildUnloadingDuelQuality(workbook, period, matchRows, excludedTravelCodes = new Set()) {
  const empty = { won: 0, lost: 0, wonPercent: null, lostPercent: null, duels: [], lostDuels: [] };
  const sheetName = workbook?.SheetNames?.find((name) => normalizeKey(name) === "tcd ppt");
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) return empty;

  // The Déchargement pivot is the authoritative source for this carousel card:
  // one row per eligible reception, with the result in "Duels gagnés".
  const anchor = Object.entries(sheet)
    .find(([address, cell]) => !address.startsWith("!") && normalizeKey(cell?.v) === "dechargement");
  if (!anchor) return empty;
  const anchorCell = XLSX.utils.decode_cell(anchor[0]);
  const headerRows = [];
  for (let row = anchorCell.r; row <= anchorCell.r + 16; row += 1) {
    const cells = [];
    for (let col = anchorCell.c; col <= anchorCell.c + 14; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const value = normalizeKey(sheet[address]?.v);
      if (value) cells.push({ col, value });
    }
    if (cells.some((cell) => cell.value === "code voyage") && cells.some((cell) => cell.value === "duels gagnes") && cells.some((cell) => cell.value === "duels perdus")) {
      headerRows.push({ row, cells });
    }
  }
  const header = headerRows[0];
  if (!header) return empty;
  const findColumn = (predicate) => header.cells.find((cell) => predicate(cell.value))?.col;
  const travelColumn = findColumn((value) => value === "code voyage");
  const wonColumn = findColumn((value) => value === "duels gagnes");
  const totalColumn = findColumn((value) => value === "duels");
  const positionsColumn = findColumn((value) => value === "nombre de n position");
  const endColumn = findColumn((value) => value.startsWith("max de date heure de debut d operation"));
  const startColumn = findColumn((value) => value.startsWith("min de date heure de debut d operation"));
  if ([travelColumn, wonColumn, totalColumn, positionsColumn, startColumn, endColumn].some((value) => value === undefined)) return empty;

  const agencies = resolveUnloadingAgencies(matchRows);
  let total = 0;
  let won = 0;
  const duels = [];
  const lostDuels = [];
  const lastRow = sheetEndRow(sheet, header.row + 1);
  for (let row = header.row + 1; row <= lastRow; row += 1) {
    const travel = cleanText(sheet[XLSX.utils.encode_cell({ r: row, c: travelColumn })]?.v);
    const wonCell = sheet[XLSX.utils.encode_cell({ r: row, c: wonColumn })];
    const wonRaw = wonCell?.v;
    const wonValue = Number(wonRaw);
    const totalRaw = sheet[XLSX.utils.encode_cell({ r: row, c: totalColumn })]?.v;
    const totalValue = Number(totalRaw);
    if (!travel || excludedTravelCodes.has(travel) || !Number.isFinite(totalValue) || totalValue <= 0 || wonRaw === "" || wonRaw === null || wonRaw === undefined || !Number.isFinite(wonValue) || (wonValue !== 0 && wonValue !== 1)) continue;
    const start = parseExcelDate(sheet[XLSX.utils.encode_cell({ r: row, c: startColumn })]?.v);
    if (!isInActiveTimeRange(start, period)) continue;
    total += totalValue;
    won += wonValue;
    const end = parseExcelDate(sheet[XLSX.utils.encode_cell({ r: row, c: endColumn })]?.v);
    const positions = parseNumber(sheet[XLSX.utils.encode_cell({ r: row, c: positionsColumn })]?.v) ?? 0;
    const elapsedSeconds = start && end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)) : 0;
    const duel = {
      travelCode: travel,
      agency: agencies.get(travel) || "Non renseignée",
      time: formatDateClock(start),
      positions,
      timePerPosition: formatDuration(elapsedSeconds / Math.max(positions, 1)),
      result: wonValue === 1 ? "gagné" : "perdu",
    };
    duels.push(duel);
    if (wonValue < totalValue) lostDuels.push(duel);
  }
  const lost = Math.max(0, total - won);
  duels.sort(compareTimePerPositionDescending);
  lostDuels.sort(compareTimePerPositionDescending);
  return {
    won,
    lost,
    wonPercent: total > 0 ? percent(won, total) : null,
    lostPercent: total > 0 ? percent(lost, total) : null,
    duels,
    lostDuels,
  };
}

function buildUnloadingQuality(matchRows, configuredTargetSeconds) {
  const targetSeconds = normalizePositiveInteger(configuredTargetSeconds, DEFAULT_PERFORMANCE_CRITERIA.unloadingSeconds);
  const empty = {
    targeted: 0,
    offTarget: 0,
    targetedPercent: null,
    offTargetPercent: null,
    targetTimePerPosition: formatDuration(targetSeconds),
    averageTimePerPositionSeconds: null,
    eligibleTrips: 0,
  };
  if (!Array.isArray(matchRows)) return empty;

  const groups = new Map();
  for (const row of matchRows) {
    if (row.operationType !== "DECHG" || !row.travelCode) continue;
    if (!groups.has(row.travelCode)) groups.set(row.travelCode, []);
    groups.get(row.travelCode).push(row);
  }

  // Keep the denominator aligned with the Excel TCD: one counted position
  // row per voyage, with the total elapsed time divided by that count.
  const unloadingRows = Array.from(groups.entries()).map(([travelCode, rows]) => {
    const firstOperation = minDate(rows.map((row) => row.startedAt));
    const lastOperation = maxDate(rows.map((row) => row.startedAt));
    const elapsedSeconds = firstOperation && lastOperation
      ? Math.max(0, Math.round((lastOperation.getTime() - firstOperation.getTime()) / 1000))
      : 0;
    const timePerPositionSeconds = rows.length > 0 ? elapsedSeconds / rows.length : 0;
    return {
      travelCode,
      elapsedSeconds,
      timePerPositionSeconds,
      eligible: rows.length > 0 && elapsedSeconds > 0,
    };
  }).filter((row) => row.eligible);

  const targeted = unloadingRows.filter((row) => row.timePerPositionSeconds <= targetSeconds).length;
  const total = unloadingRows.length;
  const offTarget = Math.max(0, total - targeted);
  const averageTimePerPositionSeconds = total > 0
    ? Math.round(unloadingRows.reduce((sum, row) => sum + row.timePerPositionSeconds, 0) / total)
    : null;
  return {
    targeted,
    offTarget,
    targetedPercent: total > 0 ? percent(targeted, total) : null,
    offTargetPercent: total > 0 ? percent(offTarget, total) : null,
    targetTimePerPosition: formatDuration(targetSeconds),
    averageTimePerPositionSeconds,
    eligibleTrips: total,
  };
}

function buildYellowCards(workbook, period, excludedTravelCodes = new Set()) {
  const sheetName = workbook?.SheetNames?.find((name) => normalizeKey(name) === "feuille de match");
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: false });
  const headerIndex = rows.findIndex((row) => normalizeKey(row[36]) === "nom" && normalizeKey(row[37]) === "heure carton");
  if (headerIndex < 0) return [];

  return rows.slice(headerIndex + 1, headerIndex + 101)
    .map((row) => {
      const playerName = cleanText(row[36]);
      const rawTime = cleanText(row[37]);
      const time = formatImportedClock(rawTime);
      const clockSeconds = parseClockSeconds(rawTime);
      return {
        playerName,
        time,
        reason: cleanText(row[38]),
        travelCode: cleanText(row[39]),
        clockSeconds,
      };
    })
    .filter((card) => card.playerName && !excludedTravelCodes.has(card.travelCode) && (period.useExcelPeriod || isClockSecondsInPeriod(card.clockSeconds, period)))
    .map((card) => ({
      playerName: card.playerName,
      time: card.time,
      reason: card.reason,
      travelCode: card.travelCode,
    }));
}

function readLoadingDetails(workbook) {
  const matchSheetName = workbook.SheetNames.find((name) => normalizeKey(name) === "feuille de match");
  const matchSheet = matchSheetName ? workbook.Sheets[matchSheetName] : null;
  if (!matchSheet) return new Map();
  const matchRows = XLSX.utils.sheet_to_json(matchSheet, { header: 1, raw: false, defval: "", blankrows: false });
  const titleRowIndex = matchRows.findIndex((row) => row.some((value) => normalizeKey(value) === "tirs non cadres"));
  if (titleRowIndex < 0) return new Map();
  const headerRow = matchRows[titleRowIndex + 1] ?? [];
  const columns = {
    travelCode: headerRow.findIndex((value) => normalizeKey(value) === "voyage"),
    time: headerRow.findIndex((value) => normalizeKey(value) === "heure"),
    positions: headerRow.findIndex((value) => normalizeKey(value) === "nb poz"),
    timePerPosition: headerRow.findIndex((value) => normalizeKey(value) === "temps poz"),
    where: headerRow.findIndex((value) => normalizeKey(value) === "ou"),
  };
  const details = new Map();
  for (const row of matchRows.slice(titleRowIndex + 2)) {
    const travelCode = cleanText(row[columns.travelCode]);
    if (!travelCode) break;
    details.set(travelCode, {
      time: formatImportedClock(cleanText(row[columns.time])),
      positions: cleanText(row[columns.positions]),
      timePerPosition: formatImportedDuration(cleanText(row[columns.timePerPosition])),
      where: cleanText(row[columns.where]),
    });
  }
  return details;
}

function buildOperationalScore(passRate, loadingQuality, unloadingQuality, possessionPercent, configuredTargetSeconds, scoreTargetPercent) {
  const targetSeconds = normalizePositiveInteger(configuredTargetSeconds, DEFAULT_PERFORMANCE_CRITERIA.loadingSeconds);
  const scored = Number.isFinite(loadingQuality?.targeted) ? Math.round(loadingQuality.targeted) : null;
  const conceded = Number.isFinite(loadingQuality?.offTarget) ? Math.round(loadingQuality.offTarget) : null;
  const loadingPercent = loadingQuality?.targetedPercent;
  const unloadingPercent = unloadingQuality?.targetedPercent;
  const indicators = { passRate, loadingPercent, unloadingPercent, possessionPercent };
  const available = Object.values(indicators).every((value) => Number.isFinite(value));
  const reachedIndicators = available
    ? Object.values(indicators).filter((value) => value > scoreTargetPercent).length
    : null;
  return {
    status: available ? "available" : "unavailable",
    targetPercent: scoreTargetPercent,
    goalsFor: reachedIndicators,
    goalsAgainst: reachedIndicators === null ? null : Object.keys(indicators).length - reachedIndicators,
    indicators,
    loading: {
      status: scored !== null && conceded !== null && scored + conceded > 0 ? "available" : "unavailable",
      scored,
      conceded,
      targetSeconds,
    },
  };
}

function buildPossessionScore(rows) {
  const zonagePositions = new Set();
  const receptionPositions = new Set();
  for (const row of rows) {
    if (row.operationType === "ZONAGE") zonagePositions.add(row.position);
    if (row.operationType === "DECHG") receptionPositions.add(row.position);
  }
  const zonageCount = zonagePositions.size;
  const receptionCount = receptionPositions.size;
  const matchedCount = [...receptionPositions].filter((position) => zonagePositions.has(position)).length;
  return {
    percent: receptionCount > 0 ? percent(matchedCount, receptionCount) : null,
    zonagePositions: zonageCount,
    receptionPositions: receptionCount,
    matchedPositions: matchedCount,
  };
}

function buildCompositionPeriods(rows, period) {
  const duration = period.durationMinutes ?? (period.endMinutes >= period.startMinutes ? period.endMinutes - period.startMinutes : 1440 - period.startMinutes + period.endMinutes);
  const midpoint = duration / 2;
  const quarterPoints = [
    0,
    duration / 4,
    midpoint,
    (duration * 3) / 4,
    duration,
  ];
  const periodOffset = (minutes) => period.isOvernight && minutes < period.startMinutes
    ? minutes + 1440 - period.startMinutes
    : minutes - period.startMinutes;
  const displayTime = (offset) => formatCompositionTime(period.startMinutes + offset);
  const rowsBetween = (start, end, includeEnd = false) => rows.filter((row) => {
    const minutes = parisMinutes(row.startedAt);
    if (minutes === null) return false;
    const offset = periodOffset(minutes);
    return offset >= start && (includeEnd ? offset <= end : offset < end);
  });
  const firstRows = rowsBetween(0, midpoint);
  const secondRows = rowsBetween(midpoint, duration, true);
  const quarterIds = ["q1", "q2", "q3", "q4"];
  const quarters = quarterIds.map((id, index) => ({
    id,
    label: `${displayTime(quarterPoints[index])} - ${displayTime(quarterPoints[index + 1])}`,
    players: buildPlayers(rowsBetween(quarterPoints[index], quarterPoints[index + 1], index === quarterIds.length - 1), { periodScopedRole: true }),
  }));

  return {
    first: {
      label: `${period.start} - ${displayTime(midpoint)}`,
      players: buildPlayers(firstRows, { periodScopedRole: true }),
    },
    second: {
      label: `${displayTime(midpoint)} - ${period.end}`,
      players: buildPlayers(secondRows, { periodScopedRole: true }),
    },
    quarters,
  };
}

function formatCompositionTime(minutes) {
  const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
  const totalSeconds = Math.round(normalizedMinutes * 60);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const remaining = totalSeconds % 3600;
  const mins = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}${seconds ? `:${String(seconds).padStart(2, "0")}` : ""}`;
}

function buildPlayers(rows, options = {}) {
  const playerMap = new Map();
  for (const row of rows) {
    const player = ensurePlayer(playerMap, row.operator);
    player.operations += 1;
    player.byType[row.operationType] = (player.byType[row.operationType] ?? 0) + 1;
    player.byPost[row.post] = (player.byPost[row.post] ?? 0) + 1;
    player.positions.add(row.position);
    player.positionsByType[row.operationType]?.add(row.position);
    if (row.travelCode) player.travels.add(row.travelCode);
    player.firstOperation = minDate([player.firstOperation, row.startedAt]);
    player.lastOperation = maxDate([player.lastOperation, row.startedAt]);
  }

  const players = Array.from(playerMap.values()).map((player) => {
    const roleEntry = topEntry(player.byType);
    const role = options.periodScopedRole
      ? OPERATION_ROLE[roleEntry?.key] ?? topEntry(player.byPost)?.key ?? "Joueur"
      : topEntry(player.byPost)?.key ?? OPERATION_ROLE[roleEntry?.key] ?? "Joueur";
    const dominantCount = roleEntry?.value ?? 0;
    const dominantShare = percent(dominantCount, player.operations);
    const operationTypes = Object.values(player.byType).filter((count) => count > 0).length;

    return {
      name: player.name,
      role,
      operations: player.operations,
      positions: player.positions.size,
      positionsByType: {
        CHG: player.positionsByType.CHG.size,
        DECHG: player.positionsByType.DECHG.size,
        ZONAGE: player.positionsByType.ZONAGE.size,
      },
      travels: player.travels.size,
      byType: {
        CHG: player.byType.CHG ?? 0,
        DECHG: player.byType.DECHG ?? 0,
        ZONAGE: player.byType.ZONAGE ?? 0,
      },
      attackPercent: percent(player.byType.CHG ?? 0, player.operations),
      defensePercent: percent(player.byType.DECHG ?? 0, player.operations),
      midfieldPercent: percent(player.byType.ZONAGE ?? 0, player.operations),
      dominantShare,
      operationTypes,
      polyvalence: 0,
      score: 0,
      volumeIndex: 0,
      contributionPercent: 0,
      firstOperation: player.firstOperation?.toISOString() ?? null,
      lastOperation: player.lastOperation?.toISOString() ?? null,
      status: statusFromScore(dominantShare >= 90 ? 76 : Math.max(duelFriendlyScore(player.byType), 50)),
    };
  });

  const topOperations = Math.max(...players.map((player) => player.operations), 1);
  const topByType = {
    CHG: Math.max(...players.map((player) => player.byType.CHG), 1),
    ZONAGE: Math.max(...players.map((player) => player.byType.ZONAGE), 1),
    DECHG: Math.max(...players.map((player) => player.byType.DECHG), 1),
  };
  const totalOperations = players.reduce((sum, player) => sum + player.operations, 0);
  for (const player of players) {
    player.volumeIndex = Math.round((player.operations / topOperations) * 100);
    player.score = player.volumeIndex;
    player.contributionPercent = percent(player.operations, totalOperations);
    player.polyvalence = polyvalenceScore(player.byType, topByType);
  }

  return players.sort((a, b) => b.operations - a.operations || a.name.localeCompare(b.name));
}

function buildCategoryHighlights(categoryLeaders) {
  return {
    manOfTheMatch: null,
    bestScorer: playerCard(categoryLeaders.attack, "Joueur Attaque", "Meilleur(e) buteur(se)", categoryLeaders.attack?.byType.CHG, "opérations CHG"),
    bestPasser: playerCard(categoryLeaders.midfield, "Joueur Milieu", "Meilleur(e) passeur(se)", categoryLeaders.midfield?.byType.ZONAGE, "opérations ZONAGE"),
    defensiveWall: playerCard(categoryLeaders.defense, "Joueur Défense", "Meilleur(e) joueur(se)", categoryLeaders.defense?.byType.DECHG, "opérations RECEPTION"),
  };
}

function selectCategoryLeaders(players) {
  const attack = topCategoryPlayer(players, "CHG");
  const midfield = topCategoryPlayer(players, "ZONAGE");
  const defense = topCategoryPlayer(players, "DECHG");

  return { attack, midfield, defense };
}

function topCategoryPlayer(players, operationType) {
  const eligible = players.filter((player) => (player.byType[operationType] ?? 0) > 0);
  return [...eligible].sort((a, b) => {
    const positionDelta = (b.positionsByType?.[operationType] ?? 0) - (a.positionsByType?.[operationType] ?? 0);
    if (positionDelta !== 0) return positionDelta;
    const categoryDelta = (b.byType[operationType] ?? 0) - (a.byType[operationType] ?? 0);
    if (categoryDelta !== 0) return categoryDelta;
    const volumeDelta = b.operations - a.operations;
    if (volumeDelta !== 0) return volumeDelta;
    return a.name.localeCompare(b.name, "fr");
  })[0] ?? null;
}

function buildPositions(rows, period, scoringRows, criteria) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.position)) {
      map.set(row.position, {
        id: row.position,
        travelCode: row.travelCode,
        agencySegment: row.agencySegment,
        firstOperation: row.startedAt,
        lastOperation: row.startedAt,
        byTypeDates: {},
        zonageDates: [],
        duelRows: 0,
        duelWonRows: 0,
        operators: new Set(),
      });
    }
    const position = map.get(row.position);
    position.firstOperation = minDate([position.firstOperation, row.startedAt]);
    position.lastOperation = maxDate([position.lastOperation, row.startedAt]);
    position.operators.add(row.operator);
    const current = position.byTypeDates[row.operationType];
    position.byTypeDates[row.operationType] = current ? minDate([current, row.startedAt]) : row.startedAt;
    if (row.operationType === "ZONAGE") position.zonageDates.push(row.startedAt);
    if (!position.travelCode && row.travelCode) position.travelCode = row.travelCode;
  }

  for (const row of scoringRows ?? []) {
    const position = map.get(row.position);
    if (!position || (row.duelWonFlag !== 0 && row.duelWonFlag !== 1)) continue;
    position.duelRows += 1;
    if (row.duelWonFlag === 1) position.duelWonRows += 1;
  }

  return Array.from(map.values()).map((position) => {
    const start = position.byTypeDates.DECHG ?? position.firstOperation;
    // A position can contain a zonage before its reception and another one
    // after it. Only the first zonage after the reception starts the delay.
    const zonage = minDate(
      position.zonageDates.filter((date) => !start || date.getTime() >= start.getTime())
    );
    const delaySeconds = zonage ? Math.max(0, Math.round((zonage.getTime() - start.getTime()) / 1000)) : null;
    const delayMinutes = delaySeconds === null ? null : Math.round(delaySeconds / 60);
    const duelWon = position.duelRows > 0
      ? position.duelWonRows > 0
      : delaySeconds !== null && delaySeconds <= (criteria?.zonageMinutes ?? DEFAULT_PERFORMANCE_CRITERIA.zonageMinutes) * 60;
    return {
      id: position.id,
      travelCode: position.travelCode || "",
      agencySegment: position.agencySegment || "",
      operators: Array.from(position.operators),
      firstOperation: position.firstOperation.toISOString(),
      lastOperation: position.lastOperation.toISOString(),
      delayMinutes,
      duelWon,
      status: duelWon ? "MAÎTRISÉ" : "À SURVEILLER",
    };
  });
}

function ensurePlayer(map, name) {
  if (!map.has(name)) {
    map.set(name, {
      name,
      operations: 0,
      byType: {},
      byPost: {},
      positions: new Set(),
      positionsByType: {
        CHG: new Set(),
        DECHG: new Set(),
        ZONAGE: new Set(),
      },
      travels: new Set(),
      firstOperation: null,
      lastOperation: null,
    });
  }
  return map.get(name);
}

function buildAlerts({ validation, openDuelRows, duelTotal, weakRole }) {
  const alerts = [];
  if (openDuelRows.length > 0) {
    alerts.push({
      level: openDuelRows.length / Math.max(duelTotal, 1) > 0.3 ? "ACTION NÉCESSAIRE" : "À SURVEILLER",
      title: "Positions à sécuriser",
      detail: `${openDuelRows.length} position(s) hors délai cible dans le score Excel filtré.`,
    });
  }
  if (weakRole) {
    alerts.push({
      level: "À SURVEILLER",
      title: "Équilibre du terrain",
      detail: `${weakRole.role} représente ${Math.round(weakRole.percent)}% des joueurs retenus.`,
    });
  }
  if (validation.warnings.length > 0) {
    alerts.push({
      level: "À SURVEILLER",
      title: "Contrôle import",
      detail: validation.warnings[0],
    });
  }
  if (alerts.length === 0) {
    alerts.push({
      level: "MAÎTRISÉ",
      title: "Match lisible",
      detail: "Aucun blocage majeur détecté dans l'import.",
    });
  }
  return alerts.slice(0, 5);
}

function buildCauserie({ passRate, loadingPercent, unloadingPercent, possessionPercent, scoreTargetPercent, openDuelRows, weakRole, validation, zonageMinutes }) {
  const indicators = [passRate, loadingPercent, unloadingPercent, possessionPercent];
  const indicatorsAvailable = indicators.every((value) => Number.isFinite(value));
  const reachedIndicators = indicatorsAvailable ? indicators.filter((value) => value > scoreTargetPercent).length : 0;
  const priority = !indicatorsAvailable
    ? "Compléter les indicateurs avant de conclure le match."
    : reachedIndicators > indicators.length - reachedIndicators
      ? "Maintenir le rythme et sécuriser les fins de séquence."
      : "Reprendre les indicateurs sous l'objectif de la ligue.";
  const risk =
    openDuelRows.length > 0
      ? `${openDuelRows.length} position(s) à sécuriser dans le plan de jeu.`
      : "Risque principal maîtrisé sur le dernier import.";

  return [
    { label: "Priorité", value: priority },
    { label: "Risque principal", value: risk },
    { label: "Objectif", value: `Maintenir le zonage dans le délai cible de ${zonageMinutes} minutes.` },
    { label: "Arbitrage", value: weakRole ? `Surveiller l'équilibre ${weakRole.role.toLowerCase()}.` : "Aucun arbitrage critique." },
    {
      label: "Heure de revue",
      value: validation.warnings.length > 0 ? "Après correction de l'import." : "À la mi-temps opérationnelle.",
    },
  ];
}

function playerCard(player, label, detail, value, valueLabel) {
  if (!player) return null;
  return {
    label,
    detail,
    name: player.name,
    role: player.role,
    operations: player.operations,
    value: Number.isFinite(value) ? value : player.operations,
    valueLabel: valueLabel || "opérations",
    score: player.volumeIndex,
  };
}

function readRow(row, columnMap) {
  return Object.fromEntries(
    Object.keys(REQUIRED_COLUMNS).map((key) => [key, row[columnMap[key]]])
  );
}

function findDataSheet(sheetNames) {
  return sheetNames.find((name) => normalizeKey(name) === "donnees") ?? null;
}

function mapColumns(headerRow) {
  const normalizedHeaders = headerRow.map(normalizeKey);
  const map = {};
  for (const [key, aliases] of Object.entries(REQUIRED_COLUMNS)) {
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
    if (index !== -1) map[key] = index;
  }
  const hourOperationIndex = normalizedHeaders.findIndex((header) => header === "heure op");
  if (hourOperationIndex !== -1) map.hourOperation = hourOperationIndex;
  return map;
}

function isNewDataTemplate(headerRow) {
  const headers = new Set(headerRow.map(normalizeKey));
  return headers.has("quart temps");
}

function hasUsableCalculatedColumns(matrix, columnMap) {
  const sourceRows = matrix.filter((row) => [
    columnMap.operator,
    columnMap.startedAt,
    columnMap.operationType,
    columnMap.position,
    columnMap.travelCode,
    columnMap.agencySegment,
    columnMap.segmentType,
  ].some((index) => String(row[index] ?? "").trim() !== ""));
  if (sourceRows.length === 0) return false;

  const duelFlags = sourceRows
    .map((row) => parseDuelFlag(row[columnMap.duelWonFlag]))
    .filter((value) => value !== null);
  const dzValues = sourceRows
    .map((row) => row[columnMap.dz])
    .filter((value) => value instanceof Date ? !Number.isNaN(value.getTime()) : parseNumber(value) !== null);

  // A new template can still contain Quart temps while its copied formulas
  // are blank or stale. Use the derived path only in that case.
  return duelFlags.length >= sourceRows.length * 0.8 && dzValues.length > 0;
}

function buildFilterStats(rows, period, criteria, excludedTravelCodes = new Set()) {
  const periodRows = rows.filter((row) => period.useExcelPeriod ? isExcelBlank(row.hourFilter) : isInTimeRange(row.startedAt, period));
  const operatorRows = period.useDerivedRows ? rows : rows.filter((row) => isExcelBlank(row.operatorFilter));
  const unexcludedRows = rows.filter((row) => isMatchRow(row, period));
  const matchRows = unexcludedRows.filter((row) => !excludedTravelCodes.has(row.travelCode));
  const scoringRows = period.useDerivedRows
    ? buildDerivedScoringRows(matchRows, (criteria?.zonageMinutes ?? DEFAULT_PERFORMANCE_CRITERIA.zonageMinutes) * 60)
    : buildScoringRows(matchRows, period, (criteria?.zonageMinutes ?? DEFAULT_PERFORMANCE_CRITERIA.zonageMinutes) * 60);

  return {
    sourceRows: rows.length,
    periodRows: periodRows.length,
    operatorRows: operatorRows.length,
    matchRows: matchRows.length,
    scoringRows: scoringRows.length,
    excludedByPeriod: rows.length - periodRows.length,
    excludedByOperator: rows.length - operatorRows.length,
    excludedByTravel: unexcludedRows.length - matchRows.length,
    excludedFromScore: matchRows.length - scoringRows.length,
  };
}

function isMatchRow(row, period) {
  const periodMatches = period?.useExcelPeriod ? isExcelBlank(row.hourFilter) : isInTimeRange(row.startedAt, period);
  return (period?.useDerivedRows || isExcelBlank(row.operatorFilter)) && periodMatches;
}

function isScoringRow(row, period) {
  return isMatchRow(row, period) && (period?.useDerivedRows || isExcelBlank(row.unzonedFilter));
}

function buildScoringRows(rows, period, targetSeconds) {
  return rows
    .filter((row) => isScoringRow(row, period))
    .map((row) => ({
      ...row,
      duelWonFlag: Number.isFinite(row.dz)
        ? (row.dz <= targetSeconds ? 1 : 0)
        : row.duelWonFlag,
    }));
}

function buildDerivedScoringRows(rows, targetSeconds) {
  const byPosition = new Map();
  for (const row of rows) {
    if (!byPosition.has(row.position)) byPosition.set(row.position, []);
    byPosition.get(row.position).push(row);
  }

  return Array.from(byPosition.entries()).flatMap(([position, positionRows]) => {
    const start = positionRows
      .filter((row) => row.operationType === "DECHG")
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    if (!start) return [];
    const zonage = positionRows
      .filter((row) => row.operationType === "ZONAGE" && row.startedAt >= start.startedAt)
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    const delaySeconds = zonage
      ? Math.max(0, Math.round((zonage.startedAt.getTime() - start.startedAt.getTime()) / 1000))
      : null;
    return [{
      ...start,
      position,
      duelWonFlag: delaySeconds !== null && delaySeconds <= targetSeconds ? 1 : 0,
      unzonedFilter: "",
    }];
  });
}

function isInTimeRange(date, period) {
  if (period?.useExcelPeriod) return true;
  return isInActiveTimeRange(date, period);
}

function isInActiveTimeRange(date, period) {
  if (!date || !period) return false;
  const minutes = parisMinutes(date);
  if (minutes === null) return false;
  if (period.isOvernight || period.endMinutes < period.startMinutes) {
    return minutes >= period.startMinutes || minutes <= period.endMinutes;
  }
  return minutes >= period.startMinutes && minutes <= period.endMinutes;
}

function inferOvernightPeriod(rows) {
  const hourCounts = Array.from({ length: 24 }, () => 0);
  for (const row of rows) {
    const minutes = parisMinutes(row.startedAt);
    if (Number.isFinite(minutes)) hourCounts[Math.floor(minutes / 60)] += 1;
  }

  const totalRows = hourCounts.reduce((sum, count) => sum + count, 0);
  const overnightRows = hourCounts.slice(20).reduce((sum, count) => sum + count, 0)
    + hourCounts.slice(0, 9).reduce((sum, count) => sum + count, 0);
  if (totalRows === 0 || overnightRows / totalRows < 0.75) return null;

  const minimumHourCount = Math.max(3, Math.ceil(totalRows * 0.005));
  let bestRun = null;
  for (const startHour of [20, 21, 22, 23]) {
    if (hourCounts[startHour] < minimumHourCount) continue;
    const hours = [];
    for (let offset = 0; offset < 13; offset += 1) {
      const hour = (startHour + offset) % 24;
      if (hourCounts[hour] < minimumHourCount) break;
      hours.push(hour);
    }
    if (!bestRun || hours.length > bestRun.hours.length) bestRun = { hours, startHour };
  }
  if (!bestRun || bestRun.hours.length < 4) return null;

  const selectedHours = new Set(bestRun.hours);
  const startClockMinutes = bestRun.startHour * 60;
  const selectedOffsets = rows
    .map((row) => parisMinutes(row.startedAt))
    .filter((minutes) => Number.isFinite(minutes) && selectedHours.has(Math.floor(minutes / 60)))
    .map((minutes) => (minutes - startClockMinutes + 1440) % 1440);
  if (selectedOffsets.length === 0) return null;

  const startMinutes = startClockMinutes + Math.floor(Math.min(...selectedOffsets) / 30) * 30;
  const endMinutes = startClockMinutes + Math.ceil((Math.max(...selectedOffsets) + 1) / 30) * 30;
  const normalizedEnd = endMinutes % 1440;
  const start = formatTimeInput(startMinutes % 1440);
  const end = formatTimeInput(normalizedEnd);
  if (start === end) return null;

  return { start, end };
}

function isClockSecondsInPeriod(clockSeconds, period) {
  if (!Number.isFinite(clockSeconds) || !period) return false;
  const startSeconds = period.startMinutes * 60;
  const endSeconds = period.endMinutes * 60;
  if (period.isOvernight || period.endMinutes < period.startMinutes) {
    return clockSeconds >= startSeconds || clockSeconds <= endSeconds;
  }
  return clockSeconds >= startSeconds && clockSeconds <= endSeconds;
}

function parisMinutes(date) {
  if (!date) return null;
  if (Number.isFinite(date.__parisMinutes)) return date.__parisMinutes;
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const minutes = (hour === 24 ? 0 : hour) * 60 + minute;
  return minutes;
}

function annotateParisMinutes(date, minutes) {
  Object.defineProperty(date, "__parisMinutes", {
    configurable: false,
    enumerable: false,
    value: minutes,
  });
  return date;
}

function parseTimeInput(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2}):(00|30)$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23) return null;
  return hour * 60 + minute;
}

function formatTimeInput(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function isExcelBlank(value) {
  return value === "" || value === null || value === undefined;
}

function normalizeKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseExcelDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    const serialDate = new Date(epoch + value * 86400000);
    const parisMinutesValue = serialDate.getUTCHours() * 60 + serialDate.getUTCMinutes();
    const wallClock = Date.UTC(
      serialDate.getUTCFullYear(),
      serialDate.getUTCMonth(),
      serialDate.getUTCDate(),
      serialDate.getUTCHours(),
      serialDate.getUTCMinutes(),
      serialDate.getUTCSeconds(),
      serialDate.getUTCMilliseconds(),
    );
    return annotateParisMinutes(
      new Date(wallClock - timeZoneOffsetMilliseconds(wallClock, "Europe/Paris")),
      parisMinutesValue,
    );
  }
  const text = String(value).trim();
  // Do not let the runtime interpret a French date such as 11/09/2026 as
  // November 9. Treat the wall clock as Europe/Paris, like Excel serials.
  const frenchMatch = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (frenchMatch) {
    const [, day, month, year, rawHour = "0", rawMinute = "0", rawSecond = "0", meridiem] = frenchMatch;
    const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
    let hour = Number(rawHour);
    const minute = Number(rawMinute);
    const second = Number(rawSecond);
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = meridiem.toUpperCase() === "AM" ? (hour === 12 ? 0 : hour) : (hour === 12 ? 12 : hour + 12);
    }
    if (fullYear < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute > 59 || second > 59) return null;
    const wallClock = Date.UTC(fullYear, Number(month) - 1, Number(day), hour, minute, second);
    const wallClockDate = new Date(wallClock);
    if (
      wallClockDate.getUTCFullYear() !== fullYear ||
      wallClockDate.getUTCMonth() !== Number(month) - 1 ||
      wallClockDate.getUTCDate() !== Number(day) ||
      wallClockDate.getUTCHours() !== hour ||
      wallClockDate.getUTCMinutes() !== minute ||
      wallClockDate.getUTCSeconds() !== second
    ) return null;
    return annotateParisMinutes(
      new Date(wallClock - timeZoneOffsetMilliseconds(wallClock, "Europe/Paris")),
      hour * 60 + minute,
    );
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

function timeZoneOffsetMilliseconds(timestamp, timeZone) {
  // The Paris offset can change within a calendar day at DST boundaries.
  const dateKey = new Date(timestamp).toISOString().slice(0, 13);
  const cacheKey = `${timeZone}:${dateKey}`;
  if (parisOffsetCache.has(cacheKey)) return parisOffsetCache.get(cacheKey);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(timestamp));
  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = offset.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) {
    parisOffsetCache.set(cacheKey, 0);
    return 0;
  }
  const [, sign, hours, minutes = "0"] = match;
  const absolute = (Number(hours) * 60 + Number(minutes)) * 60 * 1000;
  const result = sign === "+" ? absolute : -absolute;
  parisOffsetCache.set(cacheKey, result);
  return result;
}

function cleanText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function formatImportedClock(value) {
  const text = cleanText(value);
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return text;
  let hour = Number(match[1]);
  const minute = match[2];
  const second = match[3] ?? "00";
  const meridiem = match[4].toUpperCase();
  if (meridiem === "AM") hour = hour === 12 ? 0 : hour;
  if (meridiem === "PM") hour = hour === 12 ? 12 : hour + 12;
  return `${String(hour).padStart(2, "0")}:${minute}:${second}`;
}

function parseClockSeconds(value) {
  const formatted = formatImportedClock(value);
  const match = formatted.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

function cleanRole(value) {
  const text = cleanText(value);
  return ROLE_LABELS.includes(text) ? text : "";
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return null;
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDurationSeconds(value, displayValue = "") {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 0 && !String(displayValue ?? "").trim()) return null;
    return Math.round(value * 86400);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Math.round((value.getTime() - Date.UTC(1899, 11, 30)) / 1000);
  }
  const parsedClock = parseClockSeconds(value);
  return parsedClock === null ? null : parsedClock;
}

function compareTimePerPositionDescending(left, right) {
  const leftSeconds = parseDurationSeconds(left.timePerPosition);
  const rightSeconds = parseDurationSeconds(right.timePerPosition);
  const leftHasTime = Number.isFinite(leftSeconds);
  const rightHasTime = Number.isFinite(rightSeconds);
  if (leftHasTime !== rightHasTime) return rightHasTime ? 1 : -1;
  if (leftHasTime && rightHasTime && rightSeconds !== leftSeconds) return rightSeconds - leftSeconds;
  return left.travelCode.localeCompare(right.travelCode, "fr");
}

function formatImportedDuration(value) {
  const seconds = parseClockSeconds(value);
  return seconds === null ? cleanText(value) : formatDuration(seconds);
}

function parseDuelFlag(value) {
  const parsed = parseNumber(value);
  if (parsed === 1) return 1;
  if (parsed === 0) return 0;
  return null;
}

function minDate(dates) {
  const valid = dates.filter(Boolean);
  if (valid.length === 0) return null;
  return new Date(Math.min(...valid.map((date) => date.getTime())));
}

function maxDate(dates) {
  const valid = dates.filter(Boolean);
  if (valid.length === 0) return null;
  return new Date(Math.max(...valid.map((date) => date.getTime())));
}

function countBy(items, getter) {
  return items.reduce((acc, item) => {
    const key = getter(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function topEntry(record) {
  return Object.entries(record)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value)[0];
}

function sortDesc(items, key) {
  return [...items].sort((a, b) => b[key] - a[key]);
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function duelFriendlyScore(byType) {
  const total = Object.values(byType).reduce((sum, value) => sum + value, 0);
  if (!total) return 0;
  const spread = Object.values(byType).filter(Boolean).length;
  return clamp(60 + spread * 10, 0, 100);
}

function polyvalenceScore(byType, topByType) {
  const activeTypes = Object.values(byType).filter((count) => count > 0).length;
  if (activeTypes < 2) return 0;

  const normalizedScores = [
    normalizedVolume(byType.CHG, topByType.CHG),
    normalizedVolume(byType.ZONAGE, topByType.ZONAGE),
    normalizedVolume(byType.DECHG, topByType.DECHG),
  ];
  return Math.round(clamp(normalizedScores.reduce((sum, score) => sum + score, 0) / 3, 0, 1) * 100);
}

function normalizedVolume(value, topValue) {
  const volume = Number(value) || 0;
  const top = Number(topValue) || 0;
  return top > 0 ? volume / top : 0;
}

function buildHourlyPassPerformance(workbook, period, sourceRows = null) {
  const arrivals = new Map();
  const hasArrivalSource = Array.isArray(sourceRows) && sourceRows.some((row) => row.startedAt instanceof Date);
  // Resolve the first operation before applying any time or chart-hour filter.
  for (const row of sourceRows ?? []) {
    if (!row.travelCode || !isExcelBlank(row.operatorFilter) || !isExcelBlank(row.unzonedFilter)) continue;
    const previous = arrivals.get(row.travelCode);
    if (!previous || row.startedAt < previous) arrivals.set(row.travelCode, row.startedAt);
  }
  const arrivingCodesByHour = new Map();
  const orderedArrivals = [...arrivals].sort(([leftCode, leftDate], [rightCode, rightDate]) =>
    leftDate - rightDate || leftCode.localeCompare(rightCode, "fr"));
  for (const [code, date] of orderedArrivals) {
    if (!isInActiveTimeRange(date, period)) continue;
    const hour = Math.floor(parisMinutes(date) / 60);
    const codes = arrivingCodesByHour.get(hour) ?? [];
    codes.push(code);
    arrivingCodesByHour.set(hour, codes);
  }
  const arrivalDetails = (hour) => {
    const arrivingTravelCodes = arrivingCodesByHour.get(hour) ?? [];
    return { arrivingTravels: hasArrivalSource ? arrivingTravelCodes.length : null, arrivingTravelCodes };
  };
  if (Array.isArray(sourceRows) && sourceRows.some((row) => Number.isFinite(row?.hourOperation))) {
    const chartHours = readHourlyChartHours(workbook);
    const byHour = new Map();
    for (const row of sourceRows) {
      if (!isExcelBlank(row.operatorFilter) || !isExcelBlank(row.unzonedFilter) || !Number.isFinite(row.hourOperation)) continue;
      const hour = Math.round(row.hourOperation);
      if (hour < 0 || hour > 23) continue;
      const hourMinutes = hour * 60;
      const inRange = period.isOvernight || period.endMinutes < period.startMinutes
        ? hourMinutes >= period.startMinutes || hourMinutes <= period.endMinutes
        : hourMinutes >= period.startMinutes && hourMinutes <= period.endMinutes;
      if (!inRange || (chartHours.size > 0 && !chartHours.has(hour))) continue;
      const current = byHour.get(hour) ?? { won: 0, total: 0 };
      current.total += 1;
      if (row.duelWonFlag === 1) current.won += 1;
      byHour.set(hour, current);
    }
    const values = Array.from(byHour.entries())
      .filter(([, value]) => value.total > 0)
      .map(([hour, value]) => ({
        label: `${String(hour).padStart(2, "0")}h`,
        hour,
        won: value.won,
        total: value.total,
        rate: percent(value.won, value.total),
        ...arrivalDetails(hour),
      }));
    values.sort((a, b) => {
      const toOffset = (hour) => {
        const minutes = hour * 60;
        return period.isOvernight && minutes < period.startMinutes ? minutes + 1440 - period.startMinutes : minutes - period.startMinutes;
      };
      return toOffset(a.hour) - toOffset(b.hour);
    });
    const weightedWon = values.reduce((sum, item) => sum + item.won, 0);
    const weightedTotal = values.reduce((sum, item) => sum + item.total, 0);
    return {
      items: values,
      totalRate: weightedTotal > 0 ? percent(weightedWon, weightedTotal) : null,
    };
  }

  const empty = { items: [], totalRate: null };
  const sheetName = workbook?.SheetNames?.find((name) => normalizeKey(name) === "x");
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) return empty;

  // Excel's chart1 source is X!FD:FG. The chart block can be reordered
  // independently from the hourly summary block, so match both blocks by
  // hour instead of assuming that equal row numbers mean equal hours.
  const chartHeader = Object.entries(sheet).find(([address, cell]) => !address.startsWith("!") && normalizeKey(cell?.v) === "somme de passes reussies");
  if (!chartHeader) return empty;
  const chartHeaderCell = XLSX.utils.decode_cell(chartHeader[0]);
  const headerRow = chartHeaderCell.r;
  const findHeaderColumn = (value) => {
    for (let col = 0; col < XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1").e.c + 1; col += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c: col })];
      if (normalizeKey(cell?.v) === value) return col;
    }
    return undefined;
  };
  const hourColumns = [];
  for (let col = 0; col <= XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1").e.c; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c: col })];
    if (normalizeKey(cell?.v) === "heure op") hourColumns.push(col);
  }
  const chartHourColumn = Math.max(...hourColumns.filter((col) => col < chartHeaderCell.c), -1);
  const summaryHourColumn = Math.max(...hourColumns.filter((col) => col < chartHourColumn), -1);
  const summaryRateColumn = findHeaderColumn("passes reussies");
  if (chartHourColumn < 0 || summaryHourColumn < 0 || summaryRateColumn === undefined) return empty;

  const lastRow = sheetEndRow(sheet, headerRow + 1);
  const summaryByHour = new Map();
  for (let row = headerRow + 1; row <= lastRow; row += 1) {
    const hour = parseNumber(sheet[XLSX.utils.encode_cell({ r: row, c: summaryHourColumn })]?.v);
    if (!Number.isFinite(hour)) continue;
    // The summary block is EW/EX/EY/EZ: EY is a control marker between the
    // two counters and the percentage column.
    const lost = parseNumber(sheet[XLSX.utils.encode_cell({ r: row, c: summaryRateColumn - 3 })]?.v);
    const won = parseNumber(sheet[XLSX.utils.encode_cell({ r: row, c: summaryRateColumn - 2 })]?.v);
    const total = Number.isFinite(lost) && Number.isFinite(won) ? lost + won : null;
    const summaryRate = parseNumber(sheet[XLSX.utils.encode_cell({ r: row, c: summaryRateColumn })]?.v);
    summaryByHour.set(hour, {
      won: Number.isFinite(won) ? won : null,
      total: Number.isFinite(total) && total > 0 ? total : null,
      rate: Number.isFinite(summaryRate) && summaryRate >= 0 && summaryRate <= 1 ? summaryRate : null,
    });
  }

  const values = [];
  for (let row = headerRow + 1; row <= lastRow; row += 1) {
    const hour = parseNumber(sheet[XLSX.utils.encode_cell({ r: row, c: chartHourColumn })]?.v);
    const chartRateFraction = parseNumber(sheet[XLSX.utils.encode_cell({ r: row, c: chartHeaderCell.c })]?.v);
    const summary = summaryByHour.get(hour);
    const rateFraction = Number.isFinite(chartRateFraction) && chartRateFraction >= 0 && chartRateFraction <= 1
      ? chartRateFraction
      : summary?.rate;
    if (!Number.isFinite(hour) || !Number.isFinite(rateFraction)) continue;
    const hourMinutes = hour * 60;
    const inRange = period.isOvernight || period.endMinutes < period.startMinutes
      ? hourMinutes >= period.startMinutes || hourMinutes <= period.endMinutes
      : hourMinutes >= period.startMinutes && hourMinutes <= period.endMinutes;
    if (!inRange) continue;
    values.push({
      label: `${String(hour).padStart(2, "0")}h`,
      hour,
      won: summary?.won ?? null,
      total: summary?.total ?? null,
      rate: Math.round(rateFraction * 1000) / 10,
      ...arrivalDetails(hour),
    });
  }
  values.sort((a, b) => {
    const toOffset = (hour) => {
      const minutes = hour * 60;
      return period.isOvernight && minutes < period.startMinutes ? minutes + 1440 - period.startMinutes : minutes - period.startMinutes;
    };
    return toOffset(a.hour) - toOffset(b.hour);
  });
  const weightedWon = values.reduce((sum, item) => sum + (Number.isFinite(item.won) ? item.won : 0), 0);
  const weightedTotal = values.reduce((sum, item) => sum + (Number.isFinite(item.total) ? item.total : 0), 0);
  return {
    items: values,
    totalRate: weightedTotal > 0 ? percent(weightedWon, weightedTotal) : null,
  };
}

function readHourlyChartHours(workbook) {
  const sheetName = workbook?.SheetNames?.find((name) => normalizeKey(name) === "x");
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) return new Set();
  const chartHeader = Object.entries(sheet).find(([address, cell]) => !address.startsWith("!") && normalizeKey(cell?.v) === "somme de passes reussies");
  if (!chartHeader) return new Set();
  const chartHeaderCell = XLSX.utils.decode_cell(chartHeader[0]);
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  let chartHourColumn = -1;
  for (let col = chartHeaderCell.c - 1; col >= 0; col -= 1) {
    if (normalizeKey(sheet[XLSX.utils.encode_cell({ r: chartHeaderCell.r, c: col })]?.v) === "heure op") {
      chartHourColumn = col;
      break;
    }
  }
  if (chartHourColumn < 0) return new Set();
  const hours = new Set();
  for (let row = chartHeaderCell.r + 1; row <= range.e.r; row += 1) {
    const hour = parseNumber(sheet[XLSX.utils.encode_cell({ r: row, c: chartHourColumn })]?.v);
    const rate = parseNumber(sheet[XLSX.utils.encode_cell({ r: row, c: chartHeaderCell.c })]?.v);
    if (Number.isFinite(hour) && Number.isFinite(rate)) hours.add(Math.round(hour));
  }
  return hours;
}

function statusFromScore(score) {
  if (score >= 85) return "MAÎTRISÉ";
  if (score >= 70) return "À SURVEILLER";
  return "ACTION NÉCESSAIRE";
}

function statusFromOperationalScore(operationalScore) {
  if (!operationalScore || operationalScore.status !== "available") return "À COMPLÉTER";
  if ((operationalScore.goalsFor ?? 0) > (operationalScore.goalsAgainst ?? 0)) return "MAÎTRISÉ";
  if (operationalScore.goalsFor === operationalScore.goalsAgainst) return "À SURVEILLER";
  return "ACTION NÉCESSAIRE";
}

function userError(title, message) {
  return {
    title,
    message,
    action: "Vérifie ton extraction et réessaie.",
  };
}
