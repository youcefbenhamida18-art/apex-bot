import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Full engine memory (generation, genomes, live strategy stats, paper wallet). */
export const engineState = pgTable("engine_state", {
  id: integer("id").primaryKey().default(1),
  state: jsonb("state").notNull(),
  running: boolean("running").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every published elite trade (one per hour + one at boot). */
export const signals = pgTable("signals", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  entry: doublePrecision("entry").notNull(),
  sl: doublePrecision("sl").notNull(),
  tp1: doublePrecision("tp1").notNull(),
  tp2: doublePrecision("tp2").notNull(),
  rr: doublePrecision("rr").notNull(),
  tp1r: doublePrecision("tp1r").notNull(),
  slPct: doublePrecision("sl_pct").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  explosion: doublePrecision("explosion").notNull(),
  speed: doublePrecision("speed").notNull(),
  alignScore: doublePrecision("align_score").notNull(),
  hoursToTp2: doublePrecision("hours_to_tp2").notNull(),
  grade: text("grade").notNull(),
  qty: doublePrecision("qty").notNull(),
  riskUsd: doublePrecision("risk_usd").notNull(),
  annualTrend: text("annual_trend"),
  flow: integer("flow"),
  avgWr: doublePrecision("avg_wr"),
  generation: integer("generation"),
  reason: text("reason"),
  dataSource: text("data_source"),
  leader: jsonb("leader"),
  strategies: jsonb("strategies").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Paper/live position lifecycle: OPEN -> TP1 -> TP2 | BE | SL */
export const trades = pgTable("trades", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  entry: doublePrecision("entry").notNull(),
  sl: doublePrecision("sl").notNull(),
  origSl: doublePrecision("orig_sl").notNull(),
  tp1: doublePrecision("tp1").notNull(),
  tp2: doublePrecision("tp2").notNull(),
  rr: doublePrecision("rr").notNull(),
  qty: doublePrecision("qty").notNull(),
  status: text("status").notNull().default("OPEN"),
  price: doublePrecision("price"),
  closePrice: doublePrecision("close_price"),
  upnl: doublePrecision("upnl").notNull().default(0),
  realized: doublePrecision("realized").notNull().default(0),
  rMultiple: doublePrecision("r_multiple"),
  confidence: doublePrecision("confidence"),
  fams: text("fams"),
  note: text("note"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  tp1At: timestamp("tp1_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

/** Live performance of each of the 20 strategies -> drives arena weights. */
export const strategyStats = pgTable("strategy_stats", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  bias: text("bias").notNull(),
  n: integer("n").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  be: integer("be").notNull().default(0),
  winRate: doublePrecision("win_rate").notNull().default(0),
  avgR: doublePrecision("avg_r").notNull().default(0),
  profitFactor: doublePrecision("profit_factor").notNull().default(1),
  weight: doublePrecision("weight").notNull().default(1),
  pending: integer("pending").notNull().default(0),
  genome: jsonb("genome"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Blood-channel rounds: what survived, what was executed and why. */
export const arenaRounds = pgTable("arena_rounds", {
  id: serial("id").primaryKey(),
  reason: text("reason"),
  input: integer("input").notNull().default(0),
  executed: integer("executed").notNull().default(0),
  stages: jsonb("stages"),
  survivors: jsonb("survivors"),
  executedSample: jsonb("executed_sample"),
  winnerSymbol: text("winner_symbol"),
  winnerSide: text("winner_side"),
  winnerConfidence: doublePrecision("winner_confidence"),
  generation: integer("generation"),
  avgWr: doublePrecision("avg_wr"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Runtime log stream for the dashboard. */
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** User-tunable engine settings. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
