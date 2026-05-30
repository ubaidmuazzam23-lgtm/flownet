// frontend/src/screens/AccountAnalytics.tsx
//
// Per-account analytics. ALL data is real — every chart is computed purely
// from the account's actual transactions returned by /accounts/{id}. No
// invented anomaly scores, no heuristics.
//
// 15 charts in 5 collapsible sections:
//   Time-series:      Line, Area, Moving Avg, Raw Time Series
//   Volume & Balance: Cumulative Balance, Day-of-Week, Monthly Totals
//   Activity:         Hour-of-Day, Calendar Heatmap, Velocity
//   Composition:      Channel Mix Over Time, Largest vs Typical
//   Detail:           Top 10 Largest, Avg Txn Size, Txn Count per Day

import { useMemo, useState, useRef, useEffect } from "react";
import { useAccounts, useAccountDetail } from "../hooks/useAccounts";
import type { TxnRow } from "../types";
import { inr, inrFull } from "../lib/format";
import { Loading } from "../components/states/Loading";

const IN_COLOR  = "#52C41A";
const OUT_COLOR = "#FF6D29";
const NET_COLOR = "#7C8CF8";
const ACCENTS   = ["#7C8CF8", "#42C9C2", "#FFC542", "#FF6D29", "#E5247A", "#52C41A", "#925CE6", "#8A8590"];

type DayPoint = { day: string; ts: number; in: number; out: number; net: number; count: number };

// ============================================================================
// Top-level entry
// ============================================================================
export default function AccountAnalytics() {
  const [picked, setPicked] = useState<string | null>(null);
  if (!picked) return <Picker onPick={setPicked} />;
  return <Analytics accountId={picked} onBack={() => setPicked(null)} />;
}

// ============================================================================
// Picker — search any account
// ============================================================================
function Picker({ onPick }: { onPick: (id: string) => void }) {
  const { data, loading } = useAccounts(500);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    if (!q.trim()) return items;
    const needle = q.toLowerCase();
    return items.filter((a) =>
      a.account_id.includes(needle) ||
      (a.actor ?? "").toLowerCase().includes(needle) ||
      (a.branch ?? "").toLowerCase().includes(needle));
  }, [data, q]);
  return (
    <div className="flex-1 overflow-auto no-scrollbar">
      <div className="px-8 pt-6 pb-4 border-b border-line">
        <h1 className="font-display text-[26px] tracking-tight">Account Analytics</h1>
        <p className="text-[13px] text-ash-400 mt-1 max-w-2xl">
          Pick any account to see its full transaction story through 15 charts in 5 sections.
          Search by account number, holder name, or branch.
        </p>
      </div>
      <div className="px-8 py-6">
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search account number, holder, or branch…"
          className="w-full max-w-xl rounded-lg border border-line bg-ink-800 px-4 py-2.5 text-[13px] text-ash-100 placeholder-ash-500 outline-none focus:border-flame-500/60"
        />
        <div className="mt-3 text-[10px] font-mono text-ash-500">
          {loading ? "Loading…" : `${filtered.length} of ${data?.items.length ?? 0} accounts`}
        </div>
        <div className="mt-4 max-w-3xl rounded-xl border border-line bg-ink-800 overflow-hidden">
          {loading ? <div className="px-4 py-6"><Loading label="Loading accounts…" /></div>
            : filtered.length === 0 ? <div className="px-4 py-6 text-ash-500 text-[13px]">No accounts match.</div>
            : (
              <div className="max-h-[60vh] overflow-y-auto">
                {filtered.map((a) => (
                  <button key={a.account_id} onClick={() => onPick(a.account_id)}
                    className="w-full text-left px-4 py-2.5 border-b border-line/40 hover:bg-ink-700 transition-colors flex items-center gap-3">
                    <span className="font-mono tnum text-[12px] text-ash-500 w-40 shrink-0">{a.account_id}</span>
                    <span className="text-[13px] text-ash-100 flex-1 truncate">{a.actor ?? "—"}</span>
                    <span className="text-[11px] font-mono text-ash-400">{a.account_type ?? ""}</span>
                    <span className="text-[11px] font-mono text-ash-500 w-44 truncate text-right">{a.branch ?? ""}</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      a.status === "ACTIVE" ? "bg-jade-500/10 text-jade-400" :
                      a.status === "FROZEN" ? "bg-danger-500/10 text-danger-500" :
                      "bg-ink-700 text-ash-400"
                    }`}>{a.status ?? ""}</span>
                  </button>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Click-to-pin tooltip system
// ============================================================================
type PinDetail = { x: number; y: number; lines: string[] };
const PinContext = (function () {
  let setter: ((p: PinDetail | null) => void) | null = null;
  return {
    register(fn: (p: PinDetail | null) => void) { setter = fn; },
    pin(p: PinDetail | null) { if (setter) setter(p); },
  };
})();

function PinPopup({ pin, onClose }: { pin: PinDetail | null; onClose: () => void }) {
  if (!pin) return null;
  return (
    <div className="fixed z-50 rounded-lg border border-flame-500/50 bg-ink-900 shadow-2xl p-3 pointer-events-auto"
      style={{ left: Math.min(pin.x + 12, window.innerWidth - 280), top: Math.min(pin.y + 12, window.innerHeight - 200), maxWidth: 280 }}>
      <button onClick={onClose} className="absolute top-1 right-2 text-ash-500 hover:text-ash-100 text-[14px]">×</button>
      <div className="space-y-0.5 pr-4">
        {pin.lines.map((ln, i) => (
          <div key={i} className={`font-mono text-[11px] ${i === 0 ? "text-flame-400 font-semibold" : "text-ash-200"}`}>
            {ln}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Analytics page
// ============================================================================
function Analytics({ accountId, onBack }: { accountId: string; onBack: () => void }) {
  const { data, loading, error } = useAccountDetail(accountId);
  const [pin, setPin] = useState<PinDetail | null>(null);
  useEffect(() => { PinContext.register(setPin); }, []);
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setPin(null); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  // open all by default
  const [open, setOpen] = useState<Record<string, boolean>>({
    timeseries: true, balance: true, activity: true, composition: true, detail: true,
  });
  const toggle = (k: string) => setOpen((p) => ({ ...p, [k]: !p[k] }));

  const series = useMemo<DayPoint[]>(() => {
    if (!data) return [];
    const byDay: Record<string, { in: number; out: number; ts: number; count: number }> = {};
    for (const t of data.transactions) {
      const d = new Date(t.timestamp);
      if (isNaN(d.getTime())) continue;
      const key = d.toISOString().slice(0, 10);
      const ts = new Date(key + "T00:00:00Z").getTime();
      byDay[key] ??= { in: 0, out: 0, ts, count: 0 };
      if (t.direction === "IN") byDay[key].in += t.amount; else byDay[key].out += t.amount;
      byDay[key].count += 1;
    }
    return Object.keys(byDay).sort().map((day) => ({
      day, ts: byDay[day].ts, in: byDay[day].in, out: byDay[day].out,
      net: byDay[day].in - byDay[day].out, count: byDay[day].count,
    }));
  }, [data]);

  if (loading) return <Loading label="Loading transaction history…" />;
  if (error) return <div className="px-8 py-6 text-danger-500">{error}</div>;
  if (!data) return null;

  return (
    <div className="flex-1 overflow-auto no-scrollbar" onClick={() => setPin(null)}>
      <PinPopup pin={pin} onClose={() => setPin(null)} />

      <div className="px-8 pt-6 pb-4 border-b border-line">
        <button onClick={onBack} className="text-[12px] font-mono text-ash-400 hover:text-ash-100 mb-3">
          ← Choose a different account
        </button>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-[26px] tracking-tight">{data.actor ?? "Unknown"}</h1>
            <div className="font-mono tnum text-[12px] text-ash-500 mt-0.5">{data.account_id}</div>
            <div className="text-[12px] text-ash-400 mt-2">
              {[data.branch, data.city, data.region].filter(Boolean).join(" · ") || "—"}
              {data.occupation ? ` · ${data.occupation}` : ""}
              {data.declared_income ? ` · income ${inr(data.declared_income)}` : ""}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <KPI label="Transactions" value={String(data.transactions.length)} accent={NET_COLOR} />
            <KPI label="Money in"  value={inr(data.total_in)}  accent={IN_COLOR} />
            <KPI label="Money out" value={inr(data.total_out)} accent={OUT_COLOR} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3 text-[10px] font-mono text-ash-500 flex-wrap">
          <Legend items={[
            { color: IN_COLOR, label: "IN" }, { color: OUT_COLOR, label: "OUT" }, { color: NET_COLOR, label: "NET (in − out)" }
          ]} />
          <span className="ml-2">{series.length} {series.length === 1 ? "day" : "days"} of real transactions · click any point to pin its details</span>
        </div>
      </div>

      {series.length === 0 ? (
        <div className="px-8 py-10 text-ash-500">No transactions on record for this account.</div>
      ) : (
        <div className="px-6 py-5 space-y-3 max-w-[1500px]">
          <Section title="Time-series" open={open.timeseries} onToggle={() => toggle("timeseries")} count={4}>
            <Card title="Line chart · daily totals" subtitle="Three series per day: IN, OUT, Net. Click any point for details.">
              <SeriesSvg series={series} mode="line" />
            </Card>
            <Card title="Area chart · daily volume" subtitle="Same series filled below the line. Emphasizes volume/magnitude.">
              <SeriesSvg series={series} mode="area" />
            </Card>
            <Card title="Moving average · 7-day" subtitle="Daily series smoothed with a 7-point rolling average. Cuts noise, reveals trend.">
              <SeriesSvg series={smooth(series, 7)} mode="line" smoothed />
            </Card>
            <Card title="Time series · every transaction" subtitle="Each transaction as a point at its exact timestamp. Click any point for full details.">
              <RawTimeSeries txns={data.transactions} />
            </Card>
          </Section>

          <Section title="Volume & balance" open={open.balance} onToggle={() => toggle("balance")} count={3}>
            <Card title="Cumulative balance" subtitle="Running total of IN minus OUT, over time. Net wealth trajectory of this account.">
              <CumulativeBalance series={series} />
            </Card>
            <Card title="Day-of-week activity" subtitle="Total IN/OUT broken down by day of week. Reveals weekly rhythm.">
              <DayOfWeekBars txns={data.transactions} />
            </Card>
            <Card title="Monthly totals" subtitle="IN and OUT aggregated by calendar month.">
              <MonthlyBars series={series} />
            </Card>
          </Section>

          <Section title="Activity patterns" open={open.activity} onToggle={() => toggle("activity")} count={3}>
            <Card title="Hour-of-day distribution" subtitle="Which hours of the day this account is active. 3 AM bursts are unusual.">
              <HourDistribution txns={data.transactions} />
            </Card>
            <Card title="Calendar heatmap" subtitle="GitHub-style activity grid — every day coloured by total volume.">
              <CalendarHeatmap series={series} />
            </Card>
            <Card title="Velocity · txns per hour (24h rolling)" subtitle="How frequently transactions occur. Spikes = bursts of activity.">
              <Velocity txns={data.transactions} />
            </Card>
          </Section>

          <Section title="Composition" open={open.composition} onToggle={() => toggle("composition")} count={2}>
            <Card title="Channel mix over time" subtitle="Stacked area of channel usage per day (NEFT/IMPS/UPI/etc).">
              <ChannelMixOverTime txns={data.transactions} />
            </Card>
            <Card title="Largest vs typical" subtitle="Distribution of transaction amounts. The few rightmost dots = outliers vs the bulk.">
              <BoxLikePlot txns={data.transactions} />
            </Card>
          </Section>

          <Section title="Detail" open={open.detail} onToggle={() => toggle("detail")} count={3}>
            <Card title="Top 10 largest transactions" subtitle="Single biggest transfers, full details. Click a row to pin it.">
              <TopTransactionsTable txns={data.transactions} />
            </Card>
            <Card title="Average transaction size · over time" subtitle="Mean transfer amount per day. A sudden upshift can indicate structuring or layering.">
              <AvgSizeOverTime series={series} txns={data.transactions} />
            </Card>
            <Card title="Transaction count · per day" subtitle="How busy each day is, by raw count.">
              <CountOverTime series={series} />
            </Card>
          </Section>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Shared chart primitives
// ============================================================================
function useChartWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { const cw = e.contentRect.width; if (cw > 80) setW(cw); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function smooth(series: DayPoint[], window: number): DayPoint[] {
  return series.map((p, i) => {
    const lo = Math.max(0, i - window + 1);
    const slice = series.slice(lo, i + 1);
    const n = slice.length;
    const sIn = slice.reduce((s, x) => s + x.in, 0);
    const sOut = slice.reduce((s, x) => s + x.out, 0);
    return { ...p, in: sIn / n, out: sOut / n, net: (sIn - sOut) / n };
  });
}

function compactInr(v: number): string {
  const sign = v < 0 ? "-" : ""; const a = Math.abs(v);
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(0)}k`;
  return `${sign}₹${Math.round(a)}`;
}

function niceTicks(min: number, max: number, count = 6): number[] {
  if (max === min) return [min];
  const range = max - min, raw = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 0.0001; v += step) out.push(Math.round(v / step) * step);
  return out;
}

function pickXTicks(times: number[], count = 8): number[] {
  if (times.length === 0) return [];
  if (times.length <= count) return times.slice();
  const min = times[0], max = times[times.length - 1];
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(min + ((max - min) * i) / count);
  return ticks;
}

function fmtDate(ts: number) { return new Date(ts).toLocaleDateString(); }
function fmtDateTime(ts: number) { return new Date(ts).toLocaleString(); }
function fmtMonth(ts: number) { return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short" }); }

function onPin(e: React.MouseEvent, lines: string[]) {
  e.stopPropagation();
  PinContext.pin({ x: e.clientX, y: e.clientY, lines });
}

// ============================================================================
// Line / Area / Moving-avg (shared)
// ============================================================================
function SeriesSvg({ series, mode, smoothed }: { series: DayPoint[]; mode: "line" | "area"; smoothed?: boolean }) {
  const { ref, w: W } = useChartWidth();
  const H = 280, P = { l: 64, r: 16, t: 14, b: 36 };
  const pw = Math.max(40, W - P.l - P.r), ph = H - P.t - P.b;
  if (series.length === 0) return <div ref={ref}><Empty /></div>;

  const xs = series.map((p) => p.ts);
  const tMin = xs[0], tMax = xs[xs.length - 1] || tMin + 1;
  const tSpan = Math.max(1, tMax - tMin);
  const allVals = series.flatMap((p) => [p.in, p.out, p.net]);
  const yMax = Math.max(0, ...allVals), yMin = Math.min(0, ...allVals);
  const ySpan = yMax - yMin || 1;
  const xS = (t: number) => series.length === 1 ? pw / 2 : ((t - tMin) / tSpan) * pw;
  const yS = (v: number) => ph - ((v - yMin) / ySpan) * ph;

  const buildPath = (k: "in" | "out" | "net") =>
    series.length === 1
      ? `M ${xS(series[0].ts)} ${yS(series[0][k])}`
      : series.map((p, i) => `${i === 0 ? "M" : "L"} ${xS(p.ts)} ${yS(p[k])}`).join(" ");
  const buildArea = (k: "in" | "out" | "net") => {
    const baseY = yS(0);
    return `${series.map((p, i) => `${i === 0 ? "M" : "L"} ${xS(p.ts)} ${yS(p[k])}`).join(" ")} L ${xS(series[series.length - 1].ts)} ${baseY} L ${xS(series[0].ts)} ${baseY} Z`;
  };

  const yTicks = niceTicks(yMin, yMax, 6);
  const xTicks = pickXTicks(xs, Math.min(8, series.length));

  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g transform={`translate(${P.l},${P.t})`}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={pw} y1={yS(v)} y2={yS(v)} stroke={v === 0 ? "#3A353F" : "#2B262E"} strokeDasharray={v === 0 ? "" : "2 4"} />
              <text x={-6} y={yS(v) + 3} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#6C6772">{compactInr(v)}</text>
            </g>
          ))}
          {mode === "area" && (
            <>
              <path d={buildArea("in")}  fill={IN_COLOR}  fillOpacity={0.18} />
              <path d={buildArea("out")} fill={OUT_COLOR} fillOpacity={0.18} />
              <path d={buildArea("net")} fill={NET_COLOR} fillOpacity={0.12} />
            </>
          )}
          <path d={buildPath("in")}  fill="none" stroke={IN_COLOR}  strokeWidth={smoothed ? 2 : 1.6} />
          <path d={buildPath("out")} fill="none" stroke={OUT_COLOR} strokeWidth={smoothed ? 2 : 1.6} />
          <path d={buildPath("net")} fill="none" stroke={NET_COLOR} strokeWidth={smoothed ? 2 : 1.4} strokeDasharray={smoothed ? "" : "4 3"} />

          {series.map((p, i) => (
            <g key={i}>
              <circle cx={xS(p.ts)} cy={yS(p.in)}  r={2.4} fill={IN_COLOR}
                onClick={(e) => onPin(e, [`${p.day}`, `IN  ${inrFull(p.in)}`])} className="cursor-pointer" />
              <circle cx={xS(p.ts)} cy={yS(p.out)} r={2.4} fill={OUT_COLOR}
                onClick={(e) => onPin(e, [`${p.day}`, `OUT ${inrFull(p.out)}`])} className="cursor-pointer" />
              <circle cx={xS(p.ts)} cy={yS(p.net)} r={2.4} fill={NET_COLOR}
                onClick={(e) => onPin(e, [`${p.day}`, `NET ${inrFull(p.net)}`])} className="cursor-pointer" />
            </g>
          ))}

          {xTicks.map((t, i) => (
            <g key={i}>
              <line x1={xS(t)} x2={xS(t)} y1={ph} y2={ph + 4} stroke="#3A353F" />
              <text x={xS(t)} y={ph + 16} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#8A8590">
                {fmtDate(t)}
              </text>
            </g>
          ))}
          <line x1={0} x2={pw} y1={ph} y2={ph} stroke="#3A353F" />
        </g>
      </svg>
    </div>
  );
}

// ============================================================================
// Raw time series (every transaction as a dot)
// ============================================================================
function RawTimeSeries({ txns }: { txns: TxnRow[] }) {
  const { ref, w: W } = useChartWidth();
  const H = 280, P = { l: 64, r: 16, t: 14, b: 36 };
  const pw = Math.max(40, W - P.l - P.r), ph = H - P.t - P.b;
  const pts = txns
    .map((t) => ({ ...t, ts: new Date(t.timestamp).getTime() }))
    .filter((t) => !isNaN(t.ts) && t.amount > 0)
    .sort((a, b) => a.ts - b.ts);
  if (pts.length === 0) return <div ref={ref}><Empty /></div>;

  const tMin = pts[0].ts, tMax = pts[pts.length - 1].ts || tMin + 1;
  const tSpan = Math.max(1, tMax - tMin);
  const aMax = Math.max(...pts.map((p) => p.amount));
  const yS = (v: number) => ph - (Math.log10(Math.max(1, v)) / Math.log10(Math.max(10, aMax))) * ph;
  const xS = (t: number) => ((t - tMin) / tSpan) * pw;

  const yTicks = [1e3, 1e4, 1e5, 1e6, 1e7].filter((v) => v <= aMax * 2);
  const xTicks = pickXTicks(pts.map((p) => p.ts), 8);

  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g transform={`translate(${P.l},${P.t})`}>
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={0} x2={pw} y1={yS(v)} y2={yS(v)} stroke="#2B262E" strokeDasharray="2 4" />
              <text x={-6} y={yS(v) + 3} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#6C6772">{compactInr(v)}</text>
            </g>
          ))}
          {pts.map((p, i) => (
            <circle key={i} cx={xS(p.ts)} cy={yS(p.amount)} r={2.4 + (p.amount / aMax) * 5}
              fill={p.direction === "IN" ? IN_COLOR : OUT_COLOR} fillOpacity={0.65}
              className="cursor-pointer"
              onClick={(e) => onPin(e, [
                fmtDateTime(p.ts),
                `${p.direction ?? ""} ${inrFull(p.amount)}`,
                p.counterparty ? `with ${p.counterparty}` : "",
                p.channel ? `via ${p.channel}` : "",
              ].filter(Boolean))} />
          ))}
          {xTicks.map((t, i) => (
            <g key={i}>
              <line x1={xS(t)} x2={xS(t)} y1={ph} y2={ph + 4} stroke="#3A353F" />
              <text x={xS(t)} y={ph + 16} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#8A8590">{fmtDate(t)}</text>
              <text x={xS(t)} y={ph + 28} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={8} fill="#6C6772">{new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text>
            </g>
          ))}
          <line x1={0} x2={pw} y1={ph} y2={ph} stroke="#3A353F" />
        </g>
      </svg>
    </div>
  );
}

// ============================================================================
// Cumulative balance
// ============================================================================
function CumulativeBalance({ series }: { series: DayPoint[] }) {
  const { ref, w: W } = useChartWidth();
  const H = 240, P = { l: 64, r: 16, t: 14, b: 36 };
  const pw = Math.max(40, W - P.l - P.r), ph = H - P.t - P.b;
  if (series.length === 0) return <div ref={ref}><Empty /></div>;
  let bal = 0;
  const pts = series.map((p) => { bal += p.net; return { ts: p.ts, day: p.day, bal }; });
  const yMin = Math.min(0, ...pts.map((p) => p.bal));
  const yMax = Math.max(0, ...pts.map((p) => p.bal));
  const ySpan = yMax - yMin || 1;
  const tMin = pts[0].ts, tSpan = Math.max(1, pts[pts.length - 1].ts - tMin);
  const xS = (t: number) => series.length === 1 ? pw / 2 : ((t - tMin) / tSpan) * pw;
  const yS = (v: number) => ph - ((v - yMin) / ySpan) * ph;
  const yTicks = niceTicks(yMin, yMax, 5);
  const xTicks = pickXTicks(pts.map((p) => p.ts), 8);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xS(p.ts)} ${yS(p.bal)}`).join(" ");
  const area = `${path} L ${xS(pts[pts.length - 1].ts)} ${yS(0)} L ${xS(pts[0].ts)} ${yS(0)} Z`;
  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g transform={`translate(${P.l},${P.t})`}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={pw} y1={yS(v)} y2={yS(v)} stroke={v === 0 ? "#3A353F" : "#2B262E"} strokeDasharray={v === 0 ? "" : "2 4"} />
              <text x={-6} y={yS(v) + 3} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#6C6772">{compactInr(v)}</text>
            </g>
          ))}
          <path d={area} fill={NET_COLOR} fillOpacity={0.18} />
          <path d={path} fill="none" stroke={NET_COLOR} strokeWidth={2} />
          {pts.map((p, i) => (
            <circle key={i} cx={xS(p.ts)} cy={yS(p.bal)} r={2.6} fill={NET_COLOR} className="cursor-pointer"
              onClick={(e) => onPin(e, [p.day, `Cumulative ${inrFull(p.bal)}`])} />
          ))}
          {xTicks.map((t, i) => (
            <g key={i}>
              <line x1={xS(t)} x2={xS(t)} y1={ph} y2={ph + 4} stroke="#3A353F" />
              <text x={xS(t)} y={ph + 16} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#8A8590">{fmtDate(t)}</text>
            </g>
          ))}
          <line x1={0} x2={pw} y1={ph} y2={ph} stroke="#3A353F" />
        </g>
      </svg>
    </div>
  );
}

// ============================================================================
// Day-of-week bars (IN + OUT side by side, Sun–Sat)
// ============================================================================
function DayOfWeekBars({ txns }: { txns: TxnRow[] }) {
  const { ref, w: W } = useChartWidth();
  const H = 240, P = { l: 64, r: 16, t: 14, b: 36 };
  const pw = Math.max(40, W - P.l - P.r), ph = H - P.t - P.b;
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const tot: { in: number; out: number; count: number }[] = labels.map(() => ({ in: 0, out: 0, count: 0 }));
  for (const t of txns) {
    const d = new Date(t.timestamp); if (isNaN(d.getTime())) continue;
    const dow = d.getDay();
    if (t.direction === "IN") tot[dow].in += t.amount; else tot[dow].out += t.amount;
    tot[dow].count += 1;
  }
  const maxV = Math.max(1, ...tot.flatMap((x) => [x.in, x.out]));
  const bw = pw / 7 / 2 - 2;
  const yTicks = niceTicks(0, maxV, 5);
  const yS = (v: number) => ph - (v / maxV) * ph;
  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g transform={`translate(${P.l},${P.t})`}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={pw} y1={yS(v)} y2={yS(v)} stroke="#2B262E" strokeDasharray="2 4" />
              <text x={-6} y={yS(v) + 3} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#6C6772">{compactInr(v)}</text>
            </g>
          ))}
          {labels.map((l, i) => {
            const cx = (i + 0.5) * (pw / 7);
            const xIn = cx - bw - 1, xOut = cx + 1;
            const hIn = (tot[i].in / maxV) * ph, hOut = (tot[i].out / maxV) * ph;
            return (
              <g key={l}>
                <rect x={xIn}  y={ph - hIn}  width={bw} height={hIn}  fill={IN_COLOR}  fillOpacity={0.85}
                  className="cursor-pointer" onClick={(e) => onPin(e, [l, `IN  ${inrFull(tot[i].in)}`, `${tot[i].count} txns`])} />
                <rect x={xOut} y={ph - hOut} width={bw} height={hOut} fill={OUT_COLOR} fillOpacity={0.85}
                  className="cursor-pointer" onClick={(e) => onPin(e, [l, `OUT ${inrFull(tot[i].out)}`, `${tot[i].count} txns`])} />
                <text x={cx} y={ph + 16} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={10} fill="#A8A2B0">{l}</text>
              </g>
            );
          })}
          <line x1={0} x2={pw} y1={ph} y2={ph} stroke="#3A353F" />
        </g>
      </svg>
    </div>
  );
}

// ============================================================================
// Monthly totals bars
// ============================================================================
function MonthlyBars({ series }: { series: DayPoint[] }) {
  const { ref, w: W } = useChartWidth();
  const H = 240, P = { l: 64, r: 16, t: 14, b: 36 };
  const pw = Math.max(40, W - P.l - P.r), ph = H - P.t - P.b;
  const byMonth: Record<string, { in: number; out: number; ts: number }> = {};
  for (const p of series) {
    const d = new Date(p.ts); const key = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
    const ts = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    byMonth[key] ??= { in: 0, out: 0, ts };
    byMonth[key].in += p.in; byMonth[key].out += p.out;
  }
  const months = Object.keys(byMonth).sort();
  if (months.length === 0) return <div ref={ref}><Empty /></div>;
  const maxV = Math.max(1, ...months.flatMap((m) => [byMonth[m].in, byMonth[m].out]));
  const bw = pw / months.length / 2 - 2;
  const yTicks = niceTicks(0, maxV, 5);
  const yS = (v: number) => ph - (v / maxV) * ph;
  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g transform={`translate(${P.l},${P.t})`}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={pw} y1={yS(v)} y2={yS(v)} stroke="#2B262E" strokeDasharray="2 4" />
              <text x={-6} y={yS(v) + 3} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#6C6772">{compactInr(v)}</text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = (i + 0.5) * (pw / months.length);
            const hIn = (byMonth[m].in / maxV) * ph, hOut = (byMonth[m].out / maxV) * ph;
            return (
              <g key={m}>
                <rect x={cx - bw - 1} y={ph - hIn}  width={bw} height={hIn}  fill={IN_COLOR}  className="cursor-pointer"
                  onClick={(e) => onPin(e, [fmtMonth(byMonth[m].ts), `IN  ${inrFull(byMonth[m].in)}`])} />
                <rect x={cx + 1}       y={ph - hOut} width={bw} height={hOut} fill={OUT_COLOR} className="cursor-pointer"
                  onClick={(e) => onPin(e, [fmtMonth(byMonth[m].ts), `OUT ${inrFull(byMonth[m].out)}`])} />
                <text x={cx} y={ph + 16} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={9.5} fill="#A8A2B0">
                  {new Date(byMonth[m].ts).toLocaleDateString(undefined, { month: "short" })}
                </text>
                <text x={cx} y={ph + 28} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={8.5} fill="#6C6772">
                  {new Date(byMonth[m].ts).getUTCFullYear()}
                </text>
              </g>
            );
          })}
          <line x1={0} x2={pw} y1={ph} y2={ph} stroke="#3A353F" />
        </g>
      </svg>
    </div>
  );
}

// ============================================================================
// Hour-of-day distribution
// ============================================================================
function HourDistribution({ txns }: { txns: TxnRow[] }) {
  const { ref, w: W } = useChartWidth();
  const H = 240, P = { l: 56, r: 16, t: 14, b: 36 };
  const pw = Math.max(40, W - P.l - P.r), ph = H - P.t - P.b;
  const counts = Array(24).fill(0);
  for (const t of txns) { const d = new Date(t.timestamp); if (!isNaN(d.getTime())) counts[d.getHours()] += 1; }
  const maxV = Math.max(1, ...counts);
  const bw = pw / 24 - 2;
  const yTicks = niceTicks(0, maxV, 5);
  const yS = (v: number) => ph - (v / maxV) * ph;
  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g transform={`translate(${P.l},${P.t})`}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={pw} y1={yS(v)} y2={yS(v)} stroke="#2B262E" strokeDasharray="2 4" />
              <text x={-6} y={yS(v) + 3} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#6C6772">{v}</text>
            </g>
          ))}
          {counts.map((c, h) => (
            <g key={h}>
              <rect x={h * (pw / 24) + 1} y={ph - (c / maxV) * ph} width={bw} height={(c / maxV) * ph}
                fill={NEUTRAL_OR_RED(h)} fillOpacity={0.85} className="cursor-pointer"
                onClick={(e) => onPin(e, [`${String(h).padStart(2, "0")}:00 – ${String(h).padStart(2, "0")}:59`, `${c} transactions`])} />
              <text x={h * (pw / 24) + bw / 2 + 1} y={ph + 16} textAnchor="middle"
                fontFamily="JetBrains Mono, monospace" fontSize={8.5} fill="#8A8590">
                {String(h).padStart(2, "0")}
              </text>
            </g>
          ))}
          <line x1={0} x2={pw} y1={ph} y2={ph} stroke="#3A353F" />
        </g>
      </svg>
    </div>
  );
}
function NEUTRAL_OR_RED(h: number) { return h >= 0 && h < 6 ? "#E5247A" : "#7C8CF8"; }

// ============================================================================
// Calendar heatmap (GitHub-style: weeks as columns, days as rows)
// ============================================================================
function CalendarHeatmap({ series }: { series: DayPoint[] }) {
  const { ref, w: W } = useChartWidth();
  const H = 200, P = { l: 36, r: 16, t: 14, b: 16 };
  const pw = Math.max(40, W - P.l - P.r), ph = H - P.t - P.b;
  if (series.length === 0) return <div ref={ref}><Empty /></div>;
  // Build a continuous list of days from first to last
  const start = new Date(series[0].ts); const end = new Date(series[series.length - 1].ts);
  // start week on Sunday
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const days: { ts: number; vol: number; count: number }[] = [];
  const byTs: Record<number, { vol: number; count: number }> = {};
  for (const p of series) byTs[p.ts] = { vol: p.in + p.out, count: p.count };
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const ts = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    days.push({ ts, vol: byTs[ts]?.vol ?? 0, count: byTs[ts]?.count ?? 0 });
  }
  const weeks = Math.ceil(days.length / 7);
  const cellW = Math.max(8, Math.min(18, pw / weeks - 2));
  const cellH = Math.max(8, Math.min(18, ph / 7 - 2));
  const maxVol = Math.max(1, ...days.map((d) => d.vol));
  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g transform={`translate(${P.l},${P.t})`}>
          {days.map((d, i) => {
            const wk = Math.floor(i / 7), dow = i % 7;
            const op = d.vol === 0 ? 0.06 : 0.2 + (d.vol / maxVol) * 0.8;
            return (
              <rect key={i} x={wk * (cellW + 2)} y={dow * (cellH + 2)} width={cellW} height={cellH}
                fill={NET_COLOR} fillOpacity={op} rx={2} className="cursor-pointer"
                onClick={(e) => onPin(e, [new Date(d.ts).toLocaleDateString(), `${d.count} txn${d.count === 1 ? "" : "s"}`, `Volume ${inrFull(d.vol)}`])} />
            );
          })}
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((l, i) => (
            i % 2 === 1 && <text key={l} x={-6} y={i * (cellH + 2) + cellH * 0.7} textAnchor="end"
              fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#6C6772">{l}</text>
          ))}
        </g>
      </svg>
    </div>
  );
}

// ============================================================================
// Velocity (24h rolling txn count, computed per transaction)
// ============================================================================
function Velocity({ txns }: { txns: TxnRow[] }) {
  const { ref, w: W } = useChartWidth();
  const H = 240, P = { l: 56, r: 16, t: 14, b: 36 };
  const pw = Math.max(40, W - P.l - P.r), ph = H - P.t - P.b;
  const ts = txns.map((t) => new Date(t.timestamp).getTime()).filter((n) => !isNaN(n)).sort((a, b) => a - b);
  if (ts.length === 0) return <div ref={ref}><Empty /></div>;
  const window = 24 * 3600 * 1000;
  let lo = 0;
  const pts = ts.map((t, i) => {
    while (ts[lo] < t - window) lo += 1;
    return { ts: t, v: i - lo + 1 };
  });
  const maxV = Math.max(1, ...pts.map((p) => p.v));
  const tMin = pts[0].ts, tSpan = Math.max(1, pts[pts.length - 1].ts - tMin);
  const xS = (t: number) => pts.length === 1 ? pw / 2 : ((t - tMin) / tSpan) * pw;
  const yS = (v: number) => ph - (v / maxV) * ph;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xS(p.ts)} ${yS(p.v)}`).join(" ");
  const area = `${path} L ${xS(pts[pts.length - 1].ts)} ${ph} L ${xS(pts[0].ts)} ${ph} Z`;
  const yTicks = niceTicks(0, maxV, 5);
  const xTicks = pickXTicks(pts.map((p) => p.ts), 8);
  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g transform={`translate(${P.l},${P.t})`}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={pw} y1={yS(v)} y2={yS(v)} stroke="#2B262E" strokeDasharray="2 4" />
              <text x={-6} y={yS(v) + 3} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#6C6772">{v}</text>
            </g>
          ))}
          <path d={area} fill="#FF6D29" fillOpacity={0.15} />
          <path d={path} fill="none" stroke="#FF6D29" strokeWidth={1.8} />
          {pts.map((p, i) => (
            <circle key={i} cx={xS(p.ts)} cy={yS(p.v)} r={2.2} fill="#FF6D29" className="cursor-pointer"
              onClick={(e) => onPin(e, [fmtDateTime(p.ts), `${p.v} txns in prior 24h`])} />
          ))}
          {xTicks.map((t, i) => (
            <g key={i}>
              <line x1={xS(t)} x2={xS(t)} y1={ph} y2={ph + 4} stroke="#3A353F" />
              <text x={xS(t)} y={ph + 16} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#8A8590">{fmtDate(t)}</text>
            </g>
          ))}
          <line x1={0} x2={pw} y1={ph} y2={ph} stroke="#3A353F" />
        </g>
      </svg>
    </div>
  );
}

// ============================================================================
// Channel mix over time (stacked area per day, by channel)
// ============================================================================
function ChannelMixOverTime({ txns }: { txns: TxnRow[] }) {
  const { ref, w: W } = useChartWidth();
  const H = 260, P = { l: 56, r: 120, t: 14, b: 36 };
  const pw = Math.max(40, W - P.l - P.r), ph = H - P.t - P.b;
  const channels = Array.from(new Set(txns.map((t) => t.channel ?? "—"))).sort();
  const byDay: Record<string, Record<string, number>> = {};
  for (const t of txns) {
    const d = new Date(t.timestamp); if (isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    byDay[key] ??= {};
    byDay[key][t.channel ?? "—"] = (byDay[key][t.channel ?? "—"] ?? 0) + t.amount;
  }
  const days = Object.keys(byDay).sort();
  if (days.length === 0) return <div ref={ref}><Empty /></div>;
  const totals = days.map((d) => channels.reduce((s, c) => s + (byDay[d][c] ?? 0), 0));
  const maxV = Math.max(1, ...totals);
  const dayTs = days.map((d) => new Date(d + "T00:00:00Z").getTime());
  const tMin = dayTs[0], tSpan = Math.max(1, dayTs[dayTs.length - 1] - tMin);
  const xS = (t: number) => days.length === 1 ? pw / 2 : ((t - tMin) / tSpan) * pw;
  const yS = (v: number) => ph - (v / maxV) * ph;

  // build stacked paths
  const layers = channels.map((c, ci) => {
    const upper: [number, number][] = [];
    const lower: [number, number][] = [];
    days.forEach((d, di) => {
      let below = 0;
      for (let i = 0; i < ci; i++) below += byDay[d][channels[i]] ?? 0;
      const here = byDay[d][c] ?? 0;
      lower.push([xS(dayTs[di]), yS(below)]);
      upper.push([xS(dayTs[di]), yS(below + here)]);
    });
    const path = `M ${upper[0][0]} ${upper[0][1]} ${upper.slice(1).map((p) => `L ${p[0]} ${p[1]}`).join(" ")} ${lower.reverse().map((p) => `L ${p[0]} ${p[1]}`).join(" ")} Z`;
    return { c, path, color: ACCENTS[ci % ACCENTS.length] };
  });
  const yTicks = niceTicks(0, maxV, 5);
  const xTicks = pickXTicks(dayTs, 8);

  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g transform={`translate(${P.l},${P.t})`}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={pw} y1={yS(v)} y2={yS(v)} stroke="#2B262E" strokeDasharray="2 4" />
              <text x={-6} y={yS(v) + 3} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#6C6772">{compactInr(v)}</text>
            </g>
          ))}
          {layers.map((l) => <path key={l.c} d={l.path} fill={l.color} fillOpacity={0.78} />)}
          {xTicks.map((t, i) => (
            <g key={i}>
              <line x1={xS(t)} x2={xS(t)} y1={ph} y2={ph + 4} stroke="#3A353F" />
              <text x={xS(t)} y={ph + 16} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#8A8590">{fmtDate(t)}</text>
            </g>
          ))}
          <line x1={0} x2={pw} y1={ph} y2={ph} stroke="#3A353F" />
        </g>
        <g transform={`translate(${W - P.r + 12},${P.t})`}>
          {channels.map((c, i) => (
            <g key={c} transform={`translate(0,${i * 16})`}>
              <rect width={10} height={10} rx={2} fill={ACCENTS[i % ACCENTS.length]} />
              <text x={16} y={9} fontFamily="JetBrains Mono, monospace" fontSize={10} fill="#D8D4DC">{c}</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

// ============================================================================
// Largest vs typical (box-plot style + dot strip)
// ============================================================================
function BoxLikePlot({ txns }: { txns: TxnRow[] }) {
  const { ref, w: W } = useChartWidth();
  const H = 200, P = { l: 64, r: 16, t: 14, b: 36 };
  const pw = Math.max(40, W - P.l - P.r), ph = H - P.t - P.b;
  const amounts = txns.map((t) => t.amount).filter((a) => a > 0).sort((a, b) => a - b);
  if (amounts.length === 0) return <div ref={ref}><Empty /></div>;
  const q = (p: number) => amounts[Math.min(amounts.length - 1, Math.max(0, Math.floor(p * (amounts.length - 1))))];
  const q1 = q(0.25), median = q(0.5), q3 = q(0.75);
  const minA = amounts[0], maxA = amounts[amounts.length - 1];
  const iqr = q3 - q1;
  const whiskerHi = Math.min(maxA, q3 + 1.5 * iqr);

  const yS = (v: number) => ph - (Math.log10(Math.max(1, v)) / Math.log10(Math.max(10, maxA))) * ph;
  const cx = pw / 4;
  const yTicks = [1e3, 1e4, 1e5, 1e6, 1e7].filter((v) => v <= maxA * 2);
  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g transform={`translate(${P.l},${P.t})`}>
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={0} x2={pw} y1={yS(v)} y2={yS(v)} stroke="#2B262E" strokeDasharray="2 4" />
              <text x={-6} y={yS(v) + 3} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#6C6772">{compactInr(v)}</text>
            </g>
          ))}
          {/* whisker */}
          <line x1={cx} x2={cx} y1={yS(whiskerHi)} y2={yS(minA)} stroke="#7C8CF8" strokeWidth={1} />
          {/* box */}
          <rect x={cx - 18} y={yS(q3)} width={36} height={yS(q1) - yS(q3)} fill="#7C8CF8" fillOpacity={0.2} stroke="#7C8CF8" />
          {/* median */}
          <line x1={cx - 18} x2={cx + 18} y1={yS(median)} y2={yS(median)} stroke="#7C8CF8" strokeWidth={2} />
          {/* outliers above the whisker */}
          {amounts.filter((a) => a > whiskerHi).map((a, i) => (
            <circle key={i} cx={cx + 50 + (i % 8) * 8} cy={yS(a)} r={3} fill="#E5247A" className="cursor-pointer"
              onClick={(e) => onPin(e, [`Outlier`, inrFull(a)])} />
          ))}
          <text x={cx} y={ph + 16} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={9.5} fill="#A8A2B0">Q1–Q3 box · whisker · pink dots = outliers</text>
          {/* annotations */}
          <text x={cx + 24} y={yS(median) + 3} fontFamily="JetBrains Mono, monospace" fontSize={9.5} fill="#D8D4DC">median {inrFull(median)}</text>
          <text x={cx + 24} y={yS(q3) - 2} fontFamily="JetBrains Mono, monospace" fontSize={9.5} fill="#A8A2B0">Q3 {inrFull(q3)}</text>
          <text x={cx + 24} y={yS(q1) + 10} fontFamily="JetBrains Mono, monospace" fontSize={9.5} fill="#A8A2B0">Q1 {inrFull(q1)}</text>
        </g>
      </svg>
    </div>
  );
}

// ============================================================================
// Top 10 largest transactions table
// ============================================================================
function TopTransactionsTable({ txns }: { txns: TxnRow[] }) {
  const top = txns.slice().sort((a, b) => b.amount - a.amount).slice(0, 10);
  if (top.length === 0) return <Empty />;
  return (
    <div className="space-y-1.5">
      {top.map((t, i) => (
        <div key={i}
          className="flex items-center gap-3 text-[12px] py-1.5 border-b border-line/30 cursor-pointer hover:bg-ink-700/40"
          onClick={(e) => onPin(e, [fmtDateTime(new Date(t.timestamp).getTime()), `${t.direction ?? ""} ${inrFull(t.amount)}`,
            t.counterparty ? `with ${t.counterparty}` : "", t.channel ? `via ${t.channel}` : ""].filter(Boolean))}>
          <span className="font-mono text-[10px] text-ash-500 w-5">{i + 1}</span>
          <span className={`font-mono text-[10px] px-1 py-0.5 rounded ${t.direction === "IN" ? "text-jade-400 bg-jade-500/10" : "text-flame-400 bg-flame-500/10"}`}>{t.direction ?? ""}</span>
          <span className="font-mono tnum text-[11px] text-ash-100 flex-1 truncate">{t.counterparty ?? "—"}</span>
          <span className="font-mono text-[10px] text-ash-500">{t.channel ?? ""}</span>
          <span className="font-mono text-[10px] text-ash-500 w-44 text-right">{fmtDateTime(new Date(t.timestamp).getTime())}</span>
          <span className="font-mono tnum text-ash-100 w-28 text-right">{inrFull(t.amount)}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Average transaction size over time
// ============================================================================
function AvgSizeOverTime({ series, txns }: { series: DayPoint[]; txns: TxnRow[] }) {
  const { ref, w: W } = useChartWidth();
  const H = 240, P = { l: 64, r: 16, t: 14, b: 36 };
  const pw = Math.max(40, W - P.l - P.r), ph = H - P.t - P.b;
  // recompute avg per day from raw txns (use the count from series for the divisor)
  const byDay: Record<string, { total: number; count: number; ts: number }> = {};
  for (const t of txns) {
    const d = new Date(t.timestamp); if (isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    const ts = new Date(key + "T00:00:00Z").getTime();
    byDay[key] ??= { total: 0, count: 0, ts };
    byDay[key].total += t.amount; byDay[key].count += 1;
  }
  const days = Object.keys(byDay).sort();
  if (days.length === 0) return <div ref={ref}><Empty /></div>;
  const pts = days.map((d) => ({ ts: byDay[d].ts, day: d, avg: byDay[d].total / byDay[d].count, n: byDay[d].count }));
  const maxV = Math.max(1, ...pts.map((p) => p.avg));
  const tMin = pts[0].ts, tSpan = Math.max(1, pts[pts.length - 1].ts - tMin);
  const xS = (t: number) => pts.length === 1 ? pw / 2 : ((t - tMin) / tSpan) * pw;
  const yS = (v: number) => ph - (v / maxV) * ph;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xS(p.ts)} ${yS(p.avg)}`).join(" ");
  const yTicks = niceTicks(0, maxV, 5);
  const xTicks = pickXTicks(pts.map((p) => p.ts), 8);
  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g transform={`translate(${P.l},${P.t})`}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={pw} y1={yS(v)} y2={yS(v)} stroke="#2B262E" strokeDasharray="2 4" />
              <text x={-6} y={yS(v) + 3} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#6C6772">{compactInr(v)}</text>
            </g>
          ))}
          <path d={path} fill="none" stroke="#42C9C2" strokeWidth={1.8} />
          {pts.map((p, i) => (
            <circle key={i} cx={xS(p.ts)} cy={yS(p.avg)} r={2.6} fill="#42C9C2" className="cursor-pointer"
              onClick={(e) => onPin(e, [p.day, `Avg ${inrFull(p.avg)}`, `${p.n} txn${p.n === 1 ? "" : "s"}`])} />
          ))}
          {xTicks.map((t, i) => (
            <g key={i}>
              <line x1={xS(t)} x2={xS(t)} y1={ph} y2={ph + 4} stroke="#3A353F" />
              <text x={xS(t)} y={ph + 16} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#8A8590">{fmtDate(t)}</text>
            </g>
          ))}
          <line x1={0} x2={pw} y1={ph} y2={ph} stroke="#3A353F" />
        </g>
      </svg>
    </div>
  );
}

// ============================================================================
// Transaction count per day
// ============================================================================
function CountOverTime({ series }: { series: DayPoint[] }) {
  const { ref, w: W } = useChartWidth();
  const H = 220, P = { l: 56, r: 16, t: 14, b: 36 };
  const pw = Math.max(40, W - P.l - P.r), ph = H - P.t - P.b;
  if (series.length === 0) return <div ref={ref}><Empty /></div>;
  const maxV = Math.max(1, ...series.map((p) => p.count));
  const tMin = series[0].ts, tSpan = Math.max(1, series[series.length - 1].ts - tMin);
  const xS = (t: number) => series.length === 1 ? pw / 2 : ((t - tMin) / tSpan) * pw;
  const yS = (v: number) => ph - (v / maxV) * ph;
  const bw = Math.max(2, pw / series.length - 1);
  const yTicks = niceTicks(0, maxV, 5);
  const xTicks = pickXTicks(series.map((p) => p.ts), 8);
  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g transform={`translate(${P.l},${P.t})`}>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={pw} y1={yS(v)} y2={yS(v)} stroke="#2B262E" strokeDasharray="2 4" />
              <text x={-6} y={yS(v) + 3} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#6C6772">{v}</text>
            </g>
          ))}
          {series.map((p, i) => (
            <rect key={i} x={xS(p.ts) - bw / 2} y={yS(p.count)} width={bw} height={ph - yS(p.count)}
              fill="#925CE6" fillOpacity={0.85} className="cursor-pointer"
              onClick={(e) => onPin(e, [p.day, `${p.count} transaction${p.count === 1 ? "" : "s"}`])} />
          ))}
          {xTicks.map((t, i) => (
            <g key={i}>
              <line x1={xS(t)} x2={xS(t)} y1={ph} y2={ph + 4} stroke="#3A353F" />
              <text x={xS(t)} y={ph + 16} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#8A8590">{fmtDate(t)}</text>
            </g>
          ))}
          <line x1={0} x2={pw} y1={ph} y2={ph} stroke="#3A353F" />
        </g>
      </svg>
    </div>
  );
}

// ============================================================================
// Layout primitives
// ============================================================================
function Section({ title, open, onToggle, count, children }: {
  title: string; open: boolean; onToggle: () => void; count: number; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-ink-800 overflow-hidden">
      <button onClick={onToggle} className="w-full px-4 py-3 flex items-center justify-between hover:bg-ink-700 transition-colors">
        <div className="flex items-center gap-3">
          <span className={`text-ash-500 text-[10px] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          <span className="font-display text-[15px] text-ash-100">{title}</span>
          <span className="text-[10px] font-mono text-ash-500">· {count} chart{count === 1 ? "" : "s"}</span>
        </div>
      </button>
      {open && <div className="border-t border-line/40 p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">{children}</div>}
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-ink-900/40 p-4">
      <div className="mb-3">
        <div className="font-display text-[13px] text-ash-100">{title}</div>
        <div className="text-[11px] text-ash-500 mt-0.5 leading-relaxed">{subtitle}</div>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function KPI({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-line bg-ink-800 px-4 py-2.5 text-center min-w-[110px]">
      <div className="font-display text-[18px]" style={{ color: accent }}>{value}</div>
      <div className="text-[10px] font-mono text-ash-500 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-3">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} />
          <span className="text-ash-300">{it.label}</span>
        </span>
      ))}
    </div>
  );
}

function Empty() {
  return <div className="text-[12px] font-mono text-ash-500 py-8 text-center">No data for this chart.</div>;
}