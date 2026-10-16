import assert from "node:assert/strict";
import test from "node:test";
import { buildReceptionCohort, MIN_RECEPTION_POSITIONS } from "../server/reception-cohort.mjs";

const time = value => new Date("2026-09-18T" + value + "+02:00");
const reception = (travelCode, position, date, segmentType = "EX") => ({
  operationType: "DECHG", travelCode, position, startedAt: time(date), segmentType,
});
function voyage(code, size, stepSeconds, segmentType = "EX") {
  const zero = +time("01:00:00");
  return Array.from({ length: size }, (_, index) => ({
    operationType: "DECHG", travelCode: code, position: code + "-" + index,
    startedAt: new Date(zero + index * stepSeconds * 1000), segmentType,
  }));
}

test("reception cohort: 15+ positions, AQ excluded, 14 positions not eligible", () => {
  const data = [
    ...voyage("VALID", 15, 20),
    ...voyage("SHORT", 14, 30),
    ...voyage("QUAI03", 35, 150, "AQ"),
  ];
  const result = buildReceptionCohort(data, 60);
  assert.deepEqual(result.travels.map(item => item.travelCode), ["VALID"]);
  assert.equal(result.excludedSmallTravels, 1);
  assert.equal(result.excludedQuayRows, 35);
  assert.equal(result.travels[0].operationRows, MIN_RECEPTION_POSITIONS);
});

test("reception cohort: threshold equality and lost-duel classification", () => {
  const exactly = voyage("EQUALITY", 15, 60 * 15 / 14);
  const late = voyage("LATE", 15, 70);
  const cohort = buildReceptionCohort([...exactly, ...late], 60);
  assert.equal(cohort.travels.length, 2);
  assert.equal(cohort.travels.filter(t => t.offTarget).length, 1);
  assert.equal(cohort.travels.find(t => t.travelCode === "EQUALITY").offTarget, false);
  assert.equal(cohort.travels.find(t => t.travelCode === "LATE").offTarget, true);
});

test("reception cohort: no invented duration and incomplete voyages excluded", () => {
  const zero = Array.from({ length: 16 }, (_, index) => reception("ZERO", String(index), "01:00:00"));
  const result = buildReceptionCohort([...zero, reception("", "X", "01:00:00")], 60);
  assert.equal(result.travels.length, 0);
  assert.equal(result.excludedZeroDurationTravels, 1);
  assert.equal(result.unidentifiedTravelRows, 1);
});

test("reception cohort: same journey code must be scoped by operating period first", () => {
  const old = voyage("TVE100", 15, 150);
  const newNight = voyage("TVE100", 20, 40).map(row => ({
    ...row, startedAt: new Date(+row.startedAt + 86400000),
  }));
  // The selected period is an explicit input: two nights must not be pooled.
  const secondNight = buildReceptionCohort(newNight, 60);
  const pooled = buildReceptionCohort([...old, ...newNight], 60);
  assert.equal(secondNight.travels.length, 1);
  assert.equal(secondNight.travels[0].offTarget, false);
  assert.equal(pooled.travels[0].offTarget, true);
});
