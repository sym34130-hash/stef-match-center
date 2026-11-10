import assert from "node:assert/strict";
import test from "node:test";
import { BRIEF_TEXT_LIMITS, BRIEF_CAPTURE_LIMITS, BRIEF_INDICATOR_IDS, BRIEF_INDICATOR_SELECTION_VERSION, migrateBriefLayout, normalizeBriefIndicators } from "../server/brief-layout.mjs";

test("Brief ancien : fusion des textes sans mutation de la source", () => {
  const before = { attack: ["A"], midfield: ["B"], defense: ["C"], coach: { tactic: "inchangé" }, mercato: "inchangé" };
  const migrated = migrateBriefLayout(before);
  assert.deepEqual(migrated.attack, ["A"]);
  assert.deepEqual(migrated.midfield, ["B", "C"]);
  assert.deepEqual(migrated.defense, []);
  assert.deepEqual(before.defense, ["C"]);
  assert.deepEqual(migrated.coach, before.coach);
  assert.equal(migrated.mercato, before.mercato);
});

test("Brief ancien : captures Expédition puis Ramasse, y compris 12 + 12", () => {
  const e = Array.from({ length: 12 }, (_, i) => `E${i}`);
  const r = Array.from({ length: 12 }, (_, i) => `R${i}`);
  const migrated = migrateBriefLayout({ attachments: { midfield: e, defense: r } });
  assert.deepEqual(migrated.attachments.midfield, [...e, ...r]);
  assert.deepEqual(migrated.attachments.defense, []);
  assert.equal(migrated.attachments.midfield.length, BRIEF_CAPTURE_LIMITS.midfield);
});

test("Brief ancien : six textes de 500 caractères intégralement conservés", () => {
  const e = Array.from({ length: 3 }, (_, i) => String(i).repeat(500));
  const r = Array.from({ length: 3 }, (_, i) => String(i + 3).repeat(500));
  const migrated = migrateBriefLayout({ midfield: e, defense: r });
  assert.deepEqual(migrated.midfield, [...e, ...r]);
  assert.equal(migrated.midfield.join("\n").length, BRIEF_TEXT_LIMITS.midfield);
});

test("Brief versionné : migration idempotente et SST indépendant", () => {
  const migrated = migrateBriefLayout({ briefLayoutVersion: 1, midfield: ["B"], defense: ["C"] });
  assert.equal(migrated.briefLayoutVersion, 2);
  assert.deepEqual(migrateBriefLayout(migrateBriefLayout(migrated)), migrated);
  const edited = { ...migrated, defense: ["Brief sécurité"], attachments: { ...migrated.attachments, defense: ["SST1"] } };
  assert.deepEqual(migrateBriefLayout(edited), edited);
  const expeditionEdited = migrateBriefLayout({ ...edited, midfield: ["Nouvelle expédition"] });
  assert.deepEqual(expeditionEdited.defense, ["Brief sécurité"]);
  assert.deepEqual(expeditionEdited.attachments.defense, ["SST1"]);
});

test("Brief absent : SST et captures restent vides", () => {
  const migrated = migrateBriefLayout(null);
  assert.equal(migrated.briefLayoutVersion, 2);
  assert.deepEqual(migrated.defense, []);
  assert.deepEqual(migrated.attachments.defense, []);
});

test("Brief : les deux tonnages sont visibles par défaut", () => {
  assert.deepEqual(BRIEF_INDICATOR_IDS, [
    "performance", "injuries", "accident-free-days", "tonnage-distribution", "tonnage-expedition",
    "positions", "arrival", "departure", "destination", "temperature",
  ]);
  assert.deepEqual(normalizeBriefIndicators(undefined), BRIEF_INDICATOR_IDS);
  assert.deepEqual(normalizeBriefIndicators([]), BRIEF_INDICATOR_IDS);
  assert.deepEqual(normalizeBriefIndicators(["unknown"]), BRIEF_INDICATOR_IDS);
});

test("Brief : les deux cartes Tonnage sont masquables indépendamment", () => {
  assert.deepEqual(normalizeBriefIndicators(["tonnage-distribution", "positions"]), ["tonnage-distribution", "positions"]);
  assert.deepEqual(normalizeBriefIndicators(["tonnage-expedition", "positions"]), ["tonnage-expedition", "positions"]);
  assert.deepEqual(normalizeBriefIndicators(["tonnage-expedition", "tonnage-distribution"]), ["tonnage-distribution", "tonnage-expedition"]);
  assert.deepEqual(normalizeBriefIndicators(["positions"]), ["positions"]);
});

test("Brief : compatibilité avec l'ancien identifiant tonnage", () => {
  assert.deepEqual(normalizeBriefIndicators(["tonnage", "positions"]), ["tonnage-distribution", "tonnage-expedition", "positions"]);
  assert.deepEqual(normalizeBriefIndicators(["tonnage", "tonnage-expedition", "arrival"]), ["tonnage-distribution", "tonnage-expedition", "arrival"]);
  assert.deepEqual(normalizeBriefIndicators(["arrival", "positions"]), ["positions", "arrival"]);
});

test("AT : une ancienne configuration conserve ses choix et affiche la nouvelle vignette par défaut", () => {
  const historical = ["performance", "tonnage-expedition", "positions"];
  const copy = [...historical];
  assert.equal(BRIEF_INDICATOR_SELECTION_VERSION, 2);
  assert.deepEqual(normalizeBriefIndicators(historical, 1), ["performance", "accident-free-days", "tonnage-expedition", "positions"]);
  assert.deepEqual(historical, copy, "Migration sans mutation des anciennes préférences");
  assert.deepEqual(normalizeBriefIndicators(["tonnage", "positions"], 1), [
    "accident-free-days", "tonnage-distribution", "tonnage-expedition", "positions",
  ]);
});

test("AT : une sélection versionnée peut masquer la vignette durablement", () => {
  const withoutAT = ["performance", "positions"];
  assert.deepEqual(normalizeBriefIndicators(withoutAT, BRIEF_INDICATOR_SELECTION_VERSION), withoutAT);
  assert.deepEqual(normalizeBriefIndicators(withoutAT), withoutAT, "Le formulaire ne réactive pas une case décochée");
  assert.deepEqual(normalizeBriefIndicators([...withoutAT, "accident-free-days"], BRIEF_INDICATOR_SELECTION_VERSION), [
    "performance", "accident-free-days", "positions",
  ]);
  assert.deepEqual(normalizeBriefIndicators(normalizeBriefIndicators(withoutAT, 1), BRIEF_INDICATOR_SELECTION_VERSION), [
    "performance", "accident-free-days", "positions",
  ], "Après migration, l'affichage devient idempotent");
});
