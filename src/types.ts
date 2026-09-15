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

export type Snapshot = {
  version: number;
  sourceName: string;
  importedAt: string;
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
    importedAt: string;
    referenceDate: string | null;
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
    excludedFromScore?: number;
  };
  hourlyPerformance?: Array<{
    label: string;
    hour: number;
    won: number | null;
    total: number | null;
    rate: number;
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
      agency: string;
      time: string;
      positions: number;
      timePerPosition: string;
      result: "gagné" | "perdu";
    }>;
    lostDuels: Array<{
      travelCode: string;
      agency: string;
      time: string;
      positions: number;
      timePerPosition: string;
    }>;
  };
  unloadingQuality?: {
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
    filterStats?: {
      sourceRows: number;
      periodRows: number;
      operatorRows: number;
      matchRows: number;
      scoringRows: number;
      excludedByPeriod: number;
      excludedByOperator: number;
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
