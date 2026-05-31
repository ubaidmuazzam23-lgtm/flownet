// frontend/src/screens/Alerts.tsx
import { useState } from "react";
import { usePredictions } from "../hooks/usePredictions";
import { usePredictionDetail } from "../hooks/usePredictionDetail";
import { useLayeringAccounts, useNodeLayering } from "../hooks/useLayering";
import { ReportButton } from "../components/ReportButton";
import { fraudStyle, confidenceTier } from "../lib/fraudTypes";
import { inr, inrFull, shortTime } from "../lib/format";
import { Loading } from "../components/states/Loading";
import { Empty } from "../components/states/Empty";
import { ErrorState } from "../components/states/ErrorState";
import { FRAUD_CLASSES } from "../types";

export default function Alerts() {
  const { data, loading, error, reload } = usePredictions(60);
  const layer = useLayeringAccounts();
  const [selected, setSelected] = useState<string | null>(null);

  if (loading) return <Loading label="Running model across accounts…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data || data.items.length === 0)
    return <Empty title="No alerts" hint="The model found no suspicious activity in the scanned accounts." />;

  const activeId = selected ?? data.items[0].account_id;

  return (
    <div className="flex-1 flex flex-col bg-ink-900 text-ash-100 overflow-hidden">
      <div className="px-6 pt-5 pb-3 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-[24px] font-semibold tracking-tight leading-none">Fraud Alerts</h1>
            <div className="text-[12px] text-ash-400 mt-1.5">
              {data.total} flagged by the model · highest confidence first
            </div>
          </div>
          <button onClick={reload} className="h-9 px-3 text-[12px] rounded-md border border-line bg-ink-800 hover:bg-ink-700">
            Refresh
          </button>
        </div>
      </div>


      <div className="flex-1 grid grid-cols-[1.3fr_1fr] min-h-0">
        {/* TABLE */}
        <div className="overflow-auto border-r border-line">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-ink-900 z-10">
              <tr className="text-[10.5px] font-mono uppercase tracking-wider text-ash-500">
                <th className="text-left font-medium px-4 py-2.5">Account</th>
                <th className="text-left font-medium px-3 py-2.5">Type</th>
                <th className="text-left font-medium px-3 py-2.5">Confidence</th>
                <th className="text-left font-medium px-3 py-2.5">Branch</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => {
                const isSel = activeId === a.account_id;
                const st = fraudStyle(a.fraud_type);
                const tier = confidenceTier(a.confidence);
                return (
                  <tr key={a.account_id} onClick={() => setSelected(a.account_id)}
                    className={`cursor-pointer border-b border-line/50 hover:bg-ink-800/50 ${isSel ? "bg-flame-500/[0.05]" : ""}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-mono tnum text-[11.5px]">{a.account_id}</div>
                      <div className="text-[10.5px] text-ash-400">{a.actor ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 rounded border font-mono text-[10px] px-1.5 py-0.5"
                        style={{ borderColor: st.color + "44", background: st.color + "12", color: st.color }}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] px-1.5 py-0.5 rounded border"
                        style={{ borderColor: tier.color + "55", background: tier.color + "12", color: tier.color }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: tier.color }} />
                        {tier.label} · {(a.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-ash-300">{a.branch ?? "—"}</td>
                  </tr>
                );
              })}
              {layer.data && layer.data.model_loaded && layer.data.accounts.length > 0 && (
                <>
                  <tr>
                    <td colSpan={4} className="px-4 pt-4 pb-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-danger-500">
                        Rapid Layering · TGN · transaction-level model
                      </span>
                    </td>
                  </tr>
                  {layer.data.accounts.map((a) => {
                    const isSel = activeId === a.account_id;
                    return (
                      <tr key={"tgn-" + a.account_id} onClick={() => setSelected(a.account_id)}
                        className={`cursor-pointer border-b border-line/50 hover:bg-ink-800/50 ${isSel ? "bg-danger-500/[0.06]" : ""}`}>
                        <td className="px-4 py-2.5">
                          <div className="font-mono tnum text-[11.5px]">{a.account_id}</div>
                          <div className="text-[10.5px] text-ash-400">{a.actor ?? "—"}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5 rounded border font-mono text-[10px] px-1.5 py-0.5"
                            style={{ borderColor: "#E5247A44", background: "#E5247A12", color: "#E5247A" }}>
                            Layering (TGN)
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] px-1.5 py-0.5 rounded border"
                            style={{ borderColor: "#E5247A55", background: "#E5247A12", color: "#E5247A" }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#E5247A" }} />
                            {a.flagged_out} txn{a.flagged_out === 1 ? "" : "s"} · {(a.max_prob * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-ash-300">{inr(a.total_amount)}</td>
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* DETAIL */}
        <div className="overflow-auto p-4 no-scrollbar">
          <DetailPanel accountId={activeId} />
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ accountId }: { accountId: string }) {
  const { data, loading, error } = usePredictionDetail(accountId);
  const nodeLayer = useNodeLayering(accountId).data;

  // build a set of "amount|counterparty4" keys the TGN flagged, for highlighting
  const flaggedKey = (cp: string, amount: number) => `${cp.slice(-4)}|${Math.round(amount)}`;
  const flaggedMap = new Map<string, number>();
  (nodeLayer?.flagged ?? []).forEach((f) => {
    flaggedMap.set(flaggedKey(f.counterparty, f.amount), f.layering_prob);
  });

  if (loading) return <div className="text-[12px] font-mono text-ash-500 p-4">Loading detail…</div>;
  if (error) return <div className="text-[12px] font-mono text-danger-500 p-4">{error}</div>;
  if (!data) return null;

  const p = data.prediction;
  const st = fraudStyle(p.fraud_type);
  const tier = confidenceTier(p.confidence);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="rounded-xl border border-line bg-ink-800 p-4 hud-corners">
        <div className="text-[10px] font-mono tracking-wider text-ash-500">{p.account_id}</div>
        <div className="font-display text-[18px] font-semibold mt-1">{p.actor ?? "Unknown holder"}</div>
        <div className="text-[11.5px] font-mono text-ash-400 mt-0.5">{p.branch ?? "—"}</div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 rounded border font-mono text-[11px] px-2 py-1"
            style={{ borderColor: st.color + "44", background: st.color + "12", color: st.color }}>{st.label}</span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] px-2 py-1 rounded border"
            style={{ borderColor: tier.color + "55", background: tier.color + "12", color: tier.color }}>
            {tier.label} · {(p.confidence * 100).toFixed(1)}%
          </span>
        </div>
        <div className="mt-3">
          <ReportButton
            path={`/reports/account/${p.account_id}`}
            filename={`FlowNet-STR-Account-${p.account_id}.pdf`}
            size="sm"
          />
        </div>
        {/* account context */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          {data.occupation && <Ctx label="OCCUPATION" value={data.occupation} />}
          {data.declared_income != null && <Ctx label="DECLARED INCOME" value={inr(data.declared_income)} />}
          {data.account_type && <Ctx label="ACCOUNT TYPE" value={data.account_type} />}
          {data.account_status && <Ctx label="STATUS" value={data.account_status} />}
        </div>
      </div>

      {/* Model output */}
      <div className="rounded-xl border border-line bg-ink-800 p-4">
        <div className="text-[10.5px] font-mono uppercase tracking-wider text-ash-400 mb-3">Model Output · BiLSTM</div>
        <div className="space-y-2">
          {p.prediction_vector.map((v, i) => {
            const s = fraudStyle(FRAUD_CLASSES[i]);
            const isTop = FRAUD_CLASSES[i] === p.fraud_type;
            return (
              <div key={i} className="flex items-center gap-2">
                <div className="w-28 text-[11px] font-mono text-ash-300 truncate">{FRAUD_CLASSES[i]}</div>
                <div className="flex-1 h-2.5 rounded-full bg-ink-700 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${v * 100}%`, background: s.color, opacity: isTop ? 1 : 0.5 }} />
                </div>
                <div className="w-12 text-right text-[10.5px] font-mono tnum text-ash-300">{(v * 100).toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Real transactions the model saw */}
      <div className="rounded-xl border border-line bg-ink-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10.5px] font-mono uppercase tracking-wider text-ash-400">
            Transactions the model analysed
          </div>
          <div className="text-[10.5px] font-mono text-ash-500">
            {data.transactions.length} txns{nodeLayer && nodeLayer.flagged.length > 0 ? ` · ${nodeLayer.flagged.length} TGN-flagged` : ""}
          </div>
        </div>
        <div className="space-y-1 max-h-[320px] overflow-auto no-scrollbar">
          {data.transactions.length === 0 && (
            <div className="text-[11px] text-ash-500">No transactions found.</div>
          )}
          {data.transactions.map((t, i) => {
            const tgnProb = t.counterparty ? flaggedMap.get(flaggedKey(t.counterparty, t.amount)) : undefined;
            const isFlagged = tgnProb !== undefined;
            return (
              <div key={i}
                className={`flex items-center gap-2 text-[11px] py-1.5 border-b ${isFlagged ? "border-l-2 pl-2 -ml-2 rounded-r" : "border-line/30"}`}
                style={isFlagged ? { borderColor: "#E5247A", background: "#E5247A0D", borderBottomColor: "#E5247A33" } : undefined}>
                <span className="font-mono text-[10px] text-ash-500 w-24 shrink-0">{shortTime(t.timestamp)}</span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-ash-300">{t.channel ?? "—"}</span>
                <span className="font-mono text-[10px] text-ash-500">{t.counterparty ? t.counterparty.slice(-4) : ""}</span>
                {isFlagged && (
                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: "#E5247A1A", color: "#E5247A" }}>
                    TGN {Math.round((tgnProb as number) * 100)}%
                  </span>
                )}
                <span className="ml-auto font-mono tnum text-ash-100">{inrFull(t.amount)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-[10.5px] font-mono text-ash-500 px-1">
        Predicted at {new Date(p.timestamp).toLocaleString()}
      </div>
    </div>
  );
}

function Ctx({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-ink-700/50 px-2.5 py-1.5">
      <div className="text-[9px] font-mono text-ash-500 tracking-wider">{label}</div>
      <div className="text-[12px] text-ash-200 mt-0.5">{value}</div>
    </div>
  );
}