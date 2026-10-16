// Chart-only scope for "% passes réussies par heure".
// The source workbook uses DECHG for the "Déchargement" operation (column C).
// Column G permits AQ, ED, EX and truly blank cells; LIV and any other codes
// are not chartable. Apply per operation row before grouping by hour.
const ALLOWED_SEGMENTS = new Set(["AQ", "ED", "EX", ""]);

export function isHourlyPassChartRow(row) {
  return row?.operationType === "DECHG"
    && ALLOWED_SEGMENTS.has(String(row.segmentType ?? "").trim().toUpperCase());
}
