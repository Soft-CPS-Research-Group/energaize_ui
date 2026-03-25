import { useMemo, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import {
  Pause,
  Play,
  RefreshCcw,
  Search,
  Server,
  Square,
  Trash2
} from "lucide-react";
import {
  deleteJob,
  getJobFileLogs,
  getJobInfo,
  getJobLogs,
  getJobProgress,
  getJobResult,
  getJobStatus,
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
  stopJob,
  type RunSimulationPayload
} from "../../api/trainingApi";
import { HOSTS_POLL_MS, JOB_POLL_MS } from "../../constants";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { StatusPill } from "../../components/ui/StatusPill";
import { useApiFeedback } from "../../hooks/useApiFeedback";
import { useJobStatusNotifications } from "../../hooks/useJobStatusNotifications";
import type { JobItem } from "../../types";
import { formatDateTime } from "../../utils/time";

interface RunForm {
  mode: "saved" | "inline";
  configPath: string;
  experimentName: string;
  runName: string;
  targetHost: string;
  saveAs: string;
}

const defaultRunForm: RunForm = {
  mode: "saved",
  configPath: "",
  experimentName: "Solar Forecast",
  runName: "nightly_run",
  targetHost: "",
  saveAs: ""
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
        updatedAt: (data.updated_at || data.timestamp || data.last_update || null) as string | number | null
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

function hasAnyStatus(status: string, values: string[]): boolean {
  const key = status.toLowerCase();
  return values.some((item) => key.includes(item));
}

function canStopJob(status: string): boolean {
  return (
    hasAnyStatus(status, ["running", "queue", "pending", "launch", "dispatch", "start"]) &&
    !hasAnyStatus(status, ["failed", "cancel", "finished", "complete", "stopped"])
  );
}

function canRequeueJob(status: string): boolean {
  return hasAnyStatus(status, ["failed", "cancel", "finished", "complete", "stopped", "not_found"]);
}

function resolveExperiment(job: JobItem): string {
  return (
    job.job_info.experiment_name ||
    job.job_info.job_name ||
    job.job_info.run_name ||
    job.job_id
  );
}

function asDateField(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

export function JobsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { notifyError, notifyInfo, notifySuccess } = useApiFeedback();

  const [runOpen, setRunOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [hostFilter, setHostFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [runForm, setRunForm] = useState<RunForm>(defaultRunForm);

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

  const jobInfoQuery = useQuery({
    queryKey: ["job-info", selectedJobId],
    queryFn: () => getJobInfo(selectedJobId),
    enabled: Boolean(selectedJobId && detailsOpen)
  });

  const jobStatusQuery = useQuery({
    queryKey: ["job-status", selectedJobId],
    queryFn: () => getJobStatus(selectedJobId),
    enabled: Boolean(selectedJobId && detailsOpen)
  });

  const progressQuery = useQuery({
    queryKey: ["job-progress", selectedJobId],
    queryFn: () => getJobProgress(selectedJobId),
    enabled: Boolean(selectedJobId && detailsOpen)
  });

  const resultQuery = useQuery({
    queryKey: ["job-result", selectedJobId],
    queryFn: () => getJobResult(selectedJobId),
    enabled: Boolean(selectedJobId && detailsOpen)
  });

  const logsQuery = useQuery({
    queryKey: ["job-logs", selectedJobId],
    queryFn: async () => {
      try {
        return await getJobFileLogs(selectedJobId);
      } catch {
        return getJobLogs(selectedJobId);
      }
    },
    enabled: Boolean(selectedJobId && detailsOpen)
  });

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

  const stopMutation = useMutation({
    mutationFn: (jobId: string) => stopJob(jobId),
    onSuccess: () => {
      notifyInfo("Stop requested", "Worker will stop the selected job.");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => notifyError("Failed to stop job", error)
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

  const queuePositions = useMemo(() => {
    const map = new Map<string, number>();
    (queueQuery.data || []).forEach((item, index) => map.set(item.job_id, index + 1));
    return map;
  }, [queueQuery.data]);

  const availableHosts = hostsQuery.data?.available_hosts || [];
  const hostRows = useMemo(() => {
    return Object.entries(hostsQuery.data?.hosts || {}).map(([name, data]) => ({ name, ...data }));
  }, [hostsQuery.data?.hosts]);

  const latestProgressEpoch = useMemo(() => {
    const values = Array.from(progressMap.values()).map((item) => item.updatedAt);
    return maxEpoch(values);
  }, [progressMap]);

  const latestHostEpoch = useMemo(() => {
    return maxEpoch(hostRows.map((host) => host.last_seen));
  }, [hostRows]);

  const latestUpdateEpoch = latestProgressEpoch || latestHostEpoch || jobsQuery.dataUpdatedAt || null;
  const globalLastUpdated = latestUpdateEpoch ? formatDateTime(latestUpdateEpoch) : "-";
  const isLiveWindow = latestUpdateEpoch ? isRecentTimestamp(latestUpdateEpoch, 5 * 60 * 1000) : false;

  return (
    <div className="page jobs-page">
      <header className="jobs-hero">
        <div>
          <span className="section-kicker">Training Operations</span>
          <h1>Jobs</h1>
          <p>Run simulations, monitor state changes, and control execution lifecycle.</p>
        </div>
        <div className="jobs-hero-meta">
          <span className={`live-pill${isLiveWindow ? " is-live" : ""}`}>{isLiveWindow ? "Live" : "Delayed"}</span>
          <small>Last update: {globalLastUpdated}</small>
          {!isLiveWindow ? (
            <small className="jobs-live-reminder">No recent updates. Check VPN/backend connectivity.</small>
          ) : null}
        </div>
      </header>

      <section className="jobs-surface">
        <section className="jobs-main">
          <div className="jobs-command-bar">
            <div className="jobs-command-group">
              <Button variant="primary" iconLeft={<Play size={14} />} onClick={() => setRunOpen(true)}>
                Run New Simulation
              </Button>
              <Button
                variant="secondary"
                iconLeft={<RefreshCcw size={14} />}
                onClick={() => {
                  jobsQuery.refetch();
                  queueQuery.refetch();
                  hostsQuery.refetch();
                  configsQuery.refetch();
                }}
              >
                Refresh
              </Button>
            </div>

            <div className="jobs-command-group">
              <label className="search-inline jobs-search">
                <Search size={14} />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search jobs..."
                />
              </label>
              <div className="jobs-query-count">{filteredJobs.length} jobs</div>
            </div>
          </div>

          <div className="jobs-filter-row">
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
              {availableHosts.map((host) => (
                <option key={host} value={host}>
                  {host}
                </option>
              ))}
            </select>
          </div>

          {filteredJobs.length === 0 ? (
            <EmptyState
              title="No jobs found"
              message="Create a simulation or adjust filters."
              action={
                <Button variant="primary" onClick={() => setRunOpen(true)}>
                  Run Simulation
                </Button>
              }
            />
          ) : (
            <div className="jobs-table-wrap">
              <table className="table jobs-table">
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Experiment</th>
                    <th>Progress</th>
                    <th>Status / Queue</th>
                    <th>Host</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => {
                    const selected = selectedJobId === job.job_id;
                    const queuePosition = queuePositions.get(job.job_id);
                    const progressInfo = progressMap.get(job.job_id);
                    const progress = progressInfo?.percent ?? null;
                    const canStop = canStopJob(job.status);
                    const canRequeue = canRequeueJob(job.status);
                    const jobUpdatedAt =
                      progressInfo?.updatedAt ||
                      asDateField(job.job_info.updated_at) ||
                      asDateField(job.job_info.last_update) ||
                      jobsQuery.dataUpdatedAt;

                    return (
                      <tr
                        key={job.job_id}
                        className={`jobs-row${selected ? " is-selected" : ""}`}
                        onClick={() => setSelectedJobId(job.job_id)}
                      >
                        <td>
                          <div className="jobs-id-cell">
                            <strong>{job.job_id}</strong>
                            <small>{job.job_info.job_name || "-"}</small>
                          </div>
                        </td>
                        <td>
                          <div className="jobs-experiment-cell">
                            <strong>{resolveExperiment(job)}</strong>
                            <small>{job.job_info.config_path || "inline config"}</small>
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
                            <small>{queuePosition ? `Queue #${queuePosition}` : "Not queued"}</small>
                          </div>
                        </td>
                        <td>{job.job_info.target_host || "-"}</td>
                        <td>{formatDateTime(jobUpdatedAt)}</td>
                        <td>
                          <div className="table-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedJobId(job.job_id);
                                setDetailsOpen(true);
                              }}
                            >
                              Details
                            </Button>
                            {canStop ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                iconLeft={<Pause size={13} />}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  stopMutation.mutate(job.job_id);
                                }}
                              >
                                Stop
                              </Button>
                            ) : null}
                            {canRequeue ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                iconLeft={<Play size={13} />}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  opsMutation.mutate({ type: "requeue", jobId: job.job_id });
                                }}
                              >
                                Requeue
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="danger"
                              iconLeft={<Trash2 size={13} />}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (window.confirm(`Delete job ${job.job_id}?`)) {
                                  deleteMutation.mutate(job.job_id);
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <section className="jobs-admin-row">
            <Button
              variant="primary"
              disabled={!selectedJobId}
              onClick={() => {
                if (!selectedJobId) return;
                if (window.confirm(`Requeue ${selectedJobId}?`)) {
                  opsMutation.mutate({ type: "requeue", jobId: selectedJobId });
                }
              }}
            >
              Requeue Job
            </Button>
            <Button
              variant="secondary"
              disabled={!selectedJobId}
              iconLeft={<Square size={13} />}
              onClick={() => {
                if (!selectedJobId) return;
                if (window.confirm(`Cancel ${selectedJobId}?`)) {
                  opsMutation.mutate({ type: "cancel", jobId: selectedJobId });
                }
              }}
            >
              Cancel Job
            </Button>
            <Button
              variant="secondary"
              disabled={!selectedJobId}
              onClick={() => {
                if (!selectedJobId) return;
                if (window.confirm(`Mark ${selectedJobId} as failed?`)) {
                  opsMutation.mutate({ type: "fail", jobId: selectedJobId });
                }
              }}
            >
              Mark Failed
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm("Cleanup queue entries?")) {
                  cleanupQueueMutation.mutate();
                }
              }}
            >
              Cleanup Queue
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm("Cleanup jobs registry?")) {
                  cleanupJobsMutation.mutate();
                }
              }}
            >
              Cleanup Jobs
            </Button>
          </section>
        </section>

        <aside className="jobs-sidebar">
          <article className="jobs-side-panel">
            <header>
              <h2>Available Hosts</h2>
              <small>Live heartbeat</small>
            </header>
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

      <Modal title="Run new simulation" open={runOpen} onClose={() => setRunOpen(false)} width="md">
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();

            const payload: RunSimulationPayload = {
              target_host: runForm.targetHost || undefined
            };

            if (runForm.mode === "saved") {
              if (!runForm.configPath) {
                notifyError("Missing config", new Error("Select a saved config first."));
                return;
              }
              payload.config_path = runForm.configPath;
            } else {
              payload.config = {
                metadata: {
                  experiment_name: runForm.experimentName,
                  run_name: runForm.runName
                }
              };
              payload.save_as = runForm.saveAs || undefined;
            }

            runMutation.mutate(payload);
          }}
        >
          <div className="full-col run-mode-switch">
            <button
              type="button"
              className={`mode-chip${runForm.mode === "saved" ? " is-active" : ""}`}
              onClick={() => setRunForm((prev) => ({ ...prev, mode: "saved" }))}
            >
              Use saved config
            </button>
            <button
              type="button"
              className={`mode-chip${runForm.mode === "inline" ? " is-active" : ""}`}
              onClick={() => setRunForm((prev) => ({ ...prev, mode: "inline" }))}
            >
              Inline config
            </button>
          </div>

          {runForm.mode === "saved" ? (
            <label className="full-col">
              <span>Saved config</span>
              <select
                value={runForm.configPath}
                onChange={(event) => setRunForm((prev) => ({ ...prev, configPath: event.target.value }))}
              >
                <option value="">Select config...</option>
                {(configsQuery.data || []).map((config) => (
                  <option key={config} value={config}>
                    {config}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                <span>Experiment name</span>
                <input
                  value={runForm.experimentName}
                  onChange={(event) =>
                    setRunForm((prev) => ({ ...prev, experimentName: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                <span>Run name</span>
                <input
                  value={runForm.runName}
                  onChange={(event) => setRunForm((prev) => ({ ...prev, runName: event.target.value }))}
                  required
                />
              </label>
            </>
          )}

          <label>
            <span>Target host</span>
            <select
              value={runForm.targetHost}
              onChange={(event) => setRunForm((prev) => ({ ...prev, targetHost: event.target.value }))}
            >
              <option value="">Automatic</option>
              {availableHosts.map((host) => (
                <option key={host} value={host}>
                  {host}
                </option>
              ))}
            </select>
          </label>

          {runForm.mode === "inline" ? (
            <label>
              <span>Save as (optional)</span>
              <input
                placeholder="custom-config.yaml"
                value={runForm.saveAs}
                onChange={(event) => setRunForm((prev) => ({ ...prev, saveAs: event.target.value }))}
              />
            </label>
          ) : null}

          <div className="full-col inline-end">
            <Button type="submit" variant="primary" disabled={runMutation.isPending}>
              {runMutation.isPending ? "Submitting..." : "Run simulation"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal title={`Job details: ${selectedJobId || "-"}`} open={detailsOpen} onClose={() => setDetailsOpen(false)} width="lg">
        <section className="details-grid">
          <article>
            <h4>Status</h4>
            <pre className="json-view">{JSON.stringify(jobStatusQuery.data || {}, null, 2)}</pre>
          </article>
          <article>
            <h4>Job Info</h4>
            <pre className="json-view">{JSON.stringify(jobInfoQuery.data || {}, null, 2)}</pre>
          </article>
          <article>
            <h4>Progress</h4>
            <pre className="json-view">{JSON.stringify(progressQuery.data || {}, null, 2)}</pre>
          </article>
          <article>
            <h4>Result</h4>
            <pre className="json-view">{JSON.stringify(resultQuery.data || {}, null, 2)}</pre>
          </article>
          <article className="full-col">
            <h4>Logs</h4>
            <pre className="json-view">{logsQuery.data || "No logs yet."}</pre>
          </article>
        </section>
      </Modal>
    </div>
  );
}
