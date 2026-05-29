// frontend/src/components/states/Empty.tsx
export function Empty({ title = "Nothing here", hint }: { title?: string; hint?: string }) {
    return (
      <div className="flex-1 grid place-items-center text-ash-400">
        <div className="text-center max-w-sm">
          <div className="font-display text-lg text-ash-200">{title}</div>
          {hint && <div className="text-[12px] text-ash-500 mt-2">{hint}</div>}
        </div>
      </div>
    );
  }