import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const PERFORMANCE_ROWS = [
  ["arrivalPunctuality", "taux de ponctualite arrivage"],
  ["departurePunctuality", "taux de ponctualite depart"],
  ["destinationPunctuality", "taux de ponctualite destination"],
  ["temperatureReturn", "taux de prise de temperature retour ramasse"],
];

export async function parse106jPdf(buffer, sourceName, options = {}) {
  const parsed = await pdfParse(buffer);
  return parse106jText(parsed.text, sourceName, options);
}

export function parse106jText(rawText, sourceName, options = {}) {
  const text = normalizeText(rawText);
  // The upload timestamp belongs to the upload transaction, not the PDF parser.
  // Legacy callers without metadata retain null rather than inventing a new import date.
  const importedAt = options.uploadedAt ?? null;
  const indicators = { sourceName, importedAt, referenceDate: findReferenceDate(text), agencyCode: findReportAgencyCode(text), punctuality: {}, punctualityTargets: {}, expedition: {} };

  for (const [key, label] of PERFORMANCE_ROWS) {
    const result = findSitePercent(text, label);
    if (result !== null) {
      indicators.punctuality[key] = result.value;
      if (result.target !== null) indicators.punctualityTargets[key] = result.target;
    }
  }

  const tonnage = findExpeditionTonnage(text);
  if (tonnage !== null) indicators.expedition.tonnage = tonnage;

  if (Object.keys(indicators.punctuality).length === 0 && Object.keys(indicators.expedition).length === 0) {
    throw new Error("Le PDF ne contient pas les indicateurs attendus du rapport SIE.106J.");
  }
  if (Object.keys(indicators.punctualityTargets).length === 0) delete indicators.punctualityTargets;
  return indicators;
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").toLowerCase();
}

function findSitePercent(text, label) {
  const index = text.indexOf(label);
  if (index < 0) return null;
  // Stay on the Site cell, then read the optional Norme Site cell without using a following row.
  const afterLabel = text.slice(index + label.length);
  const match = afterLabel.match(/^\s*%\s*(\d+(?:[.,]\d+)?)\s*%/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  const normMatch = afterLabel.slice(match[0].length).match(/^\s*[+-]?\s*\d+(?:[.,]\d+)?\s*%\s*(\d+(?:[.,]\d+)?)\s*%/);
  const target = normMatch ? Number(normMatch[1].replace(",", ".")) : null;
  return { value, target: Number.isFinite(target) && target >= 0 && target <= 100 ? target : null };
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

// The Site code is explicitly printed on official InfoManager SIE.106J reports.
// Do not infer ownership from the filename, and leave it null when absent.
function findReportAgencyCode(text) {
  return text.match(/\bsite\s*:\s*[^\[]*\[\s*([a-z0-9]+)\s*\]/)?.[1]?.toUpperCase() ?? null;
}
