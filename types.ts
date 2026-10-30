export interface StrategyHit {
  id: string;
  nameAr: string;
  quality: number;
  weight: number;
  note: string;
  bias: string;
}

export interface SignalDto {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr: number;
  tp1R: number;
  slPct: number;
  confidence: number;
  explosion: number;
  speed: number;
  align: number;
  hoursToTp2: number;
  grade: "ELITE" | "STRONG" | "STANDARD" | "FORCED";
  qty: number;
  riskUSD: number;
  annualTrend: string;
  flow: number;
  avgWR: number;
  generation: number;
  reason: string;
  strategies: StrategyHit[];
  leader: { id: string; nameAr: string; note: string };
  agreement: number;
  dataSource: string;
  createdAt: number;
}

export interface TradeDto {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  entry: number;
  price: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr: number;
  status: string;
  openedAt: number;
  upnl: number;
  realized: number;
  rNow: number;
  confidence: number;
  fams: string;
  rMultiple?: number;
  closePrice?: number;
  closedAt?: number;
  origSl?: number;
}

export interface StrategyStatDto {
  id: string;
  name: string;
  nameAr: string;
  bias: string;
  n: number;
  wins: number;
  losses: number;
  be: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  weight: number;
  pending: number;
  genome: Record<string, number> | null;
}

export interface ArenaRoundDto {
  id: number;
  createdAt: string;
  reason: string | null;
  input: number;
  executed: number;
  stages: { name: string; in: number; out: number }[] | null;
  survivors: {
    symbol: string;
    side: "BUY" | "SELL";
    confidence: number;
    rr: number;
    explosion: number;
    hoursToTp2: number;
    strategies: StrategyHit[];
    leader: { id: string; nameAr: string; note: string };
  }[] | null;
  executedSample: { strategy: string; nameAr: string; symbol: string; side: string; reason: string }[] | null;
  winnerSymbol: string | null;
  winnerSide: string | null;
  winnerConfidence: number | null;
  generation: number | null;
  avgWr: number | null;
}

export interface ArenaReportDto {
  at: number;
  reason: string;
  input: number;
  executed: number;
  stages: { name: string; in: number; out: number }[];
  survivors: {
    symbol: string;
    side: "BUY" | "SELL";
    confidence: number;
    rr: number;
    explosion: number;
    hoursToTp2: number;
    strategies: StrategyHit[];
    leader: { id: string; nameAr: string; note: string };
  }[];
  executedSample: { strategy: string; nameAr: string; symbol: string; side: string; reason: string }[];
  avgWR: number;
  generation: number;
  lastSignal?: SignalDto;
}

export interface StatusResponse {
  ok: boolean;
  status: {
    version: string;
    running: boolean;
    scanning: boolean;
    cycles: number;
    dataSource: string;
    lastError: string;
    lastCycleAt: number;
    startedAt: number | null;
    nextSignalAt: number;
    lastSignalAt: number;
    generation: number;
    balance: number;
    equity: number;
    unrealized: number;
    signalsToday: number;
    dayKey: string;
    openTrades: TradeDto[];
    closed: TradeDto[];
    strategyStats: StrategyStatDto[];
    lastArena: ArenaReportDto | null;
    lastSignal: SignalDto | null;
    config: {
      risk: { riskPerTradePct: number; maxOpenTrades: number; startBalance: number };
      targets: { rr: number; rrElite: number; tp1Share: number };
      cadence: { intervalMs: number; alignToClockHour: boolean };
      watchlist: string[];
    };
  };
  settings: {
    riskPerTradePct: number;
    startBalance: number;
    cadenceMinutes: number;
    rr: number;
    rrElite: number;
    alignToClockHour: boolean;
    watchlist: string[];
  };
  telegram: boolean;
  logs: { id: number; level: string; message: string; at: number }[];
  aggregates: {
    totalSignals: number;
    signalsToday: number;
    closed: number;
    wins: number;
    losses: number;
    sumR: number;
    sumPnl: number;
    tp2: number;
    winRate: number;
  };
  lastRounds: ArenaRoundDto[];
  strategyStats: StrategyStatDto[];
}
