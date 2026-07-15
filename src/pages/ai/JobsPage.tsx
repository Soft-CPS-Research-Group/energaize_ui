import { useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import {
  Copy,
  Cpu,
  Download,
  Eye,
  FileText,
  FlaskConical,
  Info,
  Play,
  RefreshCcw,
  Search,
  Server,
  Trash2,
  TriangleAlert,
  ExternalLink
} from "lucide-react";
import {
  authenticateWorker,
  deleteJob,
  getExperimentConfig,
  getJobFileLogs,
  getJobProgress,
  getJobResolvedConfig,
  listExperimentConfigs,
  listHosts,
  listJobImageVersions,
  listJobs,
  listJobsInitialData,
  listQueue,
  opsCancelJob,
  opsCleanupJobs,
  opsCleanupQueue,
  opsFailJob,
  opsRequeueJob,
  opsStopJob,
  runSimulation,
  type RunSimulationPayload
} from "../../api/trainingApi";
import { HOSTS_POLL_MS, JOB_POLL_MS, LOGS_POLL_MS } from "../../constants";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { StatusPill } from "../../components/ui/StatusPill";
import { useApiFeedback } from "../../hooks/useApiFeedback";
import { useJobLogsPolling } from "../../hooks/useJobLogsPolling";
import { useJobStatusNotifications } from "../../hooks/useJobStatusNotifications";
import type { HostInfo, JobItem, QueueItem, QueuedStartEstimate } from "../../types";
import { resolveHostCapacitySummary } from "../../utils/hostCapacity";
import { inferBudgetAccountKind } from "../../utils/hostBudget";
import { resolveHostComputeBadge } from "../../utils/hostCompute";
import { formatHostName } from "../../utils/hostDisplay";
import { isCompletedForResults, resolveDisplayJobStatus } from "../../utils/jobStatus";
import { resolveMlflowRunUrl } from "../../utils/mlflow";
import { buildJobsListStateFromSearchParams, toJobsListSearchParams } from "../../utils/jobsListState";
import { formatDateTime, formatDurationSeconds } from "../../utils/time";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

interface RunForm {
  configPath: string;
  jobName: string;
  targetHost: string;
  targetWorkerProfile: "" | "cpu" | "gpu";
  imageTag: string;
  deucalionOptions: {
    account: string;
    partition: string;
    timeLimit: string;
    cpusPerTask: string;
    memGb: string;
    gpus: string;
    commandMode: "run" | "exec";
  };
}

type AdminActionType = "requeue" | "cancel" | "stop" | "fail" | "cleanup_queue" | "cleanup_jobs";

interface AdminConfirmState {
  action: AdminActionType;
  jobId?: string;
}

type DetailTabForJobs = "overview" | "timeseries" | "kpis" | "deploy";

interface SlurmDispatchSnapshot {
  details: Record<string, unknown> | null;
  slurmJobId: string | null;
  slurmState: string | null;
  slurmPartition: string | null;
  slurmReason: string | null;
  slurmSubmitTime: string | null;
  slurmStartTime: string | null;
  slurmElapsed: string | null;
  slurmTimeLeft: string | null;
  slurmPriority: number | null;
  slurmQueuePosition: number | null;
  slurmJobsAhead: number | null;
  slurmPendingJobsInPartition: number | null;
  connectivity: string | null;
  unknownSince: string | number | null;
  datasetsSynced: string[];
  datasetsSkipped: string[];
}

interface HostActiveJobSnapshot {
  job_id: string;
  job_name?: string;
  status?: string;
  phase?: string;
  slurm_state?: string;
  slurm_partition?: string;
  slurm_nodes?: number;
  slurm_cpus?: number;
  slurm_gpus?: number;
  queue_pos?: number;
  ahead?: number;
}

type DeucalionRuntimeProfile = "cpu" | "gpu";
type RunWizardStep = { id: string; label: string };
type DeucalionPartitionLimit = {
  partition: string;
  profile: DeucalionRuntimeProfile;
  label: string;
  maxSeconds: number;
};
type ProgressInfo = {
  percent: number | null;
  updatedAt: string | number | null;
  etaSeconds: number | null;
  estimatedFinishAt: string | number | null;
  etaAvailable: boolean;
  etaReason: string | null;
};

const RUN_WIZARD_BASE_STEPS: RunWizardStep[] = [
  { id: "config", label: "Config" },
  { id: "target", label: "Host" },
  { id: "runtime", label: "Runtime" },
  { id: "review", label: "Review" }
];

const RUN_WIZARD_DEUCALION_STEP: RunWizardStep = { id: "deucalion", label: "Deucalion" };

const DEUCALION_PROFILE_DEFAULTS: Record<
  DeucalionRuntimeProfile,
  { timeLimit: string; cpusPerTask: string; memGb: string; gpus: string }
> = {
  cpu: {
    timeLimit: "04:00:00",
    cpusPerTask: "4",
    memGb: "8",
    gpus: ""
  },
  gpu: {
    timeLimit: "04:00:00",
    cpusPerTask: "8",
    memGb: "16",
    gpus: "1"
  }
};

const DEUCALION_PARTITION_LIMITS: DeucalionPartitionLimit[] = [
  { partition: "dev-arm", profile: "cpu", label: "ARM dev", maxSeconds: 4 * 60 * 60 },
  { partition: "normal-arm", profile: "cpu", label: "ARM normal", maxSeconds: 48 * 60 * 60 },
  { partition: "large-arm", profile: "cpu", label: "ARM large", maxSeconds: 72 * 60 * 60 },
  { partition: "dev-x86", profile: "cpu", label: "x86 dev", maxSeconds: 4 * 60 * 60 },
  { partition: "normal-x86", profile: "cpu", label: "x86 normal", maxSeconds: 48 * 60 * 60 },
  { partition: "large-x86", profile: "cpu", label: "x86 large", maxSeconds: 72 * 60 * 60 },
  { partition: "dev-a100-40", profile: "gpu", label: "A100 40GB dev", maxSeconds: 4 * 60 * 60 },
  { partition: "normal-a100-40", profile: "gpu", label: "A100 40GB normal", maxSeconds: 48 * 60 * 60 },
  { partition: "dev-a100-80", profile: "gpu", label: "A100 80GB dev", maxSeconds: 4 * 60 * 60 },
  { partition: "normal-a100-80", profile: "gpu", label: "A100 80GB normal", maxSeconds: 48 * 60 * 60 }
];

function formatWalltimeLimit(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (minutes === 0 && secs === 0) return `${hours}h`;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function parseSlurmWalltimeSeconds(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;

  let days = 0;
  let timePart = text;
  const hasDays = text.includes("-");
  if (hasDays) {
    const dashIndex = text.indexOf("-");
    const dayPart = text.slice(0, dashIndex);
    const rest = text.slice(dashIndex + 1);
    if (!/^\d+$/.test(dayPart) || !rest) return null;
    days = Number(dayPart);
    timePart = rest;
  }

  const parts = timePart.split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const values = parts.map(Number);

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (hasDays) {
    hours = values[0] || 0;
    minutes = values[1] || 0;
    seconds = values[2] || 0;
  } else if (values.length === 1) {
    minutes = values[0];
  } else if (values.length === 2) {
    minutes = values[0];
    seconds = values[1];
  } else {
    hours = values[0];
    minutes = values[1];
    seconds = values[2];
  }

  if (minutes >= 60 || seconds >= 60) return null;
  const total = days * 24 * 3600 + hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

function deucalionPartitionLimit(partition: string, limits: DeucalionPartitionLimit[] = DEUCALION_PARTITION_LIMITS) {
  const normalized = partition.trim().toLowerCase();
  return limits.find((entry) => entry.partition === normalized) || null;
}

function validateDeucalionWalltime(
  timeLimit: string,
  partition: string,
  limits: DeucalionPartitionLimit[] = DEUCALION_PARTITION_LIMITS
): string | null {
  const text = timeLimit.trim();
  if (!text) return null;

  const requestedSeconds = parseSlurmWalltimeSeconds(text);
  if (requestedSeconds === null) {
    return "Use Slurm walltime format, for example 04:00:00 or 2-00:00:00.";
  }

  const limit = deucalionPartitionLimit(partition, limits);
  if (!limit) return "Choose a known Deucalion partition.";
  if (requestedSeconds > limit.maxSeconds) {
    return `Max walltime for ${limit.partition} is ${formatWalltimeLimit(limit.maxSeconds)}.`;
  }
  return null;
}

const defaultRunForm: RunForm = {
  configPath: "",
  jobName: "",
  targetHost: "",
  targetWorkerProfile: "",
  imageTag: "latest",
  deucalionOptions: {
    account: "",
    partition: "",
    timeLimit: "",
    cpusPerTask: "",
    memGb: "",
    gpus: "",
    commandMode: "run"
  }
};

function isGpuLikePartition(partition: string): boolean {
  const value = partition.trim().toLowerCase();
  if (!value) return false;
  return value.includes("gpu") || value.includes("a100") || value.includes("h100");
}

function inferComputeProfile(entry: HostActiveJobSnapshot): "GPU" | "CPU" | null {
  if (typeof entry.slurm_gpus === "number" && entry.slurm_gpus > 0) return "GPU";
  if (typeof entry.slurm_partition === "string" && entry.slurm_partition.trim()) {
    return isGpuLikePartition(entry.slurm_partition) ? "GPU" : "CPU";
  }
  return null;
}

function normalizeTargetWorkerProfile(value: unknown): "" | "cpu" | "gpu" {
  return value === "cpu" || value === "gpu" ? value : "";
}

function targetWorkerProfileLabel(value: "" | "cpu" | "gpu"): string {
  if (value === "gpu") return "Any GPU";
  if (value === "cpu") return "Any CPU";
  return "automatic";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeDeucalionPartitionLimits(value: unknown): DeucalionPartitionLimit[] {
  const payload = asRecord(value);
  const rows = Array.isArray(payload?.partitions) ? payload.partitions : [];
  const normalized = rows
    .map((row) => {
      const record = asRecord(row);
      const partition = readString(record, "partition");
      const maxSeconds = asNumber(record?.time_limit_seconds);
      if (!partition || typeof maxSeconds !== "number" || maxSeconds <= 0) return null;
      return {
        partition,
        profile: isGpuLikePartition(partition) ? "gpu" : "cpu",
        label: partition,
        maxSeconds
      } satisfies DeucalionPartitionLimit;
    })
    .filter((entry): entry is DeucalionPartitionLimit => Boolean(entry));
  return normalized.length > 0 ? normalized : DEUCALION_PARTITION_LIMITS;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveJobTargetHost(job: JobItem): string {
  const fromInfo = typeof job.job_info.target_host === "string" ? job.job_info.target_host.trim() : "";
  if (fromInfo) return fromInfo;
  const meta = asRecord(job.job_meta);
  const fromMeta = readString(meta, "target_host");
  return fromMeta || "-";
}

function inferDeucalionJobRuntime(job: JobItem, host: string): "CPU" | "GPU" | null {
  if (host.toLowerCase() !== "deucalion") return null;

  const meta = asRecord(job.job_meta);
  const infoRecord = asRecord(job.job_info as unknown);
  const options =
    asRecord(job.job_info.deucalion_options) ||
    asRecord(meta?.deucalion_options) ||
    asRecord(infoRecord?.deucalion_options);

  const gpusValue =
    asNumber(options?.gpus) ??
    asNumber(options?.gpu_count) ??
    asNumber(options?.gpus_per_task) ??
    asNumber(meta?.slurm_gpus) ??
    asNumber(infoRecord?.slurm_gpus);
  if (typeof gpusValue === "number" && gpusValue > 0) return "GPU";

  const partition =
    readString(options, "partition") ||
    readString(meta, "slurm_partition") ||
    readString(meta, "partition") ||
    readString(infoRecord, "slurm_partition") ||
    readString(infoRecord, "partition");

  if (partition && isGpuLikePartition(partition)) return "GPU";
  return "CPU";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toPercent(raw: number): number {
  const value = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, value));
}

function normalizeProgressPercent(raw: number, key?: string): number {
  const value = key === "progress_pct" || key === "progress_percent" ? raw : raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, value));
}

function toEpochMs(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return value > 9999999999 ? value : value * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isRecentTimestamp(value: string | number | null | undefined, windowMs = 5 * 60 * 1000): boolean {
  const epoch = toEpochMs(value);
  if (!epoch) return false;
  return Date.now() - epoch <= windowMs;
}

function maxEpoch(values: Array<string | number | null | undefined>): number | null {
  let maxValue: number | null = null;
  values.forEach((value) => {
    const epoch = toEpochMs(value);
    if (!epoch) return;
    if (maxValue === null || epoch > maxValue) {
      maxValue = epoch;
    }
  });
  return maxValue;
}

function formatBudgetUsage(usedPercent: number | null | undefined): string {
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return "-";
  return `${usedPercent.toFixed(1)}%`;
}

function extractEtaInfo(data: Record<string, unknown>): Omit<ProgressInfo, "percent" | "updatedAt"> {
  const eta = asRecord(data.eta);
  const etaSeconds = asNumber(data.eta_seconds) ?? asNumber(eta?.eta_seconds);
  const estimatedFinishAt =
    (data.estimated_finish_at || eta?.estimated_finish_at || null) as string | number | null;
  const etaAvailableRaw = eta?.available;
  return {
    etaSeconds,
    estimatedFinishAt,
    etaAvailable: etaAvailableRaw === true || etaSeconds !== null,
    etaReason: typeof eta?.reason === "string" ? eta.reason : null
  };
}

function extractProgressInfo(payload: unknown): ProgressInfo {
  if (!payload || typeof payload !== "object") {
    return {
      percent: null,
      updatedAt: null,
      etaSeconds: null,
      estimatedFinishAt: null,
      etaAvailable: false,
      etaReason: null
    };
  }

  const data = payload as Record<string, unknown>;
  const etaInfo = extractEtaInfo(data);
  const candidateKeys = ["progress_pct", "percent", "progress", "progress_percent", "completion"];
  for (const key of candidateKeys) {
    const value = asNumber(data[key]);
    if (value !== null) {
      return {
        percent: normalizeProgressPercent(value, key),
        updatedAt: (data.updated_at || data.timestamp || data.last_update || null) as
          | string
          | number
          | null,
        ...etaInfo
      };
    }
  }

  if (typeof data.progress === "object" && data.progress) {
    const nested = data.progress as Record<string, unknown>;
    const nestedPercent = asNumber(nested.percent) ?? asNumber(nested.value) ?? asNumber(nested.progress);
    if (nestedPercent !== null) {
      return {
        percent: toPercent(nestedPercent),
        updatedAt: (nested.updated_at || nested.timestamp || null) as string | number | null,
        ...etaInfo
      };
    }
  }

  return {
    percent: null,
    updatedAt: (data.updated_at || data.timestamp || data.last_update || null) as string | number | null,
    ...etaInfo
  };
}

function resolveProgressEtaSeconds(job: JobItem, progressInfo: ProgressInfo | undefined): number | null {
  if (!progressInfo || !hasAnyStatus(job.status, ["running"])) return null;
  if (!progressInfo.etaAvailable || progressInfo.etaSeconds === null) return null;
  return progressInfo.etaSeconds;
}

function resolveProgressEstimatedFinishAt(job: JobItem, progressInfo: ProgressInfo | undefined): string | number | null {
  if (!progressInfo || !hasAnyStatus(job.status, ["running"])) return null;
  if (!progressInfo.etaAvailable || progressInfo.etaSeconds === null) return null;
  return progressInfo.estimatedFinishAt;
}

function queuedStartReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case "slot_available":
      return "Slot available";
    case "waiting_for_active_job":
      return "Waiting for active job";
    case "queued_behind_job":
      return "Waiting behind another queued job";
    case "active_eta_unavailable":
      return "Waiting for active job ETA";
    case "target_ambiguous":
      return "Start estimate unavailable: target host ambiguous";
    case "host_unavailable":
      return "Start estimate unavailable: host offline";
    case "no_capacity":
      return "Start estimate unavailable: no capacity";
    default:
      return "Start estimate unavailable";
  }
}

function queuedStartTooltipFromEstimate(estimate: QueuedStartEstimate | null | undefined): string | null {
  if (!estimate) return null;
  if (estimate.available && estimate.estimated_start_at !== null && estimate.estimated_start_at !== undefined) {
    return [
      estimate.estimated_start_seconds !== null && estimate.estimated_start_seconds !== undefined
        ? `Starts in ${formatDurationSeconds(estimate.estimated_start_seconds)}`
        : null,
      `Estimated start ${formatDateTime(estimate.estimated_start_at)}`
    ]
      .filter(Boolean)
      .join("\n");
  }
  return queuedStartReasonLabel(estimate.reason);
}

function queuedStartVisibleLabel(estimate: QueuedStartEstimate | null | undefined): string | null {
  if (!estimate) return null;
  if (estimate.available) {
    if (estimate.estimated_start_seconds !== null && estimate.estimated_start_seconds !== undefined) {
      return estimate.estimated_start_seconds <= 60
        ? "Start now"
        : `Start in ${formatDurationSeconds(estimate.estimated_start_seconds)}`;
    }
    return "Start soon";
  }
  switch (estimate.reason) {
    case "queued_behind_job":
      return "Waiting in queue";
    case "active_eta_unavailable":
      return "Waiting for ETA";
    case "waiting_for_active_job":
      return "Waiting active job";
    case "target_ambiguous":
      return "No start estimate";
    case "host_unavailable":
      return "Host offline";
    case "no_capacity":
      return "No capacity";
    default:
      return "Start unavailable";
  }
}

function resolveQueuedStartTooltip(job: JobItem): string | null {
  if (!hasAnyStatus(job.status, ["queue", "launch"])) return null;
  return queuedStartTooltipFromEstimate(job.queued_start_estimate);
}

function resolveQueueEntryStartTooltip(entry: QueueItem): string | null {
  return queuedStartTooltipFromEstimate(entry.queued_start_estimate);
}

function resolveJobDisplayName(job: JobItem): string {
  return job.job_info.job_name || job.job_info.run_name || "Unnamed job";
}

function resolveConfigName(configPath: string | undefined): string {
  if (!configPath) return "No experiment config";
  const normalized = configPath.split(/[\\/]/).filter(Boolean);
  return normalized[normalized.length - 1] || configPath;
}

function parseConfigDefaultJobName(yamlContent: string, fallback: string): string {
  const experimentMatch = yamlContent.match(/(?:^|\n)\s*experiment_name:\s*["']?([^"\n']+)["']?/m);
  const runMatch = yamlContent.match(/(?:^|\n)\s*run_name:\s*["']?([^"\n']+)["']?/m);
  const experiment = experimentMatch?.[1]?.trim();
  const runName = runMatch?.[1]?.trim();
  if (experiment && runName) return `${experiment}-${runName}`;
  if (runName) return runName;
  if (experiment) return experiment;
  return fallback;
}

function resolveDefaultJobNameFromConfigPath(configPath: string): string {
  const baseName = resolveConfigName(configPath);
  return baseName.replace(/\.ya?ml$/i, "");
}

function toOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return undefined;
  return parsed;
}

function resolveSubmittedByLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function computeUserInitials(label: string): string {
  const normalized = label.includes("@") ? label.split("@")[0] : label;
  const chunks = normalized
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2);
  if (chunks.length === 0) return "U";
  return chunks
    .map((chunk) => chunk[0]!.toUpperCase())
    .join("")
    .slice(0, 2);
}

function hasAnyStatus(status: string, tokens: string[]): boolean {
  const key = status.toLowerCase();
  return tokens.some((token) => key.includes(token));
}

function canCancelStatus(status: string): boolean {
  return (
    hasAnyStatus(status, ["running", "queue", "pending", "setup", "launch", "dispatch", "start", "progress"]) &&
    !hasAnyStatus(status, ["cancel", "fail", "error", "finish", "complete", "done", "stopp"])
  );
}

function canRequeueStatus(status: string): boolean {
  return !hasAnyStatus(status, ["running", "queue", "pending", "setup", "launch", "dispatch"]);
}

function canFailStatus(status: string): boolean {
  return !hasAnyStatus(status, ["fail", "error", "cancel", "finish", "complete", "done", "stopp"]);
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readDispatchSnapshot(job: JobItem): SlurmDispatchSnapshot {
  const detailsFromMeta = asObjectRecord(job.job_meta?.details);
  const detailsFromInfo = asObjectRecord(job.job_info?.details);
  const details = detailsFromMeta || detailsFromInfo;

  const slurmJobId = typeof details?.slurm_job_id === "string" ? details.slurm_job_id : null;
  const slurmState = typeof details?.slurm_state === "string" ? details.slurm_state : null;
  const slurmPartition = typeof details?.slurm_partition === "string" ? details.slurm_partition : null;
  const slurmReason = typeof details?.slurm_reason === "string" ? details.slurm_reason : null;
  const slurmSubmitTime = typeof details?.slurm_submit_time === "string" ? details.slurm_submit_time : null;
  const slurmStartTime = typeof details?.slurm_start_time === "string" ? details.slurm_start_time : null;
  const slurmElapsed = typeof details?.slurm_elapsed === "string" ? details.slurm_elapsed : null;
  const slurmTimeLeft = typeof details?.slurm_time_left === "string" ? details.slurm_time_left : null;
  const slurmPriority = asNumber(details?.slurm_priority);
  const slurmQueuePosition = asNumber(details?.slurm_queue_position);
  const slurmJobsAhead = asNumber(details?.slurm_jobs_ahead);
  const slurmPendingJobsInPartition = asNumber(details?.slurm_pending_jobs_in_partition);
  const connectivity = typeof details?.connectivity === "string" ? details.connectivity : null;
  const unknownSince =
    typeof details?.unknown_since === "string" || typeof details?.unknown_since === "number"
      ? details.unknown_since
      : null;
  const datasetsSynced = Array.isArray(details?.datasets_synced)
    ? details.datasets_synced.filter((item): item is string => typeof item === "string")
    : [];
  const datasetsSkipped = Array.isArray(details?.datasets_skipped)
    ? details.datasets_skipped.filter((item): item is string => typeof item === "string")
    : [];

  return {
    details,
    slurmJobId,
    slurmState,
    slurmPartition,
    slurmReason,
    slurmSubmitTime,
    slurmStartTime,
    slurmElapsed,
    slurmTimeLeft,
    slurmPriority,
    slurmQueuePosition,
    slurmJobsAhead,
    slurmPendingJobsInPartition,
    connectivity,
    unknownSince,
    datasetsSynced,
    datasetsSkipped
  };
}

export function JobsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuth();
  const canAuthenticateUnion = session?.email.trim().toLowerCase() === "tiago.fonseca@energaize.io";
  const currentSubmittedFilter =
    resolveSubmittedByLabel(session?.name) || resolveSubmittedByLabel(session?.email);
  const initialState = buildJobsListStateFromSearchParams(searchParams, {
    defaultSubmitted: currentSubmittedFilter
  });
  const { notifyError, notifyInfo, notifySuccess } = useApiFeedback();

  const [runOpen, setRunOpen] = useState(false);
  const [runStep, setRunStep] = useState(1);
  const [configPickerOpen, setConfigPickerOpen] = useState(false);
  const [deucalionProfile, setDeucalionProfile] = useState<DeucalionRuntimeProfile>("cpu");
  const [showDeucalionAdvanced, setShowDeucalionAdvanced] = useState(false);
  const [jobNameAutoValue, setJobNameAutoValue] = useState("");
  const [jobNameTouched, setJobNameTouched] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [compareMode, setCompareMode] = useState(false);
  const [refreshingVisual, setRefreshingVisual] = useState(false);
  const [statusFilter, setStatusFilter] = useState(initialState.status);
  const [hostFilter, setHostFilter] = useState(initialState.host);
  const [submittedFilter, setSubmittedFilter] = useState(initialState.submitted);
  const [queueHostFilter, setQueueHostFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState(initialState.q);
  const [runForm, setRunForm] = useState<RunForm>(defaultRunForm);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsJobId, setLogsJobId] = useState("");
  const [logsSearch, setLogsSearch] = useState("");
  const [logsDownloading, setLogsDownloading] = useState(false);
  const [configPreviewOpen, setConfigPreviewOpen] = useState(false);
  const [configPreviewTarget, setConfigPreviewTarget] = useState("");
  const [configPreviewLabel, setConfigPreviewLabel] = useState("");
  const [configPreviewMode, setConfigPreviewMode] = useState<"base" | "resolved">("base");
  const [configPreviewJobId, setConfigPreviewJobId] = useState("");
  const [dispatchDetailsTarget, setDispatchDetailsTarget] = useState<JobItem | null>(null);
  const [hostDetailsTarget, setHostDetailsTarget] = useState<{ name: string; data: HostInfo } | null>(null);
  const [hostDetailsOpen, setHostDetailsOpen] = useState(false);
  const [adminConfirm, setAdminConfirm] = useState<AdminConfirmState | null>(null);
  const [deleteJobTarget, setDeleteJobTarget] = useState<string | null>(null);
  const logsPreRef = useRef<HTMLPreElement | null>(null);
  const configJobNameRequestRef = useRef(0);
  const unionAuthWindowRef = useRef<Window | null>(null);

  function resetRunWizardState(): void {
    setRunForm(defaultRunForm);
    setRunStep(1);
    setConfigPickerOpen(false);
    setJobNameAutoValue("");
    setJobNameTouched(false);
    setDeucalionProfile("cpu");
    setShowDeucalionAdvanced(false);
  }

  function openRunWizard(): void {
    resetRunWizardState();
    setRunOpen(true);
  }

  const jobsQuery = useQuery({
    queryKey: ["jobs"],
    queryFn: listJobs,
    initialData: listJobsInitialData,
    refetchInterval: JOB_POLL_MS,
    networkMode: "always"
  });

  const hostsQuery = useQuery({
    queryKey: ["hosts"],
    queryFn: listHosts,
    refetchInterval: HOSTS_POLL_MS,
    networkMode: "always"
  });

  const queueQuery = useQuery({
    queryKey: ["queue"],
    queryFn: listQueue,
    refetchInterval: JOB_POLL_MS,
    networkMode: "always"
  });

  const configsQuery = useQuery({
    queryKey: ["configs"],
    queryFn: listExperimentConfigs,
    networkMode: "always"
  });

  const jobImagesQuery = useQuery({
    queryKey: ["job-images", "catalog", "default"],
    queryFn: () => listJobImageVersions({ limit: 50 }),
    staleTime: 120_000,
    networkMode: "always"
  });

  const logsQuery = useJobLogsPolling(logsJobId, {
    enabled: Boolean(logsOpen && logsJobId),
    pollMs: LOGS_POLL_MS,
    tailLines: 300
  });

  const allLogLines = useMemo(() => {
    const text = logsQuery.text || "";
    if (!text.trim()) return [];
    return text.split(/\r?\n/);
  }, [logsQuery.text]);

  const filteredLogLines = useMemo(() => {
    const query = logsSearch.trim().toLowerCase();
    if (!query) return allLogLines;
    return allLogLines.filter((line) => line.toLowerCase().includes(query));
  }, [allLogLines, logsSearch]);
  const hasRawLogs = logsQuery.text.trim().length > 0;

  useEffect(() => {
    if (!logsOpen || logsSearch.trim()) return;
    const pre = logsPreRef.current;
    if (!pre) return;
    pre.scrollTop = pre.scrollHeight;
  }, [allLogLines, logsOpen, logsSearch]);

  const configPreviewQuery = useQuery({
    queryKey: ["job-config-preview", configPreviewMode, configPreviewTarget, configPreviewJobId],
    queryFn: async () => {
      if (configPreviewMode === "resolved") {
        const payload = await getJobResolvedConfig(configPreviewJobId);
        return payload.yaml_content;
      }
      const payload = await getExperimentConfig(configPreviewTarget);
      return payload.yaml_content;
    },
    enabled: Boolean(
      configPreviewOpen &&
        ((configPreviewMode === "base" && configPreviewTarget) ||
          (configPreviewMode === "resolved" && configPreviewJobId))
    )
  });

  useEffect(() => {
    const nextParams = toJobsListSearchParams(
      {
        q: searchQuery,
        status: statusFilter,
        host: hostFilter,
        submitted: submittedFilter
      },
      { defaultSubmitted: currentSubmittedFilter }
    );
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [currentSubmittedFilter, hostFilter, searchParams, searchQuery, setSearchParams, statusFilter, submittedFilter]);

  useJobStatusNotifications(jobsQuery.data);

  const progressQueries = useQueries({
    queries: (jobsQuery.data || []).map((job) => ({
      queryKey: ["job-progress-inline", job.job_id],
      queryFn: () => getJobProgress(job.job_id),
      refetchInterval: JOB_POLL_MS
    }))
  });

  const progressMap = useMemo(() => {
    const map = new Map<string, ProgressInfo>();
    (jobsQuery.data || []).forEach((job, index) => {
      const progressPayload = progressQueries[index]?.data;
      map.set(job.job_id, extractProgressInfo(progressPayload));
    });
    return map;
  }, [jobsQuery.data, progressQueries]);

  const runMutation = useMutation({
    mutationFn: (payload: RunSimulationPayload) => runSimulation(payload),
    onSuccess: (result) => {
      notifySuccess("Simulation submitted", `Job ${result.job_id} queued.`);
      setRunOpen(false);
      resetRunWizardState();
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (error) => notifyError("Failed to run simulation", error)
  });

  const deleteMutation = useMutation({
    mutationFn: (jobId: string) => deleteJob(jobId),
    onSuccess: () => {
      notifyInfo("Job deleted", "Job artifacts removed.");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (error) => notifyError("Failed to delete job", error)
  });

  const opsMutation = useMutation({
    mutationFn: async (payload: { type: "requeue" | "cancel" | "stop" | "fail"; jobId: string }) => {
      if (payload.type === "requeue") {
        return opsRequeueJob({ job_id: payload.jobId, force: false });
      }
      if (payload.type === "cancel") {
        return opsCancelJob({ job_id: payload.jobId, reason: "ops_cancel", force: false });
      }
      if (payload.type === "stop") {
        return opsStopJob({ job_id: payload.jobId, reason: "ops_manual_stop" });
      }
      return opsFailJob({ job_id: payload.jobId, reason: "ops_fail", force: false });
    },
    onSuccess: (_, payload) => {
      notifyInfo("Operation applied", `Job ${payload.jobId} updated.`);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (error) => notifyError("Operational command failed", error)
  });

  const cleanupQueueMutation = useMutation({
    mutationFn: () => opsCleanupQueue(false),
    onSuccess: (result) => notifyInfo("Queue cleanup", `${result.count} entries removed.`),
    onError: (error) => notifyError("Failed to cleanup queue", error)
  });

  const cleanupJobsMutation = useMutation({
    mutationFn: () => opsCleanupJobs(),
    onSuccess: (result) => notifyInfo("Jobs cleanup", `${result.count} entries removed.`),
    onError: (error) => notifyError("Failed to cleanup jobs", error)
  });

  const unionAuthMutation = useMutation({
    mutationFn: () => authenticateWorker("union-inesctec"),
    onSuccess: () => {
      notifyInfo("Union authentication started", "Waiting for the secure Union sign-in link.");
      queryClient.invalidateQueries({ queryKey: ["hosts"] });
    },
    onError: (error) => {
      unionAuthWindowRef.current?.close();
      unionAuthWindowRef.current = null;
      notifyError("Unable to start Union authentication", error);
    }
  });

  useEffect(() => {
    if (!hostDetailsTarget) return;
    const freshHost = hostsQuery.data?.hosts?.[hostDetailsTarget.name];
    if (freshHost && freshHost !== hostDetailsTarget.data) {
      setHostDetailsTarget({ name: hostDetailsTarget.name, data: freshHost });
    }
  }, [hostDetailsTarget, hostsQuery.data?.hosts]);

  useEffect(() => {
    const auth = hostsQuery.data?.hosts?.["union-inesctec"]?.info?.union_auth;
    if (!auth || typeof auth !== "object") return;
    const url = (auth as { verification_url_complete?: unknown }).verification_url_complete;
    if (typeof url !== "string" || !url || !unionAuthWindowRef.current) return;
    unionAuthWindowRef.current.location.href = url;
    unionAuthWindowRef.current = null;
  }, [hostsQuery.data?.hosts]);

  function beginUnionAuthentication(auth: Record<string, unknown>): void {
    const completeUrl = typeof auth.verification_url_complete === "string" ? auth.verification_url_complete : "";
    const expiresAt = typeof auth.expires_at === "number" ? auth.expires_at : 0;
    if (completeUrl && expiresAt > Date.now() / 1000) {
      window.open(completeUrl, "_blank", "noopener,noreferrer");
      return;
    }
    unionAuthWindowRef.current = window.open("about:blank", "union-authentication");
    if (unionAuthWindowRef.current) {
      unionAuthWindowRef.current.document.title = "Waiting for Union authentication";
      unionAuthWindowRef.current.document.body.textContent = "Preparing secure Union authentication…";
    }
    unionAuthMutation.mutate();
  }

  const statusOptions = useMemo(() => {
    const values = new Set<string>();
    (jobsQuery.data || []).forEach((job) => values.add(job.status));
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [jobsQuery.data]);

  const filteredJobs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return (jobsQuery.data || []).filter((job) => {
      if (statusFilter !== "all" && job.status !== statusFilter) return false;
      if (hostFilter !== "all" && (job.job_info.target_host || "") !== hostFilter) return false;
      const submittedBy =
        resolveSubmittedByLabel(job.job_info.submitted_by) ||
        resolveSubmittedByLabel(job.job_meta?.submitted_by);
      if (submittedFilter !== "all" && submittedBy !== submittedFilter) return false;
      if (!query) return true;

      const haystack = [
        job.job_id,
        job.job_info.experiment_name || "",
        job.job_info.job_name || "",
        job.job_info.run_name || "",
        job.job_info.target_host || "",
        job.job_info.config_path || "",
        job.job_info.submitted_by || "",
        job.status
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [hostFilter, jobsQuery.data, searchQuery, statusFilter, submittedFilter]);

  const submittedByOptions = useMemo(() => {
    const values = new Set<string>();
    (jobsQuery.data || []).forEach((job) => {
      const submittedBy =
        resolveSubmittedByLabel(job.job_info.submitted_by) ||
        resolveSubmittedByLabel(job.job_meta?.submitted_by);
      if (submittedBy) values.add(submittedBy);
    });
    if (currentSubmittedFilter) values.add(currentSubmittedFilter);
    if (submittedFilter !== "all") values.add(submittedFilter);
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [currentSubmittedFilter, jobsQuery.data, submittedFilter]);

  const availableHosts = hostsQuery.data?.available_hosts || [];
  const availableConfigs = configsQuery.data || [];
  const imageRepository = jobImagesQuery.data?.repository || "calof/opeva_simulator";
  const runImageOptions = useMemo(() => {
    const tags = jobImagesQuery.data?.tags || [];
    const byTag = new Map<string, { deucalionReady: boolean; lastUpdated?: string }>();

    tags.forEach((tag) => {
      if (!tag?.name) return;
      const ready = typeof tag.deucalion_ready === "boolean" ? tag.deucalion_ready : true;
      const previous = byTag.get(tag.name);
      byTag.set(tag.name, {
        deucalionReady: ready,
        lastUpdated:
          typeof tag.last_updated === "string" && tag.last_updated.trim()
            ? tag.last_updated
            : previous?.lastUpdated
      });
    });

    if (!byTag.has("latest")) {
      byTag.set("latest", { deucalionReady: true });
    }

    const orderedTags = ["latest", ...Array.from(byTag.keys()).filter((tag) => tag !== "latest")];
    return orderedTags.map((tag) => ({
      tag,
      deucalionReady: byTag.get(tag)?.deucalionReady ?? true,
      lastUpdated: byTag.get(tag)?.lastUpdated
    }));
  }, [jobImagesQuery.data?.tags]);
  const filteredConfigOptions = useMemo(() => {
    const query = runForm.configPath.trim().toLowerCase();
    if (!query) return availableConfigs;
    return availableConfigs.filter((config) => config.toLowerCase().includes(query));
  }, [availableConfigs, runForm.configPath]);
  const hasCustomRunImage =
    runForm.imageTag.trim() !== "" && !runImageOptions.some((option) => option.tag === runForm.imageTag.trim());
  const isRunHostDeucalion = runForm.targetHost === "deucalion";
  const selectedImageOption = runImageOptions.find((option) => option.tag === runForm.imageTag.trim()) || null;
  const hasReadyDeucalionImage = runImageOptions.some((option) => option.deucalionReady);
  const deucalionDefaults = DEUCALION_PROFILE_DEFAULTS[deucalionProfile];
  const deucalionBudgetAccounts = useMemo(() => {
    const host = hostsQuery.data?.hosts?.deucalion;
    const entries = host?.info?.budget?.accounts;
    if (!Array.isArray(entries)) return [];
    return entries
      .map((entry) => (typeof entry?.account === "string" ? entry.account.trim() : ""))
      .filter((account): account is string => Boolean(account));
  }, [hostsQuery.data?.hosts]);
  const deucalionCpuAccountFromHost =
    deucalionBudgetAccounts.find((account) => inferBudgetAccountKind(account) === "CPU") || "";
  const deucalionGpuAccountFromHost =
    deucalionBudgetAccounts.find((account) => inferBudgetAccountKind(account) === "GPU") || "";
  const deucalionAutoAccount =
    deucalionProfile === "gpu" ? deucalionGpuAccountFromHost : deucalionCpuAccountFromHost;
  const deucalionAutoAccountDisplay =
    deucalionAutoAccount || (deucalionProfile === "gpu" ? "GPU account (auto)" : "CPU account (auto)");
  const deucalionAutoPartition = deucalionProfile === "gpu" ? "normal-a100-80" : "normal-x86";
  const effectiveDeucalionAccount = runForm.deucalionOptions.account.trim() || deucalionAutoAccount;
  const effectiveDeucalionPartition = runForm.deucalionOptions.partition.trim() || deucalionAutoPartition;
  const deucalionPartitionLimits = useMemo(
    () => normalizeDeucalionPartitionLimits(hostsQuery.data?.hosts?.deucalion?.info?.partition_limits),
    [hostsQuery.data?.hosts?.deucalion?.info?.partition_limits]
  );
  const effectiveDeucalionPartitionLimit = deucalionPartitionLimit(
    effectiveDeucalionPartition,
    deucalionPartitionLimits
  );
  const deucalionWalltimeError = isRunHostDeucalion
    ? validateDeucalionWalltime(runForm.deucalionOptions.timeLimit, effectiveDeucalionPartition, deucalionPartitionLimits)
    : null;
  const showDeucalionGpuField =
    deucalionProfile === "gpu" || isGpuLikePartition(runForm.deucalionOptions.partition);

  const selectedJob = useMemo(() => {
    return (jobsQuery.data || []).find((job) => job.job_id === selectedJobId) || null;
  }, [jobsQuery.data, selectedJobId]);

  const canRequeueSelected = selectedJob ? canRequeueStatus(selectedJob.status) : false;
  const canStopSelected = selectedJob ? canCancelStatus(selectedJob.status) : false;
  const canFailSelected = selectedJob ? canFailStatus(selectedJob.status) : false;
  const canCleanupQueue = (queueQuery.data?.length || 0) > 0;
  const canCleanupJobs = (jobsQuery.data?.length || 0) > 0;

  const hostRows = useMemo(() => {
    return Object.entries(hostsQuery.data?.hosts || {}).map(([name, data]) => ({ name, ...data }));
  }, [hostsQuery.data?.hosts]);
  const hostOptions = useMemo(() => {
    const map = new Map<string, { name: string; online: boolean | null; lastSeen: number | null; data?: HostInfo }>();
    availableHosts.forEach((name) => {
      map.set(name, { name, online: true, lastSeen: null });
    });
    hostRows.forEach((host) => {
      map.set(host.name, {
        name: host.name,
        online: typeof host.online === "boolean" ? host.online : null,
        lastSeen: typeof host.last_seen === "number" ? host.last_seen : null,
        data: host
      });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [availableHosts, hostRows]);

  const jobsById = useMemo(() => {
    return new Map((jobsQuery.data || []).map((job) => [job.job_id, job] as const));
  }, [jobsQuery.data]);

  const queueHostOptions = useMemo(() => {
    const values = new Set<string>();
    (queueQuery.data || []).forEach((entry) => {
      if (entry.require_host === false) return;
      const jobRef = jobsById.get(entry.job_id);
      const host = entry.preferred_host || jobRef?.job_info.target_host;
      if (host) values.add(host);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [jobsById, queueQuery.data]);

  const filteredQueueEntries = useMemo(() => {
    return (queueQuery.data || []).filter((entry) => {
      if (queueHostFilter === "all") return true;
      if (entry.require_host === false) return false;
      const jobRef = jobsById.get(entry.job_id);
      const host = entry.preferred_host || jobRef?.job_info.target_host || "";
      return host === queueHostFilter;
    });
  }, [jobsById, queueHostFilter, queueQuery.data]);

  useEffect(() => {
    if (!runOpen) return;

    const inputValue = runForm.configPath.trim();
    if (!inputValue) {
      if (!jobNameTouched) {
        setRunForm((previous) => ({ ...previous, jobName: "" }));
        setJobNameAutoValue("");
      }
      return;
    }

    const canAutoApply = !jobNameTouched || runForm.jobName.trim() === jobNameAutoValue;
    if (!canAutoApply) return;

    const fallbackName = resolveDefaultJobNameFromConfigPath(inputValue);
    const matchedConfig =
      availableConfigs.find((config) => config === inputValue || resolveConfigName(config) === resolveConfigName(inputValue)) ||
      null;

    if (!matchedConfig) {
      setRunForm((previous) => (previous.jobName === fallbackName ? previous : { ...previous, jobName: fallbackName }));
      if (jobNameAutoValue !== fallbackName) {
        setJobNameAutoValue(fallbackName);
      }
      return;
    }

    const requestId = ++configJobNameRequestRef.current;
    getExperimentConfig(matchedConfig)
      .then((payload) => {
        if (requestId !== configJobNameRequestRef.current) return;
        const autoName = parseConfigDefaultJobName(payload.yaml_content || "", fallbackName);
        setRunForm((previous) => {
          if (previous.configPath === matchedConfig && previous.jobName === autoName) {
            return previous;
          }
          return { ...previous, configPath: matchedConfig, jobName: autoName };
        });
        if (jobNameAutoValue !== autoName) {
          setJobNameAutoValue(autoName);
        }
      })
      .catch(() => {
        if (requestId !== configJobNameRequestRef.current) return;
        setRunForm((previous) => (previous.jobName === fallbackName ? previous : { ...previous, jobName: fallbackName }));
        if (jobNameAutoValue !== fallbackName) {
          setJobNameAutoValue(fallbackName);
        }
      });
  }, [
    availableConfigs,
    jobNameAutoValue,
    jobNameTouched,
    runForm.configPath,
    runForm.jobName,
    runOpen
  ]);

  useEffect(() => {
    const eligible = new Set((jobsQuery.data || []).filter((job) => isCompletedForResults(job.status)).map((job) => job.job_id));

    setCompareSelection((previous) => previous.filter((jobId) => eligible.has(jobId)));

    if (selectedJobId && !(jobsQuery.data || []).some((job) => job.job_id === selectedJobId)) {
      setSelectedJobId("");
    }
  }, [jobsQuery.data, selectedJobId]);

  useEffect(() => {
    if (!compareMode && compareSelection.length > 0) {
      setCompareSelection([]);
    }
  }, [compareMode, compareSelection.length]);

  useEffect(() => {
    if (!runOpen) return;
    setRunStep(1);
    setRunForm((previous) => ({
      ...previous,
      configPath: previous.configPath.trim()
    }));
  }, [runOpen]);

  useEffect(() => {
    if (!runOpen) return;
    if (runForm.imageTag.trim()) return;
    setRunForm((previous) => ({ ...previous, imageTag: "latest" }));
  }, [runForm.imageTag, runOpen]);

  useEffect(() => {
    if (!runOpen) return;
    if (!isRunHostDeucalion) return;

    setRunForm((previous) => {
      const defaults = DEUCALION_PROFILE_DEFAULTS[deucalionProfile];
      const nextOptions = { ...previous.deucalionOptions };
      let changed = false;

      if (!nextOptions.timeLimit.trim()) {
        nextOptions.timeLimit = defaults.timeLimit;
        changed = true;
      }
      if (!nextOptions.cpusPerTask.trim()) {
        nextOptions.cpusPerTask = defaults.cpusPerTask;
        changed = true;
      }
      if (!nextOptions.memGb.trim()) {
        nextOptions.memGb = defaults.memGb;
        changed = true;
      }
      if (deucalionProfile === "gpu") {
        if (!nextOptions.gpus.trim()) {
          nextOptions.gpus = defaults.gpus;
          changed = true;
        }
      } else if (nextOptions.gpus.trim()) {
        nextOptions.gpus = "";
        changed = true;
      }

      if (!changed) return previous;
      return {
        ...previous,
        deucalionOptions: nextOptions
      };
    });
  }, [deucalionProfile, isRunHostDeucalion, runOpen]);

  useEffect(() => {
    if (isRunHostDeucalion) return;
    setShowDeucalionAdvanced(false);
  }, [isRunHostDeucalion]);

  useEffect(() => {
    if (!runOpen) return;
    if (!isRunHostDeucalion) return;
    if (!hasReadyDeucalionImage) return;

    const currentImageTag = runForm.imageTag.trim();
    const currentOption = runImageOptions.find((option) => option.tag === currentImageTag);
    if (currentOption?.deucalionReady) return;

    const fallback = runImageOptions.find((option) => option.deucalionReady);
    if (!fallback) return;
    if (currentImageTag === fallback.tag) return;

    setRunForm((previous) => ({ ...previous, imageTag: fallback.tag }));
  }, [hasReadyDeucalionImage, isRunHostDeucalion, runForm.imageTag, runImageOptions, runOpen]);

  useEffect(() => {
    if (runOpen) return;
    configJobNameRequestRef.current += 1;
  }, [runOpen]);

  const latestHostEpoch = useMemo(() => {
    return maxEpoch(hostRows.map((host) => host.last_seen));
  }, [hostRows]);

  const hostsLastUpdated = latestHostEpoch ? formatDateTime(latestHostEpoch) : "-";
  const hostsLiveWindow = latestHostEpoch ? isRecentTimestamp(latestHostEpoch, 5 * 60 * 1000) : false;

  function toggleCompareSelection(jobId: string): void {
    setCompareSelection((previous) => {
      if (previous.includes(jobId)) {
        return previous.filter((id) => id !== jobId);
      }

      return [...previous, jobId];
    });
  }

  function openJobDetails(jobId: string, tab?: DetailTabForJobs): void {
    const params = new URLSearchParams();
    if (tab) {
      params.set("tab", tab);
    }
    if (location.search) {
      params.set("from", location.search);
    }

    navigate(`/app/ai/jobs/${encodeURIComponent(jobId)}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  function openBaseConfigPreview(configPath: string): void {
    const normalized = configPath.split(/[\\/]/).filter(Boolean);
    const baseName = normalized[normalized.length - 1] || configPath;
    const resolvedName = availableConfigs.find((item) => item === configPath || item === baseName) || baseName;
    setConfigPreviewLabel(resolveConfigName(configPath));
    setConfigPreviewTarget(resolvedName);
    setConfigPreviewMode("base");
    setConfigPreviewJobId("");
    setConfigPreviewOpen(true);
  }

  function openResolvedConfigPreview(job: JobItem): void {
    setConfigPreviewLabel(`Resolved config · ${resolveJobDisplayName(job)}`);
    setConfigPreviewTarget("");
    setConfigPreviewMode("resolved");
    setConfigPreviewJobId(job.job_id);
    setConfigPreviewOpen(true);
  }

  function openHostDetails(name: string, data: HostInfo): void {
    setHostDetailsTarget({ name, data });
    setHostDetailsOpen(true);
  }

  function resolveHostJobName(jobId: string | null | undefined, hintedName?: string | null): string {
    if (typeof hintedName === "string" && hintedName.trim()) return hintedName.trim();
    if (!jobId) return "Unnamed job";
    const candidate = jobsById.get(jobId);
    return candidate ? resolveJobDisplayName(candidate) : "Unnamed job";
  }

  function openJobOrLogsFromHost(jobId: string | null | undefined): void {
    if (!jobId) return;
    const candidate = jobsById.get(jobId);
    if (candidate && isCompletedForResults(candidate.status)) {
      setHostDetailsOpen(false);
      openJobDetails(jobId);
      return;
    }
    setHostDetailsOpen(false);
    setLogsJobId(jobId);
    setLogsSearch("");
    setLogsOpen(true);
  }

  function openComparePage(): void {
    if (compareSelection.length < 2) return;

    const params = new URLSearchParams({ jobs: compareSelection.join(",") });
    if (compareSelection.length === 2) {
      params.set("left", compareSelection[0]!);
      params.set("right", compareSelection[1]!);
    }
    if (location.search) {
      params.set("from", location.search);
    }

    navigate(`/app/ai/jobs/compare?${params.toString()}`);
  }

  async function refreshWithPreview(): Promise<void> {
    if (refreshingVisual) return;
    setRefreshingVisual(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["jobs"], refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: ["queue"], refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: ["hosts"], refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: ["configs"], refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: ["job-images"], refetchType: "active" })
      ]);
      await Promise.all([
        jobsQuery.refetch(),
        queueQuery.refetch(),
        hostsQuery.refetch(),
        configsQuery.refetch(),
        jobImagesQuery.refetch(),
        new Promise((resolve) => window.setTimeout(resolve, 1200))
      ]);
    } finally {
      setRefreshingVisual(false);
    }
  }

  function resolveAdminConfirmCopy(state: AdminConfirmState): {
    title: string;
    description: string;
    confirmLabel: string;
  } {
    if (state.action === "requeue") {
      return {
        title: "Confirm Requeue",
        description: `Requeue job ${state.jobId}?`,
        confirmLabel: "Requeue"
      };
    }
    if (state.action === "cancel") {
      return {
        title: "Confirm Cancel",
        description: `Cancel job ${state.jobId}?`,
        confirmLabel: "Cancel Job"
      };
    }
    if (state.action === "stop") {
      return {
        title: "Confirm Stop",
        description: `Stop job ${state.jobId}?`,
        confirmLabel: "Stop Job"
      };
    }
    if (state.action === "fail") {
      return {
        title: "Confirm Fail",
        description: `Mark job ${state.jobId} as failed?`,
        confirmLabel: "Mark Failed"
      };
    }
    if (state.action === "cleanup_queue") {
      return {
        title: "Confirm Queue Cleanup",
        description: "Cleanup queue entries?",
        confirmLabel: "Cleanup Queue"
      };
    }
    return {
      title: "Confirm Jobs Cleanup",
      description: "Cleanup jobs registry?",
      confirmLabel: "Cleanup Jobs"
    };
  }

  function executeAdminAction(state: AdminConfirmState): void {
    if (state.action === "requeue" && state.jobId) {
      opsMutation.mutate({ type: "requeue", jobId: state.jobId });
      return;
    }
    if (state.action === "cancel" && state.jobId) {
      opsMutation.mutate({ type: "cancel", jobId: state.jobId });
      return;
    }
    if (state.action === "stop" && state.jobId) {
      opsMutation.mutate({ type: "stop", jobId: state.jobId });
      return;
    }
    if (state.action === "fail" && state.jobId) {
      opsMutation.mutate({ type: "fail", jobId: state.jobId });
      return;
    }
    if (state.action === "cleanup_queue") {
      cleanupQueueMutation.mutate();
      return;
    }
    cleanupJobsMutation.mutate();
  }

  async function copyLogs(): Promise<void> {
    if (!logsQuery.text) return;

    const text = logsQuery.text;
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;

    if (clipboard?.writeText) {
      try {
        await clipboard.writeText(text);
        notifySuccess("Logs copied", "Job logs copied to clipboard.");
        return;
      } catch {
        // Fallback below for environments where Clipboard API is blocked.
      }
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (!copied) {
        throw new Error("Clipboard copy command was rejected by the browser.");
      }
      notifySuccess("Logs copied", "Job logs copied to clipboard.");
    } catch (error) {
      notifyError("Failed to copy logs", error instanceof Error ? error : new Error("Clipboard is unavailable."));
    }
  }

  async function downloadLogs(): Promise<void> {
    if (!logsJobId || logsDownloading) return;

    const jobId = logsJobId;
    setLogsDownloading(true);
    try {
      const fullLogs = await getJobFileLogs(jobId);
      if (!fullLogs) {
        throw new Error("No log file content was returned for this job.");
      }

      const blob = new Blob([fullLogs], { type: "text/plain;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${jobId}.log`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      notifyError("Failed to download logs", error);
    } finally {
      setLogsDownloading(false);
    }
  }

  const matchedRunConfig =
    availableConfigs.find(
      (config) =>
        config === runForm.configPath.trim() || resolveConfigName(config) === resolveConfigName(runForm.configPath.trim())
    ) || "";

  const normalizedImageTag = runForm.imageTag.trim() || "latest";
  const selectedRunTagOption = runImageOptions.find((option) => option.tag === normalizedImageTag) || null;
  const runTagExists = Boolean(selectedRunTagOption);
  const runTagIsReadyForDeucalion = !isRunHostDeucalion || Boolean(selectedRunTagOption?.deucalionReady);
  const runCanGoToReview =
    Boolean(matchedRunConfig) &&
    runTagExists &&
    runTagIsReadyForDeucalion &&
    !deucalionWalltimeError;
  const runStepDefinitions = useMemo(() => {
    if (!isRunHostDeucalion) return RUN_WIZARD_BASE_STEPS;
    return [...RUN_WIZARD_BASE_STEPS.slice(0, 3), RUN_WIZARD_DEUCALION_STEP, RUN_WIZARD_BASE_STEPS[3]];
  }, [isRunHostDeucalion]);
  const runTotalSteps = runStepDefinitions.length;
  const runProgressPercent =
    runTotalSteps > 1 ? ((Math.max(1, runStep) - 1) / (runTotalSteps - 1)) * 100 : 0;
  const currentRunStepLabel = runStepDefinitions[runStep - 1]?.label || "Step";

  function buildDeucalionOptionsPayload() {
    const options = runForm.deucalionOptions;
    const payload: NonNullable<RunSimulationPayload["deucalion_options"]> = {
      command_mode: options.commandMode
    };

    if (effectiveDeucalionAccount) payload.account = effectiveDeucalionAccount;
    if (effectiveDeucalionPartition) payload.partition = effectiveDeucalionPartition;
    if (options.timeLimit.trim()) payload.time_limit = options.timeLimit.trim();

    const cpus = toOptionalInt(options.cpusPerTask);
    if (typeof cpus === "number") payload.cpus_per_task = cpus;
    const memGb = toOptionalInt(options.memGb);
    if (typeof memGb === "number") payload.mem_gb = memGb;
    const gpus = toOptionalInt(options.gpus);
    if (showDeucalionGpuField && typeof gpus === "number") payload.gpus = gpus;

    return payload;
  }

  function submitRunSimulation(): void {
    if (!matchedRunConfig) {
      notifyError("Missing experiment config", new Error("Choose one existing experiment config before continuing."));
      setRunStep(1);
      return;
    }
    if (!runTagExists) {
      notifyError("Invalid runtime version", new Error("Select one of the available runtime versions."));
      setRunStep(3);
      return;
    }
    if (!runTagIsReadyForDeucalion) {
      notifyError(
        "Version not ready for Deucalion",
        new Error("SIF desta versão ainda não está publicado para Deucalion.")
      );
      setRunStep(3);
      return;
    }
    if (isRunHostDeucalion && deucalionWalltimeError) {
      notifyError("Invalid Deucalion walltime", new Error(deucalionWalltimeError));
      setRunStep(4);
      return;
    }

    const payload: RunSimulationPayload = {
      target_host: runForm.targetHost || undefined,
      target_worker_profile: runForm.targetHost ? undefined : runForm.targetWorkerProfile || undefined,
      config_path: matchedRunConfig,
      job_name: runForm.jobName.trim() || undefined,
      submitted_by: session?.name || session?.email || undefined,
      image_tag: normalizedImageTag
    };

    if (payload.target_host === "deucalion") {
      payload.deucalion_options = buildDeucalionOptionsPayload();
    }

    runMutation.mutate(payload);
  }

  function goToNextRunStep(): void {
    if (runStep === 1 && !matchedRunConfig) {
      notifyError("Missing experiment config", new Error("Choose one existing experiment config before continuing."));
      return;
    }
    if (runStep === 3) {
      if (!runTagExists) {
        notifyError("Invalid runtime version", new Error("Select one of the available runtime versions."));
        return;
      }
      if (!runTagIsReadyForDeucalion) {
        notifyError(
          "Version not ready for Deucalion",
          new Error("SIF desta versão ainda não está publicado para Deucalion.")
        );
        return;
      }
    }
    if (isRunHostDeucalion && runStep === 4 && deucalionWalltimeError) {
      notifyError("Invalid Deucalion walltime", new Error(deucalionWalltimeError));
      return;
    }
    setRunStep((previous) => Math.min(runTotalSteps, previous + 1));
  }

  useEffect(() => {
    if (runStep <= runTotalSteps) return;
    setRunStep(runTotalSteps);
  }, [runStep, runTotalSteps]);

  return (
    <div className="page jobs-page">
      <header className="jobs-hero">
        <div>
          <h1>Jobs</h1>
        </div>
      </header>

      <section className="jobs-surface">
        <section className="jobs-main-stack">
          {refreshingVisual ? (
            <section className="datasets-loader-preview jobs-loader-card">
              <EVChargingLoader label="Refreshing jobs..." />
            </section>
          ) : null}

          <section className="jobs-main">
          <div className="jobs-command-bar">
            <div className="jobs-command-group">
              <Button
                variant="primary"
                iconLeft={<Play size={14} />}
                onClick={openRunWizard}
              >
                Run Job
              </Button>
              <Button
                variant="secondary"
                className="btn-square"
                onClick={refreshWithPreview}
                disabled={refreshingVisual}
                title="Refresh"
                aria-label="Refresh"
              >
                <RefreshCcw size={14} />
              </Button>
              <Button
                variant={compareMode ? "ghost" : "secondary"}
                onClick={() => setCompareMode((prev) => !prev)}
              >
                {compareMode ? "Exit Compare" : "Compare KPIs"}
              </Button>
            </div>

            <div className="jobs-command-group jobs-controls-right">
              <label className="search-inline jobs-search">
                <Search size={14} />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search jobs..."
                />
              </label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All Statuses</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <select value={hostFilter} onChange={(event) => setHostFilter(event.target.value)}>
                <option value="all">All Hosts</option>
                {hostOptions.map((host) => (
                  <option key={host.name} value={host.name}>
                    {formatHostName(host.name)}
                  </option>
                ))}
              </select>
              <select value={submittedFilter} onChange={(event) => setSubmittedFilter(event.target.value)}>
                <option value="all">All Submitters</option>
                {submittedByOptions.map((submittedBy) => (
                  <option key={submittedBy} value={submittedBy}>
                    {submittedBy}
                  </option>
                ))}
              </select>
              <div className="jobs-query-count">{filteredJobs.length} jobs</div>
            </div>
          </div>

          {filteredJobs.length === 0 ? (
            <EmptyState
              title="No jobs found"
              message="Create a simulation or adjust filters."
              action={
                <Button
                  variant="primary"
                  onClick={openRunWizard}
                >
                  Run Simulation
                </Button>
              }
            />
          ) : (
            <div className="jobs-table-wrap">
              <table className="table jobs-table">
                <colgroup>
                  {compareMode ? <col className="jobs-compare-col" /> : null}
                  <col className="jobs-job-col" />
                  <col className="jobs-submitter-col" />
                  <col className="jobs-config-col" />
                  <col className="jobs-progress-col" />
                  <col className="jobs-status-col" />
                  <col className="jobs-host-col" />
                  <col className="jobs-actions-col" />
                </colgroup>
                <thead>
                  <tr>
                    {compareMode ? <th className="jobs-compare-col">Compare</th> : null}
                    <th className="jobs-job-col">Job</th>
                    <th className="jobs-submitter-col">By</th>
                    <th className="jobs-config-col">Experiment Config</th>
                    <th className="jobs-progress-col">Progress</th>
                    <th className="jobs-status-col">Status</th>
                    <th className="jobs-host-col">Host</th>
                    <th className="jobs-actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => {
                    const selected = selectedJobId === job.job_id;
                    const progressInfo = progressMap.get(job.job_id);
                    const progress = progressInfo?.percent ?? null;
                    const displayStatus = resolveDisplayJobStatus(job.status, progress);
                    const isCompleted = isCompletedForResults(job.status);
                    const etaSeconds = resolveProgressEtaSeconds(job, progressInfo);
                    const estimatedFinishAt = resolveProgressEstimatedFinishAt(job, progressInfo);
                    const queuedStartTitle = resolveQueuedStartTooltip(job);
                    const progressTitle = [
                      progress !== null ? `Progress ${Math.round(progress)}%` : null,
                      etaSeconds !== null ? `ETA ${formatDurationSeconds(etaSeconds)}` : null,
                      estimatedFinishAt !== null ? `Expected finish ${formatDateTime(estimatedFinishAt)}` : null,
                      queuedStartTitle
                    ]
                      .filter(Boolean)
                      .join("\n");
                    const isChecked = compareSelection.includes(job.job_id);
                    const checkboxDisabled = !isCompleted;
                    const submittedBy =
                      resolveSubmittedByLabel(job.job_info.submitted_by) ||
                      resolveSubmittedByLabel(job.job_meta?.submitted_by);
                    const mlflowUrl = resolveMlflowRunUrl(job.job_info, job.job_meta);
                    const baseConfigPath =
                      (typeof job.job_info.config_path === "string" && job.job_info.config_path) ||
                      (typeof job.job_meta?.config_path === "string" ? job.job_meta.config_path : "");
                    const resolvedConfigAvailable = Boolean(job.job_info.resolved_config_available) && isCompleted;
                    const dispatchedStatus = hasAnyStatus(job.status, ["dispatch", "setup"]);
                    const dispatchSnapshot = readDispatchSnapshot(job);
                    const dispatchTitle = dispatchSnapshot.slurmState
                      ? `Slurm state: ${dispatchSnapshot.slurmState}`
                      : dispatchedStatus
                        ? "Show setup/dispatch details"
                        : "Show Slurm queue details";
                    const hostId = resolveJobTargetHost(job);
                    const hostLabel = formatHostName(hostId);
                    const deucalionRuntime = inferDeucalionJobRuntime(job, hostId);
                    const jobDisplayName = resolveJobDisplayName(job);
                    const resolvedConfigLabel = job.job_info.resolved_config_file || "config.resolved.yaml";
                    const baseConfigLabel = resolveConfigName(baseConfigPath);
                    const configTooltip = [
                      resolvedConfigAvailable ? `Resolved: ${resolvedConfigLabel}` : null,
                      baseConfigPath ? `Base: ${baseConfigPath}` : null
                    ]
                      .filter(Boolean)
                      .join("\n");

                    return (
                      <tr
                        key={job.job_id}
                        className={`jobs-row${selected ? " is-selected" : ""}`}
                        onClick={() => setSelectedJobId(job.job_id)}
                        onDoubleClick={() => openJobDetails(job.job_id, "overview")}
                      >
                        {compareMode ? (
                          <td className="jobs-compare-col">
                            <input
                              type="checkbox"
                              aria-label={`Select ${job.job_id} for comparison`}
                              checked={isChecked}
                              disabled={checkboxDisabled}
                              title={
                                !isCompleted
                                  ? "Comparison available only for completed jobs"
                                  : "Select for KPI comparison"
                              }
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleCompareSelection(job.job_id)}
                            />
                          </td>
                        ) : null}
                        <td className="jobs-job-col">
                          <div className="jobs-id-cell" title={`${jobDisplayName}\n${job.job_id}`}>
                            <strong className="jobs-truncate-start">{jobDisplayName}</strong>
                            <small>{job.job_id}</small>
                          </div>
                        </td>
                        <td className="jobs-submitter-col">
                          {submittedBy ? (
                            <div className="submitted-by-cell" title={`Submitted by: ${submittedBy}`}>
                              <span className="submitted-by-avatar" aria-label={`Submitted by ${submittedBy}`}>
                                {computeUserInitials(submittedBy)}
                              </span>
                            </div>
                          ) : (
                            <small className="jobs-meta">-</small>
                          )}
                        </td>
                        <td className="jobs-config-col">
                          <div className="jobs-config-cell" title={configTooltip || undefined}>
                            {resolvedConfigAvailable ? (
                              <strong className="jobs-config-line">
                                <button
                                  type="button"
                                  className="btn-link jobs-config-link jobs-truncate-start"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openResolvedConfigPreview(job);
                                  }}
                                  title={`Preview resolved config: ${resolvedConfigLabel}`}
                                >
                                  {resolvedConfigLabel}
                                </button>
                              </strong>
                            ) : null}
                            {baseConfigPath ? (
                              <small className="jobs-config-line">
                                {resolvedConfigAvailable ? <span className="jobs-config-prefix">Based on</span> : null}
                                <button
                                  type="button"
                                  className="btn-link jobs-config-link jobs-truncate-start"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openBaseConfigPreview(baseConfigPath);
                                  }}
                                  title={`Preview experiment config: ${baseConfigPath}`}
                                >
                                  {baseConfigLabel}
                                </button>
                              </small>
                            ) : null}
                            {!resolvedConfigAvailable && !baseConfigPath ? <small className="jobs-meta">-</small> : null}
                          </div>
                        </td>
                        <td className="jobs-progress-col">
                          <div className="jobs-progress-cell">
                            <strong title={progressTitle || undefined}>{progress !== null ? `${Math.round(progress)}%` : "-"}</strong>
                            <div className="progress-track" title={progressTitle || undefined}>
                              <div className="progress-fill" style={{ width: `${progress ?? 0}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="jobs-status-col">
                          <div className="jobs-status-cell">
                            {dispatchedStatus ? (
                              <button
                                type="button"
                                className="jobs-status-trigger"
                                title={dispatchTitle}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDispatchDetailsTarget(job);
                                }}
                              >
                                <StatusPill status={displayStatus} />
                              </button>
                            ) : (
                              <span title={queuedStartTitle || undefined}>
                                <StatusPill status={displayStatus} />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="jobs-host-col">
                          <div className="jobs-host-cell">
                            <strong>{hostLabel}</strong>
                            {deucalionRuntime ? (
                              <small className={`jobs-host-runtime-pill is-${deucalionRuntime.toLowerCase()}`}>
                                {deucalionRuntime}
                              </small>
                            ) : null}
                          </div>
                        </td>
                        <td className="jobs-actions-col">
                          <div className="table-actions table-actions-compact jobs-table-actions">
                            <button
                              type="button"
                              className={`icon-btn job-eye-btn${!isCompleted ? " is-disabled" : ""}`}
                              aria-label={`See more about ${job.job_id}`}
                              title={isCompleted ? "See more" : "Available after completion"}
                              disabled={!isCompleted}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!isCompleted) return;
                                openJobDetails(job.job_id);
                              }}
                            >
                              <Eye size={15} />
                            </button>

                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Open logs for ${job.job_id}`}
                              title="Open logs"
                              onClick={(event) => {
                                event.stopPropagation();
                                setLogsJobId(job.job_id);
                                setLogsSearch("");
                                setLogsOpen(true);
                              }}
                            >
                              <FileText size={15} />
                            </button>

                            <button
                              type="button"
                              className={`icon-btn${mlflowUrl ? "" : " is-disabled"}`}
                              aria-label={`Open MLflow run for ${job.job_id}`}
                              title={mlflowUrl ? "Open MLflow run" : "MLflow run not available yet"}
                              disabled={!mlflowUrl}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!mlflowUrl || typeof window === "undefined") return;
                                window.open(mlflowUrl, "_blank", "noopener,noreferrer");
                              }}
                            >
                              <FlaskConical size={15} />
                            </button>

                            <button
                              type="button"
                              className="icon-btn icon-btn-danger"
                              aria-label={`Delete ${job.job_id}`}
                              title="Delete"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteJobTarget(job.job_id);
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {compareMode ? (
            <section className="jobs-compare-bar">
              <strong>{compareSelection.length} selected for KPI compare</strong>
              <div className="jobs-command-group">
                <Button variant="ghost" onClick={() => setCompareSelection([])} disabled={compareSelection.length === 0}>
                  Clear selection
                </Button>
                <Button
                  variant="primary"
                  disabled={compareSelection.length < 2}
                  onClick={openComparePage}
                >
                  Open KPI Compare
                </Button>
              </div>
            </section>
          ) : null}

          <section className="jobs-admin-row">
            <Button
              variant="secondary"
              disabled={!selectedJobId || !canRequeueSelected}
              title={!selectedJobId ? "Select a job first" : !canRequeueSelected ? "Requeue not available for this status" : "Requeue selected job"}
              onClick={() => {
                if (!selectedJobId || !canRequeueSelected) return;
                setAdminConfirm({ action: "requeue", jobId: selectedJobId });
              }}
            >
              Requeue Job
            </Button>
            <Button
              variant="secondary"
              disabled={!selectedJobId || !canStopSelected}
              title={!selectedJobId ? "Select a job first" : !canStopSelected ? "Stop not available for this status" : "Stop selected job"}
              onClick={() => {
                if (!selectedJobId || !canStopSelected) return;
                setAdminConfirm({ action: "stop", jobId: selectedJobId });
              }}
            >
              Stop Job
            </Button>
            <Button
              variant="secondary"
              disabled={!selectedJobId || !canFailSelected}
              title={!selectedJobId ? "Select a job first" : !canFailSelected ? "Mark failed not available for this status" : "Mark selected job as failed"}
              onClick={() => {
                if (!selectedJobId || !canFailSelected) return;
                setAdminConfirm({ action: "fail", jobId: selectedJobId });
              }}
            >
              Mark Failed
            </Button>
            <Button
              variant="ghost"
              disabled={!canCleanupJobs}
              onClick={() => {
                if (!canCleanupJobs) return;
                setAdminConfirm({ action: "cleanup_jobs" });
              }}
            >
              Cleanup Jobs
            </Button>
          </section>
          </section>
        </section>

        <aside className="jobs-sidebar">
          <article className="jobs-side-panel">
            <header className="jobs-host-header">
              <div>
                <h2>Available Hosts</h2>
                <small>Last update: {hostsLastUpdated}</small>
              </div>
              <span className={`live-pill${hostsLiveWindow ? " is-live" : ""}`}>
                {hostsLiveWindow ? "Live" : "Delayed"}
              </span>
            </header>
            {!hostsLiveWindow ? (
              <small className="jobs-live-reminder">No recent host heartbeat. Check VPN/orchestrator connectivity.</small>
            ) : null}
            <ul className="jobs-host-list">
              {hostRows.length > 0 ? (
                hostRows.map((host) => {
                  const isLive = isRecentTimestamp(host.last_seen);
                  const unionAuth = host.name === "union-inesctec" && host.info?.union_auth && typeof host.info.union_auth === "object"
                    ? (host.info.union_auth as { status?: string })
                    : null;
                  const unionAuthRequired = unionAuth?.status === "authentication_required";
                  const cardActiveJobId =
                    host.current_job_id ||
                    (typeof host.info?.active_job_id === "string" ? host.info.active_job_id : null);
                  const telemetryActiveJobs = Array.isArray(host.info?.active_jobs) ? host.info.active_jobs : [];
                  const cardActiveJobName = (
                    telemetryActiveJobs.find((entry) => {
                      if (!entry || typeof entry !== "object") return false;
                      const entryId =
                        typeof (entry as { job_id?: unknown }).job_id === "string"
                          ? (entry as { job_id: string }).job_id
                          : null;
                      return Boolean(cardActiveJobId) && entryId === cardActiveJobId;
                    }) ||
                    telemetryActiveJobs[0]
                  ) as { job_name?: unknown } | undefined;
                  const cardActiveJobLabel = resolveHostJobName(
                    cardActiveJobId,
                    typeof cardActiveJobName?.job_name === "string" ? cardActiveJobName.job_name : null
                  );
                  const capacitySummary = resolveHostCapacitySummary(host.name, host);
                  const computeBadge = resolveHostComputeBadge(host.name, host);
                  return (
                    <li key={host.name}>
                      <button
                        type="button"
                        className="host-card-btn"
                        onClick={() => openHostDetails(host.name, host)}
                        title={`Open details for ${formatHostName(host.name)}`}
                      >
                        <div className="jobs-host-line">
                          <Server size={14} />
                          <span className={`host-live-dot${isLive ? " is-online" : ""}`} />
                          <strong>{formatHostName(host.name)}</strong>
                          {unionAuthRequired && canAuthenticateUnion ? (
                            <TriangleAlert
                              size={14}
                              className="host-auth-warning-icon"
                              aria-label="Union authentication required"
                            />
                          ) : null}
                          <span
                            className={`host-compute-pill is-${computeBadge.kind}`}
                            title={computeBadge.title}
                            aria-label={computeBadge.title}
                          >
                            <Cpu size={11} />
                            {computeBadge.label}
                          </span>
                          <small>{isLive ? "Live" : "Offline"}</small>
                          <Info size={13} />
                        </div>
                        <small className={`jobs-capacity-line${capacitySummary.overCapacity ? " is-over-capacity" : ""}`}>
                          {capacitySummary.label}
                        </small>
                        {cardActiveJobId ? (
                          <small className="jobs-meta">
                            Active: {cardActiveJobLabel}
                            {host.current_job_status || host.info?.active_job_status
                              ? ` (${host.current_job_status || host.info?.active_job_status})`
                              : ""}
                          </small>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              ) : (
                <li>
                  <small className="jobs-meta">No host telemetry.</small>
                </li>
              )}
            </ul>
          </article>

          <article className="jobs-side-panel">
            <header className="jobs-queue-header">
              <div className="jobs-queue-header-main">
                <h2>Queue</h2>
                <span className="queue-count-pill">{queueQuery.data?.length || 0}</span>
              </div>
              {canCleanupQueue ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="jobs-queue-clean-btn"
                  iconLeft={<Trash2 size={13} />}
                  onClick={() => {
                    setAdminConfirm({ action: "cleanup_queue" });
                  }}
                >
                  Clean up
                </Button>
              ) : null}
            </header>
            <div className="jobs-queue-filters">
              <select value={queueHostFilter} onChange={(event) => setQueueHostFilter(event.target.value)}>
                <option value="all">All queue hosts</option>
                {queueHostOptions.map((host) => (
                  <option key={host} value={host}>
                    {host}
                  </option>
                ))}
              </select>
            </div>
            <ul className="jobs-queue-list">
              {filteredQueueEntries.map((entry, index) => {
                const jobRef = jobsById.get(entry.job_id);
                const queueName = jobRef ? resolveJobDisplayName(jobRef) : entry.job_id;
                const queueTargetProfile = normalizeTargetWorkerProfile(
                  entry.target_worker_profile || jobRef?.job_info.target_worker_profile
                );
                const queueHost =
                  entry.require_host === false
                    ? queueTargetProfile
                      ? targetWorkerProfileLabel(queueTargetProfile)
                      : "Any host"
                    : entry.preferred_host || jobRef?.job_info.target_host || "Any host";
                const queueStartTitle = resolveQueueEntryStartTooltip(entry);
                const queueStartLabel = queuedStartVisibleLabel(entry.queued_start_estimate);
                const submittedBy =
                  resolveSubmittedByLabel(entry.submitted_by) ||
                  resolveSubmittedByLabel(jobRef?.job_info.submitted_by) ||
                  resolveSubmittedByLabel(jobRef?.job_meta?.submitted_by);
                const canCancelEntry = !jobRef || canCancelStatus(jobRef.status);
                return (
                  <li key={entry.job_id} title={queueStartTitle || undefined}>
                    <article className="queue-row">
                      <div className="queue-row-main">
                        <span className="queue-index">{index + 1}</span>
                        <div className="queue-row-title">
                          <strong>{queueName}</strong>
                          <small>{entry.job_id}</small>
                        </div>
                      </div>
                      <div className="queue-row-footer">
                        <div className="queue-row-meta">
                          <span className="queue-host-pill">
                            <Server size={12} />
                            {queueHost}
                          </span>
                          {submittedBy ? (
                            <span className="queue-submitter" title={`Submitted by: ${submittedBy}`}>
                              <span className="submitted-by-avatar">{computeUserInitials(submittedBy)}</span>
                            </span>
                          ) : null}
                          <small className="jobs-meta" title={queueStartTitle || undefined}>
                            {formatDateTime(entry.enqueued_at || jobRef?.queued_at || null)}
                          </small>
                          {queueStartLabel ? (
                            <span
                              className={`queue-start-pill${
                                entry.queued_start_estimate?.available ? "" : " is-muted"
                              }`}
                              title={queueStartTitle || undefined}
                            >
                              {queueStartLabel}
                            </span>
                          ) : null}
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="queue-cancel-btn"
                          disabled={!canCancelEntry}
                          onClick={() => setAdminConfirm({ action: "cancel", jobId: entry.job_id })}
                        >
                          Cancel
                        </Button>
                      </div>
                    </article>
                  </li>
                );
              })}
              {filteredQueueEntries.length === 0 ? (
                <li className="queue-empty">
                  <small>
                    {queueQuery.data && queueQuery.data.length > 0
                      ? "No queue entries match the selected host."
                      : "Queue is empty. New jobs will appear here."}
                  </small>
                </li>
              ) : null}
            </ul>
          </article>
        </aside>
      </section>

      <Modal
        title="Run simulation"
        open={runOpen}
        onClose={() => {
          setRunOpen(false);
          resetRunWizardState();
        }}
        width="md"
      >
        <form
          className="form-grid run-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (runStep < runTotalSteps) {
              goToNextRunStep();
              return;
            }
            submitRunSimulation();
          }}
        >
          <section className="full-col run-modal-shell">
            <header className="config-wizard-header">
              <small className="jobs-meta">
                Step {runStep} / {runTotalSteps} · {currentRunStepLabel}
              </small>
              <div className="config-progress-track run-progress-track" role="tablist" aria-label="Run simulation steps">
                <div className="config-progress-line" aria-hidden="true">
                  <div className="config-progress-line-fill" style={{ width: `${runProgressPercent}%` }} />
                </div>
                <div className="config-progress-points">
                  {runStepDefinitions.map((step, index) => {
                    const stepNumber = index + 1;
                    const stateClass =
                      stepNumber < runStep
                        ? "is-done"
                        : stepNumber === runStep
                          ? "is-active"
                          : "is-pending";
                    return (
                      <button
                        key={step.id}
                        type="button"
                        className={`config-progress-point ${stateClass}`}
                        onClick={() => {
                          if (stepNumber <= runStep) setRunStep(stepNumber);
                        }}
                        disabled={stepNumber > runStep}
                        title={step.label}
                        aria-label={`Go to ${step.label}`}
                      >
                        <span>{stepNumber}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </header>

            {runStep === 1 ? (
              <>
                <label className="run-config-picker">
                  <span>Experiment Config file</span>
                  <div className="run-config-row">
                    <div className="run-config-combobox">
                      <input
                        placeholder="Select or type to filter experiment configs"
                        value={runForm.configPath}
                        onFocus={() => setConfigPickerOpen(true)}
                        onBlur={() => window.setTimeout(() => setConfigPickerOpen(false), 90)}
                        onChange={(event) => {
                          setJobNameTouched(false);
                          setRunForm((prev) => ({ ...prev, configPath: event.target.value }));
                          setConfigPickerOpen(true);
                        }}
                        required
                      />
                      {configPickerOpen ? (
                        <ul className="run-config-menu" role="listbox" aria-label="Experiment Config options">
                          {filteredConfigOptions.length > 0 ? (
                            filteredConfigOptions.map((config) => (
                              <li key={config}>
                                <button
                                  type="button"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => {
                                    setJobNameTouched(false);
                                    setRunForm((prev) => ({ ...prev, configPath: config }));
                                    setConfigPickerOpen(false);
                                  }}
                                >
                                  {config}
                                </button>
                              </li>
                            ))
                          ) : (
                            <li className="run-config-empty">No matching experiment config</li>
                          )}
                        </ul>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setRunOpen(false);
                        navigate("/app/ai/configs");
                      }}
                    >
                      New Experiment Config
                    </Button>
                  </div>
                </label>
                <small className="jobs-meta">
                  {availableConfigs.length > 0
                    ? `${availableConfigs.length} saved experiment config(s) available`
                    : "No saved experiment configs found. Create one before running."}
                </small>
                <label>
                  <span>Job name</span>
                  <input
                    placeholder="Custom job name"
                    value={runForm.jobName}
                    onChange={(event) => {
                      setJobNameTouched(true);
                      setRunForm((previous) => ({ ...previous, jobName: event.target.value }));
                    }}
                  />
                  <small className="jobs-meta">Pre-filled from selected config. You can override per run.</small>
                </label>
              </>
            ) : null}

            {runStep === 2 ? (
              <section className="full-col run-host-section">
                <span>Target host</span>
                <div className="run-host-grid">
                  <button
                    type="button"
                    className={`run-host-option is-auto${
                      runForm.targetHost === "" && runForm.targetWorkerProfile === "" ? " is-selected" : ""
                    }`}
                    onClick={() => setRunForm((prev) => ({ ...prev, targetHost: "", targetWorkerProfile: "" }))}
                  >
                    <span className="run-host-dot is-online" />
                    <strong>Automatic</strong>
                    <small>Use scheduler routing</small>
                  </button>
                  <button
                    type="button"
                    className={`run-host-option is-auto${
                      runForm.targetHost === "" && runForm.targetWorkerProfile === "gpu" ? " is-selected" : ""
                    }`}
                    onClick={() => setRunForm((prev) => ({ ...prev, targetHost: "", targetWorkerProfile: "gpu" }))}
                  >
                    <span className="run-host-dot is-online" />
                    <strong>Any GPU</strong>
                    <small>Only GPU workers</small>
                  </button>
                  <button
                    type="button"
                    className={`run-host-option is-auto${
                      runForm.targetHost === "" && runForm.targetWorkerProfile === "cpu" ? " is-selected" : ""
                    }`}
                    onClick={() => setRunForm((prev) => ({ ...prev, targetHost: "", targetWorkerProfile: "cpu" }))}
                  >
                    <span className="run-host-dot is-online" />
                    <strong>Any CPU</strong>
                    <small>Only CPU workers</small>
                  </button>
                  {hostOptions.map((host) => {
                    const computeBadge = resolveHostComputeBadge(host.name, host.data);
                    return (
                      <button
                        type="button"
                        key={host.name}
                        className={`run-host-option${runForm.targetHost === host.name ? " is-selected" : ""}`}
                        onClick={() => setRunForm((prev) => ({ ...prev, targetHost: host.name, targetWorkerProfile: "" }))}
                      >
                        <span className={`run-host-dot${host.online === true ? " is-online" : ""}`} />
                        <strong>{formatHostName(host.name)}</strong>
                        <small>{host.online === true ? "Online" : "Offline"}</small>
                        <span
                          className={`host-compute-pill is-${computeBadge.kind}`}
                          title={computeBadge.title}
                          aria-label={computeBadge.title}
                        >
                          <Cpu size={11} />
                          {computeBadge.label}
                        </span>
                      </button>
                    );
                  })}
                  {!hostOptions.length ? (
                    <p className="jobs-meta">No host telemetry available.</p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {runStep === 3 ? (
              <label className="full-col">
                <span className="run-image-label">
                  Runtime version
                  <span className="run-image-help" tabIndex={0} aria-label="Runtime version hint">
                    <Info size={13} />
                    <span role="tooltip" className="run-image-help-tooltip">
                      Para Deucalion, apenas versões com SIF publicado estão disponíveis.
                    </span>
                  </span>
                </span>
                <select
                  value={runForm.imageTag}
                  onChange={(event) => setRunForm((previous) => ({ ...previous, imageTag: event.target.value }))}
                >
                  {hasCustomRunImage ? (
                    <option value={runForm.imageTag} disabled={isRunHostDeucalion}>
                      {runForm.imageTag} {isRunHostDeucalion ? "(custom, SIF unknown)" : "(custom)"}
                    </option>
                  ) : null}
                  {runImageOptions.map((option) => (
                    <option
                      key={option.tag}
                      value={option.tag}
                      disabled={isRunHostDeucalion && !option.deucalionReady}
                      title={
                        isRunHostDeucalion && !option.deucalionReady
                          ? "SIF desta versão ainda não está publicado para Deucalion"
                          : undefined
                      }
                    >
                      {option.tag}
                      {option.lastUpdated ? ` · ${formatDateTime(option.lastUpdated)}` : ""}
                      {isRunHostDeucalion && !option.deucalionReady ? " (SIF not ready)" : ""}
                    </option>
                  ))}
                </select>
                <small className="jobs-meta">
                  Docker repository: {imageRepository}
                  {jobImagesQuery.isFetching ? " · refreshing versions..." : ""}
                </small>
                {isRunHostDeucalion && selectedImageOption && !selectedImageOption.deucalionReady ? (
                  <small className="jobs-meta">SIF desta versão ainda não está publicado para Deucalion.</small>
                ) : null}
              </label>
            ) : null}

            {isRunHostDeucalion && runStep === 4 ? (
              <section className="full-col run-deucalion-section">
                <h4>Deucalion runtime</h4>
                <small className="jobs-meta">
                  Escolhe um perfil. A conta e a partition são automáticas; podes fazer override nas opções avançadas.
                </small>

                <div className="run-deucalion-profile-grid">
                  <button
                    type="button"
                    className={`run-host-option${deucalionProfile === "cpu" ? " is-selected" : ""}`}
                    onClick={() => {
                      setDeucalionProfile("cpu");
                      setRunForm((previous) => ({
                        ...previous,
                        deucalionOptions: {
                          ...previous.deucalionOptions,
                          account: "",
                          partition: "",
                          gpus: ""
                        }
                      }));
                    }}
                  >
                    <span className="run-host-dot is-online" />
                    <strong>CPU</strong>
                    <small>Queue normal-x86</small>
                  </button>
                  <button
                    type="button"
                    className={`run-host-option${deucalionProfile === "gpu" ? " is-selected" : ""}`}
                    onClick={() => {
                      setDeucalionProfile("gpu");
                      setRunForm((previous) => ({
                        ...previous,
                        deucalionOptions: {
                          ...previous.deucalionOptions,
                          account: "",
                          partition: ""
                        }
                      }));
                    }}
                  >
                    <span className="run-host-dot is-online" />
                    <strong>GPU</strong>
                    <small>Queue normal-a100-80</small>
                  </button>
                </div>

                <dl className="run-deucalion-summary">
                  <div>
                    <dt>Account</dt>
                    <dd>{effectiveDeucalionAccount || deucalionAutoAccountDisplay}</dd>
                  </div>
                  <div>
                    <dt>Partition</dt>
                    <dd>{effectiveDeucalionPartition}</dd>
                  </div>
                  <div>
                    <dt>Max walltime</dt>
                    <dd>
                      {effectiveDeucalionPartitionLimit
                        ? formatWalltimeLimit(effectiveDeucalionPartitionLimit.maxSeconds)
                        : "-"}
                    </dd>
                  </div>
                </dl>

                <div className="run-deucalion-core-grid">
                  <label>
                    <span>Time limit (HH:MM:SS)</span>
                    <input
                      placeholder={deucalionDefaults.timeLimit}
                      value={runForm.deucalionOptions.timeLimit}
                      onChange={(event) =>
                        setRunForm((previous) => ({
                          ...previous,
                          deucalionOptions: { ...previous.deucalionOptions, timeLimit: event.target.value }
                        }))
                      }
                    />
                    <small className={deucalionWalltimeError ? "jobs-meta is-danger" : "jobs-meta"}>
                      {deucalionWalltimeError ||
                        (effectiveDeucalionPartitionLimit
                          ? `Max ${formatWalltimeLimit(effectiveDeucalionPartitionLimit.maxSeconds)} for ${effectiveDeucalionPartition}.`
                          : "Choose a known partition to validate walltime.")}
                    </small>
                  </label>
                  <label>
                    <span>CPUs per task</span>
                    <input
                      placeholder={deucalionDefaults.cpusPerTask}
                      value={runForm.deucalionOptions.cpusPerTask}
                      onChange={(event) =>
                        setRunForm((previous) => ({
                          ...previous,
                          deucalionOptions: { ...previous.deucalionOptions, cpusPerTask: event.target.value }
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Memory (GB)</span>
                    <input
                      placeholder={deucalionDefaults.memGb}
                      value={runForm.deucalionOptions.memGb}
                      onChange={(event) =>
                        setRunForm((previous) => ({
                          ...previous,
                          deucalionOptions: { ...previous.deucalionOptions, memGb: event.target.value }
                        }))
                      }
                    />
                  </label>
                  {showDeucalionGpuField ? (
                    <label>
                      <span>GPUs</span>
                      <input
                        placeholder={deucalionDefaults.gpus || "1"}
                        value={runForm.deucalionOptions.gpus}
                        onChange={(event) =>
                          setRunForm((previous) => ({
                            ...previous,
                            deucalionOptions: { ...previous.deucalionOptions, gpus: event.target.value }
                          }))
                        }
                      />
                    </label>
                  ) : null}
                </div>

                <small className="jobs-meta">
                  `run` (recomendado) usa o entrypoint da imagem. `exec` executa o comando exato.
                </small>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowDeucalionAdvanced((value) => !value)}
                >
                  {showDeucalionAdvanced ? "Hide advanced options" : "Show advanced options"}
                </Button>

                {showDeucalionAdvanced ? (
                  <section className="run-deucalion-advanced">
                    <label>
                      <span>Command mode</span>
                      <select
                        value={runForm.deucalionOptions.commandMode}
                        onChange={(event) =>
                          setRunForm((previous) => ({
                            ...previous,
                            deucalionOptions: {
                              ...previous.deucalionOptions,
                              commandMode: event.target.value as "run" | "exec"
                            }
                          }))
                        }
                      >
                        <option value="run">run (recommended)</option>
                        <option value="exec">exec</option>
                      </select>
                    </label>
                    <label>
                      <span>Account override (optional)</span>
                      <input
                        placeholder={`Auto: ${deucalionAutoAccountDisplay}`}
                        value={runForm.deucalionOptions.account}
                        onChange={(event) =>
                          setRunForm((previous) => ({
                            ...previous,
                            deucalionOptions: { ...previous.deucalionOptions, account: event.target.value }
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Partition override (optional)</span>
                      <select
                        value={runForm.deucalionOptions.partition}
                        onChange={(event) =>
                          setRunForm((previous) => ({
                            ...previous,
                            deucalionOptions: { ...previous.deucalionOptions, partition: event.target.value }
                          }))
                        }
                      >
                        <option value="">Auto: {deucalionAutoPartition}</option>
                        {deucalionPartitionLimits.filter((entry) => entry.profile === deucalionProfile).map((entry) => (
                          <option key={entry.partition} value={entry.partition}>
                            {entry.partition} · {entry.label} · max {formatWalltimeLimit(entry.maxSeconds)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <small className="jobs-meta">
                      Dataset sync é inferido automaticamente do teu config (`simulator.dataset_path` / `dataset_name`).
                      O SIF é tratado automaticamente pelo worker (não precisas pôr em required paths).
                    </small>
                  </section>
                ) : null}
              </section>
            ) : null}

            {runStep === runTotalSteps ? (
              <section className="full-col">
                <h4>Review</h4>
                <dl className="host-details-grid">
                  <div>
                    <dt>Config</dt>
                    <dd>{matchedRunConfig || "-"}</dd>
                  </div>
                  <div>
                    <dt>Job name</dt>
                    <dd>{runForm.jobName.trim() || "-"}</dd>
                  </div>
                  <div>
                    <dt>Target host</dt>
                    <dd>{runForm.targetHost ? formatHostName(runForm.targetHost) : targetWorkerProfileLabel(runForm.targetWorkerProfile)}</dd>
                  </div>
                  <div>
                    <dt>Version tag</dt>
                    <dd>{normalizedImageTag}</dd>
                  </div>
                  {isRunHostDeucalion ? (
                    <>
                      <div>
                        <dt>Profile</dt>
                        <dd>{deucalionProfile.toUpperCase()}</dd>
                      </div>
                      <div>
                        <dt>Account / partition</dt>
                        <dd>{`${effectiveDeucalionAccount || deucalionAutoAccountDisplay} / ${effectiveDeucalionPartition}`}</dd>
                      </div>
                      <div>
                        <dt>Walltime</dt>
                        <dd>
                          {(runForm.deucalionOptions.timeLimit.trim() || deucalionDefaults.timeLimit) +
                            (effectiveDeucalionPartitionLimit
                              ? ` (max ${formatWalltimeLimit(effectiveDeucalionPartitionLimit.maxSeconds)})`
                              : "")}
                        </dd>
                      </div>
                    </>
                  ) : null}
                </dl>
                {isRunHostDeucalion ? (
                  <small className="jobs-meta">
                    Deucalion will resolve SIF artifact from tag `{normalizedImageTag}`.
                  </small>
                ) : null}
              </section>
            ) : null}
          </section>

          <div className="full-col inline-end">
            {runStep > 1 ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRunStep((previous) => Math.max(1, previous - 1))}
              >
                Back
              </Button>
            ) : null}
            {runStep < runTotalSteps ? (
              <Button type="submit" variant="primary">
                Next
              </Button>
            ) : (
              <Button type="submit" variant="primary" disabled={runMutation.isPending || !runCanGoToReview}>
                {runMutation.isPending ? "Submitting..." : "Run simulation"}
              </Button>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        title={`Logs: ${logsJobId || "-"}`}
        open={logsOpen}
        onClose={() => {
          setLogsOpen(false);
          setLogsJobId("");
          setLogsSearch("");
        }}
        width="lg"
      >
        <section className="job-logs-modal-content">
          <div className="job-logs-toolbar">
            <div className="job-logs-modal-actions">
              <Button variant="ghost" iconLeft={<Copy size={13} />} onClick={copyLogs} disabled={!hasRawLogs}>
                Copy
              </Button>
              <Button
                variant="ghost"
                iconLeft={<Download size={13} />}
                onClick={downloadLogs}
                disabled={!hasRawLogs || logsDownloading}
              >
                {logsDownloading ? "Downloading..." : "Download"}
              </Button>
            </div>

            <label className="search-inline job-logs-search">
              <Search size={14} />
              <input
                value={logsSearch}
                onChange={(event) => setLogsSearch(event.target.value)}
                placeholder="Search logs..."
                disabled={!hasRawLogs}
              />
            </label>
          </div>

          {(logsQuery.loading || (logsQuery.fetching && !hasRawLogs)) ? (
            <section className="datasets-loader-preview">
              <EVChargingLoader label="Loading logs..." />
            </section>
          ) : null}
          {logsQuery.error ? <p className="error-text">Could not load logs for this job.</p> : null}
          {hasRawLogs ? (
            <>
              <small className="jobs-meta">
                Showing {filteredLogLines.length} / {allLogLines.length} lines
              </small>
              {filteredLogLines.length > 0 ? (
                <pre ref={logsPreRef} className="json-view compact">
                  {filteredLogLines.join("\n")}
                </pre>
              ) : (
                <p className="jobs-meta">No lines match this search.</p>
              )}
            </>
          ) : null}
          {!logsQuery.loading && !logsQuery.error && !hasRawLogs ? (
            <p className="jobs-meta">{logsQuery.message || "Ainda não há logs para este job (ou o ficheiro está vazio)."}</p>
          ) : null}
        </section>
      </Modal>

      <Modal
        title={`Host details: ${formatHostName(hostDetailsTarget?.name)}`}
        open={hostDetailsOpen}
        onClose={() => {
          setHostDetailsOpen(false);
          setHostDetailsTarget(null);
        }}
        width="md"
      >
        {hostDetailsTarget ? (
          (() => {
            const rawActiveJobs = Array.isArray(hostDetailsTarget.data.info?.active_jobs)
              ? (hostDetailsTarget.data.info.active_jobs as unknown[])
              : [];
            const telemetryActiveJobs: HostActiveJobSnapshot[] = rawActiveJobs
              .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
              .map((entry) => ({
                job_id: typeof entry.job_id === "string" ? entry.job_id : "",
                job_name: typeof entry.job_name === "string" ? entry.job_name : undefined,
                status: typeof entry.status === "string" ? entry.status : undefined,
                phase: typeof entry.phase === "string" ? entry.phase : undefined,
                slurm_state: typeof entry.slurm_state === "string" ? entry.slurm_state : undefined,
                slurm_partition: typeof entry.slurm_partition === "string" ? entry.slurm_partition : undefined,
                slurm_nodes: typeof entry.slurm_nodes === "number" ? entry.slurm_nodes : undefined,
                slurm_cpus: typeof entry.slurm_cpus === "number" ? entry.slurm_cpus : undefined,
                slurm_gpus: typeof entry.slurm_gpus === "number" ? entry.slurm_gpus : undefined,
                queue_pos: typeof entry.queue_pos === "number" ? entry.queue_pos : undefined,
                ahead: typeof entry.ahead === "number" ? entry.ahead : undefined,
              }))
              .filter((entry) => Boolean(entry.job_id));
            const fallbackActiveIds = Array.isArray(hostDetailsTarget.data.active_job_ids)
              ? hostDetailsTarget.data.active_job_ids
              : [];
            const activeJobs: HostActiveJobSnapshot[] =
              telemetryActiveJobs.length > 0
                ? telemetryActiveJobs
                : fallbackActiveIds.map((jobId) => ({ job_id: jobId }));
            const currentJobId =
              hostDetailsTarget.data.current_job_id ||
              (typeof hostDetailsTarget.data.info?.active_job_id === "string" ? hostDetailsTarget.data.info.active_job_id : null);
            const currentActiveEntry = currentJobId
              ? telemetryActiveJobs.find((entry) => entry.job_id === currentJobId)
              : telemetryActiveJobs[0];
            const currentJobName = currentActiveEntry?.job_name || null;
            const currentJobStatus =
              hostDetailsTarget.data.current_job_status ||
              (typeof hostDetailsTarget.data.info?.active_job_status === "string"
                ? hostDetailsTarget.data.info.active_job_status
                : "-");
            const capacitySummary = resolveHostCapacitySummary(hostDetailsTarget.name, hostDetailsTarget.data);
            const lastJobId =
              typeof hostDetailsTarget.data.info?.last_job_id === "string" ? hostDetailsTarget.data.info.last_job_id : null;
            const lastTerminalStatus =
              typeof hostDetailsTarget.data.info?.last_terminal_status === "string"
                ? hostDetailsTarget.data.info.last_terminal_status
                : "-";
            const unionAuthRaw = hostDetailsTarget.data.info?.union_auth;
            const unionAuth = unionAuthRaw && typeof unionAuthRaw === "object"
              ? (unionAuthRaw as Record<string, unknown>)
              : null;
            return (
              <section className="host-details-modal">
                {hostDetailsTarget.name === "union-inesctec" && canAuthenticateUnion && unionAuth ? (
                  <section className={`union-auth-panel is-${String(unionAuth.status || "unknown")}`}>
                    <div className="union-auth-copy">
                      <span className="union-auth-icon"><TriangleAlert size={17} /></span>
                      <div>
                        <h4>Union authentication</h4>
                        <p>
                          {unionAuth.status === "authenticated"
                            ? "Authenticated. Stored credentials will be refreshed automatically."
                            : unionAuth.status === "checking"
                              ? "Checking stored Union credentials…"
                              : "Authentication is required before this worker can accept new jobs."}
                        </p>
                        {typeof unionAuth.user_code === "string" ? (
                          <small>Verification code: <strong>{unionAuth.user_code}</strong></small>
                        ) : null}
                      </div>
                    </div>
                    {unionAuth.status === "authentication_required" ? (
                      <Button
                        variant="primary"
                        iconLeft={<ExternalLink size={14} />}
                        disabled={unionAuthMutation.isPending}
                        onClick={() => beginUnionAuthentication(unionAuth)}
                      >
                        {unionAuthMutation.isPending ? "Preparing…" : "Authenticate with Union"}
                      </Button>
                    ) : null}
                  </section>
                ) : null}
                <dl className="host-details-grid">
              <div>
                <dt>Status</dt>
                <dd>{isRecentTimestamp(hostDetailsTarget.data.last_seen) ? "Live" : "Offline"}</dd>
              </div>
              <div>
                <dt>Last seen</dt>
                <dd>{formatDateTime(hostDetailsTarget.data.last_seen)}</dd>
              </div>
              <div>
                <dt>Executor</dt>
                <dd>{typeof hostDetailsTarget.data.info?.executor === "string" ? hostDetailsTarget.data.info.executor : "-"}</dd>
              </div>
              <div>
                <dt>Worker version</dt>
                <dd>
                  {typeof hostDetailsTarget.data.info?.worker_version === "string"
                    ? hostDetailsTarget.data.info.worker_version
                    : "-"}
                </dd>
              </div>
              <div>
                <dt>Current job</dt>
                <dd>
                  {currentJobId ? (
                    <button
                      type="button"
                      className="host-job-pill"
                      onClick={() => openJobOrLogsFromHost(currentJobId)}
                      title={`Open ${resolveHostJobName(currentJobId, currentJobName)}`}
                    >
                      {resolveHostJobName(currentJobId, currentJobName)}
                    </button>
                  ) : (
                    "-"
                  )}
                </dd>
              </div>
              <div>
                <dt>Current status</dt>
                <dd>
                  {currentJobStatus && currentJobStatus !== "-" ? (
                    <StatusPill status={currentJobStatus} />
                  ) : (
                    "-"
                  )}
                </dd>
              </div>
              <div>
                <dt>Slots</dt>
                <dd className={capacitySummary.overCapacity ? "jobs-capacity-line is-over-capacity" : undefined}>
                  {capacitySummary.label}
                </dd>
              </div>
              <div>
                <dt>Last terminal job</dt>
                <dd>
                  {lastJobId ? (
                    <button
                      type="button"
                      className="btn-link jobs-config-link"
                      onClick={() => openJobOrLogsFromHost(lastJobId)}
                      title={resolveHostJobName(lastJobId)}
                    >
                      {resolveHostJobName(lastJobId)}
                    </button>
                  ) : (
                    "-"
                  )}
                </dd>
              </div>
              <div>
                <dt>Last terminal status</dt>
                <dd>{lastTerminalStatus}</dd>
              </div>
            </dl>

            {activeJobs.length > 0 ? (
              <section className="host-active-jobs-section">
                <h4>Active jobs</h4>
                <div className="host-active-jobs-list">
                  {activeJobs.map((entry) => {
                    const profile = inferComputeProfile(entry);
                    return (
                      <article key={entry.job_id} className="host-active-job-card">
                        <div className="host-active-job-head">
                          <button
                            type="button"
                            className="host-job-pill"
                            onClick={() => openJobOrLogsFromHost(entry.job_id)}
                            title={`Open ${resolveHostJobName(entry.job_id, entry.job_name)}`}
                          >
                            {resolveHostJobName(entry.job_id, entry.job_name)}
                          </button>
                          {typeof entry.status === "string" ? <StatusPill status={entry.status} /> : null}
                        </div>
                        <div className="host-active-job-meta">
                          {profile ? <small className="jobs-meta">Profile: {profile}</small> : null}
                          {typeof entry.phase === "string" && entry.phase ? (
                            <small className="jobs-meta">{entry.phase}</small>
                          ) : null}
                          {typeof entry.slurm_state === "string" && entry.slurm_state ? (
                            <small className="jobs-meta">Slurm: {entry.slurm_state}</small>
                          ) : null}
                          {typeof entry.slurm_partition === "string" && entry.slurm_partition ? (
                            <small className="jobs-meta">partition {entry.slurm_partition}</small>
                          ) : null}
                          {typeof entry.slurm_cpus === "number" ? (
                            <small className="jobs-meta">cpus {entry.slurm_cpus}</small>
                          ) : null}
                          {typeof entry.slurm_gpus === "number" && entry.slurm_gpus > 0 ? (
                            <small className="jobs-meta">gpus {entry.slurm_gpus}</small>
                          ) : null}
                          {typeof entry.queue_pos === "number" ? (
                            <small className="jobs-meta">queue #{entry.queue_pos}</small>
                          ) : null}
                          {typeof entry.ahead === "number" ? (
                            <small className="jobs-meta">ahead {entry.ahead}</small>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {Array.isArray(hostDetailsTarget.data.info?.budget?.accounts) &&
            hostDetailsTarget.data.info?.budget?.accounts.length ? (
              <section className="host-budget-table-wrap">
                <h4>Budget (Deucalion)</h4>
                <table className="table host-budget-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Used (h)</th>
                      <th>Limit (h)</th>
                      <th>Used (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hostDetailsTarget.data.info.budget.accounts.map((account) => {
                      const accountKind = inferBudgetAccountKind(account.account);
                      return (
                        <tr key={account.account}>
                          <td>
                            <div className="host-budget-account">
                              <span className={`host-budget-kind is-${accountKind.toLowerCase()}`}>{accountKind}</span>
                              <small className="host-budget-code">{account.account}</small>
                            </div>
                          </td>
                          <td>{account.used_hours}</td>
                          <td>{account.limit_hours}</td>
                          <td>{formatBudgetUsage(account.used_percent)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            ) : null}

            <section>
              <h4>Raw telemetry</h4>
              <pre className="json-view compact">{JSON.stringify(hostDetailsTarget.data.info || {}, null, 2)}</pre>
            </section>
          </section>
            );
          })()
        ) : null}
      </Modal>

      <Modal
        title={`Queue details: ${dispatchDetailsTarget?.job_id || "-"}`}
        open={Boolean(dispatchDetailsTarget)}
        onClose={() => setDispatchDetailsTarget(null)}
        width="md"
      >
        {dispatchDetailsTarget ? (
          (() => {
            const snapshot = readDispatchSnapshot(dispatchDetailsTarget);
            return (
              <section className="host-details-modal">
                <dl className="host-details-grid slurm-details-grid">
                  <div>
                    <dt>Job</dt>
                    <dd>{resolveJobDisplayName(dispatchDetailsTarget)}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <StatusPill status={dispatchDetailsTarget.status} />
                    </dd>
                  </div>
                  <div>
                    <dt>Slurm job ID</dt>
                    <dd>{snapshot.slurmJobId || "-"}</dd>
                  </div>
                  <div>
                    <dt>Slurm state</dt>
                    <dd>{snapshot.slurmState || "PENDING / not reported yet"}</dd>
                  </div>
                  <div>
                    <dt>Slurm reason</dt>
                    <dd>{snapshot.slurmReason || "-"}</dd>
                  </div>
                  <div>
                    <dt>Queue position</dt>
                    <dd>{typeof snapshot.slurmQueuePosition === "number" ? `#${snapshot.slurmQueuePosition}` : "-"}</dd>
                  </div>
                  <div>
                    <dt>Jobs ahead</dt>
                    <dd>{typeof snapshot.slurmJobsAhead === "number" ? snapshot.slurmJobsAhead : "-"}</dd>
                  </div>
                  <div>
                    <dt>Pending jobs (partition)</dt>
                    <dd>
                      {typeof snapshot.slurmPendingJobsInPartition === "number"
                        ? snapshot.slurmPendingJobsInPartition
                        : "-"}
                    </dd>
                  </div>
                  <div>
                    <dt>Partition</dt>
                    <dd>{snapshot.slurmPartition || "-"}</dd>
                  </div>
                  <div>
                    <dt>Priority</dt>
                    <dd>{typeof snapshot.slurmPriority === "number" ? snapshot.slurmPriority : "-"}</dd>
                  </div>
                  <div>
                    <dt>Slurm submit time</dt>
                    <dd>{snapshot.slurmSubmitTime ? formatDateTime(snapshot.slurmSubmitTime) : "-"}</dd>
                  </div>
                  <div>
                    <dt>Expected start</dt>
                    <dd>{snapshot.slurmStartTime ? formatDateTime(snapshot.slurmStartTime) : "-"}</dd>
                  </div>
                  <div>
                    <dt>Slurm elapsed</dt>
                    <dd>{snapshot.slurmElapsed || "-"}</dd>
                  </div>
                  <div>
                    <dt>Slurm time left</dt>
                    <dd>{snapshot.slurmTimeLeft || "-"}</dd>
                  </div>
                  <div>
                    <dt>Target host</dt>
                    <dd>{dispatchDetailsTarget.job_info.target_host || "-"}</dd>
                  </div>
                  <div>
                    <dt>Connectivity</dt>
                    <dd>{snapshot.connectivity || "ok"}</dd>
                  </div>
                  <div>
                    <dt>Queued at</dt>
                    <dd>{formatDateTime(dispatchDetailsTarget.queued_at || null)}</dd>
                  </div>
                  <div>
                    <dt>Dispatched at</dt>
                    <dd>{formatDateTime(dispatchDetailsTarget.dispatched_at || null)}</dd>
                  </div>
                  <div>
                    <dt>Last status update</dt>
                    <dd>{formatDateTime(dispatchDetailsTarget.last_status_at || null)}</dd>
                  </div>
                  <div>
                    <dt>Queue wait</dt>
                    <dd>
                      {typeof dispatchDetailsTarget.queue_wait_seconds === "number"
                        ? `${Math.round(dispatchDetailsTarget.queue_wait_seconds)}s`
                        : "-"}
                    </dd>
                  </div>
                  {snapshot.unknownSince ? (
                    <div>
                      <dt>Unknown since</dt>
                      <dd>{formatDateTime(snapshot.unknownSince)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Datasets copied</dt>
                    <dd>{snapshot.datasetsSynced.length}</dd>
                  </div>
                  <div>
                    <dt>Datasets reused</dt>
                    <dd>{snapshot.datasetsSkipped.length}</dd>
                  </div>
                </dl>
                <div className="jobs-command-group inline-end">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setLogsJobId(dispatchDetailsTarget.job_id);
                      setLogsSearch("");
                      setLogsOpen(true);
                    }}
                  >
                    Open logs
                  </Button>
                </div>
              </section>
            );
          })()
        ) : null}
      </Modal>

      <Modal
        title={`${configPreviewMode === "resolved" ? "Resolved Config" : "Experiment Config"} preview: ${configPreviewLabel || "-"}`}
        open={configPreviewOpen}
        onClose={() => {
          setConfigPreviewOpen(false);
          setConfigPreviewTarget("");
          setConfigPreviewLabel("");
          setConfigPreviewMode("base");
          setConfigPreviewJobId("");
        }}
        width="lg"
      >
        {configPreviewQuery.isLoading ? (
          <p className="jobs-meta">
            Loading {configPreviewMode === "resolved" ? "resolved config" : "experiment config"}...
          </p>
        ) : null}
        {configPreviewQuery.isError ? (
          <p className="error-text">
            Could not load this {configPreviewMode === "resolved" ? "resolved config" : "experiment config"} preview.
          </p>
        ) : null}
        {configPreviewQuery.data ? (
          <section className="job-config-preview-modal">
            <pre className="json-view">{configPreviewQuery.data}</pre>
          </section>
        ) : null}
        {!configPreviewQuery.isLoading && !configPreviewQuery.data ? (
          <p className="jobs-meta">
            No {configPreviewMode === "resolved" ? "resolved config" : "experiment config"} data available.
          </p>
        ) : null}
      </Modal>

      <Modal
        title={adminConfirm ? resolveAdminConfirmCopy(adminConfirm).title : "Confirm action"}
        open={Boolean(adminConfirm)}
        onClose={() => setAdminConfirm(null)}
        width="sm"
      >
        {adminConfirm ? (
          <div className="jobs-admin-confirm">
            <p>{resolveAdminConfirmCopy(adminConfirm).description}</p>
            <div className="jobs-command-group inline-end">
              <Button variant="primary" onClick={() => setAdminConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant={adminConfirm.action === "requeue" ? "secondary" : "danger"}
                onClick={() => {
                  executeAdminAction(adminConfirm);
                  setAdminConfirm(null);
                }}
              >
                {resolveAdminConfirmCopy(adminConfirm).confirmLabel}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteJobTarget)}
        title="Delete job"
        message={
          deleteJobTarget
            ? `Are you sure you want to delete "${deleteJobTarget}"?`
            : "Are you sure you want to delete this job?"
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        pending={deleteMutation.isPending}
        onCancel={() => setDeleteJobTarget(null)}
        onConfirm={() => {
          if (!deleteJobTarget) return;
          deleteMutation.mutate(deleteJobTarget, {
            onSettled: () => setDeleteJobTarget(null)
          });
        }}
      />
    </div>
  );
}
