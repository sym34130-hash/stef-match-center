import assert from "node:assert/strict";
import { test } from "node:test";
import { parse106jText } from "../server/pdf-106j.mjs";

test("106J: cellules Site et tonnages Expedition / Distribution séparés", () => {
  const result = parse106jText(`SIE.106J Date de référence de calcul :11 septembre 2026
    DistributionTonnageT255+11%-1%+4% PositionsNB739+7%
    ExpéditionTonnageT478+33%+11%+2% PositionsNB1 477+14% TotalTonnageT734+22%
    Taux de ponctualité Arrivage%80,00 %-13%85,00 %
    Taux de ponctualité Départ %64,10 %-26%85,00 %
    Taux de ponctualité Destination %62,00 %-35%85,00 %
    Taux de prise de température retour ramasse%92,19 %+3%100,00 %`, "106J.pdf");
  assert.deepEqual(result.expedition, { tonnage: 478 });
  assert.deepEqual(result.distribution, { tonnage: 255 });
  assert.deepEqual(result.punctuality, { arrivalPunctuality: 80, departurePunctuality: 64.1, destinationPunctuality: 62, temperatureReturn: 92.19 });
  assert.deepEqual(result.punctualityTargets, { arrivalPunctuality: 85, departurePunctuality: 85, destinationPunctuality: 85, temperatureReturn: 100 });
  assert.equal(result.referenceDate, "11 septembre 2026");
});

test("106J: zero est une valeur, une cellule absente ne l'est pas", () => {
  const result = parse106jText("Expédition Tonnage T 0 +0% Taux de ponctualité Arrivage % 0,00 %", "zero.pdf");
  assert.deepEqual(result.expedition, { tonnage: 0 });
  assert.deepEqual(result.punctuality, { arrivalPunctuality: 0 });
  const partial = parse106jText("DistributionTonnageT255+11% Expédition PositionsNB1477+14% Taux de ponctualité Arrivage%80,00 %", "partial.pdf");
  assert.deepEqual(partial.expedition, {});
  assert.deepEqual(partial.distribution, { tonnage: 255 });
});

test("106J: pas de substitution par la ligne suivante ou la tendance", () => {
  const result = parse106jText("Taux de ponctualité Arrivage % - -13%85% Taux de ponctualité Départ % 64,10 %", "partial.pdf");
  assert.deepEqual(result.punctuality, { departurePunctuality: 64.1 });
  assert.deepEqual(result.expedition, {});
});

test("106J: separateurs de milliers et decimales du tonnage", () => {
  assert.equal(parse106jText("Expédition Tonnage T 1 478,5 +33%", "decimal.pdf").expedition.tonnage, 1478.5);
});

test("106J: document sans indicateur et pourcentages invalides refuses", () => {
  assert.throws(() => parse106jText("Un autre document PDF", "other.pdf"), /ne contient pas/);
  assert.throws(() => parse106jText("Taux de ponctualité Arrivage % 125,00 %", "invalid.pdf"), /ne contient pas/);
  assert.throws(() => parse106jText("Taux de ponctualité Arrivage % -4,00 %", "invalid.pdf"), /ne contient pas/);
});

test("106J: distribution et expedition restent deux series distinctes", () => {
  const distributionOnly = parse106jText("Distribution Tonnage T 1 255,5 +11%", "night.pdf");
  assert.deepEqual(distributionOnly.distribution, { tonnage: 1255.5 });
  assert.deepEqual(distributionOnly.expedition, {});
  const expeditionOnly = parse106jText("Expédition Tonnage T 478 +33%", "day.pdf");
  assert.deepEqual(expeditionOnly.expedition, { tonnage: 478 });
  assert.deepEqual(expeditionOnly.distribution, {});
});
