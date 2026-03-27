import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getJobInfo,
  getJobProgress,
  getJobResult,
  getJobStatus
} from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { StatusPill } from "../../components/ui/StatusPill";
import type { TimeseriesEntry } from "../../types";
import {
  extractArtifacts,
  extractKpis,
  extractTimeseries
} from "../../utils/jobResult";
import { isCompletedForResults } from "../../utils/jobStatus";
import { formatDateTime } from "../../utils/time";

const DETAIL_TABS = ["overview", "timeseries", "kpis", "deploy"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

function isValidTab(value: string | null): value is DetailTab {
  return Boolean(value) && DETAIL_TABS.includes(value as DetailTab);
}

function resolveBackTarget(fromParam: string | null): string {
  if (!fromParam) return "/app/ai/jobs";
  if (fromParam.startsWith("?")) return `/app/ai/jobs${fromParam}`;
  return `/app/ai/jobs?${fromParam}`;
}

function pickUpdatedAt(progress: Record<string, unknown> | undefined, info: Record<string, unknown> | undefined): string | number | null {
  if (progress) {
    const fromProgress = progress.updated_at || progress.timestamp || progress.last_update;
    if (typeof fromProgress === "string" || typeof fromProgress === "number") {
      return fromProgress;
    }
  }

  if (info) {
    const fromInfo = info.updated_at || info.last_update || info.finished_at || info.created_at;
    if (typeof fromInfo === "string" || typeof fromInfo === "number") {
      return fromInfo;
    }
  }

  return null;
}

function MiniSeriesChart({ series }: { series: TimeseriesEntry }): JSX.Element {
  const points = series.points.slice(0, 140);
  const values = points.map((point) => point.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const svgPoints = points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 100;
      const y = 100 - ((point.y - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <article className="job-series-card panel">
      <header>
        <h4>{series.name}</h4>
        <small>{points.length} points</small>
      </header>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${series.name} chart`}>
        <polyline points={svgPoints} className="job-series-line" />
      </svg>
      <footer>
        <span>Min: {min.toFixed(3)}</span>
        <span>Max: {max.toFixed(3)}</span>
      </footer>
    </article>
  );
}

export function JobDetailPage(): JSX.Element {
  const navigate = useNavigate();
  const { jobId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get("tab");
  const activeTab: DetailTab = isValidTab(tabParam) ? tabParam : "overview";
  const fromParam = searchParams.get("from");
  const backTarget = resolveBackTarget(fromParam);

  const statusQuery = useQuery({
    queryKey: ["job-status", jobId],
    queryFn: () => getJobStatus(jobId),
    enabled: Boolean(jobId)
  });

  const infoQuery = useQuery({
    queryKey: ["job-info", jobId],
    queryFn: () => getJobInfo(jobId),
    enabled: Boolean(jobId)
  });

  const progressQuery = useQuery({
    queryKey: ["job-progress", jobId],
    queryFn: () => getJobProgress(jobId),
    enabled: Boolean(jobId)
  });

  const resultQuery = useQuery({
    queryKey: ["job-result", jobId],
    queryFn: () => getJobResult(jobId),
    enabled: Boolean(jobId)
  });

  const isLoading =
    statusQuery.isLoading || infoQuery.isLoading || progressQuery.isLoading || resultQuery.isLoading;

  const status = statusQuery.data?.status || "unknown";
  const isCompleted = isCompletedForResults(status);

  const kpis = useMemo(() => extractKpis(resultQuery.data), [resultQuery.data]);
  const timeseries = useMemo(() => extractTimeseries(resultQuery.data), [resultQuery.data]);
  const artifacts = useMemo(
    () => extractArtifacts(resultQuery.data, infoQuery.data || null),
    [infoQuery.data, resultQuery.data]
  );

  const updatedAt = pickUpdatedAt(progressQuery.data, infoQuery.data);
  const mlflowUrl =
    typeof infoQuery.data?.mlflow_run_url === "string" ? infoQuery.data.mlflow_run_url : null;

  function setTab(nextTab: DetailTab): void {
    const params = new URLSearchParams(searchParams);
    params.set("tab", nextTab);
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="page job-detail-page">
      <header className="jobs-hero">
        <div>
          <span className="section-kicker">Job Detail</span>
          <h1>{jobId}</h1>
          <p>Inspect outputs and operational metadata for this simulation run.</p>
        </div>
        <div className="jobs-command-group">
          <Button variant="ghost" iconLeft={<ArrowLeft size={14} />} onClick={() => navigate(backTarget)}>
            Back to Jobs
          </Button>
          {mlflowUrl ? (
            <a className="btn btn-secondary btn-md" href={mlflowUrl} target="_blank" rel="noreferrer">
              <span className="btn-icon">
                <ExternalLink size={14} />
              </span>
              <span>Open MLflow</span>
            </a>
          ) : null}
        </div>
      </header>

      <section className="job-detail-header panel">
        <div>
          <small>Status</small>
          <StatusPill status={status} />
        </div>
        <div>
          <small>Host</small>
          <strong>{infoQuery.data?.target_host || "-"}</strong>
        </div>
        <div>
          <small>Last update</small>
          <strong>{formatDateTime(updatedAt)}</strong>
        </div>
        <div>
          <small>Run name</small>
          <strong>{infoQuery.data?.run_name || "-"}</strong>
        </div>
      </section>

      <nav className="job-subnav" aria-label="Job detail navigation">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`job-subtab${activeTab === tab ? " is-active" : ""}`}
            onClick={() => setTab(tab)}
          >
            {tab === "kpis" ? "KPIs" : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {isLoading ? <p className="jobs-meta">Loading job details...</p> : null}
      {!isLoading && (statusQuery.isError || infoQuery.isError || resultQuery.isError) ? (
        <EmptyState
          title="Could not load job details"
          message="Please retry from the Jobs page or check backend connectivity."
          action={
            <Button variant="secondary" onClick={() => navigate(backTarget)}>
              Back to Jobs
            </Button>
          }
        />
      ) : null}

      {!isLoading && !statusQuery.isError && !infoQuery.isError && !resultQuery.isError ? (
        <section className="job-detail-body">
          {activeTab === "overview" ? (
            <section className="panel">
              <h2>Overview</h2>
              <dl className="job-overview-grid">
                <div>
                  <dt>Job ID</dt>
                  <dd>{jobId}</dd>
                </div>
                <div>
                  <dt>Experiment</dt>
                  <dd>{infoQuery.data?.experiment_name || "-"}</dd>
                </div>
                <div>
                  <dt>Config path</dt>
                  <dd>{infoQuery.data?.config_path || "inline config"}</dd>
                </div>
                <div>
                  <dt>Target host</dt>
                  <dd>{infoQuery.data?.target_host || "auto"}</dd>
                </div>
              </dl>
              <h4>Raw metadata</h4>
              <pre className="json-view compact">{JSON.stringify(infoQuery.data || {}, null, 2)}</pre>
            </section>
          ) : null}

          {activeTab === "timeseries" ? (
            <section className="panel">
              <h2>Timeseries</h2>
              {!isCompleted ? (
                <EmptyState
                  title="Timeseries available after completion"
                  message="This job is not completed yet, so final result series are not available."
                />
              ) : timeseries.length === 0 ? (
                <EmptyState
                  title="No timeseries found"
                  message="Result payload does not include structured timeseries data."
                />
              ) : (
                <div className="job-series-grid">
                  {timeseries.map((series) => (
                    <MiniSeriesChart key={series.id} series={series} />
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {activeTab === "kpis" ? (
            <section className="panel">
              <h2>KPIs</h2>
              {!isCompleted ? (
                <EmptyState
                  title="KPIs available after completion"
                  message="This job is still running or queued."
                />
              ) : kpis.length === 0 ? (
                <EmptyState
                  title="No KPIs found"
                  message="Result payload does not expose numeric KPI entries yet."
                />
              ) : (
                <div className="job-kpi-table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>KPI</th>
                        <th>Value</th>
                        <th>Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpis.map((kpi) => (
                        <tr key={kpi.key}>
                          <td>{kpi.label}</td>
                          <td>{kpi.value.toFixed(4)}</td>
                          <td>{kpi.unit || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {activeTab === "deploy" ? (
            <section className="panel">
              <h2>Deploy</h2>
              <p className="jobs-meta">Read-only preview for artifacts. Deploy actions will be enabled in a next phase.</p>

              {artifacts.length === 0 ? (
                <EmptyState
                  title="No artifacts detected"
                  message="No artifact/model/checkpoint/path/uri entries were detected in result metadata."
                />
              ) : (
                <div className="job-artifacts-list">
                  {artifacts.map((artifact) => (
                    <article key={`${artifact.kind}:${artifact.pathOrUri}`} className="job-artifact-item">
                      <strong>{artifact.name}</strong>
                      <small>{artifact.kind}</small>
                      <code>{artifact.pathOrUri}</code>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
