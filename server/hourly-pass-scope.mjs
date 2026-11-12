// The hourly "Performance des déchargements" graph (view 2/2) is limited
// to eligible DECHG operations, WITHOUT any filter on the segment column.
// AQ, ED, EX, LIV, blank and any other segment are included if they pass
// the existing operator / time-window / unzoned / league / travel filters.
export function isHourlyPassChartRow(row) {
  return String(row?.operationType ?? "").trim().toUpperCase() === "DECHG";
}
