// frontend/src/hooks/usePredictionDetail.ts
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { apiGet } from "../lib/api";
import type { PredictionDetail } from "../types";

export function usePredictionDetail(accountId: string | null) {
  const { getToken } = useAuth();
  const [data, setData] = useState<PredictionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<PredictionDetail>(`/predictions/${accountId}/detail`, getToken)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? "Failed to load detail");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, getToken]);

  return { data, loading, error };
}