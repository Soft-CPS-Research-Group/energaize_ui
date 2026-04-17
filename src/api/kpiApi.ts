import axios from 'axios';

export const KPI_API_BASE_URL = import.meta.env.VITE_KPI_API_URL || '/kpi-api';

export const api = axios.create({ baseURL: KPI_API_BASE_URL });
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

  const response = await api.get<ApiResponse>(`/api/v1/kpis/${community}?${params.toString()}`);
  return response.data;
};

export interface FetchHistoryParams {
  community: string;
  startDate?: string;
  endDate?: string;
  kpis?: string[];
  scope?: string;
  limit?: number;
}

export const fetchKpiHistory = async ({
  community, startDate, endDate, kpis, scope, limit = 1000,
}: FetchHistoryParams): Promise<any> => {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  if (scope) params.append("scope", scope);
  if (limit) params.append("limit", String(limit));
  kpis?.forEach(k => params.append("kpis", k));

  let urlGroup = community || "default";

  const response = await api.get<any>(
    `/api/v1/kpis/${urlGroup}/history?${params.toString()}`
  );
  return response.data;
};

export interface ComparePeriodsMeta {
  community: string;
  buildings: string[];
  baseline: { start: string; end: string };
  real:     { start: string; end: string };
}

export interface KpiPeriodResult {
  timeseries: Array<{ value: number; period_start: string; period_end: string; [key: string]: any }>;
  summary: Record<string, number>;
}

export interface KpiComparisonEntry {
  baseline: KpiPeriodResult;
  real:     KpiPeriodResult;
  delta: {
    absolute:     number | null;
    relative_pct: number | null;
  };
}

export interface CompareResponse {
  status: string;
  meta:   ComparePeriodsMeta;
  data:   Record<string, Record<string, KpiComparisonEntry>>;
}

export interface FetchCompareParams {
  community:      string;
  buildings:      string[];
  baselineStart:  string;
  baselineEnd:    string;
  realStart:      string;
  realEnd:        string;
  kpis?:          string[];
}

export const fetchKpiComparison = async ({
  community, buildings, baselineStart, baselineEnd,
  realStart, realEnd, kpis,
}: FetchCompareParams): Promise<CompareResponse> => {
  const params = new URLSearchParams();
  buildings.forEach((b: any) => params.append("buildings", b));
  params.append("baseline_start", baselineStart);
  params.append("baseline_end",   baselineEnd);
  params.append("real_start",     realStart);
  params.append("real_end",       realEnd);
  kpis?.forEach(k => params.append("kpis", k));

  const response = await api.get<CompareResponse>(
    `/api/v1/kpis/${community}/compare?${params.toString()}`
  );
  return response.data;
};
