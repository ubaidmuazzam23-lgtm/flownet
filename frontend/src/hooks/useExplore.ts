// frontend/src/hooks/useExplore.ts
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { apiGet } from "../lib/api";

// ---------- Hierarchy ----------
export interface HAccount {
  account_id: string;
  holder: string | null;
  person_id: string | null;
  fraud_type: string | null;
  confidence: number | null;
  flagged: boolean;
}
export interface HBranch { branch: string; branch_id: string | null; accounts: HAccount[]; flagged_count: number; }
export interface HCity { city: string; branches: HBranch[]; flagged_count: number; }
export interface HRegion { region: string; cities: HCity[]; flagged_count: number; }
export interface Hierarchy { regions: HRegion[]; total_accounts: number; total_flagged: number; }

export function useHierarchy(flaggedOnly: boolean) {
  const { getToken } = useAuth();
  const [data, setData] = useState<Hierarchy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setData(await apiGet<Hierarchy>(`/explore/hierarchy?flagged_only=${flaggedOnly}`, getToken));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load hierarchy");
    } finally { setLoading(false); }
  }, [flaggedOnly, getToken]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

// ---------- Node explorer ----------
export interface Neighbor {
  account_id: string;
  holder: string | null;
  direction: "IN" | "OUT";
  amount: number;
  channel: string | null;
  timestamp: string | null;
  fraud_type: string | null;
  confidence: number | null;
  flagged: boolean;
}
export interface NodeInfo {
  account_id: string;
  holder: string | null;
  branch: string | null;
  fraud_type: string | null;
  confidence: number | null;
  flagged: boolean;
  neighbors: Neighbor[];
}
export interface Seed {
  account_id: string; holder: string | null; fraud_type: string; confidence: number;
}

export function useFlaggedSeeds() {
  const { getToken } = useAuth();
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    apiGet<{ seeds: Seed[] }>(`/explore/flagged-seeds`, getToken)
      .then((r) => { if (!cancelled) setSeeds(r.seeds); })
      .catch(() => { if (!cancelled) setSeeds([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [getToken]);
  return { seeds, loading };
}

// fetch a single node's neighbors on demand (used by click-to-expand)
export function useNodeFetcher() {
  const { getToken } = useAuth();
  return useCallback(
    (accountId: string) => apiGet<NodeInfo>(`/explore/node/${accountId}`, getToken),
    [getToken]
  );
}