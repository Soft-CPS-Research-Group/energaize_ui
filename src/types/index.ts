export type UserRole = "rec_manager" | "prosumer" | "ai_manager";

export type ThemeMode = "light" | "dark";

export interface Session {
  email: string;
  name: string;
  role: UserRole;
  remember: boolean;
}

export interface CommunityContext {
  id: string;
  name: string;
  location: string;
  description?: string;
  buildings: number;
  assets?: number;
  status: "normal" | "alerts" | "offline";
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: number;
  severity: "info" | "success" | "warning" | "error";
  read: boolean;
  source?: string;
}

export interface ToastItem {
  id: string;
  title: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
  createdAt: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  source: string;
  level: "info" | "warning" | "error" | "debug";
  message: string;
  entity?: string;
}

export interface DatasetItem {
  name: string;
  description?: string;
}

export interface ExperimentConfigItem {
  file_name: string;
}

export type JobStatus = string;

export interface JobInfo {
  job_id: string;
  job_name?: string;
  config_path?: string;
  target_host?: string;
  experiment_name?: string;
  run_name?: string;
  mlflow_run_url?: string;
  [key: string]: unknown;
}

export interface JobItem {
  job_id: string;
  status: JobStatus;
  job_info: JobInfo;
}

export interface JobResultViewModel {
  jobId: string;
  status: JobStatus;
  info: JobInfo | null;
  progress: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}

export interface KpiEntry {
  key: string;
  label: string;
  value: number;
  unit?: string;
}

export interface TimeseriesPoint {
  x: number | string;
  y: number;
}

export interface TimeseriesEntry {
  id: string;
  name: string;
  points: TimeseriesPoint[];
}

export interface ArtifactEntry {
  name: string;
  pathOrUri: string;
  kind: string;
}

export interface JobKpiComparisonRow {
  key: string;
  label: string;
  left: number | null;
  right: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
}

export interface QueueItem {
  job_id: string;
  preferred_host?: string | null;
  require_host?: boolean;
}

export interface HostInfo {
  online: boolean;
  last_seen: number | null;
  info: Record<string, unknown>;
  running: number;
}

export interface HostItem {
  name: string;
  data: HostInfo;
}

export interface HostsPayload {
  available_hosts: string[];
  hosts: Record<string, HostInfo>;
}

export interface ApiErrorShape {
  detail?: string;
  message?: string;
}
