import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook, isTimeRangeWithin, KPI_DICTIONARY, KPI_DICTIONARY_VERSION, normalizeTimeRange } from "../server/match-engine.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.STEF_DATA_DIR
  ? path.resolve(process.env.STEF_DATA_DIR)
  : path.join(rootDir, "data", "agencies");
const agencyCode = process.env.RECONCILE_AGENCY ?? "058";
const workbookPath = process.env.RECONCILE_WORKBOOK
  ? path.resolve(process.env.RECONCILE_WORKBOOK)
  : await findLatestWorkbook(agencyCode);

const buffer = await fs.readFile(workbookPath);
const result = buildSnapshotFromWorkbook(buffer, path.basename(workbookPath), agencyCode);

assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));

const snapshot = result.snapshot;
const roles = Object.fromEntries(snapshot.summary.roleDistribution.map((item) => [item.role, item]));
const sourceWorkbook = XLSX.read(buffer, { cellFormula: true });
const sourceXName = sourceWorkbook.SheetNames.find((name) => normalizeHeader(name) === "x");
const sourceX = sourceXName ? sourceWorkbook.Sheets[sourceXName] : null;
const sourceChartHeader = Object.entries(sourceX ?? {}).find(([, cell]) => normalizeHeader(cell?.v) === "somme de % passes reussies");
assert.ok(sourceChartHeader, "La source X!FD:FG du graphique doit être présente");
const sourceChartRateCell = XLSX.utils.decode_cell(sourceChartHeader[0]);
const sourceChartHourColumn = sourceChartRateCell.c - 1;
assert.equal(
  normalizeHeader(sourceX[XLSX.utils.encode_cell({ r: sourceChartRateCell.r, c: sourceChartHourColumn })]?.v),
  "heure op",
  "Le graphique doit utiliser X!FF comme catégorie horaire",
);
const sourceChartRates = new Map();
const sourceRange = XLSX.utils.decode_range(sourceX["!ref"] ?? "A1:A1");
for (let row = sourceChartRateCell.r + 1; row <= sourceRange.e.r; row += 1) {
  const hour = Number(sourceX[XLSX.utils.encode_cell({ r: row, c: sourceChartHourColumn })]?.v);
  const rate = Number(sourceX[XLSX.utils.encode_cell({ r: row, c: sourceChartRateCell.c })]?.v);
  if (Number.isFinite(hour) && Number.isFinite(rate) && rate >= 0 && rate <= 1) sourceChartRates.set(hour, Math.round(rate * 1000) / 10);
}

const overnightPeriod = normalizeTimeRange("22:30", "06:00");
assert.equal(overnightPeriod.isOvernight, true, "Une plage qui traverse minuit doit être reconnue");
assert.equal(overnightPeriod.durationMinutes, 450, "La durée d'une plage de nuit doit être calculée sur 24 heures");
assert.equal(isTimeRangeWithin(normalizeTimeRange("23:00", "01:00"), overnightPeriod), true, "Une sous-plage de nuit doit rester dans la plage active");
assert.equal(isTimeRangeWithin(normalizeTimeRange("05:00", "23:00"), overnightPeriod), false, "Une sous-plage qui déborde après minuit doit être refusée");

assert.equal(KPI_DICTIONARY.length >= 7, true, "Le dictionnaire KPI doit rester disponible dans le moteur.");
assert.equal(snapshot.kpiDictionaryVersion, KPI_DICTIONARY_VERSION, "Le snapshot doit utiliser la version courante des règles KPI.");
assert.equal(snapshot.validation.filterStats.sourceRows, 6395, "Lignes source A:G");
assert.equal(snapshot.validation.filterStats.matchRows, 5498, "Lignes filtre opérateur + plage horaire réelle");
assert.equal(snapshot.validation.filterStats.scoringRows, 3517, "Lignes éligibles au score");
assert.equal(snapshot.validation.filterStats.excludedByPeriod, 247, "Lignes exclues par plage horaire réelle");
assert.equal(snapshot.validation.filterStats.excludedByOperator, 795, "Lignes exclues par filtre opérateur Excel");
assert.equal(snapshot.validation.filterStats.excludedFromScore, 1981, "Lignes exclues du score par Poz non zonées");
assert.equal(snapshot.validation.criticalMissingRows, 0, "Lignes source avec donnée critique manquante");
assert.equal(snapshot.validation.invalidDateRows, 0, "Lignes source avec date illisible");
assert.equal(snapshot.validation.issueRows, 0, "Lignes source distinctes avec anomalie d'import");

assert.equal(snapshot.summary.operations, 5498, "Opérations filtrées");
assert.equal(snapshot.summary.positions, 1708, "Positions filtrées");
assert.equal(snapshot.summary.players, 17, "Joueurs filtrés");
assert.deepEqual(snapshot.summary.operationCounts, { CHG: 1862, DECHG: 2507, ZONAGE: 1129 });

assert.equal(snapshot.summary.duelWon, 2528, "Duels gagnés recalculés avec la cible zonage");
assert.equal(snapshot.summary.duelTotal, 3517, "Dénominateur score Excel");
assert.equal(snapshot.summary.duelRate, 71.9, "Taux duels gagnés recalculé");
assert.equal(snapshot.summary.passRate, 69.2, "Taux de passes réussies repris de la table graphique Excel");
assert.deepEqual(
  snapshot.hourlyPerformance.map((item) => item.label),
  ["13h", "14h", "16h", "17h", "18h", "19h", "20h", "21h", "22h"],
  "Heures du graphique % passes réussies reprises de X!FF/X!FG",
);
assert.equal(
  snapshot.hourlyPerformance.every((item) => item.total > 0 && item.rate === Math.round((item.won / item.total) * 1000) / 10),
  true,
  "Chaque taux horaire doit correspondre aux compteurs de la ligne",
);
assert.equal(
  snapshot.hourlyPerformance.every((item) => sourceChartRates.get(item.hour) === item.rate),
  true,
  "Chaque point affiché doit correspondre à la source graphique X!FF/X!FG de la feuille Excel",
);
assert.equal(snapshot.summary.possessionPercent, 55.7, "Possession Zody sur la plage active");
assert.deepEqual(snapshot.summary.possessionPositions, { zonage: 856, reception: 1432, matched: 797 }, "Positions possession sur le même périmètre filtré");
assert.equal(snapshot.match.score, 72, "Score arrondi");
assert.equal(snapshot.match.status, "MAÎTRISÉ", "Statut du match aligné sur le score opérationnel");
assert.equal(snapshot.operationalScore.status, "available", "Score opérationnel disponible");
assert.equal(snapshot.operationalScore.goalsFor, 4, "Buts opérationnels marqués");
assert.equal(snapshot.operationalScore.goalsAgainst, 0, "Buts opérationnels encaissés");
assert.equal(snapshot.loadingQuality.targeted, 33, "Chargements cadrés issus de TCD PPT!U");
assert.equal(snapshot.loadingQuality.offTarget, 2, "Chargements non cadrés recalculés depuis TCD PPT!U");
const nonTargetedX47890 = snapshot.loadingQuality.nonTargetedShots.find((shot) => shot.travelCode === "X47890");
const nonTargetedX47660 = snapshot.loadingQuality.nonTargetedShots.find((shot) => shot.travelCode === "X47660");
assert.equal(nonTargetedX47890?.time, "15:27:02", "Heure complète du chargement non cadré");
assert.equal(nonTargetedX47890?.timePerPosition, "02:47", "Temps brut par position du chargement TCD PPT");
assert.equal(nonTargetedX47890?.where, "Poteau!", "Lexique de frappe repris depuis TCD PPT");
assert.equal(nonTargetedX47660?.where, "3ème poteau", "Détail de frappe recroisé avec la feuille de match");
assert.equal(snapshot.unloadingQuality.targeted, 39, "Déchargements dans la cible Argent");
assert.equal(snapshot.unloadingQuality.offTarget, 30, "Déchargements hors cible Argent");
assert.equal(snapshot.unloadingQuality.targetedPercent, 56.5, "Pourcentage de déchargements dans la cible Argent");
assert.equal(snapshot.unloadingQuality.averageTimePerPositionSeconds, 182, "Moyenne du temps de déchargement par position");
assert.deepEqual(
  snapshot.unloadingDuelQuality && { won: snapshot.unloadingDuelQuality.won, lost: snapshot.unloadingDuelQuality.lost },
  { won: 27, lost: 21 },
  "Duels gagnés réception issus du TCD Déchargement",
);
assert.deepEqual(snapshot.yellowCards, [], "Le carton de 22:34 est hors plage 13:00-22:30");

const yellowCardRangeResult = buildSnapshotFromWorkbook(
  buffer,
  path.basename(workbookPath),
  agencyCode,
  { start: "13:00", end: "23:00", criteria: { zonageMinutes: 20, loadingSeconds: 135, unloadingSeconds: 50, scoreTargetPercent: 70 } },
);
assert.equal(yellowCardRangeResult.ok, true, "La plage élargie doit rester exploitable");
if (yellowCardRangeResult.ok) {
  assert.deepEqual(
    yellowCardRangeResult.snapshot.yellowCards,
    [{ playerName: "LUDOVIC LAGARDERE", time: "22:34:23", reason: "Chargement à quai", travelCode: "X47401" }],
    "Le carton jaune doit apparaître dès que sa plage horaire le contient",
  );
}

// Regression guard: the loading KPI must use the raw TCD value U = T / S,
// not the presentation formula V, and must ignore voyages below 15 positions.
const rawLoadingDataHeaders = [
  "Operateur",
  "Date Heure de debut d operation",
  "Type d operation",
  "N position",
  "Code voyage",
  "Agence segment",
  "Type segment",
  "Filtre operateur",
  "Filtre heure",
  "Poste",
  "Poz non zonees",
  "DZ",
  "Duels gagnes",
];
const rawLoadingDataRows = Array.from({ length: 15 }, (_, index) => [
  "Joueur",
  new Date(Date.UTC(2026, 8, 11, 14, 0, index)),
  "CHG",
  String(index + 1),
  "RAW-001",
  "058",
  "X",
  "",
  "",
  "Attaquant",
  "",
  "",
  1,
]);
const rawLoadingTcdRows = [
  ["Chargement"],
  ["Code Voyage", "Min. de Date/Heure de début d'opération", "Max. de Date/Heure de début d'opération", "Nombre de N° Position", "TC", "", "TC/poz", "Commentaire"],
  ["RAW-001", new Date(Date.UTC(2026, 8, 11, 14, 0)), new Date(Date.UTC(2026, 8, 11, 14, 1)), 15, 0.015, 0.001, 0.5, 2],
  ["RAW-002", new Date(Date.UTC(2026, 8, 11, 14, 2)), new Date(Date.UTC(2026, 8, 11, 14, 3)), 14, 0.015, 0.001, 0.001, "Orbite lunaire"],
];
const rawLoadingWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(rawLoadingWorkbook, XLSX.utils.aoa_to_sheet([rawLoadingDataHeaders, ...rawLoadingDataRows]), "Données");
const rawLoadingTcdSheet = XLSX.utils.aoa_to_sheet(rawLoadingTcdRows);
// TCD PPT!X:Y is the code-to-label lexicon used by the comment column.
XLSX.utils.sheet_add_aoa(rawLoadingTcdSheet, [[2, "Poteau!"], [3, "3ème poteau"]], { origin: "X2" });
XLSX.utils.book_append_sheet(rawLoadingWorkbook, rawLoadingTcdSheet, "TCD PPT");
const rawLoadingResult = buildSnapshotFromWorkbook(
  XLSX.write(rawLoadingWorkbook, { type: "buffer", bookType: "xlsx" }),
  "raw-loading.xlsx",
  agencyCode,
);
assert.equal(rawLoadingResult.ok, true, "Le test TCD chargement doit être exploitable");
if (rawLoadingResult.ok) {
  assert.equal(rawLoadingResult.snapshot.loadingQuality.targeted, 1, "Le chargement lit U et exclut les voyages de moins de 15 positions");
  assert.equal(rawLoadingResult.snapshot.loadingQuality.offTarget, 0, "La valeur brute U est sous la cible dans le test TCD");
  assert.equal(rawLoadingResult.snapshot.loadingQuality.loadingDetails?.[0]?.timePerPosition, "01:26", "Le temps brut U est formaté correctement");
  assert.equal(rawLoadingResult.snapshot.loadingQuality.loadingDetails?.[0]?.where, "Poteau!", "Le lexique TCD est conservé");
}

// Regression guard: French text dates must keep day/month order and a zonage
// before a reception must not be used for that reception's delay.
const chronologyRows = [
  ["Joueur", "11/09/2026 13:10:00", "ZONAGE", "P-001", "V-001", "058", "X", "", "", "", "", "", ""],
  ["Joueur", "11/09/2026 14:00:00", "DECHG", "P-001", "V-001", "058", "X", "", "", "", "", "", ""],
  ["Joueur", "11/09/2026 14:05:00", "ZONAGE", "P-001", "V-001", "058", "X", "", "", "", "", "", ""],
];
const chronologyWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  chronologyWorkbook,
  XLSX.utils.aoa_to_sheet([rawLoadingDataHeaders, ...chronologyRows]),
  "Données",
);
const chronologyResult = buildSnapshotFromWorkbook(
  XLSX.write(chronologyWorkbook, { type: "buffer", bookType: "xlsx" }),
  "chronology.xlsx",
  agencyCode,
  { start: "13:00", end: "22:30", criteria: { zonageMinutes: 1, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 } },
);
assert.equal(chronologyResult.ok, true, "Les dates texte françaises doivent être exploitables");
if (chronologyResult.ok) {
  assert.equal(chronologyResult.snapshot.validation.invalidDateRows, 0, "Une date française valide ne doit pas être signalée illisible");
  assert.equal(chronologyResult.snapshot.match.date, "2026-09-11", "Une date 11/09/2026 doit rester le 11 septembre");
  assert.equal(chronologyResult.snapshot.positions[0]?.delayMinutes, 5, "Le délai doit partir du premier zonage après la réception");
  assert.equal(chronologyResult.snapshot.positions[0]?.duelWon, false, "Un zonage à 5 minutes dépasse la cible de 1 minute");
}

const leagueExpectations = [
  { name: "Bronze", criteria: { zonageMinutes: 45, loadingSeconds: 195, unloadingSeconds: 75, scoreTargetPercent: 45 }, duelWon: 2840, targeted: 34, offTarget: 1, unloadingTargeted: 43, unloadingOffTarget: 26, score: "4-0", priority: "Maintenir le rythme et sécuriser les fins de séquence.", status: "MAÎTRISÉ" },
  { name: "Argent", criteria: { zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 }, duelWon: 2528, targeted: 33, offTarget: 2, unloadingTargeted: 39, unloadingOffTarget: 30, score: "4-0", priority: "Maintenir le rythme et sécuriser les fins de séquence.", status: "MAÎTRISÉ" },
  { name: "Or", criteria: { zonageMinutes: 25, loadingSeconds: 150, unloadingSeconds: 55, scoreTargetPercent: 60 }, duelWon: 2307, targeted: 33, offTarget: 2, unloadingTargeted: 38, unloadingOffTarget: 31, score: "2-2", priority: "Reprendre les indicateurs sous l'objectif de la ligue.", status: "À SURVEILLER" },
  { name: "Platine", criteria: { zonageMinutes: 20, loadingSeconds: 135, unloadingSeconds: 50, scoreTargetPercent: 70 }, duelWon: 1979, targeted: 32, offTarget: 3, unloadingTargeted: 37, unloadingOffTarget: 32, score: "1-3", priority: "Reprendre les indicateurs sous l'objectif de la ligue.", status: "ACTION NÉCESSAIRE" },
];
for (const expected of leagueExpectations) {
  const leagueResult = buildSnapshotFromWorkbook(buffer, path.basename(workbookPath), agencyCode, { criteria: expected.criteria });
  assert.equal(leagueResult.ok, true, `${expected.name} doit être recalculable`);
  const leagueSnapshot = leagueResult.snapshot;
  assert.deepEqual(leagueSnapshot.performanceCriteria, expected.criteria, `Critères ${expected.name}`);
  assert.equal(leagueSnapshot.summary.duelWon, expected.duelWon, `Duels gagnés ${expected.name}`);
  assert.equal(leagueSnapshot.loadingQuality.targeted, expected.targeted, `Chargements cadrés ${expected.name}`);
  assert.equal(leagueSnapshot.loadingQuality.offTarget, expected.offTarget, `Chargements non cadrés ${expected.name}`);
  assert.equal(leagueSnapshot.unloadingQuality.targeted, expected.unloadingTargeted, `Déchargements dans la cible ${expected.name}`);
  assert.equal(leagueSnapshot.unloadingQuality.offTarget, expected.unloadingOffTarget, `Déchargements hors cible ${expected.name}`);
  assert.equal(leagueSnapshot.match.status, expected.status, `Statut du match ${expected.name}`);
  assert.equal(leagueSnapshot.summary.possessionPercent, snapshot.summary.possessionPercent, `Possession stable ${expected.name}`);
  const reachedIndicators = [
    leagueSnapshot.summary.passRate,
    leagueSnapshot.loadingQuality.targetedPercent,
    leagueSnapshot.unloadingQuality.targetedPercent,
    leagueSnapshot.summary.possessionPercent,
  ].filter((value) => value > expected.criteria.scoreTargetPercent).length;
  assert.equal(`${reachedIndicators}-${4 - reachedIndicators}`, expected.score, `Score opérationnel ${expected.name}`);
  assert.equal(leagueSnapshot.causerie.find((item) => item.label === "Priorité")?.value, expected.priority, `Priorité causerie ${expected.name}`);
}

const boundedPossessionResult = buildSnapshotFromWorkbook(buffer, path.basename(workbookPath), agencyCode, {
  start: "14:00",
  end: "15:00",
  criteria: { zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 },
});
assert.equal(boundedPossessionResult.ok, true, "La possession doit rester recalculable sur une sous-plage");
if (boundedPossessionResult.ok) {
  assert.equal(boundedPossessionResult.snapshot.summary.possessionPercent, 46.7, "Possession bornée sur une sous-plage déséquilibrée");
  assert.deepEqual(boundedPossessionResult.snapshot.summary.possessionPositions, { zonage: 156, reception: 227, matched: 106 }, "Positions communes de possession sur une sous-plage");
  assert.ok(boundedPossessionResult.snapshot.summary.possessionPercent <= 100, "Une possession ne doit jamais dépasser 100 %");
}

const narrowResult = buildSnapshotFromWorkbook(buffer, path.basename(workbookPath), agencyCode, {
  start: "14:00",
  end: "15:00",
  criteria: { zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 },
});
assert.equal(narrowResult.ok, true, "Une sous-plage doit rester recalculable");
if (narrowResult.ok) {
  assert.equal(narrowResult.snapshot.match.periodLabel, "14:00-15:00", "Plage active du recalcul déchargement");
  assert.equal(narrowResult.snapshot.unloadingQuality.targeted, 9, "Déchargements dans la cible sur la plage active");
  assert.equal(narrowResult.snapshot.unloadingQuality.offTarget, 3, "Déchargements hors cible sur la plage active");
  assert.equal(narrowResult.snapshot.unloadingQuality.targetedPercent, 75, "Pourcentage déchargement recalculé sur la plage active");
}

const emptyLoadingHeaders = [
  "Operateur",
  "Date Heure de debut d operation",
  "Type d operation",
  "N position",
  "Code voyage",
  "Agence segment",
  "Type segment",
  "Filtre operateur",
  "Filtre heure",
  "Poste",
  "Poz non zonees",
  "DZ",
  "Duels gagnes",
  "Quart temps",
];
const emptyLoadingRows = Array.from({ length: 20 }, (_, index) => [
  "Joueur",
  new Date(Date.UTC(2026, 7, 13, 14, 0, index)),
  "DECHG",
  String(index + 1),
  "V001",
  "058",
  "X",
  "",
  "",
  "Defenseur",
  "",
  "",
  "",
  "1er quart",
]);
const emptyLoadingWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  emptyLoadingWorkbook,
  XLSX.utils.aoa_to_sheet([emptyLoadingHeaders, ...emptyLoadingRows]),
  "Donnees",
);
const emptyLoadingResult = buildSnapshotFromWorkbook(
  XLSX.write(emptyLoadingWorkbook, { type: "buffer", bookType: "xlsx" }),
  "empty-loading.xlsx",
  agencyCode,
);
assert.equal(emptyLoadingResult.ok, true, "Un import sans chargement doit rester lisible");
if (emptyLoadingResult.ok) {
  assert.equal(emptyLoadingResult.snapshot.loadingQuality.targetedPercent, null, "Un chargement sans dénominateur est indisponible");
  assert.equal(emptyLoadingResult.snapshot.loadingQuality.offTargetPercent, null, "Un chargement sans dénominateur ne doit pas afficher 0 %");
  assert.equal(emptyLoadingResult.snapshot.operationalScore.status, "unavailable", "Le score opérationnel doit être indisponible sans indicateurs complets");
  assert.equal(emptyLoadingResult.snapshot.operationalScore.goalsFor, null, "Un score incomplet ne doit pas fabriquer de but marqué");
  assert.equal(emptyLoadingResult.snapshot.operationalScore.loading.status, "unavailable", "Le score doit être incomplet sans chargements contrôlables");
  assert.equal(emptyLoadingResult.snapshot.match.status, "À COMPLÉTER", "Le statut doit signaler les indicateurs incomplets");
  assert.equal(emptyLoadingResult.snapshot.causerie.find((item) => item.label === "Priorité")?.value, "Compléter les indicateurs avant de conclure le match.");
}

assert.equal(roles.Attaquant.count, 8, "Composition attaque");
assert.equal(roles.Milieu.count, 3, "Composition milieu");
assert.equal(roles.Défenseur.count, 6, "Composition défense");

const firstQuarterPlayers = snapshot.compositionPeriods.quarters.find((quarter) => quarter.id === "q1")?.players ?? [];
assert.equal(snapshot.players.find((player) => player.name === "NORMAN HASSICI")?.role, "Attaquant", "Le poste du match complet doit rester global");
assert.equal(firstQuarterPlayers.find((player) => player.name === "NORMAN HASSICI")?.role, "Milieu", "Le 1er quart doit recalculer le poste selon l'activité de la période");
assert.equal(firstQuarterPlayers.find((player) => player.name === "ENZO GOROSTIDI")?.role, "Milieu", "Les rôles du 1er quart doivent être recalculés joueur par joueur");

assert.equal(snapshot.highlights.bestScorer.name, "JEAN LUC LASSORT");
assert.equal(snapshot.highlights.bestScorer.value, 314);
assert.equal(snapshot.highlights.bestScorer.label, "Joueur Attaque");
assert.equal(snapshot.highlights.bestScorer.detail, "Meilleur(e) buteur(se)");
assert.equal(snapshot.highlights.bestPasser.name, "MORGAN JOUY");
assert.equal(snapshot.highlights.bestPasser.value, 287);
assert.equal(snapshot.highlights.bestPasser.label, "Joueur Milieu");
assert.equal(snapshot.highlights.bestPasser.detail, "Meilleur(e) passeur(se)");
assert.equal(snapshot.highlights.defensiveWall.name, "SYLVIE JACQUIER");
assert.equal(snapshot.highlights.defensiveWall.value, 941);
assert.equal(snapshot.highlights.defensiveWall.label, "Joueur Défense");
assert.equal(snapshot.highlights.defensiveWall.detail, "Meilleur(e) joueur(se)");
assert.ok(
  snapshot.players.filter((player) => player.operationTypes < 2).every((player) => player.polyvalence === 0),
  "Un joueur mono-activité ne doit pas recevoir de score de polyvalence."
);
assert.ok(
  snapshot.players.every((player) => player.polyvalence >= 0 && player.polyvalence <= 100),
  "La polyvalence doit rester comprise entre 0 et 100."
);
assert.ok(
  snapshot.coach.polyvalents.every((player) => player.operationTypes >= 2),
  "La liste des polyvalents doit contenir au moins deux activités."
);
for (const [key, operationType] of [["bestScorer", "CHG"], ["bestPasser", "ZONAGE"], ["defensiveWall", "DECHG"]]) {
  const leader = snapshot.players.find((player) => player.name === snapshot.highlights[key]?.name);
  assert.equal(leader?.positionsByType[operationType], Math.max(...snapshot.players.map((player) => player.positionsByType[operationType])), "Le premier de chaque ligne doit avoir le plus de positions de cette catégorie.");
}

console.log(`Réconciliation OK - ${path.basename(workbookPath)}`);
console.log(`Score ${snapshot.summary.duelWon}/${snapshot.summary.duelTotal} = ${snapshot.summary.duelRate}%`);
console.log(`Match filtré : ${snapshot.summary.operations} opérations, ${snapshot.summary.positions} positions, ${snapshot.summary.players} joueurs`);

async function findLatestWorkbook(code) {
  const uploadDir = path.join(dataDir, sanitizeSegment(code), "uploads");
  const entries = await fs.readdir(uploadDir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isWorkbookFile(entry.name))
      .map(async (entry) => {
        const filePath = path.join(uploadDir, entry.name);
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      })
  );
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  assert.ok(files[0], `Aucun classeur importé trouvé pour l'agence ${code}.`);
  return files[0].filePath;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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
