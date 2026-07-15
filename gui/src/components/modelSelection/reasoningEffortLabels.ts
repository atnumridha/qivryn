export const EFFORT_LABELS: Record<string, string> = {
  none: "Off",
  minimal: "Minimal",
  low: "Light",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  "x-high": "Extra High",
  x_high: "Extra High",
  extra_high: "Extra High",
  max: "Max",
  ultra: "Ultra",
};

export function formatReasoningEffort(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (EFFORT_LABELS[normalized]) {
    return EFFORT_LABELS[normalized];
  }

  return normalized
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
