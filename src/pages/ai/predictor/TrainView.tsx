import { usePredictorTrainingProgress, usePredictorCommand, useCancelTrainingJob } from "../../../hooks/usePredictor";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Modal } from "../../../components/ui/Modal";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import { useState } from "react";
import { PlusCircle, RotateCcw, Plus, Trash2 } from "lucide-react";
import type { ModelBackend, TrainingJob } from "../../../api/predictorApi";

// ─── LSTM layer types ─────────────────────────────────────────────────────────

type LSTMLayerType = "linear" | "relu" | "lstm" | "dropout";

interface LSTMLayer {
  id: string;
  type: LSTMLayerType;
  out?: string;
  hidden?: string;
  num_layers?: string;
  p?: string;
}

const LAYER_COLORS: Record<LSTMLayerType, string> = {
  linear:  "#3b82f6",
  relu:    "#22c55e",
  lstm:    "#8b5cf6",
  dropout: "#f97316",
};

const LAYER_LABELS: Record<LSTMLayerType, string> = {
  linear:  "Linear",
  relu:    "ReLU",
  lstm:    "LSTM",
  dropout: "Dropout",
};

function makeLayer(type: LSTMLayerType): LSTMLayer {
  const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (type === "linear")  return { id, type, out: "64" };
  if (type === "lstm")    return { id, type, hidden: "256", num_layers: "2" };
  if (type === "dropout") return { id, type, p: "0.3" };
  return { id, type };
}

function serializeLayer(l: LSTMLayer): Record<string, unknown> {
  if (l.type === "linear")  return { type: "linear", out: Number(l.out ?? 64) };
  if (l.type === "lstm")    return { type: "lstm", hidden: Number(l.hidden ?? 256), num_layers: Number(l.num_layers ?? 2) };
  if (l.type === "dropout") return { type: "dropout", p: Number(l.p ?? 0.3) };
  return { type: "relu" };
}

// ─── Default hyperparams ──────────────────────────────────────────────────────

const XGB_DEFAULTS = { n_estimators: "500", max_depth: "7", learning_rate: "0.1", subsample: "0.8", colsample_bytree: "0.8", min_child_weight: "1" } as const;
type XGBKey = keyof typeof XGB_DEFAULTS;

const LGBM_DEFAULTS = { objective: "tweedie", n_estimators: "1000", max_depth: "-1", learning_rate: "0.03", num_leaves: "127", subsample: "0.8", colsample_bytree: "0.7", min_child_samples: "10", reg_alpha: "0.1", reg_lambda: "1.0" } as const;
type LGBMKey = keyof typeof LGBM_DEFAULTS;

const LSTM_DEFAULTS = { lookback: "672", epochs: "100", batch_size: "64", lr: "0.001", patience: "20" } as const;
type LSTMKey = keyof typeof LSTM_DEFAULTS;

// ─── Small number input ───────────────────────────────────────────────────────

function HpNumInput({ label, value, onChange, step, min, max }: {
  label: string; value: string; onChange: (v: string) => void;
  step?: string; min?: string | number; max?: string | number;
}) {
  return (
    <label className="hp-field">
      <span className="hp-field-label">{label}</span>
      <input type="number" className="analysis-text-input hp-input" value={value}
        step={step} min={min} max={max} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// ─── Per-model hyperparams forms ──────────────────────────────────────────────

function XGBForm({ schema, onSchemaChange, params, onChange }: {
  schema: "dense" | "sparse";
  onSchemaChange: (v: "dense" | "sparse") => void;
  params: { [K in XGBKey]: string };
  onChange: (k: XGBKey, v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label className="train-modal-config-field">
        <span>Feature schema</span>
        <select className="predictor-house-select" value={schema} onChange={(e) => onSchemaChange(e.target.value as "dense" | "sparse")}>
          <option value="dense">Dense</option>
          <option value="sparse">Sparse</option>
        </select>
      </label>
      <div>
        <div className="train-modal-section-title">Hyperparameters</div>
        <div className="hp-grid" style={{ marginTop: 8 }}>
          <HpNumInput label="n_estimators" value={params.n_estimators} min={10} onChange={(v) => onChange("n_estimators", v)} />
          <HpNumInput label="max_depth" value={params.max_depth} min={1} max={20} onChange={(v) => onChange("max_depth", v)} />
          <HpNumInput label="learning_rate" value={params.learning_rate} step="0.001" min={0} onChange={(v) => onChange("learning_rate", v)} />
          <HpNumInput label="subsample" value={params.subsample} step="0.05" min={0} max={1} onChange={(v) => onChange("subsample", v)} />
          <HpNumInput label="colsample_bytree" value={params.colsample_bytree} step="0.05" min={0} max={1} onChange={(v) => onChange("colsample_bytree", v)} />
          <HpNumInput label="min_child_weight" value={params.min_child_weight} min={0} onChange={(v) => onChange("min_child_weight", v)} />
        </div>
      </div>
    </div>
  );
}

function LGBMForm({ params, onChange }: {
  params: { [K in LGBMKey]: string };
  onChange: (k: LGBMKey, v: string) => void;
}) {
  return (
    <div>
      <div className="train-modal-section-title">Hyperparameters</div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
        <label className="hp-field">
          <span className="hp-field-label">objective</span>
          <select className="predictor-house-select" value={params.objective} onChange={(e) => onChange("objective", e.target.value)}>
            <option value="tweedie">tweedie</option>
            <option value="regression">regression</option>
            <option value="huber">huber</option>
          </select>
        </label>
        <div className="hp-grid">
          <HpNumInput label="n_estimators" value={params.n_estimators} min={10} onChange={(v) => onChange("n_estimators", v)} />
          <HpNumInput label="max_depth" value={params.max_depth} min={-1} onChange={(v) => onChange("max_depth", v)} />
          <HpNumInput label="learning_rate" value={params.learning_rate} step="0.001" min={0} onChange={(v) => onChange("learning_rate", v)} />
          <HpNumInput label="num_leaves" value={params.num_leaves} min={2} onChange={(v) => onChange("num_leaves", v)} />
          <HpNumInput label="subsample" value={params.subsample} step="0.05" min={0} max={1} onChange={(v) => onChange("subsample", v)} />
          <HpNumInput label="colsample_bytree" value={params.colsample_bytree} step="0.05" min={0} max={1} onChange={(v) => onChange("colsample_bytree", v)} />
          <HpNumInput label="min_child_samples" value={params.min_child_samples} min={1} onChange={(v) => onChange("min_child_samples", v)} />
          <HpNumInput label="reg_alpha" value={params.reg_alpha} step="0.01" min={0} onChange={(v) => onChange("reg_alpha", v)} />
          <HpNumInput label="reg_lambda" value={params.reg_lambda} step="0.1" min={0} onChange={(v) => onChange("reg_lambda", v)} />
        </div>
      </div>
    </div>
  );
}

function LSTMLayerCard({ layer, onChange, onDelete }: {
  layer: LSTMLayer;
  onChange: (l: LSTMLayer) => void;
  onDelete: () => void;
}) {
  const color = LAYER_COLORS[layer.type];
  return (
    <div className="lstm-layer-card">
      <div className="lstm-layer-card-inner">
        <div className="lstm-layer-accent" style={{ background: color }} />
        <span className="lstm-layer-type-badge" style={{ background: `color-mix(in srgb, ${color} 15%, var(--bg-elev))`, color }}>
          {LAYER_LABELS[layer.type]}
        </span>
        <div className="lstm-layer-params">
          {layer.type === "linear" && (
            <div className="lstm-layer-param">
              <span className="lstm-layer-param-label">out</span>
              <input type="number" className="lstm-layer-param-input" value={layer.out ?? "64"} min={1}
                onChange={(e) => onChange({ ...layer, out: e.target.value })} />
            </div>
          )}
          {layer.type === "lstm" && (
            <>
              <div className="lstm-layer-param">
                <span className="lstm-layer-param-label">hidden</span>
                <input type="number" className="lstm-layer-param-input" value={layer.hidden ?? "256"} min={1}
                  onChange={(e) => onChange({ ...layer, hidden: e.target.value })} />
              </div>
              <div className="lstm-layer-param">
                <span className="lstm-layer-param-label">num_layers</span>
                <input type="number" className="lstm-layer-param-input" value={layer.num_layers ?? "2"} min={1} max={8}
                  onChange={(e) => onChange({ ...layer, num_layers: e.target.value })} />
              </div>
            </>
          )}
          {layer.type === "dropout" && (
            <div className="lstm-layer-param">
              <span className="lstm-layer-param-label">p</span>
              <input type="number" className="lstm-layer-param-input" value={layer.p ?? "0.3"} min={0} max={1} step="0.05"
                onChange={(e) => onChange({ ...layer, p: e.target.value })} />
            </div>
          )}
          {layer.type === "relu" && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-soft)", fontStyle: "italic" }}>no params</span>
          )}
        </div>
        <button className="lstm-layer-delete" onClick={onDelete} title="Remove layer">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function LSTMForm({ params, onChange, layers, onLayersChange }: {
  params: { [K in LSTMKey]: string };
  onChange: (k: LSTMKey, v: string) => void;
  layers: LSTMLayer[];
  onLayersChange: (l: LSTMLayer[]) => void;
}) {
  const updateLayer = (id: string, updated: LSTMLayer) =>
    onLayersChange(layers.map((l) => (l.id === id ? updated : l)));
  const deleteLayer = (id: string) =>
    onLayersChange(layers.filter((l) => l.id !== id));
  const addLayer = (type: LSTMLayerType) =>
    onLayersChange([...layers, makeLayer(type)]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div className="train-modal-section-title">Training Hyperparameters</div>
        <div className="hp-grid" style={{ marginTop: 8 }}>
          <HpNumInput label="lookback" value={params.lookback} min={1} onChange={(v) => onChange("lookback", v)} />
          <HpNumInput label="epochs" value={params.epochs} min={1} onChange={(v) => onChange("epochs", v)} />
          <HpNumInput label="batch_size" value={params.batch_size} min={1} onChange={(v) => onChange("batch_size", v)} />
          <HpNumInput label="lr" value={params.lr} step="0.0001" min={0} onChange={(v) => onChange("lr", v)} />
          <HpNumInput label="patience" value={params.patience} min={1} onChange={(v) => onChange("patience", v)} />
        </div>
      </div>

      <div>
        <div className="train-modal-section-title" style={{ marginBottom: 10 }}>Architecture <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-soft)" }}>(optional — omit to use default)</span></div>
        <div className="lstm-builder">
          <div className="lstm-io-node">▶ Input</div>
          {layers.length === 0 && (
            <p className="lstm-empty-hint">No custom layers — model uses its built-in default architecture</p>
          )}
          {layers.map((layer) => (
            <div key={layer.id}>
              <div className="lstm-connector" />
              <LSTMLayerCard
                layer={layer}
                onChange={(updated) => updateLayer(layer.id, updated)}
                onDelete={() => deleteLayer(layer.id)}
              />
            </div>
          ))}
          {layers.length > 0 && (
            <>
              <div className="lstm-connector" />
              <div className="lstm-io-node">◀ Output</div>
            </>
          )}
        </div>
        <div className="lstm-add-layer-row">
          {(["linear", "relu", "lstm", "dropout"] as LSTMLayerType[]).map((t) => (
            <button key={t} className="lstm-add-type-btn"
              style={{ borderColor: `color-mix(in srgb, ${LAYER_COLORS[t]} 40%, var(--line))`, color: LAYER_COLORS[t] }}
              onClick={() => addLayer(t)}>
              <Plus size={11} />
              {LAYER_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface TrainViewProps {
  selectedHouseId: string | null;
}

function fmtElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtTs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function getStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "RUNNING" || status === "FETCHING") return "info";
  if (status === "ACCEPTED") return "success";
  if (status === "REJECTED") return "warning";
  if (status === "FAILED") return "danger";
  return "neutral";
}

const ACTIVE_STATUSES = ["PENDING", "FETCHING", "RUNNING"];

function JobDetailModal({ job, onClose, onCancel, cancelling }: {
  job: TrainingJob;
  onClose: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const isActive = ACTIVE_STATUSES.includes(job.status);
  const pct = job.percent ?? (job.progress_total > 0 ? (job.progress_current / job.progress_total) * 100 : 0);
  const improved = job.new_mae != null && job.prev_mae != null && job.new_mae < job.prev_mae;

  return (
    <Modal title="Job Details" open onClose={onClose} width="sm">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="train-detail-section">
          <div className="train-detail-row">
            <span className="train-detail-label">Job ID</span>
            <span style={{ fontFamily: "monospace", fontSize: "0.8rem", wordBreak: "break-all" }}>{job.job_id}</span>
          </div>
          <div className="train-detail-row">
            <span className="train-detail-label">House</span>
            <span>{job.house_id}</span>
          </div>
          <div className="train-detail-row">
            <span className="train-detail-label">Lane</span>
            <span style={{ textTransform: "capitalize" }}>{job.lane}</span>
          </div>
          <div className="train-detail-row">
            <span className="train-detail-label">Type</span>
            <Badge tone="neutral">{job.model_type ?? "—"}</Badge>
          </div>
          <div className="train-detail-row">
            <span className="train-detail-label">Status</span>
            <Badge tone={getStatusTone(job.status)}>{job.status}</Badge>
          </div>
        </div>

        <div className="train-detail-section">
          <div className="train-detail-row">
            <span className="train-detail-label">Progress</span>
            <span>{job.progress_current} / {job.progress_total} ({pct.toFixed(1)}%)</span>
          </div>
          <div style={{ margin: "2px 0 4px" }}>
            <div className="predictor-progress-bar" style={{ height: 6 }}>
              <div className="predictor-progress-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
          </div>
          <div className="train-detail-row">
            <span className="train-detail-label">ETA</span>
            <span>{job.eta ?? "—"}</span>
          </div>
          <div className="train-detail-row">
            <span className="train-detail-label">Elapsed</span>
            <span>{fmtElapsed(job.elapsed_seconds ?? 0)}</span>
          </div>
        </div>

        <div className="train-detail-section">
          <div className="train-detail-row">
            <span className="train-detail-label">Submitted</span>
            <span className="is-muted" style={{ fontSize: "0.82rem" }}>{fmtTs(job.submitted_at)}</span>
          </div>
          <div className="train-detail-row">
            <span className="train-detail-label">Started</span>
            <span className="is-muted" style={{ fontSize: "0.82rem" }}>{fmtTs(job.started_at)}</span>
          </div>
          <div className="train-detail-row">
            <span className="train-detail-label">Finished</span>
            <span className="is-muted" style={{ fontSize: "0.82rem" }}>{fmtTs(job.finished_at)}</span>
          </div>
        </div>

        <div className="train-detail-section">
          {job.result_message && (
            <div className="train-detail-row">
              <span className="train-detail-label">Result</span>
              <span>{job.result_message}</span>
            </div>
          )}
          <div className="train-detail-row">
            <span className="train-detail-label">Prev MAE</span>
            <span className="is-muted">{job.prev_mae?.toFixed(4) ?? "—"}</span>
          </div>
          <div className="train-detail-row">
            <span className="train-detail-label">New MAE</span>
            <span style={{ fontWeight: 600, color: improved ? "var(--ok)" : "inherit" }}>
              {job.new_mae?.toFixed(4) ?? "—"}
              {improved && <span style={{ marginLeft: 6, fontSize: "0.78rem", color: "var(--ok)" }}>▼ improved</span>}
            </span>
          </div>
        </div>

        {job.hyperparams && Object.keys(job.hyperparams).length > 0 && (
          <div className="train-detail-section">
            <div className="train-modal-section-title" style={{ marginBottom: 8 }}>Hyperparameters</div>
            <div className="analysis-hyperparams-grid">
              {Object.entries(job.hyperparams).filter(([k]) => k !== "layers").map(([k, v]) => (
                <div key={k} className="analysis-hp-chip">
                  <span className="analysis-hp-chip-key">{k}</span>
                  <span className="analysis-hp-chip-val">{String(v)}</span>
                </div>
              ))}
            </div>
            {Array.isArray((job.hyperparams as Record<string, unknown>).layers) && (
              <div style={{ marginTop: 10 }}>
                <div className="hp-field-label" style={{ marginBottom: 6 }}>Architecture</div>
                <div className="analysis-layers-list">
                  {((job.hyperparams as Record<string, unknown[]>).layers as Record<string, unknown>[]).map((l, i) => (
                    <div key={i} className="analysis-layer-item">
                      <div className="analysis-layer-dot" style={{ background: LAYER_COLORS[(l.type as LSTMLayerType)] ?? "#888" }} />
                      <span className="analysis-layer-type">{String(l.type)}</span>
                      <span className="analysis-layer-params">
                        {l.type === "linear" ? `out=${l.out}` : l.type === "lstm" ? `hidden=${l.hidden}, layers=${l.num_layers}` : l.type === "dropout" ? `p=${l.p}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {isActive && (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="danger" size="sm" onClick={onCancel} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel Job"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function TrainView({ selectedHouseId }: TrainViewProps) {
  const { notifySuccess, notifyError } = useApiFeedback();
  const { data: jobs } = usePredictorTrainingProgress();
  const commandMutation = usePredictorCommand();
  const cancelMutation = useCancelTrainingJob();

  const [showTrainDialog, setShowTrainDialog] = useState(false);
  const [showColdTrainDialog, setShowColdTrainDialog] = useState(false);
  const [detailJob, setDetailJob] = useState<TrainingJob | null>(null);
  const [trainModelType, setTrainModelType] = useState<ModelBackend>("xgboost");
  const [trainSchema, setTrainSchema] = useState<"dense" | "sparse">("dense");

  // Hyperparams state
  const [xgbParams, setXgbParams] = useState<{ [K in XGBKey]: string }>({ ...XGB_DEFAULTS });
  const [lgbmParams, setLgbmParams] = useState<{ [K in LGBMKey]: string }>({ ...LGBM_DEFAULTS });
  const [lstmParams, setLstmParams] = useState<{ [K in LSTMKey]: string }>({ ...LSTM_DEFAULTS });
  const [lstmLayers, setLstmLayers] = useState<LSTMLayer[]>([]);

  function buildHyperparams(): Record<string, unknown> {
    if (trainModelType === "xgboost") {
      return {
        n_estimators: Number(xgbParams.n_estimators),
        max_depth: Number(xgbParams.max_depth),
        learning_rate: Number(xgbParams.learning_rate),
        subsample: Number(xgbParams.subsample),
        colsample_bytree: Number(xgbParams.colsample_bytree),
        min_child_weight: Number(xgbParams.min_child_weight),
      };
    }
    if (trainModelType === "lgbm") {
      return {
        objective: lgbmParams.objective,
        n_estimators: Number(lgbmParams.n_estimators),
        max_depth: Number(lgbmParams.max_depth),
        learning_rate: Number(lgbmParams.learning_rate),
        num_leaves: Number(lgbmParams.num_leaves),
        subsample: Number(lgbmParams.subsample),
        colsample_bytree: Number(lgbmParams.colsample_bytree),
        min_child_samples: Number(lgbmParams.min_child_samples),
        reg_alpha: Number(lgbmParams.reg_alpha),
        reg_lambda: Number(lgbmParams.reg_lambda),
      };
    }
    // lstm
    const hp: Record<string, unknown> = {
      lookback: Number(lstmParams.lookback),
      epochs: Number(lstmParams.epochs),
      batch_size: Number(lstmParams.batch_size),
      lr: Number(lstmParams.lr),
      patience: Number(lstmParams.patience),
    };
    if (lstmLayers.length > 0) hp.layers = lstmLayers.map(serializeLayer);
    return hp;
  }

  const activeJobs = jobs?.filter((j) => ACTIVE_STATUSES.includes(j.status)) ?? [];
  const completedJobs = jobs?.filter((j) => !ACTIVE_STATUSES.includes(j.status)) ?? [];

  const handleTrain = () => {
    if (!selectedHouseId) return;
    commandMutation.mutate(
      {
        command: "train",
        house_id: selectedHouseId,
        lane: "both",
        model_type: trainModelType,
        ...(trainModelType === "xgboost" ? { model_schema: trainSchema } : {}),
        hyperparams: buildHyperparams(),
      },
      {
        onSuccess: (res) => { notifySuccess("Training Queued", res.message); setShowTrainDialog(false); },
        onError: (err) => notifyError("Training Error", err),
      }
    );
  };

  const handleColdTrain = () => {
    commandMutation.mutate(
      { command: "train-cold", lane: "both" },
      {
        onSuccess: (res) => { notifySuccess("Cold Training", res.message); setShowColdTrainDialog(false); },
        onError: (err) => notifyError("Training Error", err),
      }
    );
  };

  const handleCancelJob = () => {
    if (!detailJob) return;
    cancelMutation.mutate(detailJob.job_id, {
      onSuccess: () => { notifySuccess("Job Cancelled", "Job cancelled successfully."); setDetailJob(null); },
      onError: (err) => notifyError("Cancel Error", err),
    });
  };

  return (
    <div className="predictor-train-view">
      <div className="predictor-train-actions">
        <Button
          variant="primary"
          iconLeft={<PlusCircle size={15} />}
          onClick={() => setShowTrainDialog(true)}
          disabled={!selectedHouseId || commandMutation.isPending}
        >
          Train Selected House
        </Button>
        <Button
          variant="secondary"
          iconLeft={<RotateCcw size={15} />}
          onClick={() => setShowColdTrainDialog(true)}
          disabled={commandMutation.isPending}
        >
          Retrain Cold-Start Models
        </Button>
      </div>

      <div className="predictor-train-grid">
        {/* Active jobs */}
        <div className="panel" style={{ padding: 0 }}>
          <div className="predictor-panel-header">
            <h2>Active Training Jobs</h2>
            {activeJobs.length > 0 && (
              <Badge tone="info">{activeJobs.length} running</Badge>
            )}
          </div>
          <div className="predictor-panel-body">
            {activeJobs.length === 0 ? (
              <EmptyState title="No active jobs" message="Submit a training job above to get started." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>House</th>
                    <th>Lane</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th style={{ minWidth: 140 }}>Progress</th>
                    <th>ETA</th>
                  </tr>
                </thead>
                <tbody>
                  {activeJobs.map((job, idx) => {
                    const pct = job.percent ?? (job.progress_total > 0 ? (job.progress_current / job.progress_total) * 100 : 0);
                    return (
                      <tr key={`${job.job_id}-${idx}`} className="is-clickable" onClick={() => setDetailJob(job)}>
                        <td>{job.house_id}</td>
                        <td style={{ textTransform: "capitalize" }}>{job.lane}</td>
                        <td><Badge tone="neutral">{job.model_type ?? "—"}</Badge></td>
                        <td><Badge tone={getStatusTone(job.status)}>{job.status}</Badge></td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div className="predictor-progress-bar" style={{ flex: 1 }}>
                              <div className="predictor-progress-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                            <span className="is-muted" style={{ fontSize: "0.72rem", whiteSpace: "nowrap" }}>{pct.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="is-muted" style={{ fontSize: "0.8rem" }}>{job.eta ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Completed history */}
        <div className="panel" style={{ padding: 0 }}>
          <div className="predictor-panel-header">
            <h2>Completed History</h2>
          </div>
          <div className="predictor-panel-body" style={{ maxHeight: 500, overflowY: "auto" }}>
            {completedJobs.length === 0 ? (
              <EmptyState title="No completed jobs" message="Finished training runs will appear here." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>House</th>
                    <th>Lane</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Prev MAE</th>
                    <th>New MAE</th>
                  </tr>
                </thead>
                <tbody>
                  {completedJobs.slice(0, 50).map((job, idx) => {
                    const improved = job.new_mae != null && job.prev_mae != null && job.new_mae < job.prev_mae;
                    return (
                      <tr key={`${job.job_id}-${idx}`} className="is-clickable" onClick={() => setDetailJob(job)}>
                        <td>{job.house_id}</td>
                        <td style={{ textTransform: "capitalize" }}>{job.lane}</td>
                        <td><Badge tone="neutral">{job.model_type ?? "—"}</Badge></td>
                        <td><Badge tone={getStatusTone(job.status)}>{job.status}</Badge></td>
                        <td className="is-muted">{job.prev_mae?.toFixed(4) ?? "—"}</td>
                        <td style={{ fontWeight: 600, color: improved ? "var(--ok)" : "inherit" }}>
                          {job.new_mae?.toFixed(4) ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {detailJob && (
        <JobDetailModal
          job={detailJob}
          onClose={() => setDetailJob(null)}
          onCancel={handleCancelJob}
          cancelling={cancelMutation.isPending}
        />
      )}

      <ConfirmDialog
        open={showColdTrainDialog}
        title="Retrain Cold-Start Model"
        message="This will submit a distributed cold-start training job across all houses in the cluster."
        confirmLabel="Start Cold Training"
        confirmVariant="primary"
        pending={commandMutation.isPending}
        onConfirm={handleColdTrain}
        onCancel={() => setShowColdTrainDialog(false)}
      />

      {/* ── Train config modal ── */}
      <Modal title={`Train — ${selectedHouseId ?? ""}`} open={showTrainDialog} onClose={() => setShowTrainDialog(false)} width="lg">
        <div className="train-modal-body">
          {/* Top config row */}
          <div className="train-modal-config-row">
            <label className="train-modal-config-field">
              <span>Model type</span>
              <select
                className="predictor-house-select"
                value={trainModelType}
                onChange={(e) => setTrainModelType(e.target.value as ModelBackend)}
              >
                <option value="xgboost">XGBoost</option>
                <option value="lgbm">LightGBM</option>
                <option value="lstm">LSTM</option>
              </select>
            </label>
          </div>

          <p style={{ margin: 0, fontSize: "0.83rem", color: "var(--text-soft)" }}>
            All fields are optional — omitting any falls back to the server-side production defaults.
          </p>

          {/* Per-model hyperparams */}
          <div className="train-modal-hp-area">
            {trainModelType === "xgboost" && (
              <XGBForm
                schema={trainSchema}
                onSchemaChange={setTrainSchema}
                params={xgbParams}
                onChange={(k, v) => setXgbParams((p) => ({ ...p, [k]: v }))}
              />
            )}
            {trainModelType === "lgbm" && (
              <LGBMForm
                params={lgbmParams}
                onChange={(k, v) => setLgbmParams((p) => ({ ...p, [k]: v }))}
              />
            )}
            {trainModelType === "lstm" && (
              <LSTMForm
                params={lstmParams}
                onChange={(k, v) => setLstmParams((p) => ({ ...p, [k]: v }))}
                layers={lstmLayers}
                onLayersChange={setLstmLayers}
              />
            )}
          </div>

          <div className="train-modal-footer">
            <Button variant="secondary" onClick={() => setShowTrainDialog(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleTrain} disabled={commandMutation.isPending}>
              {commandMutation.isPending ? "Submitting…" : "Start Training"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}