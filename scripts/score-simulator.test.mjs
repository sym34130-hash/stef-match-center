import assert from "node:assert/strict";
import test from "node:test";
import { SCORE_INDICATORS, simulateScoreSelection } from "../src/score-simulator.ts";

const ids = SCORE_INDICATORS.map(({ id }) => id);
const values = { passRate: 50, loadingPercent: 60, unloadingPercent: 50.1, possessionPercent: 49.9 };

test("D1 : all four indicators reproduce the existing official strict threshold rule", () => {
  const result = simulateScoreSelection(values, 50, ids);
  assert.deepEqual(result, {
    status: "available", selected: ids, reached: 2, missed: 2, ratioPercent: 50, unavailable: [],
  });
  // Equality at threshold is a concession, NOT a successful KPI.
  assert.equal(simulateScoreSelection(values, 60, ids).reached, 0);
  assert.equal(simulateScoreSelection(values, 45, ids).reached, 4);
});

test("D1 : selection changes simulated denominator, not KPI data or official goal semantics", () => {
  const unchanged = structuredClone(values);
  const scenario = simulateScoreSelection(values, 50, ["loadingPercent", "possessionPercent"]);
  assert.deepEqual(scenario, {
    status: "available", selected: ["loadingPercent", "possessionPercent"],
    reached: 1, missed: 1, ratioPercent: 50, unavailable: [],
  });
  assert.deepEqual(values, unchanged);
  const onlyLoading = simulateScoreSelection(values, 50, ["loadingPercent"]);
  assert.equal(onlyLoading.reached, 1);
  assert.equal(onlyLoading.ratioPercent, 100);
  assert.equal(onlyLoading.selected.length, 1);
});

test("D1 : unavailable selected KPI never becomes a phantom goal against", () => {
  const incomplete = { ...values, loadingPercent: null };
  const selected = simulateScoreSelection(incomplete, 50, ids);
  assert.equal(selected.status, "unavailable");
  assert.equal(selected.reached, null);
  assert.equal(selected.missed, null);
  assert.deepEqual(selected.unavailable, ["loadingPercent"]);
  const others = simulateScoreSelection(incomplete, 50, ["passRate", "possessionPercent"]);
  assert.equal(others.status, "available");
  assert.equal(others.reached, 0);
  assert.equal(others.missed, 2);
});

test("D1 : reject selection and score threshold abnormalities", () => {
  for (const invalid of [[], ["loadingPercent", "loadingPercent"], ["unknown"], ["passRate", "unknown"]]) {
    assert.equal(simulateScoreSelection(values, 50, invalid).status, "unavailable");
  }
  for (const target of [Number.NaN, Infinity, 0, -5, 101]) {
    assert.equal(simulateScoreSelection(values, target, ids).status, "unavailable");
  }
  assert.equal(simulateScoreSelection(undefined, 50, ids).status, "unavailable");
});
