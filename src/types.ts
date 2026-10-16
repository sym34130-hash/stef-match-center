export type MatchStatus = "MAÎTRISÉ" | "À SURVEILLER" | "ACTION NÉCESSAIRE" | "À COMPLÉTER";

export type Agency = {
  code: string;
  name: string;
  canImport: boolean;
};

export type Player = {
  name: string;
  role: string;
  operations: number;
  positions: number;
  positionsByType?: Partial<Record<"CHG" | "DECHG" | "ZONAGE", number>>;
  travels: number;
  byType: {
    CHG: number;
    DECHG: number;
    ZONAGE: number;
  };
  attackPercent: number;
  defensePercent: number;
  midfieldPercent: number;
  dominantShare: number;
  operationTypes: number;
  polyvalence: number;
  score: number;
  volumeIndex: number;
  contributionPercent: number;
  firstOperation: string | null;
  lastOperation: string | null;
  status: MatchStatus;
};

export type Highlight = {
  label: string;
  detail: string;
  name: string;
  role: string;
  operations: number;
  value: number;
  valueLabel: string;
  score: number;
} | null;

export type Alert = {
  level: MatchStatus;
  title: string;
  detail: string;
};

export type CauserieItem = {
  label: string;
  value: string;
};

export type AnalysisState = "disponible" | "indisponible";

export type OperatingNight = {
  startDate: string;
  endDate: string;
  start: string;
  end: string;
  timeZone: "Europe/Paris";
  /** Matches the official minute-precision range: all seconds of the final minute are included. */
  endInclusiveMinute: true;
  eligibleOperations: number;
  otherNightOperations: number;
  candidates: Array<{ startDate: string; operations: number }>;
  selectionRule: "maximum_operations_puis_date_recente";
};

export type ZonageTravelDiagnostic = {
  travelCode: string;
  state: AnalysisState;
  receivedPositions: number;
  qualifiablePositions: number;
  onTimePositions: number;
  latePositions: number;
  unqualifiablePositions: number;
  /** Late / qualifiable; null when no position can be qualified. */
  anomalyRate: number | null;
  coverageRate: number | null;
  averageExcessSeconds: number | null;
};

export type ZonageDiagnostic = {
  state: AnalysisState;
  reason: string | null;
  night: OperatingNight | null;
  targetMinutes: number;
  receivedPositions: number;
  qualifiablePositions: number;
  onTimePositions: number;
  latePositions: number;
  unqualifiablePositions: number;
  anomalyRate: number | null;
  coverageRate: number | null;
  unattributedPositions: number;
  positionsWithoutReception: number;
  repeatedReceptionPositions: number;
  unqualifiableReasons: Record<string, number>;
  travels: ZonageTravelDiagnostic[];
  top5: ZonageTravelDiagnostic[];
  details: Array<{
    position: string;
    travelCode: string | null;
    classification: "hors_delai" | "non_qualifiable";
    reason: string | null;
    delaySeconds: number | null;
    receptionAt: string;
    zonageAt: string | null;
  }>;
  warnings: string[];
};

export type UnloadingHourlySlot = {
  start: string;
  end: string;
  endInclusiveMinute: boolean;
  label: string;
  state: AnalysisState;
  travelCount: number;
  operationRows: number;
  distinctPositions: number;
  meanSecondsPerPosition: number | null;
  offTargetTravels: number;
  offTargetPercent: number | null;
  targetSeconds: number;
  travelCodes: string[];
};

export type UnloadingHourlyAnalysis = {
  state: AnalysisState;
  reason: string | null;
  night: OperatingNight | null;
  targetSeconds: number;
  grouping: "heure_du_premier_DECHG_de_la_nuit";
  eligibleTravels: number;
  excludedZeroDurationTravels: number;
  excludedSmallTravels?: number;
  excludedQuayRows?: number;
  excludedSegmentRows?: number;
  unidentifiedTravelRows: number;
  meanSecondsPerPosition: number | null;
  offTargetTravels: number;
  offTargetPercent: number | null;
  items: UnloadingHourlySlot[];
  travels: Array<{
    travelCode: string;
    start: string;
    end: string;
    operationRows: number;
    distinctPositions: number;
    timePerPositionSeconds: number;
    offTarget: boolean;
  }>;
};

export type AnomalySummary = {
  state: AnalysisState;
  reason: string | null;
  night: OperatingNight | null;
  zonage: Pick<ZonageDiagnostic, "latePositions" | "unqualifiablePositions" | "receivedPositions" | "qualifiablePositions">;
  unloading: Pick<UnloadingHourlyAnalysis, "offTargetTravels" | "eligibleTravels">;
  /** Existing TCD loading population, not silently resegmented by operating night. */
  loading: { state: AnalysisState; offTargetTravels: number | null; eligibleTravels: number | null; source: "TCD PPT"; scope: "plage_active_toutes_dates" };
  worstReceptionSlot: Pick<UnloadingHourlySlot, "start" | "end" | "label" | "meanSecondsPerPosition" | "travelCount"> | null;
  topZonageTravel: Pick<ZonageTravelDiagnostic, "travelCode" | "latePositions" | "qualifiablePositions"> | null;
  warnings: string[];
  messages: string[];
};

export type Snapshot = {
  version: number;
  sourceName: string;
  importedAt: string;
  operationalAnalysisVersion?: number;
  zonageDiagnostic?: ZonageDiagnostic;
  unloadingHourlyAnalysis?: UnloadingHourlyAnalysis;
  anomalySummary?: AnomalySummary;
  excludedTravelCodes?: string[];
  performanceCriteria?: {
    zonageMinutes: number;
    loadingSeconds: number;
    unloadingSeconds: number;
    scoreTargetPercent: number;
  };
  agency: {
    code: string;
    detectedCode: string;
    name: string;
  };
  match: {
    date: string;
    legacyDate?: string;
    firstOperation: string | null;
    lastOperation: string | null;
    timeRangeLabel: string;
    score: number | null;
    status: MatchStatus;
    objective: string;
    dzTargetMinutes: number;
    periodStart?: string;
    periodEnd?: string;
    periodLabel?: string;
    filterDescription?: string;
    scoringFilterDescription?: string;
  };
  operationalScore?: {
    status: "available" | "unavailable";
    targetPercent: number;
    goalsFor: number | null;
    goalsAgainst: number | null;
    indicators: {
      passRate: number | null;
      loadingPercent: number | null;
      unloadingPercent: number | null;
      possessionPercent: number | null;
    };
    loading: {
      status: "available" | "unavailable";
      scored: number | null;
      conceded: number | null;
      targetSeconds: number;
    };
  };
  yellowCards?: Array<{
    playerName: string;
    time: string;
    reason: string;
    travelCode: string;
  }>;
  dailyIndicators?: {
    sourceName: string;
    importedAt: string | null;
    referenceDate: string | null;
    agencyCode?: string | null;
    punctuality: Partial<Record<"arrivalPunctuality" | "departurePunctuality" | "destinationPunctuality" | "temperatureReturn", number>>;
    punctualityTargets?: Partial<Record<"arrivalPunctuality" | "departurePunctuality" | "destinationPunctuality" | "temperatureReturn", number>>;
    expedition: { tonnage?: number };
  } | null;
  summary: {
    operations: number;
    positions: number;
    players: number;
    travels: number;
    duelWon: number;
    duelTotal: number;
    duelRate: number | null;
    passRate?: number | null;
    tonnage?: number | null;
    possessionPercent: number | null;
    possessionPositions: {
      zonage: number;
      reception: number;
      matched: number | null;
    };
    operationCounts: Record<string, number>;
    roleDistribution: Array<{ role: string; count: number; percent: number }>;
    sourceRows?: number;
    scoringRows?: number;
    excludedByPeriod?: number;
    excludedByOperator?: number;
    excludedByTravel?: number;
    excludedFromScore?: number;
  };
  hourlyPerformance?: Array<{
    label: string;
    hour: number;
    won: number | null;
    total: number | null;
    rate: number;
    arrivingTravels?: number | null;
    arrivingTravelCodes?: string[];
  }>;
  loadingQuality?: {
    targeted: number;
    offTarget: number;
    targetedPercent: number | null;
    offTargetPercent: number | null;
    targetTimePerPosition?: string;
    averageTimePerPositionSeconds?: number | null;
    loadingDetails?: Array<{
      travelCode: string;
      time: string;
      positions: string;
      timePerPosition: string;
      where: string;
      result: "cadré" | "non cadré";
    }>;
    nonTargetedShots: Array<{
      travelCode: string;
      time: string;
      positions: string;
      timePerPosition: string;
      where: string;
    }>;
  };
  unloadingDuelQuality?: {
    won: number;
    lost: number;
    wonPercent: number | null;
    lostPercent: number | null;
    duels: Array<{
      travelCode: string;
      destination?: string | null;
      agency: string;
      time: string;
      positions: number;
      timePerPosition: string;
      result: "gagné" | "perdu";
    }>;
    lostDuels: Array<{
      travelCode: string;
      destination?: string | null;
      agency: string;
      time: string;
      positions: number;
      timePerPosition: string;
    }>;
  };
  unloadingQuality?: {
    travels?: Array<{ travelCode: string; destination: string | null }>;
    targeted: number;
    offTarget: number;
    targetedPercent: number | null;
    offTargetPercent: number | null;
    targetTimePerPosition?: string;
    averageTimePerPositionSeconds?: number | null;
    eligibleTrips?: number;
  };
  duelQuality?: {
    won: number;
    lost: number;
    wonPercent: number | null;
    lostPercent: number | null;
    lostDuels: Array<{
      travelCode: string;
      agency: string;
      time: string;
      positions: number;
      timePerPosition: string;
    }>;
  };
  compositionPeriods?: {
    first: { label: string; players: Player[] };
    second: { label: string; players: Player[] };
    quarters?: Array<{
      id: "q1" | "q2" | "q3" | "q4";
      label: string;
      players: Player[];
    }>;
  };
  highlights: {
    manOfTheMatch: Highlight;
    bestScorer: Highlight;
    bestPasser: Highlight;
    defensiveWall: Highlight;
  };
  players: Player[];
  positions: Array<{
    id: string;
    travelCode: string;
    agencySegment: string;
    operators: string[];
    firstOperation: string;
    lastOperation: string;
    delayMinutes: number | null;
    duelWon: boolean;
    status: string;
  }>;
  coach: {
    playersInForm: Player[];
    polyvalents: Player[];
    specialists: Player[];
    progressPlayers: Player[];
    alerts: Alert[];
    travelRisks: Array<{ travelCode: string; delayedPositions: number }>;
  };
  causerie: CauserieItem[];
  validation: {
    rowCount: number;
    criticalMissingRows: number;
    invalidDateRows: number;
    unknownOperationRows: number;
    duplicateRows: number;
    issueRows?: number;
    warnings: string[];
    importReadiness?: {
      status: "complete" | "partial";
      unavailableKpis: Array<{ id: string; label: string; source: string; reason: string }>;
    };
    filterStats?: {
      sourceRows: number;
      periodRows: number;
      operatorRows: number;
      matchRows: number;
      scoringRows: number;
      excludedByPeriod: number;
      excludedByOperator: number;
      excludedByTravel?: number;
      excludedFromScore: number;
    };
    kpiRules?: {
      matchFilter: string;
      scoringFilter: string;
      period: string;
    };
  };
  kpiDictionaryVersion?: number;
};
