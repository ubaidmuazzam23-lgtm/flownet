// frontend/src/lib/format.ts
// Display helpers only — no logic that affects detection.

export function inr(amount: number): string {
    if (amount >= 1e7) return `₹${(amount / 1e7).toFixed(2)} Cr`;
    if (amount >= 1e5) return `₹${(amount / 1e5).toFixed(2)} L`;
    return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
  
  export function inrFull(amount: number): string {
    return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
  
  export function shortTime(ts: string): string {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  }