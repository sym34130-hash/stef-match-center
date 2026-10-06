import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSnapshotContract } from "../server/match-engine.mjs";

function player(name, positions, operations) {
  return { name, role: "Attaquant", score: 50, operations: Object.values(operations).reduce((sum, value) => sum + value, 0), byType: operations, positionsByType: positions };
}

test("Existing snapshots rank every line by positions, not repeated operations", () => {
  const players = [
    player("Repeated operations", { CHG: 5, ZONAGE: 4, DECHG: 3 }, { CHG: 100, ZONAGE: 100, DECHG: 100 }),
    player("Most positions", { CHG: 10, ZONAGE: 9, DECHG: 8 }, { CHG: 10, ZONAGE: 9, DECHG: 8 }),
  ];
  const snapshot = normalizeSnapshotContract({ players, highlights: { bestScorer: { name: "Repeated operations" } } });
  for (const key of ["bestScorer", "bestPasser", "defensiveWall"]) {
    assert.equal(snapshot.highlights[key].name, "Most positions");
  }
});

test("Equal positions use category operations, total operations, then name", () => {
  const positions = { CHG: 10, ZONAGE: 0, DECHG: 0 };
  const highlight = (players) => normalizeSnapshotContract({ players }).highlights.bestScorer?.name;
  assert.equal(highlight([
    player("A", positions, { CHG: 10, ZONAGE: 100, DECHG: 0 }),
    player("B", positions, { CHG: 11, ZONAGE: 0, DECHG: 0 }),
  ]), "B");
  assert.equal(highlight([
    player("A", positions, { CHG: 10, ZONAGE: 0, DECHG: 0 }),
    player("B", positions, { CHG: 10, ZONAGE: 1, DECHG: 0 }),
  ]), "B");
  assert.equal(highlight([
    player("B", positions, { CHG: 10, ZONAGE: 0, DECHG: 0 }),
    player("A", positions, { CHG: 10, ZONAGE: 0, DECHG: 0 }),
  ]), "A");
});

test("A line without activity has no winner", () => {
  const snapshot = normalizeSnapshotContract({ players: [player("A", { CHG: 1, ZONAGE: 0, DECHG: 0 }, { CHG: 1, ZONAGE: 0, DECHG: 0 })] });
  assert.equal(snapshot.highlights.bestPasser, null);
  assert.equal(snapshot.highlights.defensiveWall, null);
});
