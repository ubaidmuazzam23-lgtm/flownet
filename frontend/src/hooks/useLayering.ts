// frontend/src/hooks/useLayering.ts
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { apiGet } from "../lib/api";

export interface LayerEdge {
  source: string;
  target: string;
  source_actor: string | null;
  target_actor: string | null;
  amount: number;
  channel: string | null;
  timestamp: string | null;
  layering_prob: number;
}
export interface LayerEdges {
  edges: LayerEdge[];
  total: number;
  scored_transactions: number;
  threshold: number;
  trained_accounts: number;
  model_loaded: boolean;
  note: string | null;
}

export interface LayerAccount {
  account_id: string;
  actor: string | null;
  flagged_out: number;
  max_prob: number;
  total_amount: number;
}
export interface LayerAccounts {
  accounts: LayerAccount[];
  total: number;
  threshold: number;
  model_loaded: boolean;
}

export function useLayeringEdges(enabled: boolean) {
  const { getToken } = useAuth();
  const [data, setData] = useState<LayerEdges | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true); setError(null);
    apiGet<LayerEdges>(`/layering/edges`, getToken)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e: any) => { if (!cancelled) setError(e?.message ?? "Layering detection failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, getToken]);
  return { data, loading, error };
}

export function useLayeringAccounts() {
  const { getToken } = useAuth();
  const [data, setData] = useState<LayerAccounts | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    apiGet<LayerAccounts>(`/layering/accounts`, getToken)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [getToken]);
  return { data, loading };
}

export interface NodeLayerTxn {
  counterparty: string;
  direction: "OUT" | "IN";
  amount: number;
  channel: string | null;
  timestamp: string | null;
  layering_prob: number;
}
export interface NodeLayering {
  account_id: string;
  model_loaded: boolean;
  in_trained_scope: boolean;
  threshold: number;
  flagged: NodeLayerTxn[];
}

export function useNodeLayering(accountId: string | null) {
  const { getToken } = useAuth();
  const [data, setData] = useState<NodeLayering | null>(null);
  useEffect(() => {
    if (!accountId) { setData(null); return; }
    let cancelled = false;
    apiGet<NodeLayering>(`/layering/node/${accountId}`, getToken)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [accountId, getToken]);
  return data;
}