import { useState, useEffect, useCallback } from "react";
import { Button } from "../../components/ui/Button";
import { Calendar, Play, RefreshCw, Clock, CheckCircle, XCircle, Loader2, AlertCircle } from "lucide-react";
import {  Card, CardContent, CardHeader, CardTitle  } from "../../components/ui/KpiCard";
import { api as axios } from "../../api/kpiApi";

interface JobStatus {
  id: string;
  kpis: string[];
  community: string;
  buildings: string[];
  cron: string;
  lookback_hours?: number;
  lookback_days?: number;
  next_run_time: string | null;
  last_run_time: string | null;
  last_run_status: "success" | "error" | "running" | "never" | null;
  last_run_error?: string | null;
}

interface SchedulerStatus {
  running: boolean;
  jobs: JobStatus[];
}

const formatDateTime = (iso: string | null) => {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString("pt-PT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return iso;
  }
};

const StatusBadge = ({ status }: { status: JobStatus["last_run_status"] }) => {
  const configs = {
    success: { icon: <CheckCircle size={14} />, label: "Success", bg: "var(--bg-elev)", color: "var(--text)", borderColor: "var(--line)" },
    error:   { icon: <XCircle size={14} />,     label: "Error",   bg: "var(--bg-elev)", color: "var(--text)", borderColor: "var(--line)" },
    running: { icon: <Loader2 size={14} className="animate-spin" />, label: "Running", bg: "var(--bg-elev)", color: "var(--text)", borderColor: "var(--line)" },
    never:   { icon: <Clock size={14} />,        label: "Never run", bg: "var(--bg-elev)", color: "var(--text-soft)", borderColor: "var(--line)" },
  };
  const cfg = configs[status ?? "never"] ?? configs.never;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", border: `1px solid ${cfg.borderColor}`, fontWeight: 500, backgroundColor: cfg.bg, color: cfg.color
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
};

export function SchedulerPage() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<Record<string, "ok" | "error">>({});

  const fetchStatus = useCallback(async () => {
    try {
      setError(null);
      const res = await axios.get<{ status: string; data: SchedulerStatus }>("api/v1/scheduler/status");
      if (res?.data?.data && typeof res.data.data === "object") {
        setStatus(res.data.data);
      } else {
        console.warn("Unexpected scheduler status format:", res.data);
      }
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setError("Scheduler API not available yet. The backend endpoint GET /api/v1/scheduler/status needs to be implemented.");
      } else {
        setError(err?.message || "Failed to fetch scheduler status");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000); // auto-refresh every 30s
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const triggerJob = async (jobId: string) => {
    setTriggeringJob(jobId);
    try {
      await axios.post(`/api/v1/scheduler/jobs/${jobId}/trigger`);
      setTriggerResult((prev) => ({ ...prev, [jobId]: "ok" }));
      setTimeout(() => {
        setTriggerResult((prev) => { const n = { ...prev }; delete n[jobId]; return n; });
        fetchStatus();
      }, 3000);
    } catch {
      setTriggerResult((prev) => ({ ...prev, [jobId]: "error" }));
      setTimeout(() => {
        setTriggerResult((prev) => { const n = { ...prev }; delete n[jobId]; return n; });
      }, 3000);
    } finally {
      setTriggeringJob(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }} className="page">
      {/* Page header */}
      <header className="jobs-hero">
        <div>
          <h1>Scheduler</h1>
          <p>Monitor and manage scheduled KPI jobs</p>
        </div>
        <div className="jobs-hero-meta">
          <Button
            onClick={fetchStatus}
            disabled={loading}
            variant="secondary"
            iconLeft={<RefreshCw className={`${loading ? "animate-spin" : ""}`} size={16} />}
          >
            Refresh
          </Button>
        </div>
      </header>

      <div className="page-content" style={{ display: "flex", flexDirection: "column", gap: "1.5rem", padding: "1.5rem" }}>
        {/* Scheduler status pill */}
        {status && (
          <div style={{
            display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", fontWeight: 500, padding: "0.5rem 1rem", borderRadius: "0.5rem", width: "fit-content",
            border: `1px solid var(--line)`,
            backgroundColor: "var(--bg-elev)",
            color: "var(--text)"
          }}>
            <div style={{
              width: "0.5rem", height: "0.5rem", borderRadius: "9999px",
              backgroundColor: status.running ? "var(--primary)" : "var(--text-soft)"
            }} className={status.running ? "animate-pulse" : ""} />
            Scheduler {status.running ? "running" : "stopped"}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", backgroundColor: "var(--bg-elev)", border: "1px solid var(--line)", color: "var(--text)", padding: "1rem", borderRadius: "0.5rem" }}>
            <AlertCircle size={20} style={{ flexShrink: 0, marginTop: "0.125rem" }} />
            <p style={{ fontSize: "0.875rem", margin: 0 }}>{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && !error && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", color: "var(--text-soft)", padding: "2rem", justifyContent: "center" }}>
            <Loader2 className="animate-spin" size={24} />
            <span>Loading scheduler status...</span>
          </div>
        )}

        {/* Jobs grid */}
        {status && status.jobs.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "1rem" }}>
            {status.jobs.map((job) => (
              <Card key={job.id}>
                <CardHeader>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <CardTitle style={{ fontSize: "1rem" }}>{job.id}</CardTitle>
                        <StatusBadge status={job.last_run_status} />
                        {triggerResult[job.id] === "ok" && (
                          <span style={{ fontSize: "0.75rem", color: "var(--text)", fontWeight: 500 }}>âœ“ Triggered</span>
                        )}
                        {triggerResult[job.id] === "error" && (
                          <span style={{ fontSize: "0.75rem", color: "var(--text)", fontWeight: 500 }}>âœ— Failed to trigger</span>
                        )}
                      </div>
                      <p style={{ fontSize: "0.875rem", color: "var(--text-soft)", fontFamily: "monospace", margin: 0 }}>{job.cron}</p>
                    </div>
                    <Button
                      onClick={() => triggerJob(job.id)}
                      disabled={triggeringJob === job.id}
                      variant="primary"
                      size="sm"
                    >
                      {triggeringJob === job.id
                        ? <Loader2 className="animate-spin" size={14} style={{ display: "inline" }} />
                        : <Play size={14} style={{ display: "inline" }} />}
                      <span style={{ marginLeft: "0.375rem" }}>Run now</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "1rem", fontSize: "0.875rem" }}>
                    <div>
                      <p style={{ fontSize: "0.875rem", color: "var(--text-soft)", marginBottom: "0.125rem", marginTop: 0 }}>Community</p>
                      <p style={{ fontWeight: 500, color: "var(--text)", margin: 0 }}>{job.community}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: "0.875rem", color: "var(--text-soft)", marginBottom: "0.125rem", marginTop: 0 }}>Lookback</p>
                      <p style={{ fontWeight: 500, color: "var(--text)", margin: 0 }}>
                        {job.lookback_hours ? `${job.lookback_hours}h` : `${job.lookback_days}d`}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: "0.875rem", color: "var(--text-soft)", marginBottom: "0.125rem", marginTop: 0 }}>Next run</p>
                      <p style={{ fontWeight: 500, color: "var(--text)", fontSize: "0.75rem", margin: 0 }}>{formatDateTime(job.next_run_time)}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: "0.875rem", color: "var(--text-soft)", marginBottom: "0.125rem", marginTop: 0 }}>Last run</p>
                      <p style={{ fontWeight: 500, color: "var(--text)", fontSize: "0.75rem", margin: 0 }}>{formatDateTime(job.last_run_time)}</p>
                    </div>
                  </div>

                  {/* KPIs list */}
                  <div style={{ marginTop: "1rem" }}>
                    <p style={{ fontSize: "0.875rem", color: "var(--text-soft)", marginBottom: "0.5rem", marginTop: 0 }}>KPIs</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                      {job.kpis.map((kpi) => (
                        <span key={kpi} style={{ fontSize: "0.75rem", backgroundColor: "var(--bg)", color: "var(--text)", padding: "0.125rem 0.5rem", borderRadius: "9999px", border: "1px solid var(--line)" }}>
                          {kpi}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Error message if last run failed */}
                  {job.last_run_status === "error" && job.last_run_error && (
                    <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", backgroundColor: "var(--bg-elev)", border: "1px solid var(--line)", color: "var(--text)", borderRadius: "0.5rem", padding: "0.75rem", fontFamily: "monospace" }}>
                      {job.last_run_error}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty state */}
        {status && status.jobs.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem", color: "var(--text-soft)", backgroundColor: "var(--bg-elev)", borderRadius: "0.75rem", border: "1px dashed #d1d5db" }}>
            <Calendar size={48} style={{ marginBottom: "1rem", color: "var(--line)" }} />
            <p style={{ fontWeight: 500, color: "var(--text-soft)", margin: 0 }}>No scheduled jobs</p>
            <p style={{ fontSize: "0.875rem", marginTop: "0.25rem", margin: 0 }}>Add jobs to kpi_schedule.yaml to see them here.</p>
          </div>
        )}
      </div>
    </div>
  );
}