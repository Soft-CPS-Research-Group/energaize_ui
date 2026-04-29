import { http } from "./client";

export const ANALYSIS_API_URL =
  (import.meta.env.VITE_PREDICTOR_API_URL?.replace(/\/$/, "") || "http://193.136.62.78:8006");

function url(path: string): string {
  return `${ANALYSIS_API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type Lane = "consumption" | "production";
export type ModelType = "warm" | "cold_start";
export type ImportanceType = "gain" | "weight" | "cover" | "total_gain" | "total_cover";
export type JobType = "compare" | "missing-data" | "segment" | "hyperparameter-tune";
export type JobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";

export interface ModelMeta {
  model_key: string;
  house_id: string | null;
  lane: Lane;
  model_type: ModelType;
  model_backend?: "xgboost" | "lgbm" | "lstm";
  active: boolean | null;
  file_path: string;
  file_size_kb: number;
  stored_mae: number;
  n_features: number;
  n_outputs: number;
  stored_at?: string;
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
  const res = await http<{ models: ModelMeta[] }>(url("/api/analysis/models"));
  return res.models;
}

export async function getModel(modelKey: string): Promise<ModelMeta> {
  return http<ModelMeta>(url(`/api/analysis/models/${encodeURIComponent(modelKey)}`));
}

export async function getFeatureImportance(
  modelKey: string,
  importanceType: ImportanceType = "gain",
): Promise<FeatureImportanceResult> {
  return http<FeatureImportanceResult>(url("/api/analysis/feature-importance"), {
    method: "POST",
    body: JSON.stringify({ model_key: modelKey, importance_type: importanceType }),
  });
}

export async function submitJob(payload: SubmitPayload): Promise<{ job_id: string; status: JobStatus }> {
  return http<{ job_id: string; status: JobStatus }>(url("/api/analysis/jobs"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listJobs(): Promise<AnalysisJob[]> {
  const res = await http<{ jobs: AnalysisJob[] }>(url("/api/analysis/jobs"));
  return res.jobs;
}

export async function getJob(jobId: string): Promise<AnalysisJob> {
  return http<AnalysisJob>(url(`/api/analysis/jobs/${jobId}`));
}

export async function cancelJob(jobId: string): Promise<void> {
  await http<void>(url(`/api/analysis/jobs/${jobId}`), { method: "DELETE" });
}

export function getExportUrl(jobId: string): string {
  return url(`/api/analysis/jobs/${jobId}/export?format=csv`);
}
