// frontend/src/components/states/Loading.tsx
export function Loading({ label = "Loading…" }: { label?: string }) {
    return (
      <div className="flex-1 grid place-items-center text-ash-400">
        <div className="text-center">
          <div className="w-8 h-8 mx-auto rounded-full border-2 border-line border-t-flame-500 animate-spin" />
          <div className="text-[12px] font-mono text-ash-500 mt-3 tracking-wider">{label}</div>
        </div>
      </div>
    );
  }