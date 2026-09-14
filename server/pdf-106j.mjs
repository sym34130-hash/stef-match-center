import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const PERFORMANCE_ROWS = [
  ["arrivalPunctuality", "taux de ponctualite arrivage"],
  ["departurePunctuality", "taux de ponctualite depart"],
  ["destinationPunctuality", "taux de ponctualite destination"],
  ["temperatureReturn", "taux de prise de temperature retour ramasse"],
];

export async function parse106jPdf(buffer, sourceName) {
  const parsed = await pdfParse(buffer);
  return parse106jText(parsed.text, sourceName);
}

export function parse106jText(rawText, sourceName) {
  const text = normalizeText(rawText);
  const indicators = { sourceName, importedAt: new Date().toISOString(), referenceDate: findReferenceDate(text), punctuality: {}, expedition: {} };

  for (const [key, label] of PERFORMANCE_ROWS) {
    const value = findSitePercent(text, label);
    if (value !== null) indicators.punctuality[key] = value;
  }

  const tonnage = findExpeditionTonnage(text);
  if (tonnage !== null) indicators.expedition.tonnage = tonnage;

  if (Object.keys(indicators.punctuality).length === 0 && Object.keys(indicators.expedition).length === 0) {
    throw new Error("Le PDF ne contient pas les indicateurs attendus du rapport SIE.106J.");
  }
  return indicators;
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").toLowerCase();
}

function findSitePercent(text, label) {
  const index = text.indexOf(label);
  if (index < 0) return null;
  // Stay on the Site cell: never substitute a trend, norm or following row.
  const match = text.slice(index + label.length).match(/^\s*%\s*(\d+(?:[.,]\d+)?)\s*%/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value <= 100 ? value : null;
}

function findExpeditionTonnage(text) {
  const match = text.match(/expedition\s*tonnage\s*t\s*(\d+(?: \d{3})*(?:[.,]\d+)?)(?=\s*(?:[+-]|positions|$))/);
  if (!match) return null;
  const value = Number(match[1].replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function findReferenceDate(text) {
  return text.match(/date de reference de calcul\s*:\s*(\d{1,2} \w+ \d{4})/)?.[1] ?? null;
}
