import assert from "node:assert/strict";
import test from "node:test";
import { BRIEF_TEXT_LIMITS, BRIEF_CAPTURE_LIMITS, migrateBriefLayout } from "../server/brief-layout.mjs";

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
