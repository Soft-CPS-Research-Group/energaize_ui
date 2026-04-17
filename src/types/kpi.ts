export interface KpiResult {
  value: number;
  period_start: string;
  period_end: string;
  baseline?: number;
  real?: number;
}

export interface KpiScheduledResult {
  timeseries: KpiResult[];
  summary: KpiResult;
}

export interface KpiDataPayload {
  streaming?: Record<string, Record<string, KpiResult[]>>; // scope -> kpiname -> result[]
  scheduled?: Record<string, Record<string, KpiScheduledResult>>; // scope -> kpiname -> { timeseries, summary }
}

export interface ApiResponse {
  status: string;
  data: KpiDataPayload;
}