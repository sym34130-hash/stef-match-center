// Independent Lot C safety indicator: no reads from operational KPI, Excel,
// the browser-local injury count, or any unverified incident source.
// Callers must supply two validated agency-local calendar dates (YYYY-MM-DD).

const DAY_MS = 24 * 60 * 60 * 1000;

function calendarDayNumber(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return Math.round(date.getTime() / DAY_MS);
}

export function calculateAccidentFreeDays(lastAccidentDate, asOfDate) {
  const asOfDay = calendarDayNumber(asOfDate);
  if (asOfDay === null) {
    return { status: "unavailable", days: null, reason: "invalid_reference_date" };
  }
  if (lastAccidentDate === null || lastAccidentDate === undefined || lastAccidentDate === "") {
    return { status: "unavailable", days: null, reason: "missing_last_accident_date" };
  }
  const lastDay = calendarDayNumber(lastAccidentDate);
  if (lastDay === null) {
    return { status: "unavailable", days: null, reason: "invalid_last_accident_date" };
  }
  if (lastDay > asOfDay) {
    return { status: "unavailable", days: null, reason: "last_accident_after_reference" };
  }
  return {
    status: "available",
    days: asOfDay - lastDay,
    reason: null,
    lastAccidentDate,
    asOfDate,
  };
}
