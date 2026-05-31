// frontend/src/hooks/useGraph.ts
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { apiGet } from "../lib/api";

export interface GraphNode {
  id: string;
  actor: string | null;
  branch: string | null;
  fraud_type: string | null;
  confidence: number | null;
  // optional overrides (used by the Hierarchy force-graph; ignored elsewhere)
  ovColor?: string | null;
  ovLabel?: string | null;
  ovSize?: number | null;
  ovTag?: string | null;
}
export interface GraphEdge {
  /** structural edges (Region->City->Branch->Account, Person->Account) — render without amount */
  nonTransactional?: boolean;
  source: string;
  target: string;
  amount: number;
  channel: string | null;
  timestamp: string | null;
  hop?: number | null;
}
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; }
export interface TraceData extends GraphData {
  origin: string; max_hop: number; total_traced: number;
}

export interface CycleStep { account_id: string; actor: string | null; }
export interface Cycle { path: CycleStep[]; nodes: GraphNode[]; edges: GraphEdge[]; amount: number; hops: number; similarity: number; duration_hours: number | null; fast: boolean; }
export interface CycleList { cycles: Cycle[]; total: number; }

export function useGraph(limit = 150) {
  const { getToken } = useAuth();
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await apiGet<GraphData>(`/graph?limit=${limit}`, getToken)); }
    catch (e: any) { setError(e?.message ?? "Failed to load graph"); }
    finally { setLoading(false); }
  }, [limit, getToken]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export function useTrace(accountId: string | null, hops = 3) {
  const { getToken } = useAuth();
  const [data, setData] = useState<TraceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!accountId) { setData(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    apiGet<TraceData>(`/graph/trace/${accountId}?hops=${hops}`, getToken)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e: any) => { if (!cancelled) setError(e?.message ?? "Trace failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, hops, getToken]);
  return { data, loading, error };
}

export function useCycles(enabled: boolean) {
  const { getToken } = useAuth();
  const [data, setData] = useState<CycleList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true); setError(null);
    apiGet<CycleList>(`/graph/cycles`, getToken)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e: any) => { if (!cancelled) setError(e?.message ?? "Cycle detection failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, getToken]);
  return { data, loading, error };
}