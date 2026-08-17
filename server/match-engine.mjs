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
const DZ_TARGET_MINUTES = 30;
const MATCH_PERIOD_LABEL = "13:00-22:00";
const MATCH_FILTER_DESCRIPTION = "Filtre opérateur Excel + période 13:00-22:00";
const SCORING_FILTER_DESCRIPTION = "Filtre opérateur + période 13:00-22:00 + exclusion Poz non zonées";

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
    formula: "SUM(Duels gagnés) / COUNT(Duels gagnés) avec Filtre opérateur vide, Filtre heure vide et Poz non zonées vide",
    denominator: "Lignes éligibles au score Excel",
    display: "Score collectif",
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

export function buildSnapshotFromWorkbook(buffer, sourceName, expectedAgencyCode) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellFormula: false,
    cellNF: false,
    cellStyles: false,
  });

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

  if (missingColumns.length > 0) {
    return {
      ok: false,
      error: userError(
        "FICHIER NON IMPORTÉ",
        `Colonne obligatoire absente : ${missingColumns.join(", ")}.`
      ),
    };
  }

  const validation = {
    rowCount: 0,
    criticalMissingRows: 0,
    invalidDateRows: 0,
    unknownOperationRows: 0,
    duplicateRows: 0,
    warnings: [],
  };

  const rows = [];
  const duplicateKeys = new Set();
  const duplicatedKeys = new Set();

  for (let index = 1; index < matrix.length; index += 1) {
    const row = matrix[index];
    const raw = readRow(row, columnMap);
    const hasContent = Object.values(raw).some((value) => String(value ?? "").trim() !== "");
    if (!hasContent) continue;

    validation.rowCount += 1;

    const operator = cleanText(raw.operator);
    const operationType = cleanText(raw.operationType).toUpperCase();
    const position = cleanText(raw.position);
    const travelCode = cleanText(raw.travelCode);
    const agencySegment = cleanText(raw.agencySegment);
    const segmentType = cleanText(raw.segmentType);
    const operatorFilter = cleanText(raw.operatorFilter);
    const hourFilter = cleanText(raw.hourFilter);
    const post = cleanRole(raw.post) || OPERATION_ROLE[operationType] || "Joueur";
    const unzonedFilter = cleanText(raw.unzonedFilter);
    const dz = parseNumber(raw.dz);
    const duelWonFlag = parseDuelFlag(raw.duelWonFlag);
    const startedAt = parseExcelDate(raw.startedAt);

    if (!operator || !operationType || !position || !raw.startedAt) {
      validation.criticalMissingRows += 1;
    }

    if (!startedAt) {
      validation.invalidDateRows += 1;
    }

    if (operationType && !OPERATION_ROLE[operationType]) {
      validation.unknownOperationRows += 1;
    }

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

  validation.duplicateRows = duplicatedKeys.size;

  if (validation.rowCount === 0 || rows.length === 0) {
    return {
      ok: false,
      error: userError("FICHIER NON IMPORTÉ", "Aucune opération exploitable n'a été trouvée."),
    };
  }

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

  const filterStats = buildFilterStats(rows);
  validation.filterStats = filterStats;
  validation.kpiRules = {
    matchFilter: MATCH_FILTER_DESCRIPTION,
    scoringFilter: SCORING_FILTER_DESCRIPTION,
    period: MATCH_PERIOD_LABEL,
  };
  if (filterStats.matchRows === 0) {
    validation.warnings.push("Aucune ligne ne passe le filtre opérateur + période Excel.");
  }
  if (filterStats.scoringRows === 0) {
    validation.warnings.push("Aucune ligne éligible au score après exclusion des positions non zonées.");
  }

  const matchRows = rows.filter(isMatchRow);
  const scoringRows = matchRows.filter(isScoringRow);
  const agencyCounts = countBy(matchRows.length > 0 ? matchRows : rows, (row) => row.agencySegment || "Non renseignée");
  const detectedAgency = topEntry(agencyCounts)?.key ?? expectedAgencyCode;
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
  });

  return { ok: true, snapshot };
}

function buildMatchSnapshot({ sourceRows, matchRows, scoringRows, sourceName, expectedAgencyCode, detectedAgency, validation, filterStats }) {
  const importedAt = new Date();
  const firstOperation = minDate(matchRows.map((row) => row.startedAt));
  const lastOperation = maxDate(matchRows.map((row) => row.startedAt));
  const operationCounts = countBy(matchRows, (row) => row.operationType);
  const positions = buildPositions(matchRows);
  const players = buildPlayers(matchRows);
  const topPlayers = sortDesc(players, "operations");
  const scorer = topBy(players, (player) => player.byType.CHG ?? 0);
  const passer = topBy(players, (player) => player.byType.ZONAGE ?? 0);
  const defender = topBy(players, (player) => player.byType.DECHG ?? 0);
  const duelWon = scoringRows.filter((row) => row.duelWonFlag === 1).length;
  const duelTotal = scoringRows.filter((row) => row.duelWonFlag === 0 || row.duelWonFlag === 1).length;
  const duelRate = percent(duelWon, duelTotal);
  const score = Math.round(duelRate);
  const status = statusFromScore(score);
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
      timeRangeLabel: formatRange(firstOperation, lastOperation),
      score,
      status,
      objective: "Tenir le délai cible de zonage à 30 minutes.",
      dzTargetMinutes: DZ_TARGET_MINUTES,
      periodLabel: MATCH_PERIOD_LABEL,
      filterDescription: MATCH_FILTER_DESCRIPTION,
      scoringFilterDescription: SCORING_FILTER_DESCRIPTION,
    },
    summary: {
      operations: totalOperations,
      positions: positions.length,
      players: players.length,
      travels: new Set(matchRows.map((row) => row.travelCode).filter(Boolean)).size,
      duelWon,
      duelTotal,
      duelRate,
      operationCounts,
      roleDistribution,
      sourceRows: sourceRows.length,
      scoringRows: scoringRows.length,
      excludedByPeriod: filterStats.excludedByPeriod,
      excludedByOperator: filterStats.excludedByOperator,
      excludedFromScore: filterStats.excludedFromScore,
    },
    highlights: {
      manOfTheMatch: playerCard(topPlayers[0], "Homme du match", "Plus gros volume d'opérations", topPlayers[0]?.operations, "opérations"),
      bestScorer: playerCard(scorer, "Meilleur buteur", "Plus gros volume CHG", scorer?.byType.CHG, "opérations CHG"),
      bestPasser: playerCard(passer, "Meilleur passeur", "Plus gros volume ZONAGE", passer?.byType.ZONAGE, "opérations ZONAGE"),
      defensiveWall: playerCard(defender, "Mur défensif", "Plus gros volume DECHG", defender?.byType.DECHG, "opérations DECHG"),
    },
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
    causerie: buildCauserie({ score, openDuelRows, weakRole, validation }),
    validation,
    kpiDictionaryVersion: 1,
  };
}

function buildPlayers(rows) {
  const playerMap = new Map();
  for (const row of rows) {
    const player = ensurePlayer(playerMap, row.operator);
    player.operations += 1;
    player.byType[row.operationType] = (player.byType[row.operationType] ?? 0) + 1;
    player.byPost[row.post] = (player.byPost[row.post] ?? 0) + 1;
    player.positions.add(row.position);
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
    const rawSpread = operationTypes <= 1 ? 0 : operationTypes * 25 + (100 - dominantShare);
    const polyvalence = clamp(Math.round(rawSpread), 0, 100);

    return {
      name: player.name,
      role,
      operations: player.operations,
      positions: player.positions.size,
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
      polyvalence,
      score: 0,
      volumeIndex: 0,
      contributionPercent: 0,
      firstOperation: player.firstOperation?.toISOString() ?? null,
      lastOperation: player.lastOperation?.toISOString() ?? null,
      status: statusFromScore(dominantShare >= 90 ? 76 : Math.max(duelFriendlyScore(player.byType), 50)),
    };
  });

  const topOperations = Math.max(...players.map((player) => player.operations), 1);
  const totalOperations = players.reduce((sum, player) => sum + player.operations, 0);
  for (const player of players) {
    player.volumeIndex = Math.round((player.operations / topOperations) * 100);
    player.score = player.volumeIndex;
    player.contributionPercent = percent(player.operations, totalOperations);
  }

  return players.sort((a, b) => b.operations - a.operations || a.name.localeCompare(b.name));
}

function buildPositions(rows) {
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
    if (isScoringRow(row) && (row.duelWonFlag === 0 || row.duelWonFlag === 1)) {
      position.duelRows += 1;
      if (row.duelWonFlag === 1) position.duelWonRows += 1;
    }
    if (!position.travelCode && row.travelCode) position.travelCode = row.travelCode;
  }

  return Array.from(map.values()).map((position) => {
    const start = position.byTypeDates.DECHG ?? position.firstOperation;
    const zonage = position.byTypeDates.ZONAGE ?? null;
    const delayMinutes = zonage ? Math.max(0, Math.round((zonage.getTime() - start.getTime()) / 60000)) : null;
    const duelWon = position.duelRows > 0 ? position.duelWonRows > 0 : delayMinutes !== null && delayMinutes <= DZ_TARGET_MINUTES;
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

function buildCauserie({ score, openDuelRows, weakRole, validation }) {
  const priority =
    score >= 85 ? "Maintenir le rythme et sécuriser les fins de séquence." : "Reprendre les duels hors délai cible.";
  const risk =
    openDuelRows.length > 0
      ? `${openDuelRows.length} duel(s) à reprendre dans le plan de jeu.`
      : "Risque principal maîtrisé sur le dernier import.";

  return [
    { label: "Priorité", value: priority },
    { label: "Risque principal", value: risk },
    { label: "Objectif", value: "Tenir le délai cible de 30 minutes sur les duels." },
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

function buildFilterStats(rows) {
  const periodRows = rows.filter((row) => isExcelBlank(row.hourFilter));
  const operatorRows = rows.filter((row) => isExcelBlank(row.operatorFilter));
  const matchRows = rows.filter(isMatchRow);
  const scoringRows = matchRows.filter(isScoringRow);

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

function isMatchRow(row) {
  return isExcelBlank(row.operatorFilter) && isExcelBlank(row.hourFilter);
}

function isScoringRow(row) {
  return isMatchRow(row) && isExcelBlank(row.unzonedFilter);
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
    return new Date(epoch + value * 86400000);
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

function cleanText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
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

function topBy(items, getter) {
  return [...items].sort((a, b) => getter(b) - getter(a))[0] ?? null;
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

function statusFromScore(score) {
  if (score >= 85) return "MAÎTRISÉ";
  if (score >= 70) return "À SURVEILLER";
  return "ACTION NÉCESSAIRE";
}

function formatRange(start, end) {
  if (!start || !end) return "Plage non disponible";
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function formatTime(date) {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function userError(title, message) {
  return {
    title,
    message,
    action: "Vérifie ton extraction et réessaie.",
  };
}
