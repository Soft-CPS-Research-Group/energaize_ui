import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from "recharts";
import { Download, RefreshCcw, X, ChevronDown, ChevronRight, Play, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { EVChargingLoader } from "../../../components/ui/EVChargingLoader";
import { EmptyState } from "../../../components/ui/EmptyState";
import { InfoTip } from "../../../components/ui/InfoTip";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import { getHouses } from "../../../api/predictorApi";
import {
  listModels, getFeatureImportance, activateModel, deleteModel, isArchivedModel as isArchived, submitJob, listJobs, getJob, cancelJob, getExportUrl,
  type ModelMeta, type FeatureImportanceResult, type AnalysisJob,
  type CompareResult, type MissingDataResult, type SegmentAnalysisResult, type HpTuneResult,
  type ImportanceType, type Lane, type ParamSpec, type SubmitPayload, type MetricsBundle, type JobStatus, type JobType,
} from "../../../api/analysisApi";
import {
  BACKEND_LABELS, DETAIL_LABELS, LANE_LABELS, TEST_DAYS_MAX, TEST_DAYS_MIN, VARIANT_LABELS,
  SEGMENT_LABELS, capitalize, fmt, fmtParam, fmtPct, fmtTs, formatDetail, inUseLabel, markInUse, modelLabels,
  groupByHouse, modelsInUse, testDaysValid,
} from "./analysisFormat";
import { ArchiveCleanupModal, formatBytes } from "./ArchiveCleanup";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Categorical series colours (tokens in predictor-ceramic.css), assigned in order and never cycled past six. */
const BAR_PALETTE = Array.from({ length: 6 }, (_, i) => `var(--an-series-${i + 1})`);

const TOOLTIP_STYLE = { background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: 10, fontSize: "0.8rem", color: "var(--text)" };
const formatTooltipValue = (v: unknown) => (typeof v === "number" ? v.toFixed(4) : String(v));
/** Legend labels stay in text colour; the swatch next to them carries the series colour. */
const legendText = (value: string) => <span style={{ color: "var(--text-soft)" }}>{value}</span>;

const JOB_TYPE_LABELS: Record<JobType, string> = { compare: "Compare", segment: "Segments", "missing-data": "Missing data", "hyperparameter-tune": "HP tuning" };
const JOB_STATUS_LABELS: Record<JobStatus, string> = { PENDING: "Queued", RUNNING: "Running", DONE: "Done", FAILED: "Failed", CANCELLED: "Cancelled" };

// Build 96-step horizon labels: "00:15" … "24:00"
const HORIZON_LABELS = Array.from({ length: 96 }, (_, i) => {
  const totalMins = (i + 1) * 15;
  const h = Math.floor(totalMins / 60).toString().padStart(2, "0");
  const m = (totalMins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
});

/** Every 3 hours ahead, so ticks land on round times at any width. */
const HORIZON_TICKS = HORIZON_LABELS.filter((l) => l.endsWith(":00") && Number(l.slice(0, 2)) % 3 === 0);

function statusTone(s: string): "success" | "info" | "neutral" | "danger" | "warning" {
  if (s === "DONE")      return "success";
  if (s === "RUNNING")   return "info";
  if (s === "PENDING")   return "neutral";
  if (s === "FAILED")    return "danger";
  return "warning"; // CANCELLED
}

const METRIC_TIPS: Record<string, string> = {
  MAE: "Mean Absolute Error (kWh) — average magnitude of prediction errors. Lower is better.",
  NMAE: "Normalised MAE as % of mean actual value — lets you compare error across houses with different energy scales.",
  RMSE: "Root Mean Squared Error (kWh) — like MAE but penalises large individual errors more heavily.",
  sMAPE: "Symmetric Mean Absolute Percentage Error — prediction error expressed as a percentage of the average of actual and predicted values. More stable than standard MAPE near zero.",
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
  const [logsOpen, setLogsOpen] = useState(false);
  const [msgLog, setMsgLog] = useState<string[]>([]);
  const lastMsgRef = useRef<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Accumulate distinct progress_msg values as they arrive from the poller
  useEffect(() => {
    const msg = job.progress_msg;
    if (msg && msg !== lastMsgRef.current) {
      lastMsgRef.current = msg;
      setMsgLog((prev) => [...prev, msg]);
    }
  }, [job.progress_msg]);

  // Auto-scroll log pane to bottom when new messages arrive
  useEffect(() => {
    if (logsOpen) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgLog, logsOpen]);

  return (
    <div className="analysis-progress">
      <div className="analysis-progress-bar-wrap">
        <div className="analysis-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="analysis-progress-meta">
        <span className="is-muted" style={{ fontSize: "0.82rem" }}>{job.progress_msg || job.status}</span>
        <span className="is-muted" style={{ fontSize: "0.82rem" }}>{pct}%</span>
        {msgLog.length > 0 && (
          <button className="analysis-progress-logs-toggle" onClick={() => setLogsOpen((v) => !v)}>
            {logsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Logs
          </button>
        )}
        {(job.status === "PENDING" || job.status === "RUNNING") && (
          <Button variant="ghost" size="sm" iconLeft={<X size={13} />} onClick={onCancel}>Cancel</Button>
        )}
      </div>
      {logsOpen && msgLog.length > 0 && (
        <div className="analysis-progress-log-pane">
          {msgLog.map((line, i) => (
            <div key={i} className="analysis-progress-log-line">{line}</div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}

// ─── MetricsRow ───────────────────────────────────────────────────────────────

function MetricsRow({ m }: { m: MetricsBundle }) {
  return (
    <div className="analysis-metrics-row">
      {[
        ["MAE", fmt(m.mae) + " kWh"],
        ["NMAE", fmtPct(m.nmae_pct)],
        ["RMSE", fmt(m.rmse) + " kWh"],
        ["sMAPE", fmtPct(m.smape_pct)],
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

// ─── MetricBars ───────────────────────────────────────────────────────────────

interface BarRow { label: string; full: string; value: number; color: string }

/**
 * One metric as horizontal bars in plain HTML, so names wrap and bars keep their room
 * at any width. The value sits at the bar end; the lowest is marked when the rows are
 * competing models.
 */
function MetricBars({ title, tip, rows, format, markLowest = false }: {
  title: string; tip?: string; rows: BarRow[]; format: (v: number) => string; markLowest?: boolean;
}) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  const lowest = markLowest && rows.length > 1 ? Math.min(...rows.map((r) => r.value)) : null;
  return (
    <figure className="analysis-metric-bars">
      <figcaption>{title}{tip && <InfoTip tip={tip} />}</figcaption>
      <ul className="analysis-hbar-list">
        {rows.map((r) => (
          <li key={r.full} title={r.full}>
            <span className="analysis-hbar-label">{r.label}</span>
            <span className="analysis-hbar-track" aria-hidden="true">
              <span className="analysis-hbar-fill" style={{ width: `${max > 0 ? Math.max(0, r.value) / max * 100 : 0}%`, background: r.color }} />
            </span>
            <span className="analysis-hbar-value">
              {format(r.value)}
              {r.value === lowest && <span className="analysis-hbar-best">lowest</span>}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

// ─── HorizonChart ─────────────────────────────────────────────────────────────

/** Error per forecast step. With several models, MAE and RMSE are shown one at a time. */
function HorizonChart({ title, series }: { title: string; series: { name: string; color: string; data: { step: number; mae: number; rmse?: number }[] }[] }) {
  const hasRmse = series.some((s) => s.data.some((d) => d.rmse != null));
  const [metric, setMetric] = useState<"mae" | "rmse">("mae");
  const chartData = Array.from({ length: 96 }, (_, i) => {
    const row: Record<string, unknown> = { label: HORIZON_LABELS[i] };
    for (const s of series) row[s.name] = s.data[i]?.[metric] ?? null;
    return row;
  });
  return (
    <>
      <div className="analysis-chart-head">
      <h4>{title}</h4>
      {hasRmse && (
        <div className="predictor-lane-toggle" role="group" aria-label="Error measure">
          {(["mae", "rmse"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={metric === m} className={`predictor-lane-btn${metric === m ? " is-active" : ""}`} onClick={() => setMetric(m)}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text-soft)" }} ticks={HORIZON_TICKS} interval={0} height={20} />
          <YAxis tick={{ fontSize: 10, fill: "var(--text-soft)" }} width={52} tickFormatter={(v: number) => v.toFixed(3)}
            label={{ value: `${metric.toUpperCase()} (kWh)`, angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--text-soft)", dy: 30 }} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={formatTooltipValue} labelFormatter={(l) => `${l} ahead`} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: "0.8rem" }} formatter={legendText} itemSorter={null} />}
          {series.map((s) => (
            <Line key={s.name} type="monotone" dataKey={s.name} stroke={s.color} dot={false} strokeWidth={2} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

// ─── Models in use ────────────────────────────────────────────────────────────

/** Which model each house forecasts with, per lane, and which houses fall back to the generic models. */
function ModelsInUsePanel({ models, onSelect }: { models: ModelMeta[]; onSelect: (m: ModelMeta) => void }) {
  const { houses, generic } = modelsInUse(models);
  const lanes: Lane[] = ["consumption", "production"];

  const cell = (house: string, lane: Lane) => {
    const entry = houses.find((h) => h.house_id === house)?.lanes[lane];
    if (!entry) return <span className="is-muted">None</span>;
    const { model, use } = entry;
    const backend = BACKEND_LABELS[model.model_backend ?? "xgboost"] ?? model.model_backend;
    return (
      <button type="button" className="analysis-inuse-model" onClick={() => onSelect(model)} title={model.model_key}>
        <span className={`analysis-inuse-kind is-${model.house_id ? "house" : "generic"}`}>{model.house_id ? "House" : "Generic"}</span>
        {backend}
        {model.model_schema === "sparse" && <span className="is-muted"> sparse</span>}
        {!use.confirmed && <InfoTip tip="Selected. The next forecast for this house will use it." />}
      </button>
    );
  };

  return (
    <div className="panel analysis-inuse-panel">
      <div className="analysis-inuse-header">
        <h3>In use now</h3>
        <InfoTip tip="The model each house forecast with in its last cycle. Each house has its own model per lane; a house without enough history yet uses the generic cold-start model for that lane." />
      </div>
      {houses.length === 0 ? (
        <p className="is-muted analysis-inuse-empty">No house has forecast yet.</p>
      ) : (
        <div className="analysis-table-scroll">
          <table className="table analysis-table analysis-inuse-table">
            <thead>
              <tr><th>House</th>{lanes.map((l) => <th key={l}><span className={`analysis-lane-dot is-${l}`} />{LANE_LABELS[l]}</th>)}</tr>
            </thead>
            <tbody>
              {houses.map((h) => (
                <tr key={h.house_id}>
                  <td>{h.house_id}</td>
                  {lanes.map((l) => <td key={l}>{cell(h.house_id, l)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {generic.length > 0 && (
        <div className="analysis-inuse-generic">
          {generic.map(({ model, houses: users }) => (
            <button type="button" key={model.model_key} className="analysis-inuse-generic-item" onClick={() => onSelect(model)} title={model.model_key}>
              <span className={`analysis-lane-dot is-${model.lane}`} />
              Generic {LANE_LABELS[model.lane]?.toLowerCase()} ({BACKEND_LABELS[model.model_backend ?? "xgboost"]}):{" "}
              <strong>{users.length === 0 ? "no houses" : `${users.length} ${users.length === 1 ? "house" : "houses"}`}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab 1: Model Browser ─────────────────────────────────────────────────────

function ModelBrowserTab({ onOpenFeatureImportance, timezone }: { onOpenFeatureImportance: (key: string) => void; timezone: string }) {
  const queryClient = useQueryClient();
  const { notifySuccess, notifyError } = useApiFeedback();
  const { data: models, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["analysis", "models"],
    queryFn: listModels,
    staleTime: 60000,
  });
  const [selected, setSelected] = useState<ModelMeta | null>(null);

  const promoteMutation = useMutation({
    mutationFn: activateModel,
    onSuccess: (_res, m) => {
      notifySuccess(
        isArchived(m) ? "Model Restored" : "Model Promoted",
        isArchived(m)
          ? `${m.model_key} was restored and ${m.model_backend ?? "xgboost"} is now active for ${m.house_id} / ${m.lane}.`
          : `${m.model_backend ?? "xgboost"} is now active for ${m.house_id} / ${m.lane}.`
      );
      setSelected(null);
      // Show the new model as in use straight away; the refetch below confirms it.
      if (!isArchived(m)) queryClient.setQueryData<ModelMeta[]>(["analysis", "models"], (old) => old && markInUse(old, m));
      queryClient.invalidateQueries({ queryKey: ["analysis", "models"] });
      queryClient.invalidateQueries({ queryKey: ["predictor", "active-model"] });
    },
    onError: (err) => notifyError("Promote Failed", err),
  });

  const [confirmDelete, setConfirmDelete] = useState<ModelMeta | null>(null);
  const [showCleanup, setShowCleanup] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: (m: ModelMeta) => deleteModel(m.model_key),
    onSuccess: (res, m) => {
      notifySuccess("Model deleted", `${m.model_key} was deleted (${formatBytes(res.freed_bytes ?? 0)} freed).`);
      setConfirmDelete(null);
      setSelected(null);
      queryClient.setQueryData<ModelMeta[]>(["analysis", "models"], (old) => old?.filter((x) => x.model_key !== m.model_key));
      queryClient.invalidateQueries({ queryKey: ["analysis", "models"] });
      queryClient.invalidateQueries({ queryKey: ["analysis", "archive"] });
    },
    onError: (err) => notifyError("Model not deleted", err),
  });

  // Filters
  const [filterLane, setFilterLane] = useState<"all" | Lane>("all");
  const [filterHouse, setFilterHouse] = useState("all");
  const [filterModelType, setFilterModelType] = useState<"all" | "warm" | "cold_start">("all");
  const [filterBackend, setFilterBackend] = useState<"all" | "xgboost" | "lgbm" | "lstm">("all");
  const [inUseOnly, setInUseOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"mae-asc" | "mae-desc" | "house" | "newest">("mae-asc");

  // model_backend is optional — backend defaults to xgboost when absent
  const effectiveBackend = (m: ModelMeta) => m.model_backend ?? "xgboost";

  const uniqueHouses = [...new Set((models ?? []).filter((m) => m.house_id).map((m) => m.house_id!))].sort();
  const hasGeneric = (models ?? []).some((m) => !m.house_id);

  const displayedModels = (models ?? [])
    .filter((m) => {
      if (filterLane !== "all" && m.lane !== filterLane) return false;
      if (filterHouse === "generic") { if (m.house_id != null) return false; }
      else if (filterHouse !== "all" && m.house_id !== filterHouse) return false;
      if (filterModelType !== "all" && m.model_type !== filterModelType) return false;
      if (filterBackend !== "all" && effectiveBackend(m) !== filterBackend) return false;
      if (inUseOnly && m.active !== true) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "mae-asc")  return (a.stored_mae ?? Infinity) - (b.stored_mae ?? Infinity);
      if (sortBy === "mae-desc") return (b.stored_mae ?? -Infinity) - (a.stored_mae ?? -Infinity);
      // Older predictor builds send no training date; those models go last.
      if (sortBy === "newest") return (b.trained_at ?? "").localeCompare(a.trained_at ?? "");
      return (a.house_id ?? "~").localeCompare(b.house_id ?? "~") || a.lane.localeCompare(b.lane) || a.model_key.localeCompare(b.model_key);
    });

  return (
    <div className="analysis-tab-body">
      <div className="analysis-models-toolbar">
        <label className="analysis-filter-field">
          <span>Lane</span>
          <select className="predictor-house-select" value={filterLane} onChange={(e) => setFilterLane(e.target.value as typeof filterLane)}>
            <option value="all">All</option>
            <option value="consumption">Consumption</option>
            <option value="production">Production</option>
          </select>
        </label>
        <label className="analysis-filter-field">
          <span>House</span>
          <select className="predictor-house-select" value={filterHouse} onChange={(e) => setFilterHouse(e.target.value)}>
            <option value="all">All</option>
            {hasGeneric && <option value="generic">Generic (no house)</option>}
            {uniqueHouses.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
        <label className="analysis-filter-field">
          <span>Variant</span>
          <select className="predictor-house-select" value={filterModelType} onChange={(e) => setFilterModelType(e.target.value as typeof filterModelType)}>
            <option value="all">All</option>
            <option value="warm">Warm</option>
            <option value="cold_start">Cold start</option>
          </select>
        </label>
        <label className="analysis-filter-field">
          <span>Type</span>
          <select className="predictor-house-select" value={filterBackend} onChange={(e) => setFilterBackend(e.target.value as typeof filterBackend)}>
            <option value="all">All</option>
            <option value="xgboost">XGBoost</option>
            <option value="lgbm">LightGBM</option>
            <option value="lstm">LSTM</option>
          </select>
        </label>
        <label className="analysis-filter-field">
          <span>Sort</span>
          <select className="predictor-house-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="mae-asc">Lowest MAE first</option>
            <option value="mae-desc">Highest MAE first</option>
            <option value="house">House</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
        <label className="analysis-filter-check">
          <input type="checkbox" checked={inUseOnly} onChange={(e) => setInUseOnly(e.target.checked)} />
          <span>In use only</span>
        </label>
        <div className="analysis-models-toolbar-end">
          {(filterLane !== "all" || filterHouse !== "all" || filterModelType !== "all" || filterBackend !== "all" || inUseOnly) && (
            <button className="analysis-filter-clear" onClick={() => { setFilterLane("all"); setFilterHouse("all"); setFilterModelType("all"); setFilterBackend("all"); setInUseOnly(false); }}>
              Clear filters
            </button>
          )}
          {models && <span className="analysis-models-count">{displayedModels.length} of {models.length} models</span>}
          <Button variant="secondary" size="sm" iconLeft={<Trash2 size={13} />} onClick={() => setShowCleanup(true)}>Clean up archive</Button>
          <Button variant="secondary" size="sm" iconLeft={<RefreshCcw size={13} className={isFetching ? "is-spinning" : ""} />} onClick={() => refetch()} disabled={isFetching}>Refresh</Button>
        </div>
      </div>

      {isLoading ? <EVChargingLoader label="Loading models…" /> : isError ? (
        <EmptyState
          title="Models could not be loaded"
          message={`The predictor did not return its stored models (${(error as Error)?.message || "unknown error"}). The analysis engine may still be starting.`}
          action={<Button onClick={() => refetch()} disabled={isFetching}>{isFetching ? "Retrying…" : "Try again"}</Button>}
        />
      ) : (
        <>
        {models && <ModelsInUsePanel models={models} onSelect={setSelected} />}
        {displayedModels.length === 0 ? (
          <div className="panel analysis-models-panel">
            <p className="analysis-table-empty">
              {models && models.length === 0 ? "The predictor has no stored models yet." : "No models match the current filters."}
            </p>
          </div>
        ) : groupByHouse(displayedModels).map(({ house, models: group }) => (
          <section key={house ?? "generic"} className="panel analysis-models-panel" aria-label={house ?? "Generic models"}>
            <div className="analysis-models-group-header">
              <h3>{house ?? "Generic"}</h3>
              <span className="is-muted">{group.length} {group.length === 1 ? "model" : "models"}</span>
              {house == null && <InfoTip tip="Cold-start models, shared by every house that does not have enough history yet." />}
            </div>
            <div className={`analysis-table-scroll${isFetching ? " analysis-table--loading" : ""}`}>
              <table className="table analysis-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Lane</th>
                    <th>Variant <InfoTip tip="Warm models are trained on one house's own history. Cold-start models are generic and used while a house has no history yet." /></th>
                    <th>Type</th>
                    <th className="is-num">Stored MAE <InfoTip tip="Mean Absolute Error (kWh) recorded at training time on the validation set. Lower is better." /></th>
                    <th className="is-num">Features <InfoTip tip="Number of input features this model was trained on (lag values, time encodings, etc.)." /></th>
                    <th className="is-num">Outputs <InfoTip tip="Forecast steps produced per run: 96 steps = 24 hours at 15-minute resolution." /></th>
                    <th className="is-num">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map((m) => (
                    <tr key={m.model_key} className="is-clickable" tabIndex={0} onClick={() => setSelected(m)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(m); } }}>
                      <td className="analysis-model-key">
                        <code>{m.model_key}</code>
                        {m.active === true && <span className="analysis-active-pill">{inUseLabel(m) ?? "In use"}</span>}
                        {isArchived(m) && <span className="analysis-archived-pill">Archived</span>}
                      </td>
                      <td><span className={`analysis-lane-dot is-${m.lane}`} />{LANE_LABELS[m.lane] ?? m.lane}</td>
                      <td>{VARIANT_LABELS[m.model_type] ?? m.model_type}</td>
                      <td>{BACKEND_LABELS[effectiveBackend(m)] ?? effectiveBackend(m)}</td>
                      <td className="is-num">{fmt(m.stored_mae)}</td>
                      <td className="is-num">{m.n_features}</td>
                      <td className="is-num">{m.n_outputs}</td>
                      <td className="is-num is-muted">{m.file_size_kb.toFixed(0)} KB</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        </>
      )}

      {/* Model detail drawer — portalled to body so it covers the full viewport */}
      {selected && createPortal(
        <div className="analysis-overlay" onClick={() => setSelected(null)}>
          <div className="analysis-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="analysis-drawer-header">
              <h3>{selected.model_key}</h3>
              <button className="icon-btn" aria-label="Close" onClick={() => setSelected(null)}><X size={16} /></button>
            </div>
            <div className="analysis-drawer-body">
              {(Object.entries(selected) as [string, unknown][])
                .filter(([k]) => k !== "hyperparams")
                .map(([k, v]) => (
                  <div key={k} className="analysis-kv-row">
                    <span className="analysis-kv-key">{DETAIL_LABELS[k] ?? k}</span>
                    <span className="analysis-kv-val">{formatDetail(k, v)}</span>
                  </div>
                ))
              }
              {selected.hyperparams != null && Object.keys(selected.hyperparams).length > 0 ? (
                <div className="analysis-hyperparams-section">
                  <div className="analysis-hyperparams-title">Hyperparameters</div>
                  <div className="analysis-hyperparams-grid">
                    {Object.entries(selected.hyperparams)
                      .filter(([k]) => k !== "layers")
                      .map(([k, v]) => (
                        <div key={k} className="analysis-hp-chip">
                          <span className="analysis-hp-chip-key">{k}</span>
                          <span className="analysis-hp-chip-val">{String(v)}</span>
                        </div>
                      ))}
                  </div>
                  {Array.isArray((selected.hyperparams as Record<string, unknown>).layers) && (
                    <div style={{ marginTop: 12 }}>
                      <div className="hp-field-label" style={{ marginBottom: 6 }}>Architecture</div>
                      <div className="analysis-layers-list">
                        {((selected.hyperparams as Record<string, unknown[]>).layers as Record<string, unknown>[]).map((l, i) => {
                          const layerColors: Record<string, string> = { linear: "#3b82f6", relu: "#22c55e", lstm: "#8b5cf6", dropout: "#f97316" };
                          const color = layerColors[String(l.type)] ?? "#888";
                          const params =
                            l.type === "linear" ? `out=${l.out}` :
                            l.type === "lstm"   ? `hidden=${l.hidden}, layers=${l.num_layers}` :
                            l.type === "dropout" ? `p=${l.p}` : "";
                          return (
                            <div key={i} className="analysis-layer-item">
                              <div className="analysis-layer-dot" style={{ background: color }} />
                              <span className="analysis-layer-type" style={{ color }}>{String(l.type)}</span>
                              {params && <span className="analysis-layer-params">{params}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : selected.hyperparams === null ? (
                <div className="analysis-kv-row">
                  <span className="analysis-kv-key">Hyperparameters</span>
                  <span className="analysis-kv-val is-muted" style={{ fontStyle: "italic" }}>none recorded (trained before v2)</span>
                </div>
              ) : null}
            </div>
            <div className="analysis-drawer-footer">
              {selected.house_id != null && selected.active !== true && (
                <Button
                  variant="primary"
                  onClick={() => promoteMutation.mutate(selected)}
                  disabled={promoteMutation.isPending}
                >
                  {promoteMutation.isPending
                    ? (isArchived(selected) ? "Restoring…" : "Promoting…")
                    : (isArchived(selected) ? "Restore and Set as Active" : "Set as Active")}
                </Button>
              )}
              <Button variant={selected.house_id != null && selected.active !== true ? "secondary" : "primary"} onClick={() => { onOpenFeatureImportance(selected.model_key); setSelected(null); }}>
                Feature Importance →
              </Button>
              <Button variant="danger" iconLeft={<Trash2 size={14} />} className="analysis-drawer-delete"
                onClick={() => setConfirmDelete(selected)} disabled={deleteMutation.isPending}>
                Delete
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        title="Delete model"
        message={confirmDelete ? (
          <>
            <p>Delete <code>{confirmDelete.model_key}</code>{confirmDelete.file_size_kb ? ` (${confirmDelete.file_size_kb.toFixed(0)} KB)` : ""}? This cannot be undone.</p>
            <p className="is-muted">
              {isArchived(confirmDelete)
                ? "It is an archived version; the model in use is not affected."
                : confirmDelete.house_id == null
                  ? "It is a generic cold-start model: houses without enough history forecast with it until it is retrained."
                  : confirmDelete.active === true
                    ? `It is in use: ${confirmDelete.house_id} / ${confirmDelete.lane} has no model to forecast with until another is set active or trained.`
                    : "No house forecasts with it now, so forecasts are not affected."}
            </p>
          </>
        ) : null}
        confirmLabel="Delete model"
        pending={deleteMutation.isPending}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      <ArchiveCleanupModal open={showCleanup} houses={uniqueHouses} timezone={timezone} onClose={() => setShowCleanup(false)} />
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

  // Rank 1 first.
  const top30 = result ? result.features.slice(0, 30) : [];

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
            <MetricBars title={`Score (${importanceType})`} format={(v) => String(Number(v.toPrecision(3)))}
              rows={top30.map((f) => ({ label: f.feature_name, full: `#${f.rank} ${f.feature_name}`, value: f.score, color: BAR_PALETTE[0] }))} />
          </div>
          <div className="panel" style={{ padding: 0 }}>
            <div style={{ overflowX: "auto", maxHeight: 320 }}>
              <table className="table analysis-table">
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
  const queryClient = useQueryClient();
  const { data: models } = useQuery({ queryKey: ["analysis", "models"], queryFn: listModels, staleTime: 60000 });
  const { data: houses } = useQuery({ queryKey: ["predictor", "houses_v2"], queryFn: getHouses, staleTime: 60000 });
  const [houseId, setHouseId] = useState("");
  const [lane, setLane] = useState<Lane>("consumption");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [testDays, setTestDays] = useState(90);
  const [includeSegments, setIncludeSegments] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [segOpen, setSegOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // A job opened from the history also fills the form, so the results match what is shown above them.
  useEffect(() => {
    if (!initialJob?.result) return;
    const r = initialJob.result as CompareResult;
    setResult(r);
    setHouseId(r.house_id);
    setLane(r.lane);
    setSelectedKeys(Object.keys(r.evaluation));
    setTestDays(r.test_days);
    setIncludeSegments(!!r.segments);
  }, [initialJob?.job_id]);

  const { job, reset } = useJobPoller(jobId, (j) => {
    queryClient.invalidateQueries({ queryKey: ["analysis", "jobs"] });
    if (j.status === "DONE") setResult(j.result as CompareResult);
    else if (j.status === "FAILED") notifyError("Compare job failed", new Error(j.error ?? "Unknown error"));
  });

  const submit = async () => {
    try {
      setSubmitting(true);
      const res = await submitJob({ job_type: "compare", house_id: houseId, lane, model_keys: selectedKeys, test_days: testDays, include_segments: includeSegments });
      setResult(null); reset(); setJobId(res.job_id);
    } catch (e) { notifyError("Submit failed", e as Error); } finally { setSubmitting(false); }
  };

  const toggleKey = (k: string) =>
    setSelectedKeys((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);

  const houseModels = (models ?? []).filter((m) => m.house_id === (houseId || undefined) && m.lane === lane);
  // Best model first, in every chart of the result.
  const modelKeys = result ? Object.keys(result.evaluation).sort((a, b) => result.evaluation[a].mae - result.evaluation[b].mae) : [];
  const labels = modelLabels(modelKeys);
  // Each model keeps its colour in every chart of the result.
  const modelColor = (mk: string) => BAR_PALETTE[Math.max(0, modelKeys.indexOf(mk)) % BAR_PALETTE.length];
  const metricRows = (metric: keyof MetricsBundle): BarRow[] =>
    result ? modelKeys.flatMap((mk) => {
      const value = result.evaluation[mk]?.[metric];
      return typeof value === "number" ? [{ label: labels[mk], full: mk, value, color: modelColor(mk) }] : [];
    }) : [];

  return (
    <div className="analysis-tab-body">
      <div className="analysis-form-grid">
        <label className="analysis-form-field">
          <span>House <InfoTip tip="The household identifier to evaluate, e.g. R-H-01. Models are filtered to this house and lane." /></span>
          <select className="predictor-house-select" value={houseId} onChange={(e) => { setHouseId(e.target.value); setSelectedKeys([]); }}>
            <option value="">Select house…</option>
            {(houses ?? []).map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
        <label className="analysis-form-field">
          <span>Lane <InfoTip tip="consumption = electricity drawn from the grid. production = solar/generation output." /></span>
          <div className="predictor-lane-toggle">
            {(["consumption", "production"] as Lane[]).map((l) => (
              <button key={l} type="button" aria-pressed={lane === l} className={`predictor-lane-btn${lane === l ? " is-active" : ""}`} onClick={() => { setLane(l); setSelectedKeys([]); }}>{LANE_LABELS[l]}</button>
            ))}
          </div>
        </label>
        <label className="analysis-form-field">
          <span>Test Days <InfoTip tip="Total days of historical data to load. The final 20% is used as the held-out test set; the rest is context." /></span>
          <input className="analysis-text-input" type="number" min={TEST_DAYS_MIN} max={TEST_DAYS_MAX} value={testDays} aria-invalid={!testDaysValid(testDays)} onChange={(e) => setTestDays(Number(e.target.value))} />
          {!testDaysValid(testDays) && <small className="analysis-field-error">Enter {TEST_DAYS_MIN} to {TEST_DAYS_MAX} days</small>}
        </label>
        <label className="analysis-form-field analysis-checkbox-field">
          <input type="checkbox" checked={includeSegments} onChange={(e) => setIncludeSegments(e.target.checked)} />
          <span>Include Segments <InfoTip tip="Also break down metrics by weekday/weekend, season, and hour of day. Adds a few seconds to the job." /></span>
        </label>
      </div>
      <div className="analysis-form-field" style={{ marginBottom: 12 }}>
        <span>Models to compare</span>
        <div className="analysis-model-checklist">
          {houseModels.length === 0
            ? <span className="is-muted" style={{ fontSize: "0.82rem" }}>
                {houseId ? `No ${lane} models are stored for ${houseId}.` : "Choose a house to list its models."}
              </span>
            : houseModels.map((m) => (
              <label key={m.model_key} className="analysis-check-row">
                <input type="checkbox" checked={selectedKeys.includes(m.model_key)} onChange={() => toggleKey(m.model_key)} />
                <span style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{m.model_key}</span>
              </label>
            ))
          }
        </div>
      </div>
      <div className="analysis-run-row">
        <Button variant="primary" iconLeft={<Play size={14} />} disabled={selectedKeys.length < 1 || !houseId || !testDaysValid(testDays) || submitting}
          onClick={submit}>{submitting ? "Submitting…" : "Run Compare Job"}</Button>
      </div>

      {job && (job.status === "PENDING" || job.status === "RUNNING") && (
        <JobProgressBar job={job} onCancel={async () => { await cancelJob(job.job_id); reset(); setJobId(null); }} />
      )}
      {job?.status === "FAILED" && <div className="analysis-error">{job.error}</div>}
      {job?.status === "CANCELLED" && <div className="analysis-info">Job was cancelled.</div>}

      {result && (
        <>
          <div className="panel">
            <h4>Error by model <span className="analysis-h4-note">lower is better</span></h4>
            <div className="analysis-metric-grid">
              <MetricBars title="MAE (kWh)" tip={METRIC_TIPS.MAE} rows={metricRows("mae")} format={(v) => v.toFixed(4)} markLowest />
              <MetricBars title="RMSE (kWh)" tip={METRIC_TIPS.RMSE} rows={metricRows("rmse")} format={(v) => v.toFixed(4)} markLowest />
              <MetricBars title="NMAE" tip={METRIC_TIPS.NMAE} rows={metricRows("nmae_pct")} format={(v) => `${v.toFixed(1)}%`} markLowest />
              <MetricBars title="sMAPE" tip={METRIC_TIPS.sMAPE} rows={metricRows("smape_pct")} format={(v) => `${v.toFixed(1)}%`} markLowest />
            </div>
          </div>
          <div className="panel">
            <HorizonChart title="Error by forecast horizon" series={modelKeys.filter((mk) => result.horizon[mk]).map((mk) => ({
              name: labels[mk], color: modelColor(mk),
              data: result.horizon[mk].map((d) => ({ step: d.step, mae: d.mae, rmse: d.rmse })),
            }))} />
          </div>
          {result.segments && Object.keys(result.segments).length > 0 && (
            <div className="panel">
              <button className="analysis-collapsible-btn" onClick={() => setSegOpen((v) => !v)}>
                {segOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Segment Breakdown
              </button>
              {segOpen && (() => {
                const segModelKeys = Object.keys(result.segments!);
                // Use first model's rows as the canonical list of segment rows
                const segRows = result.segments![segModelKeys[0]] ?? [];
                return (
                  <div style={{ overflowX: "auto", marginTop: 8 }}>
                    <table className="table analysis-table">
                      <thead>
                        <tr>
                          <th>Segment</th><th>Group</th>
                          {segModelKeys.map((mk) => <th key={mk} title={mk} className="is-num">{modelLabels(segModelKeys)[mk]} MAE</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {segRows.map((s) => (
                          <tr key={`${s.segment_name}-${s.segment_value}`}>
                            <td className="is-muted">{s.segment_name}</td>
                            <td>{s.segment_value}</td>
                            {segModelKeys.map((mk) => {
                              const seg = result.segments![mk]?.find((x) => x.segment_name === s.segment_name && x.segment_value === s.segment_value);
                              return <td key={mk}>{seg ? `${fmt(seg.metrics.mae)} kWh` : "—"}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
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
  const queryClient = useQueryClient();
  const { data: models } = useQuery({ queryKey: ["analysis", "models"], queryFn: listModels, staleTime: 60000 });
  const [modelKey, setModelKey] = useState("");
  const [testDays, setTestDays] = useState(90);
  const [segments, setSegments] = useState<string[]>(["weekday_weekend"]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<SegmentAnalysisResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialJob?.result) return;
    const r = initialJob.result as SegmentAnalysisResult;
    setResult(r);
    setModelKey(r.model_key);
    setSegments([...new Set(r.segments.map((x) => x.segment_name))]);
    if (typeof initialJob.payload?.test_days === "number") setTestDays(initialJob.payload.test_days);
  }, [initialJob?.job_id]);

  const selectedModel = models?.find((m) => m.model_key === modelKey);
  // Charts follow the result, not the checkboxes, which may have changed since the job ran.
  const resultSegments = result ? [...new Set(result.segments.map((x) => x.segment_name))] : [];

  const { job, reset } = useJobPoller(jobId, (j) => {
    queryClient.invalidateQueries({ queryKey: ["analysis", "jobs"] });
    if (j.status === "DONE") setResult(j.result as SegmentAnalysisResult);
    else if (j.status === "FAILED") notifyError("Segment job failed", new Error(j.error ?? "Unknown error"));
  });

  const submit = async () => {
    if (!selectedModel) return;
    try {
      setSubmitting(true);
      const res = await submitJob({ job_type: "segment", house_id: selectedModel.house_id!, lane: selectedModel.lane, model_key: modelKey, segments, test_days: testDays });
      setResult(null); reset(); setJobId(res.job_id);
    } catch (e) { notifyError("Submit failed", e as Error); } finally { setSubmitting(false); }
  };

  const toggleSeg = (s: string) =>
    setSegments((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);

  const segmentRows = (segName: string): BarRow[] =>
    result ? result.segments.filter((s) => s.segment_name === segName)
      .map((s) => ({ label: capitalize(s.segment_value), full: `${SEGMENT_LABELS[segName] ?? segName}: ${s.segment_value}`, value: s.metrics.mae, color: BAR_PALETTE[0] })) : [];

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
          <input className="analysis-text-input" type="number" min={TEST_DAYS_MIN} max={TEST_DAYS_MAX} value={testDays} aria-invalid={!testDaysValid(testDays)} onChange={(e) => setTestDays(Number(e.target.value))} />
          {!testDaysValid(testDays) && <small className="analysis-field-error">Enter {TEST_DAYS_MIN} to {TEST_DAYS_MAX} days</small>}
        </label>
      </div>
      <div className="analysis-form-field" style={{ marginBottom: 12 }}>
        <span>Segments <InfoTip tip="Dimension to slice performance by. weekday_weekend splits Mon–Fri vs Sat–Sun. season splits by meteorological season. hour_of_day splits into 4 time bands." /></span>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
          {SEGMENT_OPTIONS.map((s) => (
            <label key={s} className="analysis-check-row">
              <input type="checkbox" checked={segments.includes(s)} onChange={() => toggleSeg(s)} />
              <span>{SEGMENT_LABELS[s] ?? s}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="analysis-run-row">
        <Button variant="primary" iconLeft={<Play size={14} />} disabled={!modelKey || segments.length === 0 || !testDaysValid(testDays) || submitting} onClick={submit}>
          {submitting ? "Submitting…" : "Run Segment Analysis"}
        </Button>
      </div>

      {job && (job.status === "PENDING" || job.status === "RUNNING") && (
        <JobProgressBar job={job} onCancel={async () => { await cancelJob(job.job_id); reset(); setJobId(null); }} />
      )}
      {job?.status === "FAILED" && <div className="analysis-error">{job.error}</div>}

      {result && (
        <>
          <div className="panel"><h4>Overall Metrics</h4><MetricsRow m={result.metrics} /></div>
          <div className="panel">
            <HorizonChart title="MAE by forecast horizon" series={[{ name: modelLabels([result.model_key])[result.model_key], color: BAR_PALETTE[0], data: result.horizon.map((h) => ({ step: h.step, mae: h.mae })) }]} />
          </div>
          {resultSegments.length > 0 && (
            <div className="panel">
              <h4>MAE by segment <span className="analysis-h4-note">kWh, lower is better</span></h4>
              <div className="analysis-metric-grid">
                {resultSegments.map((seg) => (
                  <MetricBars key={seg} title={SEGMENT_LABELS[seg] ?? seg} rows={segmentRows(seg)} format={(v) => v.toFixed(4)} />
                ))}
              </div>
            </div>
          )}
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
  const queryClient = useQueryClient();
  const { data: models } = useQuery({ queryKey: ["analysis", "models"], queryFn: listModels, staleTime: 60000 });
  const warmModels = (models ?? []).filter((m) => m.model_type === "warm" && m.house_id != null);
  const [modelKey, setModelKey] = useState("");
  const [gapRates, setGapRates] = useState<number[]>([0.05, 0.1, 0.2]);
  const [gapTypes, setGapTypes] = useState<string[]>(["random"]);
  const [nSim, setNSim] = useState(5);
  const [testDays, setTestDays] = useState(30);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<MissingDataResult | null>(null);
  // The job the shown result came from, so CSV export also works for a job opened from the history.
  const [resultJobId, setResultJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialJob?.result) return;
    const r = initialJob.result as MissingDataResult;
    setResult(r);
    setResultJobId(initialJob.job_id);
    setModelKey(r.model_key);
    setGapRates([...new Set(r.results.map((x) => x.gap_rate))].sort((a, b) => a - b));
    setGapTypes([...new Set(r.results.map((x) => x.gap_type))]);
  }, [initialJob?.job_id]);

  const selectedModel = models?.find((m) => m.model_key === modelKey);

  const { job, reset } = useJobPoller(jobId, (j) => {
    queryClient.invalidateQueries({ queryKey: ["analysis", "jobs"] });
    if (j.status === "DONE") { setResult(j.result as MissingDataResult); setResultJobId(j.job_id); }
    else if (j.status === "FAILED") notifyError("Missing data job failed", new Error(j.error ?? "Unknown error"));
  });

  const submit = async () => {
    if (!selectedModel) return;
    try {
      setSubmitting(true);
      const res = await submitJob({ job_type: "missing-data", house_id: selectedModel.house_id!, lane: selectedModel.lane, model_key: modelKey, gap_rates: gapRates, gap_types: gapTypes, n_simulations: nSim, test_days: testDays });
      setResult(null); reset(); setJobId(res.job_id);
    } catch (e) { notifyError("Submit failed", e as Error); } finally { setSubmitting(false); }
  };

  const toggleRate = (r: number) => setGapRates((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r].sort((a, b) => a - b));
  const toggleType = (t: string) => setGapTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  // Line chart: one line per gap_type in the result, X = gap_rate
  const resultGapTypes = result ? GAP_TYPE_OPTIONS.filter((t) => result.results.some((r) => r.gap_type === t)) : [];
  const lineData = result ? [...new Set(result.results.map((r) => r.gap_rate))].sort((a, b) => a - b).map((rate) => {
    const row: Record<string, unknown> = { rate: `${(rate * 100).toFixed(0)}%` };
    for (const gt of resultGapTypes) {
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
          <input className="analysis-text-input" type="number" min={TEST_DAYS_MIN} max={90} value={testDays} aria-invalid={!testDaysValid(testDays, 90)} onChange={(e) => setTestDays(Number(e.target.value))} />
          {!testDaysValid(testDays, 90) && <small className="analysis-field-error">Enter {TEST_DAYS_MIN} to 90 days</small>}
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
      <div className="analysis-run-row">
        <Button variant="primary" iconLeft={<Play size={14} />} disabled={!modelKey || gapRates.length === 0 || gapTypes.length === 0 || !testDaysValid(testDays, 90) || submitting} onClick={submit}>
          {submitting ? "Submitting…" : "Run Missing Data Test"}
        </Button>
      </div>

      {job && (job.status === "PENDING" || job.status === "RUNNING") && (
        <JobProgressBar job={job} onCancel={async () => { await cancelJob(job.job_id); reset(); setJobId(null); }} />
      )}
      {job?.status === "FAILED" && <div className="analysis-error">{job.error}</div>}

      {result && (
        <>
          <div className="panel">
            <div className="analysis-toolbar" style={{ marginBottom: 8 }}>
              <h4>MAE by share of missing inputs</h4>
              {resultJobId && (
                <Button variant="secondary" size="sm" iconLeft={<Download size={13} />}
                  onClick={() => { window.location.href = getExportUrl(resultJobId); }}>CSV</Button>
              )}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={lineData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="rate" tick={{ fontSize: 11, fill: "var(--text-soft)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-soft)" }} width={48} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={formatTooltipValue} />
                <Legend wrapperStyle={{ fontSize: "0.8rem" }} formatter={legendText} />
                {resultGapTypes.map((t, i) => (
                  <Line key={t} type="monotone" dataKey={t} name={`${capitalize(t)} gaps`} stroke={BAR_PALETTE[i]} dot={{ r: 4 }} strokeWidth={2} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="panel" style={{ padding: 0 }}>
            <div style={{ overflowX: "auto" }}>
              <table className="table analysis-table">
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
  const queryClient = useQueryClient();
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
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialJob?.result) return;
    setResult(initialJob.result as HpTuneResult);
    if (typeof initialJob.payload?.model_key === "string") setModelKey(initialJob.payload.model_key);
  }, [initialJob?.job_id]);

  const selectedModel = models?.find((m) => m.model_key === modelKey);

  const { job, reset } = useJobPoller(jobId, (j) => {
    queryClient.invalidateQueries({ queryKey: ["analysis", "jobs"] });
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
      setSubmitting(true);
      const payload: SubmitPayload = { job_type: "hyperparameter-tune", house_id: selectedModel.house_id!, lane: selectedModel.lane, model_key: modelKey, strategy, n_trials: strategy === "random" ? nTrials : undefined, param_space: buildParamSpace() };
      const res = await submitJob(payload);
      setResult(null); reset(); setJobId(res.job_id);
    } catch (e) { notifyError("Submit failed", e as Error); } finally { setSubmitting(false); }
  };

  const bestTrial = result?.results.length ? result.results.reduce((b, c) => (c.metrics.mae < b.metrics.mae ? c : b)).trial : null;
  const scatterData = result ? result.results.map((t) => ({ trial: t.trial, mae: t.metrics.mae, best: t.trial === bestTrial })) : [];

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
              <button key={s} type="button" aria-pressed={strategy === s} className={`predictor-lane-btn${strategy === s ? " is-active" : ""}`} onClick={() => setStrategy(s)}>{s === "random" ? "Random" : "Grid"}</button>
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
                <button key={t} type="button" aria-pressed={row.specType === t} className={`predictor-lane-btn${row.specType === t ? " is-active" : ""}`} onClick={() => updateRow(row.id, { specType: t })}>{t === "choice" ? "List" : "Range"}</button>
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

      <div className="analysis-run-row">
        <Button variant="primary" iconLeft={<Play size={14} />} disabled={!modelKey || paramRows.length === 0 || submitting} onClick={submit}>
          {submitting ? "Submitting…" : "Start Tuning"}
        </Button>
      </div>

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
                    <div key={k}>{k}: <strong>{fmtParam(v)}</strong></div>
                  ))}
                </div>
              </div>
              <div><span className="is-muted" style={{ fontSize: "0.8rem" }}>Best Metrics</span><MetricsRow m={result.best_metrics} /></div>
            </div>
          </div>
          <div className="panel">
            <h4>MAE per trial <span className="analysis-h4-note">best trial in orange</span></h4>
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="trial" name="Trial" tick={{ fontSize: 10, fill: "var(--text-soft)" }} type="number" />
                <YAxis dataKey="mae" name="MAE" tick={{ fontSize: 10, fill: "var(--text-soft)" }} width={52}
                  domain={[(min: number) => min * 0.97, (max: number) => max * 1.03]} tickFormatter={(v: number) => v.toFixed(4)} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={formatTooltipValue} />
                <Scatter data={scatterData} name="Trial" fill={BAR_PALETTE[0]}>
                  {scatterData.map((d, i) => <Cell key={i} fill={d.best ? BAR_PALETTE[1] : BAR_PALETTE[0]} r={d.best ? 7 : 4} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="panel" style={{ padding: 0 }}>
            <div style={{ overflowX: "auto", maxHeight: 360 }}>
              <table className="table analysis-table">
                <thead>
                  <tr>
                    <th>#</th>
                    {Object.keys(result.best_params).map((k) => <th key={k} className="is-num">{k}</th>)}
                    <th className="is-num">MAE</th><th className="is-num">RMSE</th><th className="is-num">R²</th>
                  </tr>
                </thead>
                <tbody>
                  {[...result.results].sort((a, b) => a.metrics.mae - b.metrics.mae).map((t) => (
                    <tr key={t.trial} className={t.trial === bestTrial ? "is-best" : undefined}>
                      <td className="is-muted">{t.trial}</td>
                      {Object.keys(result.best_params).map((k) => <td key={k} className="is-num">{fmtParam(t.params[k])}</td>)}
                      <td className="is-num">{fmt(t.metrics.mae)}</td><td className="is-num">{fmt(t.metrics.rmse)}</td><td className="is-num">{fmt(t.metrics.r2)}</td>
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

function JobHistoryPanel({ onLoadJob, timezone }: { onLoadJob: (job: AnalysisJob, tabIndex: number) => void; timezone: string }) {
  const queryClient = useQueryClient();
  const { notifyError } = useApiFeedback();
  const [open, setOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const { data: jobs, refetch, isLoading, isFetching, isError } = useQuery({
    queryKey: ["analysis", "jobs"],
    queryFn: listJobs,
    staleTime: 10000,
    enabled: open,
    // Keep running jobs moving while the panel is open.
    refetchInterval: (query) => (query.state.data?.some((j) => j.status === "PENDING" || j.status === "RUNNING") ? 5000 : false),
  });

  const TAB_INDEX: Record<string, number> = { compare: 2, segment: 3, "missing-data": 4, "hyperparameter-tune": 5 };

  return (
    <div className="panel analysis-history-panel">
      <div className="analysis-collapsible-header">
        <button className="analysis-collapsible-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Job History
        </button>
        {open && <span className="analysis-history-hint">Open a finished job to see its results again.</span>}
        <Button variant="secondary" size="sm" iconLeft={<RefreshCcw size={12} className={isFetching ? "is-spinning" : ""} />}
          onClick={() => refetch()} disabled={isFetching}>Refresh</Button>
      </div>
      {open && (
        isLoading ? <EVChargingLoader label="Loading history…" /> : isError ? (
          <div className="analysis-error">The job history could not be loaded. Try Refresh.</div>
        ) : (
          <div className="analysis-table-scroll" style={{ marginTop: 10 }}>
            <table className="table analysis-table">
              <thead>
                <tr><th>Type</th><th>Status</th><th>House</th><th>Lane</th><th>Submitted</th><th>Progress</th><th>Job</th><th></th></tr>
              </thead>
              <tbody>
                {(jobs ?? []).length === 0 && (
                  <tr><td colSpan={8} className="analysis-table-empty">No analysis jobs yet.</td></tr>
                )}
                {(jobs ?? []).map((j) => {
                  const done = j.status === "DONE";
                  // The list leaves results out; fetch this job's in full to open it.
                  const openJob = async () => {
                    if (openingId) return;
                    setOpeningId(j.job_id);
                    try {
                      const full = await queryClient.fetchQuery({ queryKey: ["analysis", "job", j.job_id], queryFn: () => getJob(j.job_id), staleTime: Infinity });
                      onLoadJob(full, TAB_INDEX[j.job_type] ?? 0);
                    } catch (err) {
                      notifyError("Job could not be opened", err);
                    } finally {
                      setOpeningId(null);
                    }
                  };
                  const lane = typeof j.payload?.lane === "string" ? j.payload.lane : null;
                  return (
                  <tr key={j.job_id} className={done ? `is-clickable${openingId === j.job_id ? " is-opening" : ""}` : undefined} tabIndex={done ? 0 : undefined}
                    aria-busy={openingId === j.job_id || undefined}
                    onClick={done ? openJob : undefined}
                    onKeyDown={done ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void openJob(); } } : undefined}>
                    <td>
                      {JOB_TYPE_LABELS[j.job_type] ?? j.job_type}
                      {j.status === "FAILED" && j.error && <div className="analysis-history-error">{j.error}</div>}
                    </td>
                    <td><Badge tone={statusTone(j.status)}>{JOB_STATUS_LABELS[j.status] ?? j.status}</Badge></td>
                    <td>{typeof j.payload?.house_id === "string" ? j.payload.house_id : "—"}</td>
                    <td className="is-muted">{lane ? LANE_LABELS[lane] ?? lane : "—"}</td>
                    <td className="is-muted">{fmtTs(j.submitted_at, timezone)}</td>
                    <td style={{ minWidth: 100 }}>
                      <div className="predictor-progress-bar" role="progressbar" aria-valuenow={j.progress} aria-valuemin={0} aria-valuemax={100}>
                        <div className="predictor-progress-fill" style={{ width: `${j.progress}%` }} />
                      </div>
                    </td>
                    <td className="is-muted"><code title={j.job_id}>{j.job_id.slice(0, 8)}</code></td>
                    <td>
                      {done && (
                        <button className="icon-btn" title="Download CSV" aria-label="Download CSV"
                          onClick={(e) => { e.stopPropagation(); window.location.href = getExportUrl(j.job_id); }}>
                          <Download size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })}
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

export function AnalysisView({ timezone }: { timezone: string }) {
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
      <div className="analysis-tabs-bar" role="tablist" aria-label="Analysis tools">
        {TABS.map((t, i) => (
          <button key={t} type="button" role="tab" aria-selected={activeTab === i} className={`predictor-tab${activeTab === i ? " is-active" : ""}`} onClick={() => switchTab(i)}>
            {t}
          </button>
        ))}
      </div>

      <div className="analysis-tab-content">
        {mountedTabs.has(0) && <div className={activeTab === 0 ? "analysis-tab-pane is-active" : "analysis-tab-pane"}><ModelBrowserTab onOpenFeatureImportance={handleOpenFI} timezone={timezone} /></div>}
        {mountedTabs.has(1) && <div className={activeTab === 1 ? "analysis-tab-pane is-active" : "analysis-tab-pane"}><FeatureImportanceTab initialModelKey={fiModelKey} /></div>}
        {mountedTabs.has(2) && <div className={activeTab === 2 ? "analysis-tab-pane is-active" : "analysis-tab-pane"}><CompareModelsTab initialJob={loadedJobs[2]} /></div>}
        {mountedTabs.has(3) && <div className={activeTab === 3 ? "analysis-tab-pane is-active" : "analysis-tab-pane"}><SegmentAnalysisTab initialJob={loadedJobs[3]} /></div>}
        {mountedTabs.has(4) && <div className={activeTab === 4 ? "analysis-tab-pane is-active" : "analysis-tab-pane"}><MissingDataTab initialJob={loadedJobs[4]} /></div>}
        {mountedTabs.has(5) && <div className={activeTab === 5 ? "analysis-tab-pane is-active" : "analysis-tab-pane"}><HpTuningTab initialJob={loadedJobs[5]} /></div>}
      </div>

      <JobHistoryPanel onLoadJob={handleLoadJob} timezone={timezone} />
    </div>
  );
}
