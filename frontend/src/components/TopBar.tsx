// frontend/src/components/TopBar.tsx
import { useEffect, useState } from "react";

export function TopBar({ screenLabel }: { screenLabel?: string }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const hh = String(time.getHours()).padStart(2, "0");
  const mm = String(time.getMinutes()).padStart(2, "0");
  const ss = String(time.getSeconds()).padStart(2, "0");

  return (
    <header className="h-14 shrink-0 border-b border-line bg-ink-900 flex items-center px-5 gap-4">
      <div className="flex items-center gap-2 text-[10px] font-mono text-ash-500 tracking-[0.18em]">
        <span>FLOWNET</span>
        <span className="text-ash-600">›</span>
        <span className="text-ash-300 uppercase">{screenLabel}</span>
      </div>

      <div className="hidden md:flex items-center gap-2 ml-2 px-3 py-1.5 rounded-md border border-line bg-ink-800 w-[420px] max-w-[40vw]">
        <input
          className="bg-transparent outline-none text-[13px] flex-1 placeholder:text-ash-500 text-ash-100"
          placeholder="Search account, alert, entity…"
        />
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <button className="h-8 px-2.5 inline-flex items-center gap-2 rounded-md border border-line bg-ink-800 hover:bg-ink-700 text-[12px] text-ash-200">
          <span className="font-mono">LIVE</span>
          <span className="w-1.5 h-1.5 rounded-full bg-jade-500 animate-pulse" />
        </button>
        <button className="h-8 px-2.5 inline-flex items-center gap-2 rounded-md border border-line bg-ink-800 hover:bg-ink-700 text-[12px] text-ash-200 font-mono tnum">
          {hh}:{mm}:<span className="text-ash-400">{ss}</span> IST
        </button>
      </div>
    </header>
  );
}