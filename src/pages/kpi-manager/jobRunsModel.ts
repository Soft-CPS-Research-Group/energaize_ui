// What a scheduler run did, as GET api/v1/scheduler/jobs/{id}/runs returns it, and how the
// runs panel summarises it. Kept out of the panel so it can be tested.

export interface KpiValue { value: number | null; unit?: string | null }

export interface CommunityRun {
  buildings: number;
  buildings_with_data?: number;
  windows: number;
  error?: string;
  community: Record<string, KpiValue>;
  /** Each house's values: building -> KPI -> value */
  by_building?: Record<string, Record<string, KpiValue>>;
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

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * A run as the API returned it, with every field the panel reads in the shape it expects:
 * runs recorded by other versions, or fields an upstream service fills differently,
 * must never break the page.
 */
export function normalizeRun(raw: any): JobRun {
  const kpiValues = (source: unknown): Record<string, KpiValue> => {
    const values: Record<string, KpiValue> = {};
    for (const [kpi, v] of Object.entries(isObject(source) ? source : {})) {
      values[kpi] = { value: num(isObject(v) ? v.value : v), unit: isObject(v) ? text(v.unit) : null };
    }
    return values;
  };
  const communities: Record<string, CommunityRun> = {};
  for (const [name, c] of Object.entries(isObject(raw?.communities) ? raw.communities : {})) {
    const values = kpiValues((c as any)?.community);
    const byBuilding: Record<string, Record<string, KpiValue>> = {};
    for (const [building, kpis] of Object.entries(isObject((c as any)?.by_building) ? (c as any).by_building : {})) {
      byBuilding[building] = kpiValues(kpis);
    }
    communities[name] = {
      buildings: num((c as any)?.buildings) ?? 0,
      buildings_with_data: num((c as any)?.buildings_with_data) ?? undefined,
      windows: num((c as any)?.windows) ?? 0,
      error: text((c as any)?.error) ?? undefined,
      community: values,
      by_building: byBuilding,
    };
  }
  const bau: Record<string, BauRun> = {};
  for (const [name, b] of Object.entries(isObject(raw?.bau) ? raw.bau : {})) {
    const report = isObject((b as any)?.report) ? (b as any).report : undefined;
    const comparison: Record<string, Record<string, BauComparisonValue>> = {};
    for (const [scope, kpis] of Object.entries(isObject(report?.comparison) ? report.comparison : {})) {
      comparison[scope] = {};
      for (const [kpi, v] of Object.entries(isObject(kpis) ? kpis : {})) {
        comparison[scope][kpi] = { real: num(isObject(v) ? v.real : null), bau: num(isObject(v) ? v.bau : null),
                                   unit: isObject(v) ? text(v.unit) : null };
      }
    }
    bau[name] = {
      id: text((b as any)?.id) ?? undefined,
      state: text((b as any)?.state) ?? undefined,
      outcome: text((b as any)?.outcome),
      error: text((b as any)?.error),
      houses: Array.isArray((b as any)?.houses)
        ? (b as any).houses.filter(isObject).map((h: any) => ({
            house: text(h.house) ?? "?", site_id: text(h.site_id) ?? "", included: num(h.included) ?? 0,
            expected: num(h.expected) ?? 0, reasons: Array.isArray(h.reasons) ? h.reasons.map((r: unknown) => text(r) ?? "") : [],
          }))
        : undefined,
      report: report ? { ...report, comparison } : undefined,
    };
  }
  const status = raw?.status === "running" || raw?.status === "success" || raw?.status === "error" ? raw.status : "error";
  return {
    run_id: text(raw?.run_id) ?? Math.random().toString(36),
    job_id: text(raw?.job_id) ?? "",
    started_at: text(raw?.started_at) ?? "",
    finished_at: text(raw?.finished_at) ?? undefined,
    status,
    error: text(raw?.error),
    period_start: text(raw?.period_start) ?? undefined,
    period_end: text(raw?.period_end) ?? undefined,
    communities,
    bau,
  };
}

/** Houses the BAU covered, and why the others were left out (reason → how many houses). */
export function houseCoverage(list?: BauHouse[] | null) {
  // The API sends null when a request carries no house list (e.g. one stored by an earlier version)
  const houses = Array.isArray(list) ? list : [];
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

/** The scopes a run can be looked at in: the community first, then every house it has values for. */
export function runScopes(c: CommunityRun | undefined, bau: BauRun | undefined): string[] {
  const houses = new Set([...Object.keys(c?.by_building ?? {}), ...comparisonScopes(bau).filter((s) => s !== "community")]);
  return ["community", ...[...houses].sort()];
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
