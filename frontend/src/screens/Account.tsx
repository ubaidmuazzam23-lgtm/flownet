// frontend/src/screens/Account.tsx
import { useState } from "react";
import { useAccounts, useAccountDetail } from "../hooks/useAccounts";
import { inr, inrFull, shortTime } from "../lib/format";
import { Loading } from "../components/states/Loading";
import { Empty } from "../components/states/Empty";
import { ErrorState } from "../components/states/ErrorState";

export default function Account() {
  const { data, loading, error, reload } = useAccounts(100);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  if (loading) return <Loading label="Loading accounts…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data || data.items.length === 0)
    return <Empty title="No accounts" hint="No accounts found in the database." />;

  const filtered = data.items.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.account_id.includes(q) ||
      (a.actor ?? "").toLowerCase().includes(q) ||
      (a.branch ?? "").toLowerCase().includes(q)
    );
  });

  const activeId = selected ?? data.items[0].account_id;

  return (
    <div className="flex-1 flex flex-col bg-ink-900 text-ash-100 overflow-hidden">
      <div className="px-6 pt-5 pb-3 border-b border-line">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-[24px] font-semibold tracking-tight leading-none">Accounts</h1>
            <div className="text-[12px] text-ash-400 mt-1.5">{data.total} accounts</div>
          </div>
          <div className="flex items-center gap-2 border border-line rounded-md bg-ink-800 px-2.5 h-9 w-[280px]">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search account, holder, branch…"
              className="bg-transparent flex-1 outline-none text-[12.5px] text-ash-100" />
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-[1.3fr_1fr] min-h-0">
        {/* LIST */}
        <div className="overflow-auto border-r border-line">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-ink-900 z-10">
              <tr className="text-[10.5px] font-mono uppercase tracking-wider text-ash-500">
                <th className="text-left font-medium px-4 py-2.5">Account</th>
                <th className="text-left font-medium px-3 py-2.5">Type</th>
                <th className="text-left font-medium px-3 py-2.5">Status</th>
                <th className="text-left font-medium px-3 py-2.5">Branch</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const isSel = activeId === a.account_id;
                const statusColor =
                  a.status === "DORMANT" ? "#FFC542" :
                  a.status === "FROZEN" ? "#FF4D4F" : "#52C41A";
                return (
                  <tr key={a.account_id} onClick={() => setSelected(a.account_id)}
                    className={`cursor-pointer border-b border-line/50 hover:bg-ink-800/50 ${isSel ? "bg-flame-500/[0.05]" : ""}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-mono tnum text-[11.5px]">{a.account_id}</div>
                      <div className="text-[10.5px] text-ash-400">{a.actor ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2.5 text-ash-300">{a.account_type ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] px-1.5 py-0.5 rounded border"
                        style={{ borderColor: statusColor + "44", background: statusColor + "12", color: statusColor }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
                        {a.status ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-ash-300">{a.branch ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* DETAIL */}
        <div className="overflow-auto p-4 no-scrollbar">
          <AccountDetailPanel accountId={activeId} />
        </div>
      </div>
    </div>
  );
}

function AccountDetailPanel({ accountId }: { accountId: string }) {
  const { data, loading, error } = useAccountDetail(accountId);

  if (loading) return <div className="text-[12px] font-mono text-ash-500 p-4">Loading…</div>;
  if (error) return <div className="text-[12px] font-mono text-danger-500 p-4">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="rounded-xl border border-line bg-ink-800 p-4 hud-corners">
        <div className="text-[10px] font-mono tracking-wider text-ash-500">{data.account_id}</div>
        <div className="font-display text-[18px] font-semibold mt-1">{data.actor ?? "Unknown holder"}</div>
        <div className="text-[11.5px] font-mono text-ash-400 mt-0.5">
          {[data.branch, data.city, data.region].filter(Boolean).join(" · ") || "—"}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          {data.occupation && <Ctx label="OCCUPATION" value={data.occupation} />}
          {data.declared_income != null && <Ctx label="DECLARED INCOME" value={inr(data.declared_income)} />}
          {data.account_type && <Ctx label="ACCOUNT TYPE" value={data.account_type} />}
          {data.status && <Ctx label="STATUS" value={data.status} />}
          {data.customer_since && <Ctx label="CUSTOMER SINCE" value={data.customer_since} />}
          {data.created_date && <Ctx label="OPENED" value={data.created_date.slice(0, 10)} />}
        </div>
      </div>

      {/* Flow summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-ink-800 p-4">
          <div className="text-[10px] font-mono text-ash-500 tracking-wider">TOTAL IN</div>
          <div className="font-display text-[20px] font-semibold tnum text-jade-400 mt-1">{inr(data.total_in)}</div>
        </div>
        <div className="rounded-xl border border-line bg-ink-800 p-4">
          <div className="text-[10px] font-mono text-ash-500 tracking-wider">TOTAL OUT</div>
          <div className="font-display text-[20px] font-semibold tnum text-flame-400 mt-1">{inr(data.total_out)}</div>
        </div>
      </div>

      {/* Transactions */}
      <div className="rounded-xl border border-line bg-ink-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10.5px] font-mono uppercase tracking-wider text-ash-400">Transaction History</div>
          <div className="text-[10.5px] font-mono text-ash-500">{data.transactions.length} txns</div>
        </div>
        <div className="space-y-1 max-h-[360px] overflow-auto no-scrollbar">
          {data.transactions.length === 0 && <div className="text-[11px] text-ash-500">No transactions.</div>}
          {data.transactions.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] py-1.5 border-b border-line/30">
              <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded ${t.direction === "IN" ? "bg-jade-500/15 text-jade-400" : "bg-flame-500/15 text-flame-400"}`}>
                {t.direction}
              </span>
              <span className="font-mono text-[10px] text-ash-500 w-24 shrink-0">{shortTime(t.timestamp)}</span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-ash-300">{t.channel ?? "—"}</span>
              <span className="ml-auto font-mono tnum text-ash-100">{inrFull(t.amount)}</span>
            </div>
          ))}
        </div>
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