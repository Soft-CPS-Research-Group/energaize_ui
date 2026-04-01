import { apiFileUrl, http } from "./client";
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

export interface DatasetCreatePayload {
  name: string;
  site_id: string;
  citylearn_configs: Record<string, unknown>;
  description?: string;
  period?: number;
  from_ts?: string;
  until_ts?: string;
}

export interface RunSimulationPayload {
  config?: Record<string, unknown>;
  config_path?: string;
  target_host?: string;
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
  return http<DatasetItem[]>("/datasets");
}

export async function createDataset(payload: DatasetCreatePayload): Promise<{ message: string }> {
  return http<{ message: string }>("/dataset", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function uploadDataset(payload: { file: File; name: string }): Promise<{ message: string; name: string }> {
  const formData = new FormData();
  formData.append("file", payload.file);
  formData.append("name", payload.name);
  return http<{ message: string; name: string }>("/dataset/upload", {
    method: "POST",
    body: formData
  });
}

export async function deleteDataset(name: string): Promise<{ message: string }> {
  return http<{ message: string }>(`/dataset/${encodeURIComponent(name)}`, {
    method: "DELETE"
  });
}

export function datasetDownloadUrl(name: string): string {
  return apiFileUrl(`/dataset/download/${encodeURIComponent(name)}`);
}

export async function listDatesAvailable(siteId: string): Promise<Array<Record<string, string>>> {
  return http<Array<Record<string, string>>>(`/dataset/dates-available/${encodeURIComponent(siteId)}`);
}

export async function listExperimentConfigs(): Promise<string[]> {
  return http<string[]>("/experiment-configs");
}

export async function getExperimentConfig(
  fileName: string
): Promise<{ yaml_content: string }> {
  const yamlContent = await http<string>(
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
  return http<{ message: string; file: string }>("/experiment-config/create", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateExperimentConfig(payload: {
  file_name: string;
  yaml_content: string;
}): Promise<{ message: string; file?: string }> {
  return http<{ message: string; file?: string }>(
    `/experiment-config/${encodeURIComponent(payload.file_name)}`,
    {
      method: "PUT",
      body: JSON.stringify({ yaml_content: payload.yaml_content })
    }
  );
}

export async function deleteExperimentConfig(fileName: string): Promise<{ message: string }> {
  return http<{ message: string }>(`/experiment-config/${encodeURIComponent(fileName)}`, {
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
  const result = await http<{
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

export async function listJobs(): Promise<JobItem[]> {
  let requestError: unknown = null;
  let backendJobs: JobItem[] = [];

  try {
    const result = await http<
      Array<
        Omit<JobItem, "status"> & {
          status: string;
          job_info: JobInfo;
        }
      >
    >("/jobs");
    backendJobs = result.map((item) => ({
      ...item,
      status: normalizeJobStatus(item.status)
    }));
  } catch (error) {
    requestError = error;
  }

  const localExampleJobs = listExampleJobs().map((item) => ({
    ...item,
    status: normalizeJobStatus(item.status)
  }));

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

  const result = await http<{ job_id: string; status: string }>(`/status/${encodeURIComponent(jobId)}`);
  return {
    ...result,
    status: normalizeJobStatus(result.status)
  };
}

export async function getJobInfo(jobId: string): Promise<JobInfo> {
  const local = getExampleJobInfo(jobId);
  if (local) return local;
  return http<JobInfo>(`/job-info/${encodeURIComponent(jobId)}`);
}

export async function getJobProgress(jobId: string): Promise<Record<string, unknown>> {
  const local = getExampleJobProgress(jobId);
  if (local) return local;
  return http<Record<string, unknown>>(`/progress/${encodeURIComponent(jobId)}`);
}

export async function getJobResult(jobId: string): Promise<Record<string, unknown>> {
  const local = getExampleJobResult(jobId);
  if (local) return local;
  return http<Record<string, unknown>>(`/result/${encodeURIComponent(jobId)}`);
}

export async function getJobFileLogs(jobId: string): Promise<string> {
  const local = await getExampleJobLogs(jobId);
  if (local) return local;
  return http<string>(`/file-logs/${encodeURIComponent(jobId)}`, undefined, {
    responseType: "text"
  });
}

export async function getJobLogs(jobId: string): Promise<string> {
  const local = await getExampleJobLogs(jobId);
  if (local) return local;
  return http<string>(`/logs/${encodeURIComponent(jobId)}`, undefined, {
    responseType: "text"
  });
}

export async function getJobResolvedConfig(jobId: string): Promise<{ yaml_content: string }> {
  const yamlContent = await http<string>(
    `/job-resolved-config/${encodeURIComponent(jobId)}`,
    undefined,
    { responseType: "text" }
  );
  return { yaml_content: yamlContent };
}

export async function stopJob(jobId: string): Promise<JobActionResponse> {
  return http<JobActionResponse>(`/stop/${encodeURIComponent(jobId)}`, {
    method: "POST"
  });
}

export async function opsStopJob(payload: { job_id: string; reason?: string }): Promise<JobActionResponse> {
  const { job_id, reason = "ops_stop" } = payload;
  return http<JobActionResponse>(`/ops/jobs/${encodeURIComponent(job_id)}/stop`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export async function deleteJob(jobId: string): Promise<JobActionResponse> {
  return http<JobActionResponse>(`/job/${encodeURIComponent(jobId)}`, {
    method: "DELETE"
  });
}

export async function listQueue(): Promise<QueueItem[]> {
  return http<QueueItem[]>("/queue");
}

export async function listHosts(): Promise<HostsPayload> {
  return http<HostsPayload>("/hosts");
}

export async function listJobImageVersions(params?: {
  repository?: string;
  limit?: number;
}): Promise<JobImageVersionsResponse> {
  const search = new URLSearchParams();
  if (params?.repository) search.set("repository", params.repository);
  if (params?.limit) search.set("limit", String(params.limit));
  const suffix = search.size ? `?${search.toString()}` : "";
  return http<JobImageVersionsResponse>(`/job-images/versions${suffix}`);
}

export async function opsRequeueJob(payload: {
  job_id: string;
  force?: boolean;
  preferred_host?: string | null;
  require_host?: boolean | null;
}): Promise<JobActionResponse> {
  const { job_id, ...body } = payload;
  return http<JobActionResponse>(`/ops/jobs/${encodeURIComponent(job_id)}/requeue`, {
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
  return http<JobActionResponse>(`/ops/jobs/${encodeURIComponent(job_id)}/fail`, {
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
  return http<JobActionResponse>(`/ops/jobs/${encodeURIComponent(job_id)}/cancel`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function opsCleanupQueue(force = false): Promise<{ count: number; removed: string[] }> {
  return http<{ count: number; removed: string[] }>("/ops/queue/cleanup", {
    method: "POST",
    body: JSON.stringify({ force })
  });
}

export async function opsCleanupJobs(keep?: string[]): Promise<{
  removed: string[];
  kept: string[];
  count: number;
}> {
  return http<{ removed: string[]; kept: string[]; count: number }>("/ops/jobs/cleanup", {
    method: "POST",
    body: JSON.stringify({ keep })
  });
}

export async function listEnergyCommunities(): Promise<{ energy_communities: string[] }> {
  return http<{ energy_communities: string[] }>("/energy-communities");
}
