"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArenaPanel,
  Bar,
  Card,
  Chip,
  CountdownRing,
  HistoryTable,
  LogStream,
  PositionsTable,
  RunGuide,
  SignalCard,
  Stat,
  StrategyGrid,
  clock,
  pct,
} from "./panels";
import type { SignalDto, StatusResponse } from "./types";

const RULES = [
  { t: "صفقة واحدة كل ساعة", d: "مؤقت إجباري + صفقة فورية بعد التشغيل مباشرة." },
  { t: "RR = 1:5 / 1:6", d: "الهدف الأول 50% عند 2.5R ثم وقف على الدخول والباقي حتى 5R." },
  { t: "الاتجاه مقدّس", d: "أي مرشح ضد 1D/4H/1H يُعدم في المرحلة صفر ولا يُستثنى أبداً." },
  { t: "صيد الانفجارات", d: "تمدد ATR + انفجار حجم + شموع إزاحة = 40% من الدرجة النهائية." },
  { t: "أهداف سريعة", d: "المرشح البطيء (ساعات طويلة حتى 5R) يُعدم قبل النشر." },
  { t: "20 استراتيجية تتقاتل", d: "القنال الدامي: إعدام ← توافق ← مبارزة ← بوابة نهائية ← ناجٍ واحد." },
  { t: "تطور لا نهائي", d: "جينوم كل استراتيجية يُطفَّر بعد كل صفقة حسب R الحقيقي." },
];

export default function Dashboard() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  const [, force] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      const j = (await r.json()) as StatusResponse;
      setData(j);
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    timer.current = setInterval(load, 4000);
    const tick = setInterval(() => force((x) => x + 1), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      clearInterval(tick);
    };
  }, [load]);

  const act = async (action: string) => {
    setBusy(action);
    try {
      await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setBusy("");
    }
  };

  const st = data?.status;
  const agg = data?.aggregates;
  const lastSignal: SignalDto | null = useMemo(() => {
    return st?.lastSignal ?? (st?.lastArena?.lastSignal as SignalDto | undefined) ?? null;
  }, [st]);
  const winnerIds = lastSignal?.strategies.map((s) => s.id) ?? [];
  const round = data?.lastRounds?.[0] ?? null;

  return (
    <main className="mx-auto w-full max-w-[1500px] px-3 pb-16 pt-4 sm:px-5">
      {/* ---------------------------------------------------------- command bar */}
      <header className="panel relative overflow-hidden p-4">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-emerald-300/60 to-transparent" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 text-xl">🏛</div>
            <div>
              <h1 className="text-[19px] font-black leading-tight text-slate-50">
                APEX FRACTAL <span className="num text-emerald-300">v10</span>
              </h1>
              <p className="text-[11px] text-slate-400">القنال الدامي · 20 استراتيجية · صفقة نخبوية كل ساعة · RR 1:5 / 1:6</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-black/25 px-2.5 py-1.5">
              <span className={`h-2 w-2 rounded-full ${st?.running ? "pulse-dot bg-emerald-300" : "bg-slate-600"}`} />
              <span className="text-[11.5px] font-bold text-slate-200">
                {st?.scanning ? "جارٍ المسح…" : st?.running ? "المحرك يعمل" : "المحرك متوقف"}
              </span>
            </div>
            <Chip tone={st?.dataSource === "binance" ? "acid" : "gold"}>
              {st?.dataSource === "binance" ? "Binance Futures مباشر" : "مولّد السوق البديل (Binance محجوب هنا)"}
            </Chip>
            <Chip tone="gold">الجيل {st?.generation ?? 1}</Chip>
            <div className="rounded-lg border border-white/8 bg-black/25 px-2.5 py-1.5 text-[11.5px]">
              <span className="text-slate-400">رصيد المحاكاة </span>
              <span className="num font-black text-slate-50">{(st?.equity ?? 0).toFixed(2)}$</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-white/8 pt-4">
          <CountdownRing nextSignalAt={st?.nextSignalAt ?? 0} cadenceMs={st?.config.cadence.intervalMs ?? 3600000} running={Boolean(st?.running)} />
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={() => act(st?.running ? "stop" : "start")} busy={busy === "start" || busy === "stop"} tone={st?.running ? "danger" : "primary"}>
              {st?.running ? "⏹ إيقاف المحرك" : "▶ تشغيل + صفقة فورية"}
            </Btn>
            <Btn onClick={() => act("scan")} busy={busy === "scan"} tone="ghost" disabled={!st}>
              ⚡ فحص فوري الآن
            </Btn>
            <Btn onClick={() => setShowSettings((v) => !v)} tone="ghost">
              ⚙️ الإعدادات
            </Btn>
            <a
              href="/api/download"
              className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-[12px] font-bold text-amber-200 transition hover:bg-amber-300/20"
            >
              ⬇ تنزيل بوت Termux (apex-fractal-v10.js)
            </a>
          </div>
        </div>
        {err && <p className="mt-2 text-[11px] text-rose-300">خطأ اتصال: {err}</p>}
      </header>

      {/* ---------------------------------------------------------------- KPIs */}
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="إشارات اليوم" value={agg?.signalsToday ?? 0} sub={`من أصل ${st?.signalsToday ?? 0} منذ البدء`} tone="gold" />
        <Stat label="إجمالي الصفقات المنشورة" value={agg?.totalSignals ?? 0} sub={`${st?.cycles ?? 0} دورة مسح`} />
        <Stat label="نسبة الفوز" value={`${agg?.winRate ?? 0}%`} sub={`${agg?.wins ?? 0} فوز / ${agg?.losses ?? 0} خسارة`} tone={(agg?.winRate ?? 0) >= 50 ? "good" : "bad"} />
        <Stat label="مجموع R المحقق" value={`${(agg?.sumR ?? 0) >= 0 ? "+" : ""}${agg?.sumR ?? 0}R`} sub={`${agg?.tp2 ?? 0} هدف ثاني كامل`} tone={(agg?.sumR ?? 0) >= 0 ? "good" : "bad"} />
        <Stat label="صافي الربح (محاكاة)" value={`${(agg?.sumPnl ?? 0).toFixed(2)}$`} sub={`غير المحقق ${(st?.unrealized ?? 0).toFixed(2)}$`} tone={(agg?.sumPnl ?? 0) >= 0 ? "good" : "bad"} />
        <Stat label="معدل فوز النخبة الجينية" value={`${st?.lastArena?.avgWR ?? 0}%`} sub={`آخر دورة ${st?.lastCycleAt ? clock(st.lastCycleAt) : "—"}`} />
      </div>

      {/* -------------------------------------------------------------- rules */}
      <div className="mt-3 grid gap-2 md:grid-cols-4 lg:grid-cols-7">
        {RULES.map((r) => (
          <div key={r.t} className="panel px-2.5 py-2">
            <div className="text-[11px] font-black text-emerald-200">{r.t}</div>
            <div className="mt-0.5 text-[10.5px] leading-snug text-slate-400">{r.d}</div>
          </div>
        ))}
      </div>

      {showSettings && <SettingsPanel data={data} onSaved={load} />}

      {/* ---------------------------------------------------------- main grid */}
      <div className="mt-3 grid gap-3 xl:grid-cols-[1.55fr_1fr]">
        <div className="space-y-3">
          <SignalCard signal={lastSignal} />
          <PositionsTable rows={st?.openTrades ?? []} />
          <ArenaPanel round={round ?? st?.lastArena ?? null} />
          <HistoryTable rows={st?.closed ?? []} />
        </div>
        <div className="space-y-3">
          <NextSlots status={data} />
          <StrategyGrid rows={data?.strategyStats?.length ? data.strategyStats : (st?.strategyStats ?? [])} lastWinner={winnerIds} />
          <RunGuide />
          <LogStream logs={data?.logs ?? []} />
        </div>
      </div>

      <footer className="mt-6 border-t border-white/8 pt-4 text-center text-[11px] leading-relaxed text-slate-500">
        <p>
          APEX FRACTAL v10 — المحرك نفسه (<span className="num">src/engine/apex-core.js</span>) يشغّل هذه اللوحة ويُنفَّذ أيضاً كبوت مستقل على
          Termux/VPS بلا أي اعتماديات.
        </p>
        <p className="mt-1">
          تيليجرام: {data?.telegram ? "✅ مُعدّ (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)" : "⚠️ غير مُعدّ — أضف TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID في .env"}
          {" · "}التنبيهات تُرسل من الخادم فقط ولا يظهر التوكن في المتصفح أبداً.
        </p>
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ helpers */
function Btn({
  children,
  onClick,
  tone = "ghost",
  busy,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "primary" | "danger" | "ghost";
  busy?: boolean;
  disabled?: boolean;
}) {
  const base = "rounded-lg px-3 py-2 text-[12px] font-bold transition disabled:opacity-45";
  const c =
    tone === "primary"
      ? "bg-emerald-300 text-emerald-950 hover:bg-emerald-200"
      : tone === "danger"
        ? "border border-rose-300/40 bg-rose-400/15 text-rose-200 hover:bg-rose-400/25"
        : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10";
  return (
    <button onClick={onClick} disabled={disabled || busy} className={`${base} ${c}`}>
      {busy ? "…" : children}
    </button>
  );
}

function NextSlots({ status }: { status: StatusResponse | null }) {
  const rounds = status?.lastRounds ?? [];
  const arena = status?.status.lastArena;
  return (
    <Card title="وتيرة الساعة" sub="سجل آخر جولات القنال الدامي — جولة واحدة كل ساعة بالضبط">
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/6 bg-black/25 px-2.5 py-2">
          <div className="text-[10.5px] text-slate-400">آخر صفقة</div>
          <div className="num text-[13px] font-bold text-slate-100">{clock(status?.status.lastSignalAt)}</div>
        </div>
        <div className="rounded-lg border border-white/6 bg-black/25 px-2.5 py-2">
          <div className="text-[10.5px] text-slate-400">الصفقة القادمة</div>
          <div className="num text-[13px] font-bold text-emerald-300">{clock(status?.status.nextSignalAt)}</div>
        </div>
      </div>
      {arena && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-[10.5px] text-slate-400">
            <span>قوة الجولة الأخيرة</span>
            <span className="num font-bold text-slate-200">
              {arena.input} دخول ← {arena.executed} إعدام
            </span>
          </div>
          <Bar value={Math.min(1, arena.executed / Math.max(1, arena.input))} tone="blood" />
        </div>
      )}
      <ul className="space-y-1.5">
        {rounds.length === 0 && <li className="py-3 text-center text-[11px] text-slate-500">لا جولات محفوظة بعد.</li>}
        {rounds.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-2">
            <div className="min-w-0">
              <div className="num text-[11.5px] font-bold text-slate-100">
                {r.winnerSymbol ? `${r.winnerSymbol} · ${r.winnerSide === "BUY" ? "شراء" : "بيع"}` : "بلا ناجٍ"}
              </div>
              <div className="text-[10.5px] text-slate-500">
                {clock(Date.parse(r.createdAt))} · {r.reason} · أعدم {r.executed}
              </div>
            </div>
            {r.winnerConfidence != null && <span className="num shrink-0 text-[12px] font-black text-amber-200">{pct(r.winnerConfidence)}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SettingsPanel({ data, onSaved }: { data: StatusResponse | null; onSaved: () => Promise<void> }) {
  const s = data?.settings;
  const [form, setForm] = useState({
    riskPerTradePct: s?.riskPerTradePct ?? 1,
    startBalance: s?.startBalance ?? 1000,
    cadenceMinutes: s?.cadenceMinutes ?? 60,
    rr: s?.rr ?? 5,
    rrElite: s?.rrElite ?? 6,
    watchlist: (s?.watchlist?.length ? s.watchlist : (data?.status.config.watchlist ?? [])).join(", "),
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!s) return;
    setForm({
      riskPerTradePct: s.riskPerTradePct,
      startBalance: s.startBalance,
      cadenceMinutes: s.cadenceMinutes,
      rr: s.rr,
      rrElite: s.rrElite,
      watchlist: (s.watchlist?.length ? s.watchlist : (data?.status.config.watchlist ?? [])).join(", "),
    });
  }, [s, data]);

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          riskPerTradePct: Number(form.riskPerTradePct),
          startBalance: Number(form.startBalance),
          cadenceMinutes: Number(form.cadenceMinutes),
          rr: Number(form.rr),
          rrElite: Number(form.rrElite),
          watchlist: form.watchlist.split(",").map((x) => x.trim()).filter(Boolean),
        }),
      });
      const j = await r.json();
      setMsg(j.ok ? "✅ حُفظت الإعدادات وأُعيد بناء المحرك" : `❌ ${j.error ?? "فشل الحفظ"}`);
      await onSaved();
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const field = (k: keyof typeof form, label: string, hint: string, step = "0.1") => (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-300">{label}</span>
      <input
        value={String(form[k])}
        step={step}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
        className="num mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[12.5px] text-slate-100 outline-none focus:border-emerald-300/50"
      />
      <span className="mt-0.5 block text-[10px] text-slate-500">{hint}</span>
    </label>
  );

  return (
    <Card className="mt-3" title="إعدادات المحرك" sub="تُحفظ في PostgreSQL ويُعاد بناء المحرك فوراً">
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
        {field("cadenceMinutes", "وتيرة الصفقة (دقيقة)", "60 = صفقة قوية كل ساعة بالضبط", "5")}
        {field("rr", "الهدف الثاني (R)", "5 = مخاطرة/ربح 1:5", "0.5")}
        {field("rrElite", "R النخبوي (انفجار)", "6 = 1:6 عند الانفجارات القوية", "0.5")}
        {field("riskPerTradePct", "المخاطرة %", "من الرصيد لكل صفقة", "0.1")}
        {field("startBalance", "رصيد المحاكاة", "يُستخدم في المحاكاة فقط", "10")}
      </div>
      <label className="mt-3 block">
        <span className="text-[11px] font-semibold text-slate-300">قائمة المراقبة (مفصولة بفواصل)</span>
        <textarea
          rows={2}
          value={form.watchlist}
          onChange={(e) => setForm((f) => ({ ...f, watchlist: e.target.value }))}
          className="num mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-slate-200 outline-none focus:border-emerald-300/50"
        />
        <span className="mt-0.5 block text-[10px] text-slate-500">اتركها فارغة لاستخدام القائمة الافتراضية (29 عملة).</span>
      </label>
      <div className="mt-3 flex items-center gap-3">
        <Btn onClick={save} busy={saving} tone="primary">
          💾 حفظ وإعادة بناء المحرك
        </Btn>
        <Btn
          onClick={async () => {
            await fetch("/api/engine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset" }) });
            await onSaved();
          }}
          tone="danger"
        >
          ♻ تصفير الذاكرة والنتائج
        </Btn>
        {msg && <span className="text-[11.5px] text-slate-300">{msg}</span>}
      </div>
    </Card>
  );
}
