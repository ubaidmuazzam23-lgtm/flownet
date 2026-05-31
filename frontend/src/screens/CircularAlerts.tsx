// frontend/src/screens/CircularAlerts.tsx
import { useMemo, useState } from "react";
import { useCycles } from "../hooks/useGraph";
import type { Cycle, GraphEdge } from "../hooks/useGraph";
import { ForceGraph } from "../components/ForceGraph";
import { ReportButton } from "../components/ReportButton";
import { inr, inrFull } from "../lib/format";
import { Loading } from "../components/states/Loading";
import { ErrorState } from "../components/states/ErrorState";

type SortKey = "amount" | "speed" | "similarity";

export default function CircularAlerts() {
  const { data, loading, error } = useCycles(true);
  const [sort, setSort] = useState<SortKey>("amount");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const sorted = useMemo(() => {
    const list = (data?.cycles ?? []).slice();
    if (sort === "amount") list.sort((a, b) => b.amount - a.amount);
    if (sort === "speed") list.sort((a, b) => (a.duration_hours ?? 1e9) - (b.duration_hours ?? 1e9));
    if (sort === "similarity") list.sort((a, b) => b.similarity - a.similarity);
    return list;
  }, [data, sort]);

  const stats = useMemo(() => {
    const list = data?.cycles ?? [];
    if (list.length === 0) return null;
    const totalMoved = list.reduce((s, c) => s + c.amount, 0);
    const fastest = list.reduce<Cycle | null>((best, c) => {
      if (c.duration_hours == null) return best;
      if (!best || (best.duration_hours ?? 1e9) > c.duration_hours) return c;
      return best;
    }, null);
    const biggest = list.reduce<Cycle | null>((best, c) => !best || c.amount > best.amount ? c : best, null);
    return { totalMoved, fastest, biggest };
  }, [data]);

  if (loading) return <Loading label="Scanning the transaction graph for circular flows…" />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  return (
    <div className="flex-1 overflow-auto no-scrollbar">
      <div className="px-8 pt-6 pb-4 border-b border-line">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-[26px] tracking-tight">Circular Transactions · AML</h1>
            <p className="text-[13px] text-ash-400 mt-1 max-w-2xl">
              Money that returns to its origin through a chain of intermediary accounts — a textbook laundering pattern.
              Detected from real transactions using flow-continuity analysis (similar amounts, short durations).
            </p>
          </div>
          <Severity total={data.total} />
        </div>

        {stats && (
          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI label="Loops detected" value={String(data.total)} accent="#925CE6" />
            <KPI label="Total moved" value={inr(stats.totalMoved)} accent="#925CE6" />
            <KPI label="Fastest loop"
              value={stats.fastest?.duration_hours != null ? formatDur(stats.fastest.duration_hours) : "—"}
              sub={stats.fastest ? `${stats.fastest.hops} hops` : ""} accent="#FF6D29" />
            <KPI label="Biggest loop"
              value={stats.biggest ? inr(stats.biggest.amount) : "—"}
              sub={stats.biggest ? `${stats.biggest.hops} hops` : ""} accent="#FF6D29" />
          </div>
        )}

        <div className="mt-5 flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-ash-500 mr-1">Sort by</span>
          <SortBtn on={sort === "amount"} onClick={() => setSort("amount")}>Amount</SortBtn>
          <SortBtn on={sort === "speed"} onClick={() => setSort("speed")}>Speed</SortBtn>
          <SortBtn on={sort === "similarity"} onClick={() => setSort("similarity")}>Similarity</SortBtn>
        </div>
      </div>

      <div className="px-6 py-5 space-y-3 max-w-5xl">
        {sorted.length === 0 ? (
          <div className="text-center text-ash-500 mt-12">No circular flows detected in the current data.</div>
        ) : (
          sorted.map((c, i) => (
            <LoopCard key={i} cycle={c} index={i + 1}
              expanded={expanded.has(i)}
              onToggle={() => {
                const next = new Set(expanded);
                next.has(i) ? next.delete(i) : next.add(i);
                setExpanded(next);
              }} />
          ))
        )}
      </div>
    </div>
  );
}

function LoopCard({ cycle, index, expanded, onToggle }: {
  cycle: Cycle; index: number; expanded: boolean; onToggle: () => void;
}) {
  const sev = severity(cycle);
  const dur = cycle.duration_hours != null ? formatDur(cycle.duration_hours) : null;
  const story = buildStory(cycle);

  return (
    <div className="rounded-xl border border-line bg-ink-800 overflow-hidden">
      <button onClick={onToggle} className="w-full text-left p-4 hover:bg-ink-700 transition-colors">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-orchid-400">LOOP #{index}</span>
            <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded`}
              style={{ background: sev.color + "1A", color: sev.color, border: `1px solid ${sev.color}44` }}>
              {sev.label}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-ash-400">
            <Tag>{cycle.hops} hops</Tag>
            <Tag>~{Math.round((cycle.similarity ?? 0) * 100)}% similar</Tag>
            {dur && <Tag highlight={cycle.fast}>{dur}{cycle.fast ? " · fast" : ""}</Tag>}
            <Tag highlight>{inr(cycle.amount)} moved</Tag>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-ash-200 leading-relaxed">{story}</p>
        <div className="mt-2 text-[10px] font-mono text-ash-500">
          {expanded ? "▾ Hide per-hop details" : "▸ Show per-hop details"}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-line/60 bg-ink-900/50">
          {/* graph visualization of THIS loop */}
          <div className="h-[340px] border-b border-line/40 relative">
            <CycleGraph cycle={cycle} />
          </div>
          <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-ash-500">
              Real transfers · in order
            </div>
            <ReportButton
              path={`/reports/cycle`}
              body={{
                path: cycle.path,
                edges: cycle.edges,
                amount: cycle.amount,
                hops: cycle.hops,
                similarity: cycle.similarity,
                duration_hours: cycle.duration_hours,
                fast: cycle.fast,
              }}
              filename={`FlowNet-STR-Cycle-${cycle.path[0]?.account_id || "loop"}.pdf`}
              size="sm"
            />
          </div>
          <div className="space-y-1.5">
            {cycle.edges.map((e, i) => {
              const fromName = nameFor(cycle, e.source);
              const toName = nameFor(cycle, e.target);
              return (
                <div key={i} className="flex items-center gap-3 text-[12px] py-1.5 border-b border-line/30">
                  <span className="font-mono text-[10px] text-ash-500 w-5">{i + 1}</span>
                  <span className="text-ash-100 flex-1 truncate">
                    {fromName}
                    <span className="text-orchid-400 mx-1.5">→</span>
                    {toName}
                  </span>
                  <span className="font-mono text-[10px] text-ash-500">{e.channel ?? ""}</span>
                  <span className="font-mono text-[10px] text-ash-500 w-32 text-right">
                    {e.timestamp ? new Date(e.timestamp).toLocaleString() : ""}
                  </span>
                  <span className="font-mono tnum text-ash-100 w-24 text-right">{inrFull(e.amount)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[11px] text-ash-500 leading-relaxed">
            <strong className="text-ash-300">How it was performed:</strong> the same value moved through {cycle.hops} hops,
            keeping each hop within ~{Math.round((cycle.similarity ?? 0) * 100)}% of the incoming amount
            {dur ? `, closing the loop in ${dur}` : ""}. This is the AML signature
            described in the spec: <em>"funds return to the original source through intermediary accounts with similar
            amounts and short durations."</em>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}



function CycleGraph({ cycle }: { cycle: Cycle }) {
  // compute the closing edge so it renders dark red, like the Graph View circular mode
  const path = cycle.path;
  const closingEdge =
    path.length >= 2
      ? `${path[path.length - 1].account_id}->${path[0].account_id}`
      : null;
  // ensure the edges array carries the closing hop too (cycle.edges already does in v2)
  const edges: GraphEdge[] = cycle.edges;
  return (
    <ForceGraph
      nodes={cycle.nodes}
      edges={edges}
      circularMode={true}
      closingEdge={closingEdge}
    />
  );
}

// ---- helpers ----
function buildStory(c: Cycle): string {
  const names = c.path.map((s) => s.actor ?? `…${s.account_id.slice(-4)}`);
  // unique sequence (drop closing repeat for the sentence)
  const seq = names[0] === names[names.length - 1] ? names.slice(0, -1) : names;
  const dur = c.duration_hours != null ? formatDur(c.duration_hours) : null;
  const sim = Math.round((c.similarity ?? 0) * 100);
  return `Money cycled through ${seq.join(" → ")} and returned to ${seq[0]}` +
    `, ${inr(c.amount)} moving across ${c.hops} hops` +
    (dur ? ` over ${dur}` : "") +
    `, with each transfer staying within ~${sim}% of the prior amount.`;
}

function nameFor(c: Cycle, accountId: string): string {
  const hit = c.nodes.find((n) => n.id === accountId);
  if (hit?.actor) return hit.actor;
  const step = c.path.find((s) => s.account_id === accountId);
  return step?.actor ?? `…${accountId.slice(-4)}`;
}

function severity(c: Cycle): { label: string; color: string } {
  const fast = c.fast;
  const big = c.amount >= 100000;          // ≥ 1 lakh
  const tight = (c.similarity ?? 0) >= 0.9; // amounts very near each other
  if (fast && big && tight) return { label: "CRITICAL", color: "#E5484D" };
  if ((fast && big) || (fast && tight) || (big && tight)) return { label: "HIGH", color: "#FF6D29" };
  return { label: "MEDIUM", color: "#FFC542" };
}

function formatDur(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function KPI({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="rounded-xl border border-line bg-ink-800 px-4 py-3">
      <div className="text-[9px] font-mono uppercase tracking-wider text-ash-500">{label}</div>
      <div className="font-display text-[20px] mt-1" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-[10px] font-mono text-ash-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Severity({ total }: { total: number }) {
  return (
    <div className="rounded-xl border border-orchid-500/40 bg-orchid-500/10 px-4 py-2">
      <div className="font-display text-[22px] text-orchid-400 text-center">{total}</div>
      <div className="text-[10px] font-mono text-ash-400 uppercase tracking-wider">Active loops</div>
    </div>
  );
}

function SortBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`text-[12px] px-2.5 py-1 rounded-md border transition-colors ${
        on ? "border-flame-500 bg-flame-500/10 text-ash-100" : "border-line bg-ink-800 text-ash-400 hover:text-ash-200"
      }`}>{children}</button>
  );
}

function Tag({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <span className={`px-1.5 py-0.5 rounded border ${
      highlight ? "border-orchid-500/40 bg-orchid-500/10 text-orchid-400" : "border-line bg-ink-900 text-ash-300"
    }`}>
      {children}
    </span>
  );
}