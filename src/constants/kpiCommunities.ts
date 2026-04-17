// Fallback used before API data loads (prevents empty selects on first render).
// The API response at /api/v1/communities overrides these at runtime.
export const COMMUNITY_FALLBACK: Record<string, string[]> = {
  living_lab: ["building_R-H-01"],
  "i-charging_headquarters": ["building_i-charging_headquarters_2"],
  sao_mamede: ["building_SaoMamede"],
};

// No longer exported as a static list.
// Use useKpiMetadata() hook to get the live list.
export const KPI_CATEGORIES = ["energy", "economic", "equity", "ev", "carbon"] as const;
export type KpiCategory = typeof KPI_CATEGORIES[number];
