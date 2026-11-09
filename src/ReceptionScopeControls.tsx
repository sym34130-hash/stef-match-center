import { useState } from "react";
import { EyeOff, RefreshCw } from "lucide-react";
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
  const total = scope.excludedTravels.length + scope.excludedClients.length;
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
      setFeedback(excluded ? "Exclusion enregistrée. Seuls les KPI de réception ont été recalculés." : "Voyage ou client réintégré aux KPI de réception.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "La modification n'a pas pu être enregistrée.");
    }
  }

  return (
    <details className="reception-scope-control" aria-label="Exclusions ciblées de réception">
      <summary>
        <EyeOff size={17} />
        <span>Gérer les exclusions réception</span>
        <strong>{total} exclusion{total > 1 ? "s" : ""}</strong>
      </summary>
      <div className="reception-scope-body">
        <p>Seuls les duels de réception et leur graphique horaire sont filtrés. Les volumes, les chargements, les passes, la possession et les joueurs restent inchangés. Le score peut évoluer si le taux de réception change.</p>
        {(scope.excludedByTravelCount > 0 || scope.excludedByClientCount > 0) && (
          <p className="reception-scope-count" role="status">
            {scope.excludedByTravelCount} voyage(s) exclus directement · {scope.excludedByClientCount} par client de tri
          </p>
        )}
        {scope.ambiguousClientTravels.length > 0 && (
          <p className="reception-scope-warning">Attribution client ambiguë pour {scope.ambiguousClientTravels.length} voyage(s) : ils restent dans les KPI afin de ne pas calculer un temps partiel.</p>
        )}
        {canEdit && (
          <div className="reception-scope-editors">
            <div className="reception-scope-editor">
              <strong>Voyage atypique</strong>
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
                  placeholder="Ex. Double déchargement, opération atypique" />
              </label>
              <button type="button" className="secondary-button compact" disabled={!travel || !travelReason.trim() || busy}
                onClick={() => void apply("travel", travel, true, travelReason)}>
                <EyeOff size={15} /> Exclure ce voyage de la réception
              </button>
            </div>
            <div className="reception-scope-editor">
              <strong>Client de tri</strong>
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
                          placeholder="Ex. Client de tri hors périmètre réception" />
                      </label>
                      <button type="button" className="secondary-button compact" disabled={!client || !clientReason.trim() || busy}
                        onClick={() => void apply("client", client, true, clientReason)}>
                        <EyeOff size={15} /> Exclure ce client de la réception
                      </button>
                    </>
                  ) : <p>Aucun autre client identifiable dans la plage active.</p>}
                </>
              ) : <p>La source Excel ne contient pas de colonne client exploitable. Aucun client n'est déduit d'une destination ou d'un segment.</p>}
            </div>
          </div>
        )}
        {(scope.excludedTravels.length > 0 || scope.excludedClients.length > 0) && (
          <div className="reception-scope-list" aria-label="Exclusions enregistrées">
            {[...scope.excludedTravels.map(item => ({ ...item, kind: "travel" as const })),
              ...scope.excludedClients.map(item => ({ ...item, kind: "client" as const }))].map(item => (
              <div className="reception-scope-exclusion" key={item.kind + ":" + item.code}>
                <div>
                  <strong>{item.kind === "travel" ? "Voyage" : "Client de tri"} : {item.code}</strong>
                  <small>Motif : {item.reason || "Non renseigné (ancienne sélection)"}</small>
                </div>
                {canEdit && <button type="button" className="secondary-button compact" disabled={busy}
                  onClick={() => void apply(item.kind, item.code, false)}>
                  <RefreshCw size={14} /> Réintégrer en réception
                </button>}
              </div>
            ))}
          </div>
        )}
        {feedback && <p className="reception-scope-feedback" role="status">{feedback}</p>}
      </div>
    </details>
  );
}
