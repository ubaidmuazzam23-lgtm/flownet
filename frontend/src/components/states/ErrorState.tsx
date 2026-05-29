// frontend/src/components/states/ErrorState.tsx
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
      <div className="flex-1 grid place-items-center text-ash-400">
        <div className="text-center max-w-md">
          <div className="font-display text-lg text-danger-500">Something went wrong</div>
          <div className="text-[12px] font-mono text-ash-500 mt-2 break-words">{message}</div>
          {onRetry && (
            <button onClick={onRetry}
              className="mt-4 px-4 h-9 rounded-md bg-flame-500 hover:bg-flame-600 text-white text-[12px]">
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }