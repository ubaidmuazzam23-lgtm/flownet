// frontend/src/screens/GraphView.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useGraph, useTrace, useCycles } from "../hooks/useGraph";
import { useLayeringEdges } from "../hooks/useLayering";
import type { LayerEdges as LayerEdgesT } from "../hooks/useLayering";
import type { Cycle } from "../hooks/useGraph";
import type { GraphNode, GraphEdge } from "../hooks/useGraph";
import { ForceGraph } from "../components/ForceGraph";
import { fraudStyle } from "../lib/fraudTypes";
import { inr, shortTime } from "../lib/format";
import { Loading } from "../components/states/Loading";
import { ErrorState } from "../components/states/ErrorState";
import { FRAUD_CLASSES } from "../types";

type Mode = "flagged" | "type" | "branch" | "trace" | "circular" | "layering" | "full";
const MODES: { id: Mode; label: string }[] = [
  { id: "flagged", label: "Flagged accounts" },
  { id: "type", label: "By fraud type" },
  { id: "branch", label: "By branch" },
  { id: "trace", label: "Multi-hop trace" },
  { id: "circular", label: "Circular (AML)" },
  { id: "layering", label: "Layering (TGN)" },
  { id: "full", label: "Full network" },
];

function edgeTime(e: GraphEdge): number {
  const t = e.timestamp ? Date.parse(e.timestamp) : NaN;
  return isNaN(t) ? 0 : t;
}

// Highest-value chain from origin, following outgoing edges greedily by amount.
function highestValuePath(edges: GraphEdge[], origin: string): Set<string> {
  const out: Record<string, GraphEdge[]> = {};
  for (const e of edges) (out[e.source] ??= []).push(e);
  const key = (e: GraphEdge) => `${e.source}->${e.target}`;
  const path = new Set<string>();
  let cur = origin;
  const seen = new Set<string>([origin]);
  for (let i = 0; i < 8; i++) {
    const opts = (out[cur] ?? []).filter((e) => !seen.has(e.target));
    if (opts.length === 0) break;
    const best = opts.reduce((a, b) => (b.amount > a.amount ? b : a));
    path.add(key(best));
    seen.add(best.target);
    cur = best.target;
  }
  return path;
}

export default function GraphView() {
  const { data, loading, error, reload } = useGraph(150);
  const [mode, setMode] = useState<Mode>("flagged");
  const [typePick, setTypePick] = useState("Structuring");
  const [branchPick, setBranchPick] = useState("");
  const [tracePick, setTracePick] = useState("");
  const [hops, setHops] = useState(3);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  // playback
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState<number | null>(null); // null = show all
  const playRef = useRef<number | null>(null);

  // suspicious path
  const [showPath, setShowPath] = useState(false);

  const trace = useTrace(mode === "trace" ? tracePick || null : null, hops);
  const cyclesRes = useCycles(mode === "circular");
  const layerRes = useLayeringEdges(mode === "layering");
  const [selectedCycle, setSelectedCycle] = useState<number | null>(null);

  const branches = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.nodes.map((n) => n.branch).filter(Boolean))) as string[];
  }, [data]);
  const flaggedNodes = useMemo(
    () => data?.nodes.filter((n) => n.fraud_type && n.fraud_type !== "Normal") ?? [], [data]);
  const nodeMap = useMemo(() => {
    const m: Record<string, GraphNode> = {};
    data?.nodes.forEach((n) => (m[n.id] = n));
    trace.data?.nodes.forEach((n) => (m[n.id] = n));
    cyclesRes.data?.cycles?.forEach((c) => c.nodes.forEach((n) => (m[n.id] = n)));
    return m;
  }, [data, trace.data, cyclesRes.data]);

  const filtered = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };
    const all = data.nodes, edges = data.edges;
    const subgraph = (keep: Set<string>, neighbors: boolean) => {
      const ids = new Set(keep);
      if (neighbors) for (const e of edges) {
        if (keep.has(e.source)) ids.add(e.target);
        if (keep.has(e.target)) ids.add(e.source);
      }
      return { nodes: all.filter((n) => ids.has(n.id)), edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
    };
    if (mode === "full") return { nodes: all, edges };
    if (mode === "flagged") return subgraph(new Set(flaggedNodes.map((n) => n.id)), true);
    if (mode === "type") return subgraph(new Set(all.filter((n) => n.fraud_type === typePick).map((n) => n.id)), true);
    if (mode === "branch") return subgraph(new Set(all.filter((n) => n.branch === branchPick).map((n) => n.id)), false);
    if (mode === "trace") return trace.data ? { nodes: trace.data.nodes, edges: trace.data.edges } : { nodes: [], edges: [] };
    if (mode === "layering") {
      const le = layerRes.data?.edges ?? [];
      const ids = new Set<string>();
      le.forEach((e) => { ids.add(e.source); ids.add(e.target); });
      const allById: Record<string, GraphNode> = {};
      (data?.nodes ?? []).forEach((n) => { allById[n.id] = n; });
      const nodes: GraphNode[] = [];
      ids.forEach((id) => {
        nodes.push(allById[id] ?? { id, actor: null, branch: null, fraud_type: null, confidence: null });
      });
      const edges: GraphEdge[] = le.map((e) => ({
        source: e.source, target: e.target, amount: e.amount,
        channel: e.channel, timestamp: e.timestamp,
      }));
      return { nodes, edges };
    }
    if (mode === "circular") {
      const cyc = cyclesRes.data?.cycles ?? [];
      const chosen = selectedCycle != null ? [cyc[selectedCycle]].filter(Boolean) : cyc;
      // Draw straight from each cycle's OWN nodes + edges (always complete,
      // never depends on the limited /graph view).
      const nodeMapLocal: Record<string, GraphNode> = {};
      const edgeList: GraphEdge[] = [];
      const edgeSeen = new Set<string>();
      chosen.forEach((c) => {
        c.nodes.forEach((n) => { nodeMapLocal[n.id] = n; });
        c.edges.forEach((e) => {
          const k = `${e.source}->${e.target}`;
          if (!edgeSeen.has(k)) { edgeSeen.add(k); edgeList.push(e); }
        });
      });
      return { nodes: Object.values(nodeMapLocal), edges: edgeList };
    }

    return { nodes: all, edges };
  }, [data, mode, typePick, branchPick, flaggedNodes, trace.data, cyclesRes.data, selectedCycle, layerRes.data]);

  // edges sorted by time for playback
  const timedEdges = useMemo(
    () => [...filtered.edges].sort((a, b) => edgeTime(a) - edgeTime(b)), [filtered.edges]);

  // which edges are visible given playback state
  const visibleEdges = useMemo(() => {
    if (playIndex === null) return filtered.edges;
    return timedEdges.slice(0, playIndex + 1);
  }, [filtered.edges, timedEdges, playIndex]);

  // suspicious path set (trace mode only)
  const pathSet = useMemo(() => {
    if (!showPath || mode !== "trace" || !trace.data) return null;
    return highestValuePath(filtered.edges, trace.data.origin);
  }, [showPath, mode, trace.data, filtered.edges]);

  // playback driver
  useEffect(() => {
    if (!playing) { if (playRef.current) cancelAnimationFrame(playRef.current); return; }
    if (timedEdges.length === 0) { setPlaying(false); return; }
    let last = performance.now();
    const stepMs = 380;
    const loop = (now: number) => {
      if (now - last >= stepMs) {
        last = now;
        setPlayIndex((idx) => {
          const next = idx === null ? 0 : idx + 1;
          if (next >= timedEdges.length - 1) { setPlaying(false); return timedEdges.length - 1; }
          return next;
        });
      }
      playRef.current = requestAnimationFrame(loop);
    };
    playRef.current = requestAnimationFrame(loop);
    return () => { if (playRef.current) cancelAnimationFrame(playRef.current); };
  }, [playing, timedEdges.length]);

  // reset playback when the view changes
  useEffect(() => { setPlaying(false); setPlayIndex(null); setShowPath(false); setSelectedCycle(null); }, [mode, typePick, branchPick, tracePick, hops]);

  // highlight edges along the selected circular path
  const cyclePathSet = useMemo(() => {
    if (mode !== "circular" || selectedCycle == null) return null;
    const cyc = cyclesRes.data?.cycles?.[selectedCycle];
    if (!cyc) return null;
    const set = new Set<string>();
    for (let i = 0; i < cyc.path.length - 1; i++) {
      set.add(`${cyc.path[i].account_id}->${cyc.path[i + 1].account_id}`);
    }
    return set;
  }, [mode, selectedCycle, cyclesRes.data]);

  // the closing edge of the selected loop (the hop that returns to origin)
  const closingEdgeKey = useMemo(() => {
    if (mode !== "circular" || selectedCycle == null) return null;
    const cyc = cyclesRes.data?.cycles?.[selectedCycle];
    if (!cyc || cyc.path.length < 2) return null;
    const last = cyc.path[cyc.path.length - 1].account_id;
    const first = cyc.path[0].account_id;
    return `${last}->${first}`;
  }, [mode, selectedCycle, cyclesRes.data]);

  if (loading) return <Loading label="Building fund-flow network…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const startPlay = () => { setPlayIndex(playIndex === null ? -1 : playIndex); setPlaying(true); };
  const resetPlay = () => { setPlaying(false); setPlayIndex(null); };

  const currentEdge = playIndex !== null && playIndex >= 0 ? timedEdges[playIndex] : null;

  const summary = (() => {
    switch (mode) {
      case "flagged": return `${flaggedNodes.length} flagged accounts and their direct connections`;
      case "type": return `Accounts the model flagged as ${typePick}`;
      case "branch": return branchPick ? `Accounts and flows at ${branchPick}` : "Select a branch";
      case "trace":
        if (!tracePick) return "Select an account to trace its money trail";
        if (trace.loading) return "Tracing money trail…";
        if (trace.data) return `${hops}-hop trail · ${inr(trace.data.total_traced)} traced · ${trace.data.nodes.length} accounts`;
        return "Tracing…";
      case "circular":
        if (cyclesRes.loading) return "Scanning for circular money flows…";
        if (cyclesRes.data) return `${cyclesRes.data.total} circular ${cyclesRes.data.total === 1 ? "loop" : "loops"} detected (A→B→…→A)`;
        return "Detecting circular transactions…";
      case "layering":
        if (layerRes.loading) return "Running TGN over transactions…";
        if (layerRes.data && !layerRes.data.model_loaded) return "TGN model not loaded on the backend.";
        if (layerRes.data) return `${layerRes.data.total} layering transactions flagged by the TGN (of ${layerRes.data.scored_transactions} scored)`;
        return "Detecting rapid layering…";
      case "full": return `Full network · ${data.nodes.length} accounts`;
    }
  })();

  return (
    <div className="flex-1 flex flex-col bg-ink-900 text-ash-100 overflow-hidden">
      <div className="px-6 pt-5 pb-3 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-[24px] font-semibold tracking-tight leading-none">Fund-Flow Network</h1>
            <div className="text-[12px] text-ash-400 mt-1.5">{summary}</div>
          </div>
          <button onClick={reload} className="h-9 px-3 text-[12px] rounded-md border border-line bg-ink-800 hover:bg-ink-700">Rebuild</button>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {MODES.map((m) => (
            <button key={m.id} onClick={() => { setMode(m.id); setSelected(null); setSelectedEdge(null); }}
              className={`h-8 px-3 rounded-md text-[12px] font-medium border transition-colors ${
                mode === m.id ? "bg-flame-500 border-flame-500 text-white" : "bg-ink-800 border-line text-ash-300 hover:bg-ink-700"}`}>
              {m.label}
            </button>
          ))}
          {mode === "type" && (
            <select value={typePick} onChange={(e) => setTypePick(e.target.value)} className="h-8 px-2 rounded-md text-[12px] bg-ink-800 border border-line text-ash-200">
              {FRAUD_CLASSES.filter((c) => c !== "Normal").map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {mode === "branch" && (
            <select value={branchPick} onChange={(e) => setBranchPick(e.target.value)} className="h-8 px-2 rounded-md text-[12px] bg-ink-800 border border-line text-ash-200">
              <option value="">Select branch…</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          {mode === "trace" && (
            <>
              <select value={tracePick} onChange={(e) => setTracePick(e.target.value)} className="h-8 px-2 rounded-md text-[12px] bg-ink-800 border border-line text-ash-200 max-w-[220px]">
                <option value="">Select account…</option>
                {flaggedNodes.map((n) => <option key={n.id} value={n.id}>{(n.actor ?? n.id)} · {n.fraud_type}</option>)}
              </select>
              <div className="flex items-center gap-1 text-[11px] text-ash-400">
                <span>hops</span>
                {[1, 2, 3, 4].map((h) => (
                  <button key={h} onClick={() => setHops(h)} className={`w-6 h-7 rounded text-[11px] ${hops === h ? "bg-flame-500 text-white" : "bg-ink-800 border border-line text-ash-300"}`}>{h}</button>
                ))}
              </div>
              {trace.data && (
                <button onClick={() => setShowPath((s) => !s)}
                  className={`h-8 px-3 rounded-md text-[12px] border ${showPath ? "bg-orchid-500 border-orchid-500 text-white" : "bg-ink-800 border-line text-ash-300 hover:bg-ink-700"}`}>
                  ⚡ Suspicious path
                </button>
              )}
            </>
          )}

          {/* Playback controls */}
          <div className="ml-auto flex items-center gap-2">
            {!playing ? (
              <button onClick={startPlay} disabled={timedEdges.length === 0}
                className="h-8 px-3 rounded-md text-[12px] border bg-ink-800 border-line text-ash-200 hover:bg-ink-700 disabled:opacity-40">
                ▶ Play flow
              </button>
            ) : (
              <button onClick={() => setPlaying(false)} className="h-8 px-3 rounded-md text-[12px] border bg-flame-500 border-flame-500 text-white">❚❚ Pause</button>
            )}
            {playIndex !== null && (
              <button onClick={resetPlay} className="h-8 px-3 rounded-md text-[12px] border bg-ink-800 border-line text-ash-300 hover:bg-ink-700">Reset</button>
            )}
          </div>
        </div>

        {/* timeline scrubber */}
        {playIndex !== null && timedEdges.length > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <input type="range" min={0} max={timedEdges.length - 1} value={Math.max(0, playIndex)}
              onChange={(e) => { setPlaying(false); setPlayIndex(parseInt(e.target.value)); }}
              className="flex-1 accent-flame-500" />
            <div className="text-[11px] font-mono text-ash-400 w-[230px] text-right">
              {currentEdge ? (
                <>{shortTime(currentEdge.timestamp ?? "")} · {nodeMap[currentEdge.source]?.actor ?? currentEdge.source.slice(-4)} → {nodeMap[currentEdge.target]?.actor ?? currentEdge.target.slice(-4)} · {inr(currentEdge.amount)}</>
              ) : "ready"}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 grid grid-cols-[1fr_330px] min-h-0">
        <div className="relative min-h-0">
          {filtered.nodes.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center text-ash-500 text-[13px]">
              {mode === "branch" ? "Select a branch above." : mode === "trace" ? (trace.loading ? "Tracing…" : "Select an account above.") : "No accounts in this view."}
            </div>
          ) : (
            <ForceGraph nodes={filtered.nodes} edges={visibleEdges}
              traceMode={mode === "trace"} circularMode={mode === "circular"} layeringMode={mode === "layering"} closingEdge={closingEdgeKey} origin={trace.data?.origin ?? null} highlightPath={cyclePathSet ?? pathSet}
              onSelect={(id) => { setSelected(id); setSelectedEdge(null); }} selectedId={selected}
              onSelectEdge={(e) => { setSelectedEdge(e); setSelected(null); }} />
          )}
          <Legend traceMode={mode === "trace"} maxHop={trace.data?.max_hop ?? hops} />
        </div>

        <div className="border-l border-line overflow-auto p-4 no-scrollbar bg-ink-900">
          {selectedEdge ? (
            <EdgePanel edge={selectedEdge} nodeMap={nodeMap} onClose={() => setSelectedEdge(null)} />
          ) : selected ? (
            <NodePanel node={nodeMap[selected]} edges={filtered.edges} nodeMap={nodeMap} onClose={() => setSelected(null)} />
          ) : mode === "circular" ? (
            <CyclePanel res={cyclesRes} selected={selectedCycle} onSelect={setSelectedCycle} />
          ) : mode === "layering" ? (
            <LayeringPanel res={layerRes} />
          ) : (
            <div className="text-center text-ash-500 mt-16 px-4">
              <div className="font-display text-[15px] text-ash-300">Investigate</div>
              <div className="text-[12px] mt-2 leading-relaxed">
                Click a <span className="text-ash-200">node</span> for its verdict & flows, or an <span className="text-flame-400">edge</span> for a transfer.
                Use <span className="text-ash-200">▶ Play flow</span> to watch transactions in time order.
                {mode === "trace" && " Toggle ⚡ to highlight the highest-value path."}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Legend({ traceMode, maxHop }: { traceMode: boolean; maxHop: number }) {
  if (traceMode) {
    const HOP = ["#FF6D29", "#FFC542", "#1677FF", "#722ED1"];
    return (
      <div className="absolute top-4 left-4 glass rounded-lg p-3">
        <div className="text-[9px] font-mono tracking-wider text-ash-500 mb-2">HOPS FROM ORIGIN</div>
        <div className="space-y-1.5">
          {Array.from({ length: Math.max(1, maxHop) }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 text-[10.5px]"><span className="w-3 h-0.5" style={{ background: HOP[i % 4] }} /><span className="text-ash-300 font-mono">hop {i + 1}</span></div>
          ))}
        </div>
      </div>
    );
  }
  const classes = FRAUD_CLASSES.filter((c) => c !== "Normal");
  return (
    <div className="absolute top-4 left-4 glass rounded-lg p-3">
      <div className="text-[9px] font-mono tracking-wider text-ash-500 mb-2">MODEL VERDICT</div>
      <div className="space-y-1.5">
        {classes.map((c) => { const s = fraudStyle(c); return <div key={c} className="flex items-center gap-2 text-[10.5px]"><span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} /><span className="text-ash-300 font-mono">{c}</span></div>; })}
        <div className="flex items-center gap-2 text-[10.5px] pt-1 border-t border-line/50"><span className="w-2.5 h-2.5 rounded-full" style={{ background: "#4E4A55" }} /><span className="text-ash-500 font-mono">Normal</span></div>
      </div>
    </div>
  );
}

function holderOf(id: string, m: Record<string, GraphNode>) { return m[id]?.actor ?? id; }

function EdgePanel({ edge, nodeMap, onClose }: { edge: GraphEdge; nodeMap: Record<string, GraphNode>; onClose: () => void }) {
  const from = nodeMap[edge.source], to = nodeMap[edge.target];
  return (
    <div className="space-y-3">
      <button onClick={onClose} className="text-[12px] text-ash-400 hover:text-ash-100">← Clear</button>
      <div className="rounded-xl border border-line bg-ink-800 p-4 hud-corners">
        <div className="text-[10px] font-mono uppercase tracking-wider text-flame-500 mb-3">Transfer{edge.hop ? ` · hop ${edge.hop}` : ""}</div>
        <div className="rounded-lg bg-ink-700/50 p-3">
          <div className="text-[9px] font-mono text-ash-500">FROM</div>
          <div className="font-display text-[15px] font-semibold mt-0.5">{from?.actor ?? "Unknown"}</div>
          <div className="text-[10.5px] font-mono text-ash-400">{edge.source}</div>
          <div className="text-[10.5px] text-ash-500 mt-0.5">{from?.branch ?? "—"}</div>
        </div>
        <div className="flex flex-col items-center py-2">
          <div className="text-flame-500 text-lg leading-none">↓</div>
          <div className="font-display text-[20px] font-semibold tnum text-flame-400 mt-1">{inr(edge.amount)}</div>
          <div className="text-[10px] font-mono text-ash-500 mt-0.5">via {edge.channel ?? "—"}{edge.timestamp ? ` · ${shortTime(edge.timestamp)}` : ""}</div>
        </div>
        <div className="rounded-lg bg-ink-700/50 p-3">
          <div className="text-[9px] font-mono text-ash-500">TO</div>
          <div className="font-display text-[15px] font-semibold mt-0.5">{to?.actor ?? "Unknown"}</div>
          <div className="text-[10.5px] font-mono text-ash-400">{edge.target}</div>
          <div className="text-[10.5px] text-ash-500 mt-0.5">{to?.branch ?? "—"}</div>
        </div>
      </div>
    </div>
  );
}

function NodePanel({ node, edges, nodeMap, onClose }: { node: GraphNode; edges: GraphEdge[]; nodeMap: Record<string, GraphNode>; onClose: () => void }) {
  if (!node) return null;
  const outgoing = edges.filter((e) => e.source === node.id);
  const incoming = edges.filter((e) => e.target === node.id);
  const totalOut = outgoing.reduce((s, e) => s + e.amount, 0);
  const totalIn = incoming.reduce((s, e) => s + e.amount, 0);
  const c = node.fraud_type && node.fraud_type !== "Normal" ? fraudStyle(node.fraud_type).color : "#4E4A55";
  return (
    <div className="space-y-3">
      <button onClick={onClose} className="text-[12px] text-ash-400 hover:text-ash-100">← Clear</button>
      <div className="rounded-xl border border-line bg-ink-800 p-4 hud-corners">
        <div className="text-[10px] font-mono tracking-wider text-ash-500">{node.id}</div>
        <div className="font-display text-[17px] font-semibold mt-1">{node.actor ?? "Unknown"}</div>
        <div className="text-[11px] font-mono text-ash-400 mt-0.5">{node.branch ?? "—"}</div>
        {node.fraud_type && (
          <div className="mt-3"><span className="inline-flex font-mono text-[11px] px-2 py-1 rounded border" style={{ borderColor: c + "55", background: c + "12", color: c }}>{node.fraud_type}{node.confidence ? ` · ${(node.confidence * 100).toFixed(0)}%` : ""}</span></div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-ink-800 p-3"><div className="text-[9px] font-mono text-ash-500 tracking-wider">IN</div><div className="font-display text-[16px] font-semibold tnum text-jade-400 mt-0.5">{inr(totalIn)}</div><div className="text-[9px] text-ash-500">{incoming.length} transfers</div></div>
        <div className="rounded-xl border border-line bg-ink-800 p-3"><div className="text-[9px] font-mono text-ash-500 tracking-wider">OUT</div><div className="font-display text-[16px] font-semibold tnum text-flame-400 mt-0.5">{inr(totalOut)}</div><div className="text-[9px] text-ash-500">{outgoing.length} transfers</div></div>
      </div>
      <div className="rounded-xl border border-line bg-ink-800 p-4">
        <div className="text-[10px] font-mono uppercase tracking-wider text-ash-400 mb-3">Flows · From → To</div>
        <div className="space-y-1.5 max-h-[280px] overflow-auto no-scrollbar">
          {outgoing.map((e, i) => <FlowRow key={`o${i}`} dir="OUT" other={holderOf(e.target, nodeMap)} amount={e.amount} channel={e.channel} />)}
          {incoming.map((e, i) => <FlowRow key={`i${i}`} dir="IN" other={holderOf(e.source, nodeMap)} amount={e.amount} channel={e.channel} />)}
          {outgoing.length === 0 && incoming.length === 0 && <div className="text-[11px] text-ash-500">No flows in this view.</div>}
        </div>
      </div>
    </div>
  );
}



function LayeringPanel({ res }: { res: { data: any; loading: boolean; error: string | null } }) {
  if (res.loading) return <div className="text-[12px] font-mono text-ash-500 mt-8 text-center">Running TGN over transactions…</div>;
  if (res.error) return <div className="text-[12px] font-mono text-danger-500 mt-8">{res.error}</div>;
  const d = res.data;
  if (!d) return null;
  if (!d.model_loaded) return (
    <div className="text-center text-ash-500 mt-16 px-4">
      <div className="font-display text-[15px] text-ash-300">TGN not loaded</div>
      <div className="text-[12px] mt-2 leading-relaxed">{d.note ?? "The layering model isn't loaded on the backend."}</div>
    </div>
  );
  if (!d.edges || d.edges.length === 0) return (
    <div className="text-center text-ash-500 mt-16 px-4">
      <div className="font-display text-[15px] text-ash-300">No layering flagged</div>
      <div className="text-[12px] mt-2 leading-relaxed">{d.note ?? "No transactions crossed the layering threshold."}</div>
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-danger-500 mb-1">Rapid Layering · TGN</div>
      <div className="text-[11px] text-ash-500 mb-1 leading-relaxed">
        A temporal graph neural network scored each transaction. These crossed the {Math.round(d.threshold * 100)}% layering threshold.
      </div>
      <div className="text-[10px] font-mono text-ash-600 mb-2">
        {d.scored_transactions} scored · {d.trained_accounts} accounts in trained scope
      </div>
      {d.edges.map((e: any, i: number) => (
        <div key={i} className="rounded-xl border border-danger-500/30 bg-danger-500/5 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-danger-500">P {Math.round(e.layering_prob * 100)}%</span>
            <span className="text-[10px] font-mono text-ash-400">{inr(e.amount)}</span>
          </div>
          <div className="mt-1 text-[11px] text-ash-200 leading-relaxed">
            <span className="text-ash-100">{e.source_actor ?? e.source.slice(-4)}</span>
            <span className="text-danger-500"> → </span>
            <span className="text-ash-100">{e.target_actor ?? e.target.slice(-4)}</span>
          </div>
          <div className="text-[10px] font-mono text-ash-600 mt-0.5">{e.channel ?? ""}{e.timestamp ? ` · ${shortTime(e.timestamp)}` : ""}</div>
        </div>
      ))}
    </div>
  );
}

function CyclePanel({ res, selected, onSelect }: {
  res: { data: any; loading: boolean; error: string | null };
  selected: number | null;
  onSelect: (i: number | null) => void;
}) {
  if (res.loading) return <div className="text-[12px] font-mono text-ash-500 mt-8 text-center">Scanning money flows for loops…</div>;
  if (res.error) return <div className="text-[12px] font-mono text-danger-500 mt-8">{res.error}</div>;
  const cycles = res.data?.cycles ?? [];
  if (cycles.length === 0) return (
    <div className="text-center text-ash-500 mt-16 px-4">
      <div className="font-display text-[15px] text-ash-300">No circular flows</div>
      <div className="text-[12px] mt-2 leading-relaxed">The AML engine found no money that loops back to its origin in the current data.</div>
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-orchid-400 mb-1">Circular Transactions · AML</div>
      <div className="text-[11px] text-ash-500 mb-2">Money that returns to its origin through a chain. Click a loop to highlight it.</div>
      {cycles.map((c: any, i: number) => {
        const isSel = selected === i;
        return (
          <button key={i} onClick={() => onSelect(isSel ? null : i)}
            className={`w-full text-left rounded-xl border p-3 transition-colors ${isSel ? "border-orchid-500 bg-orchid-500/10" : "border-line bg-ink-800 hover:bg-ink-700"}`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-orchid-400">LOOP #{i + 1}</span>
              <span className="text-[10px] font-mono text-ash-400">{c.hops} hops · {inr(c.amount)} moved</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-ink-700 text-jade-400">
                ~{Math.round((c.similarity ?? 0) * 100)}% similar
              </span>
              {c.duration_hours != null && (
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded bg-ink-700 ${c.fast ? "text-flame-400" : "text-ash-400"}`}>
                  {c.duration_hours < 1
                    ? `${Math.round(c.duration_hours * 60)}m`
                    : c.duration_hours < 48
                    ? `${c.duration_hours.toFixed(1)}h`
                    : `${(c.duration_hours / 24).toFixed(1)}d`}
                  {c.fast ? " · fast" : ""}
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[11px] text-ash-200 leading-relaxed break-words">
              {c.path.map((s: any, j: number) => (
                <span key={j}>
                  <span className="text-ash-100">{s.actor ?? s.account_id.slice(-4)}</span>
                  {j < c.path.length - 1 && <span className="text-orchid-400"> → </span>}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function FlowRow({ dir, other, amount, channel }: { dir: "IN" | "OUT"; other: string; amount: number; channel: string | null }) {
  return (
    <div className="flex items-center gap-2 text-[11px] py-1.5 border-b border-line/30">
      <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded ${dir === "IN" ? "bg-jade-500/15 text-jade-400" : "bg-flame-500/15 text-flame-400"}`}>{dir}</span>
      <span className="text-ash-300 truncate flex-1">{dir === "OUT" ? "→ " : "← "}{other}</span>
      <span className="font-mono text-[9px] text-ash-500">{channel ?? ""}</span>
      <span className="font-mono tnum text-ash-100">{inr(amount)}</span>
    </div>
  );
}