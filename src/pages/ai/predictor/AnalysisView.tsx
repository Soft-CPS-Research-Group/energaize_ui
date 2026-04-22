import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from "recharts";
import { Download, RefreshCcw, X, ChevronDown, ChevronRight, Play } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { EVChargingLoader } from "../../../components/ui/EVChargingLoader";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import {
  listModels, getFeatureImportance, submitJob, listJobs, getJob, cancelJob, getExportUrl,
  type ModelMeta, type FeatureImportanceResult, type AnalysisJob,
  type CompareResult, type MissingDataResult, type SegmentAnalysisResult, type HpTuneResult,
  type ImportanceType, type Lane, type ParamSpec, type SubmitPayload,
} from "../../../api/analysisApi";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BAR_PALETTE = ["#60a5fa", "#fb923c", "#a78bfa", "#34d399", "#f87171", "#fbbf24"];

function fmt(v: number | null | undefined, d = 4): string {
  if (v == null) return "—";
  return v.toFixed(d);
}
function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(2)}%`;
}
function fmtTs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// Build 96-step horizon labels: "00:15" … "24:00"
const HORIZON_LABELS = Array.from({ length: 96 }, (_, i) => {
  const totalMins = (i + 1) * 15;
  const h = Math.floor(totalMins / 60).toString().padStart(2, "0");
  const m = (totalMins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
});

function statusTone(s: string): "success" | "info" | "neutral" | "danger" | "warning" {
  if (s === "DONE")      return "success";
  if (s === "RUNNING")   return "info";
  if (s === "PENDING")   return "neutral";
  if (s === "FAILED")    return "danger";
  return "warning"; // CANCELLED
}

// ─── InfoTip ──────────────────────────────────────────────────────────────────

function InfoTip({ tip }: { tip: string }) {
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const W = 240;
  const GAP = 8; // px between tooltip bottom and badge top

  const show = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - W / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
    // "bottom" in fixed coords = distance from viewport bottom to badge top minus gap
    setPos({ left, bottom: window.innerHeight - rect.top + GAP });
  };

  const hide = () => setPos(null);

  return (
    <>
      <span ref={ref} className="analysis-infotip" onMouseEnter={show} onMouseLeave={hide}>?</span>
      {pos && createPortal(
        <div
          className="analysis-infotip-popup"
          style={{ position: "fixed", left: pos.left, bottom: pos.bottom, width: W, pointerEvents: "none" }}
        >{tip}</div>,
        document.body,
      )}
    </>
  );
}

const METRIC_TIPS: Record<string, string> = {
  MAE: "Mean Absolute Error (kWh) — average magnitude of prediction errors. Lower is better.",
  NMAE: "Normalised MAE as % of mean actual value — lets you compare error across houses with different energy scales.",
  RMSE: "Root Mean Squared Error (kWh) — like MAE but penalises large individual errors more heavily.",
  MAPE: "Mean Absolute Percentage Error — prediction error expressed as a percentage of the actual value.",
  "R²": "R² (coefficient of determination): 1.0 = perfect fit, 0 = predicting the mean, negative = worse than baseline.",
  Samples: "Number of 15-minute time steps in the held-out test set used to compute these metrics.",
};

// ─── JobPoller ────────────────────────────────────────────────────────────────

function useJobPoller(jobId: string | null, onDone: (job: AnalysisJob) => void) {
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  useEffect(() => {
    stop();
    if (!jobId) { setJob(null); return; }
    const poll = async () => {
      try {
        const j = await getJob(jobId);
        setJob(j);
        if (j.status === "DONE" || j.status === "FAILED" || j.status === "CANCELLED") {
          stop();
          onDone(j);
        }
      } catch { /* ignore transient */ }
    };
    poll();
    intervalRef.current = setInterval(poll, 3000);
    return stop;
  }, [jobId]);

  return { job, reset: () => { stop(); setJob(null); } };
}

// ─── JobProgressBar ───────────────────────────────────────────────────────────

function JobProgressBar({ job, onCancel }: { job: AnalysisJob; onCancel: () => void }) {
  const pct = job.progress ?? 0;
  return (
    <div className="analysis-progress">
      <div className="analysis-progress-bar-wrap">
        <div className="analysis-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="analysis-progress-meta">
        <span className="is-muted" style={{ fontSize: "0.82rem" }}>{job.progress_msg || job.status}</span>
        <span className="is-muted" style={{ fontSize: "0.82rem" }}>{pct}%</span>
        {(job.status === "PENDING" || job.status === "RUNNING") && (
          <Button variant="ghost" size="sm" iconLeft={<X size={13} />} onClick={onCancel}>Cancel</Button>
        )}
      </div>
    </div>
  );
}

// ─── MetricsRow ───────────────────────────────────────────────────────────────

function MetricsRow({ m }: { m: ReturnType<typeof Object.values>[0] & { mae: number; nmae_pct: number; rmse: number; mape_pct: number; r2: number; n_samples: number } }) {
  return (
    <div className="analysis-metrics-row">
      {[
        ["MAE", fmt(m.mae) + " kWh"],
        ["NMAE", fmtPct(m.nmae_pct)],
        ["RMSE", fmt(m.rmse) + " kWh"],
        ["MAPE", fmtPct(m.mape_pct)],
        ["R²", fmt(m.r2, 4)],
        ["Samples", String(m.n_samples)],
      ].map(([label, val]) => (
        <div key={label} className="analysis-metric-chip">
          <span className="analysis-metric-label">
            {label}
            {METRIC_TIPS[label] && <InfoTip tip={METRIC_TIPS[label]} />}
          </span>
          <span className="analysis-metric-value">{val}</span>
        </div>
      ))}
    </div>
  );
}

// ─── HorizonChart ─────────────────────────────────────────────────────────────

function HorizonChart({ series }: { series: { name: string; color: string; data: { step: number; mae: number }[] }[] }) {
  const chartData = Array.from({ length: 96 }, (_, i) => {
    const row: Record<string, unknown> = { label: HORIZON_LABELS[i] };
    for (const s of series) row[s.name] = s.data[i]?.mae ?? null;
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={chartData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text-soft)" }}
          interval={11} height={20} />
        <YAxis tick={{ fontSize: 10, fill: "var(--text-soft)" }} width={48} />
        <Tooltip contentStyle={{ background: "var(--bg-elev)", border: "1px solid var(--line)", fontSize: "0.8rem" }} />
        <Legend wrapperStyle={{ fontSize: "0.8rem" }} />
        {series.map((s) => (
          <Line key={s.name} type="monotone" dataKey={s.name} stroke={s.color} dot={false} strokeWidth={2} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Tab 1: Model Browser ─────────────────────────────────────────────────────

function ModelBrowserTab({ onOpenFeatureImportance }: { onOpenFeatureImportance: (key: string) => void }) {
  const { data: models, isLoading, refetch } = useQuery({
    queryKey: ["analysis", "models"],
    queryFn: listModels,
    staleTime: 60000,
  });
  const [selected, setSelected] = useState<ModelMeta | null>(null);

  return (
    <div className="analysis-tab-body">
      <div className="analysis-toolbar">
        <h3>Production Models</h3>
        <Button variant="secondary" size="sm" iconLeft={<RefreshCcw size={13} />} onClick={() => refetch()}>
          Refresh
        </Button>
      </div>
      {isLoading ? <EVChargingLoader label="Loading models…" /> : (
        <div className="panel" style={{ padding: 0 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Model Key</th>
                  <th>House</th>
                  <th>Lane</th>
                  <th>Type <InfoTip tip="warm = trained on a specific house's historical data. cold_start = generic model used when no history is available." /></th>
                  <th>Size (KB)</th>
                  <th>Stored MAE <InfoTip tip="Mean Absolute Error recorded at training time on the validation set. Lower is better." /></th>
                  <th># Features <InfoTip tip="Number of input features this model was trained on (lag values, time encodings, etc)." /></th>
                  <th># Outputs <InfoTip tip="Number of forecast steps produced per inference — 96 steps = 24 hours at 15-min resolution." /></th>
                </tr>
              </thead>
              <tbody>
                {(models ?? []).map((m) => (
                  <tr key={m.model_key} className="is-clickable" onClick={() => setSelected(m)}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{m.model_key}</td>
                    <td>{m.house_id ?? <span className="is-muted">—</span>}</td>
                    <td><Badge tone={m.lane === "consumption" ? "info" : "warning"}>{m.lane}</Badge></td>
                    <td><Badge tone={m.model_type === "warm" ? "success" : "neutral"}>{m.model_type}</Badge></td>
                    <td>{m.file_size_kb.toFixed(1)}</td>
                    <td>{fmt(m.stored_mae)}</td>
                    <td>{m.n_features}</td>
                    <td>{m.n_outputs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Model detail drawer — portalled to body so it covers the full viewport */}
      {selected && createPortal(
        <div className="analysis-overlay" onClick={() => setSelected(null)}>
          <div className="analysis-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="analysis-drawer-header">
              <h3>Model Details</h3>
              <button className="icon-btn" onClick={() => setSelected(null)}><X size={16} /></button>
            </div>
            <div className="analysis-drawer-body">
              {(Object.entries(selected) as [string, unknown][]).map(([k, v]) => (
                <div key={k} className="analysis-kv-row">
                  <span className="analysis-kv-key">{k}</span>
                  <span className="analysis-kv-val">{String(v ?? "—")}</span>
                </div>
              ))}
            </div>
            <div className="analysis-drawer-footer">
              <Button variant="primary" onClick={() => { onOpenFeatureImportance(selected.model_key); setSelected(null); }}>
                Feature Importance →
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Tab 2: Feature Importance ────────────────────────────────────────────────

function FeatureImportanceTab({ initialModelKey }: { initialModelKey?: string }) {
  const { data: models } = useQuery({ queryKey: ["analysis", "models"], queryFn: listModels, staleTime: 60000 });
  const [modelKey, setModelKey] = useState(initialModelKey ?? "");
  const [importanceType, setImportanceType] = useState<ImportanceType>("gain");
  const [result, setResult] = useState<FeatureImportanceResult | null>(null);

  // Update if parent pushes a new key
  useEffect(() => { if (initialModelKey) setModelKey(initialModelKey); }, [initialModelKey]);

  const mutation = useMutation({
    mutationFn: () => getFeatureImportance(modelKey, importanceType),
    onSuccess: setResult,
  });

  const top30 = result ? [...result.features].slice(0, 30).reverse() : [];

  const downloadCsv = () => {
    if (!result) return;
    const rows = ["rank,feature_name,score", ...result.features.map((f) => `${f.rank},${f.feature_name},${f.score}`)];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `feature_importance_${modelKey}.csv`; a.click();
  };

  return (
    <div className="analysis-tab-body">
      <div className="analysis-form-grid">
        <label className="analysis-form-field">
          <span>Model</span>
          <select value={modelKey} onChange={(e) => setModelKey(e.target.value)} className="predictor-house-select">
            <option value="">Select model…</option>
            {(models ?? []).map((m) => <option key={m.model_key} value={m.model_key}>{m.model_key}</option>)}
          </select>
        </label>
        <label className="analysis-form-field">
          <span>Importance Type <InfoTip tip="gain = how much each feature reduces loss when used in a split. weight = number of times a feature appears in trees. cover = number of samples affected. total_gain/cover = summed versions." /></span>
          <select value={importanceType} onChange={(e) => setImportanceType(e.target.value as ImportanceType)} className="predictor-house-select">
            {(["gain", "weight", "cover", "total_gain", "total_cover"] as ImportanceType[]).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <div className="analysis-form-field analysis-form-field--btn">
          <Button variant="primary" disabled={!modelKey || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Loading…" : "Load"}
          </Button>
        </div>
      </div>
      {mutation.isError && <div className="analysis-error">{(mutation.error as Error).message}</div>}
      {result && (
        <>
          <div className="panel">
            <div className="analysis-toolbar" style={{ marginBottom: 8 }}>
              <span className="is-muted" style={{ fontSize: "0.85rem" }}>Top 30 features by {importanceType} · {result.n_features} total</span>
              <Button variant="secondary" size="sm" iconLeft={<Download size={13} />} onClick={downloadCsv}>CSV</Button>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(300, top30.length * 22)}>
              <BarChart data={top30} layout="vertical" margin={{ top: 4, right: 20, left: 100, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--text-soft)" }} />
                <YAxis type="category" dataKey="feature_name" tick={{ fontSize: 10, fill: "var(--text)" }} width={100} />
                <Tooltip contentStyle={{ background: "var(--bg-elev)", border: "1px solid var(--line)", fontSize: "0.8rem" }} />
                <Bar dataKey="score" fill="#60a5fa" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="panel" style={{ padding: 0 }}>
            <div style={{ overflowX: "auto", maxHeight: 320 }}>
              <table className="table">
                <thead><tr><th>Rank</th><th>Feature</th><th>Score</th></tr></thead>
                <tbody>
                  {result.features.map((f) => (
                    <tr key={f.feature_name}>
                      <td className="is-muted">{f.rank}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{f.feature_name}</td>
                      <td>{f.score.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab 3: Compare Models ────────────────────────────────────────────────────

function CompareModelsTab({ initialJob }: { initialJob?: AnalysisJob }) {
  const { notifyError } = useApiFeedback();
  const { data: models } = useQuery({ queryKey: ["analysis", "models"], queryFn: listModels, staleTime: 60000 });
  const [houseId, setHouseId] = useState("");
  const [lane, setLane] = useState<Lane>("consumption");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [testDays, setTestDays] = useState(90);
  const [includeSegments, setIncludeSegments] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [segOpen, setSegOpen] = useState(false);

  useEffect(() => {
    if (initialJob?.result) setResult(initialJob.result as CompareResult);
  }, [initialJob?.job_id]);

  const { job, reset } = useJobPoller(jobId, (j) => {
    if (j.status === "DONE") setResult(j.result as CompareResult);
    else if (j.status === "FAILED") notifyError("Compare job failed", new Error(j.error ?? "Unknown error"));
  });

  const submit = async () => {
    try {
      const res = await submitJob({ job_type: "compare", house_id: houseId, lane, model_keys: selectedKeys, test_days: testDays, include_segments: includeSegments });
      setResult(null); reset(); setJobId(res.job_id);
    } catch (e) { notifyError("Submit failed", e as Error); }
  };

  const toggleKey = (k: string) =>
    setSelectedKeys((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);

  const houseModels = (models ?? []).filter((m) => m.house_id === (houseId || undefined) && m.lane === lane);
  const compareBarData = result ? ["mae", "rmse", "nmae_pct"].map((metric) => {
    const row: Record<string, unknown> = { metric };
    for (const [mk, ev] of Object.entries(result.evaluation)) row[mk] = (ev as unknown as Record<string, number>)[metric];
    return row;
  }) : [];

  return (
    <div className="analysis-tab-body">
      <div className="analysis-form-grid">
        <label className="analysis-form-field">
          <span>House ID <InfoTip tip="The household identifier to evaluate, e.g. R-H-01. Models are filtered to this house and lane." /></span>
          <input className="analysis-text-input" value={houseId} onChange={(e) => setHouseId(e.target.value)} placeholder="e.g. R-H-01" />
        </label>
        <label className="analysis-form-field">
          <span>Lane <InfoTip tip="consumption = electricity drawn from the grid. production = solar/generation output." /></span>
          <div className="predictor-lane-toggle">
            {(["consumption", "production"] as Lane[]).map((l) => (
              <button key={l} className={`predictor-lane-btn${lane === l ? " is-active" : ""}`} onClick={() => setLane(l)}>{l}</button>
            ))}
          </div>
        </label>
        <label className="analysis-form-field">
          <span>Test Days <InfoTip tip="Total days of historical data to load. The final 20% is used as the held-out test set; the rest is context." /></span>
          <input className="analysis-text-input" type="number" min={7} max={365} value={testDays} onChange={(e) => setTestDays(Number(e.target.value))} />
        </label>
        <label className="analysis-form-field analysis-checkbox-field">
          <input type="checkbox" checked={includeSegments} onChange={(e) => setIncludeSegments(e.target.checked)} />
          <span>Include Segments <InfoTip tip="Also break down metrics by weekday/weekend, season, and hour of day. Adds a few seconds to the job." /></span>
        </label>
      </div>
      <div className="analysis-form-field" style={{ marginBottom: 12 }}>
        <span>Models (select 2+)</span>
        <div className="analysis-model-checklist">
          {houseModels.length === 0
            ? <span className="is-muted" style={{ fontSize: "0.82rem" }}>Enter a house ID to see available models</span>
            : houseModels.map((m) => (
              <label key={m.model_key} className="analysis-check-row">
                <input type="checkbox" checked={selectedKeys.includes(m.model_key)} onChange={() => toggleKey(m.model_key)} />
                <span style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{m.model_key}</span>
              </label>
            ))
          }
        </div>
      </div>
      <Button variant="primary" iconLeft={<Play size={14} />} disabled={selectedKeys.length < 1 || !houseId}
        onClick={submit}>Run Compare Job</Button>

      {job && (job.status === "PENDING" || job.status === "RUNNING") && (
        <JobProgressBar job={job} onCancel={async () => { await cancelJob(job.job_id); reset(); setJobId(null); }} />
      )}
      {job?.status === "FAILED" && <div className="analysis-error">{job.error}</div>}
      {job?.status === "CANCELLED" && <div className="analysis-info">Job was cancelled.</div>}

      {result && (
        <>
          <div className="panel">
            <h4>Metric Comparison</h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={compareBarData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="metric" tick={{ fontSize: 11, fill: "var(--text-soft)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-soft)" }} width={48} />
                <Tooltip contentStyle={{ background: "var(--bg-elev)", border: "1px solid var(--line)", fontSize: "0.8rem" }} />
                <Legend wrapperStyle={{ fontSize: "0.8rem" }} />
                {Object.keys(result.evaluation).map((mk, i) => (
                  <Bar key={mk} dataKey={mk} fill={BAR_PALETTE[i % BAR_PALETTE.length]} radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="panel">
            <h4>MAE by Forecast Horizon</h4>
            <HorizonChart series={Object.entries(result.horizon).map(([mk, data], i) => ({
              name: mk, color: BAR_PALETTE[i % BAR_PALETTE.length],
              data: data.map((d) => ({ step: d.step, mae: d.mae })),
            }))} />
          </div>
          {result.segments && includeSegments && (
            <div className="panel">
              <button className="analysis-collapsible-btn" onClick={() => setSegOpen((v) => !v)}>
                {segOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Segment Breakdown
              </button>
              {segOpen && (
                <div style={{ overflowX: "auto", marginTop: 8 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Segment</th><th>Group</th>
                        {Object.keys(result.evaluation).map((mk) => <th key={mk}>{mk} MAE</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.segments).flatMap(([mk, segs]) =>
                        segs.map((s) => (
                          <tr key={`${mk}-${s.segment_name}-${s.segment_value}`}>
                            <td className="is-muted">{s.segment_name}</td>
                            <td>{s.segment_value}</td>
                            <td>{fmt(s.metrics.mae)} kWh</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab 4: Segment Analysis ──────────────────────────────────────────────────

const SEGMENT_OPTIONS = ["weekday_weekend", "season", "hour_of_day"] as const;

function SegmentAnalysisTab({ initialJob }: { initialJob?: AnalysisJob }) {
  const { notifyError } = useApiFeedback();
  const { data: models } = useQuery({ queryKey: ["analysis", "models"], queryFn: listModels, staleTime: 60000 });
  const [modelKey, setModelKey] = useState("");
  const [testDays, setTestDays] = useState(90);
  const [segments, setSegments] = useState<string[]>(["weekday_weekend"]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<SegmentAnalysisResult | null>(null);

  useEffect(() => {
    if (initialJob?.result) setResult(initialJob.result as SegmentAnalysisResult);
  }, [initialJob?.job_id]);

  const selectedModel = models?.find((m) => m.model_key === modelKey);

  const { job, reset } = useJobPoller(jobId, (j) => {
    if (j.status === "DONE") setResult(j.result as SegmentAnalysisResult);
    else if (j.status === "FAILED") notifyError("Segment job failed", new Error(j.error ?? "Unknown error"));
  });

  const submit = async () => {
    if (!selectedModel) return;
    try {
      const res = await submitJob({ job_type: "segment", house_id: selectedModel.house_id!, lane: selectedModel.lane, model_key: modelKey, segments, test_days: testDays });
      setResult(null); reset(); setJobId(res.job_id);
    } catch (e) { notifyError("Submit failed", e as Error); }
  };

  const toggleSeg = (s: string) =>
    setSegments((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);

  // Build per-segment grouped bar data
  const segChartData = (segName: string) => {
    if (!result) return [];
    return result.segments.filter((s) => s.segment_name === segName)
      .map((s) => ({ group: s.segment_value, mae: s.metrics.mae }));
  };

  return (
    <div className="analysis-tab-body">
      <div className="analysis-form-grid">
        <label className="analysis-form-field">
          <span>Model</span>
          <select value={modelKey} onChange={(e) => setModelKey(e.target.value)} className="predictor-house-select">
            <option value="">Select model…</option>
            {(models ?? []).filter((m) => m.house_id != null).map((m) => (
              <option key={m.model_key} value={m.model_key}>{m.model_key}</option>
            ))}
          </select>
        </label>
        <label className="analysis-form-field">
          <span>Test Days <InfoTip tip="Total days of historical data to load. The final 20% is used as the held-out test set." /></span>
          <input className="analysis-text-input" type="number" min={7} max={365} value={testDays} onChange={(e) => setTestDays(Number(e.target.value))} />
        </label>
      </div>
      <div className="analysis-form-field" style={{ marginBottom: 12 }}>
        <span>Segments <InfoTip tip="Dimension to slice performance by. weekday_weekend splits Mon–Fri vs Sat–Sun. season splits by meteorological season. hour_of_day splits into 4 time bands." /></span>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
          {SEGMENT_OPTIONS.map((s) => (
            <label key={s} className="analysis-check-row">
              <input type="checkbox" checked={segments.includes(s)} onChange={() => toggleSeg(s)} />
              <span>{s}</span>
            </label>
          ))}
        </div>
      </div>
      <Button variant="primary" iconLeft={<Play size={14} />} disabled={!modelKey || segments.length === 0} onClick={submit}>
        Run Segment Analysis
      </Button>

      {job && (job.status === "PENDING" || job.status === "RUNNING") && (
        <JobProgressBar job={job} onCancel={async () => { await cancelJob(job.job_id); reset(); setJobId(null); }} />
      )}
      {job?.status === "FAILED" && <div className="analysis-error">{job.error}</div>}

      {result && (
        <>
          <div className="panel"><h4>Overall Metrics</h4><MetricsRow m={result.metrics as any} /></div>
          <div className="panel"><h4>MAE by Horizon</h4>
            <HorizonChart series={[{ name: modelKey.slice(-20), color: "#60a5fa", data: result.horizon.map((h) => ({ step: h.step, mae: h.mae })) }]} />
          </div>
          {segments.map((seg) => (
            <div key={seg} className="panel">
              <h4>{seg}</h4>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={segChartData(seg)} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="group" tick={{ fontSize: 11, fill: "var(--text-soft)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--text-soft)" }} width={48} />
                  <Tooltip contentStyle={{ background: "var(--bg-elev)", border: "1px solid var(--line)", fontSize: "0.8rem" }} />
                  <Bar dataKey="mae" radius={[3, 3, 0, 0]}>
                    {segChartData(seg).map((_, i) => <Cell key={i} fill={BAR_PALETTE[i % BAR_PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── Tab 5: Missing Data Test ─────────────────────────────────────────────────

const GAP_RATE_OPTIONS = [0.05, 0.1, 0.2, 0.4];
const GAP_TYPE_OPTIONS = ["random", "consecutive"];

function MissingDataTab({ initialJob }: { initialJob?: AnalysisJob }) {
  const { notifyError } = useApiFeedback();
  const { data: models } = useQuery({ queryKey: ["analysis", "models"], queryFn: listModels, staleTime: 60000 });
  const warmModels = (models ?? []).filter((m) => m.model_type === "warm" && m.house_id != null);
  const [modelKey, setModelKey] = useState("");
  const [gapRates, setGapRates] = useState<number[]>([0.05, 0.1, 0.2]);
  const [gapTypes, setGapTypes] = useState<string[]>(["random"]);
  const [nSim, setNSim] = useState(5);
  const [testDays, setTestDays] = useState(30);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<MissingDataResult | null>(null);

  useEffect(() => {
    if (initialJob?.result) setResult(initialJob.result as MissingDataResult);
  }, [initialJob?.job_id]);

  const selectedModel = models?.find((m) => m.model_key === modelKey);

  const { job, reset } = useJobPoller(jobId, (j) => {
    if (j.status === "DONE") setResult(j.result as MissingDataResult);
    else if (j.status === "FAILED") notifyError("Missing data job failed", new Error(j.error ?? "Unknown error"));
  });

  const submit = async () => {
    if (!selectedModel) return;
    try {
      const res = await submitJob({ job_type: "missing-data", house_id: selectedModel.house_id!, lane: selectedModel.lane, model_key: modelKey, gap_rates: gapRates, gap_types: gapTypes, n_simulations: nSim, test_days: testDays });
      setResult(null); reset(); setJobId(res.job_id);
    } catch (e) { notifyError("Submit failed", e as Error); }
  };

  const toggleRate = (r: number) => setGapRates((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r].sort());
  const toggleType = (t: string) => setGapTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  // Line chart: one line per gap_type, X = gap_rate
  const lineData = result ? GAP_RATE_OPTIONS.map((rate) => {
    const row: Record<string, unknown> = { rate: `${(rate * 100).toFixed(0)}%` };
    for (const gt of GAP_TYPE_OPTIONS) {
      const pt = result.results.find((r) => r.gap_type === gt && r.gap_rate === rate);
      if (pt) row[gt] = pt.metrics.mae;
    }
    return row;
  }) : [];

  return (
    <div className="analysis-tab-body">
      <div className="analysis-form-grid">
        <label className="analysis-form-field">
          <span>Warm Model <InfoTip tip="Only warm models are supported here — they use lag features that can be artificially masked to simulate missing data." /></span>
          <select value={modelKey} onChange={(e) => setModelKey(e.target.value)} className="predictor-house-select">
            <option value="">Select model…</option>
            {warmModels.map((m) => <option key={m.model_key} value={m.model_key}>{m.model_key}</option>)}
          </select>
        </label>
        <label className="analysis-form-field">
          <span>N Simulations <InfoTip tip="Number of Monte Carlo runs per (gap type, gap rate) combination. More runs = more stable estimate but slower job." /></span>
          <input className="analysis-text-input" type="number" min={1} max={20} value={nSim} onChange={(e) => setNSim(Number(e.target.value))} />
        </label>
        <label className="analysis-form-field">
          <span>Test Days</span>
          <input className="analysis-text-input" type="number" min={7} max={90} value={testDays} onChange={(e) => setTestDays(Number(e.target.value))} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 24, marginBottom: 12, flexWrap: "wrap" }}>
        <div className="analysis-form-field">
          <span>Gap Rates <InfoTip tip="Fraction of lag input features randomly set to null to simulate sensor dropouts. E.g. 10% = 1 in 10 lag values are missing." /></span>
          <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
            {GAP_RATE_OPTIONS.map((r) => (
              <label key={r} className="analysis-check-row">
                <input type="checkbox" checked={gapRates.includes(r)} onChange={() => toggleRate(r)} />
                <span>{(r * 100).toFixed(0)}%</span>
              </label>
            ))}
          </div>
        </div>
        <div className="analysis-form-field">
          <span>Gap Types <InfoTip tip="random = missing values are scattered independently. consecutive = missing values occur in a contiguous block (simulates an outage)." /></span>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            {GAP_TYPE_OPTIONS.map((t) => (
              <label key={t} className="analysis-check-row">
                <input type="checkbox" checked={gapTypes.includes(t)} onChange={() => toggleType(t)} />
                <span>{t}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <Button variant="primary" iconLeft={<Play size={14} />} disabled={!modelKey || gapRates.length === 0 || gapTypes.length === 0} onClick={submit}>
        Run Missing Data Test
      </Button>

      {job && (job.status === "PENDING" || job.status === "RUNNING") && (
        <JobProgressBar job={job} onCancel={async () => { await cancelJob(job.job_id); reset(); setJobId(null); }} />
      )}
      {job?.status === "FAILED" && <div className="analysis-error">{job.error}</div>}

      {result && (
        <>
          <div className="panel">
            <div className="analysis-toolbar" style={{ marginBottom: 8 }}>
              <h4>MAE by Gap Rate</h4>
              <Button variant="secondary" size="sm" iconLeft={<Download size={13} />}
                onClick={() => { window.location.href = getExportUrl(jobId!); }}>CSV</Button>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={lineData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="rate" tick={{ fontSize: 11, fill: "var(--text-soft)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-soft)" }} width={48} />
                <Tooltip contentStyle={{ background: "var(--bg-elev)", border: "1px solid var(--line)", fontSize: "0.8rem" }} />
                <Legend wrapperStyle={{ fontSize: "0.8rem" }} />
                {GAP_TYPE_OPTIONS.filter((t) => gapTypes.includes(t)).map((t, i) => (
                  <Line key={t} type="monotone" dataKey={t} stroke={BAR_PALETTE[i]} dot={true} strokeWidth={2} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="panel" style={{ padding: 0 }}>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Gap Type</th><th>Gap Rate</th><th>MAE</th><th>RMSE</th><th>R²</th><th>Samples</th></tr></thead>
                <tbody>
                  {result.results.map((r, i) => (
                    <tr key={i}>
                      <td>{r.gap_type}</td>
                      <td>{(r.gap_rate * 100).toFixed(0)}%</td>
                      <td>{fmt(r.metrics.mae)}</td>
                      <td>{fmt(r.metrics.rmse)}</td>
                      <td>{fmt(r.metrics.r2)}</td>
                      <td>{r.metrics.n_samples}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab 6: Hyperparameter Tuning ─────────────────────────────────────────────

const HP_PARAMS = ["n_estimators", "max_depth", "learning_rate", "subsample", "colsample_bytree", "min_child_weight", "reg_alpha", "reg_lambda"] as const;
type HpParam = typeof HP_PARAMS[number];

interface ParamRow { id: number; param: HpParam; specType: "choice" | "range"; choiceRaw: string; low: string; high: string; step: string; }

function HpTuningTab({ initialJob }: { initialJob?: AnalysisJob }) {
  const { notifyError } = useApiFeedback();
  const { data: models } = useQuery({ queryKey: ["analysis", "models"], queryFn: listModels, staleTime: 60000 });
  const [modelKey, setModelKey] = useState("");
  const [strategy, setStrategy] = useState<"random" | "grid">("random");
  const [nTrials, setNTrials] = useState(20);
  const [paramRows, setParamRows] = useState<ParamRow[]>([
    { id: 1, param: "n_estimators", specType: "choice", choiceRaw: "200,400,600", low: "3", high: "8", step: "1" },
    { id: 2, param: "max_depth",    specType: "range",  choiceRaw: "",            low: "3", high: "8", step: "1" },
    { id: 3, param: "learning_rate",specType: "range",  choiceRaw: "",            low: "0.01", high: "0.3", step: "0.01" },
  ]);
  const [nextId, setNextId] = useState(4);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<HpTuneResult | null>(null);

  useEffect(() => {
    if (initialJob?.result) setResult(initialJob.result as HpTuneResult);
  }, [initialJob?.job_id]);

  const selectedModel = models?.find((m) => m.model_key === modelKey);

  const { job, reset } = useJobPoller(jobId, (j) => {
    if (j.status === "DONE") setResult(j.result as HpTuneResult);
    else if (j.status === "FAILED") notifyError("Tuning job failed", new Error(j.error ?? "Unknown error"));
  });

  const addRow = () => { setParamRows((r) => [...r, { id: nextId, param: "subsample", specType: "range", choiceRaw: "", low: "0.5", high: "1", step: "0.1" }]); setNextId((n) => n + 1); };
  const removeRow = (id: number) => setParamRows((r) => r.filter((x) => x.id !== id));
  const updateRow = (id: number, patch: Partial<ParamRow>) => setParamRows((r) => r.map((x) => x.id === id ? { ...x, ...patch } : x));

  const buildParamSpace = (): Record<string, ParamSpec> => {
    const ps: Record<string, ParamSpec> = {};
    for (const row of paramRows) {
      if (row.specType === "choice") {
        ps[row.param] = { type: "choice", values: row.choiceRaw.split(",").map((v) => parseFloat(v.trim())).filter((v) => !isNaN(v)) };
      } else {
        ps[row.param] = { type: "range", low: parseFloat(row.low), high: parseFloat(row.high), step: parseFloat(row.step) };
      }
    }
    return ps;
  };

  const submit = async () => {
    if (!selectedModel) return;
    try {
      const payload: SubmitPayload = { job_type: "hyperparameter-tune", house_id: selectedModel.house_id!, lane: selectedModel.lane, model_key: modelKey, strategy, n_trials: strategy === "random" ? nTrials : undefined, param_space: buildParamSpace() };
      const res = await submitJob(payload);
      setResult(null); reset(); setJobId(res.job_id);
    } catch (e) { notifyError("Submit failed", e as Error); }
  };

  const scatterData = result ? result.results.map((t) => ({ trial: t.trial, mae: t.metrics.mae, best: t.trial === result.results.reduce((b, c) => c.metrics.mae < b.metrics.mae ? c : b, result.results[0]).trial })) : [];

  return (
    <div className="analysis-tab-body">
      <div className="analysis-form-grid">
        <label className="analysis-form-field">
          <span>Model</span>
          <select value={modelKey} onChange={(e) => setModelKey(e.target.value)} className="predictor-house-select">
            <option value="">Select model…</option>
            {(models ?? []).filter((m) => m.house_id != null).map((m) => <option key={m.model_key} value={m.model_key}>{m.model_key}</option>)}
          </select>
        </label>
        <label className="analysis-form-field">
          <span>Strategy <InfoTip tip="random = sample N random parameter combinations. grid = try every combination in the cartesian product (capped at 100 trials)." /></span>
          <div className="predictor-lane-toggle">
            {(["random", "grid"] as const).map((s) => (
              <button key={s} className={`predictor-lane-btn${strategy === s ? " is-active" : ""}`} onClick={() => setStrategy(s)}>{s}</button>
            ))}
          </div>
        </label>
        {strategy === "random" && (
          <label className="analysis-form-field">
            <span>N Trials <InfoTip tip="How many random parameter sets to sample and evaluate. More trials find better configs but take longer." /></span>
            <input className="analysis-text-input" type="number" min={1} max={100} value={nTrials} onChange={(e) => setNTrials(Number(e.target.value))} />
          </label>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="analysis-toolbar" style={{ marginBottom: 8 }}>
          <h4>Parameter Space <InfoTip tip="Define which hyperparameters to search and over what values. choice = pick from a list, range = numeric grid with step size." /></h4>
          <Button variant="secondary" size="sm" onClick={addRow}>+ Add Param</Button>
        </div>
        {paramRows.map((row) => (
          <div key={row.id} className="analysis-param-row">
            <select value={row.param} onChange={(e) => updateRow(row.id, { param: e.target.value as HpParam })} className="predictor-house-select">
              {HP_PARAMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <div className="predictor-lane-toggle">
              {(["choice", "range"] as const).map((t) => (
                <button key={t} className={`predictor-lane-btn${row.specType === t ? " is-active" : ""}`} onClick={() => updateRow(row.id, { specType: t })}>{t}</button>
              ))}
            </div>
            {row.specType === "choice"
              ? <input className="analysis-text-input" placeholder="e.g. 200,400,600" value={row.choiceRaw} onChange={(e) => updateRow(row.id, { choiceRaw: e.target.value })} />
              : (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input className="analysis-text-input analysis-text-input--sm" placeholder="low" value={row.low} onChange={(e) => updateRow(row.id, { low: e.target.value })} />
                  <span className="is-muted">–</span>
                  <input className="analysis-text-input analysis-text-input--sm" placeholder="high" value={row.high} onChange={(e) => updateRow(row.id, { high: e.target.value })} />
                  <span className="is-muted">step</span>
                  <input className="analysis-text-input analysis-text-input--sm" placeholder="step" value={row.step} onChange={(e) => updateRow(row.id, { step: e.target.value })} />
                </div>
              )
            }
            <button className="icon-btn icon-btn--remove" aria-label="Remove parameter" onClick={() => removeRow(row.id)}><X size={14} /></button>
          </div>
        ))}
      </div>

      <Button variant="primary" iconLeft={<Play size={14} />} disabled={!modelKey || paramRows.length === 0} onClick={submit}>
        Start Tuning
      </Button>

      {job && (job.status === "PENDING" || job.status === "RUNNING") && (
        <JobProgressBar job={job} onCancel={async () => { await cancelJob(job.job_id); reset(); setJobId(null); }} />
      )}
      {job?.status === "FAILED" && <div className="analysis-error">{job.error}</div>}

      {result && (
        <>
          <div className="panel analysis-best-card">
            <h4>Best Result</h4>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
              <div>
                <span className="is-muted" style={{ fontSize: "0.8rem" }}>Best Params</span>
                <div style={{ fontFamily: "monospace", fontSize: "0.82rem", marginTop: 4 }}>
                  {Object.entries(result.best_params).map(([k, v]) => (
                    <div key={k}>{k}: <strong>{v}</strong></div>
                  ))}
                </div>
              </div>
              <div><span className="is-muted" style={{ fontSize: "0.8rem" }}>Best Metrics</span><MetricsRow m={result.best_metrics as any} /></div>
            </div>
          </div>
          <div className="panel">
            <h4>Trial MAE Scatter</h4>
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="trial" name="Trial" tick={{ fontSize: 10, fill: "var(--text-soft)" }} type="number" />
                <YAxis dataKey="mae" name="MAE" tick={{ fontSize: 10, fill: "var(--text-soft)" }} width={48} />
                <Tooltip contentStyle={{ background: "var(--bg-elev)", border: "1px solid var(--line)", fontSize: "0.8rem" }} />
                <Scatter data={scatterData} fill="#60a5fa">
                  {scatterData.map((d, i) => <Cell key={i} fill={d.best ? "#22c55e" : "#60a5fa"} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="panel" style={{ padding: 0 }}>
            <div style={{ overflowX: "auto", maxHeight: 360 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    {Object.keys(result.best_params).map((k) => <th key={k}>{k}</th>)}
                    <th>MAE</th><th>RMSE</th><th>R²</th>
                  </tr>
                </thead>
                <tbody>
                  {[...result.results].sort((a, b) => a.metrics.mae - b.metrics.mae).map((t) => (
                    <tr key={t.trial}>
                      <td className="is-muted">{t.trial}</td>
                      {Object.keys(result.best_params).map((k) => <td key={k}>{t.params[k] ?? "—"}</td>)}
                      <td>{fmt(t.metrics.mae)}</td><td>{fmt(t.metrics.rmse)}</td><td>{fmt(t.metrics.r2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Job History Panel ────────────────────────────────────────────────────────

function JobHistoryPanel({ onLoadJob }: { onLoadJob: (job: AnalysisJob, tabIndex: number) => void }) {
  const [open, setOpen] = useState(false);
  const { data: jobs, refetch, isLoading } = useQuery({ queryKey: ["analysis", "jobs"], queryFn: listJobs, staleTime: 10000, enabled: open });

  const TAB_INDEX: Record<string, number> = { compare: 2, segment: 3, "missing-data": 4, "hyperparameter-tune": 5 };

  return (
    <div className="panel analysis-history-panel">
      <div className="analysis-collapsible-header">
        <button className="analysis-collapsible-btn" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Job History
        </button>
        <Button variant="secondary" size="sm" iconLeft={<RefreshCcw size={12} />}
          onClick={() => refetch()}>Refresh</Button>
      </div>
      {open && (
        isLoading ? <EVChargingLoader label="Loading history…" /> : (
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr><th>Job ID</th><th>Type</th><th>Status</th><th>House</th><th>Lane</th><th>Submitted</th><th>Progress</th><th></th></tr>
              </thead>
              <tbody>
                {(jobs ?? []).map((j) => (
                  <tr key={j.job_id} className={j.status === "DONE" ? "is-clickable" : undefined}
                    onClick={j.status === "DONE" ? () => onLoadJob(j, TAB_INDEX[j.job_type] ?? 0) : undefined}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{j.job_id.slice(0, 8)}…</td>
                    <td>{j.job_type}</td>
                    <td><Badge tone={statusTone(j.status)}>{j.status}</Badge></td>
                    <td className="is-muted">{(j.payload?.house_id as string) ?? "—"}</td>
                    <td className="is-muted">{(j.payload?.lane as string) ?? "—"}</td>
                    <td className="is-muted" style={{ fontSize: "0.78rem" }}>{fmtTs(j.submitted_at)}</td>
                    <td style={{ minWidth: 100 }}>
                      <div className="predictor-progress-bar">
                        <div className="predictor-progress-fill" style={{ width: `${j.progress}%` }} />
                      </div>
                    </td>
                    <td>
                      {j.status === "DONE" && (
                        <button className="icon-btn" title="Download CSV"
                          onClick={(e) => { e.stopPropagation(); window.location.href = getExportUrl(j.job_id); }}>
                          <Download size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

// ─── Main AnalysisView ────────────────────────────────────────────────────────

const TABS = ["Models", "Feature Importance", "Compare", "Segments", "Missing Data", "HP Tuning"];

export function AnalysisView() {
  const [activeTab, setActiveTab] = useState(0);
  const [mountedTabs, setMountedTabs] = useState<Set<number>>(new Set([0]));
  const [fiModelKey, setFiModelKey] = useState<string | undefined>(undefined);
  const [loadedJobs, setLoadedJobs] = useState<Record<number, AnalysisJob>>({});

  const switchTab = (i: number) => {
    setMountedTabs((prev) => { const next = new Set(prev); next.add(i); return next; });
    setActiveTab(i);
  };

  const handleOpenFI = (key: string) => { setFiModelKey(key); switchTab(1); };

  const handleLoadJob = (job: AnalysisJob, tabIndex: number) => {
    setLoadedJobs((prev) => ({ ...prev, [tabIndex]: job }));
    switchTab(tabIndex);
  };

  return (
    <div className="analysis-view">
      <div className="analysis-tabs-bar">
        {TABS.map((t, i) => (
          <button key={t} className={`predictor-tab${activeTab === i ? " is-active" : ""}`} onClick={() => switchTab(i)}>
            {t}
          </button>
        ))}
      </div>

      <div className="analysis-tab-content">
        {mountedTabs.has(0) && <div className={activeTab === 0 ? "analysis-tab-pane is-active" : "analysis-tab-pane"}><ModelBrowserTab onOpenFeatureImportance={handleOpenFI} /></div>}
        {mountedTabs.has(1) && <div className={activeTab === 1 ? "analysis-tab-pane is-active" : "analysis-tab-pane"}><FeatureImportanceTab initialModelKey={fiModelKey} /></div>}
        {mountedTabs.has(2) && <div className={activeTab === 2 ? "analysis-tab-pane is-active" : "analysis-tab-pane"}><CompareModelsTab initialJob={loadedJobs[2]} /></div>}
        {mountedTabs.has(3) && <div className={activeTab === 3 ? "analysis-tab-pane is-active" : "analysis-tab-pane"}><SegmentAnalysisTab initialJob={loadedJobs[3]} /></div>}
        {mountedTabs.has(4) && <div className={activeTab === 4 ? "analysis-tab-pane is-active" : "analysis-tab-pane"}><MissingDataTab initialJob={loadedJobs[4]} /></div>}
        {mountedTabs.has(5) && <div className={activeTab === 5 ? "analysis-tab-pane is-active" : "analysis-tab-pane"}><HpTuningTab initialJob={loadedJobs[5]} /></div>}
      </div>

      <JobHistoryPanel onLoadJob={handleLoadJob} />
    </div>
  );
}
