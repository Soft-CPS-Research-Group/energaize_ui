import { ApiError, predictorFileUrl, predictorHttp, PREDICTOR_API_URL } from "./client";

export { PREDICTOR_API_URL };

export interface PredictorStats {
  total_houses: number;
  predictions_available: number;
  total_cycles: number;
  next_cycle_at: string; // ISO timestamp of the next 15-min boundary
  scheduler_paused?: boolean;
}

export interface PredictorHistoryDataPoint {
  timestamp: string; // ISO 8601
  value: number;
}

export interface PredictorHistoryResponse {
  consumption: PredictorHistoryDataPoint[];
  production: PredictorHistoryDataPoint[];
}

/** The latest published forecast; every field is null until the house gets its first one. */
export interface PredictorPredictionsResponse {
  target_time: string | null;
  consumption: number[] | null;
  production: number[] | null;
}

export type LSTMLayerSpec =
  | { type: "linear"; out: number }
  | { type: "relu" }
  | { type: "lstm"; hidden: number; num_layers: number }
  | { type: "dropout"; p: number };

export interface XGBoostHyperparams {
  n_estimators?: number;
  max_depth?: number;
  learning_rate?: number;
  subsample?: number;
  colsample_bytree?: number;
  min_child_weight?: number;
}

export interface LGBMHyperparams {
  objective?: string;
  n_estimators?: number;
  max_depth?: number;
  learning_rate?: number;
  num_leaves?: number;
  subsample?: number;
  colsample_bytree?: number;
  min_child_samples?: number;
  reg_alpha?: number;
  reg_lambda?: number;
}

export interface LSTMHyperparams {
  lookback?: number;
  epochs?: number;
  batch_size?: number;
  lr?: number;
  patience?: number;
  layers?: LSTMLayerSpec[];
}

export type ModelHyperparams = XGBoostHyperparams | LGBMHyperparams | LSTMHyperparams;

export interface TrainingJob {
  job_id: string;
  house_id: string;
  lane: string;
  model_type: string | null; // "xgboost" | "lgbm" | "lstm"
  status: string; // "PENDING" | "FETCHING" | "RUNNING" | "ACCEPTED" | "REJECTED" | "CANCELED" | "FAILED"
  progress_current: number;
  progress_total: number;
  percent: number;
  eta: string | null;         // human-readable e.g. "3m18s"
  eta_seconds: number | null;
  elapsed_seconds: number;
  submitted_at: string;
  started_at: string | null;
  finished_at: string | null;
  result_message: string | null;
  prev_mae: number | null;
  new_mae: number | null;
  hyperparams?: Record<string, unknown> | null;
}

export type ModelBackend = "xgboost" | "lgbm" | "lstm";

export interface ActiveModelResponse {
  consumption: ModelBackend;
  production: ModelBackend;
}

export interface SetActiveModelPayload {
  lane: "consumption" | "production";
  model_type: ModelBackend;
}

export interface SetActiveModelResponse {
  status: string;
  house_id: string;
  lane: string;
  model_type: ModelBackend;
}

export interface PredictorCommandPayload {
  command: "train" | "train-cold" | "predict" | "flex";
  house_id?: string;
  lane?: "consumption" | "production" | "both";
  model_schema?: string;
  model_type?: ModelBackend;
  hyperparams?: Record<string, unknown>;
}

/** GET /api/health: 200 while compute cycles keep completing, 503 (same body) when stalled. */
export interface PredictorHealth {
  healthy: boolean;
  paused?: boolean;
  seconds_since_progress?: number;
  max_cycle_age_seconds?: number;
  last_cycle_started_at?: string | null;
  last_cycle_completed_at?: string | null;
  last_cycle_duration_s?: number | null;
  /** Houses that published nothing in the last cycle. */
  last_cycle_houses_failed?: number;
  last_publish_at?: string | null;
  publisher_connected?: boolean;
  results_queue_size?: number;
}

export async function getHealth(): Promise<PredictorHealth> {
  // A stalled service answers 503 with the same body, which is what the UI needs to show.
  const response = await fetch(predictorFileUrl("/api/health"));
  if (response.ok || response.status === 503) {
    return (await response.json()) as PredictorHealth;
  }
  throw new ApiError(`Request failed (${response.status})`, response.status);
}

export async function getStats(): Promise<PredictorStats> {
  return predictorHttp<PredictorStats>("/api/stats");
}

export async function getHouses(): Promise<string[]> {
  // Older predictor builds return a bare list, newer ones { houses: [...] }.
  const res = await predictorHttp<string[] | { houses?: string[] }>("/api/houses");
  return Array.isArray(res) ? res : (res?.houses ?? []);
}

export async function getHistory(houseId: string, days: number = 3): Promise<PredictorHistoryResponse> {
  const [consumption, production] = await Promise.all([
    predictorHttp<{data: PredictorHistoryDataPoint[]}>(`/api/houses/${houseId}/history?days=${days}&lane=consumption`),
    predictorHttp<{data: PredictorHistoryDataPoint[]}>(`/api/houses/${houseId}/history?days=${days}&lane=production`)
  ]);
  
  return {
    consumption: consumption.data || [],
    production: production.data || []
  };
}

export async function getPredictions(houseId: string): Promise<PredictorPredictionsResponse> {
  return predictorHttp<PredictorPredictionsResponse>(`/api/houses/${houseId}/predictions`);
}

export interface PredictionHistoryEntry {
  target_time: string;
  prediction: number[];
  model_backend?: string;
}

export interface PredictionHistoryPayload {
  house_id: string;
  lane: string;
  history: PredictionHistoryEntry[];
}

export async function getPredictionHistory(
  houseId: string,
  lane: "consumption" | "production" = "consumption"
): Promise<PredictionHistoryPayload> {
  return predictorHttp<PredictionHistoryPayload>(
    `/api/houses/${houseId}/prediction-history?lane=${lane}`
  );
}

export interface SystemInfo {
  cpu_percent: number;
  cpu_count: number;
  ram_used_gb: number;
  ram_total_gb: number;
  ram_percent: number;
}

export interface JobsResponse {
  jobs: TrainingJob[];
  system: SystemInfo | null;
}

export async function getJobs(): Promise<JobsResponse> {
  const res = await predictorHttp<any>("/api/jobs");
  if (Array.isArray(res)) {
    return { jobs: res, system: null };
  }
  return { jobs: res?.jobs ?? [], system: res?.system ?? null };
}

export async function getJob(jobId: string): Promise<TrainingJob> {
  return predictorHttp<TrainingJob>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export async function getActiveModel(houseId: string): Promise<ActiveModelResponse> {
  return predictorHttp<ActiveModelResponse>(`/api/houses/${encodeURIComponent(houseId)}/active-model`);
}

export async function setActiveModel(houseId: string, payload: SetActiveModelPayload): Promise<SetActiveModelResponse> {
  return predictorHttp<SetActiveModelResponse>(`/api/houses/${encodeURIComponent(houseId)}/active-model`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function executeCommand(payload: PredictorCommandPayload): Promise<{ message: string, job_id?: string }> {
  return predictorHttp<{ message: string, job_id?: string }>("/api/command", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function cancelJob(jobId: string): Promise<{ message: string }> {
  return predictorHttp<{ message: string }>(`/api/jobs/${jobId}/cancel`, {
    method: "POST"
  });
}

// Initial logs fetch
export interface LogEntry {
  raw: string;
  time: string;
  level: string;
  logger: string;
  message: string;
  job_id?: string | null;
}

export interface LogsResponse {
  lines: string[];
}

export async function getLogs(filter?: string, limit: number = 300): Promise<LogsResponse> {
  // The base URL is usually relative (/predictor-api), so build only the query string.
  const params = new URLSearchParams({ limit: limit.toString() });
  if (filter) {
    params.append("filter", filter);
  }
  return predictorHttp<LogsResponse>(`/api/logs?${params.toString()}`);
}