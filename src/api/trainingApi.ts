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
}

export interface JobActionResponse {
  message?: string;
  status?: JobStatus;
  job_id?: string;
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
): Promise<{ config: Record<string, unknown> }> {
  return http<{ config: Record<string, unknown> }>(
    `/experiment-config/${encodeURIComponent(fileName)}`
  );
}

export async function saveExperimentConfig(payload: {
  file_name: string;
  config: Record<string, unknown>;
}): Promise<{ message: string; file: string }> {
  return http<{ message: string; file: string }>("/experiment-config/create", {
    method: "POST",
    body: JSON.stringify(payload)
  });
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
}> {
  const result = await http<{
    job_id: string;
    status: string;
    host?: string;
    job_name?: string;
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
  const result = await http<Array<{ job_id: string; status: string; job_info: JobInfo }>>("/jobs");
  return result.map((item) => ({
    ...item,
    status: normalizeJobStatus(item.status)
  }));
}

export async function getJobStatus(jobId: string): Promise<{ job_id: string; status: JobStatus }> {
  const result = await http<{ job_id: string; status: string }>(`/status/${encodeURIComponent(jobId)}`);
  return {
    ...result,
    status: normalizeJobStatus(result.status)
  };
}

export async function getJobInfo(jobId: string): Promise<JobInfo> {
  return http<JobInfo>(`/job-info/${encodeURIComponent(jobId)}`);
}

export async function getJobProgress(jobId: string): Promise<Record<string, unknown>> {
  return http<Record<string, unknown>>(`/progress/${encodeURIComponent(jobId)}`);
}

export async function getJobResult(jobId: string): Promise<Record<string, unknown>> {
  return http<Record<string, unknown>>(`/result/${encodeURIComponent(jobId)}`);
}

export async function getJobFileLogs(jobId: string): Promise<string> {
  return http<string>(`/file-logs/${encodeURIComponent(jobId)}`, undefined, {
    responseType: "text"
  });
}

export async function getJobLogs(jobId: string): Promise<string> {
  return http<string>(`/logs/${encodeURIComponent(jobId)}`, undefined, {
    responseType: "text"
  });
}

export async function stopJob(jobId: string): Promise<JobActionResponse> {
  return http<JobActionResponse>(`/stop/${encodeURIComponent(jobId)}`, {
    method: "POST"
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
