import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileWarning, Search } from "lucide-react";
import { listJobs, listJobsInitialData } from "../api/trainingApi";
import { EVChargingLoader } from "../components/ui/EVChargingLoader";
import { useApiFeedback } from "../hooks/useApiFeedback";
import { useJobLogsPolling } from "../hooks/useJobLogsPolling";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { JOB_POLL_MS, LOGS_POLL_MS } from "../constants";

export function LogsPage(): JSX.Element {
  const { notifyError } = useApiFeedback();
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [search, setSearch] = useState("");

  const jobsQuery = useQuery({
    queryKey: ["jobs", "for-logs"],
    queryFn: listJobs,
    initialData: listJobsInitialData,
    refetchInterval: JOB_POLL_MS
  });

  useEffect(() => {
    if (!selectedJobId && jobsQuery.data && jobsQuery.data.length > 0) {
      setSelectedJobId(jobsQuery.data[0].job_id);
    }
  }, [jobsQuery.data, selectedJobId]);

  const logsQuery = useJobLogsPolling(selectedJobId, {
    enabled: Boolean(selectedJobId),
    pollMs: LOGS_POLL_MS,
    tailLines: 300
  });

  useEffect(() => {
    if (jobsQuery.error) {
      notifyError("Could not load jobs", jobsQuery.error);
    }
  }, [jobsQuery.error, notifyError]);

  useEffect(() => {
    if (logsQuery.error) {
      notifyError("Could not load logs", logsQuery.error);
    }
  }, [logsQuery.error, notifyError]);

  const filteredLines = useMemo(() => {
    const text = logsQuery.text || "";
    const lines = text.split("\n").filter(Boolean);
    if (!search) return lines;
    return lines.filter((line) => line.toLowerCase().includes(search.toLowerCase()));
  }, [logsQuery.text, search]);
  const hasLogContent = logsQuery.text.trim().length > 0;

  return (
    <div className="page logs-page">
      <PageHeader title="System Logs" subtitle="Technical traces by job." />

      <section className="toolbar">
        <select value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)}>
          {jobsQuery.data?.map((job) => (
            <option key={job.job_id} value={job.job_id}>
              {job.job_id} - {job.status}
            </option>
          ))}
        </select>

        <label className="search-inline">
          <Search size={14} />
          <input
            placeholder="Search logs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </section>

      {!selectedJobId ? (
        <EmptyState
          title="No jobs available"
          message="Launch a simulation first to inspect logs."
          action={<FileWarning size={18} />}
        />
      ) : (
        <section className="panel log-stream" role="log" aria-live="polite">
          {(logsQuery.loading || (logsQuery.fetching && !hasLogContent)) ? (
            <section className="datasets-loader-preview">
              <EVChargingLoader label="Loading logs..." />
            </section>
          ) : null}
          {!logsQuery.loading && hasLogContent && filteredLines.length === 0 ? (
            <p>No log lines for current filter.</p>
          ) : null}
          {!logsQuery.loading && !hasLogContent ? (
            <p>{logsQuery.message || "Ainda não há logs para este job (ou o ficheiro está vazio)."}</p>
          ) : null}
          {filteredLines.map((line, index) => (
            <code key={`${index}-${line.slice(0, 12)}`}>{line}</code>
          ))}
        </section>
      )}
    </div>
  );
}
