# Operational analyses — contract v1

These optional snapshot fields are descriptive and never feed an official KPI:
`zonageDiagnostic`, `unloadingHourlyAnalysis`, `anomalySummary`.
`operationalAnalysisVersion` is separate from `KPI_DICTIONARY_VERSION`.
Implementation: `server/operational-analysis.mjs`.

## Shared scope and dated operating period

The engine supplies the existing match rows: valid parsed operations, operator
filter, active clock window and explicit voyage exclusions already applied.
`Poz non zonees` and cached `DZ` do not restrict the chronological diagnostic.
No new agency access logic is introduced; the constructor and cache remain
agency-scoped. No operator names are added to analysis details.

Candidate periods use real Europe/Paris dates and the active window. For an
overnight window, post-midnight rows belong to the previous start date. Select
the greatest eligible operation count, then the most recent start date on ties.
Expose every candidate count and the operations outside the selected period.
This is a deterministic volume heuristic, not a confidence percentage or a
claim that the largest period is necessarily the intended business date.
Without dated eligible rows, return `indisponible` with a reason. A missing or
ambiguous daylight-saving boundary also returns unavailable rather than guessing.
With unambiguous source instants, overnight DST transitions use actual elapsed
time, including repeated hours. This does not disambiguate Excel wall clocks:
the historical date parser can shift timestamps near a DST transition and does
not reject nonexistent or ambiguous source times. That pre-existing import
limitation requires a separate contract decision; this wording change does not
alter it. Missing/ambiguous period boundaries remain unavailable as above.

Windows retain the official minute precision: the final minute is included in
full. Slot start/end are ISO instants with Europe/Paris as the declared display
zone. All intermediate slots are half-open; the final slot has
`endInclusiveMinute: true`. Empty slots remain present with null metrics.
The selected window defines the diagnostic scope: a first DECHG means the first
eligible DECHG in that window and period, not an arrival time for the entire source.

Daytime windows (08:00-16:00, 14:00-22:00 and 00:00-08:00) retain their
calendar date. Only a window whose end precedes its start shifts post-midnight
operations to the previous start date. The technical names `night`,
`otherNightOperations`, `OperatingNight` and `heure_du_premier_DECHG_de_la_nuit`
are retained for snapshot compatibility; they also represent daytime periods.

## Chronological zonage

Group by position in the selected period. Use its first eligible DECHG and first
eligible ZONAGE at or after that reception, never a different position or period.
All DECHG rows must identify the same nonempty inbound voyage. Conflicting codes
or missing reception codes are unqualifiable and are not arbitrarily attributed.
Repeated receptions with the same code are documented and deduplicated for counts.
CHG voyage codes are never used for ownership. Delay is rounded to seconds,
compared to the active `zonageMinutes * 60` threshold; equality is within target.

Counts: received = on time + late + unqualifiable; qualifiable = on time + late.
Anomaly rate = late / qualifiable; coverage = qualifiable / received.
Null anomaly rate and unavailable state when there is no qualifiable position.
Average excess uses only late positions and is null when none are late.
Rank by late count, anomaly rate, then exact voyage code ascending.
`top5` contains at most five voyages with at least one proven late position.
Details retain only late/unqualifiable exceptions, not source operations.

This explicitly changes the provisional phase-1 table denominator: that table
used late / received. It must not be copied as the definitive anomaly rate.

## Hourly reception

Group DECHG rows by voyage in the selected period. Elapsed seconds = rounded
last-start minus first-start; divide by the DECHG row count, not distinct
positions. Exclude nonpositive duration groups and record their count. Missing
voyage rows are not made into an artificial trip.
Assign the whole voyage to the slot of its first eligible DECHG. It appears once
even if it spans several hours. The slot metric is the arithmetic mean of the
unrounded voyage ratios, rounded only for display. Distinct positions are
informational; the slot count is deduplicated across its voyages.
Above target means strictly greater than active `unloadingSeconds`.
The metric describes voyages started during the hour, NOT hours actually worked.
`buildUnloadingQuality` and the official TCD lost-duel detail are unchanged.

## Summary and old snapshots

Expose position, reception-voyage and loading-voyage counts separately. There is
no combined anomaly total and no inferred cause. The worst reception slot is
the greatest mean ratio, with earliest start breaking ties. The top zonage
voyage follows the ranking above. Messages and warnings are deterministic.

Loading counts reuse the existing TCD loading result and explicitly declare
`scope: plage_active_toutes_dates`; they are not silently assigned to the new
selected period. Warn about this difference when other periods are present.
Never substitute these counts for the official score.

The API rebuilds missing/old analysis contracts from the agency's workbook,
including on criteria, range and exclusion reconstruction. Normalization drops
incomplete or obsolete analysis fields without fabricating results. If the
workbook is absent, a legacy snapshot with otherwise valid matching official
criteria remains readable without new analyses. Existing rules still prevent
serving a snapshot calculated with different requested criteria.

## Tests

`scripts/operational-analysis.test.mjs` is included in `pnpm test` and contains
anonymized fixtures. It tests midnight, DST, contradictory/empty codes,
deduplication, equality boundaries, null metrics, active criteria, exclusions,
partial workbooks, six agency constructors and temporary API migration.

Optional real reconciliation (no workbook is versioned):

```sh
STEF_OPERATIONAL_WORKBOOK=/absolute/path/reference.xlsx node --test scripts/operational-analysis.test.mjs
```

`STEF_OPERATIONAL_BASELINE` may point to a temporary pre-change JSON projection
of official fields for exact before/after comparison. The real reconciliation
test checks its known audited reference only when explicitly enabled.
