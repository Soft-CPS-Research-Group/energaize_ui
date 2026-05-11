import axios from 'axios';

//export const KPI_API_BASE_URL = import.meta.env.VITE_KPI_API_URL?.replace(/\/$/, "") || 'http://193.136.62.78:8007';
export const KPI_API_BASE_URL = import.meta.env.VITE_KPI_API_URL?.replace(/\/$/, "") || 'http://193.136.62.78:8007';

export const api = axios.create({ baseURL: `${KPI_API_BASE_URL}/` });
import type { ApiResponse } from "../types/kpi";

interface FetchKpisParams {
  community: string;
  buildings: string[];
  startDate?: string;
  endDate?: string;
  kpis?: string[];
  windowOverride?: string[];
  computeAggregated?: boolean;
  computeScheduled?: boolean; // false = skip scheduled KPIs; default true
}

export const fetchKpis = async ({
  community,
  buildings,
  startDate,
  endDate,
  kpis,
  windowOverride,
  computeAggregated,
  computeScheduled = true,
}: FetchKpisParams): Promise<ApiResponse> => {
  const params = new URLSearchParams();

  buildings.forEach((b: any) => params.append("buildings", b));

  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  if (computeAggregated) params.append("compute_aggregated", "true");
  if (!computeScheduled) params.append("compute_scheduled", "false");
  if (kpis && kpis.length > 0) {
    kpis.forEach(k => params.append("kpis", k));
  }
  if (windowOverride && windowOverride.length > 0) {
    windowOverride.forEach(w => params.append("window_override", w));
  }

  const response = await api.get<ApiResponse>(`api/v1/kpis/${community}?${params.toString()}`);
  return response.data;
};

export interface FetchHistoryParams {
  community: string;
  buildings?: string[];
  startDate?: string;
  endDate?: string;
  kpis?: string[];
  scope?: string;
  limit?: number;
}

export const fetchKpiHistory = async ({
  community, buildings, startDate, endDate, kpis, scope, limit = 1000,
}: FetchHistoryParams): Promise<any> => {
  const params = new URLSearchParams();
  if (buildings && buildings.length > 0) {
    buildings.forEach((b: any) => params.append("buildings", b));
  }
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  if (scope) params.append("scope", scope);
  if (limit) params.append("limit", String(limit));
  kpis?.forEach(k => params.append("kpis", k));

  let urlGroup = community || "default";

  const response = await api.get<any>(
    `api/v1/kpis/${urlGroup}/history?${params.toString()}`
  );
  return response.data;
};

export interface ComparePeriodsMeta {
  community: string;
  buildings: string[];
  baseline: { start: string; end: string };
  real: { start: string; end: string };
}

export interface KpiPeriodResult {
  timeseries: Array<{ value: number; period_start: string; period_end: string;[key: string]: any }>;
  summary: Record<string, number>;
}

export interface KpiComparisonEntry {
  baseline: KpiPeriodResult;
  real: KpiPeriodResult;
  delta: {
    absolute: number | null;
    relative_pct: number | null;
  };
}

export interface CompareResponse {
  status: string;
  meta: ComparePeriodsMeta;
  data: Record<string, Record<string, KpiComparisonEntry>>;
}

export interface FetchCompareParams {
  community: string;
  buildings: string[];
  baselineStart: string;
  baselineEnd: string;
  realStart: string;
  realEnd: string;
  kpis?: string[];
}

export const fetchKpiComparison = async ({
  community, buildings, baselineStart, baselineEnd,
  realStart, realEnd, kpis,
}: FetchCompareParams): Promise<CompareResponse> => {
  const params = new URLSearchParams();
  buildings.forEach((b: any) => params.append("buildings", b));
  params.append("baseline_start", baselineStart);
  params.append("baseline_end", baselineEnd);
  params.append("real_start", realStart);
  params.append("real_end", realEnd);
  kpis?.forEach(k => params.append("kpis", k));

  const response = await api.get<CompareResponse>(
    `api/v1/kpis/${community}/compare?${params.toString()}`
  );
  return response.data;
};

// ── Data Profiling ──────────────────────────────────────────────────────────

export interface BuildingProfile {
  actual_payloads?: number;
  total_payloads?: number;
  coverage_ratio: number;
  confidence_score: number;
  generated_fields: number;
  total_fields: number;
  authenticity_ratio: number;
  physically_invalid_count?: number;
  physically_invalid?: number;
  validity_ratio: number;
  gap_count: number;
  gaps: Array<{ from: string; to: string; duration_seconds: number }>;
  outlier_counts: Record<string, number>;
}

export interface DataProfileResponse {
  status: string;
  community: string;
  period: { start: string; end: string };
  data: Record<string, BuildingProfile>; // building_id -> profile
}

export interface FetchProfileParams {
  community: string;
  buildings: string[];
  startDate: string;
  endDate: string;
}

export const fetchDataProfile = async ({
  community,
  buildings,
  startDate,
  endDate,
}: FetchProfileParams): Promise<DataProfileResponse> => {
  const params = new URLSearchParams();
  buildings.forEach(b => params.append('buildings', b));
  params.append('start_date', startDate);
  params.append('end_date', endDate);

  const response = await api.get<DataProfileResponse>(
    `api/v1/data/profile/${community}?${params.toString()}`
  );
  return response.data;
};

// ── KPI Aggregation ──────────────────────────────────────────────────────────

export type AggregatePeriod = "daily" | "weekly" | "monthly";

export interface KpiAggStats {
  sum: number;
  mean: number;
  min: number;
  max: number;
  count: number;
}

export interface AggregateBucket {
  label: string;                                       // e.g. "2025-03" or "2025-W11"
  start: string;                                       // "YYYY-MM-DD"
  end: string;
  scopes: Record<string, Record<string, KpiAggStats>>; // scope → kpiName → stats
}

export interface AggregateResponse {
  status: string;
  community: string;
  period: AggregatePeriod;
  buckets: AggregateBucket[];
}

export interface FetchAggregateParams {
  community: string;
  period: AggregatePeriod;
  startDate?: string;
  endDate?: string;
  kpis?: string[];
  scope?: string;
}

export const fetchKpiAggregate = async ({
  community,
  period,
  startDate,
  endDate,
  kpis,
  scope,
}: FetchAggregateParams): Promise<AggregateResponse> => {
  const params = new URLSearchParams();
  params.append("period", period);
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  if (scope) params.append("scope", scope);
  kpis?.forEach(k => params.append("kpis", k));

  const response = await api.get<AggregateResponse>(
    `api/v1/kpis/${community}/aggregate?${params.toString()}`
  );
  return response.data;
};

// ── KPI Correlation ───────────────────────────────────────────────────────────

export interface CorrelationPoint {
  x: number;
  y: number;
  period_start: string;
  scope: string;
}

export type CorrelationInterpretation =
  | "strong_positive" | "moderate_positive" | "weak_positive"
  | "strong_negative" | "moderate_negative" | "weak_negative"
  | "no_correlation" | "insufficient_data";

export interface CorrelationResponse {
  status: string;
  community: string;
  kpi_a: string;
  kpi_b: string;
  scope: string | null;
  pearson_r: number | null;
  interpretation: CorrelationInterpretation;
  point_count: number;
  data_points: CorrelationPoint[];
}

export interface FetchCorrelationParams {
  community: string;
  kpiA: string;
  kpiB: string;
  startDate?: string;
  endDate?: string;
  scope?: string;
}

export const fetchKpiCorrelation = async ({
  community, kpiA, kpiB, startDate, endDate, scope,
}: FetchCorrelationParams): Promise<CorrelationResponse> => {
  const params = new URLSearchParams();
  params.append("kpi_a", kpiA);
  params.append("kpi_b", kpiB);
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  if (scope) params.append("scope", scope);

  const response = await api.get<CorrelationResponse>(
    `api/v1/kpis/${community}/correlations?${params.toString()}`
  );
  return response.data;
};

// ── Live State (streaming snapshots) ─────────────────────────────────────────

export interface LiveSnapshot {
  community: string;
  building: string;
  timestamp: string;
  updated_at?: string;
  // Energy
  grid_import_kwh: number;
  grid_export_kwh: number;
  net_grid_kwh: number;
  solar_kwh: number;
  non_shiftable_load_kwh: number;
  // Storage
  battery_soc_avg: number | null;
  battery_count: number;
  // EV
  ev_charging_kw: number;
  active_ev_sessions: number;
  // Price
  energy_price_eur_kwh: number | null;
  // Quality
  authenticity_ratio: number;
  is_physically_valid: boolean;
  has_generated_data: boolean;
}

export interface LiveStateResponse {
  status: string;
  community: string;
  count: number;
  data: LiveSnapshot[];
}

export const fetchLiveState = async (
  community: string,
  buildings?: string[],
): Promise<LiveStateResponse> => {
  const params = new URLSearchParams();
  buildings?.forEach(b => params.append("buildings", b));
  const response = await api.get<LiveStateResponse>(
    `api/v1/live/${community}?${params.toString()}`
  );
  return response.data;
};
