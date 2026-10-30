import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  arenaRounds,
  engineState,
  events,
  settings,
  signals,
  strategyStats,
  trades,
} from "@/db/schema";
import apex, {
  type Engine,
  type EngineStatus,
  type OpenTrade,
  type Signal,
} from "@/engine/apex-core";
import { sendTelegram, telegramConfigured } from "@/lib/telegram";

/* ------------------------------------------------------------------ types */
export interface AppSettings {
  riskPerTradePct: number;
  startBalance: number;
  cadenceMinutes: number;
  rr: number;
  rrElite: number;
  alignToClockHour: boolean;
  watchlist: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  riskPerTradePct: Number(process.env.RISK_PER_TRADE_PCT ?? 1),
  startBalance: Number(process.env.START_BALANCE ?? 1000),
  cadenceMinutes: 60,
  rr: 5,
  rrElite: 6,
  alignToClockHour: true,
  watchlist: [],
};

export interface LogLine {
  id: number;
  level: string;
  message: string;
  at: number;
}

interface Service {
  engine: Engine;
  ready: Promise<void>;
  logs: LogLine[];
  savePending: boolean;
}

const g = globalThis as typeof globalThis & { __apexService?: Service };

let logId = 1;

/* --------------------------------------------------------------- settings */
export async function getSettings(): Promise<AppSettings> {
  try {
    const rows = await db.select().from(settings).where(sql`${settings.key} = 'engine'`).limit(1);
    const stored = (rows[0]?.value ?? {}) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getSettings()), ...patch };
  await db
    .insert(settings)
    .values({ key: "engine", value: next as unknown as Record<string, unknown>, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: next as unknown as Record<string, unknown>, updatedAt: new Date() } });
  return next;
}

/* ------------------------------------------------------------------ bridge */
function pushLog(level: string, message: string) {
  const svc = g.__apexService;
  if (!svc) return;
  svc.logs.unshift({ id: logId++, level, message, at: Date.now() });
  if (svc.logs.length > 160) svc.logs.length = 160;
  db.insert(events)
    .values({ level, message: message.slice(0, 1200) })
    .then(() => {
      // keep the table small
      return db.execute(
        sql`delete from events where id < (select coalesce(min(id),0) from (select id from events order by id desc limit 600) x)`,
      );
    })
    .catch(() => {});
}

async function loadStateFromDb(): Promise<unknown> {
  try {
    const rows = await db.select().from(engineState).where(sql`${engineState.id} = 1`).limit(1);
    return rows[0]?.state ?? null;
  } catch {
    return null;
  }
}

let saveTimer: NodeJS.Timeout | null = null;
let queuedState: unknown = null;

async function flushState() {
  if (!queuedState) return;
  const payload = queuedState;
  queuedState = null;
  const runningFlag = Boolean((payload as { running?: boolean }).running);
  try {
    await db
      .insert(engineState)
      .values({ id: 1, state: payload as Record<string, unknown>, running: runningFlag, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: engineState.id,
        set: { state: payload as Record<string, unknown>, running: runningFlag, updatedAt: new Date() },
      });
  } catch (e) {
    console.error("state save failed", e);
  }
}

function saveStateToDb(state: unknown) {
  queuedState = state;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushState();
  }, 1500);
}

const nz = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

async function persistSignal(sig: Signal) {
  try {
    await db
      .insert(signals)
      .values({
        id: sig.id,
        symbol: sig.symbol,
        side: sig.side,
        entry: nz(sig.price),
        sl: nz(sig.sl),
        tp1: nz(sig.tp1),
        tp2: nz(sig.tp2),
        rr: nz(sig.rr, 5),
        tp1r: nz(sig.tp1R, 2.5),
        slPct: nz(sig.slPct),
        confidence: nz(sig.confidence),
        explosion: nz(sig.explosion),
        speed: nz(sig.speed),
        alignScore: nz(sig.align),
        hoursToTp2: nz(sig.hoursToTp2),
        grade: sig.grade ?? "STANDARD",
        qty: nz(sig.qty),
        riskUsd: nz(sig.riskUSD),
        annualTrend: sig.annualTrend,
        flow: Math.round(nz(sig.flow)),
        avgWr: nz(sig.avgWR),
        generation: Math.round(nz(sig.generation, 1)),
        reason: sig.reason,
        dataSource: sig.dataSource,
        leader: (sig.leader ?? {}) as unknown as Record<string, unknown>,
        strategies: (sig.strategies ?? []) as unknown as Record<string, unknown>[],
      })
      .onConflictDoNothing();
  } catch (e) {
    pushLog("error", `تعذّر حفظ الصفقة في signals: ${(e as Error).message}`);
  }
  try {
    await db
      .insert(trades)
      .values({
        id: sig.id,
        symbol: sig.symbol,
        side: sig.side,
        entry: nz(sig.price),
        sl: nz(sig.sl),
        origSl: nz(sig.sl),
        tp1: nz(sig.tp1),
        tp2: nz(sig.tp2),
        rr: nz(sig.rr, 5),
        qty: nz(sig.qty),
        status: "OPEN",
        confidence: sig.confidence,
        fams: (sig.strategies ?? []).map((s) => s.id).join("+"),
        note: sig.leader?.note ?? "",
        price: nz(sig.price),
        openedAt: new Date(sig.createdAt),
      })
      .onConflictDoNothing();
  } catch (e) {
    pushLog("error", `تعذّر حفظ الصفقة في trades: ${(e as Error).message}`);
    console.error("signal persist failed", e);
  }
}

async function persistTradeUpdate(trade: OpenTrade) {
  try {
    await db
      .update(trades)
      .set({
        status: trade.status,
        sl: trade.sl,
        price: trade.price,
        upnl: Number((trade.upnl ?? 0).toFixed(4)),
        realized: Number((trade.realized ?? 0).toFixed(4)),
        rMultiple: trade.rMultiple ?? null,
        closePrice: trade.closePrice ?? null,
        closedAt: trade.closedAt ? new Date(trade.closedAt) : null,
        tp1At: trade.status === "TP1" || trade.tp1Triggered ? new Date() : null,
      })
      .where(sql`${trades.id} = ${trade.id}`);
  } catch (e) {
    pushLog("error", `تعذّر تحديث الصفقة: ${(e as Error).message}`);
    console.error("trade persist failed", e);
  }
}

let lastArenaAt = 0;
let lastStatsSync = 0;

async function persistArena(status: EngineStatus) {
  const a = status.lastArena;
  if (!a || a.at === lastArenaAt) return; // one row per blood-channel round, not per tick
  lastArenaAt = a.at;
  try {
    await db.insert(arenaRounds).values({
      reason: a.reason,
      input: a.input,
      executed: a.executed,
      stages: a.stages as unknown as Record<string, unknown>[],
      survivors: a.survivors as unknown as Record<string, unknown>[],
      executedSample: a.executedSample as unknown as Record<string, unknown>[],
      winnerSymbol: a.lastSignal?.symbol ?? null,
      winnerSide: a.lastSignal?.side ?? null,
      winnerConfidence: a.lastSignal?.confidence ?? null,
      generation: a.generation,
      avgWr: a.avgWR,
    });
    await db.execute(
      sql`delete from arena_rounds where id < (select coalesce(min(id),0) from (select id from arena_rounds order by id desc limit 120) x)`,
    );
  } catch (e) {
    console.error("arena persist failed", e);
  }
}

async function persistStrategyStats(status: EngineStatus, force = false) {
  if (!force && Date.now() - lastStatsSync < 45_000) return;
  lastStatsSync = Date.now();
  try {
    for (const s of status.strategyStats) {
      await db
        .insert(strategyStats)
        .values({
          id: s.id,
          name: s.name,
          nameAr: s.nameAr,
          bias: s.bias,
          n: s.n,
          wins: s.wins,
          losses: s.losses,
          be: s.be,
          winRate: s.winRate,
          avgR: s.avgR,
          profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : 99,
          weight: s.weight,
          pending: s.pending,
          genome: (s.genome ?? {}) as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: strategyStats.id,
          set: {
            n: s.n,
            wins: s.wins,
            losses: s.losses,
            be: s.be,
            winRate: s.winRate,
            avgR: s.avgR,
            profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : 99,
            weight: s.weight,
            pending: s.pending,
            genome: (s.genome ?? {}) as Record<string, unknown>,
            updatedAt: new Date(),
          },
        });
    }
  } catch (e) {
    console.error("stats persist failed", e);
  }
}

function buildEngine(cfgSettings: AppSettings): Engine {
  return apex.createEngine({
    config: {
      risk: {
        riskPerTradePct: cfgSettings.riskPerTradePct,
        startBalance: cfgSettings.startBalance,
      },
      targets: { rr: cfgSettings.rr, rrElite: cfgSettings.rrElite },
      cadence: {
        intervalMs: Math.max(5, cfgSettings.cadenceMinutes) * 60_000,
        alignToClockHour: cfgSettings.alignToClockHour,
      },
      ...(cfgSettings.watchlist.length ? { watchlist: cfgSettings.watchlist } : {}),
    },
    onEvent: (level, message) => pushLog(level, message),
    notify: async (text) => {
      pushLog("telegram", text.replace(/\n+/g, " | ").slice(0, 400));
      if (telegramConfigured()) await sendTelegram(text);
    },
    loadState: loadStateFromDb,
    saveState: async (state) => saveStateToDb(state),
    onSignal: async (sig) => {
      await persistSignal(sig);
      const st = g.__apexService?.engine.status();
      if (st) {
        await persistArena(st);
        await persistStrategyStats(st);
      }
      await flushState();
    },
    onTrade: async (evt) => {
      await persistTradeUpdate(evt.trade);
      const st = g.__apexService?.engine.status();
      if (st) await persistStrategyStats(st, true);
    },
  });
}

/* ------------------------------------------------------------------ public */
export function getService(): Service {
  if (g.__apexService) return g.__apexService;
  const svc: Service = {
    engine: buildEngine(DEFAULT_SETTINGS),
    logs: [],
    savePending: false,
    ready: Promise.resolve(),
  };
  g.__apexService = svc;
  return svc;
}

/** (Re)create the engine with persisted settings; returns a started-if-needed engine. */
export async function ensureService(): Promise<Service> {
  const svc = getService();
  await svc.ready;
  return svc;
}

export async function applySettingsAndRebuild(patch: Partial<AppSettings>) {
  const next = await saveSettings(patch);
  const svc = getService();
  const wasRunning = svc.engine.status().running;
  await svc.engine.stop();
  await flushState();
  const fresh = buildEngine(next);
  svc.engine = fresh;
  svc.ready = (async () => {
    // preload persisted memory into the new instance
    await fresh.start({ skipBoot: true });
    if (!wasRunning) await fresh.stop();
  })();
  await svc.ready;
  return next;
}

/* ---------------------------------------------------------------- snapshot
   Periodic DB snapshot so the dashboard always shows the arena rounds, the
   live strategy weights and the open positions — even for cycles fired by the
   hourly scheduler (not through an API call). */
let snapshotTimer: NodeJS.Timeout | null = null;

function ensureSnapshotLoop() {
  if (snapshotTimer) return;
  snapshotTimer = setInterval(() => {
    const svc = g.__apexService;
    if (!svc) return;
    const st = svc.engine.status();
    if (!st.running) return;
    void (async () => {
      try {
        for (const t of st.openTrades) await persistTradeUpdate(t);
        await persistArena(st);
        await persistStrategyStats(st);
        await flushState();
      } catch {
        /* transient DB hiccup — next tick retries */
      }
    })();
  }, 20_000);
  snapshotTimer.unref?.();
}

export async function startEngine(opts?: { skipBoot?: boolean }): Promise<EngineStatus> {
  const settings = await getSettings();
  const svc = getService();
  // rebuild with the persisted settings, but never leave an orphan loop behind
  await svc.engine.stop().catch(() => {});
  svc.engine = buildEngine(settings);
  const st = await svc.engine.start(opts ?? {});
  ensureSnapshotLoop();
  void st;
  await db
    .insert(engineState)
    .values({ id: 1, state: (queuedState ?? {}) as Record<string, unknown>, running: true, updatedAt: new Date() })
    .onConflictDoUpdate({ target: engineState.id, set: { running: true, updatedAt: new Date() } })
    .catch(() => {});
  void flushState();
  return st;
}

export async function stopEngine(): Promise<EngineStatus> {
  const svc = getService();
  const st = await svc.engine.stop();
  await flushState();
  await db.update(engineState).set({ running: false }).where(sql`${engineState.id} = 1`).catch(() => {});
  return st;
}

export async function runScanNow(): Promise<{ signal: Signal | null; status: EngineStatus }> {
  const svc = getService();
  const res = await svc.engine.runCycle("MANUAL");
  const status = svc.engine.status();
  await persistArena(status);
  await persistStrategyStats(status);
  await flushState();
  return { signal: res.signal, status };
}

export function engineStatus(): EngineStatus {
  return getService().engine.status();
}

export async function resetEngine() {
  const svc = getService();
  await svc.engine.stop().catch(() => {});
  await db.delete(trades).catch(() => {});
  await db.delete(signals).catch(() => {});
  await db.delete(arenaRounds).catch(() => {});
  await db.delete(strategyStats).catch(() => {});
  await db.delete(engineState).catch(() => {});
  svc.engine = buildEngine(await getSettings());
  pushLog("warn", "تم تصفير المحرك: الذاكرة، الصفقات، والإحصائيات.");
  return svc.engine.status();
}

/** Called after each cycle from routes/instrumentation to snapshot arena + stats. */
export async function persistCycleArtifacts() {
  const status = engineStatus();
  await persistArena(status);
  await persistStrategyStats(status);
  await flushState();
}
