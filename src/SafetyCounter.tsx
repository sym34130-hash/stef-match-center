import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import type { Agency } from "./types";
import "./safety-counter.css";

type Session = { agency: Agency; accessCode: string };
type SafetyHistory = {
  previousDate: string | null;
  newDate: string;
  changedAt: string;
  reason: string;
};
type SafetyState = {
  lastAccidentDate: string | null;
  updatedAt: string | null;
  revision: string | null;
  asOfDate: string;
  editable: boolean;
  counter: { status: "available" | "unavailable"; days: number | null; reason: string | null };
  history: SafetyHistory[];
};

function dateLabel(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Non renseignée";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function SafetyCounter({ session }: { session: Session }) {
  const [state, setState] = useState<SafetyState | null>(null);
  const [draftDate, setDraftDate] = useState("");
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState(false);

  const url = `/api/agencies/${encodeURIComponent(session.agency.code)}/safety`;

  useEffect(() => {
    let disposed = false;
    setState(null);
    setLoading(true);
    setError(null);
    setNotice(null);
    setDraftDate("");
    setDraftRevision(null);
    setReason("");
    setEditingDate(false);

    const load = async (resetDraft = false) => {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          headers: { "x-access-code": session.accessCode },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message ?? "La sécurité de l'agence est indisponible.");
        if (disposed) return;
        const next = payload as SafetyState;
        setState(next);
        if (resetDraft) { setDraftDate(next.lastAccidentDate ?? ""); setDraftRevision(next.revision); }
        setError(null);
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : "Lecture impossible.");
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void load(true);
    // Keep the agency-wide value in sync across readers and after midnight
    // in Europe/Paris (server controls the reference date).
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, session.accessCode]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || !state.editable || saving) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-access-code": session.accessCode },
        body: JSON.stringify({ lastAccidentDate: draftDate, reason, expectedRevision: draftRevision }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          setState(payload as SafetyState);
          throw new Error("Cette date a été modifiée par un autre responsable. Vérifie la valeur actuelle avant de réenregistrer.");
        }
        throw new Error(payload.message ?? "La date n'a pas pu être enregistrée.");
      }
      setState(payload as SafetyState);
      setDraftDate(payload.lastAccidentDate ?? "");
      setDraftRevision(payload.revision);
      setReason("");
      setNotice("Date enregistrée.");
      setEditingDate(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const days = !error && state?.counter.status === "available" ? state.counter.days : null;
  const needsCorrectionReason = Boolean(state?.lastAccidentDate && draftDate && draftDate !== state.lastAccidentDate);
  const canSave = Boolean(state?.editable && draftDate && draftDate <= (state?.asOfDate ?? "")
    && draftDate !== state?.lastAccidentDate && (!needsCorrectionReason || reason.trim().length >= 5));
  const canEditDate = Boolean(state?.editable && session.agency.canImport);
  const showDateForm = canEditDate && (!state?.lastAccidentDate || editingDate);
  return (
    <article className="match-indicator-card is-safety" style={{ "--indicator-accent": "#a6e6c4" } as CSSProperties}
      aria-label="Jours sans accident du travail">
      <div className="match-indicator-title">
        <ShieldCheck size={21} aria-hidden="true" />
        <h3>Jours sans accident du travail</h3>
      </div>
      <div className="match-indicator-body safety-card-body" aria-live="polite">
        <strong className={`match-indicator-value${days === null ? " is-empty" : ""}`}>
          {loading ? "Chargement…" : days === null ? "À renseigner" : days.toLocaleString("fr-FR")}
        </strong>
        {days !== null && <span className="safety-card-unit">{days === 1 ? "jour" : "jours"}</span>}
      </div>
      <div className="safety-card-footer">
        <p className="safety-card-last-date">Dernier accident : <b>{dateLabel(state?.lastAccidentDate ?? null)}</b></p>
        {showDateForm ? (
          <form className="safety-card-form" onSubmit={save}>
            <label htmlFor="safety-last-date">Date du dernier accident</label>
            <div className="safety-card-entry">
              <input id="safety-last-date" type="date" aria-label="Date du dernier accident du travail"
                required min="1900-01-01" max={state?.asOfDate ?? ""}
                value={draftDate} onChange={event => { setDraftDate(event.target.value); setNotice(null); }} />
              <button type="submit" disabled={saving || !canSave}>{saving ? "..." : "Valider"}</button>
            </div>
            {state?.lastAccidentDate && (
              <button className="safety-card-cancel" type="button" disabled={saving}
                onClick={() => { setEditingDate(false); setDraftDate(state.lastAccidentDate ?? ""); setDraftRevision(state.revision); setReason(""); setError(null); setNotice(null); }}>
                Annuler
              </button>
            )}
            {needsCorrectionReason && (
              <input className="safety-card-reason" type="text" aria-label="Motif de correction de la date"
                minLength={5} maxLength={240} required
                value={reason} onChange={event => setReason(event.target.value)}
                placeholder="Motif de correction" />
            )}
          </form>
        ) : canEditDate && state?.lastAccidentDate ? (
          <button className="safety-card-edit" type="button" onClick={() => { setDraftDate(state.lastAccidentDate ?? ""); setDraftRevision(state.revision); setReason(""); setError(null); setNotice(null); setEditingDate(true); }}>
            Modifier la date
          </button>
        ) : !canEditDate ? (
          <small className="safety-card-readonly">
            {state && !state.editable && session.agency.canImport ? "Saisie désactivée par l’administrateur" : "Date saisie par un responsable"}
          </small>
        ) : null}
        {error && <p className="safety-card-feedback is-error" role="alert">{error}</p>}
        {notice && <p className="safety-card-feedback is-success" role="status">{notice}</p>}
        <small className="safety-card-footnote">Date temporaire · à ressaisir après perte des données du serveur</small>
      </div>
    </article>
  );
}
