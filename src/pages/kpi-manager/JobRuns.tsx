import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { api as axios } from "../../api/kpiApi";
import { Badge } from "../../components/ui/Badge";
import { KpiDelta } from "../../components/kpi/KpiDelta";
import { communityLabel } from "../../components/kpi/KpiFilters";
import { KpiError, KpiLoading } from "../../components/kpi/KpiStates";
import { LOWER_IS_BETTER } from "../../constants/kpiDirection";
import { kpiDisplayName, useKpiMetadata } from "../../hooks/useKpiMetadata";
import {
  comparisonRows, comparisonScopes, duration, houseCoverage, normalizeRun, scopeLabel, type BauRun, type JobRun,
} from "./jobRunsModel";

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });
const show = (v: number | null | undefined, unit?: string | null) =>
  v == null ? "—" : `${number.format(v)}${unit ? ` ${unit}` : ""}`;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "—");
const day = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "—";

const STATUS = {
  running: { tone: "info", label: "Running" },
  success: { tone: "success", label: "Success" },
  error: { tone: "danger", label: "Error" },
} as const;

const BAU_OUTCOME: Record<string, { tone: "success" | "warning" | "danger" | "info"; label: string }> = {
  stored: { tone: "success", label: "BAU stored" },
  no_data: { tone: "warning", label: "BAU: no data" },
  failed: { tone: "danger", label: "BAU failed" },
  expired: { tone: "warning", label: "BAU expired" },
  unavailable: { tone: "warning", label: "BAU unavailable" },
  error: { tone: "danger", label: "BAU request failed" },
};

/** Keeps a rendering error inside the panel instead of blanking the whole page. */
class PanelBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  componentDidCatch(error: Error) { console.error("Job runs panel failed to render", error); }
  render() {
    return this.state.error
      ? <KpiError message={`This run could not be shown: ${this.state.error.message}`} />
      : this.props.children;
  }
}

/**
 * The runs of a scheduler job and what each one did: the runs in a narrow column
 * with its own scroll, the chosen run beside it. refreshKey reloads them (e.g. after Run now).
 */
export function JobRuns({ jobId, kpis, refreshKey = 0 }: {
  jobId: string; kpis?: string[]; refreshKey?: number;
}): JSX.Element {
  const [runs, setRuns] = useState<JobRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const res = await axios.get<{ status: string; data: unknown }>(`api/v1/scheduler/jobs/${jobId}/runs`, {
        params: { limit: 50 },
      });
      const data = res?.data?.data;
      if (!Array.isArray(data)) throw new Error("The KPI API did not return the runs (is the KPI module up to date?)");
      setRuns(data.map(normalizeRun));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to load the runs");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { setRuns(null); setSelected(null); }, [jobId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  // While a run is still going (a BAU can take hours), keep it up to date
  const running = runs?.some((r) => r.status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [running, load]);

  const run = runs?.find((r) => r.run_id === selected) ?? runs?.[0];

  return (
    <section className="kpi-runs" aria-label={`Runs of ${jobId}`}>
      <PanelBoundary resetKey={jobId}>
        {error && <KpiError message={error} onRetry={load} />}
        {!runs && !error && <KpiLoading label="Loading runs…" />}
        {runs && runs.length === 0 && (
          <p className="kpi-text-soft">No runs recorded yet. Runs are recorded from this version on; select Run to start one.</p>
        )}
        {runs && runs.length > 0 && (
          <div className="kpi-runs-layout">
            <div className="kpi-runs-list">
              <div className="kpi-runs-list-head">
                <span className="kpi-text-soft">{runs.length} run{runs.length !== 1 ? "s" : ""}</span>
                <button className="icon-btn" type="button" onClick={load} aria-label="Refresh runs" disabled={loading}>
                  <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                </button>
              </div>
              <ol className="kpi-run-list" aria-label="Runs">
                {runs.map((r) => (
                  <li key={r.run_id}>
                    <button
                      type="button"
                      className={`kpi-run-item${r.run_id === run?.run_id ? " is-selected" : ""}`}
                      aria-pressed={r.run_id === run?.run_id}
                      onClick={() => setSelected(r.run_id)}
                    >
                      <span>{when(r.started_at)}</span>
                      <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            {run && <PanelBoundary resetKey={run.run_id}><RunDetail run={run} kpis={kpis} /></PanelBoundary>}
          </div>
        )}
      </PanelBoundary>
    </section>
  );
}

function RunDetail({ run, kpis }: { run: JobRun; kpis?: string[] }) {
  const { kpis: kpiMeta } = useKpiMetadata();
  const name = (kpi: string) => kpiDisplayName(kpiMeta.find((m) => m.name === kpi), kpi);
  const communities = Object.entries(run.communities ?? {});

  return (
    <section className="kpi-run-detail" aria-label="Run details">
      <dl className="kpi-job-facts">
        <div><dt>Period</dt><dd>{day(run.period_start)} → {day(run.period_end)}</dd></div>
        <div><dt>Duration</dt><dd>{run.status === "running" ? "Running…" : duration(run.started_at, run.finished_at)}</dd></div>
      </dl>
      {run.error && <pre className="kpi-job-error">{run.error}</pre>}

      {communities.map(([community, c]) => (
        <div key={community} className="kpi-run-block">
          <h4>{communityLabel(community)}</h4>

          <div className="kpi-run-section">
            <h5>Real KPIs <span className="kpi-text-soft">· every building with data</span></h5>
            {c.error ? (
              <p className="kpi-text-danger">{c.error}</p>
            ) : c.windows === 0 ? (
              <p className="kpi-text-soft">No data in this period: nothing was computed.</p>
            ) : (
              <>
                <p className="kpi-text-soft">
                  {c.buildings_with_data ?? c.buildings} of {c.buildings} buildings with data · {c.windows} KPI windows stored
                </p>
                {Object.keys(c.community).length > 0 && (
                  <div className="kpi-table-wrap">
                    <table className="kpi-table">
                      <thead><tr><th>KPI (community)</th><th>Value</th></tr></thead>
                      <tbody>
                        {Object.entries(c.community).map(([kpi, v]) => (
                          <tr key={kpi}><td>{name(kpi)}</td><td>{show(v.value, v.unit)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

          {run.bau?.[community] && (
            <BauBlock bau={run.bau[community]} kpis={kpis} name={name} running={run.status === "running"} />
          )}
        </div>
      ))}
      {run.status === "running" && communities.length === 0 && <KpiLoading label="Computing…" />}
    </section>
  );
}

function BauBlock({ bau, kpis, name, running }: {
  bau: BauRun; kpis?: string[]; name: (kpi: string) => string; running: boolean;
}) {
  // Only the job's KPIs (runs recorded before the module filtered them carry every BAU KPI)
  const wanted = kpis && kpis.length ? new Set(kpis) : null;
  const rowsOf = (s?: string) => comparisonRows(bau, s).filter((r) => !wanted || wanted.has(r.kpi));
  const scopes = comparisonScopes(bau).filter((s) => rowsOf(s).length > 0);
  const [scope, setScope] = useState("community");
  const current = scopes.includes(scope) ? scope : scopes[0];
  const rows = current ? rowsOf(current) : [];
  const coverage = houseCoverage(bau.houses);
  const outcome = bau.outcome ? BAU_OUTCOME[bau.outcome] : undefined;
  const simulated = coverage.included.length;

  return (
    <div className="kpi-run-section kpi-run-bau">
      <h5>
        Real vs BAU{" "}
        {outcome ? <Badge tone={outcome.tone}>{outcome.label}</Badge>
          : <Badge tone="info">{running ? `Waiting for the simulation (${bau.state ?? "queued"})` : bau.state ?? "—"}</Badge>}
      </h5>
      {bau.error && <p className="kpi-text-danger">{bau.error}</p>}

      {bau.houses && bau.houses.length > 0 && (
        <div className="kpi-run-coverage">
          <p>
            Compared on the <strong>{simulated}</strong> of {bau.houses.length} houses the BAU simulated, over the same
            quarter-hours on both sides
            {simulated > 0 && (
              <span className="kpi-text-soft">
                {" "}· {coverage.included.map((h) => `${h.house} ${Math.round((100 * h.included) / (h.expected || 1))}%`).join(", ")}
              </span>
            )}
          </p>
          {coverage.excluded > 0 && (
            <details className="kpi-run-excluded">
              <summary>{coverage.excluded} house{coverage.excluded !== 1 ? "s" : ""} left out, and why</summary>
              <ul className="kpi-text-soft">
                {coverage.reasons.map(([reason, count]) => <li key={reason}>{count} × {reason}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {rows.length > 0 ? (
        <>
          {scopes.length > 1 && (
            <label className="kpi-run-scope">
              <span className="kpi-text-soft">Scope</span>
              <select value={current} onChange={(e) => setScope(e.target.value)}>
                {scopes.map((s) => <option key={s} value={s}>{scopeLabel(s)}</option>)}
              </select>
            </label>
          )}
          <div className="kpi-table-wrap">
            <table className="kpi-table">
              <thead><tr><th>KPI</th><th>Real</th><th>BAU</th><th>Real − BAU</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.kpi}>
                    <td>{name(r.kpi)}</td>
                    <td>{show(r.real, r.unit)}</td>
                    <td>{show(r.bau, r.unit)}</td>
                    <td><KpiDelta absolute={r.delta} relativePct={null} lowerIsBetter={LOWER_IS_BETTER.has(r.kpi)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : outcome?.label === "BAU stored" ? (
        <p className="kpi-text-soft">None of this job's KPIs could be compared with the BAU.</p>
      ) : null}
    </div>
  );
}
