// What a scheduler run did, as GET api/v1/scheduler/jobs/{id}/runs returns it, and how the
// runs panel summarises it. Kept out of the panel so it can be tested.

export interface KpiValue { value: number | null; unit?: string | null }

export interface CommunityRun {
  buildings: number;
  buildings_with_data?: number;
  windows: number;
  error?: string;
  community: Record<string, KpiValue>;
}

export interface BauHouse {
  house: string;
  site_id: string;
  included: number;
  expected: number;
  reasons: string[];
}

export interface BauComparisonValue { bau: number | null; real: number | null; unit?: string | null }

export interface BauRun {
  id?: string;
  state?: string;
  outcome?: string | null;
  error?: string | null;
  from_ts?: string;
  until_ts?: string;
  houses?: BauHouse[];
  report?: {
    buildings?: string[];
    coverage?: Record<string, number>;
    unmapped_sites?: string[];
    charging_requests?: number;
    windows?: number;
    comparison?: Record<string, Record<string, BauComparisonValue>>;
  };
}

export interface JobRun {
  run_id: string;
  job_id: string;
  started_at: string;
  finished_at?: string;
  status: "running" | "success" | "error";
  error?: string | null;
  period_start?: string;
  period_end?: string;
  communities: Record<string, CommunityRun>;
  bau: Record<string, BauRun>;
}

/** Houses the BAU covered, and why the others were left out (reason → how many houses). */
export function houseCoverage(houses: BauHouse[] = []) {
  const included = houses.filter((h) => h.included > 0);
  const reasons: Record<string, number> = {};
  for (const h of houses) {
    if (h.included > 0) continue;
    for (const r of h.reasons.length ? h.reasons : ["No usable data"]) reasons[r] = (reasons[r] ?? 0) + 1;
  }
  return {
    included,
    excluded: houses.length - included.length,
    reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
  };
}

export interface ComparisonRow { kpi: string; real: number | null; bau: number | null; delta: number | null; unit?: string | null }

/** Real vs BAU rows of one scope, delta = real − BAU. */
export function comparisonRows(bau: BauRun | undefined, scope = "community"): ComparisonRow[] {
  const values = bau?.report?.comparison?.[scope] ?? {};
  return Object.entries(values).map(([kpi, v]) => ({
    kpi,
    real: v.real,
    bau: v.bau,
    delta: v.real != null && v.bau != null ? v.real - v.bau : null,
    unit: v.unit,
  }));
}

/** Scopes of a BAU comparison: the community first, then the houses. */
export function comparisonScopes(bau: BauRun | undefined): string[] {
  const scopes = Object.keys(bau?.report?.comparison ?? {});
  return [...scopes.filter((s) => s === "community"), ...scopes.filter((s) => s !== "community").sort()];
}

/** "12 min", "3 h 05 min" or "—". */
export function duration(start?: string, end?: string): string {
  if (!start || !end) return "—";
  const minutes = Math.round((Date.parse(end) - Date.parse(start)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** A building id as people read it: "building_demflex-rh27" → "demflex-rh27". */
export function scopeLabel(scope: string): string {
  return scope === "community" ? "Community" : scope.replace(/^building_/, "");
}
