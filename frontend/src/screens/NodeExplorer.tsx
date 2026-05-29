// frontend/src/screens/NodeExplorer.tsx
import { useState, useCallback, useMemo } from "react";
import { useFlaggedSeeds, useNodeFetcher } from "../hooks/useExplore";
import type { NodeInfo, Neighbor, Seed } from "../hooks/useExplore";
import type { GraphNode, GraphEdge } from "../hooks/useGraph";
import { ForceGraph } from "../components/ForceGraph";
import { fraudStyle } from "../lib/fraudTypes";
import { inr, shortTime } from "../lib/format";
import { Loading } from "../components/states/Loading";

export default function NodeExplorer() {
  const { seeds, loading: seedsLoading } = useFlaggedSeeds();
  const fetchNode = useNodeFetcher();

  const [nodes, setNodes] = useState<Record<string, GraphNode>>({});
  const [edges, setEdges] = useState<Record<string, GraphEdge>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<NodeInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const addNode = (n: GraphNode) =>
    setNodes((prev) => (prev[n.id] ? prev : { ...prev, [n.id]: n }));

  const expand = useCallback(async (accountId: string) => {
    setBusy(accountId);
    setSelected(accountId);
    try {
      const info = await fetchNode(accountId);
      setDetail(info);
      // ensure the clicked node exists
      addNode({ id: info.account_id, actor: info.holder, branch: info.branch,
                fraud_type: info.fraud_type, confidence: info.confidence });
      // add neighbours + edges
      setNodes((prev) => {
        const next = { ...prev };
        info.neighbors.forEach((nb) => {
          if (!next[nb.account_id])
            next[nb.account_id] = { id: nb.account_id, actor: nb.holder, branch: null,
                                    fraud_type: nb.fraud_type, confidence: nb.confidence };
        });
        return next;
      });
      setEdges((prev) => {
        const next = { ...prev };
        info.neighbors.forEach((nb) => {
          // OUT: clicked -> neighbor ; IN: neighbor -> clicked
          const src = nb.direction === "OUT" ? info.account_id : nb.account_id;
          const tgt = nb.direction === "OUT" ? nb.account_id : info.account_id;
          const key = `${src}->${tgt}`;
          if (!next[key]) next[key] = { source: src, target: tgt, amount: nb.amount,
                                        channel: nb.channel, timestamp: nb.timestamp };
        });
        return next;
      });
      setExpanded((prev) => new Set(prev).add(accountId));
    } catch {
      /* transient — user can click again */
    } finally {
      setBusy(null);
    }
  }, [fetchNode]);

  const startFrom = (seed: Seed) => {
    setStarted(true);
    setNodes({});
    setEdges({});
    setExpanded(new Set());
    expand(seed.account_id);
  };

  const reset = () => {
    setStarted(false); setNodes({}); setEdges({}); setExpanded(new Set());
    setSelected(null); setDetail(null);
  };

  const nodeList = useMemo(() => Object.values(nodes), [nodes]);
  const edgeList = useMemo(() => Object.values(edges), [edges]);

  // ---------- start screen: pick a flagged seed ----------
  if (!started) {
    return (
      <div className="flex-1 overflow-auto no-scrollbar">
        <div className="px-8 pt-6 pb-4 border-b border-line">
          <h1 className="font-display text-[26px] tracking-tight">Node Explorer</h1>
          <p className="text-[13px] text-ash-400 mt-1">
            Start from a flagged account and expand the network one node at a time —
            click any node to reveal who it transacted with. Far easier than the full graph.
          </p>
        </div>
        <div className="px-8 py-6">
          <div className="text-[11px] font-mono uppercase tracking-wider text-flame-400 mb-3">
            Pick a flagged account to start
          </div>
          {seedsLoading ? (
            <Loading label="Finding flagged accounts…" />
          ) : seeds.length === 0 ? (
            <div className="text-ash-500">No flagged accounts found.</div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 max-w-3xl">
              {seeds.map((s) => {
                const st = fraudStyle(s.fraud_type);
                return (
                  <button key={s.account_id} onClick={() => startFrom(s)}
                    className="text-left rounded-xl border border-line bg-ink-800 hover:bg-ink-700 hover:border-flame-500/40 p-4 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: st.color }} />
                      <span className="text-[14px] text-ash-100 font-medium">{s.holder ?? "Unknown"}</span>
                    </div>
                    <div className="text-[11px] font-mono text-ash-500 mt-1">·{s.account_id.slice(-8)}</div>
                    <div className="mt-2 text-[10px] font-mono px-1.5 py-0.5 rounded inline-block"
                      style={{ background: st.color + "1A", color: st.color }}>
                      {st.label} · {Math.round(s.confidence * 100)}%
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- explorer canvas ----------
  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 relative min-w-0">
        <div className="absolute top-0 left-0 right-0 z-10 px-6 py-3 flex items-center justify-between border-b border-line bg-ink-900/80 backdrop-blur">
          <div>
            <div className="font-display text-[16px]">Node Explorer</div>
            <div className="text-[11px] font-mono text-ash-500">
              {nodeList.length} nodes · {edgeList.length} flows · {expanded.size} expanded
              {busy ? " · expanding…" : ""}
            </div>
          </div>
          <button onClick={reset}
            className="text-[12px] px-3 py-1.5 rounded-lg border border-line bg-ink-800 text-ash-300 hover:text-ash-100">
            ← Start over
          </button>
        </div>
        <div className="absolute inset-0 pt-[58px]">
          <ForceGraph
            nodes={nodeList}
            edges={edgeList}
            selectedId={selected}
            onSelect={(id) => { if (id) expand(id); else { setSelected(null); setDetail(null); } }}
          />
        </div>
        <div className="absolute bottom-3 left-6 text-[11px] font-mono text-ash-500 bg-ink-900/70 px-2 py-1 rounded">
          Tip: click any node to expand its connections
        </div>
      </div>

      {/* detail rail */}
      <div className="w-[320px] shrink-0 border-l border-line bg-ink-900 overflow-auto no-scrollbar p-4">
        {detail ? <NodePanel info={detail} expanded={expanded} onExpand={expand} /> : (
          <div className="text-center text-ash-500 mt-16 px-4">
            <div className="font-display text-[15px] text-ash-300">Click a node</div>
            <div className="text-[12px] mt-2">Select any account in the graph to see its connections and expand further.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function NodePanel({ info, expanded, onExpand }: {
  info: NodeInfo; expanded: Set<string>; onExpand: (id: string) => void;
}) {
  const st = info.flagged && info.fraud_type ? fraudStyle(info.fraud_type) : null;
  const outs = info.neighbors.filter((n) => n.direction === "OUT");
  const ins = info.neighbors.filter((n) => n.direction === "IN");
  return (
    <div>
      <div className="rounded-xl border border-line bg-ink-800 p-4">
        <div className="text-[10px] font-mono text-ash-500">·{info.account_id.slice(-8)}</div>
        <div className="font-display text-[18px] mt-0.5">{info.holder ?? "Unknown"}</div>
        {info.branch && <div className="text-[12px] text-ash-400 mt-0.5">{info.branch}</div>}
        {st ? (
          <div className="mt-2 text-[11px] font-mono px-2 py-1 rounded inline-block"
            style={{ background: st.color + "1A", color: st.color }}>
            {st.label}{info.confidence != null ? ` · ${Math.round(info.confidence * 100)}%` : ""}
          </div>
        ) : (
          <div className="mt-2 text-[11px] font-mono px-2 py-1 rounded inline-block bg-jade-500/10 text-jade-400">
            Normal
          </div>
        )}
      </div>

      <NbGroup title={`SENT TO · ${outs.length}`} list={outs} expanded={expanded} onExpand={onExpand} />
      <NbGroup title={`RECEIVED FROM · ${ins.length}`} list={ins} expanded={expanded} onExpand={onExpand} />
    </div>
  );
}

function NbGroup({ title, list, expanded, onExpand }: {
  title: string; list: Neighbor[]; expanded: Set<string>; onExpand: (id: string) => void;
}) {
  if (list.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-ash-500 mb-1.5">{title}</div>
      <div className="space-y-1.5">
        {list.map((n, i) => {
          const st = n.flagged && n.fraud_type ? fraudStyle(n.fraud_type) : null;
          const isExp = expanded.has(n.account_id);
          return (
            <button key={i} onClick={() => onExpand(n.account_id)}
              className="w-full text-left rounded-lg border border-line bg-ink-800 hover:bg-ink-700 p-2.5 transition-colors">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: st ? st.color : "#3A353F" }} />
                <span className="text-[12.5px] text-ash-200 flex-1 truncate">{n.holder ?? n.account_id.slice(-6)}</span>
                <span className="text-[11px] font-mono" style={{ color: n.direction === "OUT" ? "#FF6D29" : "#52C41A" }}>
                  {n.direction === "OUT" ? "→" : "←"} {inr(n.amount)}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1 pl-4">
                <span className="text-[10px] font-mono text-ash-600">
                  {n.channel ?? ""}{n.timestamp ? ` · ${shortTime(n.timestamp)}` : ""}
                </span>
                <span className={`text-[9px] font-mono ${isExp ? "text-ash-600" : "text-flame-400"}`}>
                  {isExp ? "expanded" : "+ expand"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}