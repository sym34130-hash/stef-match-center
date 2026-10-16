import assert from "node:assert/strict";
import test from "node:test";
import { describeQualificationReason, NON_QUALIFIABLE_NOTICE, qualificationReasons } from "../src/qualification-reasons.ts";

test("qualification : quatre codes existants, explications et glossaire cohérents", () => {
  const expected = {
    zonage_uniquement_anterieur: ["Zonage uniquement antérieur", "Aucun zonage ultérieur n'a été retrouvé"],
    zonage_absent: ["Zonage absent", "Aucun zonage n'a été retrouvé pour cette position"],
    voyage_reception_absent: ["Voyage de réception absent", "n'a pas pu être identifié de manière fiable"],
    receptions_contradictoires: ["Réceptions contradictoires", "Plusieurs voyages différents"],
  };
  assert.deepEqual(Object.keys(qualificationReasons), Object.keys(expected));
  for (const [code, [label, excerpt]] of Object.entries(expected)) {
    const reason = describeQualificationReason(code);
    assert.equal(reason.label, label);
    assert.ok(reason.explanation.includes(excerpt));
    assert.ok(reason.summary.length > 0 && reason.summary.length < reason.explanation.length + 10);
  }
});

test("qualification : motif inconnu ou absent, aucune cause inventée", () => {
  for (const code of ["future_reason", "toString", "__proto__", "", null, undefined]) {
    const reason = describeQualificationReason(code);
    assert.equal(reason.label, "Association non qualifiable");
    assert.equal(reason.explanation, "Les données disponibles ne permettent pas de vérifier ce délai de manière fiable. Aucun motif plus précis n'est disponible.");
  }
});

test("qualification : précision commune explicite, sans statut de retard", () => {
  assert.equal(NON_QUALIFIABLE_NOTICE, "Non qualifiable ne signifie pas en retard.");
});
