// frontend/src/components/ReportButton.tsx
//
// "Generate FIU Report" button. Calls the backend, downloads the streamed PDF.
// Real values only — the report itself reflects what the backend builds from
// the actual database + model output.
import { useState } from "react";
import { useFiuReport } from "../lib/downloadReport";

export function ReportButton({
  path,
  body,
  filename,
  label = "Generate FIU Report",
  size = "md",
}: {
  path: string;
  body?: unknown;
  filename?: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const fetchReport = useFiuReport();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setErr(null); setBusy(true);
    try { await fetchReport(path, body, filename); }
    catch (x: any) { setErr(x?.message ?? "Report failed"); }
    finally { setBusy(false); }
  };

  const sz = size === "sm" ? "text-[10.5px] px-2 py-1" : "text-[11px] px-2.5 py-1.5";
  return (
    <div className="inline-flex flex-col gap-0.5">
      <button
        onClick={onClick}
        disabled={busy}
        className={`${sz} inline-flex items-center gap-1.5 rounded-md border border-flame-500/40 bg-flame-500/10 text-flame-400 hover:bg-flame-500/20 disabled:opacity-50 disabled:cursor-wait font-mono uppercase tracking-wider transition-colors`}
        title="Generate a Suspicious Transaction Report PDF for filing with the FIU">
        <span aria-hidden="true">⇩</span>
        {busy ? "Building PDF…" : label}
      </button>
      {err && <span className="text-[9.5px] font-mono text-danger-500">{err}</span>}
    </div>
  );
}