import assert from "node:assert/strict";
import test from "node:test";
import { calculateAccidentFreeDays } from "../server/accident-free-days.mjs";

test("Lot C sécurité : aucune date de dernier accident => indisponible, pas zéro fictif", () => {
  assert.deepEqual(calculateAccidentFreeDays(null, "2026-11-09"), {
    status: "unavailable", days: null, reason: "missing_last_accident_date",
  });
});

test("Lot C sécurité : zéro jour le jour de l'accident, un le lendemain", () => {
  assert.equal(calculateAccidentFreeDays("2026-11-09", "2026-11-09").days, 0);
  assert.equal(calculateAccidentFreeDays("2026-11-09", "2026-11-10").days, 1);
});

test("Lot C sécurité : vrai calendrier civil, y compris année bissextile et heure d'été", () => {
  assert.equal(calculateAccidentFreeDays("2024-02-28", "2024-03-01").days, 2);
  assert.equal(calculateAccidentFreeDays("2026-03-28", "2026-03-30").days, 2);
  assert.equal(calculateAccidentFreeDays("2026-10-24", "2026-10-26").days, 2);
});

test("Lot C sécurité : dates invalides et futures ne produisent jamais de compteur", () => {
  assert.equal(calculateAccidentFreeDays("2026-02-29", "2026-11-09").reason, "invalid_last_accident_date");
  assert.equal(calculateAccidentFreeDays("2026-12-01", "2026-11-09").reason, "last_accident_after_reference");
  assert.equal(calculateAccidentFreeDays("2026-01-01", "2026-13-09").reason, "invalid_reference_date");
  assert.equal(calculateAccidentFreeDays("09/11/2026", "2026-11-09").days, null);
  assert.equal(calculateAccidentFreeDays("", "2026-11-09").status, "unavailable");
});
