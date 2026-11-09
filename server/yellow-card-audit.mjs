import * as XLSX from "xlsx";

// Lot C: the final match-sheet list and qualified, calculated matrix entries
// form the awarded cards. A static infraction label alone never qualifies.
// Unlisted candidates are recovered in match-engine after reconciliation.
const DISPLAY_SOURCE = "Feuille de match!AK:AN";
const TEMP_MATRIX_SOURCE = "X!II:IM";
const LOADING_MATRIX_SOURCE = "TCD PPT!P:Y";

function normalized(value) {
  return String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ").replace(/[^a-zA-Z0-9]+/g, " ")
    .trim().toLowerCase().replace(/\s+/g, " ");
}

function valueAt(sheet, address) {
  const value = sheet?.[address]?.v;
  return value === undefined || value === null ? "" : value;
}

function cardCategory(reason) {
  const value = normalized(reason);
  if (value.includes("prise de temp")) return "temperature";
  if (value.includes("chargement a quai")) return "loading";
  return "other";
}

function timeOfDaySeconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel date-time serial: both 0.9 (time only) and 46282.9 are valid.
    const fraction = ((value % 1) + 1) % 1;
    return Math.round(fraction * 86400) % 86400;
  }
  const text = String(value ?? "").trim();
  const match = text.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (match[4]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[4].toUpperCase() === "PM" ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  return hour * 3600 + minute * 60 + second;
}

function inPeriod(seconds, period) {
  if (!Number.isFinite(seconds) || !period) return false;
  const start = period.startMinutes * 60;
  const end = period.endMinutes * 60;
  return period.isOvernight || end < start
    ? seconds >= start || seconds <= end
    : seconds >= start && seconds <= end;
}

function candidateKey(entry) {
  return [entry.category, normalized(entry.playerName), normalized(entry.travelCode)].join("|");
}

function displayClock(seconds) {
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60)]
    .map(value => String(value).padStart(2, "0")).join(":");
}

function collectTemperatureCandidates(workbook, period, globallyExcluded) {
  const name = workbook?.SheetNames?.find(sheet => normalized(sheet) === "x");
  const sheet = name ? workbook.Sheets[name] : null;
  if (!sheet || normalized(valueAt(sheet, "II7")) !== "type d operation"
    || normalized(valueAt(sheet, "IJ7")) !== "code voyage") {
    return null;
  }

  const items = [];
  let incomplete = 0;
  // Excel's yellow-card submatrix lives near row 8. Inspect its own columns,
  // not the huge unrelated source tables on the same X worksheet.
  for (let row = 8; row <= 300; row += 1) {
    if (normalized(valueAt(sheet, `II${row}`)) !== "dechg"
      || cardCategory(valueAt(sheet, `IM${row}`)) !== "temperature") continue;
    const travelCode = String(valueAt(sheet, `IJ${row}`)).trim();
    const playerName = String(valueAt(sheet, `IK${row}`)).trim();
    const clockSeconds = timeOfDaySeconds(valueAt(sheet, `IL${row}`));
    if (!travelCode || globallyExcluded.has(travelCode)) continue;
    if (!playerName || clockSeconds === null) {
      incomplete += 1;
      continue;
    }
    if (!inPeriod(clockSeconds, period)) continue;
    items.push({ category: "temperature", playerName, travelCode,
      time: displayClock(clockSeconds), source: TEMP_MATRIX_SOURCE });
  }
  return { items, incomplete };
}

function collectLoadingCandidates(workbook, period, globallyExcluded) {
  const name = workbook?.SheetNames?.find(sheet => normalized(sheet) === "tcd ppt");
  const sheet = name ? workbook.Sheets[name] : null;
  if (!sheet || normalized(valueAt(sheet, "P9")) !== "code voyage"
    || normalized(valueAt(sheet, "X9")) !== "attaquant") {
    return null;
  }
  const items = [];
  let incomplete = 0;
  const lastRow = Math.min(5000, XLSX.utils.decode_range(sheet["!ref"] || "A1").e.r + 1);
  for (let row = 10; row <= lastRow; row += 1) {
    // Y is a static caption in this matrix. Only the *calculated* attacker
    // in X may constitute a candidate; Y alone must never be counted.
    const playerName = String(valueAt(sheet, `X${row}`)).trim();
    if (!playerName || normalized(valueAt(sheet, `Y${row}`)) !== "chargement a quai") continue;
    const travelCode = String(valueAt(sheet, `P${row}`)).trim();
    if (!travelCode || globallyExcluded.has(travelCode)) continue;
    const clockSeconds = timeOfDaySeconds(valueAt(sheet, `Q${row}`));
    if (clockSeconds === null) { incomplete += 1; continue; }
    if (!inPeriod(clockSeconds, period)) continue;
    items.push({ category: "loading", playerName, travelCode,
      time: displayClock(clockSeconds), source: LOADING_MATRIX_SOURCE });
  }
  return { items, incomplete };
}

export function auditYellowCards(workbook, awardedCards = [], period, globallyExcluded = new Set()) {
  const sourceName = workbook?.SheetNames?.find(name => normalized(name) === "feuille de match");
  const sheet = sourceName ? workbook.Sheets[sourceName] : null;
  let sourceAvailable = false;
  if (sheet) {
    const names = ["AK", "AL", "AM", "AN"];
    for (let row = 1; row <= 40; row += 1) {
      if (names.map(col => normalized(valueAt(sheet, `${col}${row}`))).join("|")
        === "nom|heure carton|faute|voyage") {
        sourceAvailable = true;
        break;
      }
    }
  }
  const byReason = { temperature: 0, loading: 0, other: 0 };
  for (const card of awardedCards) byReason[cardCategory(card.reason)] += 1;

  const temp = collectTemperatureCandidates(workbook, period, globallyExcluded);
  const loading = collectLoadingCandidates(workbook, period, globallyExcluded);
  // Identify calculated infractions omitted from the final sheet.
  // Reconcile by player + voyage + reason, respecting multiplicity.
  const awardedCounts = new Map();
  for (const card of awardedCards) {
    const key = candidateKey({ ...card, category: cardCategory(card.reason) });
    awardedCounts.set(key, (awardedCounts.get(key) ?? 0) + 1);
  }
  const unmatched = [];
  for (const candidate of [...(temp?.items ?? []), ...(loading?.items ?? [])]) {
    const key = candidateKey(candidate);
    const count = awardedCounts.get(key) ?? 0;
    if (count > 0) awardedCounts.set(key, count - 1);
    else unmatched.push(candidate);
  }

  return {
    source: DISPLAY_SOURCE,
    sourceAvailable,
    byReason,
    matrix: {
      temperatureAvailable: Boolean(temp),
      loadingAvailable: Boolean(loading),
      temperatureCandidates: temp?.items.length ?? null,
      loadingCandidates: loading?.items.length ?? null,
      incompleteTemperature: temp?.incomplete ?? null,
      incompleteLoading: loading?.incomplete ?? null,
      unlistedCandidates: unmatched,
    },
  };
}
