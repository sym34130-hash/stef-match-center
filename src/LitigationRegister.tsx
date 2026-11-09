import { useEffect, useState, type FormEvent } from "react";
import { ClipboardList, FilePenLine } from "lucide-react";
import type { Agency } from "./types";
import "./litigation-register.css";

type Session = { agency: Agency; accessCode: string };
type Litigation = {
  reference: string;
  travelCode: string;
  description: string;
  openedAt: string;
  status: "open" | "closed";
  closedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
};
type LitigationState = {
  sourceAvailable: boolean;
  source: "saisie_manuelle_agence";
  revision: string | null;
  editable: boolean;
  asOfDate: string;
  records: Litigation[];
  totals: { total: number; open: number; closed: number } | null;
  history: Array<{ reference: string; changedAt: string; reason: string }>;
};
const blank = (date = ""): Litigation => ({
  reference: "", travelCode: "", description: "", openedAt: date, status: "open", closedAt: null,
});
const dateLabel = (value: string | null) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : "—";

export function LitigationRegister({ session }: { session: Session }) {
  const [state, setState] = useState<LitigationState | null>(null);
  const [draft, setDraft] = useState<Litigation>(blank);
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const [editingReference, setEditingReference] = useState<string | null>(null);
  const [changeReason, setChangeReason] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const url = `/api/agencies/${encodeURIComponent(session.agency.code)}/litigations`;

  useEffect(() => {
    let disposed = false;
    setState(null); setFormOpen(false); setLoading(true); setError(null); setNotice(null);
    const load = async () => {
      try {
        const response = await fetch(url, { cache: "no-store", headers: { "x-access-code": session.accessCode } });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "Lecture du registre impossible.");
        if (!disposed) { setState(body as LitigationState); setError(null); }
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : "Lecture du registre impossible.");
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", visible);
    };
  }, [url, session.accessCode]);

  function startNew() {
    if (!state?.editable) return;
    setDraft(blank(state.asOfDate)); setDraftRevision(state.revision);
    setEditingReference(null); setChangeReason(""); setNotice(null); setError(null); setFormOpen(true);
  }

  function startEdit(item: Litigation) {
    if (!state?.editable) return;
    setDraft(item); setDraftRevision(state.revision); setEditingReference(item.reference);
    setChangeReason(""); setNotice(null); setError(null); setFormOpen(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state?.editable || saving) return;
    setSaving(true); setNotice(null); setError(null);
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-access-code": session.accessCode },
        body: JSON.stringify({ expectedRevision: draftRevision, record: draft, changeReason }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          setState(payload as LitigationState);
          throw new Error("Registre modifié ailleurs : vérifie les données et rouvre le formulaire avant de réessayer.");
        }
        throw new Error(payload.message ?? "Le litige n'a pas pu être enregistré.");
      }
      setState(payload as LitigationState);
      setFormOpen(false);
      setEditingReference(null);
      setDraft(blank(payload.asOfDate));
      setNotice("Le registre de cette agence a été actualisé.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="litigation-register" aria-label="Suivi des litiges">
      <header className="litigation-heading">
        <div className="litigation-heading-name">
          <ClipboardList size={22} aria-hidden="true" />
          <div><h3>Suivi des litiges</h3><p>Registre manuel de l'agence · indépendant des KPI du match</p></div>
        </div>
        {state?.totals ? (
          <div className="litigation-stats" aria-label="Répartition des litiges enregistrés">
            <span><b>{state.totals.open}</b> ouvert(s)</span>
            <span><b>{state.totals.closed}</b> clôturé(s)</span>
            <span><b>{state.totals.total}</b> enregistré(s)</span>
          </div>
        ) : <strong className="litigation-unavailable">Registre à initialiser</strong>}
      </header>
      {loading && <p>Chargement du registre…</p>}
      {!loading && !error && !state?.sourceAvailable && (
        <p className="litigation-hint">Aucune source de litiges n'est encore enregistrée pour cette agence. Aucun total n'est déduit des fichiers Excel ou PDF.</p>
      )}
      {error && <p className="litigation-error" role="alert">{error}</p>}
      {notice && <p className="litigation-success" role="status">{notice}</p>}
      {state?.editable && (
        <button className="litigation-add" type="button" onClick={startNew}>Ajouter un litige</button>
      )}
      {session.agency.canImport && state && !state.editable && (
        <p className="litigation-hint">L'écriture est désactivée tant que la conservation durable des données n'est pas activée.</p>
      )}

      {formOpen && state?.editable && (
        <form className="litigation-form" onSubmit={save}>
          <div className="litigation-form-title"><FilePenLine size={17} /> {editingReference ? `Modifier ${editingReference}` : "Nouveau litige"}</div>
          <label>Référence du litige
            <input required minLength={3} maxLength={60} pattern="[A-Za-z0-9][A-Za-z0-9 _./-]{2,59}"
              readOnly={Boolean(editingReference)} value={draft.reference}
              onChange={event => setDraft({ ...draft, reference: event.target.value })} placeholder="Ex. LIT-2026-001" />
          </label>
          <label>Code voyage (facultatif)
            <input maxLength={80} value={draft.travelCode}
              onChange={event => setDraft({ ...draft, travelCode: event.target.value })} />
          </label>
          <label>Date d'ouverture
            <input required type="date" min="1900-01-01" max={state.asOfDate} value={draft.openedAt}
              onChange={event => setDraft({ ...draft, openedAt: event.target.value })} />
          </label>
          <label>Statut
            <select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as Litigation["status"], closedAt: null })}>
              <option value="open">Ouvert</option><option value="closed">Clôturé</option>
            </select>
          </label>
          {draft.status === "closed" && (
            <label>Date de clôture
              <input required type="date" min={draft.openedAt} max={state.asOfDate}
                value={draft.closedAt ?? ""} onChange={event => setDraft({ ...draft, closedAt: event.target.value })} />
            </label>
          )}
          <label className="litigation-full">Motif du litige
            <input required minLength={5} maxLength={240} value={draft.description}
              onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="Décrire le motif opérationnel sans donnée personnelle" />
          </label>
          {editingReference && (
            <label className="litigation-full">Motif de la modification
              <input required minLength={5} maxLength={240} value={changeReason}
                onChange={event => setChangeReason(event.target.value)} />
            </label>
          )}
          <div className="litigation-form-actions">
            <button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
            <button type="button" onClick={() => setFormOpen(false)}>Annuler</button>
          </div>
        </form>
      )}

      {state?.records.length ? (
        <details className="litigation-records">
          <summary>Consulter les litiges enregistrés ({state.records.length})</summary>
          <div className="litigation-table-wrap">
          <table className="litigation-table"><thead><tr>
            <th>Référence</th><th>Voyage</th><th>Ouverture</th><th>Motif</th><th>Statut</th><th>Action</th>
          </tr></thead><tbody>
            {state.records.slice(0, 100).map(item => (
              <tr key={item.reference}>
                <td><strong>{item.reference}</strong></td>
                <td>{item.travelCode || "—"}</td>
                <td>{dateLabel(item.openedAt)}</td>
                <td>{item.description}</td>
                <td>{item.status === "open" ? "Ouvert" : `Clôturé · ${dateLabel(item.closedAt)}`}</td>
                <td>{state.editable ? <button type="button" onClick={() => startEdit(item)}>Modifier</button> : "—"}</td>
              </tr>
            ))}
          </tbody></table>
          {state.records.length > 100 && <p>Affichage limité aux 100 derniers litiges sur {state.records.length} entrées.</p>}
          </div>
        </details>
      ) : state?.sourceAvailable && <p className="litigation-hint">Aucun litige enregistré manuellement.</p>}
      {state?.history?.length ? (
        <details className="litigation-history"><summary>Historique des modifications ({state.history.length})</summary>
          <ul>{[...state.history].reverse().slice(0, 30).map((item, index) => (
            <li key={`${item.changedAt}-${index}`}><strong>{item.reference}</strong> · {item.reason}
              <small>{new Date(item.changedAt).toLocaleString("fr-FR")}</small></li>
          ))}</ul>
        </details>
      ) : null}
    </section>
  );
}
