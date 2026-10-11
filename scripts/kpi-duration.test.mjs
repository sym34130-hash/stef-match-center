import assert from "node:assert/strict";
import test from "node:test";
import { formatKpiDuration } from "../src/kpi-duration.ts";

test("KPI : durées naturelles, cibles de ligue et critères personnalisés", () => {
  for (const [seconds, expected] of [
    [45, "45 sec"], [50, "50 sec"], [55, "55 sec"], [60, "1 min"],
    [75, "1 min 15"], [135, "2 min 15"], [150, "2 min 30"],
    [165, "2 min 45"], [180, "3 min"], [195, "3 min 15"],
    [142, "2 min 22"], [52, "52 sec"],
  ]) assert.equal(formatKpiDuration(seconds), expected);
});
