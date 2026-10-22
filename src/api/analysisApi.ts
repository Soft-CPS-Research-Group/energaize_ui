import { predictorFileUrl, predictorHttp } from "./client";
import { setActiveModel, type SetActiveModelResponse } from "./predictorApi";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Lane = "consumption" | "production";
export type ModelType = "warm" | "cold_start";
export type ImportanceType = "gain" | "weight" | "cover" | "total_gain" | "total_cover";
export type JobType = "compare" | "missing-data" | "segment" | "hyperparameter-tune";
export type JobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";

/** A house + lane a model forecasts for; unconfirmed until that house's next forecast. */
export interface ModelUse {
  house_id: string;
  lane: Lane;
  model_kind: ModelType;
  confirmed: boolean;
}

export interface ModelMeta {
  model_key: string;
  house_id: string | null;
  lane: Lane;
  model_type: ModelType;
  model_backend?: "xgboost" | "lgbm" | "lstm";
  model_schema?: "dense" | "sparse";
  active: boolean | null;
  /** Older predictor builds leave this out. */
  in_use_by?: ModelUse[];
  file_path: string;
  file_size_kb: number;
  stored_mae: number;
  n_features: number;
  n_outputs: number;
  stored_at?: string;
  /** ISO time the model file was written; older predictor builds leave it out. */
  trained_at?: string | null;
  /** For archived (old/) models: when it was replaced. */
  archived_at?: string | null;
  hyperparams?: Record<string, unknown> | null;
}

export interface ArchivedModel {
  model_key: string;
  slot: string;
  house_id: string | null;
  lane: Lane | null;
  model_backend: string;
  archived_at: string | null;
  trained_at: string;
  size_bytes: number;
}

export interface ArchiveSummary {
  count: number;
  size_bytes: number;
  oldest_archived_at: string | null;
}

export interface PruneOptions {
  /** Keep the newest N archived versions of each model. */
  keep_latest?: number | null;
  /** Only versions archived longer ago than this. */
  older_than_days?: number | null;
  house_id?: string | null;
}

export interface PruneResult {
  dry_run: boolean;
  count: number;
  freed_bytes: number;
  models: ArchivedModel[];
}

export interface FeatureScore {
  feature_name: string;
  score: number;
  rank: number;
}

export interface FeatureImportanceResult {
  model_key: string;
  importance_type: ImportanceType;
  n_features: number;
  features: FeatureScore[];
}

export interface MetricsBundle {
  mae: number;
  nmae_pct: number;
  rmse: number;
  smape_pct: number;
  r2: number;
  n_samples: number;
  daytime_mae: number | null;
}

export interface HorizonStep {
  step: number;
  mae: number;
  rmse: number;
  smape: number;
}

export interface SegmentResult {
  segment_name: string;
  segment_value: string;
  metrics: MetricsBundle;
}

// compare result
export interface CompareResult {
  house_id: string;
  lane: Lane;
  test_days: number;
  models: Record<string, ModelMeta>;
  evaluation: Record<string, MetricsBundle>;
  horizon: Record<string, HorizonStep[]>;
  segments?: Record<string, SegmentResult[]>;
}

// missing-data result
export interface MissingDataPoint {
  gap_type: string;
  gap_rate: number;
  metrics: MetricsBundle;
}
export interface MissingDataResult {
  house_id: string;
  lane: Lane;
  model_key: string;
  results: MissingDataPoint[];
}

// segment result
export interface SegmentAnalysisResult {
  house_id: string;
  lane: Lane;
  model_key: string;
  metrics: MetricsBundle;
  horizon: HorizonStep[];
  segments: SegmentResult[];
}

// hyperparameter-tune result
export interface HpTrial {
  trial: number;
  params: Record<string, number>;
  metrics: MetricsBundle;
}
export interface HpTuneResult {
  house_id: string;
  lane: Lane;
  strategy: string;
  best_params: Record<string, number>;
  best_metrics: MetricsBundle;
  results: HpTrial[];
}

export type AnalysisJobResult = CompareResult | MissingDataResult | SegmentAnalysisResult | HpTuneResult;

export interface AnalysisJob {
  job_id: string;
  job_type: JobType;
  status: JobStatus;
  submitted_at: string;
  started_at: string | null;
  finished_at: string | null;
  progress: number;
  progress_msg: string;
  payload: Record<string, unknown>;
  result: AnalysisJobResult | null;
  error: string | null;
}

// ─── Param space types ────────────────────────────────────────────────────────
export type ParamChoice = { type: "choice"; values: number[] };
export type ParamRange  = { type: "range";  low: number; high: number; step: number };
export type ParamSpec   = ParamChoice | ParamRange;

// ─── Job payloads ─────────────────────────────────────────────────────────────
export interface ComparePayload {
  job_type: "compare";
  house_id: string;
  lane: Lane;
  model_keys: string[];
  test_days?: number;
  include_segments?: boolean;
}
export interface MissingDataPayload {
  job_type: "missing-data";
  house_id: string;
  lane: Lane;
  model_key: string;
  gap_rates: number[];
  gap_types: string[];
  n_simulations?: number;
  test_days?: number;
}
export interface SegmentPayload {
  job_type: "segment";
  house_id: string;
  lane: Lane;
  model_key: string;
  segments: string[];
  test_days?: number;
}
export interface HpTunePayload {
  job_type: "hyperparameter-tune";
  house_id: string;
  lane: Lane;
  model_key: string;
  strategy: "random" | "grid";
  n_trials?: number;
  param_space: Record<string, ParamSpec>;
}
export type SubmitPayload = ComparePayload | MissingDataPayload | SegmentPayload | HpTunePayload;

// ─── API functions ─────────────────────────────────────────────────────────────

export async function listModels(): Promise<ModelMeta[]> {
  const res = await predictorHttp<{ models: ModelMeta[] }>("/api/analysis/models");
  return res.models;
}

export async function getModel(modelKey: string): Promise<ModelMeta> {
  return predictorHttp<ModelMeta>(`/api/analysis/models/${encodeURIComponent(modelKey)}`);
}

export async function getFeatureImportance(
  modelKey: string,
  importanceType: ImportanceType = "gain",
): Promise<FeatureImportanceResult> {
  return predictorHttp<FeatureImportanceResult>("/api/analysis/feature-importance", {
    method: "POST",
    body: JSON.stringify({ model_key: modelKey, importance_type: importanceType }),
  });
}

export async function submitJob(payload: SubmitPayload): Promise<{ job_id: string; status: JobStatus }> {
  return predictorHttp<{ job_id: string; status: JobStatus }>("/api/analysis/jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Jobs without their results (which can be large); fetch one with getJob to open it. */
export async function listJobs(): Promise<AnalysisJob[]> {
  const res = await predictorHttp<{ jobs: AnalysisJob[] }>("/api/analysis/jobs?summary=true");
  return res.jobs;
}

export async function getJob(jobId: string): Promise<AnalysisJob> {
  return predictorHttp<AnalysisJob>(`/api/analysis/jobs/${jobId}`);
}

export async function cancelJob(jobId: string): Promise<void> {
  await predictorHttp<void>(`/api/analysis/jobs/${jobId}`, { method: "DELETE" });
}

/** Restore an archived (old/) model file to the production slot; the current one is archived. */
export async function promoteModel(modelKey: string): Promise<{ status: string; model: ModelMeta }> {
  return predictorHttp<{ status: string; model: ModelMeta }>(
    `/api/analysis/models/${encodeURIComponent(modelKey)}/promote`,
    { method: "POST" }
  );
}

/** Delete a model file. The predictor refuses (409) models in use and the generic cold-start models. */
export async function deleteModel(modelKey: string): Promise<{ freed_bytes: number }> {
  return predictorHttp<{ freed_bytes: number }>(`/api/analysis/models/${encodeURIComponent(modelKey)}`, { method: "DELETE" });
}

export async function getArchiveSummary(): Promise<ArchiveSummary> {
  return predictorHttp<ArchiveSummary>("/api/analysis/archive");
}

/** dry_run lists what would be deleted without deleting it. */
export async function pruneArchive(options: PruneOptions, dryRun: boolean): Promise<PruneResult> {
  return predictorHttp<PruneResult>("/api/analysis/archive/prune", {
    method: "POST",
    body: JSON.stringify({ ...options, dry_run: dryRun }),
  });
}

/** Archived models live under old/ and are not in the production slot. */
export function isArchivedModel(m: Pick<ModelMeta, "model_key">): boolean {
  return m.model_key.startsWith("old/");
}

/**
 * Make a warm model the one used for forecasting its house and lane. An archived
 * file is restored to the production slot first; active-model on its own only
 * chooses which backend's production file is used.
 */
export async function activateModel(m: ModelMeta): Promise<SetActiveModelResponse> {
  if (!m.house_id) throw new Error("Only house models can be set as active");
  if (isArchivedModel(m)) await promoteModel(m.model_key);
  return setActiveModel(m.house_id, { lane: m.lane, model_type: m.model_backend ?? "xgboost" });
}

export function getExportUrl(jobId: string): string {
  return predictorFileUrl(`/api/analysis/jobs/${jobId}/export?format=csv`);
}
