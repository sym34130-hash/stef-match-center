import { FormEvent, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  CirclePlay,
  ClipboardList,
  Clock3,
  Dumbbell,
  Edit3,
  Eye,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  Maximize2,
  Minimize2,
  RefreshCw,
  Save,
  Shield,
  Shirt,
  Sparkles,
  Target,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Agency, Alert, Highlight, MatchStatus, Player, Snapshot } from "./types";

type Session = {
  agency: Agency;
  accessCode: string;
};

type CauserieZoneId = "attack" | "midfield" | "defense" | "coach";

type CauseriePlan = {
  team: string;
  manager: string;
  updatedAt: string | null;
  attack: string[];
  midfield: string[];
  defense: string[];
  coach: {
    tactic: string;
    priority: string;
    arbitration: string;
    review: string;
  };
};

type CauserieToast = {
  title: string;
  detail: string;
  tone: "success" | "warning" | "error" | "loading";
} | null;

type Screen = "kickoff" | "match" | "composition" | "player" | "coach" | "causerie" | "tv" | "import";

const screens: Array<{ id: Exclude<Screen, "player">; label: string; icon: LucideIcon; step: string }> = [
  { id: "kickoff", label: "Coup d'envoi", icon: CirclePlay, step: "01" },
  { id: "match", label: "Feuille de match", icon: LayoutDashboard, step: "02" },
  { id: "composition", label: "Composition", icon: Shirt, step: "03" },
  { id: "coach", label: "Coach", icon: Dumbbell, step: "04" },
  { id: "causerie", label: "Causerie", icon: ClipboardList, step: "05" },
  { id: "tv", label: "Écran quai", icon: Eye, step: "TV" },
  { id: "import", label: "Import", icon: Upload, step: "MAJ" },
];

type CompositionRole = "Attaquant" | "Milieu" | "Défenseur";
type MatchCeremonyTone = "victory" | "controlled" | "finalize" | "rework";
type MatchAwardKind = "mvp" | "scorer" | "passer" | "defense";

type MatchAward = {
  kind: MatchAwardKind;
  label: string;
  detail: string;
  symbol: string;
  podiumLabel: string;
  highlight: NonNullable<Highlight>;
};

const compositionLines: Array<{
  role: CompositionRole;
  zone: "attack" | "midfield" | "defense";
  title: string;
  code: "CHG" | "ZONAGE" | "DECHG";
  helper: string;
}> = [
  { role: "Attaquant", zone: "attack", title: "ATTAQUE", code: "CHG", helper: "Ce que nous devons faire avancer" },
  { role: "Milieu", zone: "midfield", title: "MILIEU", code: "ZONAGE", helper: "Ce qui doit rester fluide et coordonné" },
  { role: "Défenseur", zone: "defense", title: "DÉFENSE", code: "DECHG", helper: "Ce que nous devons sécuriser" },
];

const kickoffScenePlayers: Array<{
  id: string;
  team: "stef" | "opponent";
  x: number;
  y: number;
  dx: number;
  dy: number;
  starter?: boolean;
}> = [
  { id: "stef-9", team: "stef", x: 47.5, y: 52, dx: 2.4, dy: -3.2, starter: true },
  { id: "stef-10", team: "stef", x: 55.5, y: 49, dx: 2.2, dy: -1.8 },
  { id: "stef-7", team: "stef", x: 35, y: 62, dx: 1.2, dy: -1.4 },
  { id: "stef-11", team: "stef", x: 66, y: 64, dx: 1.4, dy: -1.2 },
  { id: "stef-6", team: "stef", x: 50, y: 73, dx: 0.8, dy: -1.5 },
  { id: "stef-4", team: "stef", x: 30, y: 82, dx: 0.5, dy: -0.9 },
  { id: "stef-5", team: "stef", x: 70, y: 82, dx: 0.5, dy: -0.9 },
  { id: "opp-9", team: "opponent", x: 51, y: 38, dx: -0.5, dy: 1.2 },
  { id: "opp-8", team: "opponent", x: 38, y: 31, dx: -0.7, dy: 1.1 },
  { id: "opp-10", team: "opponent", x: 62, y: 30, dx: -0.8, dy: 1.1 },
  { id: "opp-6", team: "opponent", x: 28, y: 22, dx: -0.3, dy: 0.8 },
  { id: "opp-4", team: "opponent", x: 72, y: 21, dx: -0.3, dy: 0.8 },
];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [screen, setScreen] = useState<Screen>("kickoff");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem("stef-match-session");
    if (!saved) return;
    try {
      const nextSession = JSON.parse(saved) as Session;
      setSession(nextSession);
      setSnapshotLoading(true);
      fetchSnapshot(nextSession)
        .then(setSnapshot)
        .catch(() => setSnapshot(null))
        .finally(() => setSnapshotLoading(false));
    } catch {
      sessionStorage.removeItem("stef-match-session");
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("tv-screen-active", screen === "tv");
    return () => document.body.classList.remove("tv-screen-active");
  }, [screen]);

  async function handleLogin(agencyCode: string, accessCode: string) {
    setLoading(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencyCode, accessCode }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Accès refusé.");
      const nextSession = { agency: payload.agency, accessCode };
      setSession(nextSession);
      sessionStorage.setItem("stef-match-session", JSON.stringify(nextSession));
      setSnapshot(await fetchSnapshot(nextSession).catch(() => null));
      setScreen("kickoff");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Accès refusé.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    sessionStorage.removeItem("stef-match-session");
    setSession(null);
    setSnapshot(null);
    setSelectedPlayer(null);
    setScreen("kickoff");
  }

  async function refreshSnapshot() {
    if (!session) return;
    setSnapshotLoading(true);
    setSnapshot(await fetchSnapshot(session).catch(() => null));
    setSnapshotLoading(false);
  }

  function openPlayer(player: Player) {
    setSelectedPlayer(player);
    setScreen("player");
  }

  if (!session) {
    return <LoginView onLogin={handleLogin} loading={loading} message={statusMessage} />;
  }

  const playerScreen = screen === "player";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">SMC</div>
          <div>
            <p>STEF</p>
            <h1>Match Center</h1>
          </div>
        </div>
        <div className="agency-pill">
          <Shield size={18} />
          <span>{session.agency.name}</span>
        </div>
        <nav className="nav-list" aria-label="Parcours Match Center">
          {screens.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={screen === item.id ? "nav-item active" : "nav-item"}
                onClick={() => setScreen(item.id)}
              >
                <span className="nav-step">{item.step}</span>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <button className="logout-button" type="button" onClick={handleLogout}>
          <Lock size={16} />
          Changer d'agence
        </button>
      </aside>

      <main className="main-area">
        <TopBar snapshot={snapshot} agency={session.agency} onRefresh={refreshSnapshot} loading={snapshotLoading} />
        {snapshotLoading && !snapshot ? (
          <LoadingView />
        ) : !snapshot && screen !== "import" && screen !== "kickoff" ? (
          <NoDataView onImport={() => setScreen("import")} />
        ) : (
          <>
            {screen === "kickoff" && (
              <Kickoff
                snapshot={snapshot}
                onGo={() => setScreen(snapshot ? "match" : "import")}
                onTv={() => setScreen("tv")}
              />
            )}
            {screen === "match" && snapshot && (
              <MatchSheet
                snapshot={snapshot}
                onPlayer={openPlayer}
                onCoach={() => setScreen("coach")}
                onComposition={() => setScreen("composition")}
              />
            )}
            {screen === "composition" && snapshot && <Composition snapshot={snapshot} onPlayer={openPlayer} />}
            {playerScreen && snapshot && selectedPlayer && (
              <PlayerSheet
                snapshot={snapshot}
                player={selectedPlayer}
                onBack={() => setScreen("composition")}
                onSelect={setSelectedPlayer}
              />
            )}
            {screen === "coach" && snapshot && (
              <Coach snapshot={snapshot} session={session} onPlayer={openPlayer} onMatch={() => setScreen("match")} />
            )}
            {screen === "causerie" && snapshot && <Causerie snapshot={snapshot} session={session} />}
            {screen === "tv" && snapshot && <TvMode snapshot={snapshot} onMatch={() => setScreen("match")} />}
            {screen === "import" && (
              <ImportView
                session={session}
                onImported={(next) => {
                  setSnapshot(next);
                  setSelectedPlayer(next.players[0] ?? null);
                }}
                onOpenMatch={() => setScreen("match")}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

async function fetchSnapshot(session: Session): Promise<Snapshot> {
  const response = await fetch(`/api/agencies/${encodeURIComponent(session.agency.code)}/snapshot`, {
    headers: { "x-access-code": session.accessCode },
  });
  if (!response.ok) throw new Error("Aucun match importé.");
  const payload = await response.json();
  return payload.snapshot;
}

async function fetchCauseriePlan(session: Session, snapshot: Snapshot): Promise<CauseriePlan | null> {
  const response = await fetch(
    `/api/agencies/${encodeURIComponent(session.agency.code)}/causerie?matchDate=${encodeURIComponent(snapshot.match.date)}`,
    { headers: { "x-access-code": session.accessCode } }
  );
  if (!response.ok) throw new Error("Causerie non disponible.");
  const payload = await response.json();
  if (payload.plan) return payload.plan;
  const localPlan = localStorage.getItem(causerieStorageKey(snapshot));
  return localPlan ? JSON.parse(localPlan) as CauseriePlan : null;
}

async function saveCauseriePlan(session: Session, snapshot: Snapshot, plan: CauseriePlan): Promise<CauseriePlan> {
  const response = await fetch(`/api/agencies/${encodeURIComponent(session.agency.code)}/causerie`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": session.accessCode,
    },
    body: JSON.stringify({
      matchDate: snapshot.match.date,
      plan,
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? "Causerie non enregistrée.");
  return payload.plan;
}

function LoginView({ onLogin, loading, message }: { onLogin: (agencyCode: string, accessCode: string) => void; loading: boolean; message: string }) {
  const [agencyCode, setAgencyCode] = useState("058");
  const [accessCode, setAccessCode] = useState("match-058");

  function submit(event: FormEvent) {
    event.preventDefault();
    onLogin(agencyCode, accessCode);
  }

  return (
    <div className="login-page">
      <section className="login-panel">
        <div className="login-visual">
          <div className="stadium-light" />
          <div className="brand-block large">
            <div className="brand-mark">SMC</div>
            <div>
              <p>STEF</p>
              <h1>Match Center</h1>
            </div>
          </div>
          <h2>Le vestiaire privé de ton agence.</h2>
          <p>Dépose l'Excel actualisé, puis transforme le match du quai en lecture simple et actionnable.</p>
        </div>
        <form className="login-form" onSubmit={submit}>
          <span className="eyebrow">Accès agence</span>
          <h2>Entrer dans le Match Center</h2>
          <label>
            Code agence
            <input value={agencyCode} onChange={(event) => setAgencyCode(event.target.value)} autoComplete="off" />
          </label>
          <label>
            Code d'accès
            <input value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoComplete="off" type="password" />
          </label>
          {message && <p className="form-error">{message}</p>}
          <button className="primary-button" disabled={loading} type="submit">
            <Lock size={18} />
            {loading ? "Contrôle..." : "Accéder au match"}
          </button>
          <p className="helper-text">Mode pilote : accès réservé aux équipes autorisées.</p>
        </form>
      </section>
    </div>
  );
}

function TopBar({ snapshot, agency, onRefresh, loading }: { snapshot: Snapshot | null; agency: Agency; onRefresh: () => void; loading: boolean }) {
  return (
    <header className="top-bar">
      <div>
        <p className="eyebrow">Espace agence</p>
        <h2>{agency.name}</h2>
      </div>
      <div className="top-actions">
        <span>{snapshot ? `Dernière actualisation : ${formatDateTime(snapshot.importedAt)}` : "Aucun match importé"}</span>
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={16} />
          {loading ? "Actualisation..." : "Actualiser"}
        </button>
      </div>
    </header>
  );
}

function LoadingView() {
  return (
    <section className="empty-state">
      <RefreshCw size={42} />
      <h2>Chargement du match</h2>
      <p>Le Match Center récupère la dernière feuille importée.</p>
    </section>
  );
}

function NoDataView({ onImport }: { onImport: () => void }) {
  return (
    <section className="empty-state">
      <FileSpreadsheet size={42} />
      <h2>Aucun match importé</h2>
      <p>Dépose l'Excel actualisé pour créer la première feuille de match de cette agence.</p>
      <button className="primary-button" type="button" onClick={onImport}>
        <Upload size={18} />
        Importer le match
      </button>
    </section>
  );
}

function Kickoff({ snapshot, onGo, onTv }: { snapshot: Snapshot | null; onGo: () => void; onTv: () => void }) {
  const [isKicking, setIsKicking] = useState(false);
  const kickoffTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (kickoffTimeoutRef.current) window.clearTimeout(kickoffTimeoutRef.current);
    };
  }, []);

  function launchMatch() {
    if (isKicking) return;
    if (!snapshot) {
      onGo();
      return;
    }
    setIsKicking(true);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    kickoffTimeoutRef.current = window.setTimeout(onGo, reduceMotion ? 120 : 1120);
  }

  if (!snapshot) {
    return (
      <section className="kickoff-page no-data-kickoff">
        <div className="kickoff-stands top" aria-hidden="true">
          {Array.from({ length: 44 }).map((_, index) => <span key={`ready-top-${index}`} />)}
        </div>
        <div className="kickoff-stands bottom" aria-hidden="true">
          {Array.from({ length: 44 }).map((_, index) => <span key={`ready-bottom-${index}`} />)}
        </div>
        <header className="kickoff-header">
          <div>
            <p className="eyebrow">01 - Coup d'envoi</p>
            <h2>Le stade est prêt</h2>
            <span>Importe les données pour préparer le match.</span>
          </div>
        </header>
        <div className="kickoff-scoreboard">
          <span>STEF MATCH CENTER</span>
          <strong>Match à préparer</strong>
          <small>Aucun fichier importé</small>
        </div>
        <div className="kickoff-layout">
          <div className="kickoff-field-shell">
            <div className="kickoff-tunnel" aria-hidden="true">
              <span />
              <span />
            </div>
            <div className="kickoff-pitch no-match" aria-label="Terrain de coup d'envoi">
              <div className="kickoff-half-line" aria-hidden="true" />
              <div className="kickoff-goal top" aria-hidden="true" />
              <div className="kickoff-goal bottom" aria-hidden="true" />
              <div className="kickoff-penalty-box top" aria-hidden="true" />
              <div className="kickoff-penalty-box bottom" aria-hidden="true" />
              <div className="kickoff-goal-box top" aria-hidden="true" />
              <div className="kickoff-goal-box bottom" aria-hidden="true" />
              <div className="kickoff-penalty-spot top" aria-hidden="true" />
              <div className="kickoff-penalty-spot bottom" aria-hidden="true" />
              <div className="kickoff-center-circle" aria-hidden="true" />
              <div className="kickoff-center-spot" aria-hidden="true" />
              <button className="kickoff-ball" type="button" onClick={launchMatch} aria-label="Importer le match">
                <span />
              </button>
              <button className="primary-button kickoff-cta" type="button" onClick={launchMatch}>
                <Upload size={18} />
                Importer le match
              </button>
            </div>
          </div>
          <aside className="kickoff-context-panel">
            <span>Vestiaire</span>
            <strong>Le match n'est pas encore chargé.</strong>
            <p>Dépose l'Excel actualisé pour créer la feuille de match de cette agence.</p>
          </aside>
        </div>
      </section>
    );
  }

  const kickoff = kickoffState(snapshot);
  const launchLabel = isKicking ? "Coup d'envoi..." : kickoff.cta;
  const scoreboardState = isKicking || kickoff.tone === "live" ? "MATCH EN COURS" : "MATCH PRÊT";

  return (
    <section className={`kickoff-page ${kickoff.tone} ${isKicking ? "is-kicking" : ""}`}>
      <div className="kickoff-stands top" aria-hidden="true">
        {Array.from({ length: 44 }).map((_, index) => <span key={`kick-top-${index}`} />)}
      </div>
      <div className="kickoff-stands bottom" aria-hidden="true">
        {Array.from({ length: 44 }).map((_, index) => <span key={`kick-bottom-${index}`} />)}
      </div>

      <header className="kickoff-header">
        <div>
          <p className="eyebrow">01 - Coup d'envoi</p>
          <h2>{kickoff.title}</h2>
          <span>Dernière actualisation : {formatDateTime(snapshot.importedAt)}</span>
        </div>
        <div className="kickoff-header-actions">
          <StatusBadge status={snapshot.match.status} />
          <button className="secondary-on-dark" type="button" onClick={onTv}>
            <Eye size={18} />
            Écran quai
          </button>
        </div>
      </header>

      <div className="kickoff-scoreboard">
        <span>STEF MATCH CENTER</span>
        <strong>{scoreboardState}</strong>
        <small>Agence {snapshot.agency.code} - {formatDate(snapshot.match.date)} - {snapshot.match.timeRangeLabel}</small>
      </div>

      <div className="kickoff-layout">
        <div className="kickoff-field-shell">
          <div className="kickoff-tunnel" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="kickoff-pitch" aria-label="Terrain de coup d'envoi">
            <div className="kickoff-half-line" aria-hidden="true" />
            <div className="kickoff-goal top" aria-hidden="true" />
            <div className="kickoff-goal bottom" aria-hidden="true" />
            <div className="kickoff-penalty-box top" aria-hidden="true" />
            <div className="kickoff-penalty-box bottom" aria-hidden="true" />
            <div className="kickoff-goal-box top" aria-hidden="true" />
            <div className="kickoff-goal-box bottom" aria-hidden="true" />
            <div className="kickoff-penalty-spot top" aria-hidden="true" />
            <div className="kickoff-penalty-spot bottom" aria-hidden="true" />
            <div className="kickoff-center-circle" aria-hidden="true" />
            <div className="kickoff-center-spot" aria-hidden="true" />
            <div className="kickoff-players" aria-hidden="true">
              {kickoffScenePlayers.map((player) => (
                <span
                  className={`kickoff-player-token ${player.team} ${player.starter ? "starter" : ""}`}
                  key={player.id}
                  style={{
                    "--x": `${player.x}%`,
                    "--y": `${player.y}%`,
                    "--dx": `${player.dx}px`,
                    "--dy": `${player.dy}px`,
                  } as CSSProperties}
                >
                  <i />
                </span>
              ))}
            </div>
            <button className="kickoff-ball" type="button" onClick={launchMatch} disabled={isKicking} aria-label={kickoff.cta}>
              <span />
            </button>
            <button className="primary-button kickoff-cta" type="button" onClick={launchMatch} disabled={isKicking}>
              <CirclePlay size={18} />
              {isKicking ? launchLabel : "Cliquer pour donner le coup d'envoi"}
            </button>
          </div>
        </div>

        <aside className="kickoff-context-panel">
          <div className="kickoff-status-card">
            <span>Statut du match</span>
            <strong>{kickoff.statusLabel}</strong>
            <p>{kickoff.detail}</p>
          </div>

          <div className="kickoff-objective-card">
            <span>Objectif du match</span>
            <strong>{snapshot.match.objective}</strong>
            <p>Délai cible : {snapshot.match.dzTargetMinutes} minutes.</p>
          </div>

          <div className="kickoff-context-grid">
            <div>
              <span>Site</span>
              <strong>Agence {snapshot.agency.code}</strong>
            </div>
            <div>
              <span>Équipe alignée</span>
              <strong>{snapshot.summary.players} joueurs actifs</strong>
            </div>
            <div>
              <span>Plage horaire</span>
              <strong>{snapshot.match.timeRangeLabel}</strong>
            </div>
            <div>
              <span>Volume préparé</span>
              <strong>{formatNumber(snapshot.summary.positions)} positions</strong>
            </div>
          </div>

          <button className="secondary-on-dark kickoff-secondary" type="button" onClick={onTv}>
            <Eye size={18} />
            Préparer l'écran quai
          </button>
        </aside>
      </div>
    </section>
  );
}

function MatchSheet({ snapshot, onPlayer, onCoach, onComposition }: { snapshot: Snapshot; onPlayer: (player: Player) => void; onCoach: () => void; onComposition: () => void }) {
  const [celebrationMode, setCelebrationMode] = useState(false);
  const latePositions = delayedPositions(snapshot);
  const action = matchAction(snapshot);
  const outcome = matchCeremonyOutcome(snapshot);
  const awards = buildAwardItems(snapshot);
  const mvpAward = awards.find((award) => award.kind === "mvp") ?? awards[0] ?? null;
  const specialistAwards = awards.filter((award) => award.kind !== "mvp");
  const playersByName = new Map(snapshot.players.map((player) => [player.name, player]));
  const jerseyNumbers = buildJerseyNumbers(snapshot.players);

  useEffect(() => {
    document.body.classList.toggle("match-celebration-active", celebrationMode);
    return () => document.body.classList.remove("match-celebration-active");
  }, [celebrationMode]);

  return (
    <div className={celebrationMode ? `match-page is-celebration-mode ${outcome.tone}` : `match-page ${outcome.tone}`}>
      <section className={`match-ceremony ${outcome.tone}`}>
        <div className="match-stands top" aria-hidden="true">
          {Array.from({ length: 46 }).map((_, index) => <span key={`match-top-${index}`} />)}
        </div>
        <div className="match-stands bottom" aria-hidden="true">
          {Array.from({ length: 46 }).map((_, index) => <span key={`match-bottom-${index}`} />)}
        </div>
        {outcome.celebration && (
          <div className="match-confetti" aria-hidden="true">
            {Array.from({ length: 18 }).map((_, index) => <span key={`confetti-${index}`} />)}
          </div>
        )}

        <header className="match-ceremony-header">
          <div>
            <p className="eyebrow">02 - Feuille de match</p>
            <h2>{outcome.title}</h2>
            <span>Agence {snapshot.agency.code} - Match du {formatDate(snapshot.match.date)} - {snapshot.match.timeRangeLabel}</span>
          </div>
          <div className="match-header-actions">
            <button className="secondary-on-dark" type="button" onClick={() => setCelebrationMode((current) => !current)}>
              {celebrationMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              {celebrationMode ? "Sortir du mode Célébration" : "Mode célébration"}
            </button>
            <button className="secondary-on-dark" type="button" onClick={onComposition}>
              <Shirt size={16} />
              Composition
            </button>
          </div>
        </header>

        <div className="match-result-stage">
          <div className={`match-emblem ${outcome.celebration ? "trophy" : "signal"}`} aria-hidden="true">
            {outcome.celebration ? (
              <span className="trophy-cup">
                <i />
              </span>
            ) : (
              <Target size={54} />
            )}
          </div>

          <div className="match-scoreboard">
            <span>STEF MATCH CENTER</span>
            <strong>{outcome.verdict}</strong>
            <div>
              <b>{snapshot.match.score}</b>
              <small>/ 100</small>
            </div>
            <p>{outcome.message}</p>
          </div>

          <div className="match-result-actions">
            <StatusBadge status={snapshot.match.status} />
            <p>{snapshot.match.objective}</p>
            <button className="primary-button compact" type="button" onClick={onCoach}>
              Voir les actions
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        <div className="team-performance-panel">
          <div className="team-performance-title">
            <span>Performance d'équipe</span>
            <strong>{outcome.collectiveTitle}</strong>
            <p>{outcome.collectiveDetail}</p>
          </div>
          <div className="match-kpi-board">
            <div>
              <span>Duels gagnés</span>
              <strong>{snapshot.summary.duelWon}/{snapshot.summary.duelTotal}</strong>
              <small>Dénominateur Excel filtré · {snapshot.match.dzTargetMinutes} min</small>
            </div>
            <div>
              <span>Opérations</span>
              <strong>{formatNumber(snapshot.summary.operations)}</strong>
              <small>Volume filtré Excel</small>
            </div>
            <div>
              <span>Positions</span>
              <strong>{formatNumber(snapshot.summary.positions)}</strong>
              <small>Retenues dans le match</small>
            </div>
            <div className={latePositions > 0 ? "needs-action" : "is-clear"}>
              <span>À reprendre</span>
              <strong>{formatNumber(latePositions)}</strong>
              <small>Duels hors délai score Excel</small>
            </div>
          </div>
        </div>
      </section>

      <section className="awards-ceremony">
        <div className="awards-heading">
          <div>
            <p className="eyebrow">Cérémonie des performances</p>
            <h2>Joueurs du match</h2>
            <span>Les performances qui ont marqué la rencontre, dans une lecture collective.</span>
          </div>
          <StatusBadge status={snapshot.match.status} />
        </div>

        <div className="awards-stage">
          {mvpAward && (
            <button
              className="mvp-award-card"
              type="button"
              onClick={() => {
                const player = playersByName.get(mvpAward.highlight.name);
                if (player) onPlayer(player);
              }}
              title={awardHoverTitle(playersByName.get(mvpAward.highlight.name), mvpAward.highlight)}
            >
              <span className="award-kicker">{mvpAward.label}</span>
              <div className="mvp-trophy" aria-hidden="true">
                <span className="trophy-cup small">
                  <i />
                </span>
              </div>
              <strong>{mvpAward.highlight.name}</strong>
              <small>{mvpAward.detail}</small>
              <b>{formatHighlightValue(mvpAward.highlight)} - {mvpAward.highlight.role}</b>
              <em>Voir sa fiche</em>
            </button>
          )}

          <div className="special-awards">
            {specialistAwards.map((award, index) => {
              const player = playersByName.get(award.highlight.name);
              const jersey = formatJerseyNumber(jerseyNumbers.get(award.highlight.name) ?? index + 1);
              const role = player?.role ?? award.highlight.role;
              const className = `award-card ${award.kind} ${roleClass(role)}`;
              const disabled = !player;
              return (
                <button
                  className={className}
                  disabled={disabled}
                  key={`${award.kind}-${award.highlight.name}`}
                  type="button"
                  title={awardHoverTitle(player, award.highlight)}
                  onClick={() => player && onPlayer(player)}
                >
                  <span className="award-symbol">{award.symbol}</span>
                  <span className={`award-shirt ${roleClass(role)}`} aria-hidden="true">
                    <b>{jersey}</b>
                    <em>{initials(award.highlight.name)}</em>
                  </span>
                  <span className="award-copy">
                    <i>{award.label}</i>
                    <strong>{award.highlight.name}</strong>
                    <small>{award.detail}</small>
                    <b>{formatHighlightValue(award.highlight)}</b>
                  </span>
                  <span className="podium-step" aria-hidden="true">{award.podiumLabel}</span>
                  <em>Voir sa fiche</em>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="match-statistics-section">
        <div className="match-section-heading">
          <div>
            <p className="eyebrow">Statistiques du match</p>
            <h2>Lecture opérationnelle</h2>
            <span>Les chiffres restent disponibles après la célébration, sans concurrencer le résultat.</span>
          </div>
          <button className="secondary-button" type="button" onClick={onCoach}>
            Passer à l'action
            <ArrowRight size={16} />
          </button>
        </div>

        <div className="match-stat-grid">
          <div className="role-stat-panel">
            <SectionTitle title="Équilibre composition" subtitle="Répartition des joueurs par poste Excel." />
            <div className="role-bars">
              {snapshot.summary.roleDistribution.map((role) => (
                <RoleLine key={role.role} role={role.role} percent={role.percent} count={role.count} />
              ))}
            </div>
          </div>

          <div className="post-match-action">
            <span>Prochaine action</span>
            <strong>{action.title}</strong>
            <p>{action.detail}</p>
            <button className="secondary-button" type="button" onClick={onComposition}>
              Voir la composition
              <Shirt size={16} />
            </button>
          </div>

          <div className="match-control-card">
            <span>Contrôle import</span>
            <strong>{snapshot.validation.warnings.length === 0 ? "Fichier lisible" : `${snapshot.validation.warnings.length} point(s) à contrôler`}</strong>
            <p>{snapshot.validation.warnings[0] ?? "Aucune alerte bloquante sur le dernier import."}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Composition({ snapshot, onPlayer }: { snapshot: Snapshot; onPlayer: (player: Player) => void }) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [fieldMode, setFieldMode] = useState(false);
  const groups = buildCompositionGroups(snapshot.players);
  const selectedPlayer = selectedName ? snapshot.players.find((player) => player.name === selectedName) ?? null : null;
  const manOfTheMatch = snapshot.highlights.manOfTheMatch?.name ?? null;
  const jerseyNumbers = buildJerseyNumbers(snapshot.players);
  const roleVolumes = new Map(snapshot.summary.roleDistribution.map((item) => [item.role, item]));
  const compositionSummary = `${snapshot.players.length} joueurs - ${groups.Attaquant.length} Attaque / ${groups.Milieu.length} Milieu / ${groups.Défenseur.length} Défense`;

  useEffect(() => {
    document.body.classList.toggle("composition-field-active", fieldMode);
    return () => document.body.classList.remove("composition-field-active");
  }, [fieldMode]);

  return (
    <section className={fieldMode ? "composition-page is-field-mode" : "composition-page"}>
      <header className="composition-header">
        <div>
          <p className="eyebrow">03 - Composition</p>
          <h2>Composition du jour</h2>
          <span>Agence {snapshot.agency.code} - Match du {formatDate(snapshot.match.date)} - {snapshot.match.timeRangeLabel}</span>
        </div>
        <div className="composition-header-actions">
          <StatusBadge status={snapshot.match.status} />
          <button className="secondary-on-dark" type="button" onClick={() => setFieldMode((current) => !current)}>
            {fieldMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {fieldMode ? "Sortir du mode Terrain" : "Mode terrain"}
          </button>
        </div>
      </header>

      <div className="composition-arena">
        <div className="composition-stands top" aria-hidden="true">
          {Array.from({ length: 48 }).map((_, index) => <span key={`top-${index}`} />)}
        </div>
        <div className="composition-stands bottom" aria-hidden="true">
          {Array.from({ length: 48 }).map((_, index) => <span key={`bottom-${index}`} />)}
        </div>
        <div className="composition-led left" aria-hidden="true">STEF MATCH CENTER</div>
        <div className="composition-led right" aria-hidden="true">ENSEMBLE SUR LE TERRAIN</div>

        <div className="composition-scoreboard" aria-label="Résumé de la composition">
          <span>STEF MATCH CENTER</span>
          <strong>COMPOSITION DU JOUR</strong>
          <small>{compositionSummary}</small>
        </div>

        <div className="composition-layout">
          <div className="composition-stage">
            <div className="touchline-bench left" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="touchline-bench right" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>

            <div className="formation-pitch" aria-label="Terrain de composition">
              <div className="formation-goal top" aria-hidden="true" />
              <div className="formation-goal bottom" aria-hidden="true" />
              <div className="formation-box top" aria-hidden="true" />
              <div className="formation-box bottom" aria-hidden="true" />
              <div className="formation-half" aria-hidden="true" />
              <div className="formation-circle" aria-hidden="true" />

              {compositionLines.map((line, lineIndex) => {
                const players = groups[line.role];
                const rows = splitFormationRows(players);
                return (
                  <section className={`formation-zone ${line.zone}`} key={line.role} aria-label={`${line.title} - ${line.code}`}>
                    <div className="formation-zone-label">
                      <span>{line.code}</span>
                      <strong>{line.title}</strong>
                      <small>{line.helper}</small>
                      <b>{players.length} joueur(s)</b>
                    </div>
                    <div className="formation-rows">
                      {rows.length === 0 ? (
                        <div className="formation-empty">Aucun joueur sur cette ligne</div>
                      ) : rows.map((row, rowIndex) => (
                        <div className="formation-row" key={`${line.role}-${rowIndex}`}>
                          {row.map((player, playerIndex) => {
                            const isSelected = selectedPlayer?.name === player.name;
                            const isDimmed = Boolean(selectedPlayer && !isSelected);
                            const isFeatured = manOfTheMatch === player.name;
                            const className = [
                              "formation-player",
                              roleClass(player.role),
                              isSelected ? "is-selected" : "",
                              isDimmed ? "is-dimmed" : "",
                              isFeatured ? "is-featured" : "",
                            ].filter(Boolean).join(" ");
                            const style = {
                              animationDelay: `${lineIndex * 90 + (rowIndex * 8 + playerIndex) * 28}ms`,
                            } as CSSProperties;
                            return (
                              <button
                                className={className}
                                key={player.name}
                                type="button"
                                title={`${player.name} - ${player.role} - CHG ${player.byType.CHG} / ZONAGE ${player.byType.ZONAGE} / DECHG ${player.byType.DECHG}`}
                                style={style}
                                onClick={() => setSelectedName(player.name)}
                              >
                                {isFeatured && <span className="formation-star" aria-label="Joueur du match">★</span>}
                                <span className="formation-shirt" aria-hidden="true">
                                  <b>{formatJerseyNumber(jerseyNumbers.get(player.name) ?? 0)}</b>
                                  <em>{initials(player.name)}</em>
                                </span>
                                <span className="formation-player-copy">
                                  <strong>{player.name}</strong>
                                  <small>{roleCode(player.role)} - {formatNumber(player.operations)} ops</small>
                                  <i>{player.dominantShare}% sur ce poste</i>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>

          <aside className="composition-side-panel" aria-label="Lecture de la composition">
            {selectedPlayer ? (
              <div className="composition-player-panel">
                <button className="composition-panel-close" type="button" onClick={() => setSelectedName(null)} aria-label="Fermer la sélection">
                  ×
                </button>
                <span>Joueur sélectionné</span>
                <h3>{selectedPlayer.name}</h3>
                <p>{selectedPlayer.role} - {roleCode(selectedPlayer.role)}</p>
                <div className="composition-player-stats">
                  <div>
                    <strong>{formatNumber(selectedPlayer.operations)}</strong>
                    <small>opérations</small>
                  </div>
                  <div>
                    <strong>{selectedPlayer.dominantShare}%</strong>
                    <small>poste dominant</small>
                  </div>
                  <div>
                    <strong>{selectedPlayer.polyvalence}%</strong>
                    <small>polyvalence</small>
                  </div>
                </div>
                <div className="composition-mini-bars">
                  <StatLine label="Attaque - CHG" value={selectedPlayer.attackPercent} raw={selectedPlayer.byType.CHG} />
                  <StatLine label="Milieu - ZONAGE" value={selectedPlayer.midfieldPercent} raw={selectedPlayer.byType.ZONAGE} />
                  <StatLine label="Défense - DECHG" value={selectedPlayer.defensePercent} raw={selectedPlayer.byType.DECHG} />
                </div>
                <button className="primary-button compact" type="button" onClick={() => onPlayer(selectedPlayer)}>
                  Voir la fiche joueur
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <div className="composition-player-panel empty">
                <span>Lecture coach</span>
                <h3>Cliquer sur un maillot</h3>
                <p>Le terrain montre la répartition opérationnelle : CHG en attaque, ZONAGE au milieu, DECHG en défense.</p>
              </div>
            )}

            <div className="composition-lineup-card">
              <span>Répartition terrain</span>
              {compositionLines.map((line) => {
                const volume = roleVolumes.get(line.role);
                return (
                  <div className={`lineup-row ${line.zone}`} key={line.role}>
                    <strong>{line.title}</strong>
                    <b>{groups[line.role].length} joueur(s)</b>
                    <small>{volume ? `${volume.percent}% des joueurs` : "Aucun joueur"}</small>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function Coach({
  snapshot,
  session,
  onPlayer,
  onMatch,
}: {
  snapshot: Snapshot;
  session: Session;
  onPlayer: (player: Player) => void;
  onMatch: () => void;
}) {
  const [coachMode, setCoachMode] = useState(false);
  const [coachBoardMode, setCoachBoardMode] = useState<"view" | "edit">("view");
  const [coachPlan, setCoachPlan] = useState<CauseriePlan>(() => buildDefaultCauseriePlan(snapshot));
  const [coachDraft, setCoachDraft] = useState<CauseriePlan>(() => buildDefaultCauseriePlan(snapshot));
  const [savingCoachPlan, setSavingCoachPlan] = useState(false);
  const [coachBoardFeedback, setCoachBoardFeedback] = useState<CauserieToast>(null);
  const lockerPlayers = uniquePlayers([
    ...snapshot.coach.playersInForm.slice(0, 5),
    ...snapshot.coach.polyvalents.slice(0, 3),
    ...snapshot.coach.specialists.slice(0, 3),
  ]).slice(0, 8);
  const [selectedName, setSelectedName] = useState(lockerPlayers[0]?.name ?? snapshot.players[0]?.name ?? "");
  const selectedPlayer = snapshot.players.find((player) => player.name === selectedName) ?? lockerPlayers[0] ?? snapshot.players[0] ?? null;
  const actions = coachActions(snapshot);
  const strengths = coachStrengths(snapshot);
  const progress = coachProgressPoints(snapshot);
  const late = delayedPositions(snapshot);
  const mainRisk = snapshot.coach.travelRisks[0];
  const jerseyNumbers = buildJerseyNumbers(snapshot.players);
  const activeCoachPlan = coachBoardMode === "edit" ? coachDraft : coachPlan;

  useEffect(() => {
    document.body.classList.toggle("coach-room-active", coachMode);
    return () => document.body.classList.remove("coach-room-active");
  }, [coachMode]);

  useEffect(() => {
    let cancelled = false;
    const defaultPlan = buildDefaultCauseriePlan(snapshot);
    setCoachPlan(defaultPlan);
    setCoachDraft(defaultPlan);
    setCoachBoardMode("view");
    setCoachBoardFeedback(null);
    fetchCauseriePlan(session, snapshot)
      .then((remotePlan) => {
        if (cancelled) return;
        const nextPlan = normalizeCauseriePlan(remotePlan ?? defaultPlan, snapshot);
        setCoachPlan(nextPlan);
        setCoachDraft(nextPlan);
      })
      .catch(() => {
        if (!cancelled) {
          setCoachBoardFeedback({
            title: "Plan non synchronisé",
            detail: "Le tableau reste modifiable, mais la dernière version partagée n'a pas été récupérée.",
            tone: "warning",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.accessCode, session.agency.code, snapshot.agency.code, snapshot.match.date, snapshot.importedAt]);

  function startCoachBoardEdit() {
    setCoachDraft(coachPlan);
    setCoachBoardMode("edit");
    setCoachBoardFeedback(null);
  }

  function cancelCoachBoardEdit() {
    setCoachDraft(coachPlan);
    setCoachBoardMode("view");
    setCoachBoardFeedback(null);
  }

  function updateCoachDraft(field: keyof CauseriePlan["coach"], value: string) {
    const maxLength = field === "review" ? 80 : 120;
    setCoachDraft((current) => ({
      ...current,
      coach: {
        ...current.coach,
        [field]: value.slice(0, maxLength),
      },
    }));
  }

  async function saveCoachBoard() {
    const nextPlan = {
      ...coachDraft,
      attack: padPlanLines(coachDraft.attack),
      midfield: padPlanLines(coachDraft.midfield),
      defense: padPlanLines(coachDraft.defense),
      coach: {
        tactic: coachDraft.coach.tactic.trim(),
        priority: coachDraft.coach.priority.trim(),
        arbitration: coachDraft.coach.arbitration.trim(),
        review: coachDraft.coach.review.trim(),
      },
      updatedAt: new Date().toISOString(),
    };

    setSavingCoachPlan(true);
    try {
      const savedPlan = await saveCauseriePlan(session, snapshot, nextPlan);
      const normalizedPlan = normalizeCauseriePlan(savedPlan, snapshot);
      setCoachPlan(normalizedPlan);
      setCoachDraft(normalizedPlan);
      setCoachBoardMode("view");
      setCoachBoardFeedback({
        title: "Plan d'action enregistré",
        detail: "Le tableau du coach est à jour pour l'équipe.",
        tone: "success",
      });
    } catch {
      setCoachPlan(nextPlan);
      setCoachDraft(nextPlan);
      setCoachBoardMode("view");
      localStorage.setItem(causerieStorageKey(snapshot), JSON.stringify(nextPlan));
      setCoachBoardFeedback({
        title: "Sauvegarde locale uniquement",
        detail: "Le texte est conservé sur ce poste, mais il n'est pas encore partagé.",
        tone: "warning",
      });
    } finally {
      setSavingCoachPlan(false);
      window.setTimeout(() => setCoachBoardFeedback(null), 3400);
    }
  }

  return (
    <section className={coachMode ? "coach-page coach-room is-coach-mode" : "coach-page coach-room"}>
      <header className="coach-room-header">
        <div>
          <p className="eyebrow">04 - Coach</p>
          <h2>Vestiaire & analyse du match</h2>
          <span>Agence {snapshot.agency.code} - Match du {formatDate(snapshot.match.date)} - {snapshot.match.timeRangeLabel}</span>
        </div>
        <div className="coach-room-header-actions">
          <StatusBadge status={snapshot.match.status} />
          <button className="secondary-on-dark" type="button" onClick={() => setCoachMode((current) => !current)}>
            {coachMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {coachMode ? "Sortir du Mode Coach" : "Mode Coach"}
          </button>
        </div>
      </header>

      <div className="locker-room-scene">
        <div className="locker-room-wall" aria-hidden="true" />
        <div className="locker-room-lights" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="locker-room-led left" aria-hidden="true">STEF MATCH CENTER</div>
        <div className="locker-room-led right" aria-hidden="true">VESTIAIRE COACH</div>

        <section className="locker-zone" aria-label="Casiers joueurs">
          <div className="locker-zone-heading">
            <span>Casiers</span>
            <strong>Équipe à regarder</strong>
            <p>Profils utiles au point Coach, limités aux joueurs significatifs du dernier import.</p>
          </div>
          <div className="locker-row">
            {lockerPlayers.map((player, index) => {
              const isSelected = selectedPlayer?.name === player.name;
              const metric = playerLockerMetric(player, snapshot);
              const jersey = formatJerseyNumber(jerseyNumbers.get(player.name) ?? index + 1);
              return (
                <button
                  className={`locker-card ${roleClass(player.role)} ${isSelected ? "is-selected" : ""}`}
                  key={player.name}
                  type="button"
                  onFocus={() => setSelectedName(player.name)}
                  onMouseEnter={() => setSelectedName(player.name)}
                  onClick={() => onPlayer(player)}
                  title={`${player.name} - ${player.role} - ${metric.label} ${metric.value}`}
                >
                  <span className="locker-number">{jersey}</span>
                  <span className="locker-hanger" aria-hidden="true" />
                  <span className="locker-shirt" aria-hidden="true">
                    <b>{jersey}</b>
                    <em>STEF</em>
                  </span>
                  <strong>{player.name}</strong>
                  <small>{player.role} - {roleCode(player.role)}</small>
                  <i>{metric.label} {metric.value}</i>
                </button>
              );
            })}
          </div>
        </section>

        <div className="locker-room-core">
          <button className="analysis-screen" type="button" onClick={() => setCoachMode(true)} aria-label="Agrandir l'analyse du match">
            <span className="screen-brand">ANALYSE DU MATCH</span>
            <div className="screen-main-score">
              <strong>{snapshot.match.score}</strong>
              <small>/ 100</small>
            </div>
            <p>{snapshot.summary.duelWon}/{snapshot.summary.duelTotal} duels gagnés - {snapshot.summary.duelRate}%</p>
            <div className="screen-facts">
              <div>
                <span>Activité</span>
                <b>{formatNumber(snapshot.summary.operations)}</b>
                <small>opérations filtrées</small>
              </div>
              <div className={late > 0 ? "is-warning" : "is-safe"}>
                <span>À travailler</span>
                <b>{formatNumber(late)}</b>
                <small>duels ouverts</small>
              </div>
              <div>
                <span>Équipe</span>
                <b>{snapshot.summary.players}</b>
                <small>joueurs actifs</small>
              </div>
            </div>
            <div className="screen-role-bars" aria-label="Répartition terrain">
              {snapshot.summary.roleDistribution.map((role) => (
                <span key={role.role} style={{ "--bar-size": `${Math.max(6, role.percent)}%` } as CSSProperties}>
                  <i className={roleClass(role.role)} />
                  <b>{roleCode(role.role)}</b>
                </span>
              ))}
            </div>
          </button>

          <section className="tactical-board" aria-label="Tableau tactique du coach">
            <div className="board-header">
              <span>Tableau du coach</span>
              <strong>Que fait-on maintenant ?</strong>
            </div>
            <div className="board-columns">
              <TacticalColumn title="Points forts" items={strengths} tone="safe" />
              <TacticalColumn title="À travailler" items={progress} tone="watch" />
              <TacticalColumn title="Ajustements" items={actions.map((action) => ({ title: action.title, detail: action.next }))} tone="action" />
            </div>
            <div className={coachBoardMode === "edit" ? "coach-writing-panel is-editing" : "coach-writing-panel"}>
              <div className="coach-writing-head">
                <div>
                  <span>Plan d'action terrain</span>
                  <strong>À écrire pour l'équipe</strong>
                </div>
                {coachBoardMode === "view" ? (
                  <button className="secondary-button compact" type="button" onClick={startCoachBoardEdit}>
                    <Edit3 size={15} />
                    Écrire
                  </button>
                ) : (
                  <div className="coach-writing-actions">
                    <button className="secondary-button compact" type="button" onClick={cancelCoachBoardEdit} disabled={savingCoachPlan}>
                      <XCircle size={15} />
                      Annuler
                    </button>
                    <button className="primary-button compact" type="button" onClick={saveCoachBoard} disabled={savingCoachPlan}>
                      <Save size={15} />
                      {savingCoachPlan ? "Enregistrement..." : "Enregistrer"}
                    </button>
                  </div>
                )}
              </div>

              {coachBoardFeedback && (
                <div className={`coach-board-feedback ${coachBoardFeedback.tone}`}>
                  <strong>{coachBoardFeedback.title}</strong>
                  <span>{coachBoardFeedback.detail}</span>
                </div>
              )}

              {coachBoardMode === "edit" ? (
                <div className="coach-edit-fields">
                  <label>
                    Tactique du jour
                    <textarea
                      value={activeCoachPlan.coach.tactic}
                      onChange={(event) => updateCoachDraft("tactic", event.target.value)}
                      placeholder="Ex. Reprendre les duels ouverts sur le premier voyage à risque."
                      rows={2}
                    />
                  </label>
                  <label>
                    Priorité
                    <textarea
                      value={activeCoachPlan.coach.priority}
                      onChange={(event) => updateCoachDraft("priority", event.target.value)}
                      placeholder="Ex. Sécuriser les positions non closes avant la prochaine revue."
                      rows={2}
                    />
                  </label>
                  <label>
                    Arbitrage
                    <textarea
                      value={activeCoachPlan.coach.arbitration}
                      onChange={(event) => updateCoachDraft("arbitration", event.target.value)}
                      placeholder="Ex. Renfort temporaire sur DECHG si le retard augmente."
                      rows={2}
                    />
                  </label>
                  <label>
                    Prochaine revue
                    <input
                      value={activeCoachPlan.coach.review}
                      onChange={(event) => updateCoachDraft("review", event.target.value)}
                      placeholder="Ex. 18:30"
                    />
                  </label>
                </div>
              ) : (
                <div className="coach-written-plan">
                  <article>
                    <span>Tactique</span>
                    <p>{activeCoachPlan.coach.tactic || "À écrire"}</p>
                  </article>
                  <article>
                    <span>Priorité</span>
                    <p>{activeCoachPlan.coach.priority || "À écrire"}</p>
                  </article>
                  <article>
                    <span>Arbitrage</span>
                    <p>{activeCoachPlan.coach.arbitration || "À écrire"}</p>
                  </article>
                  <article>
                    <span>Revue</span>
                    <p>{activeCoachPlan.coach.review || "À planifier"}</p>
                  </article>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="quick-locker-panel" aria-label="Fiche joueur rapide">
          {selectedPlayer ? (
            <>
              <span>Fiche rapide</span>
              <strong>{selectedPlayer.name}</strong>
              <p>{selectedPlayer.role} - {roleCode(selectedPlayer.role)}</p>
              <div className="quick-player-metrics">
                <div>
                  <b>{selectedPlayer.volumeIndex}</b>
                  <small>indice volume</small>
                </div>
                <div>
                  <b>{selectedPlayer.byType.CHG}</b>
                  <small>CHG</small>
                </div>
                <div>
                  <b>{selectedPlayer.byType.ZONAGE}</b>
                  <small>ZONAGE</small>
                </div>
                <div>
                  <b>{selectedPlayer.byType.DECHG}</b>
                  <small>DECHG</small>
                </div>
              </div>
              <p className="quick-player-note">{playerProfile(selectedPlayer).detail}</p>
              <button className="primary-button compact" type="button" onClick={() => onPlayer(selectedPlayer)}>
                Voir la fiche complète
                <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <p>Aucun joueur disponible sur le dernier import.</p>
          )}
        </aside>

        <section className="central-bench" aria-label="Banc central">
          <div>
            <span>Banc central</span>
            <strong>Équipe</strong>
            <p>{coachMessage(snapshot)}</p>
          </div>
          <div className="bench-facts">
            <Fact label="Force collective" value={strengths[0]?.title ?? "Non disponible"} />
            <Fact label="Point de vigilance" value={progress[0]?.title ?? "Aucun point critique"} emphasis={late > 0} />
            <Fact label="Objectif suivant" value={actions[0]?.title ?? "Maintenir le rythme"} />
          </div>
        </section>

        <button className="tunnel-return" type="button" onClick={onMatch}>
          <span>Tunnel</span>
          <strong>Retour sur le terrain</strong>
          <small>{mainRisk ? `À contrôler : voyage ${mainRisk.travelCode}` : "Revenir à la feuille de match"}</small>
          <ArrowRight size={18} />
        </button>
      </div>
    </section>
  );
}

function PlayerSheet({ snapshot, player, onBack, onSelect }: { snapshot: Snapshot; player: Player; onBack: () => void; onSelect: (player: Player) => void }) {
  const profile = playerProfile(player);

  return (
    <div className="player-page">
      <section className="player-hero">
        <button className="ghost-button" type="button" onClick={onBack}>
          <ChevronLeft size={18} />
          Retour terrain
        </button>
        <div className="player-identity">
          <div className="player-avatar">{initials(player.name)}</div>
          <div>
            <p className="eyebrow">Fiche joueur</p>
            <h2>{player.name}</h2>
            <span>{player.role} · {roleCode(player.role)}</span>
          </div>
        </div>
        <label className="player-select">
          Changer de joueur
          <select
            value={player.name}
            onChange={(event) => {
              const nextPlayer = snapshot.players.find((item) => item.name === event.target.value);
              if (nextPlayer) onSelect(nextPlayer);
            }}
          >
            {snapshot.players.map((item) => (
              <option key={item.name} value={item.name}>{item.name}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="metric-row essential">
        <Metric icon={Target} label="Indice volume" value={`${player.volumeIndex}`} detail={`Contribution équipe ${player.contributionPercent}%`} tone="primary" />
        <Metric icon={Shirt} label="Poste dominant" value={player.role} detail={`${player.dominantShare}% activité dominante`} />
        <Metric icon={Sparkles} label="Polyvalence" value={`${player.polyvalence}`} detail={`${player.operationTypes} activité(s)`} />
        <Metric icon={Clock3} label="Activité" value={playerTimeRange(player)} detail="Première - dernière opération" />
      </section>

      <section className="section-card split-section">
        <div>
          <SectionTitle title="Répartition individuelle" subtitle="CHG, DECHG et ZONAGE sur le match importé." />
          <div className="stat-bars">
            <StatLine label="Attaque · CHG" value={player.attackPercent} raw={player.byType.CHG} />
            <StatLine label="Milieu · ZONAGE" value={player.midfieldPercent} raw={player.byType.ZONAGE} />
            <StatLine label="Défense · DECHG" value={player.defensePercent} raw={player.byType.DECHG} />
          </div>
        </div>
        <div className="player-reading">
          <span>Lecture coach</span>
          <strong>{profile.title}</strong>
          <p>{profile.detail}</p>
          <b>{profile.evolution}</b>
        </div>
      </section>
    </div>
  );
}

function Causerie({ snapshot, session }: { snapshot: Snapshot; session: Session }) {
  const [plan, setPlan] = useState<CauseriePlan>(() => buildDefaultCauseriePlan(snapshot));
  const [activeZone, setActiveZone] = useState<CauserieZoneId>("attack");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [briefMode, setBriefMode] = useState(false);
  const [toast, setToast] = useState<CauserieToast>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const hasContent = hasCauserieContent(plan);

  useEffect(() => {
    document.body.classList.toggle("causerie-brief-active", briefMode);
    return () => document.body.classList.remove("causerie-brief-active");
  }, [briefMode]);

  useEffect(() => {
    let cancelled = false;
    const defaultPlan = buildDefaultCauseriePlan(snapshot);
    setPlan(defaultPlan);
    setMode("view");
    setActiveZone("attack");
    setToast(null);
    setLoadingPlan(true);
    fetchCauseriePlan(session, snapshot)
      .then((remotePlan) => {
        if (!cancelled && remotePlan) setPlan(normalizeCauseriePlan(remotePlan, snapshot));
      })
      .catch(() => {
        if (!cancelled) {
          setToast({
            title: "Causerie non synchronisée",
            detail: "Le plan par défaut reste disponible. Réessaie avant le briefing.",
            tone: "warning",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPlan(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.accessCode, session.agency.code, snapshot.agency.code, snapshot.match.date, snapshot.importedAt]);

  function updateZoneLine(zone: Exclude<CauserieZoneId, "coach">, index: number, value: string) {
    setPlan((current) => ({
      ...current,
      [zone]: current[zone].map((line, lineIndex) => lineIndex === index ? value.slice(0, 96) : line),
    }));
  }

  function updateCoach(field: keyof CauseriePlan["coach"], value: string) {
    setPlan((current) => ({
      ...current,
      coach: {
        ...current.coach,
        [field]: value.slice(0, 120),
      },
    }));
  }

  function updateMeta(field: "team" | "manager", value: string) {
    setPlan((current) => ({
      ...current,
      [field]: value.slice(0, 48),
    }));
  }

  async function savePlan() {
    const nextPlan = {
      ...plan,
      attack: padPlanLines(plan.attack),
      midfield: padPlanLines(plan.midfield),
      defense: padPlanLines(plan.defense),
      coach: {
        tactic: plan.coach.tactic.trim(),
        priority: plan.coach.priority.trim(),
        arbitration: plan.coach.arbitration.trim(),
        review: plan.coach.review.trim(),
      },
      updatedAt: new Date().toISOString(),
    };
    setSavingPlan(true);
    try {
      const savedPlan = await saveCauseriePlan(session, snapshot, nextPlan);
      setPlan(normalizeCauseriePlan(savedPlan, snapshot));
      setMode("view");
      setToast({
        title: "Plan de jeu validé",
        detail: "La Causerie est prête pour le briefing.",
        tone: "success",
      });
    } catch {
      setPlan(nextPlan);
      localStorage.setItem(causerieStorageKey(snapshot), JSON.stringify(nextPlan));
      setToast({
        title: "Sauvegarde locale uniquement",
        detail: "La page reste utilisable sur ce poste, mais le plan n'est pas partagé.",
        tone: "warning",
      });
    } finally {
      setSavingPlan(false);
      window.setTimeout(() => setToast(null), 3200);
    }
  }

  function preparePlan() {
    setMode("edit");
    setActiveZone("attack");
  }

  return (
    <section className={briefMode ? "causerie-stadium is-brief" : "causerie-stadium"}>
      <div className="stadium-stands top" aria-hidden="true">
        {Array.from({ length: 42 }).map((_, index) => <span key={index} />)}
      </div>
      <div className="stadium-stands bottom" aria-hidden="true">
        {Array.from({ length: 42 }).map((_, index) => <span key={index} />)}
      </div>

      <header className="causerie-stadium-header">
        <div>
          <p className="eyebrow">STEF Match Center</p>
          <h2>Causerie</h2>
          <span>
            Match du {formatDate(snapshot.match.date)} · Équipe {plan.team || "à renseigner"} · Mise à jour {plan.updatedAt ? formatDateTime(plan.updatedAt) : "à préparer"}
          </span>
        </div>
        <div className="causerie-header-actions">
          <StatusBadge status={snapshot.match.status} />
          <button className={briefMode ? "secondary-on-dark brief-exit" : "secondary-on-dark"} type="button" onClick={() => setBriefMode((current) => !current)}>
            {briefMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            {briefMode ? "Quitter brief" : "Mode brief"}
          </button>
          {mode === "view" ? (
            <button className="primary-button compact" type="button" onClick={preparePlan}>
              <Edit3 size={16} />
              Modifier le plan de jeu
            </button>
          ) : (
            <button className="primary-button compact" type="button" onClick={savePlan} disabled={savingPlan}>
              <Save size={16} />
              {savingPlan ? "Enregistrement..." : "Enregistrer la causerie"}
            </button>
          )}
        </div>
      </header>

      {loadingPlan && <CauserieToastView toast={{ title: "Chargement causerie", detail: "Récupération du plan de jeu partagé.", tone: "loading" }} />}
      {toast && <CauserieToastView toast={toast} />}

      {!hasContent && mode === "view" ? (
        <div className="causerie-empty">
          <strong>Le vestiaire est prêt</strong>
          <p>Il reste à préparer le plan de jeu du jour.</p>
          <button className="primary-button" type="button" onClick={preparePlan}>
            Préparer la causerie
            <ArrowRight size={18} />
          </button>
        </div>
      ) : (
        <div className="stadium-layout">
          <div className="stadium-led left">STEF MATCH CENTER</div>
          <div className="stadium-led right">CAUSERIE DU JOUR</div>

          <div className="stadium-screen">
            <span>Scoreboard</span>
            <strong>{plan.updatedAt ? "Plan de jeu prêt" : "Causerie à préparer"}</strong>
            <small>{plan.coach.priority || snapshot.match.objective}</small>
          </div>

          <div className="stadium-field" aria-label="Terrain de causerie">
            <div className="goal goal-top" aria-hidden="true" />
            <div className="goal goal-bottom" aria-hidden="true" />
            <div className="penalty-box top" aria-hidden="true" />
            <div className="penalty-box bottom" aria-hidden="true" />
            <div className="center-circle" aria-hidden="true" />
            <div className="half-line" aria-hidden="true" />

            <CauserieFieldZone
              id="attack"
              code="CHG"
              Icon={Target}
              title="Attaque"
              subtitle="Ce que nous devons faire avancer aujourd'hui"
              lines={plan.attack}
              active={activeZone === "attack"}
              editing={mode === "edit"}
              onActivate={setActiveZone}
              onChange={updateZoneLine}
            />
            <CauserieFieldZone
              id="midfield"
              code="ZONAGE"
              Icon={RefreshCw}
              title="Milieu"
              subtitle="Ce qui doit rester fluide et coordonné"
              lines={plan.midfield}
              active={activeZone === "midfield"}
              editing={mode === "edit"}
              onActivate={setActiveZone}
              onChange={updateZoneLine}
            />
            <CauserieFieldZone
              id="defense"
              code="DECHG"
              Icon={Shield}
              title="Défense"
              subtitle="Ce que nous devons sécuriser"
              lines={plan.defense}
              active={activeZone === "defense"}
              editing={mode === "edit"}
              onActivate={setActiveZone}
              onChange={updateZoneLine}
            />
          </div>

          <aside
            className={activeZone === "coach" ? "coach-bench active" : "coach-bench"}
            onClick={() => setActiveZone("coach")}
          >
            <div className="bench-rail" aria-hidden="true">
              <span /><span /><span /><span />
            </div>
            <div className="coach-board">
              <div className="coach-board-head">
                <span>Coach / Staff</span>
                <h3>Tactique du jour</h3>
              </div>
              <div className="coach-tactic-field" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              {mode === "edit" ? (
                <div className="coach-edit-grid">
                  <div className="coach-meta-edit">
                    <label>
                      Équipe
                      <input value={plan.team} onChange={(event) => updateMeta("team", event.target.value)} placeholder="Ex. Nuit" />
                    </label>
                    <label>
                      Manager
                      <input value={plan.manager} onChange={(event) => updateMeta("manager", event.target.value)} placeholder="À renseigner" />
                    </label>
                  </div>
                  <label>
                    Tactique
                    <textarea value={plan.coach.tactic} onChange={(event) => updateCoach("tactic", event.target.value)} rows={2} />
                  </label>
                  <label>
                    Priorité absolue
                    <textarea value={plan.coach.priority} onChange={(event) => updateCoach("priority", event.target.value)} rows={2} />
                  </label>
                  <label>
                    Arbitrage
                    <textarea value={plan.coach.arbitration} onChange={(event) => updateCoach("arbitration", event.target.value)} rows={2} />
                  </label>
                  <label>
                    Prochaine revue
                    <input value={plan.coach.review} onChange={(event) => updateCoach("review", event.target.value)} />
                  </label>
                </div>
              ) : (
                <div className="coach-lines">
                  <p>{plan.coach.tactic || "Tactique à renseigner."}</p>
                  <dl>
                    <div>
                      <dt>Manager</dt>
                      <dd>{plan.manager || "À renseigner"}</dd>
                    </div>
                    <div>
                      <dt>Priorité</dt>
                      <dd>{plan.coach.priority || "À préparer"}</dd>
                    </div>
                    <div>
                      <dt>Arbitrage</dt>
                      <dd>{plan.coach.arbitration || "À préparer"}</dd>
                    </div>
                    <div>
                      <dt>Revue</dt>
                      <dd>{plan.coach.review || "À planifier"}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

function CauserieFieldZone({
  id,
  code,
  Icon,
  title,
  subtitle,
  lines,
  active,
  editing,
  onActivate,
  onChange,
}: {
  id: Exclude<CauserieZoneId, "coach">;
  code: string;
  Icon: LucideIcon;
  title: string;
  subtitle: string;
  lines: string[];
  active: boolean;
  editing: boolean;
  onActivate: (zone: CauserieZoneId) => void;
  onChange: (zone: Exclude<CauserieZoneId, "coach">, index: number, value: string) => void;
}) {
  return (
    <section
      className={active ? `field-zone ${id} active` : `field-zone ${id}`}
      role="button"
      tabIndex={0}
      onClick={() => onActivate(id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate(id);
        }
      }}
    >
      <div className="zone-marker">
        <Icon size={22} />
        <span>{code}</span>
      </div>
      <div className="zone-copy">
        <span>{title}</span>
        <strong>{subtitle}</strong>
      </div>
      <div className="tactical-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {editing ? (
        <div className="zone-edit-list">
          {lines.map((line, index) => (
            <input
              key={`${id}-${index}`}
              value={line}
              maxLength={96}
              onChange={(event) => onChange(id, index, event.target.value)}
              placeholder={`Consigne ${index + 1}`}
            />
          ))}
        </div>
      ) : (
        <ul>
          {cleanPlanLines(lines).map((line) => <li key={line}>{line}</li>)}
          {cleanPlanLines(lines).length === 0 && <li>À préparer pendant la causerie.</li>}
        </ul>
      )}
    </section>
  );
}

function CauserieToastView({ toast }: { toast: NonNullable<CauserieToast> }) {
  const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? XCircle : toast.tone === "loading" ? RefreshCw : AlertTriangle;
  return (
    <div className={`save-toast ${toast.tone}`}>
      <Icon size={20} />
      <strong>{toast.title}</strong>
      <span>{toast.detail}</span>
    </div>
  );
}

function TvMode({ snapshot, onMatch }: { snapshot: Snapshot; onMatch: () => void }) {
  const action = matchAction(snapshot);
  const hero = snapshot.highlights.manOfTheMatch;

  return (
    <section className="tv-mode">
      <div className="tv-header">
        <div>
          <p>STEF MATCH CENTER</p>
          <h2>Agence {snapshot.agency.code}</h2>
        </div>
        <StatusBadge status={snapshot.match.status} />
      </div>
      <div className="tv-score">
        <strong>{snapshot.match.score}%</strong>
        <span>DUELS GAGNÉS</span>
        <small>{snapshot.summary.duelWon}/{snapshot.summary.duelTotal} duels Excel filtrés dans le délai cible</small>
      </div>
      <div className="tv-grid">
        <Fact label="Opérations" value={formatNumber(snapshot.summary.operations)} />
        <Fact label="À reprendre" value={`${delayedPositions(snapshot)} duel(s)`} emphasis={delayedPositions(snapshot) > 0} />
        <Fact label="Joueur du match" value={hero?.name ?? "Non disponible"} />
      </div>
      <div className="tv-action">
        <span>Plan de jeu</span>
        <strong>{action.title}</strong>
        <p>{action.detail}</p>
      </div>
      <button className="secondary-on-dark" type="button" onClick={onMatch}>
        Voir la feuille de match
        <ArrowRight size={18} />
      </button>
    </section>
  );
}

function ImportView({ session, onImported, onOpenMatch }: { session: Session; onImported: (snapshot: Snapshot) => void; onOpenMatch: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [details, setDetails] = useState<string[]>([]);
  const [importedSnapshot, setImportedSnapshot] = useState<Snapshot | null>(null);

  async function importFile() {
    if (!file) {
      setState("error");
      setMessage("Sélectionne un fichier Excel .xlsx.");
      setDetails(["Fichier attendu : classeur Excel avec l'onglet Données."]);
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    setState("uploading");
    setMessage("Contrôle du fichier en cours...");
    setDetails([]);
    setImportedSnapshot(null);
    const response = await fetch(`/api/agencies/${encodeURIComponent(session.agency.code)}/import`, {
      method: "POST",
      headers: { "x-access-code": session.accessCode },
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) {
      setState("error");
      setMessage(payload.message ?? "Le fichier n'a pas été importé.");
      setDetails([payload.action].filter(Boolean));
      return;
    }
    setState("success");
    setMessage("Le match est prêt.");
    setDetails(payload.snapshot.validation.warnings ?? []);
    setImportedSnapshot(payload.snapshot);
    onImported(payload.snapshot);
  }

  return (
    <section className="import-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Import</p>
          <h2>Déposer le fichier, actualiser le match</h2>
          <p>Fichier attendu : Excel .xlsx avec l'onglet Données et les colonnes A à G actualisées.</p>
        </div>
      </div>
      <div
        className={`drop-zone ${file ? "has-file" : ""}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setFile(event.dataTransfer.files[0] ?? null);
          setState("idle");
          setMessage("");
        }}
        onClick={() => inputRef.current?.click()}
      >
        <FileSpreadsheet size={38} />
        <strong>{file ? file.name : "Déposer ou sélectionner un fichier .xlsx"}</strong>
        <span>Le site lit et archive une copie. Il ne modifie jamais le classeur importé.</span>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setState("idle");
            setMessage("");
          }}
          hidden
        />
      </div>
      <div className="import-actions">
        <button className="primary-button" type="button" onClick={importFile} disabled={state === "uploading"}>
          <Upload size={18} />
          {state === "uploading" ? "Import en cours..." : "Contrôler et importer"}
        </button>
      </div>
      {message && (
        <div className={`import-result ${state}`}>
          {state === "error" ? <XCircle size={24} /> : state === "success" ? <CheckCircle2 size={24} /> : <RefreshCw size={24} />}
          <div>
            <strong>{state === "error" ? "FICHIER NON IMPORTÉ" : state === "success" ? "MATCH ACTUALISÉ" : "CONTRÔLE EN COURS"}</strong>
            <p>{message}</p>
            {details.map((detail) => <span key={detail}>{detail}</span>)}
          </div>
        </div>
      )}
      {importedSnapshot && (
        <div className="import-summary">
          <Fact label="Opérations" value={formatNumber(importedSnapshot.summary.operations)} />
          <Fact label="Joueurs" value={String(importedSnapshot.summary.players)} />
          <Fact label="Positions" value={formatNumber(importedSnapshot.summary.positions)} />
          <Fact label="Dernière donnée" value={formatDateTime(importedSnapshot.match.lastOperation ?? importedSnapshot.importedAt)} />
          <button className="primary-button" type="button" onClick={onOpenMatch}>
            Voir le match
            <ArrowRight size={18} />
          </button>
        </div>
      )}
    </section>
  );
}

function Metric({ icon: Icon, label, value, detail, tone = "neutral" }: { icon: LucideIcon; label: string; value: string; detail: string; tone?: "neutral" | "primary" | "danger" | "safe" }) {
  return (
    <article className={`metric-card ${tone}`}>
      <Icon size={22} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Fact({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`fact-card ${emphasis ? "emphasis" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="section-title">
      <h3>{title}</h3>
      <p>{subtitle}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: MatchStatus }) {
  const Icon = status === "MAÎTRISÉ" ? CheckCircle2 : status === "À SURVEILLER" ? AlertTriangle : XCircle;
  return (
    <span className={`status-badge ${statusClass(status)}`}>
      <Icon size={16} />
      {status}
    </span>
  );
}

function RoleLine({ role, percent, count }: { role: string; percent: number; count: number }) {
  return (
    <div className="role-line">
      <div>
        <span>{role}</span>
        <small>{roleCode(role)} · {formatNumber(count)} joueur(s)</small>
      </div>
      <div className="bar-track">
        <div className={`bar-fill ${roleClass(role)}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <b>{Math.round(percent)}%</b>
    </div>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  return (
    <article className="alert-card">
      <StatusBadge status={alert.level} />
      <strong>{alert.title}</strong>
      <p>{alert.detail}</p>
    </article>
  );
}

type TacticalItem = {
  title: string;
  detail: string;
};

function TacticalColumn({ title, items, tone }: { title: string; items: TacticalItem[]; tone: "safe" | "watch" | "action" }) {
  return (
    <div className={`tactical-column ${tone}`}>
      <span>{title}</span>
      {items.slice(0, 3).map((item) => (
        <article key={`${title}-${item.title}`}>
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
        </article>
      ))}
    </div>
  );
}

function PlayerList({ players, onPlayer, detail = "operations" }: { players: Player[]; onPlayer: (player: Player) => void; detail?: "operations" | "polyvalence" | "dominant" }) {
  if (players.length === 0) return <p className="muted">Aucun joueur dans cette catégorie sur le dernier import.</p>;
  return (
    <div className="player-list">
      {players.slice(0, 6).map((player) => (
        <button key={player.name} type="button" onClick={() => onPlayer(player)}>
          <span>{initials(player.name)}</span>
          <strong>{player.name}</strong>
          <small>
            {detail === "polyvalence" ? `${player.polyvalence} polyvalence` : detail === "dominant" ? `${player.dominantShare}% poste dominant` : `${player.operations} opérations`}
          </small>
        </button>
      ))}
    </div>
  );
}

function kickoffState(snapshot: Snapshot): {
  tone: "ready" | "live" | "finished";
  title: string;
  statusLabel: string;
  detail: string;
  cta: string;
} {
  const lastOperation = snapshot.match.lastOperation ? new Date(snapshot.match.lastOperation) : null;

  return {
    tone: "ready",
    title: "Match prêt",
    statusLabel: "Coup d'envoi prêt",
    detail: `Dernière donnée : ${formatDateTime(lastOperation?.toISOString() ?? snapshot.importedAt)}.`,
    cta: "Donner le coup d'envoi",
  };
}

function matchCeremonyOutcome(snapshot: Snapshot): {
  tone: MatchCeremonyTone;
  title: string;
  verdict: string;
  message: string;
  collectiveTitle: string;
  collectiveDetail: string;
  celebration: boolean;
} {
  if (snapshot.match.status === "MAÎTRISÉ") {
    return {
      tone: "victory",
      title: "Coup de sifflet final",
      verdict: "Objectif atteint",
      message: "La performance collective valide le match du jour.",
      collectiveTitle: "Performance d'équipe validée",
      collectiveDetail: "Le score collectif permet de célébrer le résultat tout en gardant les statistiques visibles.",
      celebration: true,
    };
  }

  if (snapshot.match.status === "À SURVEILLER") {
    return {
      tone: "controlled",
      title: "Match terminé",
      verdict: "Match maîtrisé",
      message: "Le résultat est solide, avec des points à garder sous contrôle.",
      collectiveTitle: "Collectif en maîtrise",
      collectiveDetail: "La page valorise les appuis du match sans masquer les zones à surveiller.",
      celebration: false,
    };
  }

  if (snapshot.match.score >= 50) {
    return {
      tone: "finalize",
      title: "Match terminé",
      verdict: "Match à finaliser",
      message: "Le collectif a produit du volume, mais l'objectif reste à sécuriser.",
      collectiveTitle: "Effort collectif à convertir",
      collectiveDetail: "Les distinctions restent positives, avec une priorité claire sur l'action terrain.",
      celebration: false,
    };
  }

  return {
    tone: "rework",
    title: "Coup de sifflet final",
    verdict: "Match à retravailler",
    message: "Le résultat ne justifie pas une célébration complète. La priorité est l'action.",
    collectiveTitle: "Reconnaissance et reprise terrain",
    collectiveDetail: "On met en avant les contributions utiles, puis on oriente le collectif vers les écarts à traiter.",
    celebration: false,
  };
}

function buildAwardItems(snapshot: Snapshot): MatchAward[] {
  return [
    {
      kind: "mvp",
      label: "Joueur du match",
      detail: "Performance globale",
      symbol: "MVP",
      podiumLabel: "Distinction centrale",
      highlight: snapshot.highlights.manOfTheMatch,
    },
    {
      kind: "scorer",
      label: "Meilleur buteur",
      detail: "Meilleure contribution CHG",
      symbol: "CHG",
      podiumLabel: "Attaque",
      highlight: snapshot.highlights.bestScorer,
    },
    {
      kind: "passer",
      label: "Meilleur passeur",
      detail: "Meilleure contribution ZONAGE",
      symbol: "ZON",
      podiumLabel: "Milieu",
      highlight: snapshot.highlights.bestPasser,
    },
    {
      kind: "defense",
      label: "Mur défensif",
      detail: "Meilleure contribution DECHG",
      symbol: "DEF",
      podiumLabel: "Défense",
      highlight: snapshot.highlights.defensiveWall,
    },
  ].filter((award): award is MatchAward => Boolean(award.highlight));
}

function awardHoverTitle(player: Player | undefined, highlight: NonNullable<Highlight>) {
  if (!player) return `${highlight.name} - ${highlight.role} - ${formatHighlightValue(highlight)}`;
  return `${player.name} - ${player.role} - CHG ${player.byType.CHG} / ZONAGE ${player.byType.ZONAGE} / DECHG ${player.byType.DECHG}`;
}

function formatHighlightValue(highlight: NonNullable<Highlight>) {
  const value = highlight.value ?? highlight.operations;
  const label = highlight.valueLabel ?? "opérations";
  return `${formatNumber(value)} ${label}`;
}

function buildCompositionGroups(players: Player[]): Record<CompositionRole, Player[]> {
  const sortPlayers = (items: Player[]) => [...items].sort((a, b) => b.operations - a.operations || a.name.localeCompare(b.name, "fr"));
  return {
    Attaquant: sortPlayers(players.filter((player) => player.role === "Attaquant")),
    Milieu: sortPlayers(players.filter((player) => player.role === "Milieu")),
    Défenseur: sortPlayers(players.filter((player) => player.role === "Défenseur")),
  };
}

function splitFormationRows(players: Player[]) {
  if (players.length === 0) return [];
  const rowCount = players.length <= 4 ? 1 : players.length <= 8 ? 2 : 3;
  const rows = Array.from({ length: rowCount }, () => [] as Player[]);
  players.forEach((player, index) => rows[index % rowCount].push(player));
  return rows.filter((row) => row.length > 0);
}

function buildJerseyNumbers(players: Player[]) {
  return new Map(
    [...players]
      .sort((a, b) => b.operations - a.operations || a.name.localeCompare(b.name, "fr"))
      .map((player, index) => [player.name, index + 1])
  );
}

function formatJerseyNumber(value: number) {
  return String(value).padStart(2, "0").slice(-2);
}

function StatLine({ label, value, raw }: { label: string; value: number; raw: number }) {
  return (
    <div className="stat-line">
      <div>
        <span>{label}</span>
        <strong>{raw} opérations</strong>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <b>{value}%</b>
    </div>
  );
}

function delayedPositions(snapshot: Snapshot) {
  return Math.max(0, snapshot.summary.duelTotal - snapshot.summary.duelWon);
}

function causerieStorageKey(snapshot: Snapshot) {
  return `stef-causerie:${snapshot.agency.code}:${snapshot.match.date}`;
}

function buildDefaultCauseriePlan(snapshot: Snapshot): CauseriePlan {
  const priority = findCauserieValue(snapshot, "Priorité");
  const risk = findCauserieValue(snapshot, "Risque");
  const objective = findCauserieValue(snapshot, "Objectif") || snapshot.match.objective;
  const arbitration = findCauserieValue(snapshot, "Arbitrage");
  const review = findCauserieValue(snapshot, "Heure");
  const weakRole = snapshot.summary.roleDistribution.reduce((min, current) => current.percent < min.percent ? current : min, snapshot.summary.roleDistribution[0]);
  const late = delayedPositions(snapshot);
  const action = matchAction(snapshot);

  return {
    team: "",
    manager: "",
    updatedAt: null,
    attack: padPlanLines([
      priority,
      objective,
      snapshot.summary.operationCounts.CHG ? `${formatNumber(snapshot.summary.operationCounts.CHG)} opérations CHG à piloter.` : "",
    ]),
    midfield: padPlanLines([
      arbitration,
      weakRole ? `Équilibre terrain : ${weakRole.role} à ${Math.round(weakRole.percent)}% des joueurs.` : "",
      snapshot.summary.operationCounts.ZONAGE ? `${formatNumber(snapshot.summary.operationCounts.ZONAGE)} opérations ZONAGE.` : "",
    ]),
    defense: padPlanLines([
      risk,
      late > 0 ? `${late} duel(s) à sécuriser.` : "Risque principal maîtrisé sur le dernier import.",
      snapshot.summary.operationCounts.DECHG ? `${formatNumber(snapshot.summary.operationCounts.DECHG)} opérations DECHG.` : "",
    ]),
    coach: {
      tactic: action.title,
      priority: priority || action.detail,
      arbitration: arbitration || "À préciser pendant la causerie.",
      review: review || "À planifier.",
    },
  };
}

function normalizeCauseriePlan(plan: CauseriePlan, snapshot: Snapshot): CauseriePlan {
  const fallback = buildDefaultCauseriePlan(snapshot);
  return {
    team: plan.team ?? fallback.team,
    manager: plan.manager ?? fallback.manager,
    updatedAt: plan.updatedAt ?? null,
    attack: padPlanLines(plan.attack ?? fallback.attack),
    midfield: padPlanLines(plan.midfield ?? fallback.midfield),
    defense: padPlanLines(plan.defense ?? fallback.defense),
    coach: {
      tactic: plan.coach?.tactic ?? fallback.coach.tactic,
      priority: plan.coach?.priority ?? fallback.coach.priority,
      arbitration: plan.coach?.arbitration ?? fallback.coach.arbitration,
      review: plan.coach?.review ?? fallback.coach.review,
    },
  };
}

function findCauserieValue(snapshot: Snapshot, label: string) {
  const normalizedLabel = label.toLowerCase();
  return snapshot.causerie.find((item) => item.label.toLowerCase().includes(normalizedLabel))?.value ?? "";
}

function cleanPlanLines(lines: string[]) {
  return lines.map((line) => line.trim()).filter(Boolean).slice(0, 3);
}

function padPlanLines(lines: string[]) {
  const cleaned = cleanPlanLines(lines);
  while (cleaned.length < 3) cleaned.push("");
  return cleaned.slice(0, 3);
}

function hasCauserieContent(plan: CauseriePlan) {
  return [
    ...plan.attack,
    ...plan.midfield,
    ...plan.defense,
    plan.coach.tactic,
    plan.coach.priority,
    plan.coach.arbitration,
    plan.coach.review,
  ].some((item) => item.trim().length > 0);
}

function matchAction(snapshot: Snapshot) {
  const late = delayedPositions(snapshot);
  if (late > 0) {
    const risk = snapshot.coach.travelRisks[0];
    return {
      title: "Reprendre les duels ouverts",
      detail: risk
        ? `${late} duel(s) hors délai dans le score Excel. Premier voyage à contrôler : ${risk.travelCode}.`
        : `${late} duel(s) hors délai dans le score Excel.`,
    };
  }
  return {
    title: "Maintenir le rythme",
    detail: "Aucun duel à reprendre sur le dernier import. Conserver le délai cible au prochain contrôle.",
  };
}

function uniquePlayers(players: Player[]) {
  const map = new Map<string, Player>();
  for (const player of players) {
    if (!map.has(player.name)) map.set(player.name, player);
  }
  return Array.from(map.values());
}

function playerLockerMetric(player: Player, snapshot: Snapshot) {
  if (snapshot.highlights.bestScorer?.name === player.name) {
    return { label: "CHG", value: formatNumber(player.byType.CHG) };
  }
  if (snapshot.highlights.bestPasser?.name === player.name) {
    return { label: "ZONAGE", value: formatNumber(player.byType.ZONAGE) };
  }
  if (snapshot.highlights.defensiveWall?.name === player.name) {
    return { label: "DECHG", value: formatNumber(player.byType.DECHG) };
  }
  if (snapshot.coach.polyvalents.some((item) => item.name === player.name)) {
    return { label: "Polyvalence", value: `${player.polyvalence}` };
  }
  return { label: "Volume", value: formatNumber(player.operations) };
}

function coachStrengths(snapshot: Snapshot): TacticalItem[] {
  const items: TacticalItem[] = [];
  const late = delayedPositions(snapshot);

  if (snapshot.summary.duelWon > late) {
    items.push({
      title: "Duels gagnés majoritaires",
      detail: `${formatNumber(snapshot.summary.duelWon)} duels gagnés sur ${formatNumber(snapshot.summary.duelTotal)} dans le score Excel filtré.`,
    });
  }

  if (snapshot.highlights.manOfTheMatch) {
    items.push({
      title: `Appui volume : ${snapshot.highlights.manOfTheMatch.name}`,
      detail: `${formatHighlightValue(snapshot.highlights.manOfTheMatch)} sur le match filtré.`,
    });
  }

  if (snapshot.coach.polyvalents.length > 0) {
    items.push({
      title: "Polyvalence disponible",
      detail: `${snapshot.coach.polyvalents.length} profil(s) couvrent plusieurs lignes opérationnelles.`,
    });
  }

  if (items.length === 0) {
    items.push({
      title: "Aucun point fort isolé",
      detail: "Le dernier import oriente surtout la lecture vers les ajustements à traiter.",
    });
  }

  return items.slice(0, 3);
}

function coachProgressPoints(snapshot: Snapshot): TacticalItem[] {
  const items: TacticalItem[] = [];
  const late = delayedPositions(snapshot);
  const risk = snapshot.coach.travelRisks[0];
  const weakRole = snapshot.summary.roleDistribution.reduce((min, current) => (current.percent < min.percent ? current : min), snapshot.summary.roleDistribution[0]);

  if (late > 0) {
    items.push({
      title: "Duels à reprendre",
      detail: `${formatNumber(late)} duel(s) hors délai cible dans le score Excel filtré.`,
    });
  }

  if (risk) {
    items.push({
      title: `Voyage ${risk.travelCode}`,
      detail: `${risk.delayedPositions} duel(s) à revoir sur ce code voyage.`,
    });
  }

  if (weakRole) {
    items.push({
      title: `Équilibre ${weakRole.role}`,
      detail: `${Math.round(weakRole.percent)}% des joueurs retenus sur cette ligne.`,
    });
  }

  if (snapshot.validation.warnings.length > 0) {
    items.push({
      title: "Contrôle import",
      detail: snapshot.validation.warnings[0],
    });
  }

  if (items.length === 0) {
    items.push({
      title: "Aucun point critique",
      detail: "Pas d'écart majeur détecté dans le dernier import.",
    });
  }

  return items.slice(0, 3);
}

function coachMessage(snapshot: Snapshot) {
  const late = delayedPositions(snapshot);
  if (late > 0 && snapshot.match.score >= 70) {
    return "Match lisible et score sous contrôle : le prochain ajustement porte sur les duels ouverts.";
  }
  if (late > 0) {
    return "Priorité vestiaire : reprendre les duels hors délai avant le prochain point terrain.";
  }
  return "Le collectif tient le plan de jeu : maintenir le rythme au prochain import.";
}

function coachActions(snapshot: Snapshot) {
  const late = delayedPositions(snapshot);
  const risk = snapshot.coach.travelRisks[0];
  const weakRole = snapshot.summary.roleDistribution.reduce((min, current) => (current.percent < min.percent ? current : min), snapshot.summary.roleDistribution[0]);
  return [
    {
      kicker: "Priorité terrain",
      title: late > 0 ? "Duels à reprendre" : "Match maîtrisé",
      detail: late > 0 ? `${late} duel(s) hors délai cible dans le score Excel filtré.` : "Aucun duel ouvert dans le dernier import.",
      next: late > 0 ? "Action : vérifier les positions concernées avant le prochain brief." : "Action : maintenir le contrôle au prochain import.",
      level: late > 0 ? "danger" : "safe",
    },
    {
      kicker: "Zone à surveiller",
      title: risk ? `Voyage ${risk.travelCode}` : "Aucun voyage critique",
      detail: risk ? `${risk.delayedPositions} duel(s) à reprendre sur ce code voyage.` : "Pas de concentration de retard détectée.",
      next: risk ? "Action : prioriser ce voyage dans la revue terrain." : "Action : conserver le suivi standard.",
      level: risk ? "watch" : "safe",
    },
    {
      kicker: "Équilibre d'équipe",
      title: `${weakRole.role} à ${Math.round(weakRole.percent)}%`,
      detail: "Répartition calculée à partir des postes Excel des joueurs retenus.",
      next: "Action : contrôler si cette répartition correspond au besoin du quai.",
      level: "watch",
    },
  ];
}

function playerProfile(player: Player) {
  const entries = [
    { label: "CHG", value: player.byType.CHG, role: "attaque" },
    { label: "ZONAGE", value: player.byType.ZONAGE, role: "milieu" },
    { label: "DECHG", value: player.byType.DECHG, role: "défense" },
  ].sort((a, b) => b.value - a.value);
  const leader = entries[0];
  const title = player.operationTypes >= 2 ? `Profil ${player.role.toLowerCase()} avec appui polyvalent` : `Spécialiste ${leader.label}`;
  const detail =
    player.operationTypes >= 2
      ? `${player.name} intervient sur ${player.operationTypes} activités. Point fort : ${leader.label} avec ${leader.value} opération(s).`
      : `${player.name} est surtout mobilisé en ${leader.role}. Lecture utile pour stabiliser ce poste.`;
  return {
    title,
    detail,
    evolution: "Évolution : historique non disponible dans ce fichier importé.",
  };
}

function playerTimeRange(player: Player) {
  if (!player.firstOperation || !player.lastOperation) return "Non dispo.";
  return `${formatTime(player.firstOperation)} - ${formatTime(player.lastOperation)}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDuration(milliseconds: number) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function statusClass(status: MatchStatus) {
  if (status === "MAÎTRISÉ") return "is-mastered";
  if (status === "À SURVEILLER") return "is-watch";
  return "is-action";
}

function roleClass(role: string) {
  if (role === "Attaquant") return "attack";
  if (role === "Milieu") return "midfield";
  return "defense";
}

function roleCode(role: string) {
  if (role === "Attaquant") return "CHG";
  if (role === "Milieu") return "ZONAGE";
  return "DECHG";
}

function roleHelp(role: string) {
  if (role === "Attaquant") return "Chargement";
  if (role === "Milieu") return "Zonage";
  return "Déchargement";
}
