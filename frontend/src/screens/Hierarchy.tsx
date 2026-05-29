// frontend/src/screens/Hierarchy.tsx
import { useMemo, useState } from "react";
import { useHierarchy } from "../hooks/useExplore";
import type { GraphNode, GraphEdge } from "../hooks/useGraph";
import { ForceGraph } from "../components/ForceGraph";
import { fraudStyle } from "../lib/fraudTypes";
import { Loading } from "../components/states/Loading";
import { ErrorState } from "../components/states/ErrorState";

const LEVEL = {
  region: { color: "#7C8CF8", size: 16, tag: "REGION" },
  city:   { color: "#42C9C2", size: 13, tag: "CITY" },
  branch: { color: "#FFC542", size: 11, tag: "BRANCH" },
};

export default function Hierarchy() {
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [showAccounts, setShowAccounts] = useState(true);
  const { data, loading, error, reload } = useHierarchy(flaggedOnly);
  const [selected, setSelected] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    if (!data) return { nodes, edges };

    data.regions.forEach((r) => {
      const rId = "r:" + r.region;
      nodes.push({ id: rId, actor: r.region, branch: null, fraud_type: null, confidence: null,
        ovColor: LEVEL.region.color, ovLabel: r.region, ovSize: LEVEL.region.size, ovTag: LEVEL.region.tag });

      r.cities.forEach((c) => {
        const cId = "c:" + r.region + ":" + c.city;
        nodes.push({ id: cId, actor: c.city, branch: null, fraud_type: null, confidence: null,
          ovColor: LEVEL.city.color, ovLabel: c.city, ovSize: LEVEL.city.size, ovTag: LEVEL.city.tag });
        edges.push({ source: rId, target: cId, amount: 0, channel: null, timestamp: null });

        c.branches.forEach((b) => {
          const bId = "b:" + (b.branch_id ?? b.branch);
          nodes.push({ id: bId, actor: b.branch, branch: null, fraud_type: null, confidence: null,
            ovColor: LEVEL.branch.color, ovLabel: b.branch, ovSize: LEVEL.branch.size, ovTag: LEVEL.branch.tag });
          edges.push({ source: cId, target: bId, amount: 0, channel: null, timestamp: null });

          if (showAccounts) {
            b.accounts.forEach((a) => {
              const aId = "a:" + a.account_id;
              const st = a.flagged && a.fraud_type ? fraudStyle(a.fraud_type) : null;
              nodes.push({
                id: aId, actor: a.holder ?? a.account_id.slice(-6), branch: b.branch,
                fraud_type: a.flagged ? a.fraud_type : null,
                confidence: a.confidence ?? null,
                ovColor: st ? st.color : "#4E4A55",
                ovLabel: a.holder ?? a.account_id.slice(-6),
                ovSize: a.flagged ? 8 : 5,
                ovTag: st ? st.label.toUpperCase() : null,
              });
              edges.push({ source: bId, target: aId, amount: 0, channel: null, timestamp: null });
            });
          }
        });
      });
    });
    return { nodes, edges };
  }, [data, showAccounts]);

  if (loading) return <Loading label="Mapping organisation hierarchy…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-8 pt-6 pb-4 border-b border-line shrink-0">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-[26px] tracking-tight">Organisation Hierarchy</h1>
            <p className="text-[13px] text-ash-400 mt-1">
              Region → City → Branch → Account as a live graph. Drag to move, scroll to zoom, click a node to inspect.
              Flagged accounts (model confidence ≥ 50%) are coloured by verdict.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Stat label="Accounts" value={data.total_accounts} />
            <Stat label="Flagged" value={data.total_flagged} danger />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <Toggle on={!flaggedOnly} onClick={() => setFlaggedOnly(false)} label="All accounts" />
          <Toggle on={flaggedOnly} onClick={() => setFlaggedOnly(true)} label="Flagged only" />
          <span className="w-px h-5 bg-line mx-1" />
          <Toggle on={showAccounts} onClick={() => setShowAccounts(true)} label="Show accounts" />
          <Toggle on={!showAccounts} onClick={() => setShowAccounts(false)} label="Structure only" />
          <div className="ml-3 flex items-center gap-3 text-[10px] font-mono text-ash-500">
            <Legend color={LEVEL.region.color} label="Region" />
            <Legend color={LEVEL.city.color} label="City" />
            <Legend color={LEVEL.branch.color} label="Branch" />
            <Legend color="#4E4A55" label="Account" />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <ForceGraph nodes={nodes} edges={edges} selectedId={selected} onSelect={setSelected} />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-ink-800 px-4 py-2 text-center">
      <div className={`font-display text-[20px] ${danger ? "text-danger-500" : "text-ash-100"}`}>{value}</div>
      <div className="text-[10px] font-mono text-ash-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`text-[12px] px-3 py-1.5 rounded-lg border transition-colors ${
        on ? "border-flame-500 bg-flame-500/10 text-ash-100" : "border-line bg-ink-800 text-ash-400 hover:text-ash-200"
      }`}>
      {label}
    </button>
  );
}