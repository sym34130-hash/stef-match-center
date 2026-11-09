import { useState } from "react";
import { CheckCircle2, ChevronDown, EyeOff, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import type { Snapshot } from "./types";

export type ReceptionExclusionKind = "travel" | "client";
export type ReceptionExclusionChange = (
  kind: ReceptionExclusionKind, code: string, excluded: boolean, reason: string
) => Promise<void>;

type Props = {
  scope: Snapshot["receptionScope"];
  canEdit: boolean;
  pending: string | null;
  onChange: ReceptionExclusionChange;
};

function formatExclusionDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris",
  }).format(new Date(value));
}

export function ReceptionScopeControls({ scope, canEdit, pending, onChange }: Props) {
  const [travel, setTravel] = useState("");
  const [client, setClient] = useState("");
  const [travelReason, setTravelReason] = useState("");
  const [clientReason, setClientReason] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  if (!scope) return null;

  const excludedTravels = new Set(scope.excludedTravels.map(item => item.code));
  const excludedClients = new Set(scope.excludedClients.map(item => item.code.normalize("NFKC").toLocaleUpperCase("fr-FR")));
  const availableTravels = scope.availableTravels.filter(code => !excludedTravels.has(code));
  const availableClients = scope.availableClients.filter(item =>
    !excludedClients.has(item.code.normalize("NFKC").toLocaleUpperCase("fr-FR")));
  const activeEntries = [
    ...scope.excludedTravels.map(item => ({ ...item, kind: "travel" as const })),
    ...scope.excludedClients.map(item => ({ ...item, kind: "client" as const })),
  ];
  const total = activeEntries.length;
  const effectiveTravels = scope.excludedByTravelCount + scope.excludedByClientCount;
  const busy = pending !== null;

  async function apply(kind: ReceptionExclusionKind, code: string, excluded: boolean, reason = "") {
    if (busy || !canEdit || !code || (excluded && !reason.trim())) return;
    setFeedback(null);
    try {
      await onChange(kind, code, excluded, reason.trim());
      if (kind === "travel") {
        setTravel("");
        setTravelReason("");
      } else {
        setClient("");
        setClientReason("");
      }
      setFeedback(excluded ? "Exclusion enregistrée et KPI de réception actualisés." : "Exclusion retirée et KPI de réception actualisés.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "La modification n'a pas pu être enregistrée.");
    }
  }

  return (
    <section className="reception-scope-control" aria-label="Exclusions ciblées de réception">
      <div className="reception-scope-current" aria-label="Exclusions actives">
        <div className="reception-scope-current-header">
          <div className="reception-scope-title">
            <EyeOff size={20} aria-hidden="true" />
            <div>
              <h3>Exclusions actives</h3>
              <p>Voyages et clients retirés des statistiques de réception</p>
            </div>
          </div>
          <strong className="reception-scope-total" aria-live="polite">
            {total} exclusion{total > 1 ? "s" : ""}
          </strong>
        </div>

        {total === 0 ? (
          <p className="reception-scope-empty">
            <CheckCircle2 size={18} aria-hidden="true" />
            Aucune exclusion active sur ce match.
          </p>
        ) : (
          <>
            <p className="reception-scope-impact" role="status">
              {effectiveTravels} voyage{effectiveTravels > 1 ? "s" : ""} effectivement retiré{effectiveTravels > 1 ? "s" : ""} du calcul de réception.
            </p>
            <ul className="reception-scope-list">
              {activeEntries.map(item => {
                const date = formatExclusionDate(item.updatedAt);
                const isKnown = item.kind === "travel"
                  ? scope.availableTravels.includes(item.code)
                  : scope.availableClients.some(clientItem => clientItem.code.normalize("NFKC").toLocaleUpperCase("fr-FR") === item.code.normalize("NFKC").toLocaleUpperCase("fr-FR"));
                return (
                  <li className="reception-scope-exclusion" key={item.kind + ":" + item.code}>
                    <div className="reception-scope-exclusion-info">
                      <span className="reception-scope-type">{item.kind === "travel" ? "Voyage" : "Client de tri"}</span>
                      <strong className="reception-scope-code">{item.code}</strong>
                      <p className="reception-scope-reason"><span>Motif :</span> {item.reason || "Non renseigné (ancienne sélection)"}</p>
                      {date && <small>Exclu le {date}</small>}
                      {!isKnown && <small className="reception-scope-warning-text">Absent de la période active : sans impact sur les KPI actuels.</small>}
                    </div>
                    {canEdit && (
                      <button type="button" className="reception-scope-restore" disabled={busy}
                        aria-label={`Réintégrer ${item.kind === "travel" ? "le voyage" : "le client"} ${item.code} en réception`}
                        onClick={() => void apply(item.kind, item.code, false)}>
                        <RefreshCw size={15} aria-hidden="true" /> Réintégrer
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {scope.ambiguousClientTravels.length > 0 && (
          <p className="reception-scope-warning">
            <TriangleAlert size={18} aria-hidden="true" />
            Attribution client ambiguë pour {scope.ambiguousClientTravels.length} voyage(s) : ils restent dans les KPI pour éviter un calcul partiel.
          </p>
        )}
        {feedback && <p className="reception-scope-feedback" role="status">{feedback}</p>}
      </div>

      {canEdit && (
        <details className="reception-scope-add">
          <summary><Plus size={18} aria-hidden="true" /><span>Ajouter une exclusion</span><ChevronDown size={18} aria-hidden="true" className="reception-scope-chevron" /></summary>
          <div className="reception-scope-body">
            <p className="reception-scope-explanation">
              Une exclusion modifie uniquement les duels de réception et leur graphique horaire. Les opérations, joueurs, chargements, passes et possession restent inchangés.
            </p>
            <div className="reception-scope-editors">
              <div className="reception-scope-editor">
                <strong>Exclure un voyage atypique</strong>
                <label>
                  Voyage concerné
                  <select value={availableTravels.includes(travel) ? travel : ""} onChange={event => setTravel(event.target.value)} disabled={busy || !availableTravels.length}>
                    <option value="">Sélectionner un voyage</option>
                    {availableTravels.map(code => <option key={code} value={code}>{code}</option>)}
                  </select>
                </label>
                <label>
                  Motif de l'exclusion
                  <input value={travelReason} onChange={event => setTravelReason(event.target.value)} disabled={busy} maxLength={240}
                    placeholder="Ex. Double déchargement" />
                </label>
                <button type="button" className="secondary-button compact reception-scope-exclude" disabled={!travel || !travelReason.trim() || busy}
                  onClick={() => void apply("travel", travel, true, travelReason)}>
                  <EyeOff size={15} aria-hidden="true" /> Exclure ce voyage de la réception
                </button>
              </div>
              <div className="reception-scope-editor">
                <strong>Exclure un client de tri</strong>
                {scope.clientColumnPresent ? (
                  <>
                    {availableClients.length ? (
                      <>
                        <label>
                          Client identifié dans l'Excel
                          <select value={availableClients.some(item => item.code === client) ? client : ""} onChange={event => setClient(event.target.value)} disabled={busy}>
                            <option value="">Sélectionner un client</option>
                            {availableClients.map(item => <option key={item.code} value={item.code}>{item.code} · {item.travels} voyage(s)</option>)}
                          </select>
                        </label>
                        <label>
                          Motif de l'exclusion
                          <input value={clientReason} onChange={event => setClientReason(event.target.value)} disabled={busy} maxLength={240}
                            placeholder="Ex. Client de tri hors périmètre" />
                        </label>
                        <button type="button" className="secondary-button compact reception-scope-exclude" disabled={!client || !clientReason.trim() || busy}
                          onClick={() => void apply("client", client, true, clientReason)}>
                          <EyeOff size={15} aria-hidden="true" /> Exclure ce client de la réception
                        </button>
                      </>
                    ) : <p>Aucun autre client identifiable dans la plage active.</p>}
                  </>
                ) : <p>Le fichier Excel n'identifie pas les clients de tri. Tu peux néanmoins exclure un voyage directement.</p>}
              </div>
            </div>
          </div>
        </details>
      )}
    </section>
  );
}
