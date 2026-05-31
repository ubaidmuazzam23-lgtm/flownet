// frontend/src/screens/Dashboard.tsx
//
// Financial Crime Intelligence dashboard — 8 sections, ~20 widgets, real data.
// One backend call → /dashboard/summary returns everything.
//
// Style: matches the existing "forensic / dark navy" aesthetic. Tables on
// dark surface, thin lines, mono accents, click-throughs to drill into Alerts /
// Circular AML / Layering screens.
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------- type
type Summary = {
  generated_at: string;
  hero_kpis: {
    total_accounts: number; flagged_accounts: number; flagged_pct: number;
    active_investigations: number; circular_loops: number; tgn_layering_flags: number;
    total_volume_sampled_inr: number; sample_txn_count: number;
  };
  fraud_type_breakdown: { label: string; value: number }[];
  detection_source_mix: { label: string; value: number }[];
  severity_distribution: { label: string; value: number }[];
  daily_activity: { date: string; transactions: number; volume: number }[];
  detections_over_time: { date: string; flagged: number }[];
  branch_risk: { branch: string; total: number; flagged: number; pct: number }[];
  city_distribution: { city: string; flagged: number }[];
  region_distribution: { region: string; flagged: number }[];
  top_risk_accounts: { account_id: string; holder: string; fraud_type: string; confidence: number;
                       branch: string; in_cycle: boolean; tgn_flagged: boolean }[];
  recent_cycles: { origin_account: string; origin_holder: string; hops: number; amount: number;
                   similarity: number; duration_hours: number | null; fast: boolean }[];
  top_counterparties: { account_id: string; holder: string; branch: string;
                        total_volume: number; txn_count: number }[];
  most_connected_accounts: { account_id: string; holder: string; degree: number; flagged: boolean }[];
  channel_distribution: { channel: string; count: number }[];
  transaction_type_mix: { type: string; count: number }[];
  amount_distribution: { bucket: string; count: number }[];
  bilstm_confidence_distribution: { bucket: string; count: number }[];
  tgn_probability_distribution: { bucket: string; count: number }[];
  system_health: {
    bilstm_loaded: boolean; tgn_loaded: boolean; tgn_trained_accounts: number;
    cycle_engine_ready: boolean; neo4j_connected: boolean; supabase_connected: boolean;
  };
};

// ---------------------------------------------------------------- colors
const COLORS = {
  flame: "#FF6D29",
  amber: "#FFC542",
  azure: "#7C8CF8",
  teal: "#42C9C2",
  rose: "#FF6B7A",
  violet: "#B58CF8",
  green: "#42C97A",
  ash: "#6C6772",
};
const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#E5484D", High: "#FF6D29", Medium: "#FFC542", Low: "#42C97A",
};
const PIE_PALETTE = [COLORS.flame, COLORS.azure, COLORS.amber, COLORS.teal,
                     COLORS.violet, COLORS.rose, COLORS.green];

// ---------------------------------------------------------------- formatters
const inrK = (n: number) => {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${n.toFixed(0)}`;
};
const compact = (n: number) =>
  n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}k` : `${n}`;

// ---------------------------------------------------------------- atoms
function Section({ title, subtitle, children }:
  { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-3">
        <h2 className="text-[13px] font-mono uppercase tracking-[0.16em] text-ash-200">{title}</h2>
        {subtitle && <p className="text-[11px] text-ash-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function KpiCard({ label, value, sub, color = "text-ash-100", icon }:
  { label: string; value: string | number; sub?: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-ink-900 p-4 hover:border-flame-500/40 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-ash-500">{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-bold ${color} font-mono`}>{value}</div>
      {sub && <div className="text-[10px] text-ash-500 mt-1">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children, height = 220 }:
  { title: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="rounded-lg border border-line bg-ink-900 p-4">
      <div className="text-[11px] font-mono uppercase tracking-wider text-ash-500 mb-2">{title}</div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer>
      </div>
    </div>
  );
}

function TableCard({ title, children, footer }:
  { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-ink-900">
      <div className="px-4 py-3 border-b border-line">
        <div className="text-[11px] font-mono uppercase tracking-wider text-ash-500">{title}</div>
      </div>
      <div className="overflow-x-auto">
        {children}
      </div>
      {footer && <div className="px-4 py-2 border-t border-line text-[10px] text-ash-500 font-mono">{footer}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- screen
type NavFn = (route: string, params?: Record<string, string>) => void;

export default function Dashboard({ onNav }: { onNav?: NavFn }) {
  const { getToken } = useAuth();
  const navigate = (path: string) => {
    if (!onNav) return;
    // Parse paths like "/alerts?account=123" or "/circular-alerts" or "/analytics?account=456"
    const [base, query] = path.split("?");
    const route = base.replace(/^\//, "");
    const params: Record<string, string> = {};
    if (query) query.split("&").forEach((kv) => { const [k, v] = kv.split("="); if (k) params[k] = decodeURIComponent(v ?? ""); });
    onNav(route, params);
  };
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const t = await getToken();
        const res = await fetch(`${API}/dashboard/summary`, {
          headers: t ? { Authorization: `Bearer ${t}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j: Summary = await res.json();
        if (!cancel) setData(j);
      } catch (e: any) {
        if (!cancel) setErr(e?.message ?? "Failed to load");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [getToken]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-ash-500 font-mono text-sm">Loading dashboard… (aggregating real data across models)</div>
      </div>
    );
  }
  if (err) {
    return (
      <div className="p-6">
        <div className="text-danger-500 font-mono text-sm">Dashboard error: {err}</div>
      </div>
    );
  }
  if (!data) return null;

  const kpi = data.hero_kpis;
  const sh = data.system_health;

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ash-100">Financial Crime Intelligence</h1>
          <p className="text-[12px] text-ash-500 mt-1">
            Real-time view across BiLSTM account verdicts, TGN layering scores, and graph-based AML cycles.
            Generated {new Date(data.generated_at).toLocaleString()}.
          </p>
        </div>
        <SystemHealthStrip health={sh} />
      </header>

      {/* ROW 1 — HERO KPIs */}
      <Section title="At a Glance">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Total Accounts" value={compact(kpi.total_accounts)} />
          <KpiCard label="Flagged Accounts" value={compact(kpi.flagged_accounts)}
                   sub={`${kpi.flagged_pct}% of total`} color="text-flame-500" />
          <KpiCard label="Active Investigations" value={compact(kpi.active_investigations)}
                   sub="Across BiLSTM / TGN / Cycle" color="text-amber-400" />
          <KpiCard label="Circular Loops" value={compact(kpi.circular_loops)}
                   sub="Graph-detected AML cycles" color="text-rose-400" />
          <KpiCard label="TGN Layering Flags" value={compact(kpi.tgn_layering_flags)}
                   sub="Trained scope: 80 accounts" color="text-azure-400" />
          <KpiCard label="Volume Sampled" value={inrK(kpi.total_volume_sampled_inr)}
                   sub={`${compact(kpi.sample_txn_count)} txns`} />
        </div>
      </Section>

      {/* ROW 2 — COMPOSITION */}
      <Section title="Composition" subtitle="Breakdown of flagged activity by source and severity">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ChartCard title="Fraud Type Breakdown (BiLSTM)">
            <PieChart>
              <Pie data={data.fraud_type_breakdown} dataKey="value" nameKey="label"
                   innerRadius={45} outerRadius={75} paddingAngle={2}>
                {data.fraud_type_breakdown.map((_, i) => (
                  <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F",
                                       fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ChartCard>

          <ChartCard title="Detection Source Mix">
            <BarChart data={data.detection_source_mix} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid stroke="#1F1B23" strokeDasharray="2 3" />
              <XAxis type="number" stroke="#6C6772" fontSize={10} />
              <YAxis type="category" dataKey="label" stroke="#6C6772" fontSize={10} width={80} />
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F", fontSize: 11 }} />
              <Bar dataKey="value" fill={COLORS.azure} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ChartCard>

          <ChartCard title="Severity Distribution">
            <BarChart data={data.severity_distribution}>
              <CartesianGrid stroke="#1F1B23" strokeDasharray="2 3" />
              <XAxis dataKey="label" stroke="#6C6772" fontSize={10} />
              <YAxis stroke="#6C6772" fontSize={10} />
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F", fontSize: 11 }} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {data.severity_distribution.map((s, i) => (
                  <Cell key={i} fill={SEVERITY_COLORS[s.label] || COLORS.ash} />
                ))}
              </Bar>
            </BarChart>
          </ChartCard>
        </div>
      </Section>

      {/* ROW 3 — TEMPORAL */}
      <Section title="Temporal Activity">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ChartCard title={`Daily Transaction Activity (last ${data.daily_activity.length} days, sampled)`}>
            <LineChart data={data.daily_activity}>
              <CartesianGrid stroke="#1F1B23" strokeDasharray="2 3" />
              <XAxis dataKey="date" stroke="#6C6772" fontSize={9} interval="preserveStartEnd" />
              <YAxis stroke="#6C6772" fontSize={10} />
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F", fontSize: 11 }} />
              <Line type="monotone" dataKey="transactions" stroke={COLORS.flame} strokeWidth={2} dot={false} />
            </LineChart>
          </ChartCard>

          <ChartCard title="Flagged Activity Over Time (by most-recent-txn date)">
            <LineChart data={data.detections_over_time}>
              <CartesianGrid stroke="#1F1B23" strokeDasharray="2 3" />
              <XAxis dataKey="date" stroke="#6C6772" fontSize={9} interval="preserveStartEnd" />
              <YAxis stroke="#6C6772" fontSize={10} />
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F", fontSize: 11 }} />
              <Line type="monotone" dataKey="flagged" stroke={COLORS.rose} strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ChartCard>
        </div>
      </Section>

      {/* ROW 4 — GEO */}
      <Section title="Geographic Distribution">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ChartCard title="Branch Risk (% flagged)" height={Math.max(220, data.branch_risk.length * 22)}>
            <BarChart data={data.branch_risk.slice(0, 12)} layout="vertical" margin={{ left: 90 }}>
              <CartesianGrid stroke="#1F1B23" strokeDasharray="2 3" />
              <XAxis type="number" stroke="#6C6772" fontSize={10}
                     tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="branch" stroke="#6C6772" fontSize={9}
                     width={110} />
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F", fontSize: 11 }}
                       formatter={(v: any) => `${v}%`} />
              <Bar dataKey="pct" fill={COLORS.amber} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ChartCard>

          <ChartCard title="Top Cities (flagged count)">
            <BarChart data={data.city_distribution}>
              <CartesianGrid stroke="#1F1B23" strokeDasharray="2 3" />
              <XAxis dataKey="city" stroke="#6C6772" fontSize={9} angle={-30} textAnchor="end" height={50} />
              <YAxis stroke="#6C6772" fontSize={10} />
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F", fontSize: 11 }} />
              <Bar dataKey="flagged" fill={COLORS.teal} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartCard>

          <ChartCard title="Regions (flagged count)">
            <PieChart>
              <Pie data={data.region_distribution} dataKey="flagged" nameKey="region"
                   innerRadius={40} outerRadius={75} paddingAngle={2}>
                {data.region_distribution.map((_, i) => (
                  <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F", fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ChartCard>
        </div>
      </Section>

      {/* ROW 5 — INVESTIGATIONS */}
      <Section title="Investigation Surface" subtitle="Click any row to drill into the case">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <TableCard title="Top 10 High-Risk Accounts">
            <table className="w-full text-[11px] font-mono">
              <thead className="text-ash-500">
                <tr className="border-b border-line">
                  <th className="text-left px-3 py-2">Account</th>
                  <th className="text-left px-3 py-2">Holder</th>
                  <th className="text-left px-3 py-2">Verdict</th>
                  <th className="text-right px-3 py-2">Conf.</th>
                  <th className="text-center px-3 py-2">Cycle</th>
                  <th className="text-center px-3 py-2">TGN</th>
                </tr>
              </thead>
              <tbody>
                {data.top_risk_accounts.map((r) => (
                  <tr key={r.account_id}
                      onClick={() => navigate(`/alerts?account=${r.account_id}`)}
                      className="border-b border-line/40 hover:bg-flame-500/5 cursor-pointer">
                    <td className="px-3 py-2 text-ash-200">{String(r.account_id).slice(-9)}</td>
                    <td className="px-3 py-2 text-ash-200">{r.holder}</td>
                    <td className="px-3 py-2 text-flame-400">{r.fraud_type}</td>
                    <td className="px-3 py-2 text-right text-ash-200">{(r.confidence * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-center">{r.in_cycle ? "●" : "—"}</td>
                    <td className="px-3 py-2 text-center">{r.tgn_flagged ? "●" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>

          <TableCard title="Recent Circular AML Loops">
            <table className="w-full text-[11px] font-mono">
              <thead className="text-ash-500">
                <tr className="border-b border-line">
                  <th className="text-left px-3 py-2">Origin</th>
                  <th className="text-left px-3 py-2">Holder</th>
                  <th className="text-right px-3 py-2">Hops</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-right px-3 py-2">Sim.</th>
                  <th className="text-center px-3 py-2">Fast</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_cycles.map((c, i) => (
                  <tr key={i}
                      onClick={() => navigate("/circular-alerts")}
                      className="border-b border-line/40 hover:bg-flame-500/5 cursor-pointer">
                    <td className="px-3 py-2 text-ash-200">{String(c.origin_account).slice(-9)}</td>
                    <td className="px-3 py-2 text-ash-200">{c.origin_holder}</td>
                    <td className="px-3 py-2 text-right text-ash-200">{c.hops}</td>
                    <td className="px-3 py-2 text-right text-amber-400">{inrK(c.amount)}</td>
                    <td className="px-3 py-2 text-right text-ash-200">{c.similarity}%</td>
                    <td className="px-3 py-2 text-center">{c.fast ? "●" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </div>
      </Section>

      {/* ROW 6 — NETWORK */}
      <Section title="Counterparty Network">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <TableCard title="Top 10 Counterparties by Volume (sampled)">
            <table className="w-full text-[11px] font-mono">
              <thead className="text-ash-500">
                <tr className="border-b border-line">
                  <th className="text-left px-3 py-2">Account</th>
                  <th className="text-left px-3 py-2">Holder</th>
                  <th className="text-left px-3 py-2">Branch</th>
                  <th className="text-right px-3 py-2">Volume</th>
                  <th className="text-right px-3 py-2">Txns</th>
                </tr>
              </thead>
              <tbody>
                {data.top_counterparties.map((r) => (
                  <tr key={r.account_id}
                      onClick={() => navigate(`/analytics?account=${r.account_id}`)}
                      className="border-b border-line/40 hover:bg-flame-500/5 cursor-pointer">
                    <td className="px-3 py-2 text-ash-200">{String(r.account_id).slice(-9)}</td>
                    <td className="px-3 py-2 text-ash-200">{r.holder}</td>
                    <td className="px-3 py-2 text-ash-400">{r.branch}</td>
                    <td className="px-3 py-2 text-right text-amber-400">{inrK(r.total_volume)}</td>
                    <td className="px-3 py-2 text-right text-ash-200">{r.txn_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>

          <TableCard title="Most Connected Accounts (transaction degree)">
            <table className="w-full text-[11px] font-mono">
              <thead className="text-ash-500">
                <tr className="border-b border-line">
                  <th className="text-left px-3 py-2">Account</th>
                  <th className="text-left px-3 py-2">Holder</th>
                  <th className="text-right px-3 py-2">Degree</th>
                  <th className="text-center px-3 py-2">Flagged</th>
                </tr>
              </thead>
              <tbody>
                {data.most_connected_accounts.map((r) => (
                  <tr key={r.account_id}
                      onClick={() => navigate(`/analytics?account=${r.account_id}`)}
                      className="border-b border-line/40 hover:bg-flame-500/5 cursor-pointer">
                    <td className="px-3 py-2 text-ash-200">{String(r.account_id).slice(-9)}</td>
                    <td className="px-3 py-2 text-ash-200">{r.holder}</td>
                    <td className="px-3 py-2 text-right text-azure-400">{r.degree}</td>
                    <td className="px-3 py-2 text-center">{r.flagged ? <span className="text-flame-500">●</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </div>
      </Section>

      {/* ROW 7 — CHANNEL & TRANSACTION */}
      <Section title="Channel & Transaction Profile" subtitle="Sampled across the account population">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ChartCard title="Channel Distribution">
            <BarChart data={data.channel_distribution}>
              <CartesianGrid stroke="#1F1B23" strokeDasharray="2 3" />
              <XAxis dataKey="channel" stroke="#6C6772" fontSize={9} angle={-30} textAnchor="end" height={50} />
              <YAxis stroke="#6C6772" fontSize={10} />
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F", fontSize: 11 }} />
              <Bar dataKey="count" fill={COLORS.violet} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartCard>

          <ChartCard title="Transaction Type Mix">
            <BarChart data={data.transaction_type_mix}>
              <CartesianGrid stroke="#1F1B23" strokeDasharray="2 3" />
              <XAxis dataKey="type" stroke="#6C6772" fontSize={9} angle={-30} textAnchor="end" height={50} />
              <YAxis stroke="#6C6772" fontSize={10} />
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F", fontSize: 11 }} />
              <Bar dataKey="count" fill={COLORS.teal} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartCard>

          <ChartCard title="Amount Distribution (INR)">
            <BarChart data={data.amount_distribution}>
              <CartesianGrid stroke="#1F1B23" strokeDasharray="2 3" />
              <XAxis dataKey="bucket" stroke="#6C6772" fontSize={10} />
              <YAxis stroke="#6C6772" fontSize={10} />
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F", fontSize: 11 }} />
              <Bar dataKey="count" fill={COLORS.flame} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartCard>
        </div>
      </Section>

      {/* ROW 8 — MODEL OUTPUT */}
      <Section title="Model Output Analysis">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ChartCard title="BiLSTM Confidence on Flagged Accounts">
            <BarChart data={data.bilstm_confidence_distribution}>
              <CartesianGrid stroke="#1F1B23" strokeDasharray="2 3" />
              <XAxis dataKey="bucket" stroke="#6C6772" fontSize={10} />
              <YAxis stroke="#6C6772" fontSize={10} />
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F", fontSize: 11 }} />
              <Bar dataKey="count" fill={COLORS.flame} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartCard>

          <ChartCard title="TGN Layering Probability Distribution">
            <BarChart data={data.tgn_probability_distribution}>
              <CartesianGrid stroke="#1F1B23" strokeDasharray="2 3" />
              <XAxis dataKey="bucket" stroke="#6C6772" fontSize={10} />
              <YAxis stroke="#6C6772" fontSize={10} />
              <Tooltip contentStyle={{ background: "#0E0C0F", border: "1px solid #3A353F", fontSize: 11 }} />
              <Bar dataKey="count" fill={COLORS.azure} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartCard>
        </div>
      </Section>

      <footer className="text-[10px] font-mono text-ash-500 mt-8 pt-4 border-t border-line">
        Real data from Supabase + Neo4j + live model output. Some metrics are sampled across ~50-100 accounts
        for performance (see widget titles). Refresh the page to re-aggregate.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- system health
function SystemHealthStrip({ health: h }: { health: Summary["system_health"] }) {
  const item = (label: string, ok: boolean, sub?: string) => (
    <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-danger-500"}`} />
      <span className="text-[10px] font-mono uppercase tracking-wider text-ash-400">{label}</span>
      {sub && <span className="text-[10px] text-ash-500">· {sub}</span>}
    </div>
  );
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {item("BiLSTM", h.bilstm_loaded)}
      {item("TGN", h.tgn_loaded, h.tgn_trained_accounts ? `${h.tgn_trained_accounts} accts` : "")}
      {item("Cycle", h.cycle_engine_ready)}
      {item("Neo4j", h.neo4j_connected)}
      {item("Supabase", h.supabase_connected)}
    </div>
  );
}