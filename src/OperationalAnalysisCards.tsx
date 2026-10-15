import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Info, ListFilter, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { OperatingNight, Snapshot } from "./types";
import { formatKpiDuration } from "./kpi-duration";
import "./operational-analysis.css";

const percent = (value: number | null | undefined) => value == null ? "—" : `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const count = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("fr-FR");
const clock = (date: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(date));
function nightLabel(night: OperatingNight | null | undefined) {
  if (!night) return "Nuit analysée indisponible";
  const date = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
  return `${date.formatRange(new Date(night.start), new Date(night.end))} · ${clock(night.start).replace(":", "h")}–${clock(night.end).replace(":", "h")}`;
}
const duration = (seconds: number | null | undefined) => seconds == null ? "Indisponible" : formatKpiDuration(seconds);

export function ReceptionHourlyChart({ snapshot }: { snapshot: Snapshot }) {
  const analysis = snapshot.unloadingHourlyAnalysis;
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const slots = analysis?.items ?? [];
  const selected = slots.find(slot => slot.start === selectedStart) ?? slots.find(slot => slot.state === "disponible") ?? slots[0];
  const ceiling = Math.max(60, Math.ceil(Math.max(analysis?.targetSeconds ?? 0, ...slots.map(slot => slot.meanSecondsPerPosition ?? 0)) * 1.2 / 60) * 60);
  const available = analysis?.state === "disponible";
  return <section className="reception-hourly-analysis" aria-label="Temps de réception par créneau">
    <header className="analysis-heading">
      <div><h3>Temps de réception par créneau</h3><p>Moyenne par position des voyages commencés dans l'heure</p></div>
      {analysis && <span className="analysis-target">Cible {duration(analysis.targetSeconds)}/position</span>}
    </header>
    <p className="analysis-provenance">{nightLabel(analysis?.night)} · Analyse segmentée, distincte du KPI officiel.</p>
    {!available ? <p className="analysis-empty" role="status">Analyse indisponible : aucune réception exploitable sur la nuit retenue.</p> : <>
      <div className="reception-hour-chart" role="group" aria-label="Histogramme des temps moyens, en secondes par position">
        <div className="reception-hour-axis" aria-hidden="true"><span>{ceiling} s</span><span>{ceiling / 2} s</span><span>0 s</span></div>
        <div className="reception-hour-plot">
          <div className="reception-hour-target" aria-hidden="true" style={{ bottom: `${analysis.targetSeconds / ceiling * 100}%` }} />
          <div className="reception-hour-bars" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
            {slots.map(slot => <button key={slot.start} type="button"
              className={`reception-hour-button${slot.meanSecondsPerPosition != null && slot.meanSecondsPerPosition > analysis.targetSeconds ? " is-over-target" : ""}${selected?.start === slot.start ? " is-selected" : ""}`}
              style={{ "--bar-height": `${(slot.meanSecondsPerPosition ?? 0) / ceiling * 100}%` } as CSSProperties}
              aria-pressed={selected?.start === slot.start} aria-controls="reception-hour-detail"
              aria-label={`${clock(slot.start)}–${clock(slot.end)} : ${duration(slot.meanSecondsPerPosition)}, ${slot.travelCount} voyage${slot.travelCount === 1 ? "" : "s"}`}
              onClick={() => setSelectedStart(slot.start)}>
              <span className="reception-hour-bar" aria-hidden="true" />
              <span className="reception-hour-value">{slot.meanSecondsPerPosition == null ? "—" : count(slot.meanSecondsPerPosition)}</span>
              <span className="reception-hour-label">{slot.label.replace(/h$/, "")}<span className="reception-hour-unit">h</span></span>
            </button>)}
          </div>
        </div>
      </div>
      <div id="reception-hour-detail" className="reception-hour-detail" aria-live="polite">
        <strong>{selected ? `${clock(selected.start)}–${clock(selected.end)}` : "Créneau"}</strong>
        <span>Moyenne <b>{duration(selected?.meanSecondsPerPosition)}</b></span>
        <span>Voyages <b>{count(selected?.travelCount)}</b></span>
        <span>Hors cible <b>{selected?.state === "disponible" ? count(selected.offTargetTravels) : "—"}</b></span>
        <span>Objectif <b>{duration(analysis.targetSeconds)}/position</b></span>
      </div>
    </>}
  </section>;
}

const reasonLabel: Record<string, string> = {
  receptions_contradictoires: "Réceptions contradictoires", voyage_reception_absent: "Voyage de réception absent",
  zonage_uniquement_anterieur: "Zonage uniquement antérieur", zonage_absent: "Zonage non identifié",
};

export function OperationalDiagnosticCard({ snapshot }: { snapshot: Snapshot }) {
  const z = snapshot.zonageDiagnostic, summary = snapshot.anomalySummary;
  const [detail, setDetail] = useState<{ travelCode: string | null; trigger: HTMLButtonElement } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeDetail = () => { dialogRef.current?.close(); setDetail(null); detail?.trigger.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!detail || !dialogRef.current) return;
    const dialog = dialogRef.current;
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("button")?.focus();
    return () => dialog.close();
  }, [detail]);
  const entries = z?.details.filter(entry => !detail?.travelCode || entry.travelCode === detail.travelCode) ?? [];
  const hasZonage = z?.state === "disponible";
  const hasReception = (summary?.unloading.eligibleTravels ?? 0) > 0;
  const hasLoading = summary?.loading.state === "disponible";
  const priority = hasZonage ? z.top5[0] : null;
  const detailStats = detail?.travelCode ? z?.travels.find(trip => trip.travelCode === detail.travelCode) : z;
  return <section className="operational-diagnostic-card" aria-label="Diagnostic opérationnel">
    <header className="analysis-heading diagnostic-heading">
      <div><p className="analysis-eyebrow">Dernière exploitation importée</p><h3>Diagnostic opérationnel</h3></div>
      <span className="analysis-night">{nightLabel(z?.night ?? summary?.night)}</span>
    </header>
    <dl className="diagnostic-metrics">
      <div className="diagnostic-confirmed"><dt>Positions hors délai</dt><dd>{hasZonage ? count(z.latePositions) : "—"}</dd><small>Sur {hasZonage ? count(z.qualifiablePositions) : "—"} vérifiables · {percent(z?.anomalyRate)}</small></div>
      <div><dt>Délais non vérifiables</dt><dd>{z ? count(z.unqualifiablePositions) : "—"}</dd><small>Sur {z ? count(z.receivedPositions) : "—"} positions réceptionnées</small></div>
    </dl>
    <section className="diagnostic-investigation" aria-label="Priorité du brief">
      {priority ? <p>Premier voyage à examiner : <strong>{priority.travelCode} — {count(priority.latePositions)} retards</strong></p> : <p>{hasZonage ? "Aucun dépassement de zonage identifié dans le périmètre qualifiable." : "Données insuffisantes pour établir un constat sur la nuit retenue."}</p>}
    </section>
    <div className="diagnostic-secondary">
      <span className="diagnostic-coverage">{percent(z?.coverageRate)} des positions vérifiables</span>
      <span><b>{hasReception ? `${count(summary!.unloading.offTargetTravels)}/${count(summary!.unloading.eligibleTravels)}` : "—"}</b> réceptions hors cible — nuit analysée</span>
      <span><b>{hasLoading ? `${count(summary!.loading.offTargetTravels)}/${count(summary!.loading.eligibleTravels)}` : "—"}</b> chargements hors cible — TCD historique</span>
    </div>
    <section className="diagnostic-ranking" aria-label="FLOP zonage TOP 5">
      <div className="diagnostic-ranking-heading"><h4>FLOP Zonage - TOP 5</h4></div>
      <div className="diagnostic-legend" aria-label="Légende des positions"><span><i className="diagnostic-segment-late" />En retard</span><span><i className="diagnostic-segment-ontime" />Dans le délai</span><span><i className="diagnostic-segment-unknown" />Délai inconnu</span></div>
      {!hasZonage ? <p className="analysis-empty" role="status">Analyse indisponible : aucune réception qualifiable sur la nuit retenue.</p> : !z.top5.length ? <p className="analysis-empty">Aucun voyage hors délai parmi les positions qualifiables.</p> : <ol className="diagnostic-top5">
        {z.top5.map(trip => <li key={trip.travelCode}>
          <div className="diagnostic-trip-heading"><div className="diagnostic-trip-main"><strong>{trip.travelCode}</strong><span aria-label={`${trip.latePositions} positions hors délai sur ${trip.receivedPositions} reçues`}><b>{trip.latePositions} retards</b> / {trip.receivedPositions} reçues</span></div>
            {z.details.some(entry => entry.travelCode === trip.travelCode) && <button type="button" className="diagnostic-detail-button" aria-label={`Voir les positions du voyage ${trip.travelCode}`} title={`Voir les positions du voyage ${trip.travelCode}`} onClick={event => setDetail({ travelCode: trip.travelCode, trigger: event.currentTarget })}><ChevronRight size={18} /></button>}
          </div>
          {trip.receivedPositions > 0 && [trip.latePositions, trip.onTimePositions, trip.unqualifiablePositions].every(value => Number.isInteger(value) && value >= 0) && trip.latePositions + trip.onTimePositions + trip.unqualifiablePositions === trip.receivedPositions
            ? <div className="diagnostic-bar-track" role="img" aria-label={`${trip.travelCode} : ${trip.latePositions} en retard, ${trip.onTimePositions} dans le délai, ${trip.unqualifiablePositions} délai inconnu, sur ${trip.receivedPositions} reçues`}>
              <span className="diagnostic-segment-late" style={{ width: `${trip.latePositions / trip.receivedPositions * 100}%` }} />
              <span className="diagnostic-segment-ontime" style={{ width: `${trip.onTimePositions / trip.receivedPositions * 100}%` }} />
              <span className="diagnostic-segment-unknown" style={{ width: `${trip.unqualifiablePositions / trip.receivedPositions * 100}%` }} />
            </div> : <p className="analysis-provenance">Répartition indisponible</p>}
        </li>)}
      </ol>}
    </section>
    <div className="diagnostic-footer">
      <p className="diagnostic-coverage-note"><Info size={15} aria-hidden="true" /><span>Gris = délai impossible à vérifier. Ces positions ne sont pas comptées comme des retards.</span></p>
      <details className="diagnostic-method"><summary>Comment lire le FLOP ?</summary><p>Les voyages sont classés du plus grand au plus petit nombre de retards. Chaque barre montre les positions en retard, dans le délai ou dont le délai est inconnu.</p><p>Zonage : cible {z ? `${z.targetMinutes} min` : "—"}.</p></details>
      {!!z?.details.length && <button className="secondary-button compact" type="button" onClick={event => setDetail({ travelCode: null, trigger: event.currentTarget })}><ListFilter size={16} />Voir les positions à examiner</button>}
      {!!summary?.warnings.length && <details className="diagnostic-warnings"><summary>Qualité des données · {summary.warnings.length} avertissements</summary><ul>{summary.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
    </div>
    {detail && createPortal(<dialog ref={dialogRef} className="operational-zonage-dialog" aria-label={detail.travelCode ? `Positions à examiner · ${detail.travelCode}` : "Positions à examiner"} onCancel={event => { event.preventDefault(); closeDetail(); }} onClick={event => { if (event.target === event.currentTarget) closeDetail(); }}>
      <header><div><h3>Positions à examiner{detail.travelCode ? ` · ${detail.travelCode}` : ""}</h3><p>{entries.length} positions · {nightLabel(z?.night)}</p></div><button className="icon-button" type="button" title="Fermer" aria-label="Fermer les positions à examiner" onClick={closeDetail}><X size={20} /></button></header>
      {detailStats && <dl className="diagnostic-detail-stats">
        <div><dt>Réceptionnées</dt><dd>{count(detailStats.receivedPositions)}</dd></div><div><dt>Hors délai</dt><dd>{count(detailStats.latePositions)}</dd></div><div><dt>Dans le délai</dt><dd>{count(detailStats.onTimePositions)}</dd></div><div><dt>Non vérifiables</dt><dd>{count(detailStats.unqualifiablePositions)}</dd></div><div><dt>Qualifiables</dt><dd>{count(detailStats.qualifiablePositions)}</dd></div><div><dt>Taux d'anomalie</dt><dd>{percent(detailStats.anomalyRate)}</dd></div><div><dt>Couverture</dt><dd>{percent(detailStats.coverageRate)}</dd></div>
      </dl>}
      <ul className="zonage-detail-list">{entries.map(entry => <li key={`${entry.travelCode}-${entry.position}`}><div><strong>{entry.position}</strong><span>Voyage {entry.travelCode || "—"}</span></div><div><b>{entry.classification === "hors_delai" ? "Hors délai" : "Non qualifiable"}</b><span>{entry.reason ? reasonLabel[entry.reason] ?? "Association non qualifiable" : duration(entry.delaySeconds)}</span></div></li>)}</ul>
    </dialog>, document.body)}
  </section>;
}
