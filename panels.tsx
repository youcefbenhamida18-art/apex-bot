"use client";

import type { ReactNode } from "react";
import type {
  ArenaRoundDto,
  SignalDto,
  StatusResponse,
  StrategyStatDto,
  TradeDto,
} from "./types";

type Survivor = NonNullable<ArenaRoundDto["survivors"]>[number];
type Executed = NonNullable<ArenaRoundDto["executedSample"]>[number];

/* ------------------------------------------------------------- formatters */
export const fmtPrice = (p?: number | null) => {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  if (Math.abs(p) >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(p) >= 1) return p.toFixed(4);
  return p.toPrecision(4);
};
export const fmtMoney = (p?: number | null, d = 2) =>
  p === null || p === undefined || !Number.isFinite(p) ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(d)}`;
export const pct = (v?: number | null, d = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`;
export const timeAgo = (ts?: number | null) => {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `قبل ${s} ث`;
  if (s < 3600) return `قبل ${Math.round(s / 60)} د`;
  if (s < 86400) return `قبل ${Math.round(s / 3600)} س`;
  return `قبل ${Math.round(s / 86400)} ي`;
};
export const clock = (ts?: number | null) =>
  ts ? new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

export const gradeStyle: Record<string, string> = {
  ELITE: "bg-amber-300/15 text-amber-200 border-amber-300/40",
  STRONG: "bg-emerald-300/12 text-emerald-200 border-emerald-300/35",
  STANDARD: "bg-sky-300/12 text-sky-200 border-sky-300/30",
  FORCED: "bg-rose-300/10 text-rose-200 border-rose-300/30",
};
export const gradeAr: Record<string, string> = {
  ELITE: "نخبوية",
  STRONG: "قوية جداً",
  STANDARD: "قوية",
  FORCED: "إجبارية (أفضل المتاح)",
};

/* ------------------------------------------------------------------ atoms */
export function Card({
  title,
  sub,
  children,
  right,
  className = "",
}: {
  title?: string;
  sub?: string;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-4 ${className}`}>
      {(title || right) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[15px] font-bold text-slate-100">{title}</h2>}
            {sub && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{sub}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "good" | "bad" | "gold";
}) {
  const color =
    tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : tone === "gold" ? "text-amber-200" : "text-slate-100";
  return (
    <div className="panel px-3 py-2.5">
      <div className="text-[10.5px] font-semibold tracking-wide text-slate-400">{label}</div>
      <div className={`num mt-1 text-[19px] font-bold leading-none ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-[10.5px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function Bar({ value, tone = "acid" }: { value: number; tone?: "acid" | "blood" | "gold" | "sky" }) {
  const bg =
    tone === "blood"
      ? "bg-rose-400"
      : tone === "gold"
        ? "bg-amber-300"
        : tone === "sky"
          ? "bg-sky-400"
          : "bg-emerald-300";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
      <div className={`h-full rounded-full ${bg} transition-all duration-700`} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Chip({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "acid" | "blood" | "gold" }) {
  const t =
    tone === "acid"
      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
      : tone === "blood"
        ? "border-rose-300/30 bg-rose-300/10 text-rose-200"
        : tone === "gold"
          ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
          : "border-white/10 bg-white/5 text-slate-300";
  return <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold ${t}`}>{children}</span>;
}

/* --------------------------------------------------------------- countdown */
export function CountdownRing({ nextSignalAt, cadenceMs, running }: { nextSignalAt: number; cadenceMs: number; running: boolean }) {
  const remain = Math.max(0, nextSignalAt - Date.now());
  const ratio = Math.min(1, Math.max(0, 1 - remain / Math.max(1, cadenceMs)));
  const R = 26;
  const C = 2 * Math.PI * R;
  const mm = String(Math.floor(remain / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remain % 60000) / 1000)).padStart(2, "0");
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-16 w-16 shrink-0">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
          <circle cx="32" cy="32" r={R} fill="none" stroke="#16202f" strokeWidth="5" />
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke={running ? "#7cf6c4" : "#3b4a63"}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - ratio)}
          />
        </svg>
        <div className="num absolute inset-0 grid place-items-center text-[13px] font-bold text-slate-100">
          {running ? `${mm}:${ss}` : "--:--"}
        </div>
      </div>
      <div className="leading-tight">
        <div className="text-[11px] text-slate-400">الصفقة النخبوية القادمة</div>
        <div className="text-[13px] font-bold text-slate-100">
          {running ? clock(nextSignalAt) : "المحرك متوقف"}
        </div>
        <div className="text-[10.5px] text-slate-500">صفقة كل ساعة + صفقة فورية بعد التشغيل</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- signal card */
export function SignalCard({ signal }: { signal: SignalDto | null }) {
  if (!signal)
    return (
      <Card title="صفقة الساعة" sub="بانتظار أول دورة مسح — اضغط «تشغيل المحرك» أو «فحص فوري».">
        <div className="grid place-items-center py-10 text-center text-slate-500">
          <div className="text-3xl">⏳</div>
          <p className="mt-2 text-xs">القنال الدامي يحتاج جولة واحدة ليخرج الناجي الوحيد.</p>
        </div>
      </Card>
    );

  const long = signal.side === "BUY";
  return (
    <Card
      className={long ? "glow-long" : "glow-short"}
      title={`صفقة ${signal.reason === "BOOT" ? "الإطلاق الفورية" : "الساعة"} — ${signal.symbol}`}
      sub={`${signal.strategies.length} استراتيجية متوافقة خرجت حية من القنال الدامي · القائد: ${signal.leader.nameAr}`}
      right={
        <div className="flex flex-col items-end gap-1.5">
          <span className={`rounded-md border px-2 py-1 text-[11px] font-extrabold ${gradeStyle[signal.grade]}`}>
            {gradeAr[signal.grade]} · {signal.grade}
          </span>
          <span className={`num rounded-md px-2 py-1 text-[15px] font-black ${long ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>
            {long ? "▲ شراء LONG" : "▼ بيع SHORT"}
          </span>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[11px] text-slate-400">ثقة الناجي الوحيد</span>
            <span className="num text-lg font-black text-slate-50">{pct(signal.confidence)}</span>
          </div>
          <Bar value={signal.confidence} tone={signal.confidence >= 0.75 ? "gold" : "acid"} />

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Level label="الدخول" value={fmtPrice(signal.price)} tone="text-slate-50" />
            <Level label={`الوقف (-${signal.slPct.toFixed(2)}%)`} value={fmtPrice(signal.sl)} tone="text-rose-300" />
            <Level label={`الهدف 1 · خروج 50% · 1:${signal.tp1R}`} value={fmtPrice(signal.tp1)} tone="text-sky-300" />
            <Level label={`الهدف 2 · الباقي · 1:${signal.rr}`} value={fmtPrice(signal.tp2)} tone="text-amber-200" />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Chip tone="gold">العائد/المخاطرة 1:{signal.rr}</Chip>
            <Chip>الحجم {signal.qty.toPrecision(4)}</Chip>
            <Chip>المخاطرة {signal.riskUSD.toFixed(2)}$</Chip>
            <Chip tone="acid">الهدف خلال ~{signal.hoursToTp2} ساعة</Chip>
            <Chip>{signal.createdAt ? timeAgo(signal.createdAt) : ""}</Chip>
          </div>
        </div>

        <div className="space-y-3">
          <Gauges explosion={signal.explosion} speed={signal.speed} align={signal.align} />
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-slate-400">مصفوفة الاتجاه (الاتجاه مقدّس)</div>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone={signal.annualTrend === "ANNUAL_BULLISH" ? "acid" : signal.annualTrend === "ANNUAL_BEARISH" ? "blood" : "slate"}>
                1D · {signal.annualTrend === "ANNUAL_BULLISH" ? "سنوي صاعد" : signal.annualTrend === "ANNUAL_BEARISH" ? "سنوي هابط" : "تجميع"}
              </Chip>
              <Chip tone={signal.flow > 0 ? "acid" : signal.flow < 0 ? "blood" : "slate"}>
                التدفق الكلي · {signal.flow > 0 ? "صاعد" : signal.flow < 0 ? "هابط" : "محايد"}
              </Chip>
              <Chip tone="gold">جيل النخبة {signal.generation}</Chip>
              <Chip>فوز النخبة {signal.avgWR}%</Chip>
              <Chip tone={signal.dataSource === "binance" ? "acid" : "gold"}>
                المصدر: {signal.dataSource === "binance" ? "Binance Futures" : "مولّد السوق البديل"}
              </Chip>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-slate-400">الاستراتيجيات المتوافقة</div>
            <ul className="scroll-thin max-h-40 space-y-1.5 overflow-y-auto pe-1">
              {signal.strategies.map((s) => (
                <li key={s.id} className="rounded-lg border border-white/6 bg-white/[0.03] px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-bold text-slate-100">{s.nameAr}</span>
                    <span className="num text-[11px] font-bold text-emerald-300">{pct(s.quality, 0)}</span>
                  </div>
                  <div className="mt-1 text-[10.5px] leading-snug text-slate-400">{s.note}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Level({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-white/6 bg-black/25 px-2.5 py-2">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className={`num mt-0.5 text-[14px] font-bold ${tone}`}>{value}</div>
    </div>
  );
}

export function Gauges({ explosion, speed, align }: { explosion: number; speed: number; align: number }) {
  const rows = [
    { k: "قوة الانفجار", v: explosion, tone: "gold" as const },
    { k: "سرعة الوصول للهدف", v: speed, tone: "acid" as const },
    { k: "محاذاة الاتجاه", v: align, tone: "sky" as const },
  ];
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.k}>
          <div className="mb-1 flex items-center justify-between text-[10.5px] text-slate-400">
            <span>{r.k}</span>
            <span className="num font-bold text-slate-200">{pct(r.v, 0)}</span>
          </div>
          <Bar value={r.v} tone={r.tone} />
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- blood channel */
export function ArenaPanel({ round }: { round: ArenaRoundDto | (StatusResponse["status"]["lastArena"] & { id?: number }) | null }) {
  if (!round)
    return (
      <Card title="القنال الدامي" sub="مراحل تصفية الـ20 استراتيجية">
        <p className="py-6 text-center text-xs text-slate-500">لا توجد جولة بعد.</p>
      </Card>
    );
  const stages = round.stages ?? [];
  const survivors = (round.survivors ?? []) as Survivor[];
  const executed = (round.executedSample ?? []) as Executed[];
  const maxIn = Math.max(1, stages[0]?.in ?? 1);

  return (
    <Card
      title="القنال الدامي — 5 مراحل تصفية"
      sub={`${round.input ?? 0} مرشحاً خاماً دخلوا · ${round.executed ?? 0} أُعدموا · ناجٍ واحد فقط يُنشر`}
      right={<Chip tone="blood">جولة {round.reason ?? "—"}</Chip>}
    >
      <div className="space-y-1.5">
        {stages.map((s, i) => (
          <div key={s.name} className="flex items-center gap-2">
            <span className="num w-5 shrink-0 text-[11px] font-bold text-slate-500">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="truncate font-semibold text-slate-200">{s.name}</span>
                <span className="num shrink-0 text-slate-400">
                  {s.in} ← <b className={s.out ? "text-emerald-300" : "text-rose-300"}>{s.out}</b>
                </span>
              </div>
              <div className="relative mt-1 h-2 overflow-hidden rounded bg-white/6">
                <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-rose-500/70 to-amber-300/70" style={{ width: `${(s.in / maxIn) * 100}%` }} />
                <div className="absolute inset-y-0 right-0 bg-emerald-300/90" style={{ width: `${(s.out / maxIn) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[11px] font-bold text-emerald-300">الناجون (أفضل 6)</div>
          <ul className="scroll-thin max-h-64 space-y-1.5 overflow-y-auto pe-1">
            {survivors.length === 0 && <li className="text-[11px] text-slate-500">لا ناجين.</li>}
            {survivors.map((s, i) => (
              <li key={`${s.symbol}-${s.side}-${i}`} className="rounded-lg border border-white/6 bg-white/[0.03] px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-[12px] font-black text-slate-100">
                    {s.symbol} <span className={s.side === "BUY" ? "text-emerald-300" : "text-rose-300"}>{s.side === "BUY" ? "▲" : "▼"}</span>
                  </span>
                  <span className="num text-[11px] font-bold text-amber-200">{pct(s.confidence)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Chip tone="gold">1:{s.rr}</Chip>
                  <Chip>انفجار {pct(s.explosion, 0)}</Chip>
                  <Chip>~{s.hoursToTp2} س</Chip>
                  <Chip>{s.strategies.length} استراتيجية</Chip>
                </div>
                <div className="mt-1 truncate text-[10.5px] text-slate-400">
                  {s.strategies.map((x) => x.nameAr).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-bold text-rose-300">ساحة الإعدام (لماذا قُتلت الصفقات الغبية)</div>
          <ul className="scroll-thin max-h-64 space-y-1 overflow-y-auto pe-1">
            {executed.length === 0 && <li className="text-[11px] text-slate-500">لم يُعدم أحد هذه الجولة.</li>}
            {executed.map((e, i) => (
              <li key={i} className="flex items-start gap-2 rounded-md border border-rose-400/10 bg-rose-500/[0.04] px-2 py-1.5">
                <span className="mt-0.5 text-rose-400">✖</span>
                <div className="min-w-0">
                  <span className="num text-[11px] font-bold text-slate-200">
                    {e.symbol} {e.side}
                  </span>
                  <span className="text-[11px] text-slate-400"> · {e.nameAr}</span>
                  <div className="text-[10.5px] leading-snug text-rose-200/80">{e.reason}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- positions */
export function PositionsTable({ rows }: { rows: TradeDto[] }) {
  return (
    <Card
      title="الصفقات المفتوحة — إدارة 50% / 50%"
      sub="عند الهدف الأول يُجنى 50% ويُنفَّل الوقف إلى الدخول، والنصف الثاني يركض حتى 1:5 / 1:6"
      right={<Chip tone={rows.length ? "acid" : "slate"}>{rows.length} مفتوحة</Chip>}
    >
      {rows.length === 0 ? (
        <p className="py-5 text-center text-xs text-slate-500">لا صفقات مفتوحة الآن.</p>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[720px] text-right text-[11.5px]">
            <thead className="text-[10.5px] text-slate-500">
              <tr className="border-b border-white/8">
                <th className="py-1.5 ps-1 font-semibold">العملة</th>
                <th className="py-1.5 font-semibold">الدخول</th>
                <th className="py-1.5 font-semibold">السعر</th>
                <th className="py-1.5 font-semibold">R الآن</th>
                <th className="py-1.5 font-semibold">الوقف</th>
                <th className="py-1.5 font-semibold">المسار إلى 1:{rows[0]?.rr ?? 5}</th>
                <th className="py-1.5 font-semibold">الربح</th>
                <th className="py-1.5 pe-1 font-semibold">الحالة</th>
              </tr>
            </thead>
            <tbody className="num">
              {rows.map((t) => {
                const long = t.side === "BUY";
                const edge = t.origSl ?? t.sl;
                const span = t.tp2 - edge || 1;
                const pos = clamp01((t.price - edge) / span);
                const tp1Pos = clamp01((t.tp1 - edge) / span);
                return (
                  <tr key={t.id} className="border-b border-white/5">
                    <td className="py-2 ps-1 font-bold text-slate-100">
                      {t.symbol} <span className={long ? "text-emerald-300" : "text-rose-300"}>{long ? "▲" : "▼"}</span>
                    </td>
                    <td className="py-2 text-slate-300">{fmtPrice(t.entry)}</td>
                    <td className="py-2 text-slate-100">{fmtPrice(t.price)}</td>
                    <td className={`py-2 font-bold ${t.rNow >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtMoney(t.rNow)}R</td>
                    <td className="py-2 text-slate-400">
                      {fmtPrice(t.sl)} {t.status === "TP1" && <Chip tone="acid">تعادل</Chip>}
                    </td>
                    <td className="py-2">
                      <div className="relative h-2 w-full min-w-[120px] overflow-hidden rounded bg-white/8">
                        <div className="absolute inset-y-0 w-px bg-rose-400" style={{ right: 0 }} />
                        <div className="absolute inset-y-0 w-0.5 bg-sky-300" style={{ right: `${tp1Pos * 100}%` }} />
                        <div className="absolute inset-y-0 w-0.5 bg-amber-300" style={{ right: "100%" }} />
                        <div
                          className={`absolute h-full rounded-full ${long ? "bg-emerald-400/80" : "bg-rose-400/80"}`}
                          style={{ right: 0, width: `${pos * 100}%` }}
                        />
                      </div>
                    </td>
                    <td className={`py-2 font-bold ${t.upnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtMoney(t.upnl)}$</td>
                    <td className="py-2 pe-1">
                      <Chip tone={t.status === "TP1" ? "acid" : "slate"}>{t.status === "TP1" ? "TP1 ✓" : "مفتوحة"}</Chip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/* ---------------------------------------------------------------- history */
export function HistoryTable({ rows }: { rows: TradeDto[] }) {
  return (
    <Card title="سجل النتائج" sub="R المحقق لكل صفقة مغلقة — يغذي أوزان الاستراتيجيات مباشرة" right={<Chip>{rows.length}</Chip>}>
      {rows.length === 0 ? (
        <p className="py-5 text-center text-xs text-slate-500">لا نتائج بعد — أول صفقة تُغلق ستظهر هنا.</p>
      ) : (
        <div className="scroll-thin max-h-80 overflow-y-auto pe-1">
          <table className="w-full text-right text-[11.5px]">
            <thead className="sticky top-0 bg-[#0a0f1a] text-[10.5px] text-slate-500">
              <tr className="border-b border-white/8">
                <th className="py-1.5 ps-1 font-semibold">العملة</th>
                <th className="py-1.5 font-semibold">الاتجاه</th>
                <th className="py-1.5 font-semibold">الدخول</th>
                <th className="py-1.5 font-semibold">الخروج</th>
                <th className="py-1.5 font-semibold">R</th>
                <th className="py-1.5 font-semibold">الربح</th>
                <th className="py-1.5 font-semibold">النتيجة</th>
                <th className="py-1.5 pe-1 font-semibold">الوقت</th>
              </tr>
            </thead>
            <tbody className="num">
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-white/5">
                  <td className="py-1.5 ps-1 font-bold text-slate-100">{t.symbol}</td>
                  <td className={`py-1.5 ${t.side === "BUY" ? "text-emerald-300" : "text-rose-300"}`}>{t.side === "BUY" ? "شراء" : "بيع"}</td>
                  <td className="py-1.5 text-slate-300">{fmtPrice(t.entry)}</td>
                  <td className="py-1.5 text-slate-300">{fmtPrice(t.closePrice ?? t.price)}</td>
                  <td className={`py-1.5 font-bold ${(t.rMultiple ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {fmtMoney(t.rMultiple)}R
                  </td>
                  <td className={`py-1.5 ${(t.realized ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtMoney(t.realized)}$</td>
                  <td className="py-1.5">
                    <Chip tone={t.status === "TP2" ? "gold" : t.status === "BE" ? "acid" : "blood"}>
                      {t.status === "TP2" ? "🏆 الهدف الثاني" : t.status === "BE" ? "🛡 تعادل" : "🛑 وقف"}
                    </Chip>
                  </td>
                  <td className="py-1.5 pe-1 text-slate-400">{timeAgo(t.closedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------- strategies */
export function StrategyGrid({ rows, lastWinner }: { rows: StrategyStatDto[]; lastWinner?: string[] }) {
  const sorted = [...rows].sort((a, b) => b.weight - a.weight);
  const maxW = Math.max(1.2, ...sorted.map((s) => s.weight));
  return (
    <Card
      title="الـ20 استراتيجية بعد القنال الدامي"
      sub="الوزن الحي = معدل الفوز + متوسط R + عامل الربح — يتطور بلا نهاية بعد كل صفقة (الجينوم يُطفَّر تلقائياً)"
      right={<Chip tone="gold">{rows.length} استراتيجية</Chip>}
    >
      <div className="grid gap-2 md:grid-cols-2">
        {sorted.map((s, i) => {
          const won = lastWinner?.includes(s.id);
          return (
            <div
              key={s.id}
              className={`rounded-lg border px-2.5 py-2 ${won ? "border-emerald-300/40 bg-emerald-300/[0.06]" : "border-white/6 bg-white/[0.02]"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-bold text-slate-100">
                  <span className="num text-slate-500">#{i + 1}</span> {s.nameAr}
                </span>
                <span className="num shrink-0 text-[12px] font-black text-amber-200">×{s.weight.toFixed(2)}</span>
              </div>
              <div className="mt-1.5">
                <Bar value={s.weight / maxW} tone={s.weight >= 1.15 ? "gold" : s.weight >= 0.95 ? "acid" : "blood"} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <Chip>{s.n} صفقة</Chip>
                <Chip tone={s.winRate >= 55 ? "acid" : s.winRate >= 40 ? "slate" : "blood"}>فوز {s.winRate.toFixed(0)}%</Chip>
                <Chip tone={s.avgR >= 0.5 ? "acid" : s.avgR < 0 ? "blood" : "slate"}>R {fmtMoney(s.avgR)}</Chip>
                <Chip>PF {s.profitFactor >= 99 ? "∞" : s.profitFactor.toFixed(2)}</Chip>
                <Chip tone="slate">{s.bias === "trend" ? "اتباع اتجاه" : s.bias === "reversal" ? "انعكاس" : "محايد"}</Chip>
                {s.pending > 0 && <Chip tone="gold">{s.pending} قيد التنفيذ</Chip>}
                {won && <Chip tone="acid">قائد الصفقة الحالية</Chip>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------- logs */
export function LogStream({ logs }: { logs: StatusResponse["logs"] }) {
  const tone = (l: string) =>
    l === "error" ? "text-rose-300" : l === "success" ? "text-emerald-300" : l === "warn" ? "text-amber-200" : l === "telegram" ? "text-sky-300" : "text-slate-400";
  return (
    <Card title="بث المحرك المباشر" sub="كل دورة مسح، كل إعدام، كل هدف — لحظياً" right={<Chip tone="acid">{logs.length}</Chip>}>
      <ul className="scroll-thin max-h-[420px] space-y-1 overflow-y-auto pe-1 text-[11.5px]">
        {logs.length === 0 && <li className="py-4 text-center text-slate-500">لا أحداث بعد.</li>}
        {logs.map((l) => (
          <li key={l.id} className="flex gap-2 border-b border-white/5 pb-1">
            <span className="num shrink-0 text-slate-600">{clock(l.at)}</span>
            <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${tone(l.level)}`}>{l.message}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------- run guide */
export function RunGuide() {
  const env = `TELEGRAM_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=112233445
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
LIVE_TRADING=false
RISK_PER_TRADE_PCT=1
START_BALANCE=1000`;
  const cmd = `pkg install nodejs-lts -y
termux-setup storage
cd ~/apex
nano .env      # الصق المفاتيح أعلاه
node apex-fractal-v10.js`;
  return (
    <Card
      title="تشغيل نفس المحرك على Termux / VPS"
      sub="الملف المنزَّل هو المحرك ذاته الذي يشغّل هذه اللوحة — بلا أي مكتبات خارجية (node ≥ 18)"
      right={<Chip tone="gold">صفر اعتماديات</Chip>}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] font-bold text-slate-300">1) ملف .env بجانب السكربت</div>
          <pre className="num scroll-thin overflow-x-auto rounded-lg border border-white/8 bg-black/50 p-2.5 text-[10.5px] leading-relaxed text-emerald-200/90" dir="ltr">
            {env}
          </pre>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-bold text-slate-300">2) أوامر التشغيل</div>
          <pre className="num scroll-thin overflow-x-auto rounded-lg border border-white/8 bg-black/50 p-2.5 text-[10.5px] leading-relaxed text-sky-200/90" dir="ltr">
            {cmd}
          </pre>
        </div>
      </div>
      <ul className="mt-3 grid gap-1 text-[11px] leading-relaxed text-slate-400 md:grid-cols-2">
        <li>• صفقة واحدة كل ساعة بالضبط + صفقة فورية بعد التشغيل.</li>
        <li>• RR = 1:5 (و1:6 للانفجار النخبوي)، 50% خروج عند 2.5R ثم وقف على الدخول.</li>
        <li>• <span className="text-slate-300">LIVE_TRADING=true</span> ينفّذ أوامر حقيقية على بينانس (سوقي + STOP_MARKET).</li>
        <li>• الحالة تُحفظ في <span className="num text-slate-300">apex_state_v10.json</span> فلا يضيع شيء عند إعادة التشغيل.</li>
      </ul>
    </Card>
  );
}
