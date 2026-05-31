// frontend/src/screens/Hierarchy.tsx
import { useMemo, useState, useEffect } from "react";
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
  owner:  { color: "#B58CF8", size: 9,  tag: "OWNER" },
};

export default function Hierarchy() {
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [showAccounts, setShowAccounts] = useState(true);
  const [showAllOwners, setShowAllOwners] = useState(false);  // global override
  const [revealedOwners, setRevealedOwners] = useState<Set<string>>(new Set());
  const [accountLimit, setAccountLimit] = useState<number | null>(25);  // null = all
  const { data, loading, error, reload } = useHierarchy(flaggedOnly);
  const [selected, setSelected] = useState<string | null>(null);


  // Click an account to reveal/hide its owner.
  useEffect(() => {
    if (!selected || !selected.startsWith("a:")) return;
    const accId = selected.slice(2);
    setRevealedOwners((prev) => {
      const next = new Set(prev);
      if (next.has(accId)) next.delete(accId); else next.add(accId);
      return next;
    });
    // clear selection so a subsequent click on the SAME account re-fires
    setSelected(null);
  }, [selected]);

  const { nodes, edges, drawnCount } = useMemo(() => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    if (!data) return { nodes, edges, drawnCount: 0 };

    // ----- pick which accounts to draw -----
    // Flat list of (account, region, city, branch) so we can rank globally
    type Flat = { acc: any; region: string; city: string; branch: string; branch_id: string | null };
    const allFlat: Flat[] = [];
    data.regions.forEach((r) => r.cities.forEach((c) => c.branches.forEach((b) => {
      b.accounts.forEach((a) => allFlat.push({
        acc: a, region: r.region, city: c.city, branch: b.branch, branch_id: b.branch_id ?? null,
      }));
    })));
    // sort: flagged first (by confidence desc), then unflagged (stable order)
    const ranked = allFlat.slice().sort((x, y) => {
      const fx = x.acc.flagged ? 1 : 0;
      const fy = y.acc.flagged ? 1 : 0;
      if (fx !== fy) return fy - fx;
      if (fx === 1) return (y.acc.confidence ?? 0) - (x.acc.confidence ?? 0);
      return 0;
    });
    const selected = accountLimit == null ? ranked : ranked.slice(0, accountLimit);
    const selectedAccountIds = new Set(selected.map((f) => f.acc.account_id));

    // From selected, find which branches/cities/regions are still in scope.
    const liveBranches = new Set<string>();
    const liveCities = new Set<string>();
    const liveRegions = new Set<string>();
    selected.forEach((f) => {
      liveBranches.add(f.branch_id ?? f.branch);
      liveCities.add(f.region + "::" + f.city);
      liveRegions.add(f.region);
    });

    data.regions.forEach((r) => {
      const rId = "r:" + r.region;
      nodes.push({ id: rId, actor: r.region, branch: null, fraud_type: null, confidence: null,
        ovColor: LEVEL.region.color, ovLabel: r.region, ovSize: LEVEL.region.size, ovTag: LEVEL.region.tag });

      if (!liveRegions.has(r.region)) return;
      r.cities.forEach((c) => {
        const cId = "c:" + r.region + ":" + c.city;
        nodes.push({ id: cId, actor: c.city, branch: null, fraud_type: null, confidence: null,
          ovColor: LEVEL.city.color, ovLabel: c.city, ovSize: LEVEL.city.size, ovTag: LEVEL.city.tag });
        edges.push({ source: rId, target: cId, amount: 0, channel: null, timestamp: null, nonTransactional: true });

        if (!liveCities.has(r.region + "::" + c.city)) return;
        c.branches.forEach((b) => {
          const bId = "b:" + (b.branch_id ?? b.branch);
          nodes.push({ id: bId, actor: b.branch, branch: null, fraud_type: null, confidence: null,
            ovColor: LEVEL.branch.color, ovLabel: b.branch, ovSize: LEVEL.branch.size, ovTag: LEVEL.branch.tag });
          edges.push({ source: cId, target: bId, amount: 0, channel: null, timestamp: null, nonTransactional: true });

          if (!liveBranches.has(b.branch_id ?? b.branch)) return;
          if (showAccounts) {
            b.accounts.forEach((a) => {
              if (!selectedAccountIds.has(a.account_id)) return;
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
              edges.push({ source: bId, target: aId, amount: 0, channel: null, timestamp: null, nonTransactional: true });
            });
          }
        });
      });
    });

    // Owners are shown ONLY for accounts that are either:
    //   - in the revealedOwners set (user clicked the account), OR
    //   - all of them, when showAllOwners is true (global override).
    // One owner node per unique person_id; shared automatically when they own multiple.
    if (showAccounts) {
      const accountIdsToRevealOwnersFor = new Set<string>();
      if (showAllOwners) {
        selectedAccountIds.forEach((id) => accountIdsToRevealOwnersFor.add(id));
      } else {
        revealedOwners.forEach((id) => {
          if (selectedAccountIds.has(id)) accountIdsToRevealOwnersFor.add(id);
        });
      }
      if (accountIdsToRevealOwnersFor.size > 0) {
        const ownerOf: Record<string, string[]> = {};
        const ownerLabel: Record<string, string> = {};
        data.regions.forEach((r) => r.cities.forEach((c) => c.branches.forEach((b) => {
          b.accounts.forEach((a) => {
            if (!accountIdsToRevealOwnersFor.has(a.account_id)) return;
            const ownerKey = a.person_id ?? a.holder;
            if (!ownerKey) return;
            (ownerOf[ownerKey] ??= []).push("a:" + a.account_id);
            ownerLabel[ownerKey] ??= a.holder ?? ownerKey;
          });
        })));
        Object.keys(ownerOf).forEach((key) => {
          const oId = "p:" + key;
          const isShared = ownerOf[key].length > 1;
          nodes.push({
            id: oId, actor: ownerLabel[key], branch: null, fraud_type: null, confidence: null,
            ovColor: LEVEL.owner.color,
            ovLabel: ownerLabel[key],
            ovSize: isShared ? LEVEL.owner.size + 2 : LEVEL.owner.size,
            ovTag: isShared ? `OWNER · ${ownerOf[key].length}` : LEVEL.owner.tag,
          });
          ownerOf[key].forEach((aId) => {
            edges.push({ source: oId, target: aId, amount: 0, channel: null, timestamp: null, nonTransactional: true });
          });
        });
      }
    }

    return { nodes, edges, drawnCount: selectedAccountIds.size };
  }, [data, showAccounts, showAllOwners, accountLimit, revealedOwners]);

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
              Flagged accounts (model confidence ≥ 50%) are coloured by verdict. Click any account to reveal its owner. Use the count selector to limit how many accounts are drawn.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Stat label="Accounts" value={data.total_accounts} />
            <Stat label="Flagged" value={data.total_flagged} danger />
            <Stat label="Drawn" value={drawnCount} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <Toggle on={!flaggedOnly} onClick={() => setFlaggedOnly(false)} label="All accounts" />
          <Toggle on={flaggedOnly} onClick={() => setFlaggedOnly(true)} label="Flagged only" />
          <span className="w-px h-5 bg-line mx-1" />
          <Toggle on={showAccounts} onClick={() => setShowAccounts(true)} label="Show accounts" />
          <Toggle on={!showAccounts} onClick={() => setShowAccounts(false)} label="Structure only" />
          <span className="w-px h-5 bg-line mx-1" />
          <Toggle on={showAccounts && showAllOwners} onClick={() => showAccounts && setShowAllOwners(!showAllOwners)} label="Show all owners" />
          {revealedOwners.size > 0 && (
            <button onClick={() => setRevealedOwners(new Set())}
              className="text-[11px] px-2 py-1 rounded-md border border-line text-ash-500 hover:text-ash-200 transition-colors font-mono">
              clear owners ({revealedOwners.size})
            </button>
          )}
          <span className="w-px h-5 bg-line mx-1" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-ash-500 mr-1">Show</span>
          {[10, 25, 50, 100, null].map((n) => (
            <Toggle key={n ?? "all"} on={accountLimit === n}
              onClick={() => setAccountLimit(n)}
              label={n === null ? "All" : String(n)} />
          ))}
          <div className="ml-3 flex items-center gap-3 text-[10px] font-mono text-ash-500 flex-wrap">
            <Legend color={LEVEL.region.color} label="Region" />
            <Legend color={LEVEL.city.color} label="City" />
            <Legend color={LEVEL.branch.color} label="Branch" />
            <Legend color="#4E4A55" label="Account" />
            <Legend color={LEVEL.owner.color} label="Owner" />
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