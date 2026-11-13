import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Info, ListFilter, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { OperatingNight, Snapshot } from "./types";
import { formatKpiDuration } from "./kpi-duration";
import { QualificationReason } from "./QualificationReason";
import "./operational-analysis.css";

const percent = (value: number | null | undefined) => value == null ? "—" : `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const count = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("fr-FR");
const clock = (date: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(date));
function nightLabel(night: OperatingNight | null | undefined) {
  if (!night) return "Période analysée indisponible";
  const date = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
  return `${date.formatRange(new Date(night.start), new Date(night.end))} · ${clock(night.start).replace(":", "h")}–${clock(night.end).replace(":", "h")}`;
}
const duration = (seconds: number | null | undefined) => seconds == null ? "Indisponible" : formatKpiDuration(seconds);
const compactDuration = (seconds: number) => {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};
// Keep historical snapshots intact while presenting their legacy warning neutrally.
const warningLabel = (warning: string) => warning.replace(/^(\d+) opération\(s\) d'autres nuits exclues des nouvelles analyses\.$/, "$1 opération(s) appartenant à d'autres périodes d'exploitation exclues du diagnostic.");

export function ReceptionHourlyChart({ snapshot }: { snapshot: Snapshot }) {
  const analysis = snapshot.unloadingHourlyAnalysis;
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const slots = analysis?.items ?? [];
  const selected = slots.find(slot => slot.start === selectedStart) ?? slots.find(slot => slot.state === "disponible") ?? slots[0];
  const ceiling = Math.max(60, Math.ceil(Math.max(analysis?.targetSeconds ?? 0, ...slots.map(slot => slot.meanSecondsPerPosition ?? 0)) * 1.2 / 60) * 60);
  const available = analysis?.state === "disponible";
  return <section className="reception-hourly-analysis" aria-label="Temps de réception par créneau">
    <header className="analysis-heading">
      <div><h3>Temps de réception par créneau</h3><p>Moyenne des voyages réceptionnés éligibles commencés dans l'heure</p></div>
      {analysis && <span className="analysis-target">Cible {duration(analysis.targetSeconds)}/position</span>}
    </header>
    <p className="analysis-provenance">{nightLabel(analysis?.night)} · Même périmètre que les duels gagnés (15 positions minimum, hors activité AQ). Hauteur : moyenne par position · Axe et valeurs : minutes:secondes (3:26 = 206 secondes) · Dans les barres : positions distinctes.</p>
    {!available ? <p className="analysis-empty" role="status">Analyse indisponible : aucune réception exploitable sur la période retenue.</p> : <>
      <div className="reception-hour-chart" role="group" aria-label="Histogramme des temps moyens, en secondes par position">
        <div className="reception-hour-axis" aria-hidden="true"><span>{compactDuration(ceiling)}</span><span>{compactDuration(ceiling / 2)}</span><span>{compactDuration(0)}</span></div>
        <div className="reception-hour-plot" style={{ "--target-height": `${analysis.targetSeconds / ceiling * 100}%` } as CSSProperties}>
          <div className="reception-hour-target" aria-hidden="true" />
          <div className="reception-hour-bars" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
            {slots.map(slot => <button key={slot.start} type="button"
              className={`reception-hour-button${slot.meanSecondsPerPosition != null && slot.meanSecondsPerPosition > analysis.targetSeconds ? " is-over-target" : ""}${selected?.start === slot.start ? " is-selected" : ""}${slot.state !== "disponible" || slot.meanSecondsPerPosition == null ? " is-unavailable" : ""}`}
              style={{ "--bar-height": `${(slot.meanSecondsPerPosition ?? 0) / ceiling * 100}%` } as CSSProperties}
              aria-pressed={selected?.start === slot.start} aria-controls="reception-hour-detail"
              aria-label={`${clock(slot.start)}–${clock(slot.end)} : ${slot.state === "disponible" ? `${count(slot.distinctPositions)} position${slot.distinctPositions === 1 ? "" : "s"} distincte${slot.distinctPositions === 1 ? "" : "s"}` : "positions indisponibles"}, moyenne ${duration(slot.meanSecondsPerPosition)}, ${slot.travelCount} voyage${slot.travelCount === 1 ? "" : "s"}`}
              onClick={() => setSelectedStart(slot.start)}>
              <span className="reception-hour-bar" aria-hidden="true">
                {slot.state === "disponible" && slot.meanSecondsPerPosition != null && <span className="reception-hour-bar-volume">{count(slot.distinctPositions)}</span>}
              </span>
              <span className="reception-hour-value" aria-hidden="true">{slot.state !== "disponible" || slot.meanSecondsPerPosition == null ? "—" : compactDuration(slot.meanSecondsPerPosition)}</span>
              <span className="reception-hour-label">{slot.label.replace(/h$/, "")}<span className="reception-hour-unit">h</span></span>
            </button>)}
          </div>
        </div>
      </div>
      <div id="reception-hour-detail" className="reception-hour-detail" aria-live="polite">
        <strong>{selected ? `${clock(selected.start)}–${clock(selected.end)}` : "Créneau"}</strong>
        <span>Moyenne <b>{duration(selected?.meanSecondsPerPosition)}</b></span>
        <span>Positions distinctes <b>{selected?.state === "disponible" ? count(selected.distinctPositions) : "—"}</b></span>
        <span>Voyages <b>{count(selected?.travelCount)}</b></span>
        <span>Hors cible <b>{selected?.state === "disponible" ? count(selected.offTargetTravels) : "—"}</b></span>
        <span>Objectif <b>{duration(analysis.targetSeconds)}/position</b></span>
      </div>
    </>}
  </section>;
}

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
  return <section className="operational-diagnostic-card diagnostic-simple" aria-label="Diagnostic opérationnel">
    <header className="analysis-heading diagnostic-heading">
      <div>
        <h3>Diagnostic opérationnel</h3>
        <p className="analysis-night">Période analysée : {nightLabel(z?.night ?? summary?.night)}</p>
      </div>
    </header>
    <div className="diagnostic-essential" role="group" aria-label="Bilan des retards">
      <strong className="diagnostic-big-number">{hasZonage ? count(z.latePositions) : "—"}</strong>
      <div className="diagnostic-essential-copy">
        <span>positions en retard</span>
        <small>{hasZonage ? `sur ${count(z.qualifiablePositions)} positions vérifiables` : "Données insuffisantes pour compter les retards"}</small>
      </div>
    </div>
    <section className="diagnostic-priority" aria-label="Priorité du brief">
      {priority ? <>
        <span className="diagnostic-priority-label">À contrôler en premier</span>
        <div className="diagnostic-priority-line">
          <strong>{priority.travelCode}</strong>
          <span>{count(priority.latePositions)} positions en retard</span>
        </div>
        {z?.details.some(entry => entry.travelCode === priority.travelCode) && (
          <button type="button" className="diagnostic-priority-action"
            aria-label={`Voir les positions du voyage ${priority.travelCode}`}
            onClick={event => setDetail({ travelCode: priority.travelCode, trigger: event.currentTarget })}>
            Voir les positions <ChevronRight size={16} aria-hidden="true" />
          </button>
        )}
      </> : <div className="diagnostic-priority-empty">
        <strong>{hasZonage ? "Aucun voyage en retard" : "Analyse indisponible"}</strong>
        <span>{hasZonage ? "Aucun retard confirmé sur les positions vérifiables." : "Aucune réception vérifiable pour cette période."}</span>
      </div>}
    </section>
    {z && z.unqualifiablePositions > 0 && (
      <p className="diagnostic-unknown">
        <Info size={17} aria-hidden="true" />
        <span><b>{count(z.unqualifiablePositions)} positions à vérifier</b><small>Délai inconnu : elles ne sont pas comptées comme des retards.</small></span>
      </p>
    )}
    <details className="diagnostic-more">
      <summary>Voir les détails</summary>
      <div className="diagnostic-more-content">
        {hasZonage && z.top5.length > 0 && <section className="diagnostic-ranking" aria-label="Voyages à examiner">
          <h4>Voyages avec le plus de retards</h4>
          <ol className="diagnostic-top5">
            {z.top5.map(trip => <li key={trip.travelCode}>
              <div className="diagnostic-trip-main">
                <strong>{trip.travelCode}</strong>
                <span>{count(trip.latePositions)} positions en retard</span>
              </div>
              {z.details.some(entry => entry.travelCode === trip.travelCode) && (
                <button type="button" className="diagnostic-detail-button"
                  aria-label={`Consulter les positions du voyage ${trip.travelCode}`}
                  onClick={event => setDetail({ travelCode: trip.travelCode, trigger: event.currentTarget })}>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              )}
            </li>)}
          </ol>
        </section>}
        <div className="diagnostic-secondary">
          <span><b>{hasZonage ? `${count(z.latePositions)}/${count(z.qualifiablePositions)}` : "—"}</b> positions en retard / vérifiables</span>
          <span><b>{hasReception ? `${count(summary!.unloading.offTargetTravels)}/${count(summary!.unloading.eligibleTravels)}` : "—"}</b> réceptions hors cible — période analysée</span>
          <span><b>{hasLoading ? `${count(summary!.loading.offTargetTravels)}/${count(summary!.loading.eligibleTravels)}` : "—"}</b> chargements hors cible — TCD historique</span>
        </div>
        {!!z?.details.length && <button className="secondary-button compact" type="button"
          onClick={event => setDetail({ travelCode: null, trigger: event.currentTarget })}>
          <ListFilter size={16} aria-hidden="true" /> Voir les positions à examiner
        </button>}
        <details className="diagnostic-method">
          <summary>Comprendre les chiffres</summary>
          <p>Un retard est compté seulement lorsque le délai entre réception et zonage est vérifiable et dépasse l'objectif. Les délais inconnus ne sont pas des retards.</p>
          <p>Objectif de zonage : {z ? `${z.targetMinutes} min` : "—"}.</p>
          <p>Les voyages sont classés par nombre de positions en retard, pas par pourcentage. Les autres indicateurs conservent leurs propres critères de calcul.</p>
        </details>
        {!!summary?.warnings.length && <details className="diagnostic-warnings">
          <summary>Problèmes de données · {summary.warnings.length}</summary>
          <ul>{summary.warnings.map(warning => <li key={warning}>{warningLabel(warning)}</li>)}</ul>
        </details>}
      </div>
    </details>
    {detail && createPortal(<dialog ref={dialogRef} className="operational-zonage-dialog" aria-label={detail.travelCode ? `Positions à examiner · ${detail.travelCode}` : "Positions à examiner"} onCancel={event => { event.preventDefault(); closeDetail(); }} onClick={event => { if (event.target === event.currentTarget) closeDetail(); }}>
      <header><div><h3>Positions à examiner{detail.travelCode ? ` · ${detail.travelCode}` : ""}</h3><p>{entries.length} positions · {nightLabel(z?.night)}</p></div><button className="icon-button" type="button" title="Fermer" aria-label="Fermer les positions à examiner" onClick={closeDetail}><X size={20} /></button></header>
      {detailStats && <dl className="diagnostic-detail-stats">
        <div><dt>Réceptionnées</dt><dd>{count(detailStats.receivedPositions)}</dd></div><div><dt>Hors délai</dt><dd>{count(detailStats.latePositions)}</dd></div><div><dt>Dans le délai</dt><dd>{count(detailStats.onTimePositions)}</dd></div><div><dt>Non vérifiables</dt><dd>{count(detailStats.unqualifiablePositions)}</dd></div><div><dt>Qualifiables</dt><dd>{count(detailStats.qualifiablePositions)}</dd></div><div><dt>Taux d'anomalie</dt><dd>{percent(detailStats.anomalyRate)}</dd></div><div><dt>Couverture</dt><dd>{percent(detailStats.coverageRate)}</dd></div>
      </dl>}
      <ul className="zonage-detail-list">{entries.map(entry => <li key={`${entry.travelCode}-${entry.position}`}><div><strong>{entry.position}</strong><span>Voyage {entry.travelCode || "—"}</span></div><div><b>{entry.classification === "hors_delai" ? "Hors délai" : "Non qualifiable"}</b>{entry.classification === "non_qualifiable" ? <QualificationReason reason={entry.reason} position={entry.position} /> : <span>{duration(entry.delaySeconds)}</span>}</div></li>)}</ul>
    </dialog>, document.body)}
  </section>;
}
