// frontend/src/lib/fraudTypes.ts
// Display mapping for the model's fraud classes. No detection logic here —
// purely how each class is shown (color + label). The model decides the class.

export interface FraudStyle {
    label: string;
    color: string;
  }
  
  const STYLES: Record<string, FraudStyle> = {
    Normal:            { label: "Normal",          color: "#52C41A" }, // jade
    Structuring:       { label: "Structuring",     color: "#1677FF" }, // cobalt
    Dormant:           { label: "Dormant",         color: "#FFC542" }, // amber
    "Velocity Spike":  { label: "Velocity Spike",  color: "#FF6D29" }, // flame
    "Sleeping Beauty": { label: "Sleeping Beauty", color: "#722ED1" }, // orchid
    "Micro+Drain":     { label: "Micro+Drain",     color: "#FF4D4F" }, // danger
  };
  
  export function fraudStyle(type: string): FraudStyle {
    return STYLES[type] ?? { label: type, color: "#6C6772" };
  }
  
  // Confidence -> risk tier label/color (based on the MODEL's confidence, not an invented score)
  export function confidenceTier(confidence: number): { label: string; color: string } {
    const pct = confidence * 100;
    if (pct >= 90) return { label: "CRITICAL", color: "#FF4D4F" };
    if (pct >= 75) return { label: "HIGH", color: "#FF6D29" };
    if (pct >= 50) return { label: "MEDIUM", color: "#FFC542" };
    return { label: "LOW", color: "#52C41A" };
  }