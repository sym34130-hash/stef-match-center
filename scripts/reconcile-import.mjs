import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

assert.equal(snapshot.summary.duelWon, 2060, "Duels gagnés Excel");
assert.equal(snapshot.summary.duelTotal, 2925, "Dénominateur score Excel");
assert.equal(snapshot.summary.duelRate, 70.4, "Taux duels gagnés Excel");
assert.equal(snapshot.match.score, 70, "Score arrondi");
assert.equal(snapshot.loadingQuality.targeted, 34, "Chargements cadrés issus de l'Excel");
assert.equal(snapshot.loadingQuality.offTarget, 35, "Chargements non cadrés issus de l'Excel");
assert.equal(snapshot.loadingQuality.nonTargetedShots[0].travelCode, "X47890", "Tir non cadré repris depuis la feuille de match");

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
