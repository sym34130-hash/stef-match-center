import { useState, type FormEvent } from "react";
import { CheckCircle2, ChevronDown, EyeOff, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import type { Snapshot } from "./types";

export type ReceptionExclusionKind = "travel" | "client";
export type ReceptionExclusionChange = (
  kind: ReceptionExclusionKind, code: string, excluded: boolean, reason: string
) => Promise<void>;
export type LoadingExclusionChange = (code: string, excluded: boolean, reason: string) => Promise<void>;

type Props = {
  scope: Snapshot["receptionScope"];
  loadingScope: Snapshot["loadingScope"];
  canEdit: boolean;
  pending: string | null;
  pendingLoading: string | null;
  onChange: ReceptionExclusionChange;
  onLoadingChange: LoadingExclusionChange;
};

type ExclusionEntry = { code: string; reason: string; updatedAt: string | null; kind: "travel" | "client" | "loading" };

function expandReasonField(event: FormEvent<HTMLTextAreaElement>) {
  const field = event.currentTarget;
  field.style.height = "auto";
  // Reasons wrap while typing; cap excessive growth without hiding the text.
  field.style.height = `${field.scrollHeight + 2}px`;
}

function formatExclusionDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris",
  }).format(new Date(value));
}

export function ReceptionScopeControls({ scope, loadingScope, canEdit, pending, pendingLoading, onChange, onLoadingChange }: Props) {
  const [activity, setActivity] = useState<"loading" | "reception">("reception");
  const [travel, setTravel] = useState("");
  const [client, setClient] = useState("");
  const [loadingTravel, setLoadingTravel] = useState("");
  const [travelReason, setTravelReason] = useState("");
  const [clientReason, setClientReason] = useState("");
  const [loadingReason, setLoadingReason] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  if (!scope && !loadingScope) return null;

  const reception: NonNullable<Snapshot["receptionScope"]> = scope ?? {
    version: 1,
    excludedTravels: [], excludedClients: [], availableTravels: [], availableClients: [],
    clientColumnPresent: false, excludedByTravelCount: 0, excludedByClientCount: 0, ambiguousClientTravels: [],
  };
  const loading: NonNullable<Snapshot["loadingScope"]> = loadingScope ?? { excludedTravels: [], availableTravels: [], effectiveExcluded: 0 };
  const excludedTravels = new Set(reception.excludedTravels.map(item => item.code));
  const excludedClients = new Set(reception.excludedClients.map(item => item.code.normalize("NFKC").toLocaleUpperCase("fr-FR")));
  const availableTravels = reception.availableTravels.filter(code => !excludedTravels.has(code));
  const availableClients = reception.availableClients.filter(item =>
    !excludedClients.has(item.code.normalize("NFKC").toLocaleUpperCase("fr-FR")));
  const excludedLoading = new Set(loading.excludedTravels.map(item => item.code));
  const availableLoading = loading.availableTravels.filter(code => !excludedLoading.has(code));
  const receptionEntries: ExclusionEntry[] = [
    ...reception.excludedTravels.map(item => ({ ...item, kind: "travel" as const })),
    ...reception.excludedClients.map(item => ({ ...item, kind: "client" as const })),
  ];
  const loadingEntries: ExclusionEntry[] = loading.excludedTravels.map(item => ({ ...item, kind: "loading" as const }));
  const activeEntries = activity === "loading" ? loadingEntries : receptionEntries;
  const total = receptionEntries.length + loadingEntries.length;
  const effectiveTravels = activity === "loading"
    ? loading.effectiveExcluded
    : reception.excludedByTravelCount + reception.excludedByClientCount;
  const busy = pending !== null || pendingLoading !== null;

  async function applyReception(kind: ReceptionExclusionKind, code: string, excluded: boolean, reason = "") {
    if (busy || !canEdit || !code || (excluded && !reason.trim())) return;
    setFeedback(null);
    try {
      await onChange(kind, code, excluded, reason.trim());
      if (kind === "travel") { setTravel(""); setTravelReason(""); }
      else { setClient(""); setClientReason(""); }
      setFeedback(excluded ? "Exclusion réception enregistrée." : "Voyage ou client réintégré en réception.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "La modification réception a échoué.");
    }
  }

  async function applyLoading(code: string, excluded: boolean, reason = "") {
    if (busy || !canEdit || !code || (excluded && !reason.trim())) return;
    setFeedback(null);
    try {
      await onLoadingChange(code, excluded, reason.trim());
      setLoadingTravel("");
      setLoadingReason("");
      setFeedback(excluded ? "Exclusion chargement enregistrée." : "Voyage réintégré en chargement.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "La modification chargement a échoué.");
    }
  }

  function selectActivity(next: "loading" | "reception") {
    if (busy) return;
    setActivity(next);
    setFeedback(null);
  }

  return (
    <details className="reception-scope-control" aria-label="Gestion des exclusions par activité">
      <summary className="reception-scope-collapse-summary">
        <span className="reception-scope-collapse-title"><EyeOff size={17} aria-hidden="true" /> Gestion des exclusions</span>
        <span className="reception-scope-collapse-count">{total} exclusion{total > 1 ? "s" : ""} active{total > 1 ? "s" : ""}</span>
        <ChevronDown size={18} aria-hidden="true" className="reception-scope-collapse-chevron" />
      </summary>
      <div className="reception-scope-expanded">
        <div className="reception-scope-tabs" role="tablist" aria-label="Activité à personnaliser">
          <button type="button" role="tab" aria-selected={activity === "reception"} disabled={busy}
            onClick={() => selectActivity("reception")}>
            Réception <span>{receptionEntries.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={activity === "loading"} disabled={busy}
            onClick={() => selectActivity("loading")}>
            Chargement <span>{loadingEntries.length}</span>
          </button>
        </div>
        {canEdit && (
          <details className="reception-scope-add" key={activity}>
            <summary><Plus size={18} aria-hidden="true" /><span>Ajouter une exclusion</span><ChevronDown size={18} aria-hidden="true" className="reception-scope-chevron" /></summary>
            <div className="reception-scope-body">
              <p className="reception-scope-explanation">
                {activity === "reception"
                  ? "Cette exclusion agit seulement sur les duels de réception et le graphique horaire. Les opérations, joueurs, chargements, passes et possession restent inchangés."
                  : "Cette exclusion agit seulement sur les chargements TCD et le taux de tirs cadrés. Les opérations, joueurs, réception, passes et possession restent inchangés."}
              </p>
              {activity === "loading" ? (
                <div className="reception-scope-editor">
                  <strong>Exclure un voyage CHG</strong>
                  <label>
                    Voyage concerné
                    <select value={availableLoading.includes(loadingTravel) ? loadingTravel : ""} onChange={event => setLoadingTravel(event.target.value)}
                      disabled={busy || !availableLoading.length}>
                      <option value="">Sélectionner un voyage CHG</option>
                      {availableLoading.map(code => <option key={code} value={code}>{code}</option>)}
                    </select>
                  </label>
                  <label>
                    Motif de l'exclusion
                    <textarea value={loadingReason} onChange={event => setLoadingReason(event.target.value)} disabled={busy} maxLength={240} rows={3} onInput={expandReasonField}
                      placeholder="Ex. Chargement exceptionnel" />
                  </label>
                  <button type="button" className="secondary-button compact reception-scope-exclude"
                    disabled={!loadingTravel || !loadingReason.trim() || busy}
                    onClick={() => void applyLoading(loadingTravel, true, loadingReason)}>
                    <EyeOff size={15} aria-hidden="true" /> Exclure ce voyage du chargement
                  </button>
                </div>
              ) : (
                <div className="reception-scope-editors">
                  <div className="reception-scope-editor">
                    <strong>Exclure un voyage de réception</strong>
                    <label>
                      Voyage concerné
                      <select value={availableTravels.includes(travel) ? travel : ""} onChange={event => setTravel(event.target.value)}
                        disabled={busy || !availableTravels.length}>
                        <option value="">Sélectionner un voyage</option>
                        {availableTravels.map(code => <option key={code} value={code}>{code}</option>)}
                      </select>
                    </label>
                    <label>
                      Motif de l'exclusion
                      <textarea value={travelReason} onChange={event => setTravelReason(event.target.value)} disabled={busy} maxLength={240} rows={3} onInput={expandReasonField}
                        placeholder="Ex. Double déchargement" />
                    </label>
                    <button type="button" className="secondary-button compact reception-scope-exclude"
                      disabled={!travel || !travelReason.trim() || busy} onClick={() => void applyReception("travel", travel, true, travelReason)}>
                      <EyeOff size={15} aria-hidden="true" /> Exclure ce voyage de la réception
                    </button>
                  </div>
                  <div className="reception-scope-editor">
                    <strong>Exclure un client de tri</strong>
                    {reception.clientColumnPresent ? availableClients.length ? (
                      <>
                        <label>
                          Client identifié dans l'Excel
                          <select value={availableClients.some(item => item.code === client) ? client : ""}
                            onChange={event => setClient(event.target.value)} disabled={busy}>
                            <option value="">Sélectionner un client</option>
                            {availableClients.map(item => <option key={item.code} value={item.code}>{item.code} · {item.travels} voyage(s)</option>)}
                          </select>
                        </label>
                        <label>
                          Motif de l'exclusion
                          <textarea value={clientReason} onChange={event => setClientReason(event.target.value)} disabled={busy} maxLength={240} rows={3} onInput={expandReasonField}
                            placeholder="Ex. Client de tri hors périmètre" />
                        </label>
                        <button type="button" className="secondary-button compact reception-scope-exclude"
                          disabled={!client || !clientReason.trim() || busy} onClick={() => void applyReception("client", client, true, clientReason)}>
                          <EyeOff size={15} aria-hidden="true" /> Exclure ce client de la réception
                        </button>
                      </>
                    ) : <p>Aucun autre client identifiable dans la plage active.</p>
                      : <p>L'Excel n'identifie pas les clients de tri. Tu peux exclure un voyage directement.</p>}
                  </div>
                </div>
              )}
            </div>
          </details>
        )}

        <div className="reception-scope-current" aria-label="Exclusions actives">
          <div className="reception-scope-current-header">
            <div className="reception-scope-title">
              <EyeOff size={20} aria-hidden="true" />
              <div>
                <h3>Exclusions actives — {activity === "loading" ? "Chargement" : "Réception"}</h3>
                <p>Voyages {activity === "loading" ? "CHG" : "et clients de tri"} exclus de ce seul indicateur.</p>
              </div>
            </div>
            <strong className="reception-scope-total" aria-live="polite">
              {activeEntries.length} exclusion{activeEntries.length > 1 ? "s" : ""}
            </strong>
          </div>
          {activeEntries.length === 0 ? (
            <p className="reception-scope-empty"><CheckCircle2 size={18} aria-hidden="true" /> Aucune exclusion active sur ce match.</p>
          ) : (
            <>
              <p className="reception-scope-impact" role="status">
                {effectiveTravels} voyage{effectiveTravels > 1 ? "s" : ""} effectivement retiré{effectiveTravels > 1 ? "s" : ""} du calcul {activity === "loading" ? "de chargement" : "de réception"}.
              </p>
              <ul className="reception-scope-list">
                {activeEntries.map(item => {
                  const date = formatExclusionDate(item.updatedAt);
                  const isKnown = item.kind === "loading"
                    ? loading.availableTravels.includes(item.code)
                    : item.kind === "travel"
                      ? reception.availableTravels.includes(item.code)
                      : reception.availableClients.some(clientItem => clientItem.code.normalize("NFKC").toLocaleUpperCase("fr-FR") === item.code.normalize("NFKC").toLocaleUpperCase("fr-FR"));
                  const restoreLabel = item.kind === "loading"
                    ? `Réintégrer le voyage ${item.code} en chargement`
                    : `Réintégrer ${item.kind === "travel" ? "le voyage" : "le client"} ${item.code} en réception`;
                  return (
                    <li className="reception-scope-exclusion" key={item.kind + ":" + item.code}>
                      <div className="reception-scope-exclusion-info">
                        <span className="reception-scope-type">{item.kind === "client" ? "Client de tri" : item.kind === "loading" ? "Voyage CHG" : "Voyage"}</span>
                        <strong className="reception-scope-code">{item.code}</strong>
                        <p className="reception-scope-reason"><span>Motif :</span> {item.reason || "Non renseigné (ancienne sélection)"}</p>
                        {date && <small>Exclu le {date}</small>}
                        {!isKnown && <small className="reception-scope-warning-text">Absent de la période active : sans impact sur les KPI actuels.</small>}
                      </div>
                      {canEdit && (
                        <button type="button" className="reception-scope-restore" disabled={busy}
                          aria-label={restoreLabel}
                          onClick={() => item.kind === "loading"
                            ? void applyLoading(item.code, false)
                            : void applyReception(item.kind, item.code, false)}>
                          <RefreshCw size={15} aria-hidden="true" /> Réintégrer
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {activity === "reception" && reception.ambiguousClientTravels.length > 0 && (
            <p className="reception-scope-warning">
              <TriangleAlert size={18} aria-hidden="true" />
              Attribution client ambiguë pour {reception.ambiguousClientTravels.length} voyage(s) : ils restent dans les KPI.
            </p>
          )}
          {feedback && <p className="reception-scope-feedback" role="status">{feedback}</p>}
        </div>
      </div>
    </details>
  );
}
