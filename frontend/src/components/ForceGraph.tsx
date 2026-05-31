// frontend/src/components/ForceGraph.tsx
// Force-directed fund-flow graph: physics sim, pan/zoom, directional arrowheads,
// amount labels, verdict colors. In trace mode, edges colour by hop distance.
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode, GraphEdge } from "../hooks/useGraph";
import { fraudStyle } from "../lib/fraudTypes";

interface SimNode extends GraphNode { x: number; y: number; vx: number; vy: number; }

const FLOW_COLOR = "#FF6D29";
const IN_COLOR = "#52C41A";
const OUT_COLOR = "#FF6D29";
const HOP_COLORS = ["#FF6D29", "#FFC542", "#1677FF", "#722ED1"];
const CYCLE_COLOR = "#B11226"; // dark red — circular/laundering loop
const LAYER_COLOR = "#E5247A"; // magenta — TGN rapid-layering edge

function shortAmt(a: number): string {
  if (a >= 1e7) return `₹${(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `₹${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${(a / 1e3).toFixed(0)}k`;
  return `₹${a.toFixed(0)}`;
}

export function ForceGraph({
  nodes, edges, onSelect, selectedId, onSelectEdge, traceMode = false, origin = null, highlightPath = null, circularMode = false, layeringMode = false, closingEdge = null,
}: {
  nodes: GraphNode[]; edges: GraphEdge[];
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
  onSelectEdge?: (e: GraphEdge | null) => void;
  traceMode?: boolean; origin?: string | null; highlightPath?: Set<string> | null; circularMode?: boolean; layeringMode?: boolean; closingEdge?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<null | { sx: number; sy: number; vx: number; vy: number }>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const measure = () => { const el = containerRef.current; if (!el) return; const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const simRef = useRef<{ nodes: SimNode[]; map: Record<string, SimNode> }>({ nodes: [], map: {} });
  useEffect(() => {
    const cx = size.w / 2, cy = size.h / 2;
    const sim: SimNode[] = nodes.map((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const radius = 200 + Math.random() * 240;
      return { ...n, x: cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 50, y: cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 50, vx: 0, vy: 0 };
    });
    const map: Record<string, SimNode> = {};
    sim.forEach((n) => (map[n.id] = n));
    simRef.current = { nodes: sim, map };
  }, [nodes, size.w, size.h]);

  useEffect(() => {
    let raf = 0, alpha = 1;
    const step = () => {
      const { nodes: sim, map } = simRef.current;
      if (sim.length === 0) { raf = requestAnimationFrame(step); return; }
      const cx = size.w / 2, cy = size.h / 2, n = sim.length;
      const rep = n > 60 ? 8000 : 12000;
      for (let i = 0; i < n; i++) {
        const a = sim[i];
        for (let j = i + 1; j < n; j++) {
          const b = sim[j];
          let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < 1) d2 = 1;
          const d = Math.sqrt(d2), force = (rep / d2) * alpha;
          const fx = (dx / d) * force, fy = (dy / d) * force;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
        a.vx += (cx - a.x) * 0.0015 * alpha; a.vy += (cy - a.y) * 0.0015 * alpha;
      }
      for (const e of edges) {
        const a = map[e.source], b = map[e.target];
        if (!a || !b) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1, target = 170;
        const force = (d - target) * 0.018 * alpha;
        const fx = (dx / d) * force, fy = (dy / d) * force;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      for (const nd of sim) { nd.vx *= 0.84; nd.vy *= 0.84; nd.x += nd.vx; nd.y += nd.vy; }
      alpha *= 0.99; if (alpha < 0.02) alpha = 0.02;
      tick((t) => t + 1); raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [edges, size.w, size.h, nodes]);

  const neighbors = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const e of edges) { (m[e.source] ??= new Set()).add(e.target); (m[e.target] ??= new Set()).add(e.source); }
    return m;
  }, [edges]);

  const focus = selectedId ?? hover;
  const isLit = (id: string) => { if (!focus) return true; if (id === focus) return true; return neighbors[focus]?.has(id) ?? false; };
  const edgeLit = (e: GraphEdge) => { if (!focus) return false; return e.source === focus || e.target === focus; };

  const onWheel = (ev: React.WheelEvent) => {
    ev.preventDefault();
    const delta = -ev.deltaY * 0.0015;
    setView((v) => {
      const k = Math.min(3.5, Math.max(0.3, v.k * (1 + delta)));
      const rect = containerRef.current!.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      const wx = (mx - v.x) / v.k, wy = (my - v.y) / v.k;
      return { k, x: mx - wx * k, y: my - wy * k };
    });
  };
  const onDown = (ev: React.MouseEvent) => {
    if ((ev.target as Element).closest("[data-node]")) return;
    if ((ev.target as Element).closest("[data-edge]")) return;
    setDrag({ sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y });
  };
  const onMove = (ev: React.MouseEvent) => { if (!drag) return; setView((v) => ({ ...v, x: drag.vx + (ev.clientX - drag.sx), y: drag.vy + (ev.clientY - drag.sy) })); };
  const onUp = () => setDrag(null);

  const { nodes: sim, map } = simRef.current;
  const edgeWidth = (amt: number) => Math.max(1, Math.min(5, Math.log10(Math.max(10, amt)) - 1.5));
  const nodeRadius = (nd: SimNode) =>
    (nd as any).ovSize != null ? (nd as any).ovSize
    : (nd.fraud_type && nd.fraud_type !== "Normal" ? 10 : 6) + (nd.confidence ? nd.confidence * 5 : 0);
  const nodeColor = (nd: SimNode) =>
    (nd as any).ovColor ? (nd as any).ovColor
    : (!nd.fraud_type || nd.fraud_type === "Normal" ? "#4E4A55" : fraudStyle(nd.fraud_type).color);
  const showAllLabels = view.k >= 1.15 || nodes.length <= 16;

  const edgeColor = (e: GraphEdge, lit: boolean, isIn: boolean) => {
    if (traceMode && e.hop) return HOP_COLORS[(e.hop - 1) % 4];
    if (lit) return isIn ? IN_COLOR : OUT_COLOR;
    return "#6C6772";
  };

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden select-none vignette"
      onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
      style={{ cursor: drag ? "grabbing" : "grab" }}>
      <svg width="100%" height="100%" style={{ display: "block" }}>
        <defs>
          <radialGradient id="fg-bg" cx="50%" cy="45%" r="70%"><stop offset="0%" stopColor="#1A171B" /><stop offset="100%" stopColor="#0E0C0F" /></radialGradient>
          <pattern id="fg-grid" width="46" height="46" patternUnits="userSpaceOnUse"><path d="M 46 0 L 0 0 0 46" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" /></pattern>
          {[["dim", "#6C6772"], ["out", OUT_COLOR], ["in", IN_COLOR], ["h1", HOP_COLORS[0]], ["h2", HOP_COLORS[1]], ["h3", HOP_COLORS[2]], ["h4", HOP_COLORS[3]], ["cyc", CYCLE_COLOR], ["lay", LAYER_COLOR]].map(([id, col]) => (
            <marker key={id} id={`arrow-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={col} />
            </marker>
          ))}
        </defs>
        <rect width="100%" height="100%" fill="url(#fg-bg)" />
        <rect width="100%" height="100%" fill="url(#fg-grid)" />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {edges.map((e, i) => {
            const a = map[e.source], b = map[e.target];
            if (!a || !b) return null;
            const lit = edgeLit(e), dim = focus && !lit, w = e.nonTransactional ? 0.8 : edgeWidth(e.amount);
            const isIn = !!focus && e.target === focus;
            const col = edgeColor(e, lit || traceMode, isIn);
            const ra = nodeRadius(a) + 4, rb = nodeRadius(b) + 8;
            const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1;
            const ux = dx / dist, uy = dy / dist;
            const ax = a.x + ux * ra, ay = a.y + uy * ra, bx = b.x - ux * rb, by = b.y - uy * rb;
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            const nx = -(by - ay), ny = bx - ax, nlen = Math.hypot(nx, ny) || 1;
            const curve = 0.08 * (i % 2 === 0 ? 1 : -1), span = Math.hypot(bx - ax, by - ay);
            const cxp = mx + (nx / nlen) * span * curve, cyp = my + (ny / nlen) * span * curve;
            const path = `M ${ax} ${ay} Q ${cxp} ${cyp} ${bx} ${by}`;
            const onPath = highlightPath ? highlightPath.has(`${e.source}->${e.target}`) : false;
            const isClosing = closingEdge === `${e.source}->${e.target}`;
            const pathActive = !!highlightPath;
            const active = onPath || (!pathActive && (traceMode || lit));
            const mk = dim ? "" : traceMode && e.hop ? `url(#arrow-h${((e.hop - 1) % 4) + 1})` : lit ? (isIn ? "url(#arrow-in)" : "url(#arrow-out)") : "url(#arrow-dim)";
            const showLabel = layeringMode || isClosing || ((active || showAllLabels) && !dim);
            return (
              <g key={i} data-edge opacity={layeringMode ? 1 : pathActive ? (onPath ? 1 : 0.06) : dim ? 0.06 : 1} style={{ transition: "opacity 250ms", cursor: "pointer" }}
                onClick={(ev) => { ev.stopPropagation(); onSelectEdge?.(e); }}>
                <path d={path} fill="none" stroke={layeringMode ? LAYER_COLOR : isClosing ? CYCLE_COLOR : onPath ? "#925CE6" : col} strokeWidth={layeringMode ? w + 2 : isClosing ? w + 2.5 : onPath ? w + 2.5 : w} strokeOpacity={layeringMode ? 0.95 : active || isClosing ? 0.97 : 0.45} markerEnd={layeringMode ? "url(#arrow-lay)" : isClosing ? "url(#arrow-cyc)" : onPath ? "url(#arrow-h4)" : mk} />
                <path d={path} fill="none" stroke="transparent" strokeWidth={12} />
                {showLabel && (
                  <g transform={`translate(${cxp},${cyp})`}>
                    <rect x={-18} y={-8} width={36} height={14} rx={3} fill="#0E0C0F" opacity={0.82} stroke={isClosing ? CYCLE_COLOR : active ? col : "#2B262E"} strokeWidth={0.6} />
                    {e.nonTransactional ? (active && <text textAnchor="middle" dy={2.5} fontFamily="JetBrains Mono, monospace" fontSize={7.5} fill="#7C8CF8" letterSpacing="0.5">NON-TXN</text>) : <text textAnchor="middle" dy={2.5} fontFamily="JetBrains Mono, monospace" fontSize={8} fill={isClosing ? "#FF6B7A" : active ? col : "#A8A2B0"}>{shortAmt(e.amount)}</text>}
                  </g>
                )}
              </g>
            );
          })}
          {sim.map((nd) => {
            const lit = isLit(nd.id), dim = focus && !lit, r = nodeRadius(nd), c = nodeColor(nd);
            const isSel = selectedId === nd.id, flagged = nd.fraud_type && nd.fraud_type !== "Normal";
            const isOrigin = traceMode && origin === nd.id;
            const showLabel = isSel || hover === nd.id || showAllLabels || isOrigin || !!(nd as any).ovLabel;
            return (
              <g key={nd.id} data-node transform={`translate(${nd.x},${nd.y})`} opacity={dim ? 0.18 : 1}
                style={{ transition: "opacity 250ms", cursor: "pointer" }}
                onClick={(ev) => { ev.stopPropagation(); onSelect?.(isSel ? null : nd.id); }}
                onMouseEnter={() => setHover(nd.id)} onMouseLeave={() => setHover(null)}>
                <circle r={r + (isSel || isOrigin ? 12 : 7)} fill={isOrigin ? FLOW_COLOR : c} opacity={isSel || isOrigin ? 0.24 : flagged ? 0.12 : 0.06} style={{ filter: "blur(5px)" }} />
                <circle r={r} fill={c} fillOpacity="0.25" stroke={isOrigin ? FLOW_COLOR : c} strokeWidth={isSel || isOrigin ? 2.4 : 1.4} />
                <circle r={2.6} fill={isOrigin ? FLOW_COLOR : c} />
                {isOrigin && <text y={r + 14} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="7.5" fill={FLOW_COLOR}>ORIGIN</text>}
                {showLabel && (
                  <g transform={`translate(0, ${-r - 7})`}>
                    <text textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="9.5" fill="#E5E1EA" style={{ paintOrder: "stroke", stroke: "#0E0C0F", strokeWidth: 3 }}>{(nd as any).ovLabel ?? nd.actor ?? nd.id.slice(-6)}</text>
                    {((nd as any).ovTag || flagged) && <text y="-11" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8" fill={c} style={{ paintOrder: "stroke", stroke: "#0E0C0F", strokeWidth: 3 }}>{(nd as any).ovTag ?? nd.fraud_type!.toUpperCase()}</text>}
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {focus && !traceMode && (
        <div className="absolute top-4 right-4 glass rounded-lg p-3 text-[10.5px] font-mono">
          <div className="flex items-center gap-2"><span className="w-3 h-0.5" style={{ background: OUT_COLOR }} /><span className="text-ash-300">money OUT →</span></div>
          <div className="flex items-center gap-2 mt-1.5"><span className="w-3 h-0.5" style={{ background: IN_COLOR }} /><span className="text-ash-300">← money IN</span></div>
        </div>
      )}

      <div className="absolute bottom-4 right-4 glass rounded-lg p-1 flex flex-col gap-1">
        <button onClick={() => setView((v) => ({ ...v, k: Math.min(3.5, v.k * 1.2) }))} className="w-8 h-8 grid place-items-center hover:bg-ink-700 rounded text-ash-200">+</button>
        <button onClick={() => setView((v) => ({ ...v, k: Math.max(0.3, v.k / 1.2) }))} className="w-8 h-8 grid place-items-center hover:bg-ink-700 rounded text-ash-200">−</button>
        <button onClick={() => setView({ x: 0, y: 0, k: 1 })} className="w-8 h-8 grid place-items-center hover:bg-ink-700 rounded text-ash-200 text-[10px] font-mono">FIT</button>
      </div>
      <div className="absolute bottom-4 left-4 chip font-mono">
        <span className="text-flame-500">●</span><span className="text-ash-400">NODES</span><span className="text-ash-100">{nodes.length}</span>
        <span className="text-ash-600">·</span><span className="text-ash-400">FLOWS</span><span className="text-ash-100">{edges.length}</span>
        <span className="text-ash-600">·</span><span className="text-ash-400">ZOOM</span><span className="text-ash-100">{(view.k * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}