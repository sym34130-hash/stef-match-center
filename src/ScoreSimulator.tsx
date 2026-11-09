import { useState } from "react";
import { BarChart3, ShieldCheck } from "lucide-react";
import type { Snapshot } from "./types";
import { SCORE_INDICATORS, simulateScoreSelection, type ScoreIndicatorId } from "./score-simulator";
import "./score-simulator.css";

type Props = {
  snapshot: Snapshot | null;
  leagueName: string;
  targetPercent: number;
  criteria: {
    zonageMinutes: number;
    loadingSeconds: number;
    unloadingSeconds: number;
    scoreTargetPercent: number;
  };
};

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const allKeys = SCORE_INDICATORS.map((indicator) => indicator.id);

export function ScoreSimulator({ snapshot, leagueName, targetPercent, criteria }: Props) {
  const [selected, setSelected] = useState<ScoreIndicatorId[]>([...allKeys]);
  const current = snapshot?.performanceCriteria;
  const official = snapshot?.operationalScore;
  const synchronized = Boolean(snapshot && official && current
    && current.zonageMinutes === criteria.zonageMinutes
    && current.loadingSeconds === criteria.loadingSeconds
    && current.unloadingSeconds === criteria.unloadingSeconds
    && current.scoreTargetPercent === targetPercent
    && official.targetPercent === targetPercent);
  const simulation = synchronized && official
    ? simulateScoreSelection(official.indicators, targetPercent, selected)
    : null;

  const choose = (id: ScoreIndicatorId, checked: boolean) => {
    setSelected((previous) => {
      if (!checked && previous.length === 1) return previous;
      return SCORE_INDICATORS.map((item) => item.id).filter((key) =>
        key === id ? checked : previous.includes(key));
    });
  };

  const officialValue = official?.status === "available"
    && Number.isInteger(official.goalsFor) && Number.isInteger(official.goalsAgainst)
    ? String(official.goalsFor) + " – " + String(official.goalsAgainst)
    : "Indisponible";

  return (
    <section className="score-simulator" aria-labelledby="score-simulator-title">
      <div className="score-simulator-heading">
        <div>
          <span className="eyebrow">LOT D · Diagnostic</span>
          <h3 id="score-simulator-title"><BarChart3 size={20} /> Simuler les KPI du score</h3>
          <p>Teste le rôle de chaque indicateur dans le résultat, sans modifier les buts ni les paramètres officiels de l'agence.</p>
        </div>
        <span className="score-simulator-mode"><ShieldCheck size={15} /> Simulation uniquement</span>
      </div>

      <p className="score-simulator-context">
        Ligue : <strong>{leagueName}</strong> · Seuil commun : <strong>{number.format(targetPercent)} %</strong> ·
        Objectif atteint seulement si le KPI est strictement supérieur au seuil.
      </p>

      <div className="score-simulator-choices" role="group" aria-label="KPI à inclure dans la simulation">
        {SCORE_INDICATORS.map(({ id, label }) => {
          const checked = selected.includes(id);
          const value = synchronized ? official?.indicators[id] : null;
          return (
            <label className="score-simulator-choice" key={id}>
              <input type="checkbox" checked={checked}
                disabled={checked && selected.length === 1}
                onChange={(event) => choose(id, event.target.checked)} />
              <span>{label}</span>
              <strong>{typeof value === "number" && Number.isFinite(value)
                ? number.format(value) + " %" : "—"}</strong>
            </label>
          );
        })}
      </div>

      <div className="score-simulator-comparison" aria-live="polite">
        <div className="score-simulator-result">
          <span>Score officiel · 4 KPI</span>
          <strong>{synchronized ? officialValue : "Non synchronisé"}</strong>
          <small>Règles actuelles inchangées</small>
        </div>
        <div className="score-simulator-result is-preview">
          <span>Simulation · {selected.length} KPI sélectionné{selected.length > 1 ? "s" : ""}</span>
          <strong>{simulation?.status === "available"
            ? String(simulation.reached) + " / " + String(simulation.selected.length) : "Indisponible"}</strong>
          <small>{simulation?.status === "available"
            ? String(simulation.ratioPercent) + " % des KPI sélectionnés au-dessus de l'objectif"
            : !snapshot ? "Un match importé est nécessaire"
              : !synchronized ? "Actualiser le match avec les seuils de la ligue active"
                : "Donnée manquante sur un KPI sélectionné"}</small>
        </div>
      </div>
      <div className="score-simulator-actions">
        <button type="button" className="secondary-button compact"
          disabled={selected.length === allKeys.length}
          onClick={() => setSelected([...allKeys])}>Rétablir les 4 KPI</button>
      </div>
      <p className="score-simulator-disclaimer">
        Ce scénario sert uniquement à analyser les arbitrages. Un score calculé avec moins de quatre KPI
        n'est pas directement comparable au score officiel d'une autre plateforme. Aucune préférence
        de simulation n'est enregistrée, et aucun import ou classement n'est modifié.
      </p>
    </section>
  );
}
