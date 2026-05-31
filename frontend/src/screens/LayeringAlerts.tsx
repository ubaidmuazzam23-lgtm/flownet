// frontend/src/screens/LayeringAlerts.tsx
import { useMemo, useState } from "react";
import { useLayeringAccounts, useNodeLayering } from "../hooks/useLayering";
import type { LayerAccount } from "../hooks/useLayering";
import type { GraphNode, GraphEdge } from "../hooks/useGraph";
import { ForceGraph } from "../components/ForceGraph";
import { ReportButton } from "../components/ReportButton";
import { inr, inrFull, shortTime } from "../lib/format";
import { Loading } from "../components/states/Loading";

type SortKey = "prob" | "count" | "amount";

export default function LayeringAlerts() {
  const { data, loading } = useLayeringAccounts();
  const [sort, setSort] = useState<SortKey>("prob");
  const [minProb, setMinProb] = useState<number>(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const list = (data?.accounts ?? []).filter((a) => a.max_prob * 100 >= minProb);
    if (sort === "prob")   list.sort((a, b) => b.max_prob - a.max_prob);
    if (sort === "count")  list.sort((a, b) => b.flagged_out - a.flagged_out);
    if (sort === "amount") list.sort((a, b) => b.total_amount - a.total_amount);
    return list;
  }, [data, sort, minProb]);

  const stats = useMemo(() => {
    const list = data?.accounts ?? [];
    if (list.length === 0) return null;
    const totalAmount = list.reduce((s, a) => s + a.total_amount, 0);
    const totalTxns = list.reduce((s, a) => s + a.flagged_out, 0);
    const maxProb = list.reduce((m, a) => Math.max(m, a.max_prob), 0);
    return { totalAmount, totalTxns, maxProb };
  }, [data]);

  if (loading) return <Loading label="Running the TGN over transactions…" />;
  if (!data) return null;

  return (
    <div className="flex-1 overflow-auto no-scrollbar">
      <div className="px-8 pt-6 pb-4 border-b border-line">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-[26px] tracking-tight">Rapid Layering · TGN</h1>
            <p className="text-[13px] text-ash-400 mt-1 max-w-2xl">
              Accounts whose outgoing transactions were flagged as layering by the Temporal Graph Network.
              Each transaction is scored by the model independently; we group them by source account here.
            </p>
            {!data.model_loaded && (
              <div className="mt-2 text-[12px] text-danger-500">TGN model not loaded on the backend.</div>
            )}
          </div>
          <Severity total={data.total} />
        </div>

        {stats && (
          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI label="Source accounts flagged" value={String(data.total)} accent="#E5247A" />
            <KPI label="Flagged transactions" value={String(stats.totalTxns)} accent="#E5247A" />
            <KPI label="Max probability" value={`${Math.round(stats.maxProb * 100)}%`}
                 sub={`threshold ${Math.round(data.threshold * 100)}%`} accent="#FF6D29" />
            <KPI label="Total flagged value" value={inr(stats.totalAmount)} accent="#FF6D29" />
          </div>
        )}

        <div className="mt-3 text-[10px] font-mono text-ash-500">
          Honest scope: the TGN was trained on 80 accounts. Only transactions whose both endpoints are in that
          trained set can be scored; the rest are not surfaced here.
        </div>

        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-wider text-ash-500 mr-1">Sort by</span>
          <SortBtn on={sort === "prob"}   onClick={() => setSort("prob")}>Probability</SortBtn>
          <SortBtn on={sort === "count"}  onClick={() => setSort("count")}>Transactions</SortBtn>
          <SortBtn on={sort === "amount"} onClick={() => setSort("amount")}>Amount</SortBtn>
          <span className="w-px h-5 bg-line mx-1" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-ash-500">Min probability</span>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={100} step={1} value={minProb}
              onChange={(e) => setMinProb(Number(e.target.value))}
              className="w-40 accent-flame-500"
            />
            <span className="text-[12px] font-mono tnum text-ash-200 w-10 text-right">{minProb}%</span>
            {minProb > 0 && (
              <button onClick={() => setMinProb(0)} className="text-[10px] font-mono text-ash-500 hover:text-ash-200">clear</button>
            )}
          </div>
          <span className="text-[10px] font-mono text-ash-500 ml-2">
            showing {sorted.length} of {data.accounts.length}
          </span>
        </div>
      </div>

      <div className="px-6 py-5 space-y-3 max-w-5xl">
        {sorted.length === 0 ? (
          <div className="text-center text-ash-500 mt-12">
            No transactions crossed the layering threshold in the scored set.
          </div>
        ) : (
          sorted.map((a) => (
            <LayerCard key={a.account_id} acc={a} threshold={data.threshold}
              expanded={expanded === a.account_id}
              onToggle={() => setExpanded(expanded === a.account_id ? null : a.account_id)} />
          ))
        )}
      </div>
    </div>
  );
}

function LayerCard({ acc, threshold, expanded, onToggle }:
  { acc: LayerAccount; threshold: number; expanded: boolean; onToggle: () => void }) {
  const sev = severity(acc, threshold);
  return (
    <div className="rounded-xl border border-line bg-ink-800 overflow-hidden">
      <button onClick={onToggle} className="w-full text-left p-4 hover:bg-ink-700 transition-colors">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono uppercase tracking-wider"
              style={{ color: "#E5247A" }}>TGN · LAYERING</span>
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: sev.color + "1A", color: sev.color, border: `1px solid ${sev.color}44` }}>
              {sev.label}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-ash-400">
            <Tag>{acc.flagged_out} txn{acc.flagged_out === 1 ? "" : "s"}</Tag>
            <Tag highlight>{Math.round(acc.max_prob * 100)}% top prob</Tag>
            <Tag highlight>{inr(acc.total_amount)}</Tag>
          </div>
        </div>
        <div className="mt-3">
          <div className="text-[10px] font-mono tnum text-ash-500">{acc.account_id}</div>
          <div className="text-[15px] text-ash-100 mt-0.5">{acc.actor ?? "Unknown"}</div>
        </div>
        <p className="mt-2 text-[12.5px] text-ash-400 leading-relaxed">
          Account <span className="font-mono tnum text-ash-200">{acc.account_id}</span>
          {acc.actor ? <> (<span className="text-ash-200">{acc.actor}</span>)</> : null} — the TGN flagged{" "}
          <strong className="text-ash-200">{acc.flagged_out}</strong> outgoing transaction{acc.flagged_out === 1 ? "" : "s"},
          strongest at <strong className="text-ash-200">{Math.round(acc.max_prob * 100)}%</strong> probability
          (threshold {Math.round(threshold * 100)}%), totalling{" "}
          <strong className="text-ash-200">{inr(acc.total_amount)}</strong> moved.
        </p>
        <div className="mt-2 text-[10px] font-mono text-ash-500">
          {expanded ? "▾ Hide flagged transactions" : "▸ Show flagged transactions"}
        </div>
      </button>

      {expanded && <LayerExpansion accountId={acc.account_id} accountActor={acc.actor} />}
    </div>
  );
}

function LayerExpansion({ accountId, accountActor }: { accountId: string; accountActor: string | null }) {
  const { data: node, loading, error } = useNodeLayering(accountId);

  if (loading || (!node && !error)) return (
    <div className="border-t border-line/60 px-4 py-6 bg-ink-900/50 text-center text-[12px] font-mono text-ash-500">
      Running TGN over transactions for this account…
    </div>
  );
  if (error) return (
    <div className="border-t border-line/60 px-4 py-4 bg-ink-900/50 text-[12px] text-danger-500">
      {error} — click the card again to retry.
    </div>
  );
  if (!node || node.flagged.length === 0) return (
    <div className="border-t border-line/60 px-4 py-4 bg-ink-900/50 text-[12px] text-ash-500">
      The TGN didn't flag any transactions for this account in the current scoring run.
      {node && !node.in_trained_scope ? " This account is outside the model's trained set of 80 accounts." : ""}
    </div>
  );

  // build star graph: center = this account, satellites = each flagged counterparty
  const nodes: GraphNode[] = [
    { id: accountId, actor: accountActor, branch: null, fraud_type: null, confidence: null,
      ovColor: "#E5247A", ovLabel: accountActor ?? accountId.slice(-6), ovSize: 12, ovTag: "SOURCE" },
  ];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  node.flagged.forEach((t) => {
    if (!seen.has(t.counterparty)) {
      seen.add(t.counterparty);
      nodes.push({
        id: t.counterparty,
        actor: null, branch: null, fraud_type: null, confidence: null,
        ovColor: "#FFAA33", ovLabel: t.counterparty.slice(-4),
        ovSize: 7, ovTag: null,
      });
    }
    const src = t.direction === "OUT" ? accountId : t.counterparty;
    const tgt = t.direction === "OUT" ? t.counterparty : accountId;
    edges.push({
      source: src, target: tgt, amount: t.amount,
      channel: t.channel, timestamp: t.timestamp,
    });
  });

  return (
    <div className="border-t border-line/60 bg-ink-900/50">
      <div className="h-[300px] border-b border-line/40 relative">
        <ForceGraph nodes={nodes} edges={edges} layeringMode={true} />
      </div>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ash-500">
            TGN-flagged transactions · sorted by probability
          </div>
          <ReportButton
            path={`/reports/layering/${accountId}`}
            filename={`FlowNet-STR-Layering-${accountId}.pdf`}
            size="sm"
          />
        </div>
        <div className="space-y-1.5">
          {node.flagged.map((t, i) => (
            <div key={i} className="flex items-center gap-3 text-[12px] py-1.5 border-b border-line/30">
              <span className="font-mono text-[10px] text-ash-500 w-5">{i + 1}</span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: "#E5247A1A", color: "#E5247A" }}>
                {Math.round(t.layering_prob * 100)}%
              </span>
              <span className={`font-mono text-[10px] px-1 py-0.5 rounded ${t.direction === "OUT" ? "text-flame-400 bg-flame-500/10" : "text-jade-400 bg-jade-500/10"}`}>{t.direction}</span>
              <span className="font-mono tnum text-[11px] text-ash-100 truncate min-w-[140px]">{t.counterparty}</span>
              <span className="font-mono text-[10px] text-ash-500">{t.channel ?? ""}</span>
              <span className="font-mono text-[10px] text-ash-500 w-32 text-right">
                {t.timestamp ? shortTime(t.timestamp) : ""}
              </span>
              <span className="font-mono tnum text-ash-100 w-24 text-right">{inrFull(t.amount)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[11px] text-ash-500 leading-relaxed">
          <strong className="text-ash-300">What the model saw:</strong> each transaction was scored independently by
          the Temporal Graph Network using 5 engineered features (amount, hour, weekend, fast-channel, API-channel)
          and the evolving memory of each account. Probabilities at or above
          {" "}{Math.round((node.threshold ?? 0.5) * 100)}% are flagged as likely layering.
        </div>
      </div>
    </div>
  );
}

// ---- helpers ----
function severity(a: LayerAccount, threshold: number): { label: string; color: string } {
  const big = a.total_amount >= 100000;
  const many = a.flagged_out >= 3;
  const strong = a.max_prob >= threshold + 0.05;
  if (big && many && strong) return { label: "CRITICAL", color: "#E5484D" };
  if ((big && many) || (big && strong) || (many && strong)) return { label: "HIGH", color: "#FF6D29" };
  return { label: "MEDIUM", color: "#FFC542" };
}

function KPI({ label, value, sub, accent }:
  { label: string; value: string; sub?: string; accent: string }) {
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
    <div className="rounded-xl border border-danger-500/40 bg-danger-500/10 px-4 py-2">
      <div className="font-display text-[22px] text-danger-500 text-center">{total}</div>
      <div className="text-[10px] font-mono text-ash-400 uppercase tracking-wider">Accounts</div>
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
      highlight ? "border-danger-500/40 bg-danger-500/10 text-danger-500" : "border-line bg-ink-900 text-ash-300"
    }`}>{children}</span>
  );
}