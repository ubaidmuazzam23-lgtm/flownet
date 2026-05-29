// frontend/src/hooks/usePredictions.ts
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { apiGet } from "../lib/api";
import type { PredictionList } from "../types";

export function usePredictions(limit = 60) {
  const { getToken } = useAuth();
  const [data, setData] = useState<PredictionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<PredictionList>(
        `/predictions?limit=${limit}`,
        getToken
      );
      setData(res);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load predictions");
    } finally {
      setLoading(false);
    }
  }, [limit, getToken]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}