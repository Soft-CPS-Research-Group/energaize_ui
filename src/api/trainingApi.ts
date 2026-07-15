import { http, jobOrchestratorFileUrl, jobOrchestratorHttp } from "./client";
import type {
  DatasetItem,
  HostsPayload,
  JobInfo,
  JobItem,
  JobStatus,
  QueueItem
} from "../types";
import { normalizeJobStatus } from "../utils/jobStatus";
import {
  getExampleJobInfo,
  getExampleJobLogs,
  getExampleJobProgress,
  getExampleJobResult,
  getExampleJobStatus,
  listExampleJobs
} from "../mocks/exampleJobs";

const DEV_JOBS_ORCHESTRATOR_TIMEOUT_MS = 15000;

export interface DatasetCreatePayload {
  name: string;
  site_id: string;
  citylearn_configs: Record<string, unknown>;
  description?: string;
  period?: number;
  from_ts?: string;
  until_ts?: string;
}

export interface DatasetSiteItem {
  site_id: string;
  buildings: string[];
}

export interface DatasetCreateResponse {
  message: string;
  name: string;
  description?: string;
  format?: string;
  type?: string;
  formats?: string[];
  format_counts?: Record<string, number>;
  warnings?: string[];
  validation?: Record<string, unknown>;
}

export interface RunSimulationPayload {
  config?: Record<string, unknown>;
  config_path?: string;
  target_host?: string;
  target_worker_profile?: "cpu" | "gpu";
  save_as?: string;
  job_name?: string;
  submitted_by?: string;
  image_tag?: string;
  deucalion_options?: {
    account?: string;
    partition?: string;
    time_limit?: string;
    cpus_per_task?: number;
    mem_gb?: number;
    gpus?: number;
    modules?: string[];
    command_mode?: "run" | "exec";
    datasets?: string[];
    required_paths?: string[];
  };
}

export interface JobActionResponse {
  message?: string;
  status?: JobStatus;
  job_id?: string;
}

export interface WorkerAuthenticationResponse {
  worker_id: string;
  action: "union_authenticate";
  request_id: string;
  requested_at: number;
}

export interface JobImageTag {
  name: string;
  last_updated?: string;
  digest?: string | null;
  deucalion_ready?: boolean;
}

export interface JobImageVersionsResponse {
  repository: string;
  sif_repository?: string;
  tags: JobImageTag[];
  count: number;
  cached: boolean;
  fetched_at: number;
}

export async function listDatasets(): Promise<DatasetItem[]> {
  return jobOrchestratorHttp<DatasetItem[]>("/datasets");
}

export async function listDatasetSites(): Promise<{ sites: DatasetSiteItem[] }> {
  return jobOrchestratorHttp<{ sites: DatasetSiteItem[] }>("/dataset/sites");
}

export async function createDataset(payload: DatasetCreatePayload): Promise<DatasetCreateResponse> {
  return jobOrchestratorHttp<DatasetCreateResponse>("/dataset", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function uploadDataset(payload: { file: File; name: string }): Promise<{
  message: string;
  name: string;
  format?: string;
  type?: string;
  formats?: string[];
  format_counts?: Record<string, number>;
}> {
  const formData = new FormData();
  formData.append("file", payload.file);
  formData.append("name", payload.name);
  return jobOrchestratorHttp<{
    message: string;
    name: string;
    format?: string;
    type?: string;
    formats?: string[];
    format_counts?: Record<string, number>;
  }>("/dataset/upload", {
    method: "POST",
    body: formData
  });
}

export async function deleteDataset(name: string): Promise<{ message: string }> {
  return jobOrchestratorHttp<{ message: string }>(`/dataset/${encodeURIComponent(name)}`, {
    method: "DELETE"
  });
}

export function datasetDownloadUrl(name: string): string {
  return jobOrchestratorFileUrl(`/dataset/download/${encodeURIComponent(name)}`);
}

export async function listDatesAvailable(siteId: string): Promise<Array<Record<string, string>>> {
  return jobOrchestratorHttp<Array<Record<string, string>>>(`/dataset/dates-available/${encodeURIComponent(siteId)}`);
}

export async function listExperimentConfigs(): Promise<string[]> {
  return jobOrchestratorHttp<string[]>("/experiment-configs");
}

export async function getExperimentConfig(
  fileName: string
): Promise<{ yaml_content: string }> {
  const yamlContent = await jobOrchestratorHttp<string>(
    `/experiment-config/${encodeURIComponent(fileName)}`,
    undefined,
    { responseType: "text" }
  );
  return { yaml_content: yamlContent };
}

export async function saveExperimentConfig(payload: {
  file_name: string;
  yaml_content: string;
}): Promise<{ message: string; file: string }> {
  return jobOrchestratorHttp<{ message: string; file: string }>("/experiment-config/create", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateExperimentConfig(payload: {
  file_name: string;
  yaml_content: string;
}): Promise<{ message: string; file?: string }> {
  return jobOrchestratorHttp<{ message: string; file?: string }>(
    `/experiment-config/${encodeURIComponent(payload.file_name)}`,
    {
      method: "PUT",
      body: JSON.stringify({ yaml_content: payload.yaml_content })
    }
  );
}

export async function deleteExperimentConfig(fileName: string): Promise<{ message: string }> {
  return jobOrchestratorHttp<{ message: string }>(`/experiment-config/${encodeURIComponent(fileName)}`, {
    method: "DELETE"
  });
}

export async function runSimulation(payload: RunSimulationPayload): Promise<{
  job_id: string;
  status: JobStatus;
  host?: string;
  job_name?: string;
  image_tag?: string;
  image?: string;
}> {
  const result = await jobOrchestratorHttp<{
    job_id: string;
    status: string;
    host?: string;
    job_name?: string;
    image_tag?: string;
    image?: string;
  }>("/run-simulation", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  return {
    ...result,
    status: normalizeJobStatus(result.status)
  };
}

export function listLocalJobs(): JobItem[] {
  return listExampleJobs().map((item) => ({
    ...item,
    status: normalizeJobStatus(item.status)
  }));
}

export function listJobsInitialData(): JobItem[] | undefined {
  if (!import.meta.env.DEV) return undefined;
  const localJobs = listLocalJobs();
  return localJobs.length > 0 ? localJobs : undefined;
}

export async function listJobs(): Promise<JobItem[]> {
  let requestError: unknown = null;
  let backendJobs: JobItem[] = [];
  const localExampleJobs = listLocalJobs();
  let backendTimeoutId: number | null = null;

  try {
    const controller =
      import.meta.env.DEV && localExampleJobs.length > 0 ? new AbortController() : null;
    backendTimeoutId = controller
      ? window.setTimeout(() => controller.abort(), DEV_JOBS_ORCHESTRATOR_TIMEOUT_MS)
      : null;

    const result = await jobOrchestratorHttp<
      Array<
        Omit<JobItem, "status"> & {
          status: string;
          job_info: JobInfo;
        }
      >
    >("/jobs", controller ? { signal: controller.signal } : undefined);
    backendJobs = result.map((item) => ({
      ...item,
      status: normalizeJobStatus(item.status)
    }));
  } catch (error) {
    requestError = error;
  } finally {
    if (backendTimeoutId) window.clearTimeout(backendTimeoutId);
  }

  const merged = new Map<string, JobItem>();
  backendJobs.forEach((item) => merged.set(item.job_id, item));
  localExampleJobs.forEach((item) => {
    if (!merged.has(item.job_id)) merged.set(item.job_id, item);
  });

  if (merged.size === 0 && requestError) {
    throw requestError;
  }

  return Array.from(merged.values());
}

export async function getJobStatus(jobId: string): Promise<{ job_id: string; status: JobStatus }> {
  const local = getExampleJobStatus(jobId);
  if (local) {
    return { job_id: jobId, status: normalizeJobStatus(local) };
  }

  const result = await jobOrchestratorHttp<{ job_id: string; status: string }>(`/status/${encodeURIComponent(jobId)}`);
  return {
    ...result,
    status: normalizeJobStatus(result.status)
  };
}

export async function getJobInfo(jobId: string): Promise<JobInfo> {
  const local = getExampleJobInfo(jobId);
  if (local) return local;
  return jobOrchestratorHttp<JobInfo>(`/job-info/${encodeURIComponent(jobId)}`);
}

export async function getJobProgress(jobId: string): Promise<Record<string, unknown>> {
  const local = getExampleJobProgress(jobId);
  if (local) return local;
  return jobOrchestratorHttp<Record<string, unknown>>(`/progress/${encodeURIComponent(jobId)}`);
}

export async function getJobResult(jobId: string): Promise<Record<string, unknown>> {
  const local = getExampleJobResult(jobId);
  if (local) return local;
  return jobOrchestratorHttp<Record<string, unknown>>(`/result/${encodeURIComponent(jobId)}`);
}

export async function getJobFileLogs(jobId: string): Promise<string> {
  const local = await getExampleJobLogs(jobId);
  if (local) return local;
  return jobOrchestratorHttp<string>(`/file-logs/${encodeURIComponent(jobId)}`, undefined, {
    responseType: "text"
  });
}

export async function getJobLogs(jobId: string): Promise<string> {
  const local = await getExampleJobLogs(jobId);
  if (local) return local;
  return jobOrchestratorHttp<string>(`/logs/${encodeURIComponent(jobId)}`, undefined, {
    responseType: "text"
  });
}

export interface JobLogsChunkResponse {
  job_id: string;
  text: string;
  next_offset: number;
  truncated: boolean;
  available: boolean;
  message?: string | null;
}

function normalizeLogsChunkResponse(
  jobId: string,
  payload: unknown,
  requestedOffset?: number
): JobLogsChunkResponse {
  const safeOffset =
    typeof requestedOffset === "number" && Number.isFinite(requestedOffset) && requestedOffset >= 0
      ? Math.floor(requestedOffset)
      : 0;

  const fallbackFromText = (text: string): JobLogsChunkResponse => ({
    job_id: jobId,
    text,
    next_offset: safeOffset + text.length,
    truncated: false,
    available: text.trim().length > 0,
    message: text.trim().length > 0 ? null : "No logs available yet."
  });

  if (typeof payload === "string") {
    const raw = payload.trim();
    if (raw.startsWith("{") || raw.startsWith("[")) {
      try {
        return normalizeLogsChunkResponse(jobId, JSON.parse(payload), requestedOffset);
      } catch {
        return fallbackFromText(payload);
      }
    }
    return fallbackFromText(payload);
  }

  if (!payload || typeof payload !== "object") {
    return fallbackFromText("");
  }

  const record = payload as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : "";
  const nextOffsetRaw =
    typeof record.next_offset === "number"
      ? record.next_offset
      : typeof record.nextOffset === "number"
        ? record.nextOffset
        : safeOffset + text.length;

  return {
    job_id: typeof record.job_id === "string" ? record.job_id : jobId,
    text,
    next_offset: Number.isFinite(nextOffsetRaw) ? Math.max(0, Math.floor(nextOffsetRaw)) : safeOffset + text.length,
    truncated: Boolean(record.truncated),
    available:
      typeof record.available === "boolean"
        ? record.available
        : text.trim().length > 0,
    message: typeof record.message === "string" ? record.message : null
  };
}

export async function getJobLogsChunk(
  jobId: string,
  params?: { offset?: number; tailLines?: number; maxBytes?: number }
): Promise<JobLogsChunkResponse> {
  const query = new URLSearchParams();
  if (typeof params?.offset === "number" && Number.isFinite(params.offset) && params.offset >= 0) {
    query.set("offset", String(Math.floor(params.offset)));
  }
  if (typeof params?.tailLines === "number" && Number.isFinite(params.tailLines) && params.tailLines > 0) {
    query.set("tail_lines", String(Math.floor(params.tailLines)));
  }
  if (typeof params?.maxBytes === "number" && Number.isFinite(params.maxBytes) && params.maxBytes > 0) {
    query.set("max_bytes", String(Math.floor(params.maxBytes)));
  }
  const suffix = query.toString();
  const payload = await jobOrchestratorHttp<unknown>(
    `/logs-chunk/${encodeURIComponent(jobId)}${suffix ? `?${suffix}` : ""}`
  );
  return normalizeLogsChunkResponse(jobId, payload, params?.offset);
}

export async function getJobResolvedConfig(jobId: string): Promise<{ yaml_content: string }> {
  const yamlContent = await jobOrchestratorHttp<string>(
    `/job-resolved-config/${encodeURIComponent(jobId)}`,
    undefined,
    { responseType: "text" }
  );
  return { yaml_content: yamlContent };
}

export async function stopJob(jobId: string): Promise<JobActionResponse> {
  return jobOrchestratorHttp<JobActionResponse>(`/stop/${encodeURIComponent(jobId)}`, {
    method: "POST"
  });
}

export async function opsStopJob(payload: { job_id: string; reason?: string }): Promise<JobActionResponse> {
  const { job_id, reason = "ops_stop" } = payload;
  return jobOrchestratorHttp<JobActionResponse>(`/ops/jobs/${encodeURIComponent(job_id)}/stop`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export async function deleteJob(jobId: string): Promise<JobActionResponse> {
  return jobOrchestratorHttp<JobActionResponse>(`/job/${encodeURIComponent(jobId)}`, {
    method: "DELETE"
  });
}

export async function listQueue(): Promise<QueueItem[]> {
  return jobOrchestratorHttp<QueueItem[]>("/queue");
}

export async function listHosts(): Promise<HostsPayload> {
  return jobOrchestratorHttp<HostsPayload>("/hosts");
}

export async function authenticateWorker(workerId: string): Promise<WorkerAuthenticationResponse> {
  return jobOrchestratorHttp<WorkerAuthenticationResponse>(
    `/ops/workers/${encodeURIComponent(workerId)}/authenticate`,
    { method: "POST" }
  );
}

export async function listJobImageVersions(params?: {
  repository?: string;
  limit?: number;
}): Promise<JobImageVersionsResponse> {
  const search = new URLSearchParams();
  if (params?.repository) search.set("repository", params.repository);
  if (params?.limit) search.set("limit", String(params.limit));
  const suffix = search.size ? `?${search.toString()}` : "";
  return jobOrchestratorHttp<JobImageVersionsResponse>(`/job-images/versions${suffix}`);
}

export async function opsRequeueJob(payload: {
  job_id: string;
  force?: boolean;
  preferred_host?: string | null;
  require_host?: boolean | null;
}): Promise<JobActionResponse> {
  const { job_id, ...body } = payload;
  return jobOrchestratorHttp<JobActionResponse>(`/ops/jobs/${encodeURIComponent(job_id)}/requeue`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function opsFailJob(payload: {
  job_id: string;
  reason?: string;
  force?: boolean;
}): Promise<JobActionResponse> {
  const { job_id, ...body } = payload;
  return jobOrchestratorHttp<JobActionResponse>(`/ops/jobs/${encodeURIComponent(job_id)}/fail`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function opsCancelJob(payload: {
  job_id: string;
  reason?: string;
  force?: boolean;
}): Promise<JobActionResponse> {
  const { job_id, ...body } = payload;
  return jobOrchestratorHttp<JobActionResponse>(`/ops/jobs/${encodeURIComponent(job_id)}/cancel`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function opsCleanupQueue(force = false): Promise<{ count: number; removed: string[] }> {
  return jobOrchestratorHttp<{ count: number; removed: string[] }>("/ops/queue/cleanup", {
    method: "POST",
    body: JSON.stringify({ force })
  });
}

export async function opsCleanupJobs(keep?: string[]): Promise<{
  removed: string[];
  kept: string[];
  count: number;
}> {
  return jobOrchestratorHttp<{ removed: string[]; kept: string[]; count: number }>("/ops/jobs/cleanup", {
    method: "POST",
    body: JSON.stringify({ keep })
  });
}

export async function listEnergyCommunities(): Promise<{ energy_communities: string[] }> {
  return http<{ energy_communities: string[] }>("/energy-communities");
}
