/**
 * ============================================================================
 *  APEX FRACTAL v10 — "BLOOD CHANNEL" INSTITUTIONAL QUANT ENGINE
 *  ---------------------------------------------------------------------------
 *  Zero dependencies (node >= 18): https / crypto / fs only  -> Termux ready.
 *
 *  What changed vs v9.1 (by design, everything the user demanded):
 *   1) EXACTLY ONE elite trade per hour  + one trade IMMEDIATELY after boot.
 *   2) Risk:Reward is 1:5 (1:6 for elite explosions). TP1 = 50% out at 2.5R
 *      (3R for 1:6), stop -> breakeven, the rest rides to TP2.
 *   3) 20 real strategies fight in a brutal 5-stage "Blood Channel" arena.
 *      Only ONE survivor is published. Stupid trades are executed publicly.
 *   4) Direction is sacred: any candidate against the 1D/4H/1H flow is killed
 *      in stage 0 and can never be relaxed. No counter-flow garbage.
 *   5) Explosion hunting: ATR expansion + volume climax + displacement are
 *      scored separately and dominate the final ranking.
 *   6) Speed filter: estimated hours-to-TP2 must be small, so targets are hit
 *      fast (R per hour is part of the score).
 *   7) Infinite evolution: every strategy owns a mutable genome; live results
 *      (win rate / avg R / profit factor) re-weight and mutate it forever.
 *
 *  The same file powers the Next.js dashboard (createEngine with injected
 *  storage/notify hooks) and runs standalone on a phone:  node apex-core.js
 * ============================================================================
 */
'use strict';

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VERSION = '10.0.0';

/* ------------------------------------------------------------------ config */
const DEFAULT_CONFIG = {
  baseUrl: 'https://fapi.binance.com',
  watchlist: [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT',
    'AVAXUSDT', 'SUIUSDT', 'LINKUSDT', 'NEARUSDT', 'APTUSDT', 'LTCUSDT', '1000PEPEUSDT',
    'UNIUSDT', 'FETUSDT', 'RENDERUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT', 'TIAUSDT',
    'AAVEUSDT', 'SEIUSDT', 'WIFUSDT', 'TONUSDT', 'TRXUSDT', 'BCHUSDT', 'ETCUSDT', 'FILUSDT'
  ],
  tfs: { macro: '1d', structure: '4h', trend: '1h', exec: '15m', micro: '5m' },
  risk: {
    startBalance: 1000,
    riskPerTradePct: 1.0,
    leverage: 20,
    feeRate: 0.0004,
    maxOpenTrades: 6,
    maxDailyLossPct: 6
  },
  targets: { rr: 5, rrElite: 6, tp1Share: 0.5, tp1R: 2.5, tp1RElite: 3, eliteExplosion: 0.82 },
  cadence: {
    intervalMs: 60 * 60 * 1000, // one trade per hour
    bootSignal: true,           // one trade immediately after start
    tickMs: 20000,              // position management loop
    scanConcurrency: 4,
    alignToClockHour: true
  },
  arena: {
    minConfidence: 0.60,   // strict gate; relaxation ladder never breaks direction rules
    maxHoursToTp2: 16,     // speed filter — targets must arrive fast
    minSlPct: 0.10,
    maxSlPct: 1.9,
    minQuoteVol24h: 20e6,
    cooldownAfterSlMin: 60,
    minGapMin: 50,
    maxRelaxRounds: 4
  },
  genetics: { population: 24, elites: 16, benchmarks: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] },
  cacheTtl: { '1d': 30 * 60e3, '4h': 12 * 60e3, '1h': 5 * 60e3, '15m': 45e3, '5m': 20e3 },
  live: { enabled: false, apiKey: '', apiSecret: '' }
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const mergeConfig = (base, over) => {
  const out = clone(base);
  Object.keys(over || {}).forEach((k) => {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') out[k] = mergeConfig(out[k], v);
    else out[k] = v;
  });
  return out;
};

const num = (x, d = 0) => { const v = parseFloat(x); return Number.isFinite(v) ? v : d; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[*_`\[\]]/g, ' ');

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (idx < items.length) { const i = idx++; try { out[i] = await fn(items[i], i); } catch (e) { out[i] = null; } }
  }));
  return out;
}

/* -------------------------------------------------------------------- math */
class CoreMath {
  static EMA(src, p) {
    const k = 2 / (p + 1), out = new Float64Array(src.length);
    if (!src.length) return out;
    out[0] = src[0];
    for (let i = 1; i < src.length; i++) out[i] = src[i] * k + out[i - 1] * (1 - k);
    return out;
  }
  static SMA(src, p) {
    const out = new Float64Array(src.length); let s = 0;
    for (let i = 0; i < src.length; i++) { s += src[i]; if (i >= p) s -= src[i - p]; out[i] = s / Math.min(p, i + 1); }
    return out;
  }
  static STD(src, sma, p) {
    const out = new Float64Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const from = Math.max(0, i - p + 1); let v = 0;
      for (let j = from; j <= i; j++) { const d = src[j] - sma[i]; v += d * d; }
      out[i] = Math.sqrt(v / (i - from + 1));
    }
    return out;
  }
  static TR(h, l, c) {
    const tr = new Float64Array(c.length); tr[0] = h[0] - l[0];
    for (let i = 1; i < c.length; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    return tr;
  }
  static ATR(h, l, c, p = 14) { return this.EMA(this.TR(h, l, c), p); }
  static RSI(c, p = 14) {
    const rsi = new Float64Array(c.length);
    if (c.length <= p) return rsi;
    let g = 0, ls = 0;
    for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else ls += -d; }
    let ag = g / p, al = ls / p;
    rsi[p] = 100 - 100 / (1 + ag / (al || 1e-9));
    for (let i = p + 1; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
      al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
      rsi[i] = 100 - 100 / (1 + ag / (al || 1e-9));
    }
    return rsi;
  }
  static ADX(h, l, c, p = 14) {
    const n = c.length, pdm = new Float64Array(n), mdm = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
      pdm[i] = up > dn && up > 0 ? up : 0;
      mdm[i] = dn > up && dn > 0 ? dn : 0;
    }
    const tr = this.TR(h, l, c), a = this.EMA(tr, p), pp = this.EMA(pdm, p), mm = this.EMA(mdm, p);
    const dx = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const pi = 100 * pp[i] / (a[i] || 1e-9), mi = 100 * mm[i] / (a[i] || 1e-9);
      dx[i] = 100 * Math.abs(pi - mi) / ((pi + mi) || 1e-9);
    }
    return this.EMA(dx, p);
  }
  static MACD(c, f = 12, s = 26, sig = 9) {
    const ef = this.EMA(c, f), es = this.EMA(c, s), m = new Float64Array(c.length);
    for (let i = 0; i < c.length; i++) m[i] = ef[i] - es[i];
    const sg = this.EMA(m, sig), hist = new Float64Array(c.length);
    for (let i = 0; i < c.length; i++) hist[i] = m[i] - sg[i];
    return { macd: m, signal: sg, hist };
  }
  static supertrend(h, l, c, p = 10, mult = 3) {
    const atr = this.ATR(h, l, c, p);
    const dir = new Int8Array(c.length).fill(1), line = new Float64Array(c.length);
    let ub = Infinity, lb = -Infinity;
    for (let i = 0; i < c.length; i++) {
      const hl2 = (h[i] + l[i]) / 2;
      const bu = hl2 + mult * atr[i], bl = hl2 - mult * atr[i];
      ub = i === 0 ? bu : (bu < ub || c[i - 1] > ub ? bu : ub);
      lb = i === 0 ? bl : (bl > lb || c[i - 1] < lb ? bl : lb);
      if (i === 0) { dir[i] = 1; line[i] = lb; continue; }
      dir[i] = dir[i - 1] === 1 ? (c[i] < lb ? -1 : 1) : (c[i] > ub ? 1 : -1);
      line[i] = dir[i] === 1 ? lb : ub;
    }
    return { dir, line };
  }
  static hi(a, f, t) { let m = -Infinity; for (let i = Math.max(0, f); i <= Math.min(a.length - 1, t); i++) if (a[i] > m) m = a[i]; return m; }
  static lo(a, f, t) { let m = Infinity; for (let i = Math.max(0, f); i <= Math.min(a.length - 1, t); i++) if (a[i] < m) m = a[i]; return m; }
  static pctRank(arr, i, look) {
    const from = Math.max(0, i - look); let below = 0, n = 0;
    for (let j = from; j < i; j++) { n++; if (arr[j] < arr[i]) below++; }
    return n ? below / n : 1;
  }
  /** swing fractals: +1 swing high, -1 swing low */
  static fractals(h, l, k = 2) {
    const n = h.length, sh = new Array(n).fill(0), sl = new Array(n).fill(0);
    for (let i = k; i < n - k; i++) {
      let a = true, b = true;
      for (let j = i - k; j <= i + k; j++) { if (j === i) continue; if (h[j] >= h[i]) a = false; if (l[j] <= l[i]) b = false; }
      sh[i] = a ? 1 : 0; sl[i] = b ? 1 : 0;
    }
    return { sh, sl };
  }
}

/* ------------------------------------------------------- deterministic noise
   Used only when Binance is unreachable so the dashboard/engine never dies. */
function hash01(str) {
  const h = crypto.createHash('sha1').update(String(str)).digest();
  return h.readUInt32BE(0) / 4294967295;
}
function valueNoise(x, seed) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const a = hash01(seed + ':' + i), b = hash01(seed + ':' + (i + 1));
  return a + (b - a) * u;
}
const SYNTH_BASE = {
  BTCUSDT: 96500, ETHUSDT: 3450, BNBUSDT: 690, SOLUSDT: 195, XRPUSDT: 2.35, DOGEUSDT: 0.36,
  ADAUSDT: 0.92, AVAXUSDT: 38, SUIUSDT: 4.6, LINKUSDT: 23, NEARUSDT: 5.4, APTUSDT: 9.2,
  LTCUSDT: 105, '1000PEPEUSDT': 0.021, UNIUSDT: 13, FETUSDT: 1.4, RENDERUSDT: 5.2, ARBUSDT: 0.78,
  OPUSDT: 1.9, INJUSDT: 24, TIAUSDT: 5.1, AAVEUSDT: 320, SEIUSDT: 0.44, WIFUSDT: 1.6, TONUSDT: 5.3,
  TRXUSDT: 0.24, BCHUSDT: 430, ETCUSDT: 27, FILUSDT: 5.1
};
const SYNTH_VOL = { BTCUSDT: 0.55, ETHUSDT: 0.7, BNBUSDT: 0.7, TRXUSDT: 0.5, LTCUSDT: 0.8, BCHUSDT: 0.85 };

/**
 * Offline market simulator (used only when Binance is geo-blocked/unreachable).
 * Deterministic in absolute time -> every timeframe agrees, the market keeps
 * moving with the real clock, and it produces realistic volatility clustering
 * plus impulse bars so the arena always has genuine explosions to judge.
 */
function syntheticKlines(symbol, interval, limit, endTime) {
  const MS = { '1m': 6e4, '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 }[interval] || 9e5;
  const base = SYNTH_BASE[symbol] || 10 * (0.2 + hash01(symbol) * 50);
  const vf = (SYNTH_VOL[symbol] || 1) * (0.75 + hash01(symbol + 'vf') * 0.9);
  const end = Math.floor(endTime / MS) * MS;
  const start = end - (limit - 1) * MS;
  const seed = symbol + '|' + interval;   // bar-shape/volume identity
  const pseed = symbol + '|px';           // PRICE identity — identical on every timeframe
  const d = 864e5;
  const ph1 = hash01(pseed + 'a') * 6.283, ph2 = hash01(pseed + 'b') * 6.283;

  // impulse process: rare, large, decaying shocks. Defined on a FIXED 5-minute
  // grid so the same absolute instant has the same price on every timeframe
  // (1m price must equal the 15m/1h/4h curve — otherwise the position guard
  // would compare the entry to a different market).
  const GRID = 3e5;
  const shockSeed = symbol + '|shock';
  const shockAt = (t) => {
    const h1 = hash01(shockSeed + 's' + t);
    if (h1 < 0.93) return 0;
    return (hash01(shockSeed + 'g' + t) - 0.48) * 2 * (0.004 + hash01(shockSeed + 'm' + t) * 0.014) * vf;
  };
  const shockCache = new Map();
  const shockField = (t) => {
    const g = Math.floor(t / GRID) * GRID;
    if (shockCache.has(g)) return shockCache.get(g);
    let acc = 0, w = 1;
    for (let j = 0; j < 30; j++) { acc += shockAt(g - j * GRID) * w; w *= 0.86; }
    if (shockCache.size > 4000) shockCache.clear();
    shockCache.set(g, acc);
    return acc;
  };
  const amp = (t) => 0.35 + 1.9 * valueNoise(t / (5 * 36e5), pseed + 'amp') + 0.7 * valueNoise(t / (45 * 6e4), pseed + 'amp2');
  const P = (t) => {
    const macro = 0.30 * Math.sin(t / (46 * d) + ph1) + 0.16 * Math.sin(t / (11 * d) + ph2);
    const n1 = (valueNoise(t / (7 * d), pseed + 'n1') - 0.5) * 0.46;
    const n2 = (valueNoise(t / (26 * 36e5), pseed + 'n2') - 0.5) * 0.20;
    const n3 = (valueNoise(t / (4 * 36e5), pseed + 'n3') - 0.5) * 0.055 * amp(t);
    const n4 = (valueNoise(t / (16 * 6e4), pseed + 'n4') - 0.5) * 0.016 * amp(t) * vf;
    return base * Math.exp(macro + n1 + n2 + n3 + n4 + shockField(t));
  };
  const bars = [];
  for (let i = 0; i < limit; i++) {
    const t = start + i * MS;
    const o = P(t), c = P(Math.min(t + MS, endTime));
    const ret = Math.abs(c - o) / o;
    const wick = (o * 0.0009 * vf + Math.abs(c - o) * 0.45) * (0.4 + hash01(seed + 'w' + t) * 1.9);
    const volBase = (1.6e8 / base) * (0.35 + hash01(seed + 'v' + t) * 1.3);
    bars.push({
      time: t, open: o, close: c,
      high: Math.max(o, c) + wick * hash01(seed + 'h' + t),
      low: Math.min(o, c) - wick * hash01(seed + 'l' + t),
      volume: volBase * (1 + 140 * ret / vf) * (ret > 0.008 * vf ? 2.6 : 1),
      quoteVolume: volBase * o * (1 + 140 * ret / vf)
    });
  }
  return bars;
}

/* ------------------------------------------------------------------ network */
class DataFeed {
  constructor(cfg, log) {
    this.cfg = cfg; this.log = log || (() => {});
    this.cache = new Map(); this.source = 'binance'; this.failStreak = 0;
    this.precision = new Map(); this.offlineNotified = false;
  }
  _get(url, timeout = 8000) {
    return new Promise((resolve) => {
      let done = false;
      const req = https.get(url, { timeout }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          if (done) return; done = true;
          if (res.statusCode >= 400) return resolve({ ok: false, status: res.statusCode, body });
          try { resolve({ ok: true, status: res.statusCode, data: JSON.parse(body) }); }
          catch (e) { resolve({ ok: false, status: 0, body }); }
        });
      });
      req.on('timeout', () => { req.destroy(); if (!done) { done = true; resolve({ ok: false, status: 0, err: 'timeout' }); } });
      req.on('error', (e) => { if (!done) { done = true; resolve({ ok: false, status: 0, err: e.message }); } });
    });
  }
  async klines(symbol, interval, limit = 200, maxAge) {
    const key = `${symbol}|${interval}|${limit}`;
    const ttl = maxAge !== undefined ? maxAge : (this.cfg.cacheTtl[interval] || 60e3);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
    if (this.source === 'synthetic') {
      const v = syntheticKlines(symbol, interval, limit, Date.now());
      this.cache.set(key, { t: Date.now(), v }); return v;
    }
    const url = `${this.cfg.baseUrl}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    for (let a = 0; a < 2; a++) {
      const r = await this._get(url);
      if (r.ok && Array.isArray(r.data)) {
        this.failStreak = 0;
        const v = r.data.map((k) => ({ time: k[0], open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), volume: num(k[5]), quoteVolume: num(k[7]) }));
        this.cache.set(key, { t: Date.now(), v });
        return v;
      }
      if (r.status === 429 || r.status === 418) await delay(2500);
      else await delay(300);
    }
    this.failStreak++;
    if (this.failStreak >= 4 && this.source === 'binance') {
      this.source = 'synthetic'; this.cache.clear();
      this.log('warn', 'Binance غير متاح من هذا الخادم — تم تفعيل مولّد السوق البديل (Synthetic) لمتابعة عمل المحرك.');
    }
    return null;
  }
  /** try to come back to real market data after a geo-block/outage */
  async probe() {
    const r = await this._get(`${this.cfg.baseUrl}/fapi/v1/time`, 5000);
    if (r.ok) {
      this.source = 'binance'; this.failStreak = 0; this.cache.clear();
      this.log('success', 'عاد الاتصال بـ Binance Futures — البيانات الحقيقية مُفعّلة من جديد.');
      return true;
    }
    return false;
  }
  async price(symbol) {
    const k = await this.klines(symbol, '1m', 3, 15e3);
    return k && k.length ? k[k.length - 1].close : null;
  }
  async prices(symbols) {
    if (this.source === 'synthetic') {
      const out = new Map();
      for (const s of symbols) { const p = await this.price(s); if (p) out.set(s, p); }
      return out;
    }
    const r = await this._get(`${this.cfg.baseUrl}/fapi/v1/ticker/price`);
    if (r.ok && Array.isArray(r.data)) {
      const out = new Map(); const want = new Set(symbols);
      r.data.forEach((x) => { if (want.has(x.symbol)) out.set(x.symbol, num(x.price)); });
      if (out.size) return out;
    }
    const out = new Map();
    for (const s of symbols) { const p = await this.price(s); if (p) out.set(s, p); }
    return out;
  }
  async signed(method, endpoint, params) {
    const p = Object.assign({}, params, { timestamp: Date.now(), recvWindow: 10000 });
    const qs = Object.keys(p).filter((k) => p[k] !== undefined && p[k] !== null).map((k) => `${k}=${encodeURIComponent(p[k])}`).join('&');
    const sig = crypto.createHmac('sha256', this.cfg.live.apiSecret).update(qs).digest('hex');
    const url = `${this.cfg.baseUrl}${endpoint}?${qs}&signature=${sig}`;
    return new Promise((resolve) => {
      const req = https.request(url, { method, timeout: 9000, headers: { 'X-MBX-APIKEY': this.cfg.live.apiKey } }, (res) => {
        let b = ''; res.on('data', (d) => { b += d; });
        res.on('end', () => { try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(b) }); } catch (e) { resolve({ ok: false, status: res.statusCode }); } });
      });
      req.on('error', (e) => resolve({ ok: false, status: 0, err: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, err: 'timeout' }); });
      req.end();
    });
  }
  async syncExchangeInfo() {
    const r = await this._get(`${this.cfg.baseUrl}/fapi/v1/exchangeInfo`, 20000);
    if (!r.ok || !r.data || !r.data.symbols) return false;
    r.data.symbols.forEach((s) => {
      if (s.status !== 'TRADING' || s.contractType !== 'PERPETUAL') return;
      const lot = s.filters.find((f) => f.filterType === 'LOT_SIZE');
      const pr = s.filters.find((f) => f.filterType === 'PRICE_FILTER');
      const nt = s.filters.find((f) => f.filterType === 'MIN_NOTIONAL');
      if (lot && pr) this.precision.set(s.symbol, { stepSize: num(lot.stepSize), tickSize: num(pr.tickSize), minQty: num(lot.minQty), minNotional: nt ? num(nt.notional) : 5 });
    });
    return this.precision.size > 0;
  }
}

/* =========================================================== 20 STRATEGIES
   Each: { id, name, nameAr, bias: 'trend'|'reversal'|'any', run(ctx) }
   run(ctx) -> null | { side:'BUY'|'SELL', score:0..1, slUnit, note }       */
const S = [];
const def = (id, name, nameAr, bias, run) => S.push({ id, name, nameAr, bias, run });

def('TREND_EMA20_PULLBACK', 'EMA20 Pullback', 'ارتداد EMA20 مع الاتجاه', 'trend', (x) => {
  const { c, l, h, L, ema20, ema50, rsi, adx, atr } = x, P = L - 1;
  if (adx[L] < 15) return null;
  const up = ema20[L] > ema50[L] && ema50[L] > ema50[L - 6] && c[L] > ema20[L];
  const dn = ema20[L] < ema50[L] && ema50[L] < ema50[L - 6] && c[L] < ema20[L];
  const touchUp = Math.min(l[L], l[P]) <= ema20[L] + 0.5 * atr[L];
  const touchDn = Math.max(h[L], h[P]) >= ema20[L] - 0.5 * atr[L];
  let s = 0.60 + (adx[L] > 26 ? 0.09 : 0) + (x.volR > 1.2 ? 0.05 : 0);
  if (up && touchUp && rsi[L] > rsi[P] && rsi[L] < 66) return { side: 'BUY', score: s, slUnit: c[L] - Math.min(l[L], l[P]) + 0.35 * atr[L], note: 'ارتداد من EMA20 داخل اتجاه صاعد' };
  if (dn && touchDn && rsi[L] < rsi[P] && rsi[L] > 34) return { side: 'SELL', score: s, slUnit: Math.max(h[L], h[P]) - c[L] + 0.35 * atr[L], note: 'ارتداد من EMA20 داخل اتجاه هابط' };
  return null;
});

def('TREND_VWAP_BOUNCE', 'Session VWAP Bounce', 'ارتداد من VWAP الجلسة', 'trend', (x) => {
  const { c, L, vwap, atr, adx } = x;
  if (!vwap || adx[L] < 18) return null;
  const d = (c[L] - vwap[L]) / (atr[L] || 1);
  if (Math.abs(d) > 0.55) return null;
  const up = c[L] > vwap[L] && c[L - 2] < vwap[L - 2] && c[L] > c[L - 1];
  const dn = c[L] < vwap[L] && c[L - 2] > vwap[L - 2] && c[L] < c[L - 1];
  if (up) return { side: 'BUY', score: 0.62 + (x.volR > 1.3 ? 0.06 : 0), slUnit: 1.15 * atr[L], note: 'رفض VWAP لأعلى' };
  if (dn) return { side: 'SELL', score: 0.62 + (x.volR > 1.3 ? 0.06 : 0), slUnit: 1.15 * atr[L], note: 'رفض VWAP لأسفل' };
  return null;
});

def('DONCHIAN_BREAK_20', 'Donchian 20 Breakout', 'اختراق قمة/قاع 20 شمعة', 'trend', (x) => {
  const { c, h, l, L, atr } = x, P = L - 1;
  const dh = CoreMath.hi(h, L - 22, L - 2), dl = CoreMath.lo(l, L - 22, L - 2);
  const body = Math.abs(c[P] - x.o[P]) / ((h[P] - l[P]) || 1);
  const bonus = Math.min(0.18, Math.max(0,(x.volR - 1) * 0.1)) + (body > 0.55 ? 0.06 : 0);
  if (c[P] > dh && c[L] > dh && x.volR >= 1.05 && x.rsi[L] < 82)
    return { side: 'BUY', score: 0.56 + bonus, slUnit: c[L] - dh + 0.7 * atr[L], note: 'اختراق قمة 20 شمعة بحجم مؤكِّد' };
  if (c[P] < dl && c[L] < dl && x.volR >= 1.05 && x.rsi[L] > 18)
    return { side: 'SELL', score: 0.56 + bonus, slUnit: dl - c[L] + 0.7 * atr[L], note: 'اختراق قاع 20 شمعة بحجم مؤكِّد' };
  return null;
});

def('SQUEEZE_IGNITION', 'Bollinger Squeeze Ignition', 'انفجار الانضغاط', 'any', (x) => {
  const { c, L, bbw, bbwRank, sma20, atr } = x;
  if (L < 105 || bbwRank > 0.18) return null;
  if (!(bbw[L] > bbw[L - 1] * 1.05)) return null;
  const s = 0.60 + (x.volR > 1.25 ? 0.08 : 0) + (x.adx[L] > x.adx[L - 1] ? 0.05 : 0) + (bbwRank < 0.08 ? 0.06 : 0);
  if (c[L] > sma20[L] && c[L] > c[L - 3] && x.volR > 1.1) return { side: 'BUY', score: s, slUnit: 1.45 * atr[L], note: 'انضغاط بولينجر انفجر لأعلى' };
  if (c[L] < sma20[L] && c[L] < c[L - 3] && x.volR > 1.1) return { side: 'SELL', score: s, slUnit: 1.45 * atr[L], note: 'انضغاط بولينجر انفجر لأسفل' };
  return null;
});

def('LIQ_SWEEP_LOW', 'Liquidity Sweep (Low)', 'اصطياد سيولة القيعان', 'reversal', (x) => {
  const { c, l, o, L, atr } = x, P = L - 1;
  const sl22 = CoreMath.lo(l, L - 24, L - 3);
  const body = Math.abs(c[P] - o[P]) || atr[L] * 0.08;
  const wick = Math.min(o[P], c[P]) - l[P];
  if (l[P] < sl22 && c[P] > sl22 && wick > 1.4 * body && x.volR > 1.15 && c[L] >= c[P] * 0.998)
    return { side: 'BUY', score: 0.60 + Math.min(0.14, (x.volR - 1.25) * 0.09) + (wick > 2.4 * body ? 0.06 : 0), slUnit: c[L] - l[P] + 0.2 * atr[L], note: 'فتيل سفلي ابتلع السيولة وعاد' };
  return null;
});

def('LIQ_SWEEP_HIGH', 'Liquidity Sweep (High)', 'اصطياد سيولة القمم', 'reversal', (x) => {
  const { c, h, o, L, atr } = x, P = L - 1;
  const sh22 = CoreMath.hi(h, L - 24, L - 3);
  const body = Math.abs(c[P] - o[P]) || atr[L] * 0.08;
  const wick = h[P] - Math.max(o[P], c[P]);
  if (h[P] > sh22 && c[P] < sh22 && wick > 1.4 * body && x.volR > 1.15 && c[L] <= c[P] * 1.002)
    return { side: 'SELL', score: 0.60 + Math.min(0.14, (x.volR - 1.25) * 0.09) + (wick > 2.4 * body ? 0.06 : 0), slUnit: h[P] - c[L] + 0.2 * atr[L], note: 'فتيل علوي ابتلع السيولة وعاد' };
  return null;
});

def('MOMENTUM_IGNITION', 'Momentum Ignition', 'اشتعال الزخم (3 شموع)', 'trend', (x) => {
  const { c, o, h, l, L, atr } = x;
  let move = 0, ok = true;
  for (let i = L - 2; i <= L; i++) {
    const rng = (h[i] - l[i]) || 1e-9, body = c[i] - o[i];
    if (Math.abs(body) / rng < 0.45) ok = false;
    move += body;
  }
  if (!ok || Math.abs(move) < 0.95 * atr[L] || x.volR < 1.15) return null;
  const s = 0.62 + Math.min(0.18, (x.volR - 1.5) * 0.08) + (Math.abs(move) > 2.4 * atr[L] ? 0.07 : 0);
  return move > 0
    ? { side: 'BUY', score: s, slUnit: c[L] - CoreMath.lo(l, L - 3, L) + 0.25 * atr[L], note: 'ثلاث شموع صعودية متتالية بانفجار حجم' }
    : { side: 'SELL', score: s, slUnit: CoreMath.hi(h, L - 3, L) - c[L] + 0.25 * atr[L], note: 'ثلاث شموع هبوطية متتالية بانفجار حجم' };
});

def('VOLUME_CLIMAX_REVERSAL', 'Volume Climax Reversal', 'انعكاس ذروة الحجم', 'reversal', (x) => {
  const { c, o, L, rsi } = x, P = L - 1;
  if (x.volR < 2.4) return null;
  const engulfUp = c[P] < o[P] && c[L] > o[L] && c[L] > o[P] && rsi[P] < 30;
  const engulfDn = c[P] > o[P] && c[L] < o[L] && c[L] < o[P] && rsi[P] > 70;
  const s = 0.58 + Math.min(0.16, (x.volR - 2.4) * 0.05);
  if (engulfUp) return { side: 'BUY', score: s, slUnit: 1.3 * x.atr[L], note: 'ذروة بيع + ابتلاع صاعد بحجم ضخم' };
  if (engulfDn) return { side: 'SELL', score: s, slUnit: 1.3 * x.atr[L], note: 'ذروة شراء + ابتلاع هابط بحجم ضخم' };
  return null;
});

def('RSI_HIDDEN_DIVERGENCE', 'RSI Hidden Divergence', 'دايفرجنس خفي (استمرار)', 'trend', (x) => {
  const { c, l, h, L, rsi } = x;
  const i1 = L - 8, i2 = L - 1;
  if (rsi[L] > 82 || rsi[L] < 18) return null;
  if (c[i2] > c[i1] && l[i2] > l[i1] && rsi[i2] < rsi[i1] && x.ema20[L] > x.ema50[L])
    return { side: 'BUY', score: 0.61 + (x.adx[L] > 24 ? 0.07 : 0), slUnit: 1.25 * x.atr[L], note: 'دايفرجنس خفي صاعد = استمرار' };
  if (c[i2] < c[i1] && h[i2] < h[i1] && rsi[i2] > rsi[i1] && x.ema20[L] < x.ema50[L])
    return { side: 'SELL', score: 0.61 + (x.adx[L] > 24 ? 0.07 : 0), slUnit: 1.25 * x.atr[L], note: 'دايفرجنس خفي هابط = استمرار' };
  return null;
});

def('RSI_REGULAR_DIVERGENCE', 'RSI Regular Divergence', 'دايفرجنس عكسي عند التطرف', 'reversal', (x) => {
  const { c, l, h, L, rsi, bbw } = x;
  const look = 16; let pi = -1;
  for (let i = L - 4; i >= L - look; i--) if (rsi[i] < 32 || rsi[i] > 68) { pi = i; break; }
  if (pi < 0) return null;
  if (l[L] < l[pi] && rsi[L] > rsi[pi] && rsi[L] < 45 && c[L] > x.sma20[L] - 2 * x.std20[L])
    return { side: 'BUY', score: 0.60 + (rsi[pi] < 26 ? 0.08 : 0), slUnit: c[L] - l[L] + 0.4 * x.atr[L], note: 'دايفرجنس صاعد مع قاع أدنى' };
  if (h[L] > h[pi] && rsi[L] < rsi[pi] && rsi[L] > 55 && c[L] < x.sma20[L] + 2 * x.std20[L])
    return { side: 'SELL', score: 0.60 + (rsi[pi] > 74 ? 0.08 : 0), slUnit: h[L] - c[L] + 0.4 * x.atr[L], note: 'دايفرجنس هابط مع قمة أعلى' };
  return null;
});

def('ORDERBLOCK_RETEST', 'Order Block Retest', 'إعادة اختبار كتلة الأوامر', 'trend', (x) => {
  const { c, o, h, l, L, atr } = x;
  for (let k = L - 1; k >= Math.max(3, L - 14); k--) {
    const impulse = c[k + 1] - c[k];
    if (Math.abs(impulse) < 1.0 * atr[L]) continue;
    if (impulse > 0 && c[k] < o[k]) {
      const top = Math.max(o[k], c[k]), bot = l[k];
      if (l[L] <= top && l[L] >= bot && c[L] > top)
        return { side: 'BUY', score: 0.63 + (x.volR > 1.2 ? 0.06 : 0), slUnit: c[L] - bot + 0.15 * atr[L], note: 'كتلة أوامر صعودية اختُبرت ورُفضت' };
    }
    if (impulse < 0 && c[k] > o[k]) {
      const bot = Math.min(o[k], c[k]), top = h[k];
      if (h[L] >= bot && h[L] <= top && c[L] < bot)
        return { side: 'SELL', score: 0.63 + (x.volR > 1.2 ? 0.06 : 0), slUnit: top - c[L] + 0.15 * atr[L], note: 'كتلة أوامر هبوطية اختُبرت ورُفضت' };
    }
  }
  return null;
});

def('FVG_FILL', 'Fair Value Gap Fill', 'فجوة القيمة العادلة FVG', 'trend', (x) => {
  const { c, h, l, L, atr } = x;
  for (let i = L - 1; i >= Math.max(2, L - 16); i--) {
    if (l[i] > h[i - 2]) { // bullish imbalance
      const top = l[i], bot = h[i - 2];
      if (c[L] > (top + bot) / 2 && l[L] <= top && c[L] > top * 0.999)
        return { side: 'BUY', score: 0.62 + (top - bot > 0.8 * atr[L] ? 0.06 : 0), slUnit: c[L] - bot + 0.2 * atr[L], note: 'FVG صاعدة امتلأت جزئياً وارتد السعر' };
    }
    if (h[i] < l[i - 2]) {
      const bot = h[i], top = l[i - 2];
      if (c[L] < (top + bot) / 2 && h[L] >= bot && c[L] < bot * 1.001)
        return { side: 'SELL', score: 0.62 + (top - bot > 0.8 * atr[L] ? 0.06 : 0), slUnit: top - c[L] + 0.2 * atr[L], note: 'FVG هابطة امتلأت جزئياً وارتد السعر' };
    }
  }
  return null;
});

def('STRUCTURE_BOS', 'Break of Structure', 'كسر الهيكل BOS/CHoCH', 'trend', (x) => {
  const { c, h, l, L, atr, swings } = x;
  if (!swings) return null;
  const lastHigh = swings.lastHigh, lastLow = swings.lastLow;
  const disp = Math.abs(c[L] - c[L - 1]);
  if (!lastHigh || !lastLow) return null;
  if (c[L] > lastHigh.price && disp > 0.55 * atr[L] && x.volR > 1.0)
    return { side: 'BUY', score: 0.64 + (L - lastHigh.i > 6 ? 0.05 : 0), slUnit: c[L] - CoreMath.lo(l, Math.max(0, L - 5), L) + 0.2 * atr[L], note: `BOS صاعد فوق ${lastHigh.price.toPrecision(6)}` };
  if (c[L] < lastLow.price && disp > 0.55 * atr[L] && x.volR > 1.0)
    return { side: 'SELL', score: 0.64 + (L - lastLow.i > 6 ? 0.05 : 0), slUnit: CoreMath.hi(h, Math.max(0, L - 5), L) - c[L] + 0.2 * atr[L], note: `BOS هابط تحت ${lastLow.price.toPrecision(6)}` };
  return null;
});

def('RANGE_REVERT_BB', 'Range Reversion (BB)', 'ارتداد النطاق العرضي', 'reversal', (x) => {
  const { c, o, L, rsi, adx, sma20, std20 } = x;
  if (adx[L] > 20 || x.htf.adx4h > 22) return null; // only inside dead ranges
  const bbU = sma20[L] + 2 * std20[L], bbL = sma20[L] - 2 * std20[L];
  if (c[L] < bbL && rsi[L] < 31 && c[L] > o[L]) return { side: 'BUY', score: 0.56 + (rsi[L] < 24 ? 0.07 : 0), slUnit: c[L] - x.l[L] + 0.4 * x.atr[L], note: 'نطاق عرضي: رفض الحد السفلي' };
  if (c[L] > bbU && rsi[L] > 69 && c[L] < o[L]) return { side: 'SELL', score: 0.56 + (rsi[L] > 76 ? 0.07 : 0), slUnit: x.h[L] - c[L] + 0.4 * x.atr[L], note: 'نطاق عرضي: رفض الحد العلوي' };
  return null;
});

def('ATR_EXPANSION_BLAST', 'ATR Expansion Blast', 'انفجار تمدد ATR', 'any', (x) => {
  const { c, o, h, l, L, atr, atrAvg } = x;
  const ratio = atr[L] / (atrAvg || atr[L]);
  if (ratio < 1.22 || x.volR < 1.12) return null;
  const body = Math.abs(c[L] - o[L]) / ((h[L] - l[L]) || 1e-9);
  if (body < 0.5) return null;
  const s = 0.60 + Math.min(0.22, (ratio - 1.22) * 0.28) + Math.min(0.08, (x.volR - 1.12) * 0.05);
  return c[L] > o[L]
    ? { side: 'BUY', score: s, slUnit: c[L] - l[L] + 0.35 * atr[L], note: `تمدد ATR ×${ratio.toFixed(2)} مع حجم ضخم` }
    : { side: 'SELL', score: s, slUnit: h[L] - c[L] + 0.35 * atr[L], note: `تمدد ATR ×${ratio.toFixed(2)} مع حجم ضخم` };
});

def('SESSION_RANGE_BREAK', 'Session Range Break', 'اختراق نطاق الجلسة', 'trend', (x) => {
  const { c, h, l, k, L, atr } = x;
  const d0 = new Date(k[L].time).getUTCHours();
  if (d0 < 6) return null;
  const idx = [];
  const day = new Date(k[L].time).toISOString().slice(0, 10);
  for (let i = L; i >= Math.max(0, L - 60); i--) if (new Date(k[i].time).toISOString().slice(0, 10) === day) idx.unshift(i);
  if (idx.length < 8) return null;
  const orHi = CoreMath.hi(h, idx[0], idx[0] + 3), orLo = CoreMath.lo(l, idx[0], idx[0] + 3);
  if (c[L] > orHi && x.volR > 1.2 && c[L] - orHi > 0.05 * atr[L])
    return { side: 'BUY', score: 0.58 + (x.volR > 1.6 ? 0.07 : 0), slUnit: c[L] - Math.max(orLo, c[L] - 2 * atr[L]) + 0.2 * atr[L], note: `اختراق نطاق افتتاح الجلسة (${d0}:00 UTC)` };
  if (c[L] < orLo && x.volR > 1.2 && orLo - c[L] > 0.05 * atr[L])
    return { side: 'SELL', score: 0.58 + (x.volR > 1.6 ? 0.07 : 0), slUnit: Math.min(orHi, c[L] + 2 * atr[L]) - c[L] + 0.2 * atr[L], note: `اختراق نطاق افتتاح الجلسة (${d0}:00 UTC)` };
  return null;
});

def('SUPERTREND_FLIP', 'Supertrend Flip', 'انعكاس السوبرترند', 'trend', (x) => {
  const { c, L, st, atr } = x;
  if (!st) return null;
  let flipped = -1;
  for (let i = L; i >= Math.max(1, L - 4); i--) if (st.dir[i] !== st.dir[i - 1]) { flipped = i; break; }
  if (flipped < 0) return null;
  const s = 0.60 + (x.volR > 1.3 ? 0.06 : 0) + (x.adx[L] > 22 ? 0.05 : 0);
  if (st.dir[L] === 1 && c[L] > st.line[L]) return { side: 'BUY', score: s, slUnit: Math.max(1.1 * atr[L], c[L] - st.line[L]), note: 'السوبرترند انقلب صاعداً' };
  if (st.dir[L] === -1 && c[L] < st.line[L]) return { side: 'SELL', score: s, slUnit: Math.max(1.1 * atr[L], st.line[L] - c[L]), note: 'السوبرترند انقلب هابطاً' };
  return null;
});

def('MACD_ZERO_MOMENTUM', 'MACD Zero-Line Momentum', 'زخم MACD عند الصفر', 'trend', (x) => {
  const { c, L, macd, adx } = x;
  if (!macd || adx[L] < 15) return null;
  const exp = Math.abs(macd.hist[L]) > Math.abs(macd.hist[L - 1]) && Math.abs(macd.hist[L - 1]) > Math.abs(macd.hist[L - 2]);
  const up = macd.macd[L] > 0 && macd.macd[L] > macd.signal[L] && macd.hist[L] > 0 && (macd.macd[L - 6] <= 0 || exp);
  const dn = macd.macd[L] < 0 && macd.macd[L] < macd.signal[L] && macd.hist[L] < 0 && (macd.macd[L - 6] >= 0 || exp);
  const s = 0.59 + (exp ? 0.08 : 0) + (adx[L] > 25 ? 0.05 : 0);
  if (up) return { side: 'BUY', score: s, slUnit: 1.3 * x.atr[L], note: 'MACD فوق الصفر مع تمدد الهيستوجرام' };
  if (dn) return { side: 'SELL', score: s, slUnit: 1.3 * x.atr[L], note: 'MACD تحت الصفر مع تمدد الهيستوجرام' };
  return null;
});

def('GENETIC_ELITE_CONSENSUS', 'Genetic Elite Consensus', 'إجماع النخبة الجينية', 'any', (x) => {
  const g = x.genetic;
  if (!g || g.total <= 0) return null;
  const lc = g.long / g.total, sc = g.short / g.total;
  const s = 0.50 + 0.42 * Math.max(lc, sc);
  if (lc >= 0.58 && lc > sc) return { side: 'BUY', score: s, slUnit: x.atr[L] * g.atrMult, note: `${(lc * 100).toFixed(0)}% من النخبة الجينية تشتري` };
  if (sc >= 0.58 && sc > lc) return { side: 'SELL', score: s, slUnit: x.atr[L] * g.atrMult, note: `${(sc * 100).toFixed(0)}% من النخبة الجينية تبيع` };
  return null;
});

def('BTC_LEADLAG_BETA', 'BTC Lead-Lag Beta', 'بيتكوين يقود — المتأخر يلحق', 'trend', (x) => {
  const env = x.env || {};
  const b1 = num(env.btcCh1h), bs = num(env.btcCh15m);
  const s1 = x.ch1h, ss = x.ch15m;
  if (Math.abs(b1) < 0.004) return null;
  const lag = b1 > 0 ? (s1 < b1 * 0.45 && ss > -0.002) : (s1 > b1 * 0.45 && ss < 0.002);
  if (!lag) return null;
  const s = 0.60 + Math.min(0.16, Math.abs(b1) * 8) + (Math.abs(bs) > 0.004 ? 0.05 : 0);
  return b1 > 0
    ? { side: 'BUY', score: s, slUnit: 1.35 * x.atr[L], note: `BTC +${(b1 * 100).toFixed(2)}% وهذه العملة متأخرة → التقاط بيتا` }
    : { side: 'SELL', score: s, slUnit: 1.35 * x.atr[L], note: `BTC ${(b1 * 100).toFixed(2)}% وهذه العملة متأخرة → التقاط بيتا` };
});

const STRATEGY_META = S.map((s) => ({ id: s.id, name: s.name, nameAr: s.nameAr, bias: s.bias }));

/* ------------------------------------------------------------------ genomes
   Each strategy carries mutable parameters -> infinite evolution.            */
const GENOME_BOUNDS = { biasShift: [0, 0.12], slMult: [0.85, 1.6], scoreMult: [0.9, 1.25], aggression: [0.8, 1.5] };
function spawnGenomes() {
  const g = {};
  S.forEach((s) => { g[s.id] = { biasShift: 0.03, slMult: 1.0, scoreMult: 1.0, aggression: 1.0 }; });
  return g;
}
function mutateGenomes(genomes, stats) {
  const out = Object.assign({}, genomes);
  Object.keys(out).forEach((id) => {
    const g = Object.assign({}, out[id]);
    const st = stats[id];
    const edge = st && st.n >= 4 ? clamp((st.avgR || 0) / 2, -0.5, 0.5) : 0;
    const jitter = () => (Math.random() - 0.5) * 0.08;
    g.slMult = clamp(g.slMult - edge * 0.06 + jitter(), GENOME_BOUNDS.slMult[0], GENOME_BOUNDS.slMult[1]);
    g.scoreMult = clamp(g.scoreMult + edge * 0.05 + jitter() * 0.5, GENOME_BOUNDS.scoreMult[0], GENOME_BOUNDS.scoreMult[1]);
    g.aggression = clamp(g.aggression + edge * 0.08 + jitter(), GENOME_BOUNDS.aggression[0], GENOME_BOUNDS.aggression[1]);
    g.biasShift = clamp(Math.abs(g.biasShift + jitter() * 0.2), GENOME_BOUNDS.biasShift[0], GENOME_BOUNDS.biasShift[1]);
    out[id] = g;
  });
  return out;
}

/* ------------------------------------------------------- genetic algorithm */
class GeneticCore {
  static spawn(id) {
    return {
      id, emaFast: 6 + Math.floor(Math.random() * 8), emaSlow: 21 + Math.floor(Math.random() * 24),
      rsiPeriod: 9 + Math.floor(Math.random() * 7), rsiLevel: 46 + Math.floor(Math.random() * 12),
      atrMult: +(1.1 + Math.random() * 0.6).toFixed(2), fitness: 0, winRate: 50
    };
  }
  static simulate(g, k) {
    const c = k.map((x) => x.close), h = k.map((x) => x.high), l = k.map((x) => x.low), o = k.map((x) => x.open);
    if (c.length < 60) return { fitness: 0.1, winRate: 50 };
    const ef = CoreMath.EMA(c, g.emaFast), es = CoreMath.EMA(c, g.emaSlow), rsi = CoreMath.RSI(c, g.rsiPeriod), atr = CoreMath.ATR(h, l, c, 14);
    let wins = 0, total = 0, sum = 0; const fr = 0.0008;
    for (let i = 40; i < c.length - 6; i++) {
      const long = ef[i] > es[i] && rsi[i] < 100 - g.rsiLevel, short = ef[i] < es[i] && rsi[i] > g.rsiLevel;
      if (!long && !short) continue;
      total++;
      const entry = o[i + 1] * (long ? 1 + fr : 1 - fr), sd = atr[i] * g.atrMult;
      const sl = long ? entry - sd : entry + sd, tp = long ? entry + sd * 5 : entry - sd * 5;
      let exit = c[i + 5];
      for (let j = i + 1; j <= Math.min(i + 5, c.length - 1); j++) {
        if (long) { if (l[j] <= sl) { exit = sl; break; } if (h[j] >= tp) { exit = tp; break; } }
        else { if (h[j] >= sl) { exit = sl; break; } if (l[j] <= tp) { exit = tp; break; } }
      }
      const r = (long ? (exit - entry) : (entry - exit)) / sd;
      sum += r; if (r > 0) wins++;
      i += 3;
    }
    if (total < 3) return { fitness: 0.1, winRate: 50 };
    const wr = (wins / total) * 100;
    return { fitness: clamp(wr * 0.6 + (sum / total) * 40, 0, 100), winRate: +wr.toFixed(1) };
  }
  static evolve(pool, benchmarks, cfg) {
    if (!pool || !pool.length) pool = Array.from({ length: cfg.genetics.population }, (_, i) => GeneticCore.spawn(i + 1));
    pool.forEach((g) => {
      let f = 0, w = 0;
      benchmarks.forEach((d) => { const r = GeneticCore.simulate(g, d); f += r.fitness; w += r.winRate; });
      g.fitness = f / benchmarks.length; g.winRate = w / benchmarks.length;
    });
    pool.sort((a, b) => b.fitness - a.fitness);
    const elites = pool.slice(0, cfg.genetics.elites);
    const next = elites.map((e) => Object.assign({}, e));
    let id = elites.length + 1;
    while (next.length < cfg.genetics.population) {
      const p1 = elites[Math.floor(Math.random() * elites.length)], p2 = elites[Math.floor(Math.random() * elites.length)];
      const pick = (a, b, j) => (Math.random() < 0.5 ? a : b) * (Math.random() < 0.18 ? 1 + j : 1);
      next.push({
        id: id++, emaFast: Math.max(4, Math.round(pick(p1.emaFast, p2.emaFast, 0.12))), emaSlow: Math.max(18, Math.round(pick(p1.emaSlow, p2.emaSlow, 0.1))),
        rsiPeriod: Math.max(6, Math.round(pick(p1.rsiPeriod, p2.rsiPeriod, 0.15))), rsiLevel: clamp(Math.round(pick(p1.rsiLevel, p2.rsiLevel, 0.06)), 40, 62),
        atrMult: +clamp(pick(p1.atrMult, p2.atrMult, 0.1), 0.8, 2.4).toFixed(2), fitness: 0, winRate: 50
      });
    }
    return { pool: next, elites, avgWR: +(elites.reduce((a, b) => a + b.winRate, 0) / elites.length).toFixed(1) };
  }
}

/* --------------------------------------------------------------- context */
function buildContext(k15, k1h, k4h, k1d, extras) {
  const c = k15.map((x) => x.close), h = k15.map((x) => x.high), l = k15.map((x) => x.low),
    o = k15.map((x) => x.open), v = k15.map((x) => x.volume), L = c.length - 1;
  const atr = CoreMath.ATR(h, l, c, 14), ema20 = CoreMath.EMA(c, 20), ema50 = CoreMath.EMA(c, 50),
    rsi = CoreMath.RSI(c, 14), adx = CoreMath.ADX(h, l, c, 14), sma20 = CoreMath.SMA(c, 20), std20 = CoreMath.STD(c, sma20, 20);
  const macdRaw = CoreMath.EMA(c, 12), macdSlow = CoreMath.EMA(c, 26);
  const mLine = new Float64Array(c.length); for (let i = 0; i < c.length; i++) mLine[i] = macdRaw[i] - macdSlow[i];
  const mSig = CoreMath.EMA(mLine, 9), hist = new Float64Array(c.length);
  for (let i = 0; i < c.length; i++) hist[i] = mLine[i] - mSig[i];
  const bbwArr = new Float64Array(c.length);
  for (let i = 0; i < c.length; i++) bbwArr[i] = 4 * std20[i] / (sma20[i] || 1);
  let vs = 0; for (let i = Math.max(0, L - 21); i <= L - 1; i++) vs += v[i];
  const volAvg = vs / 20 || 1;
  const st = CoreMath.supertrend(h, l, c, 10, 3);
  const fr = CoreMath.fractals(h, l, 2);
  let lastHigh = null, lastLow = null;
  for (let i = L - 1; i >= Math.max(2, L - 40); i--) {
    if (!lastHigh && fr.sh[i]) lastHigh = { price: h[i], i };
    if (!lastLow && fr.sl[i]) lastLow = { price: l[i], i };
    if (lastHigh && lastLow) break;
  }
  // session vwap (from UTC day start)
  const day = new Date(k15[L].time).toISOString().slice(0, 10);
  let di = L; for (let i = L; i >= 0; i--) { if (new Date(k15[i].time).toISOString().slice(0, 10) !== day) break; di = i; }
  let pv = 0, vv = 0; const vwap = new Float64Array(c.length);
  for (let i = di; i <= L; i++) { const tp = (h[i] + l[i] + c[i]) / 3; pv += tp * (v[i] || 1); vv += (v[i] || 1); vwap[i] = pv / (vv || 1); }

  const htfTrend = (k, fast, slow) => {
    if (!k || k.length < slow + 5) return 0;
    const cc = k.map((x) => x.close), ef = CoreMath.EMA(cc, fast), es = CoreMath.EMA(cc, slow), n = cc.length - 1;
    return ef[n] > es[n] && cc[n] > es[n] ? 1 : (ef[n] < es[n] && cc[n] < es[n] ? -1 : 0);
  };
  const adxOf = (k) => { if (!k || k.length < 30) return 0; const cc = k.map((x) => x.close); return CoreMath.ADX(k.map((x) => x.high), k.map((x) => x.low), cc, 14)[cc.length - 1]; };
  const chg = (k, n) => (k && k.length > n ? k[k.length - 1].close / k[k.length - 1 - n].close - 1 : 0);
  const atr1h = k1h && k1h.length > 20 ? CoreMath.ATR(k1h.map((x) => x.high), k1h.map((x) => x.low), k1h.map((x) => x.close), 14) : null;
  const atrHour = atr1h ? atr1h[atr1h.length - 1] : atr[L] * 4;
  let atrAvg = 0; for (let i = L - 20; i < L; i++) atrAvg += atr[i]; atrAvg /= 20;

  const d1c = (k1d || []).map((x) => x.close), d1n = d1c.length - 1;
  let annual = 'CONSOLIDATION';
  if (d1n > 60) {
    const e200 = CoreMath.EMA(d1c, Math.min(200, d1n)), e50 = CoreMath.EMA(d1c, 50);
    if (d1c[d1n] > e200[d1n] && e50[d1n] > e200[d1n]) annual = 'ANNUAL_BULLISH';
    else if (d1c[d1n] < e200[d1n] && e50[d1n] < e200[d1n]) annual = 'ANNUAL_BEARISH';
  }
  const body = Math.abs(c[L] - o[L]) / ((h[L] - l[L]) || 1e-9);
  const explosion = clamp(
    0.34 * clamp((atr[L] / (atrAvg || atr[L]) - 1) / 0.8, 0, 1) +
    0.30 * clamp((v[L] / volAvg - 1) / 1.6, 0, 1) +
    0.20 * clamp(body / 0.8, 0, 1) +
    0.16 * clamp(Math.abs(c[L] / c[L - 3] - 1) / (0.012 || 1), 0, 1), 0, 1);

  return {
    c, h, l, o, v, k: k15, L, atr, atrAvg, atrHour, ema20, ema50, rsi, adx, sma20, std20,
    bbw: bbwArr, bbwRank: CoreMath.pctRank(bbwArr, L, 100), volAvg, volR: v[L] / volAvg,
    macd: { macd: mLine, signal: mSig, hist }, st, swings: { lastHigh, lastLow }, vwap,
    price: c[L], ch15m: chg(k15, 1), ch1h: chg(k1h, 1) || chg(k15, 4), explosion,
    quoteVol24h: (k1h || []).slice(-24).reduce((s, x) => s + x.close * x.volume, 0),
    htf: {
      d1: htfTrend(k1d, 21, 55), h4: htfTrend(k4h, 21, 55), h1: htfTrend(k1h, 21, 55),
      adx4h: adxOf(k4h), adx1h: adxOf(k1h), annual,
      ch4h: chg(k4h, 1), ch1d: chg(k1d, 1)
    },
    genetic: extras.genetic, env: extras.env
  };
}

/** structural stop, always ordered: never tighter than noise, never wider than maxSlPct */
function clampStop(price, atrNow, unit, maxSlPct) {
  const hardMax = price * (maxSlPct / 100);
  const lo = Math.min(Math.max(atrNow * 0.7, price * 0.0012), hardMax);
  const hi = Math.max(lo, Math.min(atrNow * 1.7, hardMax));
  return clamp(unit, lo, hi);
}

/** dominant flow used to execute bad-direction candidates: 4H first, then 1D, then 1H */
function flowOf(htf) {
  const s = htf.h4 * 2 + htf.d1 * 1.4 + htf.h1 * 0.8;
  return s > 0.9 ? 1 : s < -0.9 ? -1 : 0;
}

/* ==================================================== BLOOD CHANNEL ARENA */
class Arena {
  constructor(cfg, genomes, stats) { this.cfg = cfg; this.genomes = genomes; this.stats = stats; }

  weightOf(id) {
    const st = this.stats[id];
    if (!st || st.n < 4) return 1;
    const pf = st.profitFactor === Infinity ? 3 : num(st.profitFactor, 1);
    const edge = clamp((st.winRate - 45) / 45, -0.6, 0.6) * 0.6 + clamp((st.avgR || 0) / 3, -0.4, 0.7) * 0.4 + clamp((pf - 1) / 2, -0.25, 0.35);
    return clamp(1 + edge, 0.55, 1.65);
  }

  /** stage 0 — execution squad. returns reason string or null when alive */
  veto(cand, ctx, level) {
    const A = this.cfg.arena;
    const relax = level > 0, desperate = level >= 2;
    const flow = flowOf(ctx.htf);
    const dir = cand.side === 'BUY' ? 1 : -1;
    // ---- direction is sacred, never relaxed ----
    if (flow !== 0 && dir !== flow && cand.bias !== 'reversal') return `أُعدمت: ضد تدفق السوق (4H/1D/1H = ${flow > 0 ? 'صاعد' : 'هابط'})`;
    if (cand.bias === 'trend') {
      if (ctx.htf.annual === 'ANNUAL_BEARISH' && dir > 0) return 'أُعدمت: شراء ضد الاتجاه السنوي الهابط';
      if (ctx.htf.annual === 'ANNUAL_BULLISH' && dir < 0) return 'أُعدمت: بيع ضد الاتجاه السنوي الصاعد';
      if (ctx.htf.h1 !== 0 && dir !== ctx.htf.h1) return 'أُعدمت: ضد اتجاه الساعة (1H)';
    }
    if (cand.bias === 'reversal') {
      if (ctx.htf.annual === 'ANNUAL_BULLISH' && dir < 0) return 'أُعدمت: عكس الاتجاه السنوي الصاعد';
      if (ctx.htf.annual === 'ANNUAL_BEARISH' && dir > 0) return 'أُعدمت: عكس الاتجاه السنوي الهابط';
      if (flow !== 0 && dir !== flow && ctx.explosion < 0.60) return 'أُعدمت: انعكاس ضعيف ضد التدفق';
    }
    if (!desperate && ctx.htf.adx4h < 12 && cand.bias === 'trend') return 'أُعدمت: لا يوجد اتجاه على 4H (ADX ضعيف)';
    if (ctx.quoteVol24h < A.minQuoteVol24h * (desperate ? 0.15 : relax ? 0.45 : 1)) return 'أُعدمت: سيولة 24h منخفضة';
    const slPct = (cand.slUnit / ctx.price) * 100;
    if (slPct < A.minSlPct * (relax ? 0.6 : 1)) return 'أُعدمت: الوقف أضيق من الضجيج';
    if (slPct > A.maxSlPct * (relax ? 1.5 : 1)) return 'أُعدمت: الوقف أوسع من المطلوب (بطيء)';
    const rPerHour = (ctx.atrHour * 0.62) / cand.slUnit;
    const hoursToTp2 = (cand.rr || 5) / Math.max(0.05, rPerHour);
    if (!desperate && hoursToTp2 > A.maxHoursToTp2 * (relax ? 1.6 : 1)) return `أُعدمت: بطيئة — ${hoursToTp2.toFixed(0)} ساعة للهدف`;
    if (!desperate && ctx.explosion < (relax ? 0.16 : 0.28) && cand.bias !== 'reversal') return 'أُعدمت: لا يوجد انفجار سعري/حجمي';
    return null;
  }

  run(candidates, relaxLevel, exclude) {
    const A = this.cfg.arena, T = this.cfg.targets;
    const blocked = exclude instanceof Set ? exclude : new Set();
    const report = { stages: [], survivors: [], executed: [] };
    // ---- stage 0: execution
    const alive = [];
    candidates.forEach((cd) => {
      const reason = this.veto(cd, cd.ctx, relaxLevel);
      if (reason) { report.executed.push({ strategy: cd.id, nameAr: cd.nameAr, symbol: cd.symbol, side: cd.side, reason }); return; }
      alive.push(cd);
    });
    report.stages.push({ name: 'الإعدام (الاتجاه/السيولة/السرعة)', in: candidates.length, out: alive.length });
    report.executedSample = report.executed.slice(0, 60);
    if (!alive.length) return report;

    // ---- stage 1: live performance weighting + genome
    alive.forEach((cd) => {
      const g = this.genomes[cd.id] || { slMult: 1, scoreMult: 1, aggression: 1 };
      cd.weight = this.weightOf(cd.id);
      cd.slUnit = cd.slUnit * g.slMult;
      cd.quality = clamp(cd.score * g.scoreMult * cd.weight, 0, 1);
    });

    // ---- stage 2: cluster by (symbol, side) -> compatibility bonus
    const clusters = new Map();
    alive.forEach((cd) => {
      const key = cd.symbol + '|' + cd.side;
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push(cd);
    });
    report.stages.push({ name: 'التوافق (تجميع المرشحين المتوافقين)', in: alive.length, out: clusters.size });

    const duels = [];
    clusters.forEach((arr, key) => {
      arr.sort((a, b) => b.quality - a.quality);
      const [symbol, side] = key.split('|');
      const ctx = arr[0].ctx;
      const families = new Set(arr.map((a) => a.family)).size;
      const agreement = clamp(0.055 * (arr.length - 1) + 0.035 * (families - 1), 0, 0.32);
      const best = arr[0];
      const explosion = ctx.explosion;
      const rPerHour = (ctx.atrHour * 0.62) / best.slUnit;
      const hoursToTp2 = (explosion > T.eliteExplosion ? T.rrElite : T.rr) / Math.max(0.05, rPerHour);
      const speed = clamp(1 - hoursToTp2 / 30, 0, 1);
      const flow = flowOf(ctx.htf);
      const dir = side === 'BUY' ? 1 : -1;
      const align = clamp(0.5 + (flow === dir ? 0.30 : flow === 0 ? 0.06 : -0.34) + (dir > 0 && ctx.htf.annual === 'ANNUAL_BULLISH' ? 0.16 : 0) + (dir < 0 && ctx.htf.annual === 'ANNUAL_BEARISH' ? 0.16 : 0), 0, 1);
      const rr = explosion > T.eliteExplosion ? T.rrElite : T.rr;
      const tp1R = explosion > T.eliteExplosion ? T.tp1RElite : T.tp1R;
      const confidence = clamp(
        0.42 * clamp((arr.reduce((s, a) => s + a.quality, 0) / Math.min(3, arr.length)) / 0.86, 0, 1) +
        0.20 * explosion + 0.16 * speed + 0.12 * align + 0.10 * clamp(agreement / 0.32, 0, 1), 0, 0.99);
      duels.push({
        symbol, side, ctx, rr, tp1R, confidence, agreement, explosion, speed, align, hoursToTp2,
        strategies: arr.map((a) => ({ id: a.id, nameAr: a.nameAr, quality: +a.quality.toFixed(3), weight: +a.weight.toFixed(2), note: a.note, bias: a.bias })),
        leader: { id: best.id, nameAr: best.nameAr, note: best.note },
        slUnit: best.slUnit
      });
    });

    // symbols already traded / cooling down cannot win — the next survivor takes the slot
    const free = duels.filter((d) => !blocked.has(d.symbol));
    if (free.length < duels.length) report.stages.push({ name: 'استبعاد العملات المفتوحة/المبرَّدة', in: duels.length, out: free.length });
    duels.length = 0; duels.push.apply(duels, free.length ? free : []);
    if (!duels.length) return report;

    // ---- stage 3: duels (top by confidence vs rest, opposition penalty)
    duels.sort((a, b) => b.confidence - a.confidence);
    const opp = duels.filter((d) => d.side !== duels[0].side);
    if (opp.length) duels[0].confidence = clamp(duels[0].confidence - Math.min(0.08, opp[0].confidence * 0.12), 0, 0.99);
    duels.sort((a, b) => b.confidence - a.confidence);
    report.stages.push({ name: 'القنال الدامي (مبارزة النهائيات)', in: duels.length, out: duels.length });

    // ---- stage 4: final gate
    const winner = duels[0];
    const passed = winner.confidence >= Math.max(0.52, A.minConfidence - relaxLevel * 0.05);
    report.stages.push({ name: 'البوابة النهائية (minConfidence)', in: duels.length, out: passed ? 1 : 0 });
    report.survivors = duels.slice(0, 6).map((d) => ({
      symbol: d.symbol, side: d.side, confidence: +d.confidence.toFixed(3), rr: d.rr,
      explosion: +d.explosion.toFixed(3), hoursToTp2: +d.hoursToTp2.toFixed(1),
      strategies: d.strategies.slice(0, 6), leader: d.leader
    }));
    report.winner = passed ? winner : (relaxLevel >= A.maxRelaxRounds - 1 ? winner : null);
    report.relax = relaxLevel;
    return report;
  }
}

/* ----------------------------------------------------------------- engine */
function defaultState(cfg) {
  return {
    generation: 1, balance: cfg.risk.startBalance, equity: cfg.risk.startBalance,
    trades: [], stats: {}, genomes: spawnGenomes(), pool: [],
    nextSignalAt: 0, lastSignalAt: 0, dayKey: '', dayEquity: 0, signalsToday: 0,
    cooldowns: {}, lastArena: null, booted: false
  };
}

function createEngine(options) {
  const opts = options || {};
  const cfg = mergeConfig(DEFAULT_CONFIG, opts.config || {});
  const log = opts.onEvent || (() => {});
  const notify = opts.notify || (async () => {});
  const hooks = {
    load: opts.loadState || (async () => null),
    save: opts.saveState || (async () => {}),
    onSignal: opts.onSignal || (async () => {}),
    onTrade: opts.onTrade || (async () => {})
  };
  const feed = opts.feed || new DataFeed(cfg, log);
  let state = defaultState(cfg);
  let running = false, scanning = false, tickBusy = false, timer = null, bootTimer = null;
  let lastCycleAt = 0, lastError = '', cycles = 0, dataSource = 'binance';

  const save = async () => { state.dataSource = feed.source; try { await hooks.save(clone(state)); } catch (e) { log('error', 'فشل حفظ الحالة: ' + e.message); } };

  function openTrades() { return state.trades.filter((t) => t.status === 'OPEN' || t.status === 'TP1'); }

  async function load() {
    const s = await hooks.load();
    if (s && typeof s === 'object') {
      state = Object.assign(defaultState(cfg), s);
      if (!state.genomes || !Object.keys(state.genomes).length) state.genomes = spawnGenomes();
      state.trades = (state.trades || []).map((t) => Object.assign(t, { busy: false }));
      if (state.dataSource === 'synthetic') feed.source = 'synthetic';
    }
    dataSource = feed.source;
  }

  /* ---------------------------------------------- market scan for one symbol */
  async function scanSymbol(symbol, elites, env) {
    const [k15, k1h, k4h, k1d] = await Promise.all([
      feed.klines(symbol, cfg.tfs.exec, 180), feed.klines(symbol, cfg.tfs.trend, 120),
      feed.klines(symbol, cfg.tfs.structure, 140), feed.klines(symbol, cfg.tfs.macro, 365)
    ]);
    if (!k15 || k15.length < 80) return null;
    const closes = k15.map((x) => x.close);
    // genetic elite consensus
    let lw = 0, sw = 0, tw = 0, am = 0;
    elites.forEach((g) => {
      const w = Math.max(0.5, g.fitness); tw += w; am += g.atrMult;
      const ef = CoreMath.EMA(closes, g.emaFast), es = CoreMath.EMA(closes, g.emaSlow), rsi = CoreMath.RSI(closes, g.rsiPeriod);
      const n = closes.length - 1;
      if (ef[n] > es[n] && rsi[n] < 100 - g.rsiLevel) lw += w; else if (ef[n] < es[n] && rsi[n] > g.rsiLevel) sw += w;
    });
    const ctx = buildContext(k15, k1h, k4h, k1d, {
      genetic: { long: lw / (tw || 1), short: sw / (tw || 1), total: tw, atrMult: am / (elites.length || 1) },
      env
    });
    const out = [];
    S.forEach((s) => {
      let r = null;
      try { r = s.run(ctx); } catch (e) { r = null; }
      if (!r) return;
      const slUnit = clampStop(ctx.price, ctx.atr[ctx.L] || ctx.price * 0.004, r.slUnit, cfg.arena.maxSlPct);
      out.push({
        id: s.id, nameAr: s.nameAr, name: s.name, bias: s.bias, family: s.bias,
        symbol, side: r.side, score: clamp(r.score, 0.3, 0.98), slUnit,
        note: r.note || '', ctx
      });
    });
    return { symbol, ctx, candidates: out };
  }

  /* ------------------------------------------------------------- full cycle */
  async function runCycle(reason) {
    if (scanning) return { skipped: 'scanning' };
    scanning = true;
    const startedAt = Date.now();
    try {
      cycles++;
      if (feed.source === 'synthetic') await feed.probe();
      log('info', `بدء دورة المسح (${reason}) — ${cfg.watchlist.length} عملة × ${S.length} استراتيجية`);

      // daily drawdown guard: signals keep flowing to Telegram-only? no — no new risk today
      const dayKey = new Date().toISOString().slice(0, 10);
      if (state.dayKey !== dayKey) { state.dayKey = dayKey; state.signalsToday = 0; state.dayEquity = state.equity; }
      if (cfg.risk.maxDailyLossPct > 0 && state.dayEquity > 0 &&
          state.equity <= state.dayEquity * (1 - cfg.risk.maxDailyLossPct / 100)) {
        lastError = 'حد الخسارة اليومي';
        log('warn', `⛔ حد الخسارة اليومي (${cfg.risk.maxDailyLossPct}%) تحقق — لا مخاطر جديدة اليوم، والصفقات المفتوحة تحت الحماية.`);
        scheduleNext();
        await save();
        return { signal: null, report: null };
      }

      // 1) genetic evolution on benchmarks
      const benchmarks = [];
      for (const b of cfg.genetics.benchmarks) {
        const d = await feed.klines(b, cfg.tfs.exec, 300, 5 * 60e3);
        if (d && d.length > 120) benchmarks.push(d);
      }
      if (benchmarks.length) {
        const ev = GeneticCore.evolve(state.pool, benchmarks, cfg);
        state.pool = ev.pool; state.generation++;
        log('info', `🧬 تطور الجيل ${state.generation} — معدل فوز النخبة ${ev.avgWR}%`);
      }
      const elites = (state.pool || []).slice(0, cfg.genetics.elites);
      const avgWR = elites.length ? +(elites.reduce((a, b) => a + b.winRate, 0) / elites.length).toFixed(1) : 50;

      // 2) BTC leadership context
      const btc = await feed.klines('BTCUSDT', cfg.tfs.trend, 24);
      const btc15 = await feed.klines('BTCUSDT', cfg.tfs.exec, 8);
      const env = {
        btcCh1h: btc && btc.length > 2 ? btc[btc.length - 1].close / btc[btc.length - 2].close - 1 : 0,
        btcCh15m: btc15 && btc15.length > 2 ? btc15[btc15.length - 1].close / btc15[btc15.length - 2].close - 1 : 0
      };

      // 3) scan everything
      const scanned = await mapLimit(cfg.watchlist, cfg.cadence.scanConcurrency, (sym) => scanSymbol(sym, elites, env));
      dataSource = feed.source;
      const all = [];
      scanned.forEach((r) => { if (r && r.candidates.length) all.push.apply(all, r.candidates); });
      log('info', `تم توليد ${all.length} مرشحاً خاماً من ${scanned.filter(Boolean).length} عملة`);

      // 4) BLOOD CHANNEL — relaxation ladder, direction rules never relaxed
      const arena = new Arena(cfg, state.genomes, state.stats);
      const now0 = Date.now();
      const blocked = new Set(
        openTrades().map((t) => t.symbol).concat(Object.keys(state.cooldowns).filter((k) => state.cooldowns[k] > now0))
      );
      let report = null;
      for (let relax = 0; relax < cfg.arena.maxRelaxRounds; relax++) {
        report = arena.run(all, relax, blocked);
        if (report.winner) break;
        log('warn', `القنال الدامي: لا ناجٍ بالمستوى ${relax} — تخفيف القيود (الاتجاه يبقى مقدساً)`);
      }
      state.lastArena = {
        at: Date.now(), reason, input: all.length, executed: report.executed.length,
        stages: report.stages, survivors: report.survivors, executedSample: report.executedSample, avgWR, generation: state.generation
      };

      if (!report.winner) {
        lastError = 'لا ناجٍ في القنال الدامي';
        await save();
        log('warn', 'لم ينجُ أي مرشح — لا صفقة هذه الساعة (نادر).');
        return { signal: null, report };
      }

      const w = report.winner;
      if (Date.now() - state.lastSignalAt < cfg.arena.minGapMin * 60e3 && reason !== 'BOOT' && reason !== 'MANUAL') {
        log('info', 'الفاصل الزمني بين صفقتين لم يكتمل');
        return { signal: null, report };
      }
      if (openTrades().length >= cfg.risk.maxOpenTrades) {
        log('info', `بلغنا حد الصفقات المفتوحة (${cfg.risk.maxOpenTrades})`);
        return { signal: null, report };
      }

      const signal = buildSignal(w, avgWR, reason);
      if (!signal) { await save(); return { signal: null, report }; }
      await publish(signal, report);
      lastCycleAt = Date.now();
      return { signal, report };
    } catch (e) {
      lastError = e.message;
      log('error', 'خطأ في دورة المسح: ' + e.message);
      return { signal: null, error: e.message };
    } finally {
      scanning = false;
      await save();
    }
  }

  function buildSignal(w, avgWR, reason) {
    const ctx = w.ctx;
    const price = ctx.price;
    // structural stop, clamped to ATR so 5R arrives fast
    const slUnit = clampStop(price, ctx.atr[ctx.L] || price * 0.004, w.slUnit, cfg.arena.maxSlPct);
    const dir = w.side === 'BUY' ? 1 : -1;
    const sl = price - dir * slUnit;
    const tp1 = price + dir * slUnit * w.tp1R;
    const tp2 = price + dir * slUnit * w.rr;
    const riskUSD = state.equity * (cfg.risk.riskPerTradePct / 100);
    const qty = riskUSD / slUnit;
    const halfQty = qty * cfg.targets.tp1Share;
    return {
      id: `${w.symbol}-${Date.now()}`,
      symbol: w.symbol, side: w.side, price, sl, tp1, tp2,
      rr: w.rr, tp1R: w.tp1R, slUnit, slPct: (slUnit / price) * 100,
      confidence: +w.confidence.toFixed(3), explosion: +w.explosion.toFixed(3),
      speed: +w.speed.toFixed(3), align: +w.align.toFixed(3), hoursToTp2: +w.hoursToTp2.toFixed(1),
      qty, halfQty, secondQty: qty - halfQty, riskUSD, notional: qty * price,
      annualTrend: ctx.htf.annual, h4: ctx.htf.h4, h1: ctx.htf.h1, d1: ctx.htf.d1,
      flow: flowOf(ctx.htf), avgWR, generation: state.generation, reason,
      strategies: w.strategies, leader: w.leader, agreement: +w.agreement.toFixed(3),
      grade: w.confidence >= 0.80 ? 'ELITE' : w.confidence >= 0.70 ? 'STRONG' : w.confidence >= 0.60 ? 'STANDARD' : 'FORCED',
      dataSource: feed.source, createdAt: Date.now()
    };
  }

  async function publish(sig, report) {
    const trade = {
      id: sig.id, symbol: sig.symbol, side: sig.side, entry: sig.price, qty: sig.qty,
      halfQty: sig.halfQty, secondQty: sig.secondQty, sl: sig.sl, tp1: sig.tp1, tp2: sig.tp2,
      rr: sig.rr, tp1R: sig.tp1R, origSl: sig.sl, status: 'OPEN', openedAt: Date.now(), tp1Triggered: false, beDone: false,
      realized: 0, rMultiple: 0, fams: sig.strategies.map((s) => s.id).join('+'),
      confidence: sig.confidence, note: sig.leader.note
    };
    if (cfg.live.enabled) await placeLiveOrders(trade);
    state.trades.push(trade);
    if (state.trades.length > 400) state.trades = state.trades.slice(-400);
    state.lastSignalAt = Date.now();
    const d = new Date().toISOString().slice(0, 10);
    if (state.dayKey !== d) { state.dayKey = d; state.signalsToday = 0; state.dayEquity = state.equity; }
    state.signalsToday++;
    state.lastArena = state.lastArena || {};
    state.lastArena.lastSignal = sig;
    state.lastSignal = sig;   // survives restarts & later arena rounds

    sig.strategies.forEach((s) => {
      const st = state.stats[s.id] = state.stats[s.id] || { n: 0, wins: 0, losses: 0, be: 0, sumR: 0, grossWin: 0, grossLoss: 0, winRate: 50, avgR: 0, profitFactor: 1, weight: 1 };
      st.pending = (st.pending || 0) + 1;
    });

    await hooks.onSignal(sig, trade);
    await notify(telegramSignalMessage(sig));
    log('success', `🎯 صفقة الساعة: ${sig.symbol} ${sig.side} @ ${fmt(sig.price)} | ثقة ${(sig.confidence * 100).toFixed(1)}% | RR 1:${sig.rr} | ${sig.strategies.length} استراتيجية متوافقة`);
    // evolve genomes from realized performance
    state.genomes = mutateGenomes(state.genomes, state.stats);
    scheduleNext();
    await save();
    return trade;
  }

  function scheduleNext() {
    const now = Date.now();
    if (cfg.cadence.alignToClockHour) {
      const d = new Date(now);
      d.setUTCMinutes(0, 0, 0);
      state.nextSignalAt = d.getTime() + cfg.cadence.intervalMs;
      if (state.nextSignalAt - now < 3 * 60e3) state.nextSignalAt += cfg.cadence.intervalMs; // avoid double-fire right at the boundary
    } else state.nextSignalAt = now + cfg.cadence.intervalMs;
  }

  /* ------------------------------------------------------ live order plumbing */
  async function placeLiveOrders(t) {
    if (!cfg.live.apiKey || !cfg.live.apiSecret) return;
    const qty = t.qty.toFixed(6);
    const o = await feed.signed('POST', '/fapi/v1/order', { symbol: t.symbol, side: t.side, type: 'MARKET', quantity: qty });
    if (!o.ok) { log('error', `أمر الدخول رُفض: ${JSON.stringify(o.data || o.err || o.status)}`); return; }
    const px = num(o.data.avgPrice) || num(o.data.price) || t.entry;
    t.entry = px;
    const closeSide = t.side === 'BUY' ? 'SELL' : 'BUY';
    await feed.signed('POST', '/fapi/v1/order', { symbol: t.symbol, side: closeSide, type: 'STOP_MARKET', stopPrice: t.sl.toFixed(6), closePosition: 'true', workingType: 'MARK_PRICE' });
    log('info', `تم تنفيذ أمر حقيقي على ${t.symbol} @ ${px}`);
  }

  /* --------------------------------------------------------- position guard */
  async function manageTrade(t) {
    if (t.busy) return;
    t.busy = true;
    try {
      const price = await feed.price(t.symbol);
      if (!price) return;
      t.price = price;
      const long = t.side === 'BUY';
      const hitTp1 = long ? price >= t.tp1 : price <= t.tp1;
      const hitTp2 = long ? price >= t.tp2 : price <= t.tp2;
      const hitSl = long ? price <= t.sl : price >= t.sl;
      if (!t.tp1Triggered && hitTp1) {
        t.tp1Triggered = true; t.status = 'TP1';
        const rMultiple = Math.abs((long ? t.tp1 - t.entry : t.entry - t.tp1) / Math.abs(t.entry - t.origSl));
        const pnl = (long ? t.tp1 - t.entry : t.entry - t.tp1) * t.halfQty - t.halfQty * t.entry * cfg.risk.feeRate;
        t.realized += pnl; state.balance += pnl; state.equity = state.balance + unrealized();
        t.sl = long ? t.entry * 1.0008 : t.entry * 0.9992; t.beDone = true;
        log('success', `🎯 TP1 على ${t.symbol}: جني 50% (+${rMultiple.toFixed(2)}R) ونقل الوقف إلى التعادل`);
        await notify(`🎯 *الهدف الأول تحقق — ${t.symbol}*\n💰 جني أرباح 50% عند \`${fmt(t.tp1)}\` (+${rMultiple.toFixed(2)}R)\n🛡 باقي المركز محمي عند سعر الدخول \`${fmt(t.sl)}\`\n🎯 الهدف الثاني: \`${fmt(t.tp2)}\` (1:${t.rr})`);
        await hooks.onTrade({ type: 'TP1', trade: t });
      } else if (t.tp1Triggered && hitTp2) {
        await closeTrade(t, 'TP2', price);
      } else if (hitSl) {
        await closeTrade(t, t.tp1Triggered ? 'BE' : 'SL', price);
      } else {
        const upl = (long ? price - t.entry : t.entry - price) * (t.tp1Triggered ? t.secondQty : t.qty);
        t.upnl = upl;
      }
      await save();
    } finally { t.busy = false; }
  }

  function unrealized() { return openTrades().reduce((s, t) => s + (t.upnl || 0), 0); }

  async function closeTrade(t, kind, price) {
    const long = t.side === 'BUY';
    const remQty = t.tp1Triggered ? t.secondQty : t.qty;
    const slDist = Math.abs(t.entry - (t.origSl || t.sl)) || 1e-9;
    const rSigned = (long ? price - t.entry : t.entry - price) / slDist;
    const pnl = (long ? price - t.entry : t.entry - price) * remQty - remQty * price * cfg.risk.feeRate;
    t.realized += pnl; t.status = kind; t.closedAt = Date.now(); t.closePrice = price;
    t.rMultiple = +(t.tp1Triggered ? (t.tp1R + rSigned) / 2 : rSigned).toFixed(2);
    state.balance += pnl; state.equity = state.balance + unrealized();
    if (kind === 'SL') state.cooldowns[t.symbol] = Date.now() + cfg.arena.cooldownAfterSlMin * 60e3;
    // strategy learning
    t.fams.split('+').forEach((id) => {
      const st = state.stats[id];
      if (!st) return;
      st.n++; st.pending = Math.max(0, (st.pending || 1) - 1);
      st.sumR += t.rMultiple;
      if (t.rMultiple > 0.05) { st.wins++; st.grossWin += t.rMultiple; }
      else if (t.rMultiple < -0.05) { st.losses++; st.grossLoss += -t.rMultiple; }
      else st.be++;
      st.winRate = +((st.wins / st.n) * 100).toFixed(1);
      st.avgR = +(st.sumR / st.n).toFixed(3);
      st.profitFactor = st.grossLoss > 0 ? +(st.grossWin / st.grossLoss).toFixed(2) : (st.grossWin > 0 ? 99 : 1);
      st.weight = +new Arena(cfg, state.genomes, state.stats).weightOf(id).toFixed(3);
    });
    const icons = { TP2: '🏆', BE: '🛡', SL: '🛑' };
    const titles = { TP2: 'الهدف الثاني تحقق — الصفقة كاملة', BE: 'خروج آمن على سعر الدخول', SL: 'ضرب وقف الخسارة' };
    log(kind === 'TP2' ? 'success' : 'warn', `${icons[kind]} ${t.symbol} ${kind}: ${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple}R | ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
    await notify(`${icons[kind]} *${titles[kind]}*\n💎 ${t.symbol} (${t.side === 'BUY' ? 'شراء' : 'بيع'})\n💵 الإغلاق: \`${fmt(price)}\`\n📊 النتيجة: \`${t.rMultiple >= 0 ? '+' : ''}${t.rMultiple}R\` = \`${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT\`\n🧠 الاستراتيجيات: ${t.fams.split('+').length} — تم تحديث أوزانها`);
    await hooks.onTrade({ type: kind, trade: t, pnl });
    await save();
  }

  async function tick() {
    if (tickBusy) return;
    tickBusy = true;
    try {
      const prices = await feed.prices(openTrades().map((t) => t.symbol));
      for (const t of openTrades()) { if (prices.has(t.symbol)) t.price = prices.get(t.symbol); await manageTrade(t); }
      state.equity = state.balance + unrealized();
      // hourly mandate: keep retrying inside the hour until a trade is published,
      // but never hammer the exchange — 3 minute backoff after a blocked attempt.
      if (running && Date.now() >= state.nextSignalAt && !scanning && Date.now() >= (state.retryAt || 0)) {
        log('info', '⏰ حانت ساعة الصفقة الإجبارية');
        const res = await runCycle('HOURLY');
        if (!res || !res.signal) state.retryAt = Date.now() + 3 * 60e3;
      }
      await save();
    } catch (e) { log('error', 'خطأ الحارس: ' + e.message); }
    finally { tickBusy = false; }
  }

  /* ------------------------------------------------------------ formatting */
  function fmt(p) { return Number(p) >= 1000 ? Number(p).toFixed(2) : Number(p).toPrecision(6); }
  function telegramSignalMessage(s) {
    const head = s.side === 'BUY' ? '🟢 *صفقة الساعة — شراء (FRACTAL LONG)* 🟢' : '🔴 *صفقة الساعة — بيع (FRACTAL SHORT)* 🔴';
    const names = s.strategies.slice(0, 8).map((x) => `• ${x.nameAr} (${(x.quality * 100).toFixed(0)}%)`).join('\n');
    return `${head}
---------------------------------------
💎 *العملة:* \`${s.symbol}\`
🧠 *ثقة القنال الدامي:* \`${(s.confidence * 100).toFixed(1)}%\`
🔥 *قوة الانفجار:* \`${(s.explosion * 100).toFixed(0)}%\`  |  ⚡ *السرعة:* \`${(s.speed * 100).toFixed(0)}%\`
🌊 *الاتجاه:* 1D \`${s.annualTrend}\` | 4H \`${s.h4 > 0 ? 'صاعد' : s.h4 < 0 ? 'هابط' : 'محايد'}\` | 1H \`${s.h1 > 0 ? 'صاعد' : s.h1 < 0 ? 'هابط' : 'محايد'}\`
🧬 *جيل النخبة:* ${s.generation} | *معدل الفوز:* ${s.avgWR}%
🤝 *${s.strategies.length} استراتيجية متوافقة* (القائد: ${s.leader.nameAr})
${names}
---------------------------------------
💵 *الدخول:* \`${fmt(s.price)}\`
🛑 *الوقف:* \`${fmt(s.sl)}\`  (-${s.slPct.toFixed(2)}%)
🎯 *الهدف 1 (خروج 50%):* \`${fmt(s.tp1)}\`  (1:${s.tp1R})
🎯 *الهدف 2 (الباقي):* \`${fmt(s.tp2)}\`  (*1:${s.rr}*)
⏱ *الزمن المتوقع للهدف:* ~${s.hoursToTp2} ساعة
---------------------------------------
_${s.reason === 'BOOT' ? 'صفقة الإطلاق الفورية' : 'صفقة الساعة الإجبارية'} — APEX FRACTAL v10_`;
  }

  /* --------------------------------------------------------------- lifecycle */
  async function start(opts2) {
    if (running) return status();
    await load();
    running = true;
    state.running = true;
    if (!state.bootedAt) state.bootedAt = Date.now();
    const boot = !cfg.cadence.bootSignal ? false : !(opts2 && opts2.skipBoot);
    if (!state.nextSignalAt) scheduleNext();
    log('success', `▶ المحرك يعمل — صفقة كل ساعة + صفقة فورية عند الإطلاق | RR 1:${cfg.targets.rr}/1:${cfg.targets.rrElite} | ${S.length} استراتيجية`);
    await notify(`🏛 *APEX FRACTAL v10 — القنال الدامي*\n⚙️ صفقة واحدة كل ساعة + صفقة فورية الآن\n🎯 RR = 1:${cfg.targets.rr} (و 1:${cfg.targets.rrElite} للانفجارات النخبوية)\n🧠 ${S.length} استراتيجية تتقاتل — الاتجاه مقدس — صيد الانفجارات فقط\n💼 الرصيد: ${state.equity.toFixed(2)} USDT`);
    await save();
    if (boot) {
      bootTimer = setTimeout(() => { runCycle('BOOT').catch((e) => log('error', e.message)); }, 1500);
    }
    timer = setInterval(() => { tick().catch((e) => log('error', e.message)); }, cfg.cadence.tickMs);
    return status();
  }

  async function stop() {
    const wasRunning = running;
    running = false; state.running = false;
    if (timer) clearInterval(timer); timer = null;
    if (bootTimer) clearTimeout(bootTimer); bootTimer = null;
    if (wasRunning) await save(); // never overwrite persisted memory with a fresh default state
    log('warn', '⏹ تم إيقاف المحرك');
    return status();
  }

  function status() {
    const open = openTrades();
    return {
      version: VERSION, running, scanning, cycles, dataSource, lastError,
      lastCycleAt, startedAt: state.bootedAt || null,
      nextSignalAt: state.nextSignalAt, lastSignalAt: state.lastSignalAt,
      generation: state.generation, balance: +state.balance.toFixed(2), equity: +state.equity.toFixed(2),
      unrealized: +unrealized().toFixed(2),
      signalsToday: state.signalsToday, dayKey: state.dayKey,
      openTrades: open.map((t) => ({
        id: t.id, symbol: t.symbol, side: t.side, entry: t.entry, price: t.price || t.entry,
        sl: t.sl, tp1: t.tp1, tp2: t.tp2, rr: t.rr, status: t.status, openedAt: t.openedAt,
        upnl: +(t.upnl || 0).toFixed(2), realized: +(t.realized || 0).toFixed(2),
        origSl: t.origSl || t.sl,
        rNow: +(((t.side === 'BUY' ? (t.price || t.entry) - t.entry : t.entry - (t.price || t.entry)) / (Math.abs(t.entry - (t.origSl || t.sl)) || 1e-12)) || 0).toFixed(2),
        confidence: t.confidence, fams: t.fams
      })),
      closed: state.trades.filter((t) => !['OPEN', 'TP1'].includes(t.status)).slice(-40).reverse().map((t) => ({
        id: t.id, symbol: t.symbol, side: t.side, entry: t.entry, closePrice: t.closePrice,
        rr: t.rr, status: t.status, rMultiple: t.rMultiple, realized: +t.realized.toFixed(2),
        closedAt: t.closedAt, confidence: t.confidence, fams: t.fams
      })),
      strategyStats: S.map((s) => {
        const st = state.stats[s.id] || { n: 0, wins: 0, losses: 0, be: 0, winRate: 0, avgR: 0, profitFactor: 1 };
        return {
          id: s.id, name: s.name, nameAr: s.nameAr, bias: s.bias, n: st.n, wins: st.wins, losses: st.losses, be: st.be || 0,
          winRate: st.winRate || 0, avgR: st.avgR || 0, profitFactor: st.profitFactor || 1,
          weight: +(new Arena(cfg, state.genomes, state.stats).weightOf(s.id)).toFixed(3),
          genome: state.genomes[s.id] || null, pending: st.pending || 0
        };
      }),
      lastArena: state.lastArena || null,
      lastSignal: state.lastSignal || null,
      config: { risk: cfg.risk, targets: cfg.targets, cadence: cfg.cadence, arena: cfg.arena, watchlist: cfg.watchlist }
    };
  }

  return {
    VERSION, config: cfg, feed, start, stop, status, runCycle, tick,
    get state() { return state; }, setState(s) { state = Object.assign(defaultState(cfg), s || {}); },
    strategies: STRATEGY_META
  };
}

/* ------------------------------------------------------------ standalone run */
function loadEnvFile(dir) {
  try {
    const f = path.join(dir, '.env');
    if (fs.existsSync(f)) fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* ignore */ }
}

function fileStorage(dir) {
  const f = path.join(dir, 'apex_state_v10.json');
  return {
    load: async () => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch (e) { return null; } },
    save: async (s) => { try { fs.writeFileSync(f + '.tmp', JSON.stringify(s, null, 2)); fs.renameSync(f + '.tmp', f); } catch (e) { /* ignore */ } }
  };
}

async function telegramNotify(text) {
  const token = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  const body = JSON.stringify({ chat_id: chat, text: String(text).slice(0, 4000), parse_mode: 'Markdown', disable_web_page_preview: true });
  await new Promise((resolve) => {
    const req = https.request(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 10000
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve); req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(body); req.end();
  });
}

function standaloneMain() {
  const dir = __dirname;
  loadEnvFile(dir);
  const storage = fileStorage(dir);
  console.log('=== APEX FRACTAL v10 — BLOOD CHANNEL ENGINE ===');
  const live = String(process.env.LIVE_TRADING || 'false').toLowerCase() === 'true';
  const engine = createEngine({
    config: {
      live: { enabled: live, apiKey: process.env.BINANCE_API_KEY || '', apiSecret: process.env.BINANCE_API_SECRET || '' },
      risk: { riskPerTradePct: num(process.env.RISK_PER_TRADE_PCT, 1), startBalance: num(process.env.START_BALANCE, 1000) }
    },
    onEvent: (lvl, msg) => console.log(`[${new Date().toLocaleTimeString()}] (${lvl}) ${msg}`),
    notify: telegramNotify,
    loadState: storage.load, saveState: storage.save,
    onSignal: async () => {}, onTrade: async () => {}
  });
  ['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, async () => { await engine.stop(); process.exit(0); }));
  engine.start({}).then(() => console.log('Engine started. One elite trade per hour.'));
  return engine;
}

const isStandalone = (function () {
  try { return typeof require !== 'undefined' && !process.env.NEXT_RUNTIME && require.main === module; } catch (e) { return false; }
})();
if (isStandalone) standaloneMain();

module.exports = {
  VERSION, DEFAULT_CONFIG, mergeConfig, CoreMath, DataFeed, Arena, GeneticCore, clampStop,
  STRATEGIES: S, STRATEGY_META, buildContext, flowOf, createEngine, syntheticKlines,
  standaloneMain, telegramNotify, fileStorage, loadEnvFile
};
