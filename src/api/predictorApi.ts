import { http } from "./client";

export const PREDICTOR_API_URL = import.meta.env.VITE_PREDICTOR_API_URL?.replace(/\/$/, "") || "http://193.136.62.78:8006";

function buildPredictorUrl(path: string): string {
  return `${PREDICTOR_API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface PredictorStats {
  total_houses: number;
  predictions_available: number;
  total_cycles: number;
  next_cycle_at: string; // ISO timestamp of the next 15-min boundary
}

export interface PredictorHistoryDataPoint {
  timestamp: string; // ISO 8601
  value: number;
}

export interface PredictorHistoryResponse {
  consumption: PredictorHistoryDataPoint[];
  production: PredictorHistoryDataPoint[];
}

export interface PredictorPredictionsResponse {
  target_time: string;
  consumption: number[];
  production: number[];
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

export async function getStats(): Promise<PredictorStats> {
  return http<PredictorStats>(buildPredictorUrl("/api/stats"));
}

export async function getHouses(): Promise<string[]> {
  const res = await http<any>(buildPredictorUrl("/api/houses"));
  return Array.isArray(res) ? res : (res?.houses || []);
}

export async function getHistory(houseId: string, days: number = 3): Promise<PredictorHistoryResponse> {
  const [consumption, production] = await Promise.all([
    http<{data: PredictorHistoryDataPoint[]}>(buildPredictorUrl(`/api/houses/${houseId}/history?days=${days}&lane=consumption`)),
    http<{data: PredictorHistoryDataPoint[]}>(buildPredictorUrl(`/api/houses/${houseId}/history?days=${days}&lane=production`))
  ]);
  
  return {
    consumption: consumption.data || [],
    production: production.data || []
  };
}

export async function getPredictions(houseId: string): Promise<PredictorPredictionsResponse> {
  return http<PredictorPredictionsResponse>(buildPredictorUrl(`/api/houses/${houseId}/predictions`));
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
  return http<PredictionHistoryPayload>(
    buildPredictorUrl(`/api/houses/${houseId}/prediction-history?lane=${lane}`)
  );
}

export async function getJobs(): Promise<TrainingJob[]> {
  const res = await http<any>(buildPredictorUrl("/api/jobs"));
  return Array.isArray(res) ? res : (res?.jobs ?? []);
}

export async function getJob(jobId: string): Promise<TrainingJob> {
  return http<TrainingJob>(buildPredictorUrl(`/api/jobs/${encodeURIComponent(jobId)}`));
}

export async function getActiveModel(houseId: string): Promise<ActiveModelResponse> {
  return http<ActiveModelResponse>(buildPredictorUrl(`/api/houses/${encodeURIComponent(houseId)}/active-model`));
}

export async function setActiveModel(houseId: string, payload: SetActiveModelPayload): Promise<SetActiveModelResponse> {
  return http<SetActiveModelResponse>(buildPredictorUrl(`/api/houses/${encodeURIComponent(houseId)}/active-model`), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function executeCommand(payload: PredictorCommandPayload): Promise<{ message: string, job_id?: string }> {
  return http<{ message: string, job_id?: string }>(buildPredictorUrl("/api/command"), {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function cancelJob(jobId: string): Promise<{ message: string }> {
  return http<{ message: string }>(buildPredictorUrl(`/api/jobs/${jobId}/cancel`), {
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

export async function getLogs(filter?: string, limit: number = 300): Promise<LogEntry[]> {
  const url = new URL(buildPredictorUrl("/api/logs"));
  url.searchParams.append("limit", limit.toString());
  if (filter) {
    url.searchParams.append("filter", filter);
  }
  return http<LogEntry[]>(url.toString());
}