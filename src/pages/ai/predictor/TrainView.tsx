import { usePredictorTrainingProgress, usePredictorCommand, useCancelTrainingJob } from "../../../hooks/usePredictor";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Modal } from "../../../components/ui/Modal";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import { useState, useRef, Fragment, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { PlusCircle, RotateCcw, Trash2, GripVertical } from "lucide-react";
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

const LAYER_TIPS: Record<LSTMLayerType, string> = {
  linear:  "Fully-connected layer — multiplies the input by a learned weight matrix and adds a bias. Use it to project, mix, or reduce feature dimensions.",
  relu:    "Rectified Linear Unit — activation function that sets all negative values to zero. Adds non-linearity without any learnable parameters.",
  lstm:    "Long Short-Term Memory — recurrent layer that captures long-range temporal patterns through gated memory cells. 'hidden' sets the cell size; 'num_layers' stacks multiple LSTM layers on top of each other.",
  dropout: "Randomly zeroes a fraction p of activations during each training step. Reduces overfitting by preventing neurons from co-adapting.",
};

function LayerInfoTip({ type }: { type: LSTMLayerType }) {
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const W = 230;
  const GAP = 8;
  const show = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - W / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
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
        >{LAYER_TIPS[type]}</div>,
        document.body,
      )}
    </>
  );
}

// ─── Default hyperparams ──────────────────────────────────────────────────────

const XGB_DEFAULTS = { n_estimators: "500", max_depth: "7", learning_rate: "0.1", subsample: "0.8", colsample_bytree: "0.8", min_child_weight: "1" } as const;
type XGBKey = keyof typeof XGB_DEFAULTS;

const LGBM_DEFAULTS = { objective: "tweedie", n_estimators: "1000", max_depth: "-1", learning_rate: "0.03", num_leaves: "127", subsample: "0.8", colsample_bytree: "0.7", min_child_samples: "10", reg_alpha: "0.1", reg_lambda: "1.0" } as const;
type LGBMKey = keyof typeof LGBM_DEFAULTS;

const LSTM_DEFAULTS = { lookback: "672", epochs: "100", batch_size: "64", lr: "0.001", patience: "20" } as const;
type LSTMKey = keyof typeof LSTM_DEFAULTS;

type LSTMPreset = { name: string; tip: string; layers: Omit<LSTMLayer, "id">[] };
const LSTM_PRESETS: LSTMPreset[] = [
  {
    name: "Funnel",
    tip: "Progressively narrows the representation via Linear 256→128→64 with ReLU activations. Good all-round starting point for most energy forecasting tasks.",
    layers: [
      { type: "linear", out: "256" }, { type: "relu" },
      { type: "linear", out: "128" }, { type: "relu" },
      { type: "linear", out: "64" },
    ],
  },
  {
    name: "LSTM Core",
    tip: "Two-layer LSTM followed by dropout and a linear projection. Strong baseline that captures short and medium-range temporal patterns.",
    layers: [
      { type: "lstm", hidden: "128", num_layers: "2" },
      { type: "dropout", p: "0.2" },
      { type: "linear", out: "64" },
    ],
  },
  {
    name: "Deep LSTM",
    tip: "Wide 3-layer LSTM with two linear compression stages. Best for long lookbacks (≥ 672 steps) where capturing weekly or multi-day seasonality matters.",
    layers: [
      { type: "lstm", hidden: "256", num_layers: "3" },
      { type: "relu" },
      { type: "dropout", p: "0.25" },
      { type: "linear", out: "128" },
      { type: "linear", out: "64" },
    ],
  },
  {
    name: "Encode → LSTM",
    tip: "A linear encoder compresses raw features before the recurrent layer — reduces noise, speeds up LSTM convergence, and improves generalisation on high-dimensional feature sets.",
    layers: [
      { type: "linear", out: "256" },
      { type: "relu" },
      { type: "lstm", hidden: "128", num_layers: "2" },
      { type: "dropout", p: "0.2" },
      { type: "linear", out: "64" },
    ],
  },
  {
    name: "Bottleneck",
    tip: "Compresses down to 32 units then expands back out — forces the model to distil the most essential temporal features. Useful when you suspect noise or redundancy in the feature space.",
    layers: [
      { type: "linear", out: "256" }, { type: "relu" },
      { type: "linear", out: "32" }, { type: "relu" },
      { type: "linear", out: "256" },
    ],
  },
];

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

// ─── Insert zone (hover to add | drag-over to drop) ──────────────────────────────────

function InsertZone({ insertIndex, isDragActive, isDropTarget, onInsert, onDragEnter, onDrop }: {
  insertIndex: number;
  isDragActive: boolean;
  isDropTarget: boolean;
  onInsert: (type: LSTMLayerType, at: number) => void;
  onDragEnter: (at: number) => void;
  onDrop: (at: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const showPicker = hovered && !isDragActive;

  return (
    <div
      className={`lstm-insert-zone${isDropTarget ? " is-drop-target" : ""}${showPicker ? " is-open" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragEnter={(e) => { e.preventDefault(); onDragEnter(insertIndex); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={(e) => { e.preventDefault(); onDrop(insertIndex); }}
    >
      <span className="lstm-insert-plus">+</span>
      {showPicker && (
        <div className="lstm-insert-picker">
          {(["linear", "relu", "lstm", "dropout"] as LSTMLayerType[]).map((t) => (
            <button
              key={t}
              className="lstm-insert-type-btn"
              style={{ color: LAYER_COLORS[t] }}
              onMouseDown={(e) => { e.preventDefault(); onInsert(t, insertIndex); setHovered(false); }}
            >
              <span className="lstm-insert-dot" style={{ background: LAYER_COLORS[t] }} />
              {LAYER_LABELS[t]}
              <span className="lstm-layer-type-tip" style={{ color: LAYER_COLORS[t] }}>
                ?
                <span className="lstm-layer-type-tip-popup">{LAYER_TIPS[t]}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Layer card (draggable) ──────────────────────────────────────────────────────

function LSTMLayerCard({ layer, index, onChange, onDelete, onDragStart, onDragEnd, onDragEnterCard, isDragging }: {
  layer: LSTMLayer;
  index: number;
  onChange: (l: LSTMLayer) => void;
  onDelete: () => void;
  onDragStart: (i: number) => void;
  onDragEnd: () => void;
  onDragEnterCard: () => void;
  isDragging: boolean;
}) {
  const color = LAYER_COLORS[layer.type];
  return (
    <div
      className={`lstm-layer-card${isDragging ? " is-dragging" : ""}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(index); }}
      onDragEnd={onDragEnd}
      onDragEnter={onDragEnterCard}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="lstm-layer-accent" style={{ background: color }} />
      <GripVertical size={14} className="lstm-drag-handle" />
      <span className="lstm-layer-type-badge" style={{ background: `color-mix(in srgb, ${color} 15%, var(--bg-elev))`, color }}>
        {LAYER_LABELS[layer.type]}
      </span>
      <LayerInfoTip type={layer.type} />
      <div className="lstm-layer-params">
        {layer.type === "linear" && (
          <div className="lstm-layer-param">
            <span className="lstm-layer-param-label">out</span>
            <input type="number" className="lstm-layer-param-input" value={layer.out ?? "64"} min={1}
              onDragStart={(e) => e.stopPropagation()}
              onChange={(e) => onChange({ ...layer, out: e.target.value })} />
          </div>
        )}
        {layer.type === "lstm" && (
          <>
            <div className="lstm-layer-param">
              <span className="lstm-layer-param-label">hidden</span>
              <input type="number" className="lstm-layer-param-input" value={layer.hidden ?? "256"} min={1}
                onDragStart={(e) => e.stopPropagation()}
                onChange={(e) => onChange({ ...layer, hidden: e.target.value })} />
            </div>
            <div className="lstm-layer-param">
              <span className="lstm-layer-param-label">num_layers</span>
              <input type="number" className="lstm-layer-param-input" value={layer.num_layers ?? "2"} min={1} max={8}
                onDragStart={(e) => e.stopPropagation()}
                onChange={(e) => onChange({ ...layer, num_layers: e.target.value })} />
            </div>
          </>
        )}
        {layer.type === "dropout" && (
          <div className="lstm-layer-param">
            <span className="lstm-layer-param-label">p</span>
            <input type="number" className="lstm-layer-param-input" value={layer.p ?? "0.3"} min={0} max={1} step="0.05"
              onDragStart={(e) => e.stopPropagation()}
              onChange={(e) => onChange({ ...layer, p: e.target.value })} />
          </div>
        )}
        {layer.type === "relu" && (
          <span className="lstm-layer-noparam">activation only</span>
        )}
      </div>
      <button className="lstm-layer-delete" onClick={onDelete} title="Remove layer">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ─── Neural-network shape visualiser ──────────────────────────────────────────

function NNViz({ layers }: { layers: LSTMLayer[] }) {
  const INPUT_DIM  = 12;  // fixed: 12 features per timestep
  const OUTPUT_DIM = 96;  // fixed: 96 × 15-min slots = 24 h

  const resolvedDims: number[] = [];
  let lastDim = INPUT_DIM;
  for (const l of layers) {
    if (l.type === "linear")  { lastDim = Number(l.out ?? 64); resolvedDims.push(lastDim); }
    else if (l.type === "lstm") { lastDim = Number(l.hidden ?? 128); resolvedDims.push(lastDim); }
    else resolvedDims.push(lastDim); // relu / dropout: pass-through
  }

  type Entry = { label: string; dimLabel: string; color: string; passThrough: boolean };

  const entries: Entry[] = [
    { label: "Input",  dimLabel: String(INPUT_DIM),  color: "#94a3b8", passThrough: false },
    ...layers.map((l, i) => ({
      label:       LAYER_LABELS[l.type],
      dimLabel:    l.type === "linear"  ? String(l.out ?? 64)
                 : l.type === "lstm"    ? `h=${l.hidden ?? 128}`
                 : l.type === "dropout" ? `p=${l.p ?? 0.3}`
                 : "",
      color:       LAYER_COLORS[l.type],
      passThrough: l.type === "relu" || l.type === "dropout",
    })),
    { label: "Output", dimLabel: String(OUTPUT_DIM), color: "#22c55e", passThrough: false },
  ];

  return (
    <div className="nn-viz">
      <div className="nn-viz-header">
        <span className="nn-viz-title">Architecture</span>
        <span className="nn-viz-subtitle">{layers.length + 2} layers</span>
      </div>
      <div className="nn-viz-nodes">
        {entries.map((e, i) => (
          <div
            key={i}
            className={`nn-viz-node${e.passThrough ? " is-pass-through" : ""}`}
            style={{ "--layer-color": e.color } as CSSProperties}
          >
            {/* Left gutter: dot + connecting line */}
            <div className="nn-viz-gutter">
              <div className="nn-viz-dot" />
              {i < entries.length - 1 && <div className="nn-viz-line" />}
            </div>
            {/* Content: name + dimension */}
            <div className="nn-viz-content">
              <span className="nn-viz-name">{e.label}</span>
              {e.dimLabel && <span className="nn-viz-dim">{e.dimLabel}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LSTM form ─────────────────────────────────────────────────────────────────

function LSTMForm({ params, onChange, layers, onLayersChange }: {
  params: { [K in LSTMKey]: string };
  onChange: (k: LSTMKey, v: string) => void;
  layers: LSTMLayer[];
  onLayersChange: (l: LSTMLayer[]) => void;
}) {
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const isDragActive = dragSrcIdx !== null;

  const insertAt = (type: LSTMLayerType, at: number) => {
    const next = [...layers];
    next.splice(at, 0, makeLayer(type));
    onLayersChange(next);
  };

  const handleDragEnd = () => { setDragSrcIdx(null); setDropTargetIdx(null); };

  const handleDrop = (at: number) => {
    if (dragSrcIdx === null) return;
    const next = [...layers];
    const [removed] = next.splice(dragSrcIdx, 1);
    next.splice(at > dragSrcIdx ? at - 1 : at, 0, removed);
    onLayersChange(next);
    handleDragEnd();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
        <div className="train-modal-section-title" style={{ marginBottom: 10 }}>
          Architecture
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-soft)", marginLeft: 6 }}>
            (optional — omit to use default)
          </span>
        </div>
        <div className="lstm-arch-row">
          <div className="lstm-arch-main">
            <div className="lstm-presets">
              {LSTM_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  className="lstm-preset-btn"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onLayersChange(preset.layers.map((l) => ({ ...makeLayer(l.type), ...l })));
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>
            <div className="lstm-builder">
              <div className="lstm-io-node">▶ Input</div>
              <InsertZone
                insertIndex={0}
                isDragActive={isDragActive}
                isDropTarget={dropTargetIdx === 0}
                onInsert={insertAt}
                onDragEnter={(at) => setDropTargetIdx(at)}
                onDrop={handleDrop}
              />
              {layers.length === 0 && (
                <p className="lstm-empty-hint">Hover the <strong>+</strong> between nodes to insert a layer — drag cards to reorder</p>
              )}
              {layers.map((layer, idx) => (
                <Fragment key={layer.id}>
                  <LSTMLayerCard
                    layer={layer}
                    index={idx}
                    onChange={(updated) => onLayersChange(layers.map((l) => (l.id === layer.id ? updated : l)))}
                    onDelete={() => onLayersChange(layers.filter((l) => l.id !== layer.id))}
                    onDragStart={(i) => setDragSrcIdx(i)}
                    onDragEnd={handleDragEnd}
                    onDragEnterCard={() => setDropTargetIdx(null)}
                    isDragging={dragSrcIdx === idx}
                  />
                  <InsertZone
                    insertIndex={idx + 1}
                    isDragActive={isDragActive}
                    isDropTarget={dropTargetIdx === idx + 1}
                    onInsert={insertAt}
                    onDragEnter={(at) => setDropTargetIdx(at)}
                    onDrop={handleDrop}
                  />
                </Fragment>
              ))}
              <div className="lstm-io-node lstm-io-node--out">◀ Output</div>
            </div>
          </div>
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
  const [trainLane, setTrainLane] = useState<"consumption" | "production" | "both">("both");

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
        lane: trainLane,
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
      <Modal
        title={`Train — ${selectedHouseId ?? ""}`}
        open={showTrainDialog}
        onClose={() => setShowTrainDialog(false)}
        width="lg"
        adjacentPanel={
          trainModelType === "lstm" && lstmLayers.length > 0
            ? <NNViz layers={lstmLayers} />
            : undefined
        }
      >
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
            <label className="train-modal-config-field">
              <span>Lane</span>
              <select
                className="predictor-house-select"
                value={trainLane}
                onChange={(e) => setTrainLane(e.target.value as "consumption" | "production" | "both")}
              >
                <option value="both">Both</option>
                <option value="consumption">Consumption</option>
                <option value="production">Production</option>
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