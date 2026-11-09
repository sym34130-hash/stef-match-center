import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarDays, CheckCircle2, ShieldCheck } from "lucide-react";
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

  const url = `/api/agencies/${encodeURIComponent(session.agency.code)}/safety`;

  const refresh = useCallback(async (resetDraft = false) => {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "x-access-code": session.accessCode },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "La sécurité de l'agence est indisponible.");
    const next = payload as SafetyState;
    setState(next);
    if (resetDraft) { setDraftDate(next.lastAccidentDate ?? ""); setDraftRevision(next.revision); }
    setError(null);
    return next;
  }, [url, session.accessCode]);

  useEffect(() => {
    let disposed = false;
    setState(null);
    setLoading(true);
    setError(null);
    setNotice(null);
    setDraftDate("");
    setDraftRevision(null);
    setReason("");

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
      setNotice("Date enregistrée et compteur actualisé pour cette agence.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const days = !error && state?.counter.status === "available" ? state.counter.days : null;
  return (
    <section className="safety-counter" aria-label="Jours sans accident du travail">
      <div className="safety-counter-top">
        <div className="safety-counter-title">
          <ShieldCheck size={23} aria-hidden="true" />
          <div>
            <h3>Jours sans accident du travail</h3>
            <p>Compteur commun à l'agence · date renseignée manuellement</p>
          </div>
        </div>
        <div className="safety-counter-value" aria-live="polite">
          <strong>{loading ? "Chargement…" : days === null ? "Non renseigné" : days.toLocaleString("fr-FR")}</strong>
          {days !== null && <span>{days === 1 ? "jour" : "jours"}</span>}
        </div>
      </div>
      <div className="safety-counter-meta">
        <span>Dernier accident : <b>{dateLabel(state?.lastAccidentDate ?? null)}</b></span>
        {state?.asOfDate && <span>Au {dateLabel(state.asOfDate)}</span>}
        <button type="button" onClick={() => {
          setNotice(null);
          void refresh(true).catch(failure => setError(failure instanceof Error ? failure.message : "Lecture impossible."));
        }}>Actualiser</button>
      </div>
      {error && <p className="safety-counter-error" role="alert">{error}</p>}
      {notice && <p className="safety-counter-notice" role="status"><CheckCircle2 size={16} />{notice}</p>}
      {session.agency.canImport && (
        <details className="safety-counter-editor">
          <summary><CalendarDays size={16} /> Renseigner / corriger la date du dernier accident</summary>
          {state?.editable ? (
            <form onSubmit={save}>
              <label htmlFor="safety-last-date">Date du dernier accident du travail</label>
              <input id="safety-last-date" type="date" required min="1900-01-01"
                max={state.asOfDate} value={draftDate} onChange={event => setDraftDate(event.target.value)} />
              <label htmlFor="safety-change-reason">Motif de la correction (obligatoire si la date existe déjà)</label>
              <input id="safety-change-reason" type="text" maxLength={240}
                value={reason} onChange={event => setReason(event.target.value)}
                placeholder="Ex. correction validée par le responsable" />
              <button type="submit" disabled={saving || !draftDate || draftDate > state.asOfDate}>
                {saving ? "Enregistrement…" : "Enregistrer la date"}
              </button>
              <small>La date est partagée avec les autres utilisateurs autorisés de l'agence. Toute modification est historisée.</small>
            </form>
          ) : (
            <p>Enregistrement désactivé tant qu'un stockage durable n'est pas validé sur le serveur.</p>
          )}
        </details>
      )}
      {state?.history?.length ? (
        <details className="safety-counter-history">
          <summary>Historique des corrections ({state.history.length})</summary>
          <ul>{[...state.history].reverse().slice(0, 20).map((item, index) => (
            <li key={`${item.changedAt}-${index}`}>
              {dateLabel(item.previousDate)} → {dateLabel(item.newDate)}
              <small>{new Date(item.changedAt).toLocaleString("fr-FR")} · {item.reason}</small>
            </li>
          ))}</ul>
        </details>
      ) : null}
    </section>
  );
}
