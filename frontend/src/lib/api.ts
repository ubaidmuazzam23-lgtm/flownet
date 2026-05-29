// frontend/src/lib/api.ts
// Single fetch wrapper for all backend calls.
// Account IDs are 15-digit bigints — always kept as strings, never Number().

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

type TokenGetter = () => Promise<string | null>;

export async function apiGet<T>(
  path: string,
  getToken?: TokenGetter
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (getToken) {
    const token = await getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export { BASE_URL };