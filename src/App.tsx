import { FormEvent, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import {
  AlertTriangle,
  Award,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  CreditCard,
  ClipboardList,
  Clock3,
  Crown,
  Dumbbell,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileCheck2,
  CircleHelp,
  LayoutDashboard,
  Lock,
  Maximize2,
  Medal,
  MousePointerClick,
  Minimize2,
  RefreshCw,
  Save,
  Shield,
  Shirt,
  Sparkles,
  Settings2,
  Target,
  Trophy,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Agency, Highlight, Player, Snapshot } from "./types";
import { MatchIndicatorsCarousel } from "./MatchIndicatorsCarousel";
import { KickoffMusicControl } from "./KickoffMusicControl";
import { parseMercatoEntrants, type MercatoProfile, type MercatoProfiles } from "./mercato";

type Session = {
  agency: Agency;
  accessCode: string;
};

type CauserieContentZone = "attack" | "midfield" | "defense";
type CauserieAttachments = Record<CauserieContentZone, string[]>;

type CauseriePlan = {
  team: string;
  manager: string;
  updatedAt: string | null;
  attack: string[];
  midfield: string[];
  defense: string[];
  attachments: CauserieAttachments;
  mercato: string;
  mercatoProfiles: MercatoProfiles;
  redCards: string;
  coach: {
    tactic: string;
    priority: string;
    arbitration: string;
    review: string;
  };
};

type MatchKpiCopy = {
  injuriesValue: string;
  expectedPlayersValue: string;
};

type CauserieToast = {
  title: string;
  detail: string;
  tone: "success" | "warning" | "error" | "loading";
} | null;

type Screen = "kickoff" | "match" | "composition" | "player" | "coach" | "tv" | "import" | "guide" | "admin";
type CompositionViewId = "full" | "first" | "second" | "q1" | "q2" | "q3" | "q4" | "custom";

const screens: Array<{ id: Exclude<Screen, "player">; label: string; icon: LucideIcon; step: string }> = [
  { id: "kickoff", label: "Coup d'envoi", icon: CirclePlay, step: "01" },
  { id: "match", label: "Feuille de match", icon: LayoutDashboard, step: "02" },
  { id: "composition", label: "Composition", icon: Shirt, step: "03" },
  { id: "coach", label: "Coach", icon: Dumbbell, step: "04" },
  { id: "tv", label: "BRIEF ÉQUIPE", icon: Eye, step: "05" },
  { id: "import", label: "Import", icon: Upload, step: "MAJ" },
  { id: "guide", label: "Guide", icon: BookOpen, step: "?" },
  { id: "admin", label: "Administrateur", icon: Settings2, step: "ADM" },
];

type LeagueId = "bronze" | "argent" | "or" | "platine";

type LeagueConfig = {
  id: LeagueId;
  label: string;
  tone: "bronze" | "silver" | "gold" | "platinum";
  description: string;
  zonageMinutes: number;
  loadingSeconds: number;
  unloadingSeconds: number;
  scoreTargetPercent: number;
};
type PerformanceCriteria = Pick<LeagueConfig, "zonageMinutes" | "loadingSeconds" | "unloadingSeconds" | "scoreTargetPercent">;
type AgencySyncState = {
  snapshotRevision: string | null;
  leagueConfigRevision: string | null;
  causerieRevision: string | null;
};

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const leagueOptions: LeagueConfig[] = [
  { id: "bronze", label: "Bronze", tone: "bronze", description: "Un niveau accessible pour installer les standards.", zonageMinutes: 45, loadingSeconds: 195, unloadingSeconds: 75, scoreTargetPercent: 45 },
  { id: "argent", label: "Argent", tone: "silver", description: "Le niveau de référence actuellement proposé.", zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 },
  { id: "or", label: "Or", tone: "gold", description: "Un niveau plus exigeant pour tirer la performance vers le haut.", zonageMinutes: 25, loadingSeconds: 150, unloadingSeconds: 55, scoreTargetPercent: 60 },
  { id: "platine", label: "Platine", tone: "platinum", description: "Le niveau d’excellence, à confirmer sur plusieurs imports.", zonageMinutes: 20, loadingSeconds: 135, unloadingSeconds: 50, scoreTargetPercent: 70 },
];

const zonageMinuteOptions = Array.from({ length: 120 }, (_, index) => index + 1);
const loadingTimeOptions = [105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 300];
const unloadingTimeOptions = [30, 40, 45, 50, 55, 60, 75, 90, 105, 120];

type StorageKind = "local" | "session";

function readStorageValue(kind: StorageKind, key: string) {
  try {
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(kind: StorageKind, key: string, value: string) {
  try {
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    storage.setItem(key, value);
  } catch {
    // The remote API remains the source of truth when browser storage is unavailable.
  }
}

function removeStorageValue(kind: StorageKind, key: string) {
  try {
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    storage.removeItem(key);
  } catch {
    // There is nothing else to do when browser storage is unavailable.
  }
}

function readLeagueConfigs(agencyCode: string): LeagueConfig[] {
  const saved = readStorageValue("local", `stef-match-league-configs-${agencyCode}`);
  if (!saved) return leagueOptions;
  try {
    const parsed = JSON.parse(saved) as Array<Partial<LeagueConfig>>;
    return leagueOptions.map((defaultLeague) => {
      const savedLeague = parsed.find((league) => league.id === defaultLeague.id);
      const zonageMinutes = Number(savedLeague?.zonageMinutes);
      const loadingSeconds = Number(savedLeague?.loadingSeconds);
      const unloadingSeconds = Number(savedLeague?.unloadingSeconds);
      const scoreTargetPercent = Number(savedLeague?.scoreTargetPercent);
      return {
        ...defaultLeague,
        zonageMinutes: Number.isFinite(zonageMinutes) ? Math.max(1, zonageMinutes) : defaultLeague.zonageMinutes,
        loadingSeconds: Number.isFinite(loadingSeconds) ? Math.max(1, loadingSeconds) : defaultLeague.loadingSeconds,
        unloadingSeconds: Number.isFinite(unloadingSeconds) ? Math.max(1, unloadingSeconds) : defaultLeague.unloadingSeconds,
        scoreTargetPercent: Number.isFinite(scoreTargetPercent) ? Math.min(100, Math.max(1, Math.round(scoreTargetPercent))) : defaultLeague.scoreTargetPercent,
      };
    });
  } catch {
    return leagueOptions;
  }
}

function readLeagueConfig(agencyCode: string, leagueId: LeagueId): LeagueConfig {
  return readLeagueConfigs(agencyCode).find((league) => league.id === leagueId) ?? leagueOptions[1];
}

function mergeLeagueConfigs(value: unknown, agencyCode: string): LeagueConfig[] {
  if (!Array.isArray(value)) return readLeagueConfigs(agencyCode);
  return leagueOptions.map((defaultLeague) => {
    const shared = value.find((league) => (league as Partial<LeagueConfig>)?.id === defaultLeague.id) as Partial<LeagueConfig> | undefined;
    return {
      ...defaultLeague,
      zonageMinutes: Number.isFinite(Number(shared?.zonageMinutes)) ? Math.max(1, Math.round(Number(shared?.zonageMinutes))) : defaultLeague.zonageMinutes,
      loadingSeconds: Number.isFinite(Number(shared?.loadingSeconds)) ? Math.max(1, Math.round(Number(shared?.loadingSeconds))) : defaultLeague.loadingSeconds,
      unloadingSeconds: Number.isFinite(Number(shared?.unloadingSeconds)) ? Math.max(1, Math.round(Number(shared?.unloadingSeconds))) : defaultLeague.unloadingSeconds,
      scoreTargetPercent: Number.isFinite(Number(shared?.scoreTargetPercent)) ? Math.min(100, Math.max(1, Math.round(Number(shared?.scoreTargetPercent)))) : defaultLeague.scoreTargetPercent,
    };
  });
}

function configForLeague(configs: LeagueConfig[], leagueId: LeagueId): LeagueConfig {
  return configs.find((league) => league.id === leagueId) ?? leagueOptions.find((league) => league.id === leagueId) ?? leagueOptions[1];
}

function readActiveLeague(agencyCode: string): LeagueId {
  const saved = readStorageValue("local", `stef-match-active-league-${agencyCode}`);
  return leagueOptions.some((league) => league.id === saved) ? saved as LeagueId : "argent";
}

type CompositionRole = "Attaquant" | "Milieu" | "Défenseur";
type MatchCeremonyTone = "victory" | "controlled" | "finalize" | "rework";
type MatchAwardKind = "attack" | "midfield" | "defense" | "polyvalent";

type MatchAward = {
  kind: MatchAwardKind;
  label: string;
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
  { role: "Défenseur", zone: "defense", title: "DÉFENSE", code: "DECHG", helper: "Réception des palettes" },
];

const kickoffScenePlayers: Array<{
  id: string;
  team: "stef" | "opponent";
  x: number;
  y: number;
  dx: number;
  dy: number;
  keeper?: boolean;
  starter?: boolean;
}> = [
  { id: "stef-gk", team: "stef", x: 10, y: 50, dx: 1.2, dy: 0, keeper: true },
  { id: "stef-def-1", team: "stef", x: 20, y: 20, dx: 1.1, dy: -0.8 },
  { id: "stef-def-2", team: "stef", x: 20, y: 40, dx: 1.1, dy: -0.4 },
  { id: "stef-def-3", team: "stef", x: 20, y: 60, dx: 1.1, dy: 0.4 },
  { id: "stef-def-4", team: "stef", x: 20, y: 80, dx: 1.1, dy: 0.8 },
  { id: "stef-mid-1", team: "stef", x: 30, y: 40, dx: 1.8, dy: -1.2 },
  { id: "stef-mid-2", team: "stef", x: 30, y: 60, dx: 1.8, dy: 1.2 },
  { id: "stef-am-1", team: "stef", x: 39, y: 25, dx: 2.2, dy: -1.4 },
  { id: "stef-am-2", team: "stef", x: 39, y: 50, dx: 2.4, dy: -1.8 },
  { id: "stef-am-3", team: "stef", x: 39, y: 75, dx: 2.2, dy: 1.4 },
  { id: "stef-9", team: "stef", x: 46, y: 50, dx: 3.2, dy: -2.4, starter: true },
  { id: "opp-gk", team: "opponent", x: 90, y: 50, dx: -1.2, dy: 0, keeper: true },
  { id: "opp-def-1", team: "opponent", x: 80, y: 20, dx: -1.1, dy: -0.8 },
  { id: "opp-def-2", team: "opponent", x: 80, y: 40, dx: -1.1, dy: -0.4 },
  { id: "opp-def-3", team: "opponent", x: 80, y: 60, dx: -1.1, dy: 0.4 },
  { id: "opp-def-4", team: "opponent", x: 80, y: 80, dx: -1.1, dy: 0.8 },
  { id: "opp-mid-1", team: "opponent", x: 70, y: 40, dx: -1.8, dy: -1.2 },
  { id: "opp-mid-2", team: "opponent", x: 70, y: 60, dx: -1.8, dy: 1.2 },
  { id: "opp-am-1", team: "opponent", x: 61, y: 25, dx: -2.2, dy: -1.4 },
  { id: "opp-am-2", team: "opponent", x: 61, y: 50, dx: -2.4, dy: 1.8 },
  { id: "opp-am-3", team: "opponent", x: 61, y: 75, dx: -2.2, dy: -1.4 },
  { id: "opp-9", team: "opponent", x: 54, y: 50, dx: -3.2, dy: 2.4 },
];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [leagueConfigs, setLeagueConfigs] = useState<LeagueConfig[]>(leagueOptions);
  const [activeLeague, setActiveLeague] = useState<LeagueId>("argent");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotViewRevision, setSnapshotViewRevision] = useState(0);
  const [causerieRevision, setCauserieRevision] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("kickoff");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [playerReturnScreen, setPlayerReturnScreen] = useState<Screen>("composition");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const snapshotRequestRef = useRef(0);
  const backgroundRefreshRef = useRef(0);
  const agencySyncStateRef = useRef<{ agencyCode: string; state: AgencySyncState } | null>(null);
  const leagueConfigSaveQueueRef = useRef(Promise.resolve());
  const leagueConfigsRef = useRef(leagueConfigs);
  const snapshotRef = useRef(snapshot);
  leagueConfigsRef.current = leagueConfigs;
  snapshotRef.current = snapshot;

  const publishSnapshot = useCallback((nextSnapshot: Snapshot | null) => {
    const current = snapshotRef.current;
    const sameData = nextSnapshot === null
      ? current === null
      : snapshotsHaveSameData(current, nextSnapshot);
    snapshotRef.current = nextSnapshot;
    if (!sameData) setSnapshotViewRevision((revision) => revision + 1);
    setSnapshot(nextSnapshot);
  }, []);

  function queueLeagueConfigSave(next: LeagueConfig[]) {
    const currentSession = session;
    if (!currentSession) return Promise.reject(new Error("Session absente."));
    const save = leagueConfigSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await saveSharedLeagueConfigs(currentSession, next);
        setLeagueConfigs(saved);
      });
    leagueConfigSaveQueueRef.current = save.then(() => undefined, () => undefined);
    return save;
  }

  useEffect(() => {
    const saved = readStorageValue("session", "stef-match-session");
    if (!saved) return;
    try {
      const nextSession = JSON.parse(saved) as Session;
      const nextLeague = readActiveLeague(nextSession.agency.code);
      setSession(nextSession);
      setActiveLeague(nextLeague);
      setSnapshotLoading(true);
      const requestId = ++snapshotRequestRef.current;
      let initialSyncState: AgencySyncState | null = null;
      fetchAgencySyncState(nextSession)
        .then((state) => {
          initialSyncState = state;
        })
        .catch(() => undefined)
        .then(() => Promise.all([
          fetchSharedLeagueConfigs(nextSession).catch(() => readLeagueConfigs(nextSession.agency.code)),
        ]))
        .then(([nextConfigs]) => {
          if (requestId !== snapshotRequestRef.current) return null;
          setLeagueConfigs(nextConfigs);
          return fetchSnapshot(nextSession, configForLeague(nextConfigs, nextLeague));
        })
        .then((nextSnapshot) => {
          if (!nextSnapshot || requestId !== snapshotRequestRef.current) return;
          publishSnapshot(nextSnapshot);
          if (initialSyncState) {
            agencySyncStateRef.current = { agencyCode: nextSession.agency.code, state: initialSyncState };
          }
          setStatusMessage("");
        })
        .catch((error) => {
          if (requestId !== snapshotRequestRef.current) return;
          publishSnapshot(null);
          if (error instanceof ApiError && error.status === 404 && initialSyncState) {
            agencySyncStateRef.current = { agencyCode: nextSession.agency.code, state: initialSyncState };
          }
          setStatusMessage(error instanceof Error ? error.message : "Le match n'a pas pu être chargé.");
        })
        .finally(() => {
          if (requestId === snapshotRequestRef.current) setSnapshotLoading(false);
        });
    } catch {
      removeStorageValue("session", "stef-match-session");
    }
  }, [publishSnapshot]);

  useEffect(() => {
    document.body.classList.toggle("tv-screen-active", screen === "tv");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    return () => document.body.classList.remove("tv-screen-active");
  }, [screen]);

  // An agency import is shared by all screens, but each browser keeps its
  // current snapshot in memory. Refresh visible screens so a second display
  // does not remain on the previous import indefinitely.
  useEffect(() => {
    if (!session || screen === "import") return;
    let disposed = false;
    let syncInProgress = false;

    const syncSharedSnapshot = async () => {
      if (syncInProgress) return;
      syncInProgress = true;
      const requestVersion = snapshotRequestRef.current;
      const refreshId = ++backgroundRefreshRef.current;
      try {
        const nextSyncState = await fetchAgencySyncState(session, snapshotRef.current?.match.date);
        if (disposed || refreshId !== backgroundRefreshRef.current || requestVersion !== snapshotRequestRef.current) return;

        const previous = agencySyncStateRef.current?.agencyCode === session.agency.code
          ? agencySyncStateRef.current.state
          : null;
        const configsChanged = !previous || previous.leagueConfigRevision !== nextSyncState.leagueConfigRevision;
        const snapshotChanged = !previous || previous.snapshotRevision !== nextSyncState.snapshotRevision;
        const causerieChanged = !previous || previous.causerieRevision !== nextSyncState.causerieRevision;
        if (!configsChanged && !snapshotChanged && !causerieChanged) return;

        let nextConfigs = leagueConfigsRef.current;
        if (configsChanged) {
          nextConfigs = await fetchSharedLeagueConfigs(session);
          if (disposed || refreshId !== backgroundRefreshRef.current || requestVersion !== snapshotRequestRef.current) return;
          leagueConfigsRef.current = nextConfigs;
          setLeagueConfigs(nextConfigs);
        }

        if (nextSyncState.snapshotRevision === null) {
          if (previous?.snapshotRevision || snapshotRef.current) {
            publishSnapshot(null);
            setStatusMessage("Le snapshot de cette agence n'est plus présent sur le serveur. Les données source doivent être réimportées.");
          }
          if (causerieChanged) setCauserieRevision(nextSyncState.causerieRevision);
          agencySyncStateRef.current = { agencyCode: session.agency.code, state: nextSyncState };
          return;
        }

        if (snapshotChanged || configsChanged) {
          const nextSnapshot = await fetchSnapshot(session, configForLeague(nextConfigs, activeLeague));
          if (disposed || refreshId !== backgroundRefreshRef.current || requestVersion !== snapshotRequestRef.current) return;
          publishSnapshot(nextSnapshot);
          setStatusMessage("");
        }
        if (causerieChanged) setCauserieRevision(nextSyncState.causerieRevision);
        agencySyncStateRef.current = { agencyCode: session.agency.code, state: nextSyncState };
      } catch {
        // A transient refresh failure must not blank a valid operational view.
      } finally {
        syncInProgress = false;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") void syncSharedSnapshot();
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncSharedSnapshot();
    }, 15000);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      disposed = true;
      backgroundRefreshRef.current += 1;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [session, activeLeague, screen, publishSnapshot]);

  async function handleLogin(agencyCode: string, accessCode: string) {
    const requestId = ++snapshotRequestRef.current;
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
      const nextLeague = readActiveLeague(agencyCode);
      const nextSyncState = await fetchAgencySyncState(nextSession).catch(() => null);
      const nextConfigs = await fetchSharedLeagueConfigs(nextSession).catch(() => readLeagueConfigs(agencyCode));
      let nextSnapshot: Snapshot | null = null;
      try {
        nextSnapshot = await fetchSnapshot(nextSession, configForLeague(nextConfigs, nextLeague));
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
      if (requestId !== snapshotRequestRef.current) return;
      setSession(nextSession);
      setLeagueConfigs(nextConfigs);
      setActiveLeague(nextLeague);
      setCauserieRevision(null);
      agencySyncStateRef.current = nextSyncState
        ? { agencyCode: nextSession.agency.code, state: nextSyncState }
        : null;
      writeStorageValue("session", "stef-match-session", JSON.stringify(nextSession));
      publishSnapshot(nextSnapshot);
      setScreen("kickoff");
    } catch (error) {
      if (requestId === snapshotRequestRef.current) {
        setStatusMessage(error instanceof Error ? error.message : "Accès refusé.");
      }
    } finally {
      if (requestId === snapshotRequestRef.current) setLoading(false);
    }
  }

  async function handleLogout() {
    snapshotRequestRef.current += 1;
    agencySyncStateRef.current = null;
    removeStorageValue("session", "stef-match-session");
    setSession(null);
    setActiveLeague("argent");
    setCauserieRevision(null);
    publishSnapshot(null);
    setSelectedPlayer(null);
    setScreen("kickoff");
  }

  async function refreshSnapshot() {
    if (!session) return;
    const requestId = ++snapshotRequestRef.current;
    setSnapshotLoading(true);
    try {
      const nextSnapshot = await fetchSnapshot(session, configForLeague(leagueConfigs, activeLeague));
      if (requestId !== snapshotRequestRef.current) return;
      publishSnapshot(nextSnapshot);
      setStatusMessage("");
    } catch (error) {
      // Keep the last valid snapshot visible when a refresh is temporarily unavailable.
      if (requestId === snapshotRequestRef.current) {
        setStatusMessage(error instanceof Error ? error.message : "L'actualisation n'a pas pu être effectuée.");
      }
    } finally {
      if (requestId === snapshotRequestRef.current) setSnapshotLoading(false);
    }
  }

  async function applyLeague(id: LeagueId, config = configForLeague(leagueConfigs, id)) {
    if (!session) {
      setActiveLeague(id);
      return;
    }
    const requestId = ++snapshotRequestRef.current;
    backgroundRefreshRef.current += 1;
    setSnapshotLoading(true);
    setStatusMessage("");
    try {
      const nextSnapshot = await fetchSnapshot(session, config);
      if (requestId !== snapshotRequestRef.current) return;
      setActiveLeague(id);
      writeStorageValue("local", `stef-match-active-league-${session.agency.code}`, id);
      publishSnapshot(nextSnapshot);
      setStatusMessage("");
    } catch (error) {
      if (requestId === snapshotRequestRef.current) {
        if (error instanceof ApiError && error.status === 404) {
          if (!snapshot) {
            setActiveLeague(id);
            writeStorageValue("local", `stef-match-active-league-${session.agency.code}`, id);
            setStatusMessage("Ligue activée. Importe un match pour appliquer ses objectifs.");
          } else {
            setStatusMessage("Ligue non modifiée : le serveur ne retrouve pas l’Excel source pour recalculer. Les résultats et la ligue actuels sont conservés. Réimporte l’Excel uniquement si la source a été perdue.");
          }
          return;
        }
        setStatusMessage(error instanceof Error ? `Ligue non modifiée : ${error.message}` : "Ligue non modifiée : le recalcul n'a pas abouti. Les résultats actuels sont conservés.");
      }
    } finally {
      if (requestId === snapshotRequestRef.current) setSnapshotLoading(false);
    }
  }

  function openPlayer(player: Player) {
    setPlayerReturnScreen(screen);
    setSelectedPlayer(player);
    setScreen("player");
  }

  if (!session) {
    return <LoginView onLogin={handleLogin} loading={loading} message={statusMessage} />;
  }

  const playerScreen = screen === "player";
  const activeLeagueConfig = configForLeague(leagueConfigs, activeLeague);

  return (
    <div className={`app-shell league-${activeLeagueConfig.id}`}>
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">FC STEF</div>
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
                aria-label={`${item.step} ${item.label}`}
                disabled={snapshotLoading && !snapshot && !["kickoff", "import", "guide", "admin", "tv"].includes(item.id)}
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
        <TopBar
          snapshot={snapshot}
          agency={session.agency}
          activeLeague={activeLeagueConfig}
          onRefresh={refreshSnapshot}
          message={statusMessage}
          onTimeRangeChange={async (start, end) => {
            if (snapshot?.match.periodStart === start && snapshot.match.periodEnd === end) return;
            const requestId = ++snapshotRequestRef.current;
            // Invalidate an automatic refresh already in flight so it cannot
            // overwrite the newly calculated active range with an old snapshot.
            backgroundRefreshRef.current += 1;
            setSnapshotLoading(true);
            try {
              const nextSnapshot = await updateTimeRange(session, start, end, activeLeagueConfig);
              if (requestId === snapshotRequestRef.current) {
                publishSnapshot(nextSnapshot);
                setStatusMessage("");
              }
            } catch (error) {
              if (requestId === snapshotRequestRef.current) {
                setStatusMessage(error instanceof Error ? error.message : "La plage horaire n'a pas pu être actualisée.");
              }
              throw error instanceof Error ? error : new Error("La plage horaire n'a pas pu être actualisée.");
            } finally {
              if (requestId === snapshotRequestRef.current) setSnapshotLoading(false);
            }
          }}
          loading={snapshotLoading}
        />
        <KickoffMusicControl active={screen === "kickoff" || screen === "match"} />
        {snapshotLoading && !snapshot ? (
          <LoadingView />
        ) : !snapshot && screen !== "import" && screen !== "kickoff" && screen !== "guide" && screen !== "tv" && screen !== "admin" ? (
          <NoDataView onImport={() => setScreen("import")} />
        ) : (
          <div className="screen-transition" key={screen === "import" ? `import-${session.agency.code}` : screen === "match" ? `match-${session.agency.code}` : `${screen}-${snapshotViewRevision}`}>
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
                session={session}
                causerieRevision={causerieRevision}
                activeLeague={activeLeague}
                onPlayer={openPlayer}
                onCoach={() => setScreen("coach")}
                onComposition={() => setScreen("composition")}
                onTravelExclusionChange={async (travelCode, excluded) => {
                  if (!session) return;
                  try {
                    const nextSnapshot = await updateTravelExclusion(session, travelCode, excluded);
                    publishSnapshot(nextSnapshot);
                    setStatusMessage("");
                  } catch (error) {
                    setStatusMessage(error instanceof Error ? error.message : "Le périmètre des voyages n'a pas pu être actualisé.");
                  }
                }}
              />
            )}
            {screen === "composition" && snapshot && <Composition snapshot={snapshot} session={session} onPlayer={openPlayer} />}
            {playerScreen && snapshot && selectedPlayer && (
              <PlayerSheet
                snapshot={snapshot}
                player={selectedPlayer}
                onBack={() => setScreen(playerReturnScreen === "player" ? "composition" : playerReturnScreen)}
                onSelect={setSelectedPlayer}
              />
            )}
            {screen === "coach" && snapshot && (
              <Coach snapshot={snapshot} session={session} leagueConfig={activeLeagueConfig} onPlayer={openPlayer} onComposition={() => setScreen("composition")} />
            )}
            {screen === "tv" && (snapshot ? <TvMode snapshot={snapshot} session={session} causerieRevision={causerieRevision} onExit={() => setScreen("kickoff")} /> : <NoDataView onImport={() => setScreen("import")} onBack={() => setScreen("kickoff")} />)}
            {screen === "guide" && <GuideView snapshot={snapshot} leagueConfigs={leagueConfigs} onNavigate={setScreen} />}
            {screen === "admin" && <AdministratorView agencyCode={session.agency.code} activeLeague={activeLeague} leagueConfigs={leagueConfigs} onLeagueConfigsChange={queueLeagueConfigSave} onActiveLeagueChange={applyLeague} />}
            {screen === "import" && (
              <ImportView
                session={session}
                onImported={(next) => {
                  const requestId = ++snapshotRequestRef.current;
                  setStatusMessage("");
                  publishSnapshot(next);
                  setSelectedPlayer(next.players[0] ?? null);
                  setSnapshotLoading(true);
                  fetchSnapshot(session, activeLeagueConfig)
                    .then((activeLeagueSnapshot) => {
                      if (requestId === snapshotRequestRef.current) publishSnapshot(activeLeagueSnapshot);
                    })
                    .catch(() => {
                      // Keep the imported snapshot visible if the follow-up league rebuild fails.
                      if (requestId === snapshotRequestRef.current) publishSnapshot(next);
                    })
                    .finally(() => {
                      if (requestId === snapshotRequestRef.current) setSnapshotLoading(false);
                    });
                }}
                onOpenMatch={() => setScreen("match")}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

async function fetchSnapshot(session: Session, criteria?: PerformanceCriteria): Promise<Snapshot> {
  const query = criteria
    ? `?${new URLSearchParams({
        zonageMinutes: String(criteria.zonageMinutes),
        loadingSeconds: String(criteria.loadingSeconds),
        unloadingSeconds: String(criteria.unloadingSeconds),
        scoreTargetPercent: String(criteria.scoreTargetPercent),
      })}`
    : "";
  const response = await fetch(`/api/agencies/${encodeURIComponent(session.agency.code)}/snapshot${query}`, {
    cache: "no-store",
    headers: { "x-access-code": session.accessCode },
  });
  const payload = await response.json();
  if (!response.ok) throw new ApiError(response.status, payload.message ?? "Le match n'a pas pu être chargé.");
  return payload.snapshot;
}

async function fetchAgencySyncState(session: Session, matchDate?: string): Promise<AgencySyncState> {
  const query = matchDate ? `?matchDate=${encodeURIComponent(matchDate)}` : "";
  const response = await fetch(`/api/agencies/${encodeURIComponent(session.agency.code)}/sync-state${query}`, {
    cache: "no-store",
    headers: { "x-access-code": session.accessCode },
  });
  const payload = await response.json();
  if (!response.ok) throw new ApiError(response.status, payload.message ?? "L'état de synchronisation n'a pas pu être chargé.");
  const { snapshotRevision, leagueConfigRevision, causerieRevision = null } = payload as AgencySyncState;
  if (
    (snapshotRevision !== null && typeof snapshotRevision !== "string") ||
    (leagueConfigRevision !== null && typeof leagueConfigRevision !== "string") ||
    (causerieRevision !== null && typeof causerieRevision !== "string")
  ) {
    throw new Error("L'état de synchronisation reçu est invalide.");
  }
  return { snapshotRevision, leagueConfigRevision, causerieRevision };
}

async function fetchSharedLeagueConfigs(session: Session): Promise<LeagueConfig[]> {
  const response = await fetch(`/api/agencies/${encodeURIComponent(session.agency.code)}/league-configs`, {
    cache: "no-store",
    headers: { "x-access-code": session.accessCode },
  });
  const payload = await response.json();
  if (!response.ok) throw new ApiError(response.status, payload.message ?? "Les paramètres des ligues n'ont pas pu être chargés.");
  return mergeLeagueConfigs(payload.configs, session.agency.code);
}

async function saveSharedLeagueConfigs(session: Session, configs: LeagueConfig[]): Promise<LeagueConfig[]> {
  const response = await fetch(`/api/agencies/${encodeURIComponent(session.agency.code)}/league-configs`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-access-code": session.accessCode },
    body: JSON.stringify({ configs }),
  });
  const payload = await response.json();
  if (!response.ok) throw new ApiError(response.status, payload.message ?? "Les paramètres des ligues n'ont pas pu être enregistrés.");
  return mergeLeagueConfigs(payload.configs, session.agency.code);
}

function snapshotsHaveSameData(left: Snapshot | null, right: Snapshot): boolean {
  if (!left) return false;
  const comparable = (snapshot: Snapshot) => {
    const { importedAt: _importedAt, ...data } = snapshot;
    return data;
  };
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

async function updateTimeRange(session: Session, start: string, end: string, criteria?: PerformanceCriteria): Promise<Snapshot> {
  const response = await fetch(`/api/agencies/${encodeURIComponent(session.agency.code)}/time-range`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": session.accessCode,
    },
    body: JSON.stringify({ start, end, criteria }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? "La plage horaire n'a pas pu être actualisée.");
  return payload.snapshot;
}

async function updateTravelExclusion(session: Session, travelCode: string, excluded: boolean): Promise<Snapshot> {
  const response = await fetch(`/api/agencies/${encodeURIComponent(session.agency.code)}/travel-exclusions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": session.accessCode,
    },
    body: JSON.stringify({ travelCode, excluded }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? "Le périmètre d'analyse n'a pas pu être actualisé.");
  if (!payload.snapshot || typeof payload.snapshot !== "object") {
    throw new Error("Le recalcul du périmètre n'a pas renvoyé de résultat exploitable.");
  }
  return payload.snapshot;
}

async function fetchCompositionRange(session: Session, start: string, end: string): Promise<{ label: string; players: Player[] }> {
  const response = await fetch(`/api/agencies/${encodeURIComponent(session.agency.code)}/composition-range`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": session.accessCode,
    },
    body: JSON.stringify({ start, end }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? "La sous-plage de composition n'a pas pu être chargée.");
  return { label: payload.range.label, players: payload.players };
}

async function fetchCauseriePlan(session: Session, snapshot: Snapshot): Promise<CauseriePlan | null> {
  const localPlan = readLocalCauseriePlan(snapshot);
  try {
    const response = await fetch(
      `/api/agencies/${encodeURIComponent(session.agency.code)}/causerie?matchDate=${encodeURIComponent(snapshot.match.date)}`,
      { headers: { "x-access-code": session.accessCode }, cache: "no-store" }
    );
    if (!response.ok) throw new Error("Causerie non disponible.");
    const payload = await response.json();
    return payload.plan ?? localPlan;
  } catch (error) {
    if (localPlan) return localPlan;
    throw error;
  }
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
  const savedPlan = payload.plan as CauseriePlan;
  if (!savedPlan || typeof savedPlan !== "object") {
    throw new Error("Le serveur a renvoyé une causerie invalide. Réessaie après actualisation.");
  }
  const savedProfiles = savedPlan?.mercatoProfiles ?? {};
  const profileWasDropped = Object.entries(plan.mercatoProfiles ?? {}).some(([key, profile]) => savedProfiles[key] !== profile);
  if (profileWasDropped) {
    throw new Error("Le serveur n'a pas conservé les choix Femme/Homme. Tes choix restent dans le formulaire ; actualise le service puis réessaie.");
  }
  writeLocalCauseriePlan(snapshot, savedPlan);
  return savedPlan;
}

async function prepareCauserieImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Sélectionne une image PNG, JPG ou WebP.");
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const maxWidth = 1400;
    const maxHeight = 900;
    const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = 0.78;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > 240_000 && quality > 0.46) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > 260_000) throw new Error("Cette capture est trop lourde. Réduis sa taille puis réessaie.");
    return dataUrl;
  } finally {
    URL.revokeObjectURL(source);
  }
}

function LoginView({ onLogin, loading, message }: { onLogin: (agencyCode: string, accessCode: string) => void; loading: boolean; message: string }) {
  const [agencyCode, setAgencyCode] = useState("058");
  const [accessCode, setAccessCode] = useState("");
  const [agencies, setAgencies] = useState<Array<Pick<Agency, "code" | "name">>>([
    { code: "058", name: "Agen - 058" },
    { code: "01K", name: "Montpellier" },
    { code: "05R", name: "Toulouse" },
    { code: "04P", name: "Bordeaux" },
  ]);

  useEffect(() => {
    fetch("/api/agencies")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Agences indisponibles"))))
      .then((payload: { agencies?: Array<Pick<Agency, "code" | "name">> }) => {
        if (payload.agencies?.length) setAgencies(payload.agencies);
      })
      .catch(() => {
        // Keep the local list available if the public catalogue is temporarily unavailable.
      });
  }, []);

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
            <div className="brand-mark">FC STEF</div>
            <div>
              <p>STEF</p>
              <h1>Match Center</h1>
            </div>
          </div>
          <h2>Le vestiaire privé de ton agence.</h2>
          <p>Dépose l'Excel actualisé, puis transforme le match du quai en lecture simple et actionnable.</p>
          <div className="login-signature" aria-label="Signature de réalisation">
            <span>Réalisé par</span>
            <strong>Arnaud Szymaniak</strong>
            <a href="mailto:arnaud.szymaniak@stef.com">Contact : arnaud.szymaniak@stef.com</a>
          </div>
        </div>
        <form className="login-form" onSubmit={submit}>
          <span className="eyebrow">Accès agence</span>
          <h2>Entrer dans le Match Center</h2>
          <label>
            Agence
            <select aria-label="Code agence" value={agencyCode} onChange={(event) => setAgencyCode(event.target.value)}>
              {agencies.map((agency) => (
                <option key={agency.code} value={agency.code}>
                  {agency.name}{agency.name.includes(agency.code) ? "" : ` - ${agency.code}`}
                </option>
              ))}
            </select>
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

function TopBar({ snapshot, agency, activeLeague, onRefresh, onTimeRangeChange, loading, message }: { snapshot: Snapshot | null; agency: Agency; activeLeague: (typeof leagueOptions)[number]; onRefresh: () => void; onTimeRangeChange: (start: string, end: string) => Promise<void>; loading: boolean; message: string }) {
  const [start, setStart] = useState(snapshot?.match.periodStart ?? "13:00");
  const [end, setEnd] = useState(snapshot?.match.periodEnd ?? "22:30");
  const [savingRange, setSavingRange] = useState(false);
  const [rangeError, setRangeError] = useState("");

  useEffect(() => {
    setStart(snapshot?.match.periodStart ?? "13:00");
    setEnd(snapshot?.match.periodEnd ?? "22:30");
    setRangeError("");
  }, [snapshot?.match.periodStart, snapshot?.match.periodEnd]);

  async function submitTimeRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!start || !end || start === end) {
      setRangeError("Choisis un début et une fin valides, par pas de 30 minutes.");
      return;
    }
    setSavingRange(true);
    setRangeError("");
    try {
      await onTimeRangeChange(start, end);
    } catch (error) {
      setRangeError(error instanceof Error ? error.message : "La plage horaire n'a pas pu être actualisée.");
    } finally {
      setSavingRange(false);
    }
  }

  return (
    <header className="top-bar">
      <div>
        <p className="eyebrow">Espace agence</p>
        <h2>{agency.name}</h2>
      </div>
      <div className="top-actions">
        <div className={`top-league-badge ${activeLeague.tone}`} aria-label={`Ligue active : ${activeLeague.label}`}>
          <LeagueIcon leagueId={activeLeague.id} size={17} />
          <span>Ligue</span>
          <strong>{activeLeague.label}</strong>
        </div>
        {snapshot && (
          <form className="time-range-control" onSubmit={submitTimeRange}>
            <span><Clock3 size={15} /> Plage active</span>
            <small className="time-range-hint">pas de 30 min · fin incluse</small>
            <label>
              <span className="sr-only">Début</span>
              <input type="time" min="00:00" max="23:30" step={1800} value={start} onChange={(event) => setStart(event.target.value)} />
            </label>
            <b>à</b>
            <label>
              <span className="sr-only">Fin</span>
              <input type="time" min="00:00" max="23:30" step={1800} value={end} onChange={(event) => setEnd(event.target.value)} />
            </label>
            <button className="secondary-button compact" type="submit" disabled={savingRange || loading}>
              {savingRange ? "Mise à jour..." : "Appliquer"}
            </button>
            {rangeError && <small className="time-range-error">{rangeError}</small>}
          </form>
        )}
        <span>{snapshot ? `Dernière actualisation : ${formatDateTime(snapshot.importedAt)}` : "Aucun match importé"}</span>
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={16} />
          {loading ? "Actualisation..." : "Actualiser"}
        </button>
      </div>
      {message && <div className="top-status-message" role="status" aria-live="polite">{message}</div>}
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

function ActivePeriodBadge({ snapshot, className = "" }: { snapshot: Snapshot; className?: string }) {
  return (
    <span className={`active-period-badge ${className}`.trim()}>
      <Clock3 size={14} />
      Plage {snapshot.match.timeRangeLabel}
    </span>
  );
}

function NoDataView({ onImport, onBack }: { onImport: () => void; onBack?: () => void }) {
  return (
    <section className="empty-state">
      <FileSpreadsheet size={42} />
      <h2>Aucun match importé</h2>
      <p>Dépose l'Excel actualisé pour créer la première feuille de match de cette agence.</p>
      <button className="primary-button" type="button" onClick={onImport}>
        <Upload size={18} />
        Importer le match
      </button>
      {onBack && (
        <button className="secondary-button" type="button" onClick={onBack}>
          <ChevronLeft size={18} />
          Retour au coup d'envoi
        </button>
      )}
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
          <button className="secondary-on-dark" type="button" onClick={onTv}>
            <Eye size={18} />
            BRIEF ÉQUIPE
          </button>
        </div>
      </header>

      <div className="kickoff-scoreboard">
        <span>STEF MATCH CENTER</span>
        <strong>{scoreboardState}</strong>
        <small>{snapshot.agency.name} - {formatDate(snapshot.match.lastOperation ?? snapshot.match.date)} - {snapshot.match.timeRangeLabel}</small>
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
                  className={`kickoff-player-token ${player.team} ${player.keeper ? "keeper" : ""} ${player.starter ? "starter" : ""}`}
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

          <div className="kickoff-context-grid">
            <div>
              <span>Site</span>
              <strong>{snapshot.agency.name}</strong>
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
            Préparer le brief équipe
          </button>
        </aside>
      </div>
    </section>
  );
}

function MatchSheet({ snapshot, session, causerieRevision, activeLeague, onPlayer, onCoach, onComposition, onTravelExclusionChange }: { snapshot: Snapshot; session: Session; causerieRevision: string | null; activeLeague: LeagueId; onPlayer: (player: Player) => void; onCoach: () => void; onComposition: () => void; onTravelExclusionChange: (travelCode: string, excluded: boolean) => Promise<void> }) {
  const [celebrationMode, setCelebrationMode] = useState(false);
  const [thresholdPulse, setThresholdPulse] = useState(false);
  const [editingKpis, setEditingKpis] = useState(false);
  const [kpiCopy, setKpiCopy] = useState<MatchKpiCopy>(() => loadMatchKpiCopy(snapshot));
  const [savedKpiCopy, setSavedKpiCopy] = useState<MatchKpiCopy>(kpiCopy);
  const [mercatoPlan, setMercatoPlan] = useState<{ key: string; plan: CauseriePlan | null } | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [slideDirection, setSlideDirection] = useState<"next" | "previous">("next");
  const [pendingTravelCode, setPendingTravelCode] = useState<string | null>(null);
  const slideViewportRef = useRef<HTMLDivElement | null>(null);
  const slideTouchStart = useRef<{ x: number; y: number } | null>(null);
  const slideLabels = ["Coup de sifflet final", "Cérémonie des performances", "Statistiques du match", "Brief équipe"];
  const mercatoPlanKey = `${session.agency.code}:${snapshot.match.date}:${snapshot.importedAt}`;
  const mercatoText = mercatoPlan?.key === mercatoPlanKey ? mercatoPlan.plan?.mercato ?? "" : null;
  const mercatoProfiles = mercatoPlan?.key === mercatoPlanKey ? mercatoPlan.plan?.mercatoProfiles ?? {} : {};
  const leagueConfig = readLeagueConfig(snapshot.agency.code, activeLeague);
  const loadingTarget = formatReadableDuration(snapshot.performanceCriteria?.loadingSeconds ?? leagueConfig.loadingSeconds);
  const scoreIndicators = operationalScoreIndicators(snapshot);
  const footballScore = buildFootballScore(snapshot, snapshot.performanceCriteria?.scoreTargetPercent ?? leagueConfig.scoreTargetPercent);
  const thresholdReached = footballScore.available && footballScore.goalsFor > footballScore.goalsAgainst;
  const outcome = matchCeremonyOutcome(footballScore);
  const teamMotivation = teamMotivationMessage(footballScore);
  const awards = reorderMatchSheetAwards(buildAwardItems(snapshot));
  const playersByName = new Map(snapshot.players.map((player) => [player.name, player]));
  const jerseyNumbers = buildJerseyNumbers(snapshot.players);

  useEffect(() => {
    document.body.classList.toggle("match-celebration-active", celebrationMode);
    return () => document.body.classList.remove("match-celebration-active");
  }, [celebrationMode]);

  useEffect(() => {
    let cancelled = false;
    fetchCauseriePlan(session, snapshot)
      .then((plan) => {
        if (!cancelled) setMercatoPlan({ key: mercatoPlanKey, plan: plan ? normalizeCauseriePlan(plan) : null });
      })
      .catch(() => {
        if (!cancelled) setMercatoPlan({ key: mercatoPlanKey, plan: null });
      });
    return () => {
      cancelled = true;
    };
  }, [mercatoPlanKey, session, snapshot, causerieRevision]);

  useEffect(() => {
    if (!thresholdReached) return;
    setThresholdPulse(true);
    const timer = window.setTimeout(() => setThresholdPulse(false), 3200);
    return () => window.clearTimeout(timer);
  }, [footballScore.goalsFor, footballScore.goalsAgainst, footballScore.available, thresholdReached]);

  useEffect(() => {
    slideViewportRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeSlide]);

  function moveSlide(nextIndex: number) {
    const next = Math.max(0, Math.min(slideLabels.length - 1, nextIndex));
    if (next !== activeSlide) setSlideDirection(next > activeSlide ? "next" : "previous");
    setActiveSlide(next);
  }

  function handleSlideKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!(event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End")) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, textarea, select, [contenteditable='true'], .match-indicators, .operational-charts-carousel")) return;
    event.preventDefault();
    moveSlide(event.key === "Home" ? 0 : event.key === "End" ? slideLabels.length - 1 : activeSlide + (event.key === "ArrowRight" ? 1 : -1));
  }

  function handleSlideTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest(".match-indicators, .operational-charts-carousel, input, textarea, select, [contenteditable='true']")) return;
    const touch = event.touches[0];
    if (touch) slideTouchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleSlideTouchEnd(event: ReactTouchEvent<HTMLDivElement>) {
    const start = slideTouchStart.current;
    slideTouchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    moveSlide(activeSlide + (deltaX < 0 ? 1 : -1));
  }

  async function handleTravelExclusionChange(travelCode: string, excluded: boolean) {
    setPendingTravelCode(travelCode);
    try {
      await onTravelExclusionChange(travelCode, excluded);
    } finally {
      setPendingTravelCode(null);
    }
  }

  const slideClass = (index: number) => `match-slide-panel ${activeSlide === index ? `is-active is-enter-${slideDirection}` : index < activeSlide ? "is-before" : "is-after"}`;

  return (
    <div className={`${celebrationMode ? "match-page is-celebration-mode" : "match-page"} ${outcome.tone} ${thresholdReached ? "is-threshold-reached" : ""} ${thresholdPulse ? "is-threshold-pulse" : ""}`}>
      <nav className="match-carousel-navigation" aria-label="Navigation de la feuille de match">
        <div className="match-carousel-heading">
          <span>FEUILLE DE MATCH</span>
          <strong aria-live="polite">{slideLabels[activeSlide]}</strong>
        </div>
        <div className="match-carousel-controls">
          {celebrationMode && (
            <button
              type="button"
              className="match-exit-celebration"
              onClick={() => {
                setCelebrationMode(false);
                setActiveSlide(0);
              }}
              aria-label="Sortir du mode Célébration"
              title="Sortir du mode Célébration"
            >
              <Minimize2 size={15} />
              <span>Sortir du mode Célébration</span>
            </button>
          )}
          <span className="match-carousel-count" aria-live="polite">0{activeSlide + 1} / 04</span>
          <button type="button" className="match-carousel-arrow" onClick={() => moveSlide(activeSlide - 1)} disabled={activeSlide === 0} aria-label="Section précédente" title="Section précédente">
            <ChevronLeft size={20} />
          </button>
          <button type="button" className="match-carousel-arrow" onClick={() => moveSlide(activeSlide + 1)} disabled={activeSlide === slideLabels.length - 1} aria-label="Section suivante" title="Section suivante">
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="match-carousel-progress" aria-label="Accès direct aux sections">
          {slideLabels.map((label, index) => (
            <button
              type="button"
              className={index <= activeSlide ? "is-active" : ""}
              key={label}
              aria-label={`Aller à ${label}`}
              aria-current={index === activeSlide ? "step" : undefined}
              title={`Aller à ${label}`}
              onClick={() => moveSlide(index)}
            />
          ))}
        </div>
      </nav>
      <div ref={slideViewportRef} className="match-slide-viewport" role="group" aria-label="Sections de la feuille de match" tabIndex={0} onKeyDown={handleSlideKeyDown} onTouchStart={handleSlideTouchStart} onTouchEnd={handleSlideTouchEnd}>
      <section className={`match-ceremony ${outcome.tone} ${slideClass(0)}`} aria-hidden={activeSlide !== 0} inert={activeSlide !== 0} aria-roledescription="diapositive" aria-label="1 sur 4 : Coup de sifflet final">
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
            <span>{snapshot.agency.name} - Match du {formatDate(snapshot.match.lastOperation ?? snapshot.match.date)} - {snapshot.match.timeRangeLabel}</span>
            <ActivePeriodBadge snapshot={snapshot} />
          </div>
          <div className="match-header-actions">
            <span className={`match-header-league-trophy ${activeLeague}`} aria-label={`Trophée de la ligue ${activeLeague}`}>
              <span className={`trophy-cup small league-trophy ${activeLeague}`} aria-hidden="true">
                <LeagueIcon leagueId={activeLeague} size={28} className="league-trophy-icon" />
                <i />
              </span>
            </span>
            {!celebrationMode && (
              <button className="secondary-on-dark" type="button" onClick={() => setCelebrationMode(true)}>
                <Maximize2 size={16} />
                Mode célébration
              </button>
            )}
            <button className="secondary-on-dark" type="button" onClick={onComposition}>
              <Shirt size={16} />
              Composition
            </button>
          </div>
        </header>

        <div className="match-result-stage">
          <div className="match-result-visual">
            <FootballScoreDisplay footballScore={footballScore} />
            <YellowCardsPanel snapshot={snapshot} />
          </div>

          <div className="match-scoreboard">
            <span>STEF MATCH CENTER</span>
            <strong>{outcome.verdict}</strong>
            <div className="match-score-bubbles" aria-label="Scores du match">
              <div className={`match-score-bubble pass-score-bubble ${Number.isFinite(scoreIndicators.passRate) ? "" : "is-data-unavailable"}`}>
                <span>% passes réussies</span>
                <strong>{formatPercent(scoreIndicators.passRate)}</strong>
                <small>Part des passes réussies parmi toutes les passes contrôlées<br />pendant la période sélectionnée</small>
              </div>
              <div className={`match-score-bubble loading-score-bubble ${Number.isFinite(scoreIndicators.loadingPercent) ? "" : "is-data-unavailable"}`}>
                <span>% tirs cadrés</span>
                <strong>{formatPercent(scoreIndicators.loadingPercent)}</strong>
                <small>Chargement avec une moyenne<br />inférieure ou égale à {loadingTarget}/poz</small>
              </div>
              <div className={`match-score-bubble reception-score-bubble ${Number.isFinite(scoreIndicators.unloadingPercent) ? "" : "is-data-unavailable"}`}>
                <span>% duels gagnés</span>
                <strong>{formatPercent(scoreIndicators.unloadingPercent)}</strong>
                <small>Voyages dans la cible selon le temps maximum par position</small>
              </div>
              <div className={`match-score-bubble possession-score-bubble ${Number.isFinite(scoreIndicators.possessionPercent) ? "" : "is-data-unavailable"}`}>
                <span>% possession</span>
                <strong>{formatPercent(scoreIndicators.possessionPercent)}</strong>
                <small>Zonage dynamique</small>
              </div>
            </div>
          </div>

        </div>

        <div className="match-indicators-area">
          <MatchIndicatorsCarousel
            snapshot={snapshot}
            performance={outcome.collectiveTitle}
            motivation={teamMotivation}
            injuries={kpiCopy.injuriesValue}
            staffPercent={formatRealStaffPercent(snapshot, kpiCopy.expectedPlayersValue)}
            staffDetail={formatRealStaffDetail(snapshot, kpiCopy.expectedPlayersValue)}
            mercato={mercatoText}
            mercatoProfiles={mercatoProfiles}
          />
          <div className="match-kpi-wrap">
            {editingKpis && (
              <div className="match-indicators-editor">
                <label>
                  Effectif prévu du jour
                  <input type="number" min="1" step="1" inputMode="numeric" value={kpiCopy.expectedPlayersValue} onChange={(event) => setKpiCopy({ ...kpiCopy, expectedPlayersValue: event.target.value })} placeholder="À renseigner" />
                </label>
                <label>
                  Nombre de blessures A.T
                  <select value={kpiCopy.injuriesValue} onChange={(event) => setKpiCopy({ ...kpiCopy, injuriesValue: event.target.value })}>
                    <option value="">À renseigner</option>
                    {Array.from({ length: 100 }, (_, value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className="match-kpi-actions">
              {editingKpis ? (
                <>
                  <button className="secondary-button compact" type="button" onClick={() => { setKpiCopy(savedKpiCopy); setEditingKpis(false); }}>Annuler</button>
                  <button className="secondary-button compact" type="button" onClick={() => setKpiCopy(defaultMatchKpiCopy())}>Réinitialiser les chiffres</button>
                  <button className="primary-button compact" type="button" onClick={() => { const next = normalizeMatchKpiCopy(kpiCopy); writeStorageValue("local", matchKpiStorageKey(snapshot), JSON.stringify(next)); setKpiCopy(next); setSavedKpiCopy(next); setEditingKpis(false); }}>Enregistrer les chiffres</button>
                </>
              ) : (
                <button className="secondary-button compact" type="button" onClick={() => setEditingKpis(true)}><Edit3 size={15} />Modifier les chiffres</button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className={`awards-ceremony ${slideClass(1)}`} aria-hidden={activeSlide !== 1} inert={activeSlide !== 1} aria-roledescription="diapositive" aria-label="2 sur 4 : Cérémonie des performances">
        <div className="awards-heading">
          <div>
            <p className="eyebrow">Cérémonie des performances</p>
            <h2>Joueurs clés par ligne</h2>
            <span>Une référence par catégorie métier : Attaque CHG, Milieu ZONAGE, Défense · Réception.</span>
          </div>
        </div>

        <div className="awards-stage category-awards-stage">
          {awards.length > 0 ? (
            <div className="special-awards category-awards">
              {awards.map((award, index) => {
                const player = playersByName.get(award.highlight.name);
                const jersey = formatJerseyNumber(jerseyNumbers.get(award.highlight.name) ?? index + 1);
                const role = player?.role ?? award.highlight.role;
                const challengers = buildAwardChallengers(snapshot.players, award);
                const leaderScore = awardReferenceScore(award, player);
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
                      <span className="award-leader-score" aria-label={`Score du premier : ${formatNumber(leaderScore.value)}${leaderScore.suffix} ${leaderScore.label}`}>
                        <b>{formatNumber(leaderScore.value)}{leaderScore.suffix}</b>
                        <small>{leaderScore.label}</small>
                      </span>
                    </span>
                    <span className="award-challengers">
                      <strong>CHALLENGERS</strong>
                      {challengers.length > 0 ? challengers.map((challenger) => (
                        <span className="award-challenger" key={challenger.player.name}>
                          <b>{challenger.player.name}</b>
                          <small>{award.kind === "polyvalent"
                            ? `${formatNumber(challenger.score)}% polyvalence · ${challenger.scoreDelta === 0 ? "à égalité" : `${challenger.scoreDelta > 0 ? "-" : "+"}${formatNumber(Math.abs(challenger.scoreDelta))} point(s) avec le premier`}`
                            : `${formatNumber(challenger.positions)} poz · ${challenger.positionDelta === 0 ? "à égalité" : `${challenger.positionDelta > 0 ? "-" : "+"}${formatNumber(Math.abs(challenger.positionDelta))} avec le premier`}`}</small>
                        </span>
                      )) : <small>Aucun challenger disponible</small>}
                    </span>
                    <span className="podium-step" aria-hidden="true">{award.podiumLabel}</span>
                    <em>Voir sa fiche</em>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="award-empty-state">
              <strong>Aucune distinction disponible</strong>
              <p>Le fichier importé ne contient pas assez de données Chargement, Zonage ou Réception pour désigner les trois joueurs clés.</p>
            </div>
          )}
        </div>
      </section>

      <section className={`match-statistics-section ${slideClass(2)}`} aria-hidden={activeSlide !== 2} inert={activeSlide !== 2} aria-roledescription="diapositive" aria-label="3 sur 4 : Statistiques du match">
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
          <OperationalChartsCarousel
            snapshot={snapshot}
            canEditTravelScope={session.agency.canImport}
            onToggleTravel={handleTravelExclusionChange}
            pendingTravelCode={pendingTravelCode}
          />
        </div>
      </section>
      <section className={`match-brief-slide ${slideClass(3)}`} aria-hidden={activeSlide !== 3} inert={activeSlide !== 3} aria-roledescription="diapositive" aria-label="4 sur 4 : Brief équipe">
        <BriefTeamPlan
          snapshot={snapshot}
          session={session}
          sharedPlan={{ ready: mercatoPlan?.key === mercatoPlanKey, plan: mercatoPlan?.key === mercatoPlanKey ? mercatoPlan.plan : null }}
          onPlanSaved={(plan) => setMercatoPlan({ key: mercatoPlanKey, plan })}
        />
      </section>
      </div>
    </div>
  );
}

type TravelScopeToggle = (travelCode: string, excluded: boolean) => Promise<void>;

function OperationalChartsCarousel({ snapshot, canEditTravelScope, onToggleTravel, pendingTravelCode }: { snapshot: Snapshot; canEditTravelScope: boolean; onToggleTravel: TravelScopeToggle; pendingTravelCode: string | null }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Array<HTMLElement | null>>([]);
  const cards = [
    {
      id: "passes-hourly",
      label: "% passes réussies par heure",
      content: <PerformanceChart snapshot={snapshot} />,
    },
    {
      id: "reception-time",
      label: "% duels gagnés",
      content: <ReceptionQualityCard snapshot={snapshot} canEditTravelScope={canEditTravelScope} onToggleTravel={onToggleTravel} pendingTravelCode={pendingTravelCode} />,
    },
    {
      id: "loading",
      label: "% tirs cadrés",
      content: <LoadingQualityCard snapshot={snapshot} canEditTravelScope={canEditTravelScope} onToggleTravel={onToggleTravel} pendingTravelCode={pendingTravelCode} />,
    },
    {
      id: "centers",
      label: "% centres réussis",
      content: <CentersQualityCard snapshot={snapshot} />,
    },
  ];

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const handleScroll = () => {
      const viewportCenter = viewport.getBoundingClientRect().left + viewport.clientWidth / 2;
      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      slideRefs.current.forEach((slide, index) => {
        if (!slide) return;
        const slideRect = slide.getBoundingClientRect();
        const slideCenter = slideRect.left + slideRect.width / 2;
        const distance = Math.abs(viewportCenter - slideCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });
      setActiveIndex((current) => current === closestIndex ? current : closestIndex);
    };
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [cards.length]);

  const goToSlide = (requestedIndex: number) => {
    const nextIndex = (requestedIndex + cards.length) % cards.length;
    const viewport = viewportRef.current;
    const slide = slideRefs.current[nextIndex];
    if (!viewport || !slide) return;
    const viewportRect = viewport.getBoundingClientRect();
    const slideRect = slide.getBoundingClientRect();
    const targetLeft = viewport.scrollLeft + slideRect.left + slideRect.width / 2 - (viewportRect.left + viewport.clientWidth / 2);
    viewport.scrollTo({ left: targetLeft, behavior: "smooth" });
    setActiveIndex(nextIndex);
  };

  return (
    <section className="operational-charts-carousel" aria-label="Carrousel de lecture opérationnelle">
      {snapshot.excludedTravelCodes && snapshot.excludedTravelCodes.length > 0 && (
        <details className="travel-exclusion-panel" open>
          <summary><EyeOff size={15} /> Voyages exclus de l'analyse <span>{formatNumber(snapshot.excludedTravelCodes.length)}</span></summary>
          <div className="travel-exclusion-list">
            {snapshot.excludedTravelCodes.map((travelCode) => (
              <button
                type="button"
                className="travel-restore-button"
                key={travelCode}
                disabled={!canEditTravelScope || pendingTravelCode === travelCode}
                onClick={() => void onToggleTravel(travelCode, false)}
              >
                <RefreshCw size={14} />
                <span>Réintégrer {travelCode}</span>
              </button>
            ))}
          </div>
        </details>
      )}
      <div className="operational-charts-carousel-toolbar">
        <span className="operational-charts-carousel-counter" aria-live="polite">{activeIndex + 1} / {cards.length}</span>
        <div className="operational-charts-carousel-actions">
          <button type="button" className="icon-button" onClick={() => goToSlide(activeIndex - 1)} aria-label="Graphique précédent" title="Graphique précédent">
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="icon-button" onClick={() => goToSlide(activeIndex + 1)} aria-label="Graphique suivant" title="Graphique suivant">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div
        className="operational-charts-carousel-viewport"
        ref={viewportRef}
        role="region"
        aria-label="Graphiques de lecture opérationnelle"
        tabIndex={0}
        onKeyDown={(event) => {
          if (!(["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))) return;
          event.preventDefault();
          const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? cards.length - 1 : activeIndex + (event.key === "ArrowRight" ? 1 : -1);
          goToSlide(nextIndex);
        }}
      >
        <div className="operational-charts-carousel-track">
          {cards.map((card, index) => (
            <article
              className={`operational-chart-slide ${activeIndex === index ? "is-active" : ""}`}
              key={card.id}
              ref={(element) => { slideRefs.current[index] = element; }}
              aria-label={`${card.label}, graphique ${index + 1} sur ${cards.length}`}
            >
              {card.content}
            </article>
          ))}
        </div>
      </div>

      <div className="operational-charts-carousel-dots" role="tablist" aria-label="Sélection du graphique">
        {cards.map((card, index) => (
          <button
            className={activeIndex === index ? "is-active" : ""}
            key={card.id}
            type="button"
            role="tab"
            aria-selected={activeIndex === index}
            aria-label={`Afficher ${card.label}`}
            onClick={() => goToSlide(index)}
          />
        ))}
      </div>
    </section>
  );
}

function CentersQualityCard({ snapshot }: { snapshot: Snapshot }) {
  const pdf = snapshot.dailyIndicators;
  const percent = pdf?.punctuality.destinationPunctuality;
  const target = pdf?.punctualityTargets?.destinationPunctuality;
  const hasData = Number.isFinite(percent);
  const successfulPercent = hasData ? Math.max(0, Math.min(100, percent as number)) : 0;
  const offTargetPercent = hasData ? 100 - successfulPercent : null;
  const pdfDetail = pdf?.referenceDate ? `PDF 106J · ${pdf.referenceDate}` : "PDF 106J";

  return (
    <section className="loading-quality-card centers-quality-card" aria-label="Pourcentage de centres réussis">
      <div className="loading-quality-heading">
        <div>
          <span>Centres</span>
          <strong>% centres réussis</strong>
          <p className="loading-quality-explanation">Ponctualité destination issue du PDF 106J.</p>
        </div>
        {hasData && <b>{formatPercent(percent)}</b>}
      </div>
      {hasData ? (
        <div className="loading-quality-overview">
          <div
            className="loading-quality-pie centers-quality-pie"
            style={{ background: `conic-gradient(#73b9a6 0 ${successfulPercent}%, #ef0b45 ${successfulPercent}% 100%)` }}
            aria-label={`${formatPercent(percent)} centres réussis, ${formatPercent(offTargetPercent)} hors cible${target === undefined ? "" : `, objectif ${formatPercent(target)}`}`}
          >
            <span>{formatPercent(percent)}</span>
          </div>
          <div className="loading-quality-legend">
            <span><i className="is-targeted" />Réussis <b>{formatPercent(percent)}{target === undefined ? "" : ` · objectif ${formatPercent(target)}`}</b></span>
            <span><i className="is-off-target" />Hors cible <b>{formatPercent(offTargetPercent)}</b></span>
          </div>
        </div>
      ) : (
        <p className="loading-quality-empty">Importe le PDF 106J pour afficher le taux de centres réussis.</p>
      )}
      <details className="duel-quality-details centers-quality-details">
        <summary>Voir les éléments hors cible <span>{formatPercent(offTargetPercent)}</span></summary>
        <p className="loading-quality-empty">
          {hasData
            ? `${pdfDetail} fournit un taux consolidé de ponctualité destination, mais pas le détail par voyage ou par position.`
            : "Le détail sera disponible après import du PDF 106J."}
        </p>
      </details>
    </section>
  );
}


function LoadingQualityCard({ snapshot, canEditTravelScope, onToggleTravel, pendingTravelCode }: { snapshot: Snapshot; canEditTravelScope: boolean; onToggleTravel: TravelScopeToggle; pendingTravelCode: string | null }) {
  const quality = snapshot.loadingQuality;
  if (!quality) return null;
  const loadingTarget = formatReadableDuration(snapshot.performanceCriteria?.loadingSeconds ?? 165);
  const total = quality.targeted + quality.offTarget;
  const hasData = total > 0 && Number.isFinite(quality.targetedPercent) && Number.isFinite(quality.offTargetPercent);
  const targetedPercent = quality.targetedPercent ?? 0;

  return (
    <section className="loading-quality-card" aria-label="Qualité des chargements">
      <div className="loading-quality-heading">
        <div>
          <span>Chargements</span>
          <strong>% tirs cadrés</strong>
          <p className="loading-quality-explanation">Chargement avec une moyenne inférieure ou égale à {loadingTarget} par position. Les tirs non cadrés sont identifiables par le point rouge.</p>
        </div>
        {hasData && <b>{formatNumber(total)} chargements</b>}
      </div>
      {hasData ? (
        <div className="loading-quality-overview">
          <div
            className="loading-quality-pie"
            style={{ background: `conic-gradient(#73b9a6 0 ${targetedPercent}%, #ef0b45 ${targetedPercent}% 100%)` }}
            aria-label={`${formatPercent(quality.targetedPercent)} cadrés, ${formatPercent(quality.offTargetPercent)} non cadrés`}
          >
            <span>{formatPercent(quality.targetedPercent)}</span>
          </div>
          <div className="loading-quality-legend">
            <span><i className="is-targeted" />Cadrés <b>{formatNumber(quality.targeted)} chargements · {formatPercent(quality.targetedPercent)}</b></span>
            <span><i className="is-off-target" />Non cadrés <b>{formatNumber(quality.offTarget)} chargements · {formatPercent(quality.offTargetPercent)}</b></span>
          </div>
        </div>
      ) : (
        <p className="loading-quality-empty">Aucune donnée de chargement disponible dans cet import Excel.</p>
      )}
      {quality.nonTargetedShots.length > 0 && (
        <details className="duel-quality-details loading-quality-details">
          <summary>Voir les tirs non cadrés <span>{formatNumber(quality.nonTargetedShots.length)}</span></summary>
          <div className="loading-quality-table-wrap">
          <div className="loading-quality-table" role="table" aria-label="Détails des tirs non cadrés">
            <div className={`loading-quality-table-row is-head ${canEditTravelScope ? "has-travel-action" : ""}`} role="row">
              <span>Voyage</span><span>Heure</span><span>Nb poz</span><span>Temps/poz</span><span>Frappe</span><span>Résultat</span>{canEditTravelScope && <span>Action</span>}
            </div>
            {quality.nonTargetedShots.map((shot) => (
              <div className={`loading-quality-table-row ${canEditTravelScope ? "has-travel-action" : ""}`} role="row" key={`${shot.travelCode}-${shot.time}`}>
                <span>{shot.travelCode}</span><span>{shot.time}</span><span>{shot.positions}</span><span>{shot.timePerPosition}</span><span>{shot.where}</span><span><i className="loading-result-dot is-off-target" title="Non cadré" aria-label="Non cadré" /></span>{canEditTravelScope && <span className="travel-action-cell"><button type="button" className="travel-visibility-button" disabled={pendingTravelCode === shot.travelCode} onClick={() => void onToggleTravel(shot.travelCode, true)} aria-label={`Masquer le voyage ${shot.travelCode}`} title={`Masquer le voyage ${shot.travelCode}`}><EyeOff size={14} /></button></span>}
              </div>
            ))}
          </div>
          </div>
        </details>
      )}
    </section>
  );
}

function ReceptionQualityCard({ snapshot, canEditTravelScope, onToggleTravel, pendingTravelCode }: { snapshot: Snapshot; canEditTravelScope: boolean; onToggleTravel: TravelScopeToggle; pendingTravelCode: string | null }) {
  const quality = snapshot.unloadingQuality;
  const duelQuality = snapshot.unloadingDuelQuality;
  if (!quality) return null;
  const total = quality.targeted + quality.offTarget;
  const hasData = total > 0 && Number.isFinite(quality.targetedPercent) && Number.isFinite(quality.offTargetPercent);
  const targetedPercent = quality.targetedPercent ?? 0;
  const target = formatReadableDuration(snapshot.performanceCriteria?.unloadingSeconds ?? 60);
  const average = quality.averageTimePerPositionSeconds === null || quality.averageTimePerPositionSeconds === undefined
    ? null
    : formatReadableDuration(quality.averageTimePerPositionSeconds);
  return (
    <section className="loading-quality-card loading-duel-quality-card reception-quality-card" aria-label="% Duels gagnés">
      <div className="loading-quality-heading">
        <div>
          <span>Déchargement</span>
          <strong>% Duels gagnés</strong>
          <p className="loading-quality-explanation">Voyages dans la cible : temps moyen inférieur ou égal à {target}/poz.</p>
        </div>
        <b>{formatNumber(total)} voyages</b>
      </div>
      {hasData && (
        <div className="loading-quality-overview">
          <div
            className="loading-quality-pie reception-quality-pie"
            style={{ background: `conic-gradient(#73b9a6 0 ${targetedPercent}%, #ef0b45 ${targetedPercent}% 100%)` }}
            aria-label={`${formatPercent(quality.targetedPercent)} dans la cible, ${formatPercent(quality.offTargetPercent)} hors cible`}
          >
            <span>{formatPercent(quality.targetedPercent)}</span>
          </div>
          <div className="loading-quality-legend">
            <span><i className="is-targeted" />Dans la cible <b>{formatNumber(quality.targeted)} voyages · {formatPercent(quality.targetedPercent)}</b></span>
            <span><i className="is-off-target" />Hors cible <b>{formatNumber(quality.offTarget)} voyages · {formatPercent(quality.offTargetPercent)}</b></span>
          </div>
        </div>
      )}
      {!hasData && <p className="loading-quality-empty">Aucune donnée de réception disponible sur cette plage.</p>}
      {average && <p className="reception-quality-average">Moyenne observée : <strong>{average}/poz</strong></p>}
      {duelQuality && (
        <details className="duel-quality-details">
          <summary>Voir les duels perdus <span>{formatNumber(duelQuality.lostDuels.length)}</span></summary>
          {duelQuality.lostDuels.length > 0 ? (
            <div className="duel-quality-table-wrap">
              <div className="duel-quality-table" role="table" aria-label="Duels perdus">
                <div className={`duel-quality-table-row is-head ${canEditTravelScope ? "has-travel-action" : ""}`} role="row">
                  <span>Voyage</span><span>Agence</span><span>Heure</span><span>Nb poz</span><span>Temps/poz</span><span>Résultat</span>{canEditTravelScope && <span>Action</span>}
                </div>
                {duelQuality.lostDuels.map((duel) => (
                  <div className={`duel-quality-table-row ${canEditTravelScope ? "has-travel-action" : ""}`} role="row" key={`${duel.travelCode}-${duel.time}`}>
                    <span>{duel.travelCode}</span><span>{duel.agency}</span><span>{duel.time}</span><span>{formatNumber(duel.positions)}</span><span>{duel.timePerPosition}</span><span className="duel-result duel-result-perdu">perdu</span>{canEditTravelScope && <span className="travel-action-cell"><button type="button" className="travel-visibility-button" disabled={pendingTravelCode === duel.travelCode} onClick={() => void onToggleTravel(duel.travelCode, true)} aria-label={`Masquer le voyage ${duel.travelCode}`} title={`Masquer le voyage ${duel.travelCode}`}><EyeOff size={14} /></button></span>}
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="loading-quality-empty">Aucun duel à détailler sur cette plage.</p>}
        </details>
      )}
    </section>
  );
}

function PerformanceChart({ snapshot }: { snapshot: Snapshot }) {
  const data = snapshot.hourlyPerformance ?? [];
  // The chart total is scoped to the displayed hourly series. The operational
  // score is a separate four-indicator contract and must not replace it.
  const totalPassRate = snapshot.summary.passRate ?? null;
  const [wideShortPresentation, setWideShortPresentation] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 2200px) and (max-height: 900px)");
    const sync = () => setWideShortPresentation(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const width = wideShortPresentation ? 2600 : 1440;
  const height = wideShortPresentation ? 330 : 600;
  const left = wideShortPresentation ? 80 : 92;
  const right = wideShortPresentation ? 40 : 42;
  const top = wideShortPresentation ? 18 : 30;
  const bottom = wideShortPresentation ? 44 : 76;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const points = data.map((item, index) => ({
    ...item,
    x: data.length <= 1 ? left + chartWidth / 2 : left + (index / (data.length - 1)) * chartWidth,
    y: top + ((100 - item.rate) / 100) * chartHeight,
  }));
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const areaPath = points.length > 0
    ? `${path} L ${points[points.length - 1].x} ${top + chartHeight} L ${points[0].x} ${top + chartHeight} Z`
    : "";

  return (
    <div className="performance-chart-panel">
      <div className="performance-chart-heading">
        <div>
          <span>Performance horaire</span>
          <strong>% passes réussies</strong>
          <small className="performance-chart-caption">Donnée Excel Feuille de match, heure par heure</small>
        </div>
        <div className="performance-chart-total">
          <small>Total</small>
          <b>{formatPercent(totalPassRate)}</b>
        </div>
      </div>
      {data.length > 0 ? (
        <svg className="performance-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Évolution horaire du pourcentage de passes réussies">
          <rect className="performance-chart-plot" x={left} y={top} width={chartWidth} height={chartHeight} rx="10" />
          {[0, 20, 40, 60, 80, 100].map((value) => {
            const y = top + ((100 - value) / 100) * chartHeight;
            return <g key={value}><line x1={left} x2={width - right} y1={y} y2={y} /><text x={left - 12} y={y + 4}>{value}%</text></g>;
          })}
          <path className="performance-chart-area" d={areaPath} />
          <path className="performance-chart-line" d={path} />
          {points.map((point) => (
            <g className="performance-chart-point" key={point.label}>
              <circle cx={point.x} cy={point.y} r="6" />
              <text x={point.x} y={point.y - 14}>{point.rate}%</text>
              <text className="performance-chart-volume" x={point.x} y={point.y + 25}>{point.won !== null && point.total !== null ? `${point.won}/${point.total}` : "Excel"}</text>
              <text className="performance-chart-hour" x={point.x} y={height - 20}>{point.label}</text>
            </g>
          ))}
        </svg>
      ) : (
        <div className="performance-chart-empty">Aucune donnée horaire disponible sur cette plage.</div>
      )}
    </div>
  );
}

function Composition({ snapshot, session, onPlayer }: { snapshot: Snapshot; session: Session; onPlayer: (player: Player) => void }) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [fieldMode, setFieldMode] = useState(false);
  const [compositionView, setCompositionView] = useState<CompositionViewId>("full");
  const [customStart, setCustomStart] = useState(snapshot.match.periodStart ?? "13:00");
  const [customEnd, setCustomEnd] = useState(snapshot.match.periodEnd ?? "22:30");
  const [customComposition, setCustomComposition] = useState<{ label: string; players: Player[] } | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState("");
  const customRequestRef = useRef(0);
  const activePeriodOvernight = Boolean(snapshot.match.periodStart && snapshot.match.periodEnd && snapshot.match.periodEnd < snapshot.match.periodStart);
  const selectedPeriod = compositionView === "first" || compositionView === "second"
    ? snapshot.compositionPeriods?.[compositionView]
    : null;
  const selectedQuarter = compositionView.startsWith("q")
    ? snapshot.compositionPeriods?.quarters?.find((quarter) => quarter.id === compositionView)
    : null;
  const periodPlayers = compositionView === "full"
    ? snapshot.players
    : compositionView === "custom"
      ? customComposition?.players ?? snapshot.players
      : selectedPeriod?.players ?? selectedQuarter?.players ?? snapshot.players;
  const periodLabel = compositionView === "full"
    ? snapshot.match.timeRangeLabel
    : compositionView === "custom"
      ? customComposition?.label ?? `${customStart} - ${customEnd}`
      : selectedPeriod?.label ?? selectedQuarter?.label ?? snapshot.match.timeRangeLabel;
  const groups = buildCompositionGroups(periodPlayers);
  const selectedPlayer = selectedName ? periodPlayers.find((player) => player.name === selectedName) ?? null : null;
  const categoryWinnerNames = new Set(
    [
      snapshot.highlights.bestScorer?.name,
      snapshot.highlights.bestPasser?.name,
      snapshot.highlights.defensiveWall?.name,
    ].filter((name): name is string => Boolean(name)),
  );
  const jerseyNumbers = buildJerseyNumbers(snapshot.players);
  const roleVolumes = new Map(compositionLines.map((line) => [line.role, {
    count: groups[line.role].length,
    percent: percentValue(groups[line.role].length, periodPlayers.length),
  }]));
  const compositionSummary = `${periodPlayers.length} joueurs - ${groups.Attaquant.length} Attaque / ${groups.Milieu.length} Milieu / ${groups.Défenseur.length} Défense`;

  useEffect(() => {
    document.body.classList.toggle("composition-field-active", fieldMode);
    return () => document.body.classList.remove("composition-field-active");
  }, [fieldMode]);

  useEffect(() => {
    customRequestRef.current += 1;
    setCompositionView("full");
    setCustomStart(snapshot.match.periodStart ?? "13:00");
    setCustomEnd(snapshot.match.periodEnd ?? "22:30");
    setCustomComposition(null);
    setCustomError("");
  }, [snapshot.importedAt, snapshot.match.periodStart, snapshot.match.periodEnd]);

  useEffect(() => {
    if (selectedName && !periodPlayers.some((player) => player.name === selectedName)) setSelectedName(null);
  }, [compositionView, customComposition, selectedName, periodPlayers]);

  function selectCompositionView(next: CompositionViewId) {
    customRequestRef.current += 1;
    setCompositionView(next);
    setCustomError("");
    if (next !== "custom") setCustomComposition(null);
  }

  async function applyCustomComposition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestId = ++customRequestRef.current;
    setCustomLoading(true);
    setCustomError("");
    try {
      const result = await fetchCompositionRange(session, customStart, customEnd);
      if (requestId !== customRequestRef.current) return;
      setCustomComposition(result);
      setCompositionView("custom");
    } catch (error) {
      if (requestId !== customRequestRef.current) return;
      setCustomError(error instanceof Error ? error.message : "La sous-plage n'a pas pu être chargée.");
    } finally {
      if (requestId === customRequestRef.current) setCustomLoading(false);
    }
  }

  return (
    <section className={fieldMode ? "composition-page is-field-mode" : "composition-page"}>
      <header className="composition-header">
        <div>
          <p className="eyebrow">03 - Composition</p>
          <h2>Composition du jour</h2>
          <span>{snapshot.agency.name} - Match du {formatDate(snapshot.match.lastOperation ?? snapshot.match.date)} - Plage active : {snapshot.match.timeRangeLabel}</span>
          <small className="composition-period-label" aria-live="polite">Vue affichée : {periodLabel}</small>
          <ActivePeriodBadge snapshot={snapshot} />
        </div>
        <div className="composition-header-actions">
          <div className="composition-period-controls">
            <div className="composition-control-group">
              <span>Périodes du match</span>
              <div className="composition-half-switch" role="group" aria-label="Périodes du match">
            {([
              ["full", "Match complet"],
              ["first", "1ère mi-temps"],
              ["second", "2ème mi-temps"],
            ] as const).map(([value, label]) => (
              <button
                className={compositionView === value ? "is-active" : ""}
                key={value}
                type="button"
                aria-pressed={compositionView === value}
                onClick={() => selectCompositionView(value)}
              >
                {label}
              </button>
            ))}
              </div>
            </div>
            <div className="composition-control-group">
              <span>Quarts-temps</span>
              <div className="composition-half-switch" role="group" aria-label="Quarts-temps">
                {([
                  ["q1", "1er quart"],
                  ["q2", "2e quart"],
                  ["q3", "3e quart"],
                  ["q4", "4e quart"],
                ] as const).map(([value, label]) => (
                  <button
                    className={compositionView === value ? "is-active" : ""}
                    key={value}
                    type="button"
                    aria-pressed={compositionView === value}
                    onClick={() => selectCompositionView(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <form className="composition-custom-range" onSubmit={applyCustomComposition}>
              <span>Vue personnalisée</span>
              <div className="composition-custom-fields">
                <label>
                  <span>Début</span>
                  <input aria-label="Début de la vue personnalisée" type="time" min={activePeriodOvernight ? undefined : snapshot.match.periodStart} max={activePeriodOvernight ? undefined : snapshot.match.periodEnd} step={1800} value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
                </label>
                <b aria-hidden="true">à</b>
                <label>
                  <span>Fin</span>
                  <input aria-label="Fin de la vue personnalisée" type="time" min={activePeriodOvernight ? undefined : snapshot.match.periodStart} max={activePeriodOvernight ? undefined : snapshot.match.periodEnd} step={1800} value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
                </label>
                <button className="composition-range-apply" type="submit" disabled={customLoading}>
                  <RefreshCw size={14} className={customLoading ? "is-spinning" : ""} />
                  {customLoading ? "Chargement" : "Afficher"}
                </button>
              </div>
              <small>Dans la plage active · pas de 30 min · KPI globaux inchangés</small>
              {customError && <small className="composition-range-error" role="alert">{customError}</small>}
            </form>
          </div>
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
          <small>{compositionSummary} · {periodLabel}</small>
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
              <div className="formation-goal left" aria-hidden="true" />
              <div className="formation-goal right" aria-hidden="true" />
              <div className="formation-box left" aria-hidden="true" />
              <div className="formation-box right" aria-hidden="true" />
              <div className="formation-half" aria-hidden="true" />
              <div className="formation-circle" aria-hidden="true" />

              {compositionLines.map((line, lineIndex) => {
                const players = groups[line.role];
                const rows = splitFormationRows(players);
                return (
                  <section className={`formation-zone ${line.zone}`} key={line.role} aria-label={`${line.title} - ${line.code}`}>
                    <div className="formation-zone-label">
                      <span>{operationLabel(line.code)}</span>
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
                            const isFeatured = categoryWinnerNames.has(player.name);
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
                                title={`${player.name} - ${displayRole(player.role)} - CHG ${player.byType.CHG} / ZONAGE ${player.byType.ZONAGE} / Réception ${player.byType.DECHG}`}
                                style={style}
                                onClick={() => setSelectedName(player.name)}
                              >
                                {isFeatured && <span className="formation-star" aria-label="Joueur clé par catégorie">★</span>}
                                <span className="formation-shirt" aria-hidden="true">
                                  <b>{formatJerseyNumber(jerseyNumbers.get(player.name) ?? 0)}</b>
                                  <em>{initials(player.name)}</em>
                                </span>
                                <span className="formation-player-copy">
                                  <strong>{player.name}</strong>
                                  <small>{operationLabel(roleCode(player.role))} - {formatNumber(player.operations)} ops</small>
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
                <p>{displayRole(selectedPlayer.role)} - {operationLabel(roleCode(selectedPlayer.role))}</p>
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
                  <StatLine label="Défense - Réception" value={selectedPlayer.defensePercent} raw={selectedPlayer.byType.DECHG} />
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
                <p>Le terrain montre la répartition par catégorie : CHG en attaque, ZONAGE au milieu, Défense · Réception.</p>
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
  leagueConfig,
  onPlayer,
  onComposition,
}: {
  snapshot: Snapshot;
  session: Session;
  leagueConfig: LeagueConfig;
  onPlayer: (player: Player) => void;
  onComposition: () => void;
}) {
  const [coachMode, setCoachMode] = useState(false);
  const [coachBoardMode, setCoachBoardMode] = useState<"view" | "edit">("view");
  const [mercatoMode, setMercatoMode] = useState<"view" | "edit">("view");
  const [redCardsMode, setRedCardsMode] = useState<"view" | "edit">("view");
  const [coachPlan, setCoachPlan] = useState<CauseriePlan>(() => buildEmptyCauseriePlan());
  const [coachDraft, setCoachDraft] = useState<CauseriePlan>(() => buildEmptyCauseriePlan());
  const [mercatoDraft, setMercatoDraft] = useState("");
  const [mercatoProfilesDraft, setMercatoProfilesDraft] = useState<MercatoProfiles>({});
  const [redCardsDraft, setRedCardsDraft] = useState("");
  const [savingCoachPlan, setSavingCoachPlan] = useState(false);
  const [savingMercato, setSavingMercato] = useState(false);
  const [savingRedCards, setSavingRedCards] = useState(false);
  const [coachBoardFeedback, setCoachBoardFeedback] = useState<CauserieToast>(null);
  const [mercatoProfileFeedback, setMercatoProfileFeedback] = useState<{ tone: "success" | "error"; detail: string } | null>(null);
  const actions = coachDecisionActions(snapshot);
  const targetPercent = snapshot.performanceCriteria?.scoreTargetPercent ?? leagueConfig.scoreTargetPercent;
  const footballScore = buildFootballScore(snapshot, targetPercent);
  const yellowCards = snapshot.yellowCards ?? [];
  const redCardEntries = redCardsDraft.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  const focusPlayers = uniquePlayers([
    ...snapshot.coach.progressPlayers,
    ...snapshot.coach.playersInForm,
    ...snapshot.coach.polyvalents,
    ...snapshot.coach.specialists,
  ]).slice(0, 4);
  const decisionTone = !footballScore.available ? "missing" : footballScore.goalsFor > footballScore.goalsAgainst ? "safe" : "watch";
  const decisionLabel = !footballScore.available ? "Données à compléter" : footballScore.goalsFor > footballScore.goalsAgainst ? "Collectif sous contrôle" : "Point d'attention prioritaire";
  const primaryAction = actions[0];
  const activeCoachPlan = coachBoardMode === "edit" ? coachDraft : coachPlan;
  const activeMercatoText = mercatoMode === "edit" ? mercatoDraft : coachPlan.mercato;
  const activeMercatoProfiles = mercatoMode === "edit" ? mercatoProfilesDraft : coachPlan.mercatoProfiles;
  const activeMercatoEntrants = parseMercatoEntrants(activeMercatoText);
  const missingMercatoProfiles = activeMercatoEntrants.filter((entrant) => !activeMercatoProfiles[entrant.key]);
  const coachActionFields = [
    { field: "tactic" as const, label: "Priorité terrain", placeholder: "Ex. Sécuriser les positions prioritaires avant le prochain départ." },
    { field: "priority" as const, label: "Zone à surveiller", placeholder: "Ex. Contrôler la zone ou le voyage à suivre en priorité." },
    { field: "arbitration" as const, label: "Équilibre d'équipe", placeholder: "Ex. Renforcer la ligne qui a besoin d'un appui immédiat." },
  ];

  useEffect(() => {
    document.body.classList.toggle("coach-room-active", coachMode);
    return () => document.body.classList.remove("coach-room-active");
  }, [coachMode]);

  useEffect(() => {
    let cancelled = false;
    const emptyPlan = buildEmptyCauseriePlan();
    setCoachPlan(emptyPlan);
    setCoachDraft(emptyPlan);
    setCoachBoardMode("view");
    setMercatoMode("view");
    setMercatoDraft("");
    setMercatoProfilesDraft({});
    setRedCardsMode("view");
    setRedCardsDraft("");
    setCoachBoardFeedback(null);
    setMercatoProfileFeedback(null);
    fetchCauseriePlan(session, snapshot)
      .then((remotePlan) => {
        if (cancelled) return;
        const nextPlan = remotePlan ? normalizeCauseriePlan(remotePlan) : emptyPlan;
        const visiblePlan = hasManualCauserieContent(nextPlan, snapshot) ? nextPlan : emptyPlan;
        setCoachPlan(visiblePlan);
        setCoachDraft(visiblePlan);
        setMercatoDraft(visiblePlan.mercato);
        setMercatoProfilesDraft(visiblePlan.mercatoProfiles);
        setRedCardsDraft(visiblePlan.redCards);
      })
      .catch(() => {
        if (!cancelled) {
          setCoachBoardFeedback({
            title: "Plan non synchronisé",
            detail: "Le plan reste vide jusqu'à sa saisie.",
            tone: "warning",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, snapshot]);

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

  function startRedCardsEdit() {
    setRedCardsDraft(coachPlan.redCards);
    setRedCardsMode("edit");
    setCoachBoardFeedback(null);
  }

  function cancelRedCardsEdit() {
    setRedCardsDraft(coachPlan.redCards);
    setRedCardsMode("view");
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

  function updateMercato(value: string) {
    setMercatoProfileFeedback(null);
    setMercatoDraft(value.slice(0, 240));
  }

  function startMercatoEdit() {
    setMercatoDraft(coachPlan.mercato);
    setMercatoProfilesDraft(coachPlan.mercatoProfiles);
    setMercatoMode("edit");
    setMercatoProfileFeedback(null);
  }

  function cancelMercatoEdit() {
    setMercatoDraft(coachPlan.mercato);
    setMercatoProfilesDraft(coachPlan.mercatoProfiles);
    setMercatoMode("view");
    setMercatoProfileFeedback(null);
  }

  function updateMercatoProfile(key: string, profile: MercatoProfile) {
    if (savingMercato || savingCoachPlan) return;
    setMercatoProfilesDraft((current) => {
      return normalizeMercatoProfiles({ ...current, [key]: profile }, mercatoDraft);
    });
    setMercatoProfileFeedback(null);
  }

  async function saveMercato() {
    if (savingMercato || savingCoachPlan) return;
    const mercato = mercatoDraft.trim();
    const missingProfile = parseMercatoEntrants(mercato).find((entrant) => !mercatoProfilesDraft[entrant.key]);
    if (missingProfile) {
      const remaining = parseMercatoEntrants(mercato).filter((entrant) => !mercatoProfilesDraft[entrant.key]).length;
      setMercatoProfileFeedback({
        tone: "error",
        detail: `${remaining} profil${remaining > 1 ? "s" : ""} à choisir. Sélectionne Femme ou Homme pour chaque arrivant avant l'enregistrement.`,
      });
      return;
    }
    const nextPlan = normalizeCauseriePlan({
      ...coachPlan,
      mercato,
      mercatoProfiles: normalizeMercatoProfiles(mercatoProfilesDraft, mercato),
      updatedAt: new Date().toISOString(),
    });

    setSavingMercato(true);
    setMercatoProfileFeedback(null);
    try {
      const savedPlan = await saveCauseriePlan(session, snapshot, nextPlan);
      const normalizedPlan = normalizeCauseriePlan(savedPlan);
      setCoachPlan(normalizedPlan);
      setCoachDraft((current) => ({ ...current, mercato: normalizedPlan.mercato, mercatoProfiles: normalizedPlan.mercatoProfiles }));
      setMercatoDraft(normalizedPlan.mercato);
      setMercatoProfilesDraft(normalizedPlan.mercatoProfiles);
      setMercatoMode("view");
      setMercatoProfileFeedback({ tone: "success", detail: "Mercato enregistré et synchronisé avec la Feuille de match." });
    } catch (error) {
      setMercatoProfileFeedback({
        tone: "error",
        detail: error instanceof Error ? `Mercato non enregistré : ${error.message}` : "Mercato non enregistré. Vérifie la connexion puis réessaie.",
      });
    } finally {
      setSavingMercato(false);
    }
  }

  async function saveCoachBoard() {
    if (savingCoachPlan || savingMercato) return;
    const nextPlan = {
      ...coachDraft,
      redCards: redCardsDraft.trim(),
      attack: padPlanLines(coachDraft.attack),
      midfield: padPlanLines(coachDraft.midfield),
      defense: padPlanLines(coachDraft.defense),
      mercato: coachPlan.mercato,
      mercatoProfiles: coachPlan.mercatoProfiles,
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
      const normalizedPlan = normalizeCauseriePlan(savedPlan);
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
      writeLocalCauseriePlan(snapshot, nextPlan);
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

  async function saveRedCards() {
    const nextPlan = normalizeCauseriePlan({ ...coachPlan, redCards: redCardsDraft.trim() });
    setSavingRedCards(true);
    try {
      const savedPlan = await saveCauseriePlan(session, snapshot, nextPlan);
      const normalizedPlan = normalizeCauseriePlan(savedPlan);
      setCoachPlan(normalizedPlan);
      setCoachDraft(normalizedPlan);
      setRedCardsDraft(normalizedPlan.redCards);
      setRedCardsMode("view");
      setCoachBoardFeedback({
        title: "Cartons rouges enregistrés",
        detail: "La saisie manuelle est enregistrée pour cette agence et cette journée.",
        tone: "success",
      });
    } catch {
      setCoachPlan(nextPlan);
      setCoachDraft(nextPlan);
      setRedCardsDraft(nextPlan.redCards);
      setRedCardsMode("view");
      writeLocalCauseriePlan(snapshot, nextPlan);
      setCoachBoardFeedback({
        title: "Sauvegarde locale uniquement",
        detail: "Les cartons rouges sont conservés sur ce poste, mais ne sont pas partagés.",
        tone: "warning",
      });
    } finally {
      setSavingRedCards(false);
      window.setTimeout(() => setCoachBoardFeedback(null), 3400);
    }
  }

  return (
    <section className={coachMode ? "coach-page coach-room coach-decision-page is-coach-mode" : "coach-page coach-room coach-decision-page"}>
      <header className="coach-decision-header">
        <div>
          <p className="eyebrow">04 - Coach</p>
          <h2>Plan d'action du jour</h2>
          <p>{snapshot.agency.name} · Match du {formatDate(snapshot.match.lastOperation ?? snapshot.match.date)} · {snapshot.match.timeRangeLabel}</p>
          <ActivePeriodBadge snapshot={snapshot} />
        </div>
        <div className="coach-decision-header-actions">
          <div className={`coach-league-badge ${leagueConfig.tone}`}>
            <LeagueIcon leagueId={leagueConfig.id} />
            <span>Ligue active</span>
            <strong>{leagueConfig.label}</strong>
          </div>
          <button className="secondary-on-dark" type="button" onClick={() => setCoachMode((current) => !current)}>
            {coachMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {coachMode ? "Quitter le mode plein écran" : "Mode briefing"}
          </button>
          <button className="secondary-on-dark" type="button" onClick={onComposition}><Shirt size={16} /> Composition</button>
        </div>
      </header>

      <main className="coach-decision-scene">
        <section className="coach-command-grid">
          <article className={`coach-command-card ${decisionTone}`}>
            <div className="coach-command-heading">
              <span>Décision du jour</span>
              <strong>{decisionLabel}</strong>
            </div>
            <div className="coach-score-context">
              <div>
                <small>Score opérationnel</small>
                <b>{footballScore.available ? `${footballScore.goalsFor} - ${footballScore.goalsAgainst}` : "— - —"}</b>
              </div>
              <div>
                <small>Objectif ligue</small>
                <b>{formatNumber(targetPercent)}%</b>
              </div>
            </div>
            <div className="coach-command-action">
              <span>Priorité immédiate</span>
              <strong>{primaryAction.title}</strong>
              <p>{primaryAction.next}</p>
            </div>
            <p className="coach-motivation">{teamMotivationMessage(footballScore)}</p>
          </article>

          <section className="coach-context-panel" aria-labelledby="coach-context-title">
            <div className="coach-panel-heading">
              <div><span>Cadre de décision</span><h3 id="coach-context-title">Les repères du jour</h3></div>
              <span className="coach-context-mark" aria-hidden="true">●</span>
            </div>
            <div className="coach-context-list">
              <div><span>Plage active</span><strong>{snapshot.match.timeRangeLabel}</strong></div>
              <div><span>Activité suivie</span><strong>{formatNumber(snapshot.summary.operations)} opérations</strong></div>
              <div><span>Référence</span><strong>{leagueConfig.label} · {formatNumber(targetPercent)}%</strong></div>
              <div><span>Source</span><strong>Import Excel validé</strong></div>
            </div>
            <p className="coach-context-note">La feuille de match détaille les indicateurs. Ici, on se concentre sur la décision et la transmission à l'équipe.</p>
          </section>
        </section>

        <section className="coach-focus-grid">
          <article className="coach-panel coach-discipline-panel">
            <div className="coach-panel-heading">
              <div><span>Discipline</span><h3>Cartons du match</h3></div>
              <CreditCard size={21} />
            </div>
            <div className="coach-discipline-grid">
              <section className="coach-card-list coach-yellow-list" aria-label="Cartons jaunes">
                <div className="coach-discipline-heading"><span>Cartons jaunes</span><strong>{yellowCards.length}</strong></div>
                {yellowCards.length > 0 ? (
                  <ul>
                    {yellowCards.map((card, index) => (
                      <li key={`${card.playerName}-${card.time}-${index}`}>
                        <b>{card.playerName}</b>
                        <small>{card.time}{card.reason ? ` · ${card.reason}` : ""}{card.travelCode ? ` · ${card.travelCode}` : ""}</small>
                      </li>
                    ))}
                  </ul>
                ) : <p>Aucun carton jaune dans la plage active.</p>}
              </section>
              <section className="coach-card-list coach-red-list" aria-label="Cartons rouges">
                <div className="coach-discipline-heading">
                  <span>Cartons rouges</span>
                  <strong>{redCardEntries.length}</strong>
                </div>
                {redCardsMode === "edit" ? (
                  <textarea aria-label="Cartons rouges manuels" value={redCardsDraft} onChange={(event) => setRedCardsDraft(event.target.value.slice(0, 1000))} placeholder="Nom Prénom · heure · motif SST" rows={6} />
                ) : (
                  redCardEntries.length > 0 ? <ul>{redCardEntries.map((entry, index) => <li key={`${entry}-${index}`}><b>{entry}</b></li>)}</ul> : <p>Aucun carton rouge saisi manuellement.</p>
                )}
                <div className="coach-discipline-actions">
                  {redCardsMode === "view" ? (
                    <button className="secondary-button compact" type="button" onClick={startRedCardsEdit}><Edit3 size={15} /> Saisir</button>
                  ) : (
                    <><button className="secondary-button compact" type="button" onClick={cancelRedCardsEdit} disabled={savingRedCards}><XCircle size={15} /> Annuler</button><button className="primary-button compact" type="button" onClick={saveRedCards} disabled={savingRedCards}><Save size={15} /> {savingRedCards ? "Enregistrement..." : "Enregistrer"}</button></>
                  )}
                </div>
              </section>
            </div>
          </article>

          <article className="coach-panel coach-mercato-panel">
            <div className="coach-panel-heading">
              <div><span>Mercato</span><h3>Nouvel arrivant</h3></div>
              {mercatoMode === "view" ? (
                <button className="secondary-button compact" type="button" aria-label="Écrire le Mercato" onClick={startMercatoEdit}><Edit3 size={15} /> Écrire le Mercato</button>
              ) : (
                <div className="coach-mercato-heading-actions">
                  <button className="secondary-button compact" type="button" aria-label="Annuler la modification du Mercato" onClick={cancelMercatoEdit} disabled={savingMercato}><XCircle size={15} /> Annuler</button>
                  <button className="primary-button compact" type="button" aria-label="Enregistrer le Mercato" onClick={() => void saveMercato()} disabled={savingMercato || savingCoachPlan}><Save size={15} /> {savingMercato ? "Enregistrement..." : "Enregistrer le Mercato"}</button>
                </div>
              )}
              <Users size={21} />
            </div>
            <p className="coach-mercato-note">Un joueur par ligne, ou plusieurs noms complets séparés par « et », « / » ou une virgule. Choisis Femme ou Homme pour chaque arrivant ; les photos du carrousel se mettent à jour après enregistrement.</p>
            {mercatoMode === "edit" ? (
              <>
                <label className="coach-mercato-input">
                  <span className="sr-only">Nouvel arrivant du mercato</span>
                  <textarea aria-label="Nouvel arrivant du mercato" value={mercatoDraft} onChange={(event) => updateMercato(event.target.value)} placeholder="Ex. Accueillir Prénom NOM, nouveau renfort de l'équipe.\nOu : Prénom NOM, Prénom NOM" rows={5} disabled={savingMercato || savingCoachPlan} />
                </label>
                {activeMercatoEntrants.length > 0 && (
                  <div className="coach-mercato-profiles" aria-label="Profil des joueurs pour le carrousel">
                    <span className="coach-mercato-profiles-heading">Profil du joueur pour sa photo</span>
                    {activeMercatoEntrants.map((entrant) => (
                      <div className="coach-mercato-profile-row" key={entrant.id}>
                        <strong>{entrant.name}</strong>
                        <div role="group" aria-label={`Profil de ${entrant.name}`}>
                          <button type="button" className={activeMercatoProfiles[entrant.key] === "female" ? "is-selected" : ""} aria-label={`Femme pour ${entrant.name}`} aria-pressed={activeMercatoProfiles[entrant.key] === "female"} onClick={() => updateMercatoProfile(entrant.key, "female")} disabled={savingMercato || savingCoachPlan}>Femme</button>
                          <button type="button" className={activeMercatoProfiles[entrant.key] === "male" ? "is-selected" : ""} aria-label={`Homme pour ${entrant.name}`} aria-pressed={activeMercatoProfiles[entrant.key] === "male"} onClick={() => updateMercatoProfile(entrant.key, "male")} disabled={savingMercato || savingCoachPlan}>Homme</button>
                        </div>
                      </div>
                    ))}
                    <p className={`coach-mercato-profile-feedback${mercatoProfileFeedback ? ` is-${mercatoProfileFeedback.tone}` : missingMercatoProfiles.length ? " is-required" : " is-ready"}`} role="status" aria-live="polite">
                      {savingMercato
                        ? "Enregistrement du Mercato…"
                        : mercatoProfileFeedback?.detail
                          ?? (missingMercatoProfiles.length
                            ? `Choisis Femme ou Homme pour ${missingMercatoProfiles.length === 1 ? "cet arrivant" : `${missingMercatoProfiles.length} arrivants`}, puis enregistre pour mettre à jour les photos.`
                            : "Tous les profils sont choisis. Enregistre pour actualiser les photos du carrousel.")}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className={`coach-mercato-entry ${coachPlan.mercato.trim() ? "" : "is-empty"}`}>{coachPlan.mercato.trim() || "À renseigner par le coach"}</p>
            )}
            {mercatoMode === "view" && missingMercatoProfiles.length > 0 && (
              <p className="coach-mercato-profile-feedback is-required" role="status">
                {`Choix Femme/Homme manquant pour ${missingMercatoProfiles.map((entrant) => entrant.name).join(", ")}. Modifie le Mercato pour afficher les photos adaptées.`}
              </p>
            )}
            {mercatoMode === "view" && mercatoProfileFeedback && (
              <p className={`coach-mercato-profile-feedback is-${mercatoProfileFeedback.tone}`} role="status" aria-live="polite">{mercatoProfileFeedback.detail}</p>
            )}
          </article>
        </section>

        <section className="coach-actions-section" aria-labelledby="coach-actions-title">
          <div className="coach-section-heading">
            <div><span>Plan de jeu</span><h3 id="coach-actions-title">Priorités du chef de quai</h3><p className="coach-section-note">Les titres sont proposés par l'analyse. La consigne de chaque bulle est à renseigner par le chef de quai.</p></div>
            {coachBoardMode === "view" ? (
              <button className="secondary-button compact" type="button" onClick={startCoachBoardEdit}><Edit3 size={15} /> Écrire</button>
            ) : (
              <div className="coach-writing-actions"><button className="secondary-button compact" type="button" onClick={cancelCoachBoardEdit} disabled={savingCoachPlan}><XCircle size={15} /> Annuler</button><button className="primary-button compact" type="button" onClick={saveCoachBoard} disabled={savingCoachPlan || savingMercato}><Save size={15} /> {savingCoachPlan ? "Enregistrement..." : "Enregistrer"}</button></div>
            )}
          </div>
          {coachBoardFeedback && <div className={`coach-board-feedback ${coachBoardFeedback.tone}`}><strong>{coachBoardFeedback.title}</strong><span>{coachBoardFeedback.detail}</span></div>}
          <div className="coach-actions-grid">
            {actions.map((action, index) => {
              const actionField = coachActionFields[index];
              const value = activeCoachPlan.coach[actionField.field];
              return (
                <article className={`coach-action-card ${action.level}`} key={action.title}>
                  <span>0{index + 1} · {actionField.label}</span>
                  {coachBoardMode === "edit" ? (
                    <label className="coach-action-input">
                      <span className="sr-only">{actionField.label}, consigne du chef de quai</span>
                      <textarea aria-label={`${actionField.label}, consigne du chef de quai`} value={value} onChange={(event) => updateCoachDraft(actionField.field, event.target.value)} placeholder={actionField.placeholder} rows={3} />
                    </label>
                  ) : (
                    <p className={`coach-action-entry ${value.trim() ? "" : "is-empty"}`}>{value.trim() || "À renseigner par le chef de quai"}</p>
                  )}
                </article>
              );
            })}
          </div>
          <div className="coach-review-line">
            <span>Prochaine revue</span>
            {coachBoardMode === "edit" ? <input aria-label="Prochaine revue du plan" value={activeCoachPlan.coach.review} onChange={(event) => updateCoachDraft("review", event.target.value)} placeholder="Ex. 18:30" /> : <strong>{activeCoachPlan.coach.review.trim() || "À planifier"}</strong>}
          </div>
        </section>

        <section className="coach-players-section" aria-labelledby="coach-players-title">
          <div className="coach-section-heading"><div><span>Effectif terrain</span><h3 id="coach-players-title">Joueurs à regarder</h3></div><small>Cliquez pour ouvrir la fiche complète</small></div>
          <div className="coach-players-grid">
            {focusPlayers.length > 0 ? focusPlayers.map((player) => {
              const metric = playerLockerMetric(player, snapshot);
              return (
                <button className={`coach-player-card ${roleClass(player.role)}`} type="button" key={player.name} onClick={() => onPlayer(player)}>
                  <span className="coach-player-avatar">{initials(player.name)}</span>
                  <span><strong>{player.name}</strong><small>{displayRole(player.role)} · {metric.label}</small></span>
                  <b>{metric.value}</b>
                  <ArrowRight size={17} />
                </button>
              );
            }) : <p className="coach-empty-state">Aucun joueur significatif à signaler sur le dernier import.</p>}
          </div>
        </section>

      </main>
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
          <span>{displayRole(player.role)} · {operationLabel(roleCode(player.role))}</span>
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
        <Metric icon={Shirt} label="Poste dominant" value={displayRole(player.role)} detail={`${player.dominantShare}% activité dominante`} />
        <Metric icon={Sparkles} label="Polyvalence" value={`${player.polyvalence}%`} detail={`${player.operationTypes} activité(s)`} />
        <Metric icon={Clock3} label="Activité" value={playerTimeRange(player)} detail="Première - dernière opération" />
      </section>

      <section className="section-card split-section">
        <div>
          <SectionTitle title="Répartition individuelle" subtitle="CHG, Réception et ZONAGE sur le match importé." />
          <div className="stat-bars">
            <StatLine label="Attaque · CHG" value={player.attackPercent} raw={player.byType.CHG} />
            <StatLine label="Milieu · ZONAGE" value={player.midfieldPercent} raw={player.byType.ZONAGE} />
            <StatLine label="Défense · Réception" value={player.defensePercent} raw={player.byType.DECHG} />
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

function TvMode({ snapshot, session, causerieRevision, onExit }: { snapshot: Snapshot; session: Session; causerieRevision: string | null; onExit: () => void }) {
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("tv-focus-active", focusMode);
    return () => document.body.classList.remove("tv-focus-active");
  }, [focusMode]);

  useEffect(() => {
    function syncFullscreenState() {
      if (document.fullscreenElement) setFocusMode(true);
      else if (document.fullscreenEnabled) setFocusMode(false);
    }
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  async function toggleFocusMode() {
    if (focusMode) {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined);
      }
      setFocusMode(false);
      return;
    }
    setFocusMode(true);
    if (!document.fullscreenEnabled) return;
    const request = document.documentElement.requestFullscreen?.();
    if (request) await request.catch(() => undefined);
  }

  return (
    <section className={`${focusMode ? "tv-mode is-focus" : "tv-mode"}`}>
      <div className="tv-header">
        <div>
          <p>STEF MATCH CENTER</p>
          <h2>{snapshot.agency.name}</h2>
          <ActivePeriodBadge snapshot={snapshot} className="tv-period-badge" />
        </div>
        <div className="tv-header-actions">
          <button className="secondary-on-dark" type="button" onClick={onExit}>
            <ArrowLeft size={16} />
            Quitter le brief équipe
          </button>
          <button className="secondary-on-dark" type="button" onClick={toggleFocusMode} aria-pressed={focusMode}>
            {focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {focusMode ? "Quitter le plein écran" : "Mode plein écran"}
          </button>
        </div>
      </div>
      <BriefTeamPlan snapshot={snapshot} session={session} causerieRevision={causerieRevision} />
    </section>
  );
}

function BriefTeamPlan({ snapshot, session, sharedPlan, causerieRevision, onPlanSaved }: { snapshot: Snapshot; session: Session; sharedPlan?: { ready: boolean; plan: CauseriePlan | null }; causerieRevision?: string | null; onPlanSaved?: (plan: CauseriePlan) => void }) {
  const [planMode, setPlanMode] = useState<"view" | "edit">("view");
  const [plan, setPlan] = useState<CauseriePlan>(() => buildEmptyCauseriePlan());
  const [planDraft, setPlanDraft] = useState<CauseriePlan>(() => buildEmptyCauseriePlan());
  const [savingPlan, setSavingPlan] = useState(false);
  const [feedback, setFeedback] = useState<CauserieToast>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; label: string } | null>(null);
  const planModeRef = useRef(planMode);
  planModeRef.current = planMode;
  const sharedPlanReady = sharedPlan?.ready;
  const sharedPlanValue = sharedPlan?.plan;

  useEffect(() => {
    if (!lightboxImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxImage(null);
    };
    document.body.classList.add("tv-lightbox-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("tv-lightbox-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [lightboxImage]);

  useEffect(() => {
    let cancelled = false;
    const emptyPlan = buildEmptyCauseriePlan();
    if (planModeRef.current === "edit") return () => { cancelled = true; };
    if (sharedPlanReady === false) return () => { cancelled = true; };
    if (sharedPlanReady === true) {
      const nextPlan = sharedPlanValue ? normalizeCauseriePlan(sharedPlanValue) : emptyPlan;
      const visiblePlan = hasManualCauserieContent(nextPlan, snapshot) ? nextPlan : emptyPlan;
      setPlan(visiblePlan);
      setPlanDraft(visiblePlan);
      return () => { cancelled = true; };
    }
    fetchCauseriePlan(session, snapshot)
      .then((remotePlan) => {
        if (cancelled) return;
        const nextPlan = remotePlan ? normalizeCauseriePlan(remotePlan) : emptyPlan;
        const visiblePlan = hasManualCauserieContent(nextPlan, snapshot) ? nextPlan : emptyPlan;
        setPlan(visiblePlan);
        setPlanDraft(visiblePlan);
      })
      .catch(() => {
        if (!cancelled) setFeedback({ title: "Plan local", detail: "Le brief reste vide jusqu'à sa saisie.", tone: "warning" });
      });
    return () => {
      cancelled = true;
    };
  }, [session, snapshot, sharedPlanReady, sharedPlanValue, causerieRevision, planMode]);

  function startPlanEdit() {
    setPlanDraft(plan);
    setPlanMode("edit");
    setFeedback(null);
  }

  async function saveTvPlan() {
    const nextPlan = {
      ...planDraft,
      attack: padPlanLines(planDraft.attack),
      midfield: padPlanLines(planDraft.midfield),
      defense: padPlanLines(planDraft.defense),
      updatedAt: new Date().toISOString(),
    };
    setSavingPlan(true);
    try {
      const savedPlan = await saveCauseriePlan(session, snapshot, nextPlan);
      const normalizedPlan = normalizeCauseriePlan(savedPlan);
      setPlan(normalizedPlan);
      setPlanDraft(normalizedPlan);
      setPlanMode("view");
      onPlanSaved?.(normalizedPlan);
      setFeedback({ title: "Brief enregistré", detail: "Les consignes du brief équipe sont à jour.", tone: "success" });
    } catch {
      setPlan(nextPlan);
      setPlanDraft(nextPlan);
      setPlanMode("view");
      writeLocalCauseriePlan(snapshot, nextPlan);
      onPlanSaved?.(nextPlan);
      setFeedback({ title: "Sauvegarde locale uniquement", detail: "Le plan est conservé sur ce poste.", tone: "warning" });
    } finally {
      setSavingPlan(false);
      window.setTimeout(() => setFeedback(null), 3400);
    }
  }

  return (
    <>
      <div className={`tv-action ${planMode === "edit" ? "is-editing" : ""}`}>
        <div className="tv-action-heading">
          <div>
            <span>BRIEF ÉQUIPE</span>
            <strong>Consignes à transmettre</strong>
          </div>
          {planMode === "view" ? (
            <button className="tv-edit-button" type="button" onClick={startPlanEdit}>
              <Edit3 size={16} /> Écrire
            </button>
          ) : (
            <div className="tv-edit-actions">
              <button className="tv-edit-button" type="button" onClick={() => { setPlanDraft(plan); setPlanMode("view"); }} disabled={savingPlan}>Annuler</button>
              <button className="primary-button compact" type="button" onClick={saveTvPlan} disabled={savingPlan}>
                <Save size={15} /> {savingPlan ? "Enregistrement..." : "Enregistrer"}
              </button>
            </div>
          )}
        </div>
        <div className="tv-plan-grid">
          {([
            ["attack", "SAV"],
            ["midfield", "Expédition"],
            ["defense", "Ramasse & emballage"],
          ] as const).map(([zone, label]) => (
            <div className={`tv-plan-column ${zone}`} key={zone}>
              <b>{label}</b>
              {planMode === "edit" ? (
                <>
                  <textarea
                    value={planDraft[zone].filter(Boolean).join("\n")}
                    maxLength={500}
                    aria-label={`${label}, contenu du brief`}
                    placeholder="Écris ici les consignes, points de vigilance ou éléments à afficher."
                    rows={10}
                    onChange={(event) => setPlanDraft((current) => ({ ...current, [zone]: [event.target.value] }))}
                  />
                  <label className="tv-plan-image-upload">
                    <Upload size={16} />
                    <span>{planDraft.attachments[zone].length ? "Ajouter des captures" : "Ajouter des captures d'écran"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      aria-label={`${label}, capture d'écran`}
                      onChange={async (event) => {
                        const files = Array.from(event.target.files ?? []);
                        if (!files.length) return;
                        const currentAttachments = planDraft.attachments[zone];
                        const remaining = Math.max(0, 12 - currentAttachments.length);
                        if (!remaining) {
                          setFeedback({ title: "Limite de captures atteinte", detail: `La zone ${label} peut contenir jusqu'à 12 captures.`, tone: "warning" });
                          event.target.value = "";
                          return;
                        }
                        try {
                          const attachments = await Promise.all(files.slice(0, remaining).map((file) => prepareCauserieImage(file)));
                          setPlanDraft((current) => ({
                            ...current,
                            attachments: { ...current.attachments, [zone]: [...current.attachments[zone], ...attachments] },
                          }));
                          setFeedback({ title: `${attachments.length} capture(s) ajoutée(s)`, detail: `Elles seront enregistrées dans la zone ${label}.`, tone: "success" });
                        } catch (error) {
                          setFeedback({ title: "Capture non ajoutée", detail: error instanceof Error ? error.message : "Le fichier n'a pas pu être ajouté.", tone: "error" });
                        } finally {
                          event.target.value = "";
                        }
                      }}
                    />
                  </label>
                  {planDraft.attachments[zone].length > 0 && (
                    <div className="tv-plan-image-gallery" aria-label={`Captures du brief ${label}`}>
                      {planDraft.attachments[zone].map((src, index) => (
                        <div className="tv-plan-image-item" key={`${src.slice(-24)}-${index}`}>
                          <button
                            className="tv-plan-image-button"
                            type="button"
                            onClick={() => setLightboxImage({ src, label: `${label} · capture ${index + 1}` })}
                            aria-label={`Agrandir la capture ${label} ${index + 1}`}
                          >
                            <img className="tv-plan-image-preview" src={src} alt={`Capture du brief ${label} ${index + 1}`} />
                            <span className="tv-plan-image-hint">Cliquer pour agrandir</span>
                          </button>
                          <button
                            className="tv-plan-image-remove"
                            type="button"
                            onClick={() => setPlanDraft((current) => ({
                              ...current,
                              attachments: { ...current.attachments, [zone]: current.attachments[zone].filter((_, itemIndex) => itemIndex !== index) },
                            }))}
                            aria-label={`Supprimer la capture ${label} ${index + 1}`}
                          >
                            Supprimer
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {plan[zone].filter(Boolean).join("\n").trim() ? (
                    <span className="tv-plan-content">{plan[zone].filter(Boolean).join("\n")}</span>
                  ) : (
                    <div className="tv-plan-empty-state" aria-label={`${label}, zone vide`}>
                      <ClipboardList size={26} aria-hidden="true" />
                      <strong>Brief à renseigner</strong>
                      <span>Écris le brief ou dépose les captures ici.</span>
                    </div>
                  )}
                  {plan.attachments[zone].length > 0 && (
                    <div className="tv-plan-image-gallery" aria-label={`Captures du brief ${label}`}>
                      {plan.attachments[zone].map((src, index) => (
                        <button
                          className="tv-plan-image-button"
                          type="button"
                          key={`${src.slice(-24)}-${index}`}
                          onClick={() => setLightboxImage({ src, label: `${label} · capture ${index + 1}` })}
                          aria-label={`Agrandir la capture ${label} ${index + 1}`}
                        >
                          <img className="tv-plan-image" src={src} alt={`Capture du brief ${label} ${index + 1}`} />
                          <span className="tv-plan-image-hint">Cliquer pour agrandir</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        {feedback && <p className={`tv-plan-feedback ${feedback.tone}`}>{feedback.title} · {feedback.detail}</p>}
      </div>
      {lightboxImage && (
        <div
          className="tv-image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Capture agrandie ${lightboxImage.label}`}
          onClick={() => setLightboxImage(null)}
        >
          <div className="tv-image-lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <button
              className="tv-image-lightbox-close"
              type="button"
              onClick={() => setLightboxImage(null)}
              aria-label="Fermer la capture agrandie"
            >
              <XCircle size={22} />
            </button>
            <p>{lightboxImage.label}</p>
            <img src={lightboxImage.src} alt={`Capture agrandie du brief ${lightboxImage.label}`} />
          </div>
        </div>
      )}
    </>
  );
}

function AdministratorView({ agencyCode, activeLeague, leagueConfigs: initialLeagueConfigs, onLeagueConfigsChange, onActiveLeagueChange }: { agencyCode: string; activeLeague: LeagueId; leagueConfigs: LeagueConfig[]; onLeagueConfigsChange: (configs: LeagueConfig[]) => Promise<void>; onActiveLeagueChange: (league: LeagueId, config?: LeagueConfig) => void }) {
  const leagueConfigStorageKey = `stef-match-league-configs-${agencyCode}`;
  const [leagueConfigs, setLeagueConfigs] = useState(initialLeagueConfigs);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [configSaveError, setConfigSaveError] = useState("");
  const leagueConfigsRef = useRef(initialLeagueConfigs);
  const configSaveQueueRef = useRef(Promise.resolve());
  const selectedLeague = leagueConfigs.find((league) => league.id === activeLeague) ?? leagueConfigs[1];

  useEffect(() => {
    setLeagueConfigs(initialLeagueConfigs);
    leagueConfigsRef.current = initialLeagueConfigs;
  }, [initialLeagueConfigs]);

  function selectLeague(id: LeagueId) {
    const selected = leagueConfigs.find((league) => league.id === id);
    onActiveLeagueChange(id, selected);
  }

  type LeagueEditableField = "zonageMinutes" | "loadingSeconds" | "unloadingSeconds" | "scoreTargetPercent";

  function leagueDraftKey(id: LeagueId, field: LeagueEditableField) {
    return `${id}-${field}`;
  }

  function setLeagueDraft(id: LeagueId, field: LeagueEditableField, value: string) {
    setDraftValues((current) => ({ ...current, [leagueDraftKey(id, field)]: value }));
  }

  function commitLeague(id: LeagueId, field: LeagueEditableField, value: string | number) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 1 || (field === "scoreTargetPercent" && numericValue > 100)) {
      setDraftValues((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[leagueDraftKey(id, field)];
        return nextDrafts;
      });
      return;
    }
    const normalizedValue = field === "scoreTargetPercent" ? Math.min(100, Math.max(1, Math.round(numericValue))) : Math.round(numericValue);
    const next = leagueConfigsRef.current.map((league) => league.id === id ? { ...league, [field]: normalizedValue } : league);
    leagueConfigsRef.current = next;
    setLeagueConfigs(next);
    writeStorageValue("local", leagueConfigStorageKey, JSON.stringify(next));
    setConfigSaveError("");
    const save = configSaveQueueRef.current
      .catch(() => undefined)
      .then(() => onLeagueConfigsChange(next));
    configSaveQueueRef.current = save.then(() => undefined, () => undefined);
    void save.catch((error) => {
      setConfigSaveError(error instanceof Error ? error.message : "Les paramètres de la ligue n'ont pas pu être partagés.");
    });
    if (activeLeague === id) {
      const updatedLeague = next.find((league) => league.id === id);
      if (updatedLeague) onActiveLeagueChange(id, updatedLeague);
    }
    setDraftValues((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[leagueDraftKey(id, field)];
      return nextDrafts;
    });
  }

  function leagueInputValue(id: LeagueId, field: LeagueEditableField, value: number) {
    return draftValues[leagueDraftKey(id, field)] ?? (field === "loadingSeconds" ? formatTimeInput(value) : String(value));
  }

  return (
    <section className="administrator-page">
      <header className="administrator-header">
        <div>
          <p className="eyebrow">ADM · Configuration</p>
          <h2>Centre de pilotage des ligues</h2>
          <p>Choisir un niveau de référence pour comparer les objectifs opérationnels du match.</p>
        </div>
        <div className={`administrator-active-badge ${selectedLeague.tone}`}>
          <LeagueIcon leagueId={selectedLeague.id} />
          <span>Ligue active</span>
          <strong>{selectedLeague.label}</strong>
        </div>
      </header>

      <div className="administrator-scene">
        <div className="administrator-scene-backdrop" aria-hidden="true">
          <span className="administrator-scene-tag">BUREAU DU COACH · VUE STADE</span>
          <span className="administrator-window-label">PILOTAGE EN DIRECT</span>
        </div>

        <div className="administrator-desk">
          <div className="administrator-desk-top" aria-hidden="true"><span /><span /><span /></div>
          <div className="administrator-desk-content">
            <div className="administrator-console-heading">
              <div><span>Tableau des standards</span><strong>Paramètres de performance</strong></div>
              <Settings2 size={22} />
            </div>
            <div className="administrator-rule-strip">
              <label><Target size={18} /><span>Zonage · cible en minutes</span><select aria-label={`Cible zonage ${selectedLeague.label}`} value={String(selectedLeague.zonageMinutes)} onChange={(event) => commitLeague(selectedLeague.id, "zonageMinutes", event.target.value)}>{selectOptions(zonageMinuteOptions, selectedLeague.zonageMinutes).map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}</select></label>
              <label><Clock3 size={18} /><span>Chargement · temps maximum</span><select aria-label={`Temps chargement ${selectedLeague.label}`} value={formatTimeInput(selectedLeague.loadingSeconds)} onChange={(event) => commitLeague(selectedLeague.id, "loadingSeconds", parseTimeInput(event.target.value))}>{selectOptions(loadingTimeOptions, selectedLeague.loadingSeconds).map((seconds) => <option key={seconds} value={formatTimeInput(seconds)}>{formatTimeInput(seconds)}</option>)}</select></label>
              <label><Clock3 size={18} /><span>Réception · temps maximum</span><select aria-label={`Temps réception ${selectedLeague.label}`} value={formatTimeInput(selectedLeague.unloadingSeconds)} onChange={(event) => commitLeague(selectedLeague.id, "unloadingSeconds", parseTimeInput(event.target.value))}>{selectOptions(unloadingTimeOptions, selectedLeague.unloadingSeconds).map((seconds) => <option key={seconds} value={formatTimeInput(seconds)}>{formatTimeInput(seconds)}</option>)}</select></label>
              <label><CheckCircle2 size={18} /><span>Score · objectif par indicateur</span><input aria-label={`Objectif score ${selectedLeague.label}`} type="number" min="1" max="100" step="1" value={leagueInputValue(selectedLeague.id, "scoreTargetPercent", selectedLeague.scoreTargetPercent)} onChange={(event) => setLeagueDraft(selectedLeague.id, "scoreTargetPercent", event.target.value)} onBlur={(event) => commitLeague(selectedLeague.id, "scoreTargetPercent", event.target.value)} /></label>
            </div>
            <p className="administrator-note"><Sparkles size={17} /> Les critères sont partagés pour l’agence. La ligue active recalcule les indicateurs dépendants des seuils : duels, chargements, temps de réception et score. Le taux de passes et la possession restent calculés sur la plage Excel.</p>
            {configSaveError && <p className="form-error" role="alert">{configSaveError}</p>}
          </div>
        </div>
      </div>

      <section className="administrator-leagues" aria-labelledby="league-comparison-title">
        <div className="administrator-section-heading"><div><span className="eyebrow">Référentiel</span><h3 id="league-comparison-title">Comparer les niveaux</h3></div><span className="administrator-validation-state"><AlertTriangle size={16} /> À valider avant déploiement</span></div>
        <div className="league-grid">
          {leagueConfigs.map((league) => (
            <article key={league.id} className={`league-card ${league.tone} ${activeLeague === league.id ? "is-selected" : ""}`}>
              <span className="league-medal"><LeagueIcon leagueId={league.id} /></span>
              <div className="league-card-top"><strong>{league.label}</strong><button className="league-select-button" type="button" onClick={() => selectLeague(league.id)} aria-pressed={activeLeague === league.id}>{activeLeague === league.id ? "Sélectionnée" : "Activer"}</button></div>
              <span className="league-description">{league.description}</span>
              <div className="league-values"><label><small>Zonage · min</small><select aria-label={`Modifier zonage ${league.label}`} value={String(league.zonageMinutes)} onChange={(event) => commitLeague(league.id, "zonageMinutes", event.target.value)}>{selectOptions(zonageMinuteOptions, league.zonageMinutes).map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}</select></label><label><small>Chargement · HH:MM:SS</small><select aria-label={`Modifier chargement ${league.label}`} value={formatTimeInput(league.loadingSeconds)} onChange={(event) => commitLeague(league.id, "loadingSeconds", parseTimeInput(event.target.value))}>{selectOptions(loadingTimeOptions, league.loadingSeconds).map((seconds) => <option key={seconds} value={formatTimeInput(seconds)}>{formatTimeInput(seconds)}</option>)}</select></label><label><small>Réception · HH:MM:SS</small><select aria-label={`Modifier réception ${league.label}`} value={formatTimeInput(league.unloadingSeconds)} onChange={(event) => commitLeague(league.id, "unloadingSeconds", parseTimeInput(event.target.value))}>{selectOptions(unloadingTimeOptions, league.unloadingSeconds).map((seconds) => <option key={seconds} value={formatTimeInput(seconds)}>{formatTimeInput(seconds)}</option>)}</select></label><label><small>Objectif score · %</small><input aria-label={`Objectif score ${league.label}`} type="number" min="1" max="100" step="1" value={leagueInputValue(league.id, "scoreTargetPercent", league.scoreTargetPercent)} onChange={(event) => setLeagueDraft(league.id, "scoreTargetPercent", event.target.value)} onBlur={(event) => commitLeague(league.id, "scoreTargetPercent", event.target.value)} /></label></div>
              <LeagueTargetMeter league={league} />
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function formatTimeInput(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = Math.round(totalSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatReadableDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

function selectOptions(options: number[], currentValue: number) {
  return Array.from(new Set([...options, currentValue])).sort((left, right) => left - right);
}

function parseTimeInput(value: string) {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0);
}

function LeagueIcon({ leagueId, size = 20, className = "administrator-trophy" }: { leagueId: LeagueId; size?: number; className?: string }) {
  const Icon = leagueId === "bronze" ? Medal : leagueId === "argent" ? Award : leagueId === "or" ? Trophy : Crown;
  return <Icon className={className} size={size} aria-hidden="true" />;
}

function LeagueTargetMeter({ league }: { league: LeagueConfig }) {
  return (
    <div className="league-target-meter" aria-label={`Objectif du score ${league.label} : ${league.scoreTargetPercent}%`}>
      <div className="league-target-meter-heading"><span>Objectif du score</span><strong>{league.scoreTargetPercent}%</strong></div>
      <div className="league-target-meter-track"><span /><b style={{ left: `${Math.max(0, Math.min(100, league.scoreTargetPercent))}%` }} aria-hidden="true" /></div>
      <div className="league-target-meter-scale" aria-hidden="true"><span>0%</span><span>100%</span></div>
    </div>
  );
}

type GuideSection = "start" | "excel" | "import" | "read" | "edit" | "admin" | "help";

function GuideView({ snapshot, leagueConfigs, onNavigate }: { snapshot: Snapshot | null; leagueConfigs: LeagueConfig[]; onNavigate: (screen: Screen) => void }) {
  const [section, setSection] = useState<GuideSection>("start");
  const guideLeagues = leagueConfigs;

  const sections: Array<{ id: GuideSection; number: string; label: string }> = [
    { id: "start", number: "01", label: "Démarrer" },
    { id: "excel", number: "02", label: "Préparer Excel" },
    { id: "import", number: "03", label: "Importer & actualiser" },
    { id: "read", number: "04", label: "Lire les écrans" },
    { id: "edit", number: "05", label: "Modifier le plan" },
    { id: "admin", number: "06", label: "Administrateur" },
    { id: "help", number: "07", label: "Points d’attention" },
  ];
  const activeIndex = sections.findIndex((item) => item.id === section);
  const previousSection = sections[Math.max(0, activeIndex - 1)]?.id ?? "start";
  const nextSection = sections[Math.min(sections.length - 1, activeIndex + 1)]?.id ?? "help";

  return (
    <section className="guide-page">
      <header className="guide-hero">
        <div>
          <p className="eyebrow">Guide intégré</p>
          <h2>Utiliser STEF Match Center de A à Z</h2>
          <p>Un parcours simple pour partir de votre fichier Excel, actualiser le match et utiliser chaque écran sans connaissance technique.</p>
        </div>
        <div className="guide-hero-status">
          <BookOpen size={26} />
          <strong>{snapshot ? "Match disponible" : "Excel à importer"}</strong>
          <span>{snapshot ? `Dernière base : ${formatDateTime(snapshot.importedAt)}` : "Commencez par préparer le fichier source."}</span>
        </div>
      </header>

      <div className="guide-layout">
        <nav className="guide-nav" aria-label="Sommaire du guide">
          <span className="guide-nav-title">Sommaire</span>
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              className={section === item.id ? "guide-nav-item active" : "guide-nav-item"}
              onClick={() => setSection(item.id)}
            >
              <b>{item.number}</b>
              <span>{item.label}</span>
              <ArrowRight size={15} />
            </button>
          ))}
          <div className="guide-nav-tip">
            <CircleHelp size={18} />
            <span>Vous pouvez revenir ici à tout moment sans perdre le match importé.</span>
          </div>
        </nav>

        <div className="guide-content">
          <div className="guide-progress" aria-label={`Progression du guide : étape ${activeIndex + 1} sur ${sections.length}`}>
            <div className="guide-progress-copy"><span>Progression</span><strong>Étape {activeIndex + 1} sur {sections.length} · {sections[activeIndex]?.label}</strong></div>
            <div className="guide-progress-track"><span style={{ width: `${((activeIndex + 1) / sections.length) * 100}%` }} /></div>
          </div>
          {section === "start" && (
            <GuidePanel eyebrow="01 · Démarrer" title="Le fonctionnement en une minute" icon={MousePointerClick}>
              <p>Le site transforme un fichier Excel actualisé en une lecture opérationnelle du match. Le fichier reste la source de données ; le site sert à contrôler, comprendre et agir.</p>
              <div className="guide-flow">
                <GuideFlowStep number="1" title="Préparer" detail="Remplacer l’onglet Données par la dernière base Excel." tone="blue" />
                <GuideFlowStep number="2" title="Importer" detail="Déposer l’Excel puis le PDF 106J dans les deux zones dédiées." tone="green" />
                <GuideFlowStep number="3" title="Contrôler" detail="Lire le score, les alertes et les éventuels points à revoir." tone="orange" />
                <GuideFlowStep number="4" title="Agir" detail="Utiliser Coach puis le brief équipe pour préparer et afficher les consignes avec la plage horaire choisie." tone="red" />
              </div>
              <div className="guide-callout success"><CheckCircle2 size={20} /><span><strong>Règle simple :</strong> chaque fois que la base Excel change, il faut refaire un import. Le bouton Actualiser sert ensuite à relire le dernier import enregistré.</span></div>
              <div className="guide-callout info"><Shield size={20} /><span><strong>Un espace séparé par agence :</strong> les imports et les causeries sont isolés par agence. Utilisez uniquement le code d’accès qui vous a été transmis séparément ; il n’est jamais affiché dans le guide.</span></div>
              <div className="guide-actions">
                <button className="primary-button" type="button" onClick={() => onNavigate("import")}><Upload size={17} /> Ouvrir l’import</button>
                <button className="secondary-button" type="button" onClick={() => setSection("excel")}><ArrowRight size={17} /> Préparer Excel</button>
              </div>
            </GuidePanel>
          )}

          {section === "excel" && (
            <GuidePanel eyebrow="02 · Préparer Excel" title="La bonne méthode, même sans connaître Excel" icon={FileSpreadsheet}>
              <p>Avant de toucher au fichier, faites une copie. Le classeur original reste votre référence et ne doit pas être écrasé par une manipulation.</p>
              <ol className="guide-steps">
                <li><b>Ouvrez la dernière version fiable du classeur.</b><span>Utilisez la base qui contient les données opérationnelles les plus récentes.</span></li>
                <li><b>Faites une copie du fichier.</b><span>Dans Excel : Fichier → Enregistrer sous, puis donnez un nom clair à la copie, par exemple <code>HM_58_match_2026-09-07.xlsx</code>.</span></li>
                <li><b>Remplacez l’onglet source.</b><span>Dans la copie utilisée pour l’import, remplacez l’ancien onglet <strong>Données</strong> par l’onglet actualisé. Le nom doit rester exactement <strong>Données</strong>.</span></li>
                <li><b>Conservez la structure complète.</b><span>Ne réduisez pas le fichier aux seules premières colonnes : le site utilise les champs de données, de filtres, de poste, de voyage et de duel listés ci-dessous.</span></li>
              <li><b>Enregistrez au format .xlsx.</b><span>Le site accepte le classeur Excel <strong>.xlsx</strong> dans la zone Excel. Le rapport PDF 106J se dépose séparément dans la zone dédiée.</span></li>
              </ol>
              <div className="guide-excel-howto">
                <div><span className="guide-subtitle">Méthode simple pour remplacer les données</span><strong>Copier la base actualisée dans l’onglet Données</strong></div>
                <ol className="guide-steps compact">
                  <li><b>Dans l’onglet source actualisé, cliquez dans le tableau.</b><span>Appuyez sur <kbd>Ctrl</kbd> + <kbd>A</kbd> pour sélectionner la zone de données, puis une deuxième fois si Excel ne sélectionne pas toute la feuille.</span></li>
                  <li><b>Copiez les données.</b><span>Appuyez sur <kbd>Ctrl</kbd> + <kbd>C</kbd>.</span></li>
                  <li><b>Allez dans l’onglet Données de la copie de travail.</b><span>Cliquez sur la cellule A1, en haut à gauche du tableau.</span></li>
                  <li><b>Videz les anciennes lignes avant de coller.</b><span>Dans l’onglet Données, sélectionnez l’ancienne zone de données de A2 à G jusqu’à la dernière ancienne ligne, puis appuyez sur <kbd>Suppr</kbd>. Ne supprimez pas les colonnes : vous effacez leur contenu uniquement.</span></li>
                  <li><b>Collez la nouvelle plage.</b><span>Revenez sur A1 et appuyez sur <kbd>Ctrl</kbd> + <kbd>V</kbd>. Cette étape évite que des lignes de l’ancien import restent sous le nouvel import.</span></li>
                  <li><b>Enregistrez et contrôlez.</b><span>Appuyez sur <kbd>Ctrl</kbd> + <kbd>S</kbd>. En cas d’erreur, <kbd>Ctrl</kbd> + <kbd>Z</kbd> annule la dernière action.</span></li>
                </ol>
              </div>
              <div className="guide-clear-warning"><AlertTriangle size={21} /><div><strong>Étape indispensable avant chaque collage</strong><span>Un nouvel extrait peut contenir moins de lignes que l’ancien. Si vous ne videz pas l’ancienne zone A:G, les anciennes lignes restantes peuvent encore être lues par le site et fausser les indicateurs. Dans ce classeur, ne videz pas H:T : ces colonnes contiennent des formules et des colonnes d’aide qui doivent rester en place.</span></div></div>
              <div className="guide-formula-note"><FileCheck2 size={20} /><div><strong>À retenir sur les colonnes H à T</strong><span>H correspond à <strong>Filtre opérateur</strong> et contient une formule. Les colonnes suivantes calculent notamment les filtres, le poste, le DZ et les duels gagnés. On remplace les données source en A:G ; on laisse les formules H:T se recalculer.</span></div></div>
              <div className="guide-field-block"><span className="guide-subtitle">Champs attendus dans l’onglet Données</span><div className="guide-field-list">{["Opérateur", "Date/Heure de début d’opération", "Type d’opération", "N° Position", "Code Voyage", "Agence Segment", "Type Segment", "Filtre opérateur", "Filtre heure", "Poste", "Poz non zonées", "DZ", "Duels gagnés"].map((field) => <span key={field}>{field}</span>)}</div><small>Les intitulés doivent rester reconnaissables. Ne supprimez pas la ligne d’en-têtes.</small></div>
              <figure className="guide-excel-figure">
                <img src="/excel-donnees-original.png" alt="Capture réelle de l’onglet Données dans le classeur Excel importé" />
                <figcaption>Capture réelle de l’onglet <strong>Données</strong> : la ligne 1 contient les en-têtes et les lignes suivantes contiennent les opérations.</figcaption>
              </figure>
              <div className="guide-shortcut-grid">
                <GuideShortcut keys={["Ctrl", "F"]} title="Rechercher" text="Trouver rapidement Données, Code Voyage ou un nom." />
                <GuideShortcut keys={["Ctrl", "S"]} title="Enregistrer" text="Sauvegarder la copie avant l’import." />
                <GuideShortcut keys={["Ctrl", "Z"]} title="Annuler" text="Revenir en arrière après une mauvaise manipulation." />
              </div>
              <div className="guide-warning"><AlertTriangle size={20} /><div><strong>À ne pas faire</strong><span>Ne modifiez pas les onglets de calcul ou de contrôle si vous ne savez pas à quoi ils servent. Pour le site, l’onglet clé est l’onglet <strong>Données</strong>.</span></div></div>
              <div className="guide-mini-grid">
                <GuideMiniCard icon={FileCheck2} title="À vérifier" text="Le fichier se termine par .xlsx" />
                <GuideMiniCard icon={CheckCircle2} title="Nom exact" text="L’onglet s’appelle Données" />
                <GuideMiniCard icon={CircleHelp} title="En cas de doute" text="Conservez l’original et importez une copie" />
              </div>
            </GuidePanel>
          )}

          {section === "import" && (
            <GuidePanel eyebrow="03 · Importer & actualiser" title="Ce que fait chaque bouton" icon={RefreshCw}>
              <div className="guide-action-list">
                <GuideAction icon={Upload} title="Contrôler et importer" tone="green" detail="L’Excel calcule le match. Le PDF 106J complète ensuite les indicateurs journaliers et le tonnage Expédition." />
                <GuideAction icon={RefreshCw} title="Actualiser" tone="blue" detail="À utiliser pour relire le dernier import déjà enregistré. Ce bouton ne va pas chercher un fichier sur votre ordinateur et ne remplace pas un nouvel import." />
                <GuideAction icon={Clock3} title="Appliquer la plage" tone="orange" detail="À utiliser après avoir choisi le début et la fin du créneau. Les heures sont limitées aux pas de 30 minutes, par exemple 08:00 ou 08:30." />
              </div>
              <h3>Procédure complète</h3>
              <ol className="guide-steps compact">
                <li><b>Allez dans Import.</b><span>Le bouton se trouve dans le menu à gauche.</span></li>
                <li><b>Sélectionnez ou déposez votre fichier .xlsx.</b><span>Vérifiez le nom affiché avant de continuer.</span></li>
                <li><b>Cliquez sur Contrôler et importer.</b><span>Attendez le message <strong>MATCH ACTUALISÉ</strong>.</span></li>
                <li><b>Lisez les contrôles.</b><span>Un point à contrôler n’empêche pas forcément la lecture, mais doit être compris avant une décision.</span></li>
                <li><b>Choisissez la plage horaire.</b><span>Renseignez le début et la fin, puis cliquez sur <strong>Appliquer</strong>. Toutes les vues se recalculent avec cette plage.</span></li>
              </ol>
              <div className="guide-callout info"><RefreshCw size={20} /><span><strong>Après un redémarrage du service en ligne :</strong> la version gratuite de Render ne garantit pas la conservation du fichier importé. Si aucune base n’est retrouvée, réimportez le dernier Excel.</span></div>
              <div className="guide-actions"><button className="primary-button" type="button" onClick={() => onNavigate("import")}><Upload size={17} /> Aller à Import</button></div>
            </GuidePanel>
          )}

          {section === "read" && (
            <GuidePanel eyebrow="04 · Lire les écrans" title="Quel écran utiliser, et pour quoi faire ?" icon={LayoutDashboard}>
              <div className="guide-screen-grid">
                <GuideScreenCard step="01" title="Coup d’envoi" detail="Vue d’ouverture du match. Elle confirme que les données sont prêtes et donne accès au brief équipe." />
                <GuideScreenCard step="02" title="Feuille de match" detail="La feuille de match se parcourt en quatre slides : Coup de sifflet final et collectif en chiffres, Cérémonie des performances, Statistiques du match, puis Brief équipe. Le score compare les pourcentages de passes réussies, de tirs cadrés, de duels gagnés et de possession à l’objectif de la ligue." />
              <GuideScreenCard step="03" title="Composition" detail="Lecture de la composition par Attaque, Milieu et Défense. Le Mode terrain affiche la formation et les cages. Compare le match complet, les deux mi-temps ou les quatre quarts calculés depuis la plage active. Une vue personnalisée permet aussi d’isoler une sous-plage, par exemple 1 heure, sans modifier les indicateurs du match. L’activité Réception correspond au scan de la palette." />
                <GuideScreenCard step="04" title="Coach" detail="Vue de décision : équipe à regarder, titres par catégorie, polyvalence, sujets à travailler et prochaines actions." />
                <GuideScreenCard step="05" title="Brief équipe" detail="Vue dédiée aux consignes : trois grandes zones visibles, empilées verticalement : SAV, Expédition, Ramasse & emballage. Chaque zone accepte du texte et plusieurs captures d’écran, avec affichage plein écran." />
              </div>
              <div className="guide-legend"><span className="legend-dot green" /> Vert = acquis ou action positive <span className="legend-dot orange" /> Orange = à surveiller <span className="legend-dot red" /> Rouge = action prioritaire</div>
              <div className="guide-callout info"><Shield size={20} /><span><strong>Réception dans l’application :</strong> le code interne <code>DECHG</code> reste inchangé pour les calculs, mais l’interface affiche <strong>Réception</strong>. Il s’agit du scan de la palette à la réception ; au déchargement, la palette est déposée en travée.</span></div>
            </GuidePanel>
          )}

          {section === "edit" && (
            <GuidePanel eyebrow="05 · Modifier le plan" title="Écrire des consignes sans casser les données" icon={Edit3}>
              <p>Les données Excel alimentent les indicateurs. Les textes du plan de jeu sont des consignes opérationnelles que vous pouvez adapter à la situation du jour.</p>
              <div className="guide-edit-grid">
                <GuideEditCard title="Dans Feuille de match" detail="Modifier les chiffres permet de renseigner les blessures A.T et l'effectif prévu. Le carrousel Le collectif en chiffres conserve les positions calculées depuis l'Excel filtré. Le tonnage Expédition et les taux journaliers viennent du PDF 106J ; ils affichent PDF à importer tant que ce rapport n'a pas été chargé." />
                <GuideEditCard title="Dans Coach" detail="Cliquez sur Écrire dans le tableau du coach, complétez Tactique, Priorité, Arbitrage et Revue, puis Enregistrer." />
              <GuideEditCard title="Dans le brief équipe" detail="Cliquez sur Écrire. Les trois zones sont empilées et entièrement visibles : saisissez les consignes dans SAV, Expédition ou Ramasse & emballage, ajoutez plusieurs captures si nécessaire, puis enregistrez." />
              </div>
              <div className="guide-callout success"><CheckCircle2 size={20} /><span><strong>À retenir :</strong> les chiffres manuels sont mémorisés pour l’agence et le match affichés sur ce poste. Ils complètent la lecture opérationnelle sans modifier le fichier source importé.</span></div>
              <div className="guide-callout info"><Upload size={20} /><span><strong>Ajouter une capture d’écran :</strong> dans chaque zone du brief équipe, cliquez sur <strong>Ajouter une capture d’écran</strong>, puis choisissez une image PNG, JPG ou WebP. L’image est redimensionnée automatiquement, affichée dans la zone correspondante et sauvegardée avec le texte. Chaque catégorie conserve sa propre capture.</span></div>
              <div className="guide-callout warning"><AlertTriangle size={20} /><span><strong>Important :</strong> si un message indique une sauvegarde locale uniquement, le texte est conservé sur ce poste mais peut ne pas être partagé avec les autres utilisateurs.</span></div>
              <div className="guide-actions"><button className="secondary-button" type="button" onClick={() => onNavigate("coach")}><Dumbbell size={17} /> Ouvrir Coach</button><button className="primary-button" type="button" onClick={() => onNavigate("tv")}><Eye size={17} /> Ouvrir le brief équipe</button></div>
            </GuidePanel>
          )}

          {section === "admin" && (
            <GuidePanel eyebrow="06 · Administrateur" title="Régler les ligues et leurs standards" icon={Settings2}>
              <p>L’onglet Administrateur sert à choisir un niveau de référence et à ajuster ses conditions de performance : la cible de zonage, les temps maximum de chargement et de réception, ainsi que l’objectif en pourcentage de chaque indicateur du score.</p>
              <div className="guide-action-list">
                <GuideAction icon={Trophy} title="Choisir une ligue" tone="blue" detail="Activez Bronze, Argent, Or ou Platine. Le niveau sélectionné devient la référence affichée dans le centre de pilotage." />
                <GuideAction icon={Target} title="Régler le zonage" tone="green" detail="Modifiez la cible en minutes directement dans le panneau de la ligue. Une valeur plus basse correspond à un standard plus exigeant." />
                <GuideAction icon={Clock3} title="Régler le chargement" tone="orange" detail="Modifiez le temps maximum au format HH:MM:SS. Le seuil Argent proposé est 00:02:45." />
              <GuideAction icon={Clock3} title="Régler le temps de réception" tone="blue" detail="Modifiez le temps maximum au format HH:MM:SS. Le seuil Argent proposé est 00:01:00 ; il entre dans le score opérationnel." />
              <GuideAction icon={CheckCircle2} title="Régler l'objectif du score" tone="green" detail="Chaque indicateur qui dépasse strictement cet objectif marque un but ; chaque indicateur qui l'atteint ou reste en dessous encaisse un but. Les valeurs proposées vont de 45 % en Bronze à 70 % en Platine." />
              </div>
              <h3>Référentiel proposé</h3>
              <div className="guide-league-grid" aria-label="Référentiel visuel des ligues">
                {guideLeagues.map((league) => (
                  <article key={league.id} className={`guide-league-card ${league.tone}`}>
                    <span className="guide-league-medal"><LeagueIcon leagueId={league.id} className="" /></span>
                    <div className="guide-league-card-top"><strong>{league.label}</strong><span>{league.id === "argent" ? "Référence" : "Niveau"}</span></div>
                    <p>{league.description}</p>
                    <div className="guide-league-values"><div><small>Zonage</small><strong>{league.zonageMinutes} min</strong></div><div><small>Chargement</small><strong>{formatTimeInput(league.loadingSeconds)}</strong></div><div><small>Réception</small><strong>{formatTimeInput(league.unloadingSeconds)}</strong></div><div><small>Objectif score</small><strong>{league.scoreTargetPercent}%</strong></div></div>
                    <LeagueTargetMeter league={league} />
                  </article>
                ))}
              </div>
              <div className="guide-callout warning"><AlertTriangle size={20} /><span><strong>Avant validation :</strong> les seuils sont partagés pour chaque agence, tandis que la ligue active est mémorisée sur ce poste. Les scores du match sont recalculés avec les seuils de la ligue active ; le score opérationnel repose sur quatre indicateurs.</span></div>
              <div className="guide-callout info"><Settings2 size={20} /><span><strong>Bon réflexe :</strong> vérifiez la ligue active, comparez les conditions avec le niveau attendu, puis contrôlez le résultat sur plusieurs imports avant toute diffusion officielle.</span></div>
            </GuidePanel>
          )}

          {section === "help" && (
            <GuidePanel eyebrow="07 · Points d’attention" title="Les vérifications à faire avant de partager le résultat" icon={CircleHelp}>
              <div className="guide-checklist">
                <GuideCheck title="Le bon fichier a été importé" detail="Vérifiez le nom du fichier et la date de dernière donnée affichée après l’import." />
                <GuideCheck title="La plage horaire est la bonne" detail="Le badge Plage active doit correspondre au créneau que vous voulez analyser." />
                <GuideCheck title="Les contrôles sont compris" detail="Les lignes critiques, dates non lisibles et doublons potentiels sont des signaux de qualité à vérifier dans Excel." />
                <GuideCheck title="Les valeurs sont cohérentes" detail="Comparez opérations, positions, joueurs et duels avec la base Excel source avant une diffusion officielle." />
                <GuideCheck title="Le résultat est validé humainement" detail="Le site aide à décider ; il ne remplace pas la vérification terrain ni la validation du responsable." />
              </div>
              <h3>Si quelque chose ne fonctionne pas</h3>
              <div className="guide-trouble-grid">
                <GuideTrouble title="FICHIER NON IMPORTÉ" detail="Vérifiez que le fichier est bien .xlsx, que l’onglet s’appelle Données et que la ligne d’en-têtes n’a pas été supprimée." />
                <GuideTrouble title="MATCH ACTUALISÉ avec alertes" detail="L’import a fonctionné. Ouvrez Excel, utilisez Ctrl + F ou les filtres pour retrouver les lignes signalées, puis décidez si elles doivent être corrigées." />
                <GuideTrouble title="Aucun match après Actualiser" detail="Actualiser ne lit pas votre ordinateur. Retournez dans Import et réimportez le dernier fichier Excel complet." />
              </div>
              <div className="guide-limit-card"><strong>Limite actuelle à retenir</strong><p>La version en ligne est hébergée sur une offre gratuite sans disque persistant garanti. En cas de redémarrage ou redéploiement, le dernier Excel peut devoir être réimporté.</p></div>
              <div className="guide-callout info"><CircleHelp size={20} /><span>En cas de blocage, revenez à la règle de base : conserver l’original Excel, préparer une copie avec l’onglet <strong>Données</strong> actualisé, puis refaire un import complet.</span></div>
            </GuidePanel>
          )}
          <div className="guide-step-footer">
            <button className="secondary-button compact" type="button" onClick={() => setSection("start")} disabled={activeIndex === 0}><ArrowRight size={16} className="guide-back-icon" /> Retour au début</button>
            <div>
              <button className="secondary-button compact" type="button" onClick={() => setSection(previousSection)} disabled={activeIndex === 0}>Étape précédente</button>
              <button className="primary-button compact" type="button" onClick={() => setSection(nextSection)} disabled={activeIndex === sections.length - 1}>Étape suivante <ArrowRight size={16} /></button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function GuidePanel({ eyebrow, title, icon: Icon, children }: { eyebrow: string; title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <article className="guide-panel">
      <div className="guide-panel-heading"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div><span className="guide-panel-icon"><Icon size={24} /></span></div>
      <div className="guide-panel-body">{children}</div>
    </article>
  );
}

function GuideFlowStep({ number, title, detail, tone }: { number: string; title: string; detail: string; tone: "blue" | "green" | "orange" | "red" }) {
  return <article className={`guide-flow-step ${tone}`}><b>{number}</b><strong>{title}</strong><span>{detail}</span></article>;
}

function GuideMiniCard({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return <article className="guide-mini-card"><Icon size={18} /><strong>{title}</strong><span>{text}</span></article>;
}

function GuideShortcut({ keys, title, text }: { keys: string[]; title: string; text: string }) {
  return <article className="guide-shortcut"><div>{keys.map((key) => <kbd key={key}>{key}</kbd>)}</div><strong>{title}</strong><span>{text}</span></article>;
}

function GuideAction({ icon: Icon, title, tone, detail }: { icon: LucideIcon; title: string; tone: "blue" | "green" | "orange"; detail: string }) {
  return <article className={`guide-action ${tone}`}><Icon size={21} /><div><strong>{title}</strong><p>{detail}</p></div></article>;
}

function GuideScreenCard({ step, title, detail }: { step: string; title: string; detail: string }) {
  return <article className="guide-screen-card"><b>{step}</b><strong>{title}</strong><p>{detail}</p></article>;
}

function GuideEditCard({ title, detail }: { title: string; detail: string }) {
  return <article className="guide-edit-card"><Edit3 size={19} /><strong>{title}</strong><p>{detail}</p></article>;
}

function GuideCheck({ title, detail }: { title: string; detail: string }) {
  return <article className="guide-check"><CheckCircle2 size={20} /><div><strong>{title}</strong><p>{detail}</p></div></article>;
}

function GuideTrouble({ title, detail }: { title: string; detail: string }) {
  return <article className="guide-trouble"><strong>{title}</strong><p>{detail}</p></article>;
}

function ImportView({ session, onImported, onOpenMatch }: { session: Session; onImported: (snapshot: Snapshot) => void; onOpenMatch: () => void }) {
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [details, setDetails] = useState<string[]>([]);
  const [importedSnapshot, setImportedSnapshot] = useState<Snapshot | null>(null);

  async function importFile(file: File | null, kind: "excel" | "pdf") {
    if (!file) {
      setState("error");
      setMessage(kind === "excel" ? "Sélectionne un fichier Excel .xlsx." : "Sélectionne un rapport PDF 106J.");
      setDetails([kind === "excel" ? "Fichier attendu : classeur Excel avec l'onglet Données." : "Le PDF doit contenir les indicateurs journaliers SIE.106J."]);
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    setState("uploading");
      setMessage(kind === "excel" ? "Contrôle du fichier Excel en cours..." : "Lecture du rapport PDF 106J en cours...");
    setDetails([]);
    setImportedSnapshot(null);
    try {
      const response = await fetch(`/api/agencies/${encodeURIComponent(session.agency.code)}/import`, {
        method: "POST",
        headers: { "x-access-code": session.accessCode },
        body: formData,
      });
      let payload: { message?: string; action?: string; snapshot?: Snapshot };
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      if (!response.ok || !payload.snapshot) {
        setState("error");
        setMessage(payload.message ?? "Le fichier n'a pas été importé.");
        setDetails([payload.action].filter((detail): detail is string => Boolean(detail)));
        return;
      }
      setState("success");
      setMessage(kind === "excel" ? "Le match est prêt." : "Les indicateurs 106J sont prêts.");
      setDetails(payload.snapshot.validation.warnings ?? []);
      setImportedSnapshot(payload.snapshot);
      onImported(payload.snapshot);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Le fichier n'a pas pu être importé.");
      setDetails(["Vérifie la connexion au serveur puis réessaie."]);
    }
  }

  return (
    <section className="import-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Import</p>
          <h2>Déposer le fichier, actualiser le match</h2>
          <p>Importe séparément la source Excel du match et le rapport PDF 106J du jour.</p>
        </div>
      </div>
      <div className="import-sources">
        <ImportSourceDropZone file={excelFile} accept=".xlsx" icon={FileSpreadsheet} title="1. Excel du match" emptyLabel="Déposer ou sélectionner le fichier .xlsx" detail="Source des opérations, joueurs, positions et scores." inputRef={excelInputRef} onFile={(next) => { setExcelFile(next); setState("idle"); setMessage(""); }} />
        <ImportSourceDropZone file={pdfFile} accept=".pdf" icon={FileCheck2} title="2. PDF 106J" emptyLabel="Déposer ou sélectionner le rapport PDF 106J" detail="Taux journaliers et ligne Expédition uniquement." inputRef={pdfInputRef} onFile={(next) => { setPdfFile(next); setState("idle"); setMessage(""); }} />
      </div>
      <div className="import-actions import-source-actions">
        <button className="primary-button" type="button" onClick={() => importFile(excelFile, "excel")} disabled={state === "uploading"}><Upload size={18} /> {state === "uploading" ? "Import en cours..." : "Contrôler et importer Excel"}</button>
        <button className="secondary-button" type="button" onClick={() => importFile(pdfFile, "pdf")} disabled={state === "uploading"}><FileCheck2 size={18} /> Importer le PDF 106J</button>
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

function ImportSourceDropZone({ file, accept, icon: Icon, title, emptyLabel, detail, inputRef, onFile }: { file: File | null; accept: string; icon: LucideIcon; title: string; emptyLabel: string; detail: string; inputRef: MutableRefObject<HTMLInputElement | null>; onFile: (file: File | null) => void }) {
  return (
    <div className={`drop-zone import-source-drop-zone ${file ? "has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onFile(event.dataTransfer.files[0] ?? null); }} onClick={() => inputRef.current?.click()}>
      <Icon size={34} />
      <strong>{title}</strong>
      <span>{file ? file.name : emptyLabel}</span>
      <small>{detail}</small>
      <input ref={inputRef} type="file" accept={accept} onChange={(event) => onFile(event.target.files?.[0] ?? null)} hidden />
    </div>
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

type FootballScore = {
  goalsFor: number;
  goalsAgainst: number;
  targetPercent: number;
  reachedIndicators: number;
  available: boolean;
};

type OperationalScoreIndicators = NonNullable<Snapshot["operationalScore"]>["indicators"];

function operationalScoreIndicators(snapshot: Snapshot): OperationalScoreIndicators {
  const canonical = snapshot.operationalScore?.indicators;
  if (canonical && Object.hasOwn(canonical, "possessionPercent")) return canonical;
  return {
    passRate: snapshot.summary.passRate ?? null,
    loadingPercent: snapshot.loadingQuality?.targetedPercent ?? null,
    unloadingPercent: snapshot.unloadingQuality?.targetedPercent ?? null,
    possessionPercent: snapshot.summary.possessionPercent ?? null,
  };
}

function buildFootballScore(snapshot: Snapshot, targetPercent: number): FootballScore {
  const indicators = operationalScoreIndicators(snapshot);
  const values = [indicators.passRate, indicators.loadingPercent, indicators.unloadingPercent, indicators.possessionPercent];
  const canonical = snapshot.operationalScore;
  const hasCanonicalScore = Boolean(canonical && canonical.indicators && Object.hasOwn(canonical.indicators, "possessionPercent"));
  const available = hasCanonicalScore
    ? canonical?.status === "available" && values.every((value) => Number.isFinite(value)) && Number.isFinite(canonical.goalsFor) && Number.isFinite(canonical.goalsAgainst)
    : values.every((value) => Number.isFinite(value));
  const reachedIndicators = available
    ? hasCanonicalScore
      ? Number(canonical?.goalsFor)
      : values.filter((value) => (value as number) > targetPercent).length
    : 0;
  return {
    goalsFor: reachedIndicators,
    goalsAgainst: available ? (hasCanonicalScore ? Number(canonical?.goalsAgainst) : values.length - reachedIndicators) : 0,
    targetPercent: hasCanonicalScore && Number.isFinite(canonical?.targetPercent) ? Number(canonical?.targetPercent) : targetPercent,
    reachedIndicators,
    available,
  };
}

function matchCeremonyOutcome(footballScore: FootballScore): {
  tone: MatchCeremonyTone;
  title: string;
  verdict: string;
  message: string;
  collectiveTitle: string;
  celebration: boolean;
} {
  if (!footballScore.available) {
    return {
      tone: "rework",
      title: "Match à compléter",
      verdict: "SCORE INCOMPLET",
      message: "Score opérationnel indisponible : les 4 indicateurs doivent être renseignés pour établir le résultat.",
      collectiveTitle: "Performance à compléter",
      celebration: false,
    };
  }

  const scoreLabel = `${footballScore.goalsFor} - ${footballScore.goalsAgainst}`;
  const scoreDetail = `${footballScore.reachedIndicators} indicateur(s) sur 4 dépassent l'objectif de ${formatNumber(footballScore.targetPercent)}%`;

  if (footballScore.goalsFor > footballScore.goalsAgainst) {
    return {
      tone: "victory",
      title: "Coup de sifflet final",
      verdict: "Célébration activée",
      message: `Score opérationnel : ${scoreLabel}. ${scoreDetail}.`,
      collectiveTitle: "Performance d'équipe validée",
      celebration: true,
    };
  }

  if (footballScore.goalsFor === footballScore.goalsAgainst) {
    return {
      tone: "controlled",
      title: "Match terminé",
      verdict: "Match à l'équilibre",
      message: `Score opérationnel : ${scoreLabel}. ${scoreDetail}. Les indicateurs sont partagés.`,
      collectiveTitle: "Collectif en maîtrise",
      celebration: false,
    };
  }

  return {
    tone: "rework",
    title: "Coup de sifflet final",
    verdict: "ACTION NÉCESSAIRE",
    message: `Score opérationnel : ${scoreLabel}. ${scoreDetail}. La priorité est de sécuriser les indicateurs manquants.`,
    collectiveTitle: "Reconnaissance et reprise terrain",
    celebration: false,
  };
}

function FootballScoreDisplay({ footballScore }: { footballScore: FootballScore }) {
  const scoreLabel = footballScore.available ? `${footballScore.goalsFor} - ${footballScore.goalsAgainst}` : "— - —";
  const scoreDescription = footballScore.available
    ? `${footballScore.reachedIndicators} indicateur(s) dépassent l'objectif sur 4 · seuil ${formatNumber(footballScore.targetPercent)}%`
    : "Score à compléter · les 4 indicateurs doivent être disponibles";

  return (
    <div
      className={`football-score-panel${footballScore.available ? "" : " is-unavailable"}`}
      aria-label={`Score opérationnel : ${scoreLabel}`}
    >
      <div className="football-score-heading">
        <span>Score opérationnel</span>
        <small>4 indicateurs</small>
      </div>
      <div className="football-score-line">
        <div className="football-score-side football-score-side-for">
          <span>Indicateurs atteints</span>
          <strong>{footballScore.available ? footballScore.goalsFor : "—"}</strong>
          <small>but(s) marqué(s)</small>
        </div>
        <span className="football-score-separator" aria-hidden="true">-</span>
        <div className="football-score-side football-score-side-against">
          <span>Indicateurs sous l'objectif</span>
          <strong>{footballScore.available ? footballScore.goalsAgainst : "—"}</strong>
          <small>but(s) encaissé(s)</small>
        </div>
      </div>
      <p>{scoreDescription}</p>
      <div className="football-score-meter" aria-label={`Barème : ${footballScore.available ? `${footballScore.goalsFor} indicateur(s) atteint(s) sur 4` : "indisponible"}`}>
        {Array.from({ length: 4 }, (_, index) => (
          <span
            className={footballScore.available ? (index < footballScore.goalsFor ? "is-reached" : "is-below") : "is-unavailable"}
            key={`score-segment-${index}`}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="football-score-integrated" aria-label="KPI intégrés au score">
        <span>Intègre :</span>
        <b>% passes réussies</b>
        <b>% tirs cadrés</b>
        <b>% duels gagnés</b>
        <b>% possession</b>
      </div>
    </div>
  );
}

function YellowCardsPanel({ snapshot }: { snapshot: Snapshot }) {
  const cards = snapshot.yellowCards ?? [];
  return (
    <section className="yellow-cards-panel" aria-label="Cartons jaunes">
      <div className="yellow-cards-heading">
        <span><CreditCard size={16} /> Cartons jaunes</span>
        <strong>{cards.length}</strong>
      </div>
      {cards.length > 0 ? (
        <details className="yellow-cards-disclosure">
          <summary>Afficher le détail</summary>
          <ul>
            {cards.map((card, index) => (
              <li key={`${card.playerName}-${card.time}-${index}`}>
                <b>{card.playerName}</b>
                <small>{card.time}{card.reason ? ` · ${card.reason}` : ""}{card.travelCode ? ` · ${card.travelCode}` : ""}</small>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p>Aucun carton jaune dans la plage active.</p>
      )}
    </section>
  );
}

const TEAM_MOTIVATION_MESSAGES = [
  { minimumIndicators: 3, text: "Excellente dynamique. On garde l'intensité jusqu'au bout." },
  { minimumIndicators: 2, text: "Le collectif est lancé. On garde le rythme et on finit fort." },
  { minimumIndicators: 1, text: "La base est là. On se resserre et on transforme chaque action." },
  { minimumIndicators: 0, text: "Chaque action compte. On reste soudés et on repart ensemble." },
] as const;

function teamMotivationMessage(footballScore: FootballScore): string {
  return TEAM_MOTIVATION_MESSAGES.find(({ minimumIndicators }) => footballScore.available && footballScore.goalsFor >= minimumIndicators)?.text ?? TEAM_MOTIVATION_MESSAGES.at(-1)!.text;
}

function buildAwardItems(snapshot: Snapshot): MatchAward[] {
  return [
    {
      kind: "attack",
      label: "Meilleur buteur",
      symbol: "ATQ",
      podiumLabel: "Attaque",
      highlight: snapshot.highlights.bestScorer,
    },
    {
      kind: "midfield",
      label: "Meilleur passeur",
      symbol: "MIL",
      podiumLabel: "Milieu",
      highlight: snapshot.highlights.bestPasser,
    },
    {
      kind: "defense",
      label: "Meilleur joueur",
      symbol: "DEF",
      podiumLabel: "Défense",
      highlight: snapshot.highlights.defensiveWall,
    },
    {
      kind: "polyvalent",
      label: "Couteau suisse",
      symbol: "ALL",
      podiumLabel: "Polyvalence",
      highlight: playerHighlight(snapshot.coach.polyvalents[0], "Polyvalence", "Joueur le plus polyvalent"),
    },
  ].filter((award): award is MatchAward => Boolean(award.highlight));
}

function reorderMatchSheetAwards(awards: MatchAward[]) {
  const reordered = [...awards];
  const midfieldIndex = reordered.findIndex((award) => award.kind === "midfield");
  const defenseIndex = reordered.findIndex((award) => award.kind === "defense");
  if (midfieldIndex !== -1 && defenseIndex !== -1) {
    [reordered[midfieldIndex], reordered[defenseIndex]] = [reordered[defenseIndex], reordered[midfieldIndex]];
  }
  return reordered;
}

function playerHighlight(player: Player | undefined, label: string, detail: string): NonNullable<Highlight> | null {
  if (!player) return null;
  return { label, detail, name: player.name, role: player.role, operations: player.operations, value: player.polyvalence, valueLabel: "polyvalence", score: player.score };
}

function awardReferenceScore(award: MatchAward, player: Player | undefined) {
  if (award.kind === "polyvalent") return { value: award.highlight.value, label: "polyvalence", suffix: "%" };
  const operationType = award.kind === "attack" ? "CHG" : award.kind === "midfield" ? "ZONAGE" : "DECHG";
  const label = operationType === "DECHG" ? "positions RECEPTION" : `positions ${operationType}`;
  return { value: player?.positionsByType?.[operationType] ?? 0, label, suffix: "" };
}

function buildAwardChallengers(players: Player[], award: MatchAward) {
  const operationType = award.kind === "attack" ? "CHG" : award.kind === "midfield" ? "ZONAGE" : award.kind === "defense" ? "DECHG" : null;
  const operationCount = (player: Player) => {
    if (!operationType) return player.polyvalence;
    return player.byType[operationType] ?? 0;
  };
  const positionCount = (player: Player) => operationType ? player.positionsByType?.[operationType] ?? 0 : player.positions;
  const ranked = players
    .filter((player) => player.name !== award.highlight.name && (operationType ? operationCount(player) > 0 : player.operationTypes >= 2))
    .sort((a, b) => {
      return operationCount(b) - operationCount(a) || b.operations - a.operations || a.name.localeCompare(b.name, "fr");
    })
    .slice(0, 2);
  const leader = players.find((player) => player.name === award.highlight.name);
  const leaderOperationCount = leader ? operationCount(leader) : 0;
  const leaderPositionCount = leader ? positionCount(leader) : 0;
  return ranked.map((player) => ({
    player,
    operations: operationCount(player),
    delta: leaderOperationCount - operationCount(player),
    positions: positionCount(player),
    positionDelta: leaderPositionCount - positionCount(player),
    score: player.polyvalence,
    scoreDelta: (leader?.polyvalence ?? 0) - player.polyvalence,
  }));
}

function awardHoverTitle(player: Player | undefined, highlight: NonNullable<Highlight>) {
  if (!player) return `${highlight.name} - ${highlight.role} - ${formatHighlightValue(highlight)}`;
  return `${player.name} - ${displayRole(player.role)} - CHG ${player.byType.CHG} / ZONAGE ${player.byType.ZONAGE} / Réception ${player.byType.DECHG}`;
}

function formatHighlightValue(highlight: NonNullable<Highlight>) {
  const value = highlight.value ?? highlight.operations;
  const label = humanizeOperationLabel(highlight.valueLabel ?? "opérations");
  return `${formatNumber(value)}${label === "polyvalence" ? "%" : " " + label}`;
}

function humanizeOperationLabel(label: string) {
  return label.replace(/\bDECHG?\b/g, "Réception");
}

function buildCompositionGroups(players: Player[]): Record<CompositionRole, Player[]> {
  const sortPlayers = (items: Player[]) => [...items].sort((a, b) => b.operations - a.operations || a.name.localeCompare(b.name, "fr"));
  return {
    Attaquant: sortPlayers(players.filter((player) => player.role === "Attaquant")),
    Milieu: sortPlayers(players.filter((player) => player.role === "Milieu")),
    Défenseur: sortPlayers(players.filter((player) => player.role === "Défenseur")),
  };
}

function percentValue(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function splitFormationRows(players: Player[]) {
  if (players.length === 0) return [];
  const rowCount = players.length <= 5 ? 1 : players.length <= 12 ? 2 : 3;
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

function readLocalCauseriePlan(snapshot: Snapshot): CauseriePlan | null {
  try {
    const saved = readStorageValue("local", causerieStorageKey(snapshot));
    return saved ? normalizeCauseriePlan(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

function writeLocalCauseriePlan(snapshot: Snapshot, plan: CauseriePlan) {
  writeStorageValue("local", causerieStorageKey(snapshot), JSON.stringify(plan));
}

function matchKpiStorageKey(snapshot: Snapshot) {
  return `stef-match-kpis-v3:${snapshot.agency.code}:${snapshot.match.date}`;
}

function legacyMatchKpiStorageKey(snapshot: Snapshot) {
  return `stef-match-kpis-v2:${snapshot.agency.code}:${snapshot.match.date}`;
}

function loadMatchKpiCopy(snapshot: Snapshot): MatchKpiCopy {
  const defaults = defaultMatchKpiCopy();
  const saved = readStorageValue("local", matchKpiStorageKey(snapshot)) ?? readStorageValue("local", legacyMatchKpiStorageKey(snapshot));
  if (!saved) return defaults;
  try {
    const parsed = JSON.parse(saved) as Partial<MatchKpiCopy>;
    return normalizeMatchKpiCopy({
      injuriesValue: parsed.injuriesValue ?? defaults.injuriesValue,
      expectedPlayersValue: parsed.expectedPlayersValue ?? defaults.expectedPlayersValue,
    });
  } catch {
    return defaults;
  }
}

function defaultMatchKpiCopy(): MatchKpiCopy {
  return {
    injuriesValue: "",
    expectedPlayersValue: "",
  };
}

function normalizeMatchKpiCopy(copy: Partial<MatchKpiCopy> | null | undefined): MatchKpiCopy {
  const injuriesValue = typeof copy?.injuriesValue === "string" ? copy.injuriesValue : "";
  const expectedPlayersValue = typeof copy?.expectedPlayersValue === "string" ? copy.expectedPlayersValue : "";
  return {
    injuriesValue: injuriesValue.trim() === "" ? "" : String(clampEditableKpi(injuriesValue, 0, 0, 99)),
    expectedPlayersValue: expectedPlayersValue.trim() === "" ? "" : String(clampEditableKpi(expectedPlayersValue, 1, 1)),
  };
}

function clampEditableKpi(value: string, fallback: number, min: number, max?: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const bounded = Math.max(min, parsed);
  return max === undefined ? bounded : Math.min(max, bounded);
}

function formatRealStaffPercent(snapshot: Snapshot, expectedValue: string) {
  const expected = Number(expectedValue);
  if (!Number.isFinite(expected) || expected < 1) return "À renseigner";
  const percent = Math.round((snapshot.summary.players / expected) * 1000) / 10;
  return `${formatNumber(percent)}%`;
}

function formatRealStaffDetail(snapshot: Snapshot, expectedValue: string) {
  const expected = Number(expectedValue);
  if (!Number.isFinite(expected) || expected < 1) {
    return `${formatNumber(snapshot.summary.players)} joueur(s) présent(s) · effectif prévu à renseigner`;
  }
  return `${formatNumber(snapshot.summary.players)} joueur(s) présent(s) / ${formatNumber(expected)} prévu(s)`;
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
      weakRole ? `Équilibre terrain : ${displayRole(weakRole.role)} à ${Math.round(weakRole.percent)}% des joueurs.` : "",
      snapshot.summary.operationCounts.ZONAGE ? `${formatNumber(snapshot.summary.operationCounts.ZONAGE)} opérations ZONAGE.` : "",
    ]),
    defense: padPlanLines([
      risk,
      late > 0 ? `${late} position(s) à sécuriser.` : "Risque principal maîtrisé sur le dernier import.",
      snapshot.summary.operationCounts.DECHG ? `${formatNumber(snapshot.summary.operationCounts.DECHG)} opérations de réception.` : "",
    ]),
    attachments: {
      attack: [],
      midfield: [],
      defense: [],
    },
    mercato: "",
    mercatoProfiles: {},
    redCards: "",
    coach: {
      tactic: action.title,
      priority: priority || action.detail,
      arbitration: arbitration || "À préciser pendant la causerie.",
      review: review || "À planifier.",
    },
  };
}

function buildEmptyCauseriePlan(): CauseriePlan {
  return {
    team: "",
    manager: "",
    updatedAt: null,
    attack: ["", "", ""],
    midfield: ["", "", ""],
    defense: ["", "", ""],
    attachments: {
      attack: [],
      midfield: [],
      defense: [],
    },
    mercato: "",
    mercatoProfiles: {},
    redCards: "",
    coach: {
      tactic: "",
      priority: "",
      arbitration: "",
      review: "",
    },
  };
}

function normalizeCauseriePlan(plan: Partial<CauseriePlan> | null | undefined): CauseriePlan {
  const fallback = buildEmptyCauseriePlan();
  const input = plan && typeof plan === "object" ? plan : fallback;
  const text = (value: unknown, fallbackValue = "") => typeof value === "string" ? value : fallbackValue;
  const planLines = (value: unknown) => padPlanLines(Array.isArray(value) ? value.filter((line): line is string => typeof line === "string") : []);
  const updatedAt = typeof input.updatedAt === "string" ? input.updatedAt : null;
  const mercato = text(input.mercato);
  return {
    team: text(input.team, fallback.team),
    manager: text(input.manager, fallback.manager),
    updatedAt,
    attack: planLines(input.attack),
    midfield: planLines(input.midfield),
    defense: planLines(input.defense),
    attachments: {
      attack: normalizeCauserieAttachments(input.attachments?.attack, fallback.attachments.attack),
      midfield: normalizeCauserieAttachments(input.attachments?.midfield, fallback.attachments.midfield),
      defense: normalizeCauserieAttachments(input.attachments?.defense, fallback.attachments.defense),
    },
    mercato,
    mercatoProfiles: normalizeMercatoProfiles(input.mercatoProfiles, mercato),
    redCards: text(input.redCards),
    coach: {
      tactic: text(input.coach?.tactic),
      priority: text(input.coach?.priority),
      arbitration: text(input.coach?.arbitration),
      review: text(input.coach?.review),
    },
  };
}

function normalizeMercatoProfiles(value: unknown, mercato: string): MercatoProfiles {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entrantKeys = new Set(parseMercatoEntrants(mercato).map((entrant) => entrant.key));
  const profiles: MercatoProfiles = {};
  for (const [rawKey, rawProfile] of Object.entries(value)) {
    const key = rawKey.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR").slice(0, 240);
    if (!entrantKeys.has(key)) continue;
    if (rawProfile === "female" || rawProfile === "male") profiles[key] = rawProfile;
  }
  return profiles;
}

function hasManualCauserieContent(plan: CauseriePlan, snapshot: Snapshot) {
  const hasZoneContent = [...plan.attack, ...plan.midfield, ...plan.defense].some((item) => item.trim().length > 0);
  const hasAttachment = Object.values(plan.attachments).some((items) => items.length > 0);
  const hasMetadata = plan.team.trim().length > 0 || plan.manager.trim().length > 0;
  if (hasZoneContent || hasAttachment || hasMetadata || plan.mercato.trim().length > 0 || plan.redCards.trim().length > 0) return true;

  const generated = buildDefaultCauseriePlan(snapshot).coach;
  const legacyGenerated = new Set([
    "Reprendre les duels ouverts",
    "Reprendre les positions hors délai cible.",
    "Reprendre les duels hors délai cible.",
    "Surveiller l'équilibre milieu.",
    "À préciser pendant la causerie.",
    "Après correction de l'import.",
    "À planifier.",
  ]);
  return Object.entries(plan.coach).some(([field, value]) => {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed !== generated[field as keyof typeof generated].trim() && !legacyGenerated.has(trimmed);
  });
}

function normalizeCauserieAttachments(value: string[] | string | null | undefined, fallback: string[]) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").slice(0, 12);
  return typeof value === "string" && value ? [value] : fallback;
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

function matchAction(snapshot: Snapshot) {
  const late = delayedPositions(snapshot);
  if (late > 0) {
    const risk = snapshot.coach.travelRisks[0];
    return {
      title: "Sécuriser les positions prioritaires",
      detail: risk
        ? `${late} position(s) hors délai dans le score Excel. Zone prioritaire : ${travelRiskTitle(risk.travelCode)} (${formatNumber(risk.delayedPositions)} position(s)).`
        : `${late} position(s) hors délai dans le score Excel.`,
    };
  }
  return {
    title: "Maintenir le rythme",
    detail: "Aucune position à sécuriser sur le dernier import. Conserver le délai cible au prochain contrôle.",
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
    return { label: "Attaque · CHG", value: formatNumber(player.byType.CHG), detail: "opérations" };
  }
  if (snapshot.highlights.bestPasser?.name === player.name) {
    return { label: "Milieu · ZONAGE", value: formatNumber(player.byType.ZONAGE), detail: "opérations" };
  }
  if (snapshot.highlights.defensiveWall?.name === player.name) {
    return { label: "Défense · Réception", value: formatNumber(player.byType.DECHG), detail: "opérations" };
  }
  if (snapshot.coach.polyvalents.some((item) => item.name === player.name)) {
    return { label: "Polyvalence", value: `${player.polyvalence}%`, detail: `${player.operationTypes} types d'activité` };
  }
  return { label: "Activité totale", value: formatNumber(player.operations), detail: "opérations" };
}

function coachDecisionActions(snapshot: Snapshot) {
  const late = delayedPositions(snapshot);
  const risk = snapshot.coach.travelRisks[0];
  const weakRole = snapshot.summary.roleDistribution.reduce((min, current) => (current.percent < min.percent ? current : min), snapshot.summary.roleDistribution[0]);
  return [
    {
      kicker: "Priorité terrain",
      title: late > 0 ? "Positions à sécuriser" : "Match maîtrisé",
      detail: late > 0 ? `${late} position(s) hors délai cible dans le score Excel filtré.` : "Aucun écart de délai détecté dans le dernier import.",
      next: late > 0 ? "Action : vérifier les positions concernées avant le prochain brief." : "Action : maintenir le contrôle au prochain import.",
      level: late > 0 ? "danger" : "safe",
    },
    {
      kicker: "Zone à surveiller",
      title: risk ? travelRiskTitle(risk.travelCode) : "Aucun voyage critique",
      detail: risk ? `${formatNumber(risk.delayedPositions)} position(s) à revoir sur cette zone.` : "Pas de concentration de retard détectée.",
      next: risk ? travelRiskAction(risk.travelCode) : "Action : conserver le suivi standard.",
      level: risk ? "watch" : "safe",
    },
    {
      kicker: "Équilibre d'équipe",
      title: `${displayRole(weakRole.role)} à ${Math.round(weakRole.percent)}%`,
      detail: "Répartition calculée à partir des postes Excel des joueurs retenus.",
      next: "Action : contrôler si cette répartition correspond au besoin du quai.",
      level: "watch",
    },
  ];
}

function travelRiskTitle(travelCode: string) {
  return travelCode === "Non renseigné" ? "Code voyage manquant" : `Voyage ${travelCode}`;
}

function travelRiskAction(travelCode: string) {
  return travelCode === "Non renseigné"
    ? "Action : compléter le code voyage dans le fichier source avant la prochaine revue."
    : `Action : prioriser le voyage ${travelCode} dans la revue terrain.`;
}

function playerProfile(player: Player) {
  const entries = [
    { label: "CHG", value: player.byType.CHG, role: "attaque" },
    { label: "ZONAGE", value: player.byType.ZONAGE, role: "milieu" },
    { label: "Réception", value: player.byType.DECHG, role: "réception" },
  ].sort((a, b) => b.value - a.value);
  const leader = entries[0];
  const title = player.operationTypes >= 2 ? `Profil ${displayRole(player.role).toLowerCase()} avec appui polyvalent` : `Spécialiste ${leader.label}`;
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

function formatPercent(value: number | null | undefined) {
  return Number.isFinite(value) ? `${formatNumber(value as number)}%` : "À renseigner";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(value));
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

function roleClass(role: string) {
  if (role === "Attaquant") return "attack";
  if (role === "Milieu") return "midfield";
  return "defense";
}

function displayRole(role: string) {
  return role;
}

function roleCode(role: string) {
  if (role === "Attaquant") return "CHG";
  if (role === "Milieu") return "ZONAGE";
  return "DECHG";
}

function operationLabel(code: string) {
  return code === "DECHG" ? "Réception" : code;
}
