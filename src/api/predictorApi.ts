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
  /** When the forecast cycle ran, in UTC ("2026-10-22T09:03:12.5Z"); values[0] is the slot it falls in. */
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
  /** Set when the job belongs to a "retrain all houses" batch. */
  batch_id?: string | null;
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
  /** Keep the new model even when its error (MAE) is higher than the current one's. */
  force?: boolean;
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

// ─── Generic (cold-start) model ──────────────────────────────────────────────

/** Training jobs and batch lanes of the generic model carry this house id. */
export const GENERIC_HOUSE_ID = "cold_start";

export type GenericBackend = "xgboost" | "lgbm";

export interface GenericModelFile {
  trained_at: string | null;
  /** Houses whose data was pooled; missing for models trained before it was recorded. */
  houses?: string[] | null;
  /** Houses left out, e.g. because their meter unit did not match the others. */
  excluded?: { house_id: string; reason: string }[] | null;
}

export interface GenericModelLane {
  /** The chosen backend; null when each house's own backend picks it (XGBoost when that one is missing). */
  model_type: GenericBackend | null;
  available: Partial<Record<GenericBackend, GenericModelFile>>;
}

export type GenericModelResponse = Record<"consumption" | "production", GenericModelLane>;

export async function getGenericModel(): Promise<GenericModelResponse> {
  return predictorHttp<GenericModelResponse>("/api/generic-model");
}

export async function setGenericModel(payload: { lane: "consumption" | "production"; model_type: GenericBackend }): Promise<{ status: string }> {
  return predictorHttp<{ status: string }>("/api/generic-model", {
    method: "POST",
    body: JSON.stringify(payload),
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

// ─── Retrain all houses (batches) ────────────────────────────────────────────

export type BatchStatus = "RUNNING" | "DONE" | "CANCELED" | "STOPPED" | "INTERRUPTED";

export interface BatchOptions {
  houses?: "all" | string[];
  lanes?: "both" | "consumption" | "production";
  /** needed: refused, missing, pre-unit-detection or old models only. */
  only?: "needed" | "all";
  max_model_age_days?: number;
  model_type?: "active" | ModelBackend;
  max_parallel?: number;
  /** Also retrain the generic model of each lane, after the houses. */
  include_generic?: boolean;
  /** Keep every new model even when its error (MAE) is higher. */
  force?: boolean;
}

export interface BatchItem {
  house_id: string;
  lane: "consumption" | "production";
  model_type: string;
  /** Why the lane is in the batch, e.g. "no model" or "forecast refused (scale-drift)". */
  reason: string;
  /** 0 refused, 1 no model, 2 trained before unit detection, 3 old, 4 up to date, 5 generic model. */
  priority: number;
  /** QUEUED, a training job status, or SKIPPED. */
  status: string;
  job_id: string | null;
  message: string;
  prev_mae: number | null;
  new_mae: number | null;
}

export interface BatchSummary {
  batch_id: string;
  status: BatchStatus;
  created_at: string;
  finished_at: string | null;
  message: string;
  options: BatchOptions & { max_parallel?: number };
  total: number;
  finished: number;
  counts: Record<string, number>;
}

export interface Batch extends BatchSummary {
  items: BatchItem[];
}

export interface BatchPlan {
  dry_run: true;
  total: number;
  items: BatchItem[];
}

export async function planBatch(options: BatchOptions): Promise<BatchPlan> {
  return predictorHttp<BatchPlan>("/api/batch-train", {
    method: "POST",
    body: JSON.stringify({ ...options, dry_run: true }),
  });
}

export async function startBatch(options: BatchOptions): Promise<{ message: string; batch: Batch | null }> {
  return predictorHttp<{ message: string; batch: Batch | null }>("/api/batch-train", {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export async function listBatches(): Promise<BatchSummary[]> {
  const res = await predictorHttp<{ batches: BatchSummary[] }>("/api/batch-train");
  return res.batches ?? [];
}

export async function getBatch(batchId: string): Promise<Batch> {
  return predictorHttp<Batch>(`/api/batch-train/${encodeURIComponent(batchId)}`);
}

export async function cancelBatch(batchId: string): Promise<{ batch: Batch }> {
  return predictorHttp<{ batch: Batch }>(`/api/batch-train/${encodeURIComponent(batchId)}/cancel`, { method: "POST" });
}

// ─── Input data quality ──────────────────────────────────────────────────────

export interface MeterSpec {
  unit: "kwh" | "kw" | "wh" | "w";
  cumulative: boolean;
  negated: boolean;
}

export interface MeterInfo {
  spec: MeterSpec;
  /** e.g. "kW" or "cumulative kWh counter". */
  label: string;
  /** declared: house_units.json; model: as the model was trained; legacy-model: old rule for an old model; detected. */
  source: "declared" | "model" | "legacy-model" | "detected";
  confidence: "high" | "low" | "none" | null;
  detection: {
    label: string;
    confidence: "high" | "low" | "none";
    interval_min: number;
    samples: number;
    notes: string[];
  } | null;
}

export interface ReadingWindowQuality {
  readings: number;
  unreadable: number;
  duplicates: number;
  counter_resets: number;
  negatives_zeroed: number;
  negatives_dropped: number;
  spikes_dropped: number;
  slots_total: number;
  slots_with_data: number;
  longest_gap_slots: number;
  coverage: number;
}

export type RefusalReason = "pre-kwh-fix" | "meter-changed" | "unit-mismatch" | "scale-drift" | "low-confidence";

export interface LaneDataQuality {
  meter: MeterInfo | null;
  window: ReadingWindowQuality | null;
  model: {
    model_key: string;
    meter: MeterSpec | null;
    meter_confidence: string | null;
    data_level: number | null;
    trained_at: string | null;
  } | null;
  /** The last forecast published nothing for this lane, and why. Cleared by the next good forecast. */
  refused?: { model_key: string; reason: RefusalReason; at: string } | null;
}

export interface DataQualityResponse {
  house_id: string;
  lanes: Partial<Record<"consumption" | "production", LaneDataQuality>>;
}

export async function getDataQuality(houseId: string): Promise<DataQualityResponse> {
  return predictorHttp<DataQualityResponse>(`/api/houses/${encodeURIComponent(houseId)}/data-quality`);
}
