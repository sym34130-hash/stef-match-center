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
export const KPI_DICTIONARY_VERSION = 10;

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

export function normalizeTimeRange(start = DEFAULT_PERIOD_START, end = DEFAULT_PERIOD_END) {
  const startMinutes = parseTimeInput(start);
  const endMinutes = parseTimeInput(end);
  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    throw new Error("La plage horaire doit être comprise entre deux heures valides, par pas de 30 minutes.");
  }
  return {
    start: formatTimeInput(startMinutes),
    end: formatTimeInput(endMinutes),
    startMinutes,
    endMinutes,
    label: `${formatTimeInput(startMinutes)}-${formatTimeInput(endMinutes)}`,
  };
}

export function primeWorkbookCache(buffer) {
  if (buffer) parseWorkbookSource(buffer);
}

export const KPI_DICTIONARY = [
  {
    id: "match.operations",
    label: "Opérations",
    source: "Données",
    formula: "COUNTROWS(Données) avec Filtre opérateur vide et Filtre heure vide",
    denominator: "Lignes Excel retenues dans le match",
    display: "Volume filtré du match",
  },
  {
    id: "match.positions",
    label: "Positions",
    source: "Données",
    formula: "DISTINCTCOUNT(N° Position) avec Filtre opérateur vide et Filtre heure vide",
    denominator: "Positions distinctes du match filtré",
    display: "Positions retenues dans le match",
  },
  {
    id: "match.players",
    label: "Joueurs",
    source: "Données",
    formula: "DISTINCTCOUNT(Opérateur) avec Filtre opérateur vide et Filtre heure vide",
    denominator: "Opérateurs retenus par l'Excel",
    display: "Joueurs actifs",
  },
  {
    id: "score.duels",
    label: "Duels gagnés",
    source: "Données!S",
    formula: "SUM(Duels gagnés, recalculés avec DZ <= cible zonage active lorsque DZ est renseigné) / COUNT(Duels gagnés) avec Filtre opérateur vide, Filtre heure vide et Poz non zonées vide",
    denominator: "Lignes éligibles au score Excel",
    display: "Score collectif",
  },
  {
    id: "score.operational",
    label: "Score opérationnel",
    source: "Données!Duels + CHG + DECHG + ZONAGE",
    formula: "Nombre des 4 indicateurs dont le pourcentage atteint l'objectif de la ligue - indicateurs atteints / indicateurs sous objectif",
    denominator: "4 indicateurs disponibles : duels gagnés, chargements cadrés, déchargements dans la cible et possession Zody",
    display: "Score au format football",
  },
  {
    id: "score.loading",
    label: "Chargements cadrés",
    source: "Données!CHG",
    formula: "COUNT des voyages éligibles dont le temps moyen par position est <= au seuil de chargement actif",
    denominator: "Voyages CHG avec au moins 15 positions et une durée positive dans la plage active",
    display: "Part des chargements dans le délai cible",
  },
  {
    id: "score.possession",
    label: "Possession Zody",
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
    source: "Données!O",
    formula: "DISTINCTCOUNT(Opérateur) par Poste avec Filtre opérateur vide et Filtre heure vide",
    denominator: "Joueurs actifs du match filtré",
    display: "Équilibre de la composition",
  },
];

export function buildSnapshotFromWorkbook(buffer, sourceName, expectedAgencyCode, periodInput = {}) {
  const compositionOnly = periodInput.compositionOnly === true;
  const criteria = normalizePerformanceCriteria(periodInput.criteria);
  const period = normalizeTimeRange(periodInput.start ?? DEFAULT_PERIOD_START, periodInput.end ?? DEFAULT_PERIOD_END);
  const parsed = parseWorkbookSource(buffer);
  if (!parsed.ok) return parsed;

  const { workbook, matrix, columnMap, isDerivedTemplate, rows, sourceValidation, missingColumns, rawWorkbook, rawMatrix } = parsed;
  const isDefaultPeriod = period.startMinutes === parseTimeInput(DEFAULT_PERIOD_START)
    && period.endMinutes === parseTimeInput(DEFAULT_PERIOD_END);
  period.useExcelPeriod = !isDerivedTemplate && isDefaultPeriod;
  period.useDerivedRows = isDerivedTemplate;
  const buildCacheKey = [
    parsed.cacheKey,
    expectedAgencyCode ?? "",
    period.label,
    period.useExcelPeriod ? "excel-period" : "clock-period",
    `criteria-${criteria.zonageMinutes}-${criteria.loadingSeconds}-${criteria.unloadingSeconds}-${criteria.scoreTargetPercent}`,
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

  const filterStats = buildFilterStats(rows, period, criteria);
  validation.filterStats = filterStats;
  validation.kpiRules = {
    matchFilter: `Filtre opérateur + plage ${period.label} (fin incluse)`,
    scoringFilter: `Filtre opérateur + plage ${period.label} (fin incluse) + exclusion Poz non zonées`,
    zonageTarget: `${criteria.zonageMinutes} minutes`,
    loadingTarget: formatDuration(criteria.loadingSeconds),
    unloadingTarget: formatDuration(criteria.unloadingSeconds),
    scoreTarget: `${criteria.scoreTargetPercent}% par indicateur`,
    period: period.label,
  };
  if (filterStats.matchRows === 0) {
    validation.warnings.push(`Aucune ligne ne passe le filtre opérateur + plage ${period.label}.`);
  }
  if (filterStats.scoringRows === 0) {
    validation.warnings.push("Aucune ligne éligible au score après exclusion des positions non zonées.");
  }

  const matchRows = rows.filter((row) => isMatchRow(row, period));
  const scoringRows = isDerivedTemplate
    ? buildDerivedScoringRows(matchRows, criteria.zonageMinutes * 60)
    : buildScoringRows(matchRows, period, criteria.zonageMinutes * 60);
  if (compositionOnly) {
    const compositionResult = {
      ok: true,
      period,
      players: buildPlayers(matchRows),
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
    loadingQuality: buildLoadingQuality(rawWorkbook, matchRows, period, criteria.loadingSeconds),
    unloadingQuality: buildUnloadingQuality(matchRows, criteria.unloadingSeconds),
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
  const categoryLeaders = selectDistinctCategoryLeaders(snapshot.players);
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

function buildMatchSnapshot({ sourceRows, matchRows, scoringRows, sourceName, expectedAgencyCode, detectedAgency, validation, filterStats, period, criteria, loadingQuality, unloadingQuality }) {
  const importedAt = new Date();
  const firstOperation = minDate(matchRows.map((row) => row.startedAt));
  const lastOperation = maxDate(matchRows.map((row) => row.startedAt));
  const operationCounts = countBy(matchRows, (row) => row.operationType);
  const positions = buildPositions(matchRows, period, scoringRows, criteria);
  const players = buildPlayers(matchRows);
  const topPlayers = sortDesc(players, "operations");
  const categoryLeaders = selectDistinctCategoryLeaders(players);
  const duelWon = scoringRows.filter((row) => row.duelWonFlag === 1).length;
  const duelTotal = scoringRows.filter((row) => row.duelWonFlag === 0 || row.duelWonFlag === 1).length;
  const duelRate = duelTotal > 0 ? percent(duelWon, duelTotal) : null;
  const possession = buildPossessionScore(matchRows);
  const score = duelRate === null ? null : Math.round(duelRate);
  const operationalScore = buildOperationalScore(
    loadingQuality,
    unloadingQuality,
    duelRate,
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
      excludedFromScore: filterStats.excludedFromScore,
    },
    hourlyPerformance: buildHourlyPerformance(scoringRows, period),
    loadingQuality,
    unloadingQuality,
    operationalScore,
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
      duelRate,
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

function buildLoadingQuality(workbook, matchRows, period, configuredTargetSeconds) {
  const targetSeconds = normalizePositiveInteger(configuredTargetSeconds, DEFAULT_PERFORMANCE_CRITERIA.loadingSeconds);
  const empty = {
    targeted: 0,
    offTarget: 0,
    targetedPercent: null,
    offTargetPercent: null,
    targetTimePerPosition: formatDuration(targetSeconds),
    averageTimePerPositionSeconds: null,
    nonTargetedShots: [],
  };
  if (!workbook || !Array.isArray(matchRows)) return empty;
  const loadingDetailsByTravel = readLoadingDetails(workbook);
  const groups = new Map();
  for (const row of matchRows) {
    if (row.operationType !== "CHG" || !row.travelCode) continue;
    if (!groups.has(row.travelCode)) groups.set(row.travelCode, []);
    groups.get(row.travelCode).push(row);
  }

  const loadingRows = Array.from(groups.entries()).map(([travelCode, rows]) => {
    const firstOperation = minDate(rows.map((row) => row.startedAt));
    const lastOperation = maxDate(rows.map((row) => row.startedAt));
    const elapsedSeconds = firstOperation && lastOperation
      ? Math.max(0, Math.round((lastOperation.getTime() - firstOperation.getTime()) / 1000))
      : 0;
    const timePerPositionSeconds = rows.length > 0 ? elapsedSeconds / rows.length : 0;
    return {
      travelCode,
      rows,
      firstOperation,
      positions: rows.length,
      elapsedSeconds,
      timePerPositionSeconds,
      eligible: rows.length >= 15 && elapsedSeconds > 0,
    };
  }).filter((row) => row.eligible);

  const targeted = loadingRows.filter((row) => row.timePerPositionSeconds <= targetSeconds).length;
  const total = loadingRows.length;
  const offTarget = Math.max(0, total - targeted);
  const averageTimePerPositionSeconds = total > 0
    ? Math.round(loadingRows.reduce((sum, row) => sum + row.timePerPositionSeconds, 0) / total)
    : null;
  const nonTargetedShots = loadingRows
    .filter((row) => row.timePerPositionSeconds > targetSeconds)
    .sort((left, right) => right.timePerPositionSeconds - left.timePerPositionSeconds || left.travelCode.localeCompare(right.travelCode, "fr"))
    .slice(0, 14)
    .map((row) => ({
      travelCode: row.travelCode,
      time: loadingDetailsByTravel.get(row.travelCode)?.time ?? formatDateClock(row.firstOperation),
      positions: loadingDetailsByTravel.get(row.travelCode)?.positions ?? String(row.positions),
      timePerPosition: loadingDetailsByTravel.get(row.travelCode)?.timePerPosition ?? formatDuration(row.timePerPositionSeconds),
      where: loadingDetailsByTravel.get(row.travelCode)?.where ?? "",
    }));
  return {
    targeted,
    offTarget,
    targetedPercent: total > 0 ? percent(targeted, total) : null,
    offTargetPercent: total > 0 ? percent(offTarget, total) : null,
    targetTimePerPosition: formatDuration(targetSeconds),
    averageTimePerPositionSeconds,
    nonTargetedShots,
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

function buildOperationalScore(loadingQuality, unloadingQuality, duelRate, possessionPercent, configuredTargetSeconds, scoreTargetPercent) {
  const targetSeconds = normalizePositiveInteger(configuredTargetSeconds, DEFAULT_PERFORMANCE_CRITERIA.loadingSeconds);
  const scored = Number.isFinite(loadingQuality?.targeted) ? Math.round(loadingQuality.targeted) : null;
  const conceded = Number.isFinite(loadingQuality?.offTarget) ? Math.round(loadingQuality.offTarget) : null;
  const loadingPercent = loadingQuality?.targetedPercent;
  const unloadingPercent = unloadingQuality?.targetedPercent;
  const indicators = { duelRate, loadingPercent, unloadingPercent, possessionPercent };
  const available = Object.values(indicators).every((value) => Number.isFinite(value));
  const reachedIndicators = available
    ? Object.values(indicators).filter((value) => value >= scoreTargetPercent).length
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
  const duration = period.endMinutes - period.startMinutes;
  const midpoint = period.startMinutes + duration / 2;
  const quarterPoints = [
    period.startMinutes,
    period.startMinutes + duration / 4,
    midpoint,
    period.startMinutes + (duration * 3) / 4,
    period.endMinutes,
  ];
  const rowsBetween = (start, end, includeEnd = false) => rows.filter((row) => {
    const minutes = parisMinutes(row.startedAt);
    if (minutes === null) return false;
    return minutes >= start && (includeEnd ? minutes <= end : minutes < end);
  });
  const firstRows = rowsBetween(period.startMinutes, midpoint);
  const secondRows = rowsBetween(midpoint, period.endMinutes, true);
  const quarterIds = ["q1", "q2", "q3", "q4"];
  const quarters = quarterIds.map((id, index) => ({
    id,
    label: `${formatCompositionTime(quarterPoints[index])} - ${formatCompositionTime(quarterPoints[index + 1])}`,
    players: buildPlayers(rowsBetween(quarterPoints[index], quarterPoints[index + 1], index === quarterIds.length - 1)),
  }));

  return {
    first: {
      label: `${period.start} - ${formatCompositionTime(midpoint)}`,
      players: buildPlayers(firstRows),
    },
    second: {
      label: `${formatCompositionTime(midpoint)} - ${period.end}`,
      players: buildPlayers(secondRows),
    },
    quarters,
  };
}

function formatCompositionTime(minutes) {
  const totalSeconds = Math.round(minutes * 60);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const remaining = totalSeconds % 3600;
  const mins = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}${seconds ? `:${String(seconds).padStart(2, "0")}` : ""}`;
}

function buildPlayers(rows) {
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
    const role = topEntry(player.byPost)?.key ?? OPERATION_ROLE[roleEntry?.key] ?? "Joueur";
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
    bestScorer: playerCard(categoryLeaders.attack, "Joueur Attaque", "Meilleure valeur CHG", categoryLeaders.attack?.byType.CHG, "opérations CHG"),
    bestPasser: playerCard(categoryLeaders.midfield, "Joueur Milieu", "Meilleure valeur ZONAGE", categoryLeaders.midfield?.byType.ZONAGE, "opérations ZONAGE"),
    defensiveWall: playerCard(categoryLeaders.defense, "Joueur Défense", "Meilleure valeur Réception", categoryLeaders.defense?.byType.DECHG, "opérations RECEPTION"),
  };
}

function selectDistinctCategoryLeaders(players) {
  const selectedNames = new Set();
  const attack = topCategoryPlayer(players, "CHG", selectedNames);
  if (attack) selectedNames.add(attack.name);
  const midfield = topCategoryPlayer(players, "ZONAGE", selectedNames);
  if (midfield) selectedNames.add(midfield.name);
  const defense = topCategoryPlayer(players, "DECHG", selectedNames);

  return { attack, midfield, defense };
}

function topCategoryPlayer(players, operationType, excludedNames) {
  const eligible = players.filter((player) => (player.byType[operationType] ?? 0) > 0);
  const available = eligible.filter((player) => !excludedNames.has(player.name));
  const pool = available.length > 0 ? available : eligible;
  if (pool.length === 0 || (available.length === 0 && excludedNames.size > 0)) return null;
  return [...pool].sort((a, b) => {
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
    const zonage = position.byTypeDates.ZONAGE ?? null;
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
      title: "Duels à reprendre",
      detail: `${openDuelRows.length} duel(s) hors délai cible dans le score Excel filtré.`,
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

function buildCauserie({ duelRate, loadingPercent, unloadingPercent, possessionPercent, scoreTargetPercent, openDuelRows, weakRole, validation, zonageMinutes }) {
  const indicators = [duelRate, loadingPercent, unloadingPercent, possessionPercent];
  const indicatorsAvailable = indicators.every((value) => Number.isFinite(value));
  const reachedIndicators = indicatorsAvailable ? indicators.filter((value) => value >= scoreTargetPercent).length : 0;
  const priority = !indicatorsAvailable
    ? "Compléter les indicateurs avant de conclure le match."
    : reachedIndicators > indicators.length - reachedIndicators
      ? "Maintenir le rythme et sécuriser les fins de séquence."
      : "Reprendre les indicateurs sous l'objectif de la ligue.";
  const risk =
    openDuelRows.length > 0
      ? `${openDuelRows.length} duel(s) à reprendre dans le plan de jeu.`
      : "Risque principal maîtrisé sur le dernier import.";

  return [
    { label: "Priorité", value: priority },
    { label: "Risque principal", value: risk },
    { label: "Objectif", value: `Tenir le délai cible de ${zonageMinutes} minutes sur les duels.` },
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

function buildFilterStats(rows, period, criteria) {
  const periodRows = rows.filter((row) => period.useExcelPeriod ? isExcelBlank(row.hourFilter) : isInTimeRange(row.startedAt, period));
  const operatorRows = period.useDerivedRows ? rows : rows.filter((row) => isExcelBlank(row.operatorFilter));
  const matchRows = rows.filter((row) => isMatchRow(row, period));
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
  return minutes >= period.startMinutes && minutes <= period.endMinutes;
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
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const frenchMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (frenchMatch) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = frenchMatch;
    const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
    const date = new Date(fullYear, Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function timeZoneOffsetMilliseconds(timestamp, timeZone) {
  const dateKey = new Date(timestamp).toISOString().slice(0, 10);
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
    (byType.CHG ?? 0) / topByType.CHG,
    (byType.ZONAGE ?? 0) / topByType.ZONAGE,
    (byType.DECHG ?? 0) / topByType.DECHG,
  ];
  return Math.round(clamp(normalizedScores.reduce((sum, score) => sum + score, 0) / 3, 0, 1) * 100);
}

function buildHourlyPerformance(rows, period) {
  const buckets = new Map();
  for (const row of rows) {
    if (!isInActiveTimeRange(row.startedAt, period)) continue;
    const hour = parisHour(row.startedAt);
    if (hour === null) continue;
    if (!buckets.has(hour)) buckets.set(hour, { hour, won: 0, total: 0 });
    const bucket = buckets.get(hour);
    if (row.duelWonFlag === 0 || row.duelWonFlag === 1) {
      bucket.total += 1;
      if (row.duelWonFlag === 1) bucket.won += 1;
    }
  }
  return Array.from(buckets.values())
    .sort((a, b) => a.hour - b.hour)
    .map((bucket) => ({ ...bucket, label: `${String(bucket.hour).padStart(2, "0")}h`, rate: percent(bucket.won, bucket.total) }));
}

function parisHour(date) {
  if (!date) return null;
  if (Number.isFinite(date.__parisMinutes)) return Math.floor(date.__parisMinutes / 60);
  const value = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  const hour = Number(value);
  return Number.isFinite(hour) ? (hour === 24 ? 0 : hour) : null;
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

function formatRange(start, end) {
  if (!start || !end) return "Plage non disponible";
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function formatTime(date) {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
}

function userError(title, message) {
  return {
    title,
    message,
    action: "Vérifie ton extraction et réessaie.",
  };
}
