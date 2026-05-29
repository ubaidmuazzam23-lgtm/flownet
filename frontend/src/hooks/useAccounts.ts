// frontend/src/hooks/useAccounts.ts
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { apiGet } from "../lib/api";
import type { AccountList, AccountDetail } from "../types";

export function useAccounts(limit = 100) {
  const { getToken } = useAuth();
  const [data, setData] = useState<AccountList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<AccountList>(`/accounts?limit=${limit}`, getToken));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, [limit, getToken]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export function useAccountDetail(accountId: string | null) {
  const { getToken } = useAuth();
  const [data, setData] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<AccountDetail>(`/accounts/${accountId}`, getToken)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e: any) => { if (!cancelled) setError(e?.message ?? "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, getToken]);

  return { data, loading, error };
}
