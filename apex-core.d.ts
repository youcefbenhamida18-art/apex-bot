/* Type declarations for the zero-dependency CommonJS engine (src/engine/apex-core.js) */

export type Side = "BUY" | "SELL";
export type Grade = "ELITE" | "STRONG" | "STANDARD" | "FORCED";

export interface StrategyHit {
  id: string;
  nameAr: string;
  quality: number;
  weight: number;
  note: string;
  bias: string;
}

export interface Signal {
  id: string;
  symbol: string;
  side: Side;
  price: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr: number;
  tp1R: number;
  slUnit: number;
  slPct: number;
  confidence: number;
  explosion: number;
  speed: number;
  align: number;
  hoursToTp2: number;
  qty: number;
  halfQty: number;
  secondQty: number;
  riskUSD: number;
  notional: number;
  annualTrend: string;
  h4: number;
  h1: number;
  d1: number;
  flow: number;
  avgWR: number;
  generation: number;
  reason: string;
  strategies: StrategyHit[];
  leader: { id: string; nameAr: string; note: string };
  agreement: number;
  grade: Grade;
  dataSource: string;
  createdAt: number;
}

export interface OpenTrade {
  id: string;
  symbol: string;
  side: Side;
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
  tp1Triggered?: boolean;
  origSl?: number;
}

export interface ClosedTrade extends OpenTrade {
  closePrice: number;
  rMultiple: number;
  closedAt: number;
}

export interface StrategyStat {
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
  genome: Record<string, number> | null;
  pending: number;
}

export interface ArenaReport {
  at: number;
  reason: string;
  input: number;
  executed: number;
  stages: { name: string; in: number; out: number }[];
  survivors: {
    symbol: string;
    side: Side;
    confidence: number;
    rr: number;
    explosion: number;
    hoursToTp2: number;
    strategies: StrategyHit[];
    leader: { id: string; nameAr: string; note: string };
  }[];
  executedSample: { strategy: string; nameAr: string; symbol: string; side: Side; reason: string }[];
  avgWR: number;
  generation: number;
  lastSignal?: Signal;
}

export interface EngineStatus {
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
  openTrades: OpenTrade[];
  closed: ClosedTrade[];
  strategyStats: StrategyStat[];
  lastArena: ArenaReport | null;
  lastSignal: Signal | null;
  config: {
    risk: { riskPerTradePct: number; startBalance: number; leverage: number; maxOpenTrades: number; maxDailyLossPct: number; feeRate: number };
    targets: { rr: number; rrElite: number; tp1Share: number; tp1R: number; tp1RElite: number; eliteExplosion: number };
    cadence: { intervalMs: number; bootSignal: boolean; tickMs: number; alignToClockHour: boolean; scanConcurrency: number };
    arena: Record<string, number>;
    watchlist: string[];
  };
}

export interface EngineOptions {
  config?: Record<string, unknown>;
  onEvent?: (level: string, message: string) => void;
  notify?: (text: string) => Promise<void>;
  loadState?: () => Promise<unknown>;
  saveState?: (state: unknown) => Promise<void>;
  onSignal?: (signal: Signal, trade: unknown) => Promise<void>;
  onTrade?: (evt: { type: string; trade: OpenTrade; pnl?: number }) => Promise<void>;
  feed?: unknown;
}

export interface Engine {
  VERSION: string;
  config: EngineStatus["config"] & Record<string, unknown>;
  start(opts?: { skipBoot?: boolean }): Promise<EngineStatus>;
  stop(): Promise<EngineStatus>;
  status(): EngineStatus;
  runCycle(reason: string): Promise<{ signal: Signal | null; report?: ArenaReport; error?: string }>;
  tick(): Promise<void>;
  strategies: { id: string; name: string; nameAr: string; bias: string }[];
}

declare const apex: {
  VERSION: string;
  DEFAULT_CONFIG: Record<string, unknown>;
  STRATEGY_META: { id: string; name: string; nameAr: string; bias: string }[];
  createEngine: (opts?: EngineOptions) => Engine;
  syntheticKlines: (symbol: string, interval: string, limit: number, endTime: number) => unknown[];
};

export default apex;
