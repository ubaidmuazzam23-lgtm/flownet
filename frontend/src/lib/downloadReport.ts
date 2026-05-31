// frontend/src/lib/downloadReport.ts
//
// Helper for the "Generate FIU Report" buttons. POSTs to the given endpoint,
// pulls the streamed PDF as a Blob, and triggers a browser download.
import { useAuth } from "@clerk/clerk-react";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export async function downloadFiuReport(
  path: string,
  getToken: () => Promise<string | null>,
  body?: unknown,
  filenameFallback = "FlowNet-STR.pdf",
): Promise<void> {
  const token = await getToken();
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Report generation failed (${res.status})`;
    try { const j = await res.json(); if (j?.detail) msg = j.detail; } catch { /* ignore */ }
    throw new Error(msg);
  }
  // pull filename from Content-Disposition if present
  const disp = res.headers.get("Content-Disposition") ?? "";
  const m = /filename="?([^"]+)"?/i.exec(disp);
  const filename = m?.[1] ?? filenameFallback;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// React hook helper — used by buttons
export function useFiuReport() {
  const { getToken } = useAuth();
  return (path: string, body?: unknown, filename?: string) =>
    downloadFiuReport(path, () => getToken(), body, filename);
}