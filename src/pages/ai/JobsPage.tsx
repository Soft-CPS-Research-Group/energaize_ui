import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import {
  Copy,
  Download,
  Eye,
  FileText,
  Play,
  RefreshCcw,
  Search,
  Server,
  Square,
  Trash2
} from "lucide-react";
import {
  deleteJob,
  getExperimentConfig,
  getJobFileLogs,
  getJobLogs,
  getJobProgress,
  listExperimentConfigs,
  listHosts,
  listJobs,
  listQueue,
  opsCancelJob,
  opsCleanupJobs,
  opsCleanupQueue,
  opsFailJob,
  opsRequeueJob,
  runSimulation,
  type RunSimulationPayload
} from "../../api/trainingApi";
import { HOSTS_POLL_MS, JOB_POLL_MS } from "../../constants";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { StatusPill } from "../../components/ui/StatusPill";
import { useApiFeedback } from "../../hooks/useApiFeedback";
import { useJobStatusNotifications } from "../../hooks/useJobStatusNotifications";
import type { JobItem } from "../../types";
import { isCompletedForResults } from "../../utils/jobStatus";
import { buildJobsListStateFromSearchParams, toJobsListSearchParams } from "../../utils/jobsListState";
import { formatDateTime } from "../../utils/time";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

interface RunForm {
  configPath: string;
  targetHost: string;
}

type AdminActionType = "requeue" | "cancel" | "fail" | "cleanup_queue" | "cleanup_jobs";

interface AdminConfirmState {
  action: AdminActionType;
  jobId?: string;
}

const defaultRunForm: RunForm = {
  configPath: "",
  targetHost: ""
};

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

function extractProgressInfo(payload: unknown): { percent: number | null; updatedAt: string | number | null } {
  if (!payload || typeof payload !== "object") {
    return { percent: null, updatedAt: null };
  }

  const data = payload as Record<string, unknown>;
  const candidateKeys = ["percent", "progress", "progress_pct", "progress_percent", "completion"];
  for (const key of candidateKeys) {
    const value = asNumber(data[key]);
    if (value !== null) {
      return {
        percent: toPercent(value),
        updatedAt: (data.updated_at || data.timestamp || data.last_update || null) as
          | string
          | number
          | null
      };
    }
  }

  if (typeof data.progress === "object" && data.progress) {
    const nested = data.progress as Record<string, unknown>;
    const nestedPercent = asNumber(nested.percent) ?? asNumber(nested.value) ?? asNumber(nested.progress);
    if (nestedPercent !== null) {
      return {
        percent: toPercent(nestedPercent),
        updatedAt: (nested.updated_at || nested.timestamp || null) as string | number | null
      };
    }
  }

  return {
    percent: null,
    updatedAt: (data.updated_at || data.timestamp || data.last_update || null) as string | number | null
  };
}

function resolveJobDisplayName(job: JobItem): string {
  return job.job_info.job_name || job.job_info.run_name || "Unnamed job";
}

function resolveConfigName(configPath: string | undefined): string {
  if (!configPath) return "No experiment config";
  const normalized = configPath.split(/[\\/]/).filter(Boolean);
  return normalized[normalized.length - 1] || configPath;
}

function hasAnyStatus(status: string, tokens: string[]): boolean {
  const key = status.toLowerCase();
  return tokens.some((token) => key.includes(token));
}

function canCancelStatus(status: string): boolean {
  return (
    hasAnyStatus(status, ["running", "queue", "pending", "launch", "dispatch", "start", "progress"]) &&
    !hasAnyStatus(status, ["cancel", "fail", "error", "finish", "complete", "done", "stopp"])
  );
}

function canRequeueStatus(status: string): boolean {
  return !hasAnyStatus(status, ["running", "queue", "pending", "launch", "dispatch"]);
}

function canFailStatus(status: string): boolean {
  return !hasAnyStatus(status, ["fail", "error", "cancel", "finish", "complete", "done", "stopp"]);
}

export function JobsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialState = buildJobsListStateFromSearchParams(searchParams);
  const { notifyError, notifyInfo, notifySuccess } = useApiFeedback();

  const [runOpen, setRunOpen] = useState(false);
  const [configPickerOpen, setConfigPickerOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [compareMode, setCompareMode] = useState(false);
  const [refreshingVisual, setRefreshingVisual] = useState(false);
  const [statusFilter, setStatusFilter] = useState(initialState.status);
  const [hostFilter, setHostFilter] = useState(initialState.host);
  const [searchQuery, setSearchQuery] = useState(initialState.q);
  const [runForm, setRunForm] = useState<RunForm>(defaultRunForm);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsJobId, setLogsJobId] = useState("");
  const [configPreviewOpen, setConfigPreviewOpen] = useState(false);
  const [configPreviewTarget, setConfigPreviewTarget] = useState("");
  const [configPreviewLabel, setConfigPreviewLabel] = useState("");
  const [adminConfirm, setAdminConfirm] = useState<AdminConfirmState | null>(null);
  const [deleteJobTarget, setDeleteJobTarget] = useState<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: ["jobs"],
    queryFn: listJobs,
    refetchInterval: JOB_POLL_MS
  });

  const hostsQuery = useQuery({
    queryKey: ["hosts"],
    queryFn: listHosts,
    refetchInterval: HOSTS_POLL_MS
  });

  const queueQuery = useQuery({
    queryKey: ["queue"],
    queryFn: listQueue,
    refetchInterval: JOB_POLL_MS
  });

  const configsQuery = useQuery({
    queryKey: ["configs"],
    queryFn: listExperimentConfigs
  });

  const logsQuery = useQuery({
    queryKey: ["job-quick-logs", logsJobId],
    queryFn: async () => {
      try {
        return await getJobFileLogs(logsJobId);
      } catch {
        return getJobLogs(logsJobId).catch(() => "");
      }
    },
    enabled: Boolean(logsOpen && logsJobId)
  });

  const configPreviewQuery = useQuery({
    queryKey: ["job-config-preview", configPreviewTarget],
    queryFn: async () => {
      const payload = await getExperimentConfig(configPreviewTarget);
      return payload.config;
    },
    enabled: Boolean(configPreviewOpen && configPreviewTarget)
  });

  useEffect(() => {
    const nextParams = toJobsListSearchParams({ q: searchQuery, status: statusFilter, host: hostFilter });
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [hostFilter, searchParams, searchQuery, setSearchParams, statusFilter]);

  useJobStatusNotifications(jobsQuery.data);

  const progressQueries = useQueries({
    queries: (jobsQuery.data || []).map((job) => ({
      queryKey: ["job-progress-inline", job.job_id],
      queryFn: () => getJobProgress(job.job_id),
      refetchInterval: JOB_POLL_MS
    }))
  });

  const progressMap = useMemo(() => {
    const map = new Map<string, { percent: number | null; updatedAt: string | number | null }>();
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
      setRunForm(defaultRunForm);
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
    mutationFn: async (payload: { type: "requeue" | "cancel" | "fail"; jobId: string }) => {
      if (payload.type === "requeue") {
        return opsRequeueJob({ job_id: payload.jobId, force: false });
      }
      if (payload.type === "cancel") {
        return opsCancelJob({ job_id: payload.jobId, reason: "ops_cancel", force: false });
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
      if (!query) return true;

      const haystack = [
        job.job_id,
        job.job_info.experiment_name || "",
        job.job_info.job_name || "",
        job.job_info.run_name || "",
        job.job_info.target_host || "",
        job.job_info.config_path || "",
        job.status
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [hostFilter, jobsQuery.data, searchQuery, statusFilter]);

  const availableHosts = hostsQuery.data?.available_hosts || [];
  const availableConfigs = configsQuery.data || [];
  const filteredConfigOptions = useMemo(() => {
    const query = runForm.configPath.trim().toLowerCase();
    if (!query) return availableConfigs;
    return availableConfigs.filter((config) => config.toLowerCase().includes(query));
  }, [availableConfigs, runForm.configPath]);

  const selectedJob = useMemo(() => {
    return (jobsQuery.data || []).find((job) => job.job_id === selectedJobId) || null;
  }, [jobsQuery.data, selectedJobId]);

  const canRequeueSelected = selectedJob ? canRequeueStatus(selectedJob.status) : false;
  const canCancelSelected = selectedJob ? canCancelStatus(selectedJob.status) : false;
  const canFailSelected = selectedJob ? canFailStatus(selectedJob.status) : false;
  const canCleanupQueue = (queueQuery.data?.length || 0) > 0;
  const canCleanupJobs = (jobsQuery.data?.length || 0) > 0;

  const hostRows = useMemo(() => {
    return Object.entries(hostsQuery.data?.hosts || {}).map(([name, data]) => ({ name, ...data }));
  }, [hostsQuery.data?.hosts]);
  const hostOptions = useMemo(() => {
    const map = new Map<string, { name: string; online: boolean | null; lastSeen: number | null }>();
    availableHosts.forEach((name) => {
      map.set(name, { name, online: true, lastSeen: null });
    });
    hostRows.forEach((host) => {
      map.set(host.name, {
        name: host.name,
        online: typeof host.online === "boolean" ? host.online : null,
        lastSeen: typeof host.last_seen === "number" ? host.last_seen : null
      });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [availableHosts, hostRows]);
  useEffect(() => {
    const eligible = new Set((jobsQuery.data || []).filter((job) => isCompletedForResults(job.status)).map((job) => job.job_id));

    setCompareSelection((previous) => previous.filter((jobId) => eligible.has(jobId)).slice(0, 2));

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
    setRunForm((previous) => ({ ...previous, configPath: previous.configPath.trim() }));
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

      if (previous.length >= 2) {
        notifyInfo("Comparison limit", "Select only two completed jobs.");
        return previous;
      }

      return [...previous, jobId];
    });
  }

  function openJobDetails(jobId: string): void {
    const params = new URLSearchParams();
    if (location.search) {
      params.set("from", location.search);
    }

    navigate(`/app/ai/jobs/${encodeURIComponent(jobId)}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  function openConfigPreview(configPath: string): void {
    const normalized = configPath.split(/[\\/]/).filter(Boolean);
    const baseName = normalized[normalized.length - 1] || configPath;
    const resolvedName = availableConfigs.find((item) => item === configPath || item === baseName) || baseName;
    setConfigPreviewLabel(resolveConfigName(configPath));
    setConfigPreviewTarget(resolvedName);
    setConfigPreviewOpen(true);
  }

  function openComparePage(): void {
    if (compareSelection.length !== 2) return;

    const [left, right] = compareSelection;
    const params = new URLSearchParams({ left, right });
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
        jobsQuery.refetch(),
        queueQuery.refetch(),
        hostsQuery.refetch(),
        configsQuery.refetch(),
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
    if (!logsQuery.data) return;

    try {
      await navigator.clipboard.writeText(logsQuery.data);
      notifySuccess("Logs copied", "Job logs copied to clipboard.");
    } catch (error) {
      notifyError("Failed to copy logs", error);
    }
  }

  function downloadLogs(): void {
    if (!logsQuery.data || !logsJobId) return;

    const blob = new Blob([logsQuery.data], { type: "text/plain;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${logsJobId}.log`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

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
                onClick={() => {
                  setRunForm(defaultRunForm);
                  setConfigPickerOpen(false);
                  setRunOpen(true);
                }}
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
                    {host.name}
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
                  onClick={() => {
                    setRunForm(defaultRunForm);
                    setConfigPickerOpen(false);
                    setRunOpen(true);
                  }}
                >
                  Run Simulation
                </Button>
              }
            />
          ) : (
            <div className="jobs-table-wrap">
              <table className="table jobs-table">
                <thead>
                  <tr>
                    {compareMode ? <th>Compare</th> : null}
                    <th>Job</th>
                    <th>Experiment Config</th>
                    <th>Progress</th>
                    <th>Status</th>
                    <th>Host</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => {
                    const selected = selectedJobId === job.job_id;
                    const progressInfo = progressMap.get(job.job_id);
                    const progress = progressInfo?.percent ?? null;
                    const isCompleted = isCompletedForResults(job.status);
                    const isChecked = compareSelection.includes(job.job_id);
                    const checkboxDisabled = !isCompleted || (!isChecked && compareSelection.length >= 2);

                    return (
                      <tr
                        key={job.job_id}
                        className={`jobs-row${selected ? " is-selected" : ""}`}
                        onClick={() => setSelectedJobId(job.job_id)}
                      >
                        {compareMode ? (
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${job.job_id} for comparison`}
                              checked={isChecked}
                              disabled={checkboxDisabled}
                              title={
                                !isCompleted
                                  ? "Comparison available only for completed jobs"
                                  : checkboxDisabled
                                    ? "Only two jobs can be selected"
                                    : "Select for KPI comparison"
                              }
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleCompareSelection(job.job_id)}
                            />
                          </td>
                        ) : null}
                        <td>
                          <div className="jobs-id-cell">
                            <strong>{resolveJobDisplayName(job)}</strong>
                            <small>{job.job_id}</small>
                          </div>
                        </td>
                        <td>
                          <div className="jobs-config-cell">
                            <strong>
                              {job.job_info.config_path ? (
                                <button
                                  type="button"
                                  className="btn-link jobs-config-link"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openConfigPreview(job.job_info.config_path || "");
                                  }}
                                  title="Preview experiment config"
                                >
                                  {resolveConfigName(job.job_info.config_path)}
                                </button>
                              ) : (
                                resolveConfigName(job.job_info.config_path)
                              )}
                            </strong>
                          </div>
                        </td>
                        <td>
                          <div className="jobs-progress-cell">
                            <strong>{progress !== null ? `${Math.round(progress)}%` : "-"}</strong>
                            <div className="progress-track">
                              <div className="progress-fill" style={{ width: `${progress ?? 0}%` }} />
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="jobs-status-cell">
                            <StatusPill status={job.status} />
                          </div>
                        </td>
                        <td>{job.job_info.target_host || "-"}</td>
                        <td>
                          <div className="table-actions table-actions-compact">
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
                                setLogsOpen(true);
                              }}
                            >
                              <FileText size={15} />
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
              <strong>{compareSelection.length}/2 selected for KPI compare</strong>
              <div className="jobs-command-group">
                <Button variant="ghost" onClick={() => setCompareSelection([])} disabled={compareSelection.length === 0}>
                  Clear selection
                </Button>
                <Button
                  variant="primary"
                  disabled={compareSelection.length !== 2}
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
              disabled={!selectedJobId || !canCancelSelected}
              title={!selectedJobId ? "Select a job first" : !canCancelSelected ? "Cancel not available for this status" : "Cancel selected job"}
              iconLeft={<Square size={13} />}
              onClick={() => {
                if (!selectedJobId || !canCancelSelected) return;
                setAdminConfirm({ action: "cancel", jobId: selectedJobId });
              }}
            >
              Cancel Job
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
              disabled={!canCleanupQueue}
              onClick={() => {
                if (!canCleanupQueue) return;
                setAdminConfirm({ action: "cleanup_queue" });
              }}
            >
              Cleanup Queue
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
              <small className="jobs-live-reminder">No recent host heartbeat. Check VPN/backend connectivity.</small>
            ) : null}
            <ul className="jobs-host-list">
              {hostRows.length > 0 ? (
                hostRows.map((host) => {
                  const isLive = isRecentTimestamp(host.last_seen);
                  return (
                    <li key={host.name}>
                      <div className="jobs-host-line">
                        <Server size={14} />
                        <span className={`host-live-dot${isLive ? " is-online" : ""}`} />
                        <strong>{host.name}</strong>
                        <small>{isLive ? "Live" : "Offline"}</small>
                      </div>
                      <small className="jobs-meta">Last seen: {formatDateTime(host.last_seen)}</small>
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
            <header>
              <h2>Queue</h2>
            </header>
            <ul className="jobs-queue-list">
              {(queueQuery.data || []).slice(0, 8).map((entry, index) => (
                <li key={entry.job_id}>
                  <span>{index + 1}</span>
                  <strong>{entry.job_id}</strong>
                  <small>{entry.preferred_host || "Any host"}</small>
                </li>
              ))}
              {queueQuery.data && queueQuery.data.length === 0 ? (
                <li>
                  <small className="jobs-meta">Queue is empty.</small>
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
          setConfigPickerOpen(false);
        }}
        width="md"
      >
        <form
          className="form-grid run-modal-form"
          onSubmit={(event) => {
            event.preventDefault();

            const configPath = runForm.configPath.trim();
            if (!configPath) {
              notifyError("Missing experiment config", new Error("Select a saved experiment config first."));
              return;
            }
            if (!availableConfigs.includes(configPath)) {
              notifyError(
                "Unknown experiment config",
                new Error("Choose one existing experiment config or create a new one.")
              );
              return;
            }

            const payload: RunSimulationPayload = {
              target_host: runForm.targetHost || undefined,
              config_path: configPath
            };

            runMutation.mutate(payload);
          }}
        >
          <section className="full-col run-modal-shell">
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
          </section>

          <section className="full-col run-host-section">
            <span>Target host</span>
            <div className="run-host-grid">
              <button
                type="button"
                className={`run-host-option is-auto${runForm.targetHost === "" ? " is-selected" : ""}`}
                onClick={() => setRunForm((prev) => ({ ...prev, targetHost: "" }))}
              >
                <span className="run-host-dot is-online" />
                <strong>Automatic</strong>
                <small>Use scheduler routing</small>
              </button>
              {hostOptions.map((host) => (
                <button
                  type="button"
                  key={host.name}
                  className={`run-host-option${runForm.targetHost === host.name ? " is-selected" : ""}`}
                  onClick={() => setRunForm((prev) => ({ ...prev, targetHost: host.name }))}
                >
                  <span className={`run-host-dot${host.online === true ? " is-online" : ""}`} />
                  <strong>{host.name}</strong>
                  <small>{host.online === true ? "Online" : "Offline"}</small>
                </button>
              ))}
              {!hostOptions.length ? (
                <p className="jobs-meta">No host telemetry available.</p>
              ) : null}
            </div>
          </section>

          <div className="full-col inline-end">
            <Button type="submit" variant="primary" disabled={runMutation.isPending}>
              {runMutation.isPending ? "Submitting..." : "Run simulation"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        title={`Logs: ${logsJobId || "-"}`}
        open={logsOpen}
        onClose={() => {
          setLogsOpen(false);
          setLogsJobId("");
        }}
        width="lg"
      >
        <section className="job-logs-modal-content">
          <div className="job-logs-modal-actions">
            <Button variant="ghost" iconLeft={<Copy size={13} />} onClick={copyLogs} disabled={!logsQuery.data}>
              Copy
            </Button>
            <Button
              variant="ghost"
              iconLeft={<Download size={13} />}
              onClick={downloadLogs}
              disabled={!logsQuery.data}
            >
              Download
            </Button>
          </div>

          {logsQuery.isLoading ? <p className="jobs-meta">Loading logs...</p> : null}
          {logsQuery.isError ? <p className="error-text">Could not load logs for this job.</p> : null}
          {logsQuery.data ? <pre className="json-view compact">{logsQuery.data}</pre> : null}
          {!logsQuery.isLoading && !logsQuery.data ? <p className="jobs-meta">No logs available yet.</p> : null}
        </section>
      </Modal>

      <Modal
        title={`Experiment Config preview: ${configPreviewLabel || "-"}`}
        open={configPreviewOpen}
        onClose={() => {
          setConfigPreviewOpen(false);
          setConfigPreviewTarget("");
          setConfigPreviewLabel("");
        }}
        width="lg"
      >
        {configPreviewQuery.isLoading ? <p className="jobs-meta">Loading experiment config...</p> : null}
        {configPreviewQuery.isError ? (
          <p className="error-text">Could not load this experiment config preview.</p>
        ) : null}
        {configPreviewQuery.data ? (
          <section className="job-config-preview-modal">
            <pre className="json-view">{JSON.stringify(configPreviewQuery.data, null, 2)}</pre>
          </section>
        ) : null}
        {!configPreviewQuery.isLoading && !configPreviewQuery.data ? (
          <p className="jobs-meta">No experiment config data available.</p>
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
