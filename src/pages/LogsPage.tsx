import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileWarning, Search } from "lucide-react";
import { getJobFileLogs, getJobLogs, listJobs } from "../api/trainingApi";
import { useApiFeedback } from "../hooks/useApiFeedback";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";

export function LogsPage(): JSX.Element {
  const { notifyError } = useApiFeedback();
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [search, setSearch] = useState("");

  const jobsQuery = useQuery({
    queryKey: ["jobs", "for-logs"],
    queryFn: listJobs,
    refetchInterval: 9000
  });

  useEffect(() => {
    if (!selectedJobId && jobsQuery.data && jobsQuery.data.length > 0) {
      setSelectedJobId(jobsQuery.data[0].job_id);
    }
  }, [jobsQuery.data, selectedJobId]);

  const logsQuery = useQuery({
    queryKey: ["logs", selectedJobId],
    queryFn: async () => {
      if (!selectedJobId) return "";
      try {
        return await getJobFileLogs(selectedJobId);
      } catch {
        return getJobLogs(selectedJobId);
      }
    },
    enabled: Boolean(selectedJobId),
    refetchInterval: 6000
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
    const text = logsQuery.data || "";
    const lines = text.split("\n").filter(Boolean);
    if (!search) return lines;
    return lines.filter((line) => line.toLowerCase().includes(search.toLowerCase()));
  }, [logsQuery.data, search]);

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
          {logsQuery.isLoading ? <p>Loading logs...</p> : null}
          {filteredLines.length === 0 ? <p>No log lines for current filter.</p> : null}
          {filteredLines.map((line, index) => (
            <code key={`${index}-${line.slice(0, 12)}`}>{line}</code>
          ))}
        </section>
      )}
    </div>
  );
}
