const HOST_DISPLAY_NAMES: Record<string, string> = {
  "union-inesctec": "Union INESC TEC"
};

export function formatHostName(hostName: string | null | undefined): string {
  const normalized = hostName?.trim();
  if (!normalized) return "-";
  return HOST_DISPLAY_NAMES[normalized.toLowerCase()] || normalized;
}
