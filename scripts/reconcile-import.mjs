import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook, KPI_DICTIONARY, KPI_DICTIONARY_VERSION } from "../server/match-engine.mjs";

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

assert.equal(KPI_DICTIONARY.length >= 7, true, "Le dictionnaire KPI doit rester disponible dans le moteur.");
assert.equal(snapshot.kpiDictionaryVersion, KPI_DICTIONARY_VERSION, "Le snapshot doit utiliser la version courante des règles KPI.");
assert.equal(snapshot.validation.filterStats.sourceRows, 5742, "Lignes source A:G");
assert.equal(snapshot.validation.filterStats.matchRows, 4595, "Lignes filtre opérateur + période");
assert.equal(snapshot.validation.filterStats.scoringRows, 2925, "Lignes éligibles au score");
assert.equal(snapshot.validation.filterStats.excludedByPeriod, 115, "Lignes exclues par période Excel");
assert.equal(snapshot.validation.filterStats.excludedByOperator, 1051, "Lignes exclues par filtre opérateur Excel");
assert.equal(snapshot.validation.filterStats.excludedFromScore, 1670, "Lignes exclues du score par Poz non zonées");
assert.equal(snapshot.validation.criticalMissingRows, 0, "Lignes source avec donnée critique manquante");
assert.equal(snapshot.validation.invalidDateRows, 0, "Lignes source avec date illisible");
assert.equal(snapshot.validation.issueRows, 0, "Lignes source distinctes avec anomalie d'import");

assert.equal(snapshot.summary.operations, 4595, "Opérations filtrées");
assert.equal(snapshot.summary.positions, 1430, "Positions filtrées");
assert.equal(snapshot.summary.players, 20, "Joueurs filtrés");
assert.deepEqual(snapshot.summary.operationCounts, { CHG: 1728, DECHG: 1900, ZONAGE: 967 });

assert.equal(snapshot.summary.duelWon, 2064, "Duels gagnés recalculés avec la cible zonage");
assert.equal(snapshot.summary.duelTotal, 2925, "Dénominateur score Excel");
assert.equal(snapshot.summary.duelRate, 70.6, "Taux duels gagnés recalculé");
assert.equal(snapshot.summary.possessionPercent, 50.2, "Possession Zody sur la plage active");
assert.deepEqual(snapshot.summary.possessionPositions, { zonage: 663, reception: 1131, matched: 568 }, "Positions possession sur le même périmètre filtré");
assert.equal(snapshot.match.score, 71, "Score arrondi");
assert.equal(snapshot.match.status, "MAÎTRISÉ", "Statut du match aligné sur le score opérationnel");
assert.equal(snapshot.operationalScore.status, "available", "Score opérationnel disponible");
assert.equal(snapshot.operationalScore.goalsFor, 4, "Buts opérationnels marqués");
assert.equal(snapshot.operationalScore.goalsAgainst, 0, "Buts opérationnels encaissés");
assert.equal(typeof snapshot.operationalScore.indicators.unloadingPercent, "number", "Indicateur déchargement disponible");
assert.equal(snapshot.loadingQuality.targeted, 34, "Chargements cadrés issus de l'Excel");
assert.equal(snapshot.loadingQuality.offTarget, 1, "Chargements non cadrés recalculés");
assert.equal(snapshot.loadingQuality.nonTargetedShots[0].time, "15:37:07", "Heure complète du chargement non cadré");
assert.equal(snapshot.loadingQuality.nonTargetedShots[0].timePerPosition, "02:56", "Temps par position du chargement non cadré");
assert.equal(snapshot.loadingQuality.nonTargetedShots[0].travelCode, "X47890", "Tir non cadré repris depuis la feuille de match");
assert.equal(snapshot.unloadingQuality.targeted, 43, "Déchargements dans la cible Argent");
assert.equal(snapshot.unloadingQuality.offTarget, 23, "Déchargements hors cible Argent");
assert.equal(snapshot.unloadingQuality.targetedPercent, 65.2, "Pourcentage de déchargements dans la cible Argent");
assert.equal(snapshot.unloadingQuality.averageTimePerPositionSeconds, 117, "Moyenne du temps de déchargement par position");

const leagueExpectations = [
  { name: "Bronze", criteria: { zonageMinutes: 45, loadingSeconds: 195, unloadingSeconds: 75, scoreTargetPercent: 45 }, duelWon: 2229, targeted: 35, offTarget: 0, unloadingTargeted: 48, unloadingOffTarget: 18, score: "4-0", priority: "Maintenir le rythme et sécuriser les fins de séquence.", status: "MAÎTRISÉ" },
  { name: "Argent", criteria: { zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 }, duelWon: 2064, targeted: 34, offTarget: 1, unloadingTargeted: 43, unloadingOffTarget: 23, score: "4-0", priority: "Maintenir le rythme et sécuriser les fins de séquence.", status: "MAÎTRISÉ" },
  { name: "Or", criteria: { zonageMinutes: 25, loadingSeconds: 150, unloadingSeconds: 55, scoreTargetPercent: 60 }, duelWon: 1977, targeted: 33, offTarget: 2, unloadingTargeted: 41, unloadingOffTarget: 25, score: "3-1", priority: "Maintenir le rythme et sécuriser les fins de séquence.", status: "MAÎTRISÉ" },
  { name: "Platine", criteria: { zonageMinutes: 20, loadingSeconds: 135, unloadingSeconds: 50, scoreTargetPercent: 70 }, duelWon: 1853, targeted: 32, offTarget: 3, unloadingTargeted: 40, unloadingOffTarget: 26, score: "1-3", priority: "Reprendre les indicateurs sous l'objectif de la ligue.", status: "ACTION NÉCESSAIRE" },
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
    leagueSnapshot.summary.duelRate,
    leagueSnapshot.loadingQuality.targetedPercent,
    leagueSnapshot.unloadingQuality.targetedPercent,
    leagueSnapshot.summary.possessionPercent,
  ].filter((value) => value >= expected.criteria.scoreTargetPercent).length;
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
  assert.equal(boundedPossessionResult.snapshot.summary.possessionPercent, 58.6, "Possession bornée sur une sous-plage déséquilibrée");
  assert.deepEqual(boundedPossessionResult.snapshot.summary.possessionPositions, { zonage: 191, reception: 145, matched: 85 }, "Positions communes de possession sur une sous-plage");
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
  assert.equal(narrowResult.snapshot.unloadingQuality.targeted, 12, "Déchargements dans la cible sur la plage active");
  assert.equal(narrowResult.snapshot.unloadingQuality.offTarget, 1, "Déchargements hors cible sur la plage active");
  assert.equal(narrowResult.snapshot.unloadingQuality.targetedPercent, 92.3, "Pourcentage déchargement recalculé sur la plage active");
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

assert.equal(roles.Attaquant.count, 10, "Composition attaque");
assert.equal(roles.Milieu.count, 5, "Composition milieu");
assert.equal(roles.Défenseur.count, 5, "Composition défense");

assert.equal(snapshot.highlights.bestScorer.name, "JEAN LUC LASSORT");
assert.equal(snapshot.highlights.bestScorer.value, 261);
assert.equal(snapshot.highlights.bestScorer.label, "Joueur Attaque");
assert.equal(snapshot.highlights.bestPasser.name, "THIERRY BOUGNAGUE");
assert.equal(snapshot.highlights.bestPasser.value, 200);
assert.equal(snapshot.highlights.bestPasser.label, "Joueur Milieu");
assert.equal(snapshot.highlights.defensiveWall.name, "YOUNES EL KICH");
assert.equal(snapshot.highlights.defensiveWall.value, 623);
assert.equal(snapshot.highlights.defensiveWall.label, "Joueur Défense");
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
const categoryHighlightNames = [
  snapshot.highlights.bestScorer?.name,
  snapshot.highlights.bestPasser?.name,
  snapshot.highlights.defensiveWall?.name,
].filter(Boolean);
assert.equal(
  new Set(categoryHighlightNames).size,
  categoryHighlightNames.length,
  "Les trois distinctions par ligne doivent rester attribuées à des joueurs distincts quand les données le permettent."
);

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
