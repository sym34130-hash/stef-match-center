import { useState } from "react";
import { BarChart3, ShieldCheck } from "lucide-react";
import type { Snapshot } from "./types";
import { COMMON_SCORE_INDICATORS, SCORE_INDICATORS, eligibleScoreIndicatorIds, simulateScoreSelection, type ScoreActivityProfile, type ScoreIndicatorId } from "./score-simulator";
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
  const [profile, setProfile] = useState<ScoreActivityProfile>("with-zoning");
  const [selected, setSelected] = useState<ScoreIndicatorId[]>([...allKeys]);
  const eligible = eligibleScoreIndicatorIds(profile);
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
  const common = synchronized && official
    ? simulateScoreSelection(official.indicators, targetPercent, COMMON_SCORE_INDICATORS)
    : null;

  const choose = (id: ScoreIndicatorId, checked: boolean) => {
    setSelected((previous) => {
      if (!checked && previous.length === 1) return previous;
      return eligible.filter((key) =>
        key === id ? checked : previous.includes(key));
    });
  };

  const changeProfile = (next: ScoreActivityProfile) => {
    setProfile(next);
    setSelected(eligibleScoreIndicatorIds(next));
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

      <div className="score-simulator-profile">
        <label htmlFor="score-simulator-profile">Organisation de la plateforme (simulation)</label>
        <select id="score-simulator-profile" value={profile}
          onChange={(event) => changeProfile(event.target.value as ScoreActivityProfile)}>
          <option value="with-zoning">Avec activité de zonage</option>
          <option value="without-zoning">Sans activité de zonage</option>
        </select>
        <small>Profil d’essai non enregistré. L’absence structurelle de zonage ne doit pas être déduite d’une journée sans données.</small>
      </div>
      <div className="score-simulator-choices" role="group" aria-label="KPI à inclure dans la simulation">
        {SCORE_INDICATORS.map(({ id, label }) => {
          const checked = selected.includes(id);
          const applicable = eligible.includes(id);
          const value = applicable && synchronized ? official?.indicators[id] : null;
          return (
            <label className={"score-simulator-choice" + (!applicable ? " is-not-applicable" : "")} key={id}>
              <input type="checkbox" checked={checked}
                disabled={!applicable || (checked && selected.length === 1)}
                onChange={(event) => choose(id, event.target.checked)} />
              <span>{label}</span>
              <strong>{!applicable ? "Non applicable"
                : typeof value === "number" && Number.isFinite(value)
                  ? number.format(value) + " %" : "—"}</strong>
            </label>
          );
        })}
      </div>

      <div className="score-simulator-comparison" aria-live="polite">
        <div className="score-simulator-result">
          <span>Score officiel · 4 KPI</span>
          <strong>{synchronized ? officialValue : "Non synchronisé"}</strong>
          <small>{profile === "without-zoning"
            ? "Règles actuelles inchangées · score potentiellement inadapté sans zonage"
            : "Règles actuelles inchangées"}</small>
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
        <div className="score-simulator-result is-common">
          <span>Socle commun · Chargement + Réception</span>
          <strong>{common?.status === "available"
            ? String(common.reached) + " / 2" : "Indisponible"}</strong>
          <small>{common?.status === "available"
            ? String(common.ratioPercent) + " % des 2 KPI communs au-dessus de l’objectif"
            : !snapshot ? "Un match importé est nécessaire"
              : !synchronized ? "Synchroniser les objectifs de la ligue"
                : "Chargement ou réception non mesurable"}</small>
        </div>
      </div>
      <div className="score-simulator-actions">
        <button type="button" className="secondary-button compact"
          disabled={selected.length === eligible.length}
          onClick={() => setSelected([...eligible])}>Rétablir les KPI applicables</button>
      </div>
      <p className="score-simulator-disclaimer">
        Sans zonage, les « Passes réussies » et la « Possession » sont non applicables dans la simulation :
        elles ne sont pas comptées comme des échecs. Le socle Chargement / Réception donne un périmètre
        commun provisoire, à condition que les deux activités soient réellement exercées et mesurables.
        Ce diagnostic ne remplace pas le score officiel, ne détermine pas automatiquement le profil
        de l’agence et ne modifie ni les imports ni les classements.
      </p>
    </section>
  );
}
