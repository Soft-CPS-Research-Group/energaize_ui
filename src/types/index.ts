export type UserRole =
  | "rec_manager"
  | "prosumer"
  | "ai_manager"
  | "training_manager"
  | "predictor"
  | "kpi_manager";

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
  topologyPreset?: "demo" | "blank";
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
  format?: string;
  type?: string;
  dataset_type?: string;
  file_format?: string;
  data_format?: string;
  formats?: string[];
}

export interface ExperimentConfigItem {
  file_name: string;
}

export type JobStatus = string;

export interface JobEmailNotificationAttempt {
  job_id?: string;
  status?: string;
  previous_status?: string | null;
  attempted_at?: number | string | null;
  submitted_by?: string | null;
  attempted?: boolean;
  published?: boolean;
  outcome?: "published" | "failed" | "skipped" | string;
  reason?: string | null;
  recipients?: string[];
  subject?: string | null;
  error?: string | null;
  rabbitmq?: {
    host?: string;
    port?: number;
    queue?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface JobInfo {
  job_id: string;
  job_name?: string;
  config_path?: string;
  image?: string;
  resolved_config_available?: boolean;
  resolved_config_file?: string;
  target_host?: string;
  experiment_name?: string;
  run_name?: string;
  submitted_by?: string;
  community_name?: string;
  energy_community?: string;
  description?: string;
  mlflow_run_url?: string;
  submitted_at?: number | null;
  queued_at?: number | null;
  dispatched_at?: number | null;
  started_at?: number | null;
  stop_requested_at?: number | null;
  finished_at?: number | null;
  last_status_at?: number | null;
  queue_wait_seconds?: number | null;
  run_duration_seconds?: number | null;
  total_duration_seconds?: number | null;
  last_email_notification?: JobEmailNotificationAttempt | null;
  email_notifications?: JobEmailNotificationAttempt[];
  [key: string]: unknown;
}

export interface JobItem {
  job_id: string;
  status: JobStatus;
  job_info: JobInfo;
  submitted_at?: number | null;
  queued_at?: number | null;
  dispatched_at?: number | null;
  started_at?: number | null;
  stop_requested_at?: number | null;
  finished_at?: number | null;
  last_status_at?: number | null;
  queue_wait_seconds?: number | null;
  run_duration_seconds?: number | null;
  total_duration_seconds?: number | null;
  requeue_count?: number | null;
  attempt_number?: number | null;
  job_meta?: Record<string, unknown> & {
    last_email_notification?: JobEmailNotificationAttempt | null;
    email_notifications?: JobEmailNotificationAttempt[];
  };
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
  source?: string;
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

export type SimulationFileKind =
  | "community"
  | "building"
  | "battery"
  | "charger"
  | "electric_vehicle"
  | "pricing"
  | "kpi"
  | "unknown";

export interface SimulationDataFileEntry {
  id: string;
  relativePath: string;
  fileName: string;
  runFolder: string | null;
  episode: string | null;
  kind: SimulationFileKind;
  buildingId?: string;
  chargerId?: string;
  vehicleId?: string;
}

export interface SimulationTreeNode {
  id: string;
  label: string;
  kind: SimulationFileKind | "group" | "root";
  selectable: boolean;
  fileRefs: string[];
  children: SimulationTreeNode[];
}

export interface SimulationSeriesPoint {
  timestamp: string;
  epochMs: number | null;
  value: number;
}

export interface SimulationSeries {
  id: string;
  fileRef: string;
  metric: string;
  unit?: string;
  points: SimulationSeriesPoint[];
}

export interface KpiMatrixRow {
  key: string;
  label: string;
  unit?: string;
  values: Record<string, number | null>;
}

export type KpiImprovementTone = "better" | "worse" | "neutral" | "unknown";

export interface ComparedKpiRow {
  key: string;
  label: string;
  left: number | null;
  right: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  tone: KpiImprovementTone;
}

export interface QueueItem {
  job_id: string;
  enqueued_at?: number | null;
  preferred_host?: string | null;
  require_host?: boolean;
  submitted_by?: string | null;
}

export interface HostInfo {
  online: boolean;
  last_seen: number | null;
  info: {
    executor?: string;
    worker_version?: string;
    max_active_jobs?: number | null;
    max_active_jobs_by_profile?: {
      cpu?: number;
      gpu?: number;
      [key: string]: number | undefined;
    };
    active_job_id?: string | null;
    active_job_count?: number | null;
    active_job_count_by_profile?: {
      cpu?: number;
      gpu?: number;
      [key: string]: number | undefined;
    };
    active_job_ids_by_profile?: {
      cpu?: string[];
      gpu?: string[];
      [key: string]: string[] | undefined;
    };
    active_job_ids?: string[];
    active_jobs?: Array<{
      job_id: string;
      job_name?: string;
      status?: string;
      phase?: string;
      slurm_job_id?: string;
      slurm_state?: string;
      slurm_partition?: string;
      slurm_nodes?: number;
      slurm_cpus?: number;
      slurm_gpus?: number;
      queue_pos?: number;
      ahead?: number;
      updated_at?: number | string;
    }>;
    active_job_status?: string | null;
    last_job_id?: string | null;
    last_terminal_status?: string | null;
    budget?: {
      accounts?: Array<{
        account: string;
        used_hours: number;
        limit_hours: number;
        used_percent: number;
      }>;
    } | null;
    budget_refreshed_at?: number | null;
    [key: string]: unknown;
  };
  running: number;
  active_job_ids?: string[];
  current_job_id?: string | null;
  current_job_status?: string | null;
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
