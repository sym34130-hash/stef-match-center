import assert from "node:assert/strict";
import test from "node:test";
import { isKpiGoalConceded } from "../src/kpi-goal-status.ts";

const leagues = [
  { name: "Bronze", target: 45 },
  { name: "Argent", target: 50 },
  { name: "Or", target: 60 },
  { name: "Platine", target: 70 },
];

for (const { name, target } of leagues) {
  test(`${name}: value below or equal to score target concedes one goal`, () => {
    assert.equal(isKpiGoalConceded(target - 0.1, true, target), true);
    assert.equal(isKpiGoalConceded(target, true, target), true, "equality concedes under strict > target rule");
    assert.equal(isKpiGoalConceded(target + 0.1, true, target), false);
  });
}

test("custom score thresholds are supported without hardcoded league rules", () => {
  assert.equal(isKpiGoalConceded(63, true, 65), true);
  assert.equal(isKpiGoalConceded(66, true, 65), false);
});

test("unavailable or invalid data must not be labeled a conceded goal", () => {
  for (const value of [null, undefined, Number.NaN, Infinity, -Infinity]) {
    assert.equal(isKpiGoalConceded(value, true, 60), false);
  }
  assert.equal(isKpiGoalConceded(49, false, 50), false);
  assert.equal(isKpiGoalConceded(49, true, Number.NaN), false);
});

test("conceded red KPI count equals football goals against when complete", () => {
  for (const target of [45, 50, 60, 70]) {
    for (const values of [[30, 50, 60, 90], [60, 60, 60, 60], [target, target + 0.1, 90, 100]]) {
      const conceded = values.filter(value => isKpiGoalConceded(value, true, target)).length;
      const reached = values.filter(value => value > target).length;
      assert.equal(conceded, 4 - reached);
    }
  }
});
