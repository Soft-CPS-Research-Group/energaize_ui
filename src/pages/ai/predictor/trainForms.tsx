import { useState, useRef, Fragment, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Trash2, GripVertical } from "lucide-react";

// ─── LSTM layer types ─────────────────────────────────────────────────────────

type LSTMLayerType = "linear" | "relu" | "lstm" | "dropout" | "gru" | "attention";

export interface LSTMLayer {
  id: string;
  type: LSTMLayerType;
  out?: string;
  hidden?: string;
  num_layers?: string;
  p?: string;
}

const LAYER_COLORS: Record<LSTMLayerType, string> = {
  linear:    "#3b82f6",
  relu:      "#22c55e",
  lstm:      "#8b5cf6",
  dropout:   "#f97316",
  gru:       "#ec4899",
  attention: "#f59e0b",
};

export const LAYER_LABELS: Record<LSTMLayerType, string> = {
  linear:    "Linear",
  relu:      "ReLU",
  lstm:      "LSTM",
  dropout:   "Dropout",
  gru:       "GRU",
  attention: "Attention",
};

export function makeLayer(type: LSTMLayerType): LSTMLayer {
  const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (type === "linear")  return { id, type, out: "64" };
  if (type === "lstm")    return { id, type, hidden: "256", num_layers: "2" };
  if (type === "gru")     return { id, type, hidden: "128", num_layers: "1" };
  if (type === "dropout") return { id, type, p: "0.3" };
  return { id, type };
}

/** A layer field as a number; a cleared or invalid field falls back to the layer default. */
function numOr(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function serializeLayer(l: LSTMLayer): Record<string, unknown> {
  if (l.type === "linear")  return { type: "linear",  out: numOr(l.out, 64) };
  if (l.type === "lstm")    return { type: "lstm",    hidden: numOr(l.hidden, 256), num_layers: numOr(l.num_layers, 2) };
  if (l.type === "gru")     return { type: "gru",     hidden: numOr(l.hidden, 128), num_layers: numOr(l.num_layers, 1) };
  if (l.type === "dropout") return { type: "dropout", p: numOr(l.p, 0.3) };
  if (l.type === "attention") return { type: "attention" };
  return { type: l.type };
}

const LAYER_TIPS: Record<LSTMLayerType, string> = {
  linear:    "Fully-connected layer — multiplies the input by a learned weight matrix and adds a bias. Use it to project, mix, or reduce feature dimensions.",
  relu:      "Rectified Linear Unit — activation function that sets all negative values to zero. Adds non-linearity without any learnable parameters.",
  lstm:      "Long Short-Term Memory — recurrent layer that captures long-range temporal patterns through gated memory cells. 'hidden' sets the cell size; 'num_layers' stacks multiple LSTM layers on top of each other.",
  dropout:   "Randomly zeroes a fraction p of activations during each training step. Reduces overfitting by preventing neurons from co-adapting.",
  gru:       "Gated Recurrent Unit — a lighter recurrent layer than LSTM with fewer parameters. Trains faster and often matches LSTM performance on shorter sequences.",
  attention: "Self-attention mechanism — lets the model weight every timestep in the sequence against every other, capturing global dependencies that recurrent layers can miss. No learnable size; output shape matches input.",
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

// Server-side defaults, shown as placeholders. Fields start empty and only what
// the user types is sent, so the server keeps its own (lane-specific) defaults.
export const XGB_DEFAULTS = { n_estimators: "500", max_depth: "7 / 5", learning_rate: "0.1", subsample: "0.8", colsample_bytree: "0.8", min_child_weight: "1" } as const;
export type XGBKey = keyof typeof XGB_DEFAULTS;

export const LGBM_DEFAULTS = { n_estimators: "1000", max_depth: "-1", learning_rate: "0.03", num_leaves: "127", subsample: "0.8", colsample_bytree: "0.7", min_child_samples: "10", reg_alpha: "0.1", reg_lambda: "1.0" } as const;
export type LGBMKey = keyof typeof LGBM_DEFAULTS | "objective";

// The predictor always builds 672-step sequences, so lookback is not offered.
export const LSTM_DEFAULTS = { epochs: "100", batch_size: "64", lr: "0.001", patience: "20" } as const;
export type LSTMKey = keyof typeof LSTM_DEFAULTS;

export function emptyFields<K extends string>(defaults: Record<K, string>): { [P in K]: string } {
  return Object.fromEntries(Object.keys(defaults).map((k) => [k, ""])) as { [P in K]: string };
}

type LSTMPreset = { name: string; tip: string; layers: Omit<LSTMLayer, "id">[] };
const LSTM_PRESETS: LSTMPreset[] = [
  {
    name: "LSTM Core",
    tip: "The canonical LSTM baseline — two stacked recurrent layers with dropout regularisation and a final linear projection. The safest starting point for any energy forecasting task.",
    layers: [
      { type: "lstm", hidden: "128", num_layers: "2" },
      { type: "dropout", p: "0.2" },
      { type: "linear", out: "64" },
    ],
  },
  {
    name: "GRU Lite",
    tip: "A single-layer GRU has fewer parameters than LSTM, trains roughly 30% faster, and often matches LSTM accuracy on short-to-medium lookbacks. Good first choice when compute is limited.",
    layers: [
      { type: "gru", hidden: "128", num_layers: "1" },
      { type: "dropout", p: "0.2" },
      { type: "linear", out: "64" },
    ],
  },
  {
    name: "Encode → LSTM",
    tip: "Expands the 12 raw features into a richer 64-d space before the recurrent layer. The encoder reduces input noise and speeds up LSTM convergence, especially with long lookbacks.",
    layers: [
      { type: "linear", out: "64" },
      { type: "relu" },
      { type: "lstm", hidden: "128", num_layers: "2" },
      { type: "dropout", p: "0.2" },
      { type: "linear", out: "64" },
    ],
  },
  {
    name: "LSTM + Attention",
    tip: "LSTM captures local sequential patterns; self-attention then lets every timestep compare directly against every other, catching long-range dependencies (e.g. same hour yesterday vs. same hour last week) that recurrent layers can miss.",
    layers: [
      { type: "lstm", hidden: "128", num_layers: "2" },
      { type: "attention" },
      { type: "dropout", p: "0.2" },
      { type: "linear", out: "64" },
    ],
  },
  {
    name: "Deep Hybrid",
    tip: "Full encoder-decoder stack: a linear projection enriches the feature space, deep GRU captures multi-scale temporal patterns, self-attention provides a global view of the sequence, then two compression layers decode to the output space. Best for weekly lookbacks (672 steps).",
    layers: [
      { type: "linear", out: "64" },
      { type: "relu" },
      { type: "gru", hidden: "256", num_layers: "2" },
      { type: "attention" },
      { type: "dropout", p: "0.25" },
      { type: "linear", out: "128" },
      { type: "linear", out: "64" },
    ],
  },
  {
    name: "Temporal Bottleneck",
    tip: "The LSTM compresses the sequence into a rich temporal representation, then a narrow 32-unit linear layer forces the model to distil only the most essential patterns — preventing lazy pass-through and acting as a strong regulariser. The decoder then expands back out for the final 96-step forecast.",
    layers: [
      { type: "lstm", hidden: "256", num_layers: "2" },
      { type: "linear", out: "32" },
      { type: "relu" },
      { type: "dropout", p: "0.2" },
      { type: "linear", out: "128" },
    ],
  },
];

/**
 * Keep only fields holding a finite number. A cleared field is left out so the
 * server default applies, instead of being sent as Number("") === 0.
 */
export function numericParams(params: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(params)) {
    if (raw.trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) out[key] = value;
  }
  return out;
}

type FieldRule = { integer?: boolean; min?: number; max?: number; exclusiveMin?: boolean };

/** Ranges the trainers accept; checked before submit so a typo never reaches the server. */
export const FIELD_RULES: Record<string, FieldRule> = {
  n_estimators: { integer: true, min: 1 },
  learning_rate: { min: 0, exclusiveMin: true },
  subsample: { min: 0, max: 1, exclusiveMin: true },
  colsample_bytree: { min: 0, max: 1, exclusiveMin: true },
  min_child_weight: { min: 0 },
  num_leaves: { integer: true, min: 2 },
  min_child_samples: { integer: true, min: 1 },
  reg_alpha: { min: 0 },
  reg_lambda: { min: 0 },
  epochs: { integer: true, min: 1 },
  batch_size: { integer: true, min: 1 },
  lr: { min: 0, exclusiveMin: true },
  patience: { integer: true, min: 1 },
};

/** One message per invalid field; empty fields are valid because the server default applies. */
export function validateParams(params: Record<string, string>, model: "xgboost" | "lgbm" | "lstm"): Record<string, string> {
  const rules: Record<string, FieldRule> = {
    ...FIELD_RULES,
    // LightGBM uses -1 for "no depth limit".
    max_depth: model === "lgbm" ? { integer: true, min: -1 } : { integer: true, min: 1 },
  };
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(params)) {
    const rule = rules[key];
    if (!rule || raw.trim() === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) errors[key] = "Enter a number";
    else if (rule.integer && !Number.isInteger(value)) errors[key] = "Enter a whole number";
    else if (rule.min != null && (rule.exclusiveMin ? value <= rule.min : value < rule.min))
      errors[key] = rule.exclusiveMin ? `Must be above ${rule.min}` : `Must be ${rule.min} or more`;
    else if (rule.max != null && value > rule.max) errors[key] = `Must be ${rule.max} or less`;
  }
  return errors;
}

// ─── Small number input ───────────────────────────────────────────────────────

function HpNumInput({ label, value, onChange, step, min, max, placeholder, error }: {
  label: string; value: string; onChange: (v: string) => void;
  step?: string; min?: string | number; max?: string | number; placeholder?: string; error?: string;
}) {
  return (
    <label className={`hp-field${error ? " has-error" : ""}`}>
      <span className="hp-field-label">{label}</span>
      <input type="number" className="analysis-text-input hp-input" value={value} placeholder={placeholder}
        step={step} min={min} max={max} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      {error ? <small className="hp-field-error">{error}</small> : null}
    </label>
  );
}

// ─── Per-model hyperparams forms ──────────────────────────────────────────────

export function XGBForm({ schema, onSchemaChange, params, onChange, errors }: {
  schema: "dense" | "sparse";
  onSchemaChange: (v: "dense" | "sparse") => void;
  params: { [K in XGBKey]: string };
  onChange: (k: XGBKey, v: string) => void;
  errors: Record<string, string>;
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
          <HpNumInput label="n_estimators" value={params.n_estimators} placeholder={XGB_DEFAULTS.n_estimators} min={10} error={errors.n_estimators} onChange={(v) => onChange("n_estimators", v)} />
          <HpNumInput label="max_depth" value={params.max_depth} placeholder={XGB_DEFAULTS.max_depth} min={1} max={20} error={errors.max_depth} onChange={(v) => onChange("max_depth", v)} />
          <HpNumInput label="learning_rate" value={params.learning_rate} placeholder={XGB_DEFAULTS.learning_rate} step="0.001" min={0} error={errors.learning_rate} onChange={(v) => onChange("learning_rate", v)} />
          <HpNumInput label="subsample" value={params.subsample} placeholder={XGB_DEFAULTS.subsample} step="0.05" min={0} max={1} error={errors.subsample} onChange={(v) => onChange("subsample", v)} />
          <HpNumInput label="colsample_bytree" value={params.colsample_bytree} placeholder={XGB_DEFAULTS.colsample_bytree} step="0.05" min={0} max={1} error={errors.colsample_bytree} onChange={(v) => onChange("colsample_bytree", v)} />
          <HpNumInput label="min_child_weight" value={params.min_child_weight} placeholder={XGB_DEFAULTS.min_child_weight} min={0} error={errors.min_child_weight} onChange={(v) => onChange("min_child_weight", v)} />
        </div>
      </div>
    </div>
  );
}

export function LGBMForm({ params, onChange, errors }: {
  params: { [K in LGBMKey]: string };
  onChange: (k: LGBMKey, v: string) => void;
  errors: Record<string, string>;
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
          <HpNumInput label="n_estimators" value={params.n_estimators} placeholder={LGBM_DEFAULTS.n_estimators} min={10} error={errors.n_estimators} onChange={(v) => onChange("n_estimators", v)} />
          <HpNumInput label="max_depth" value={params.max_depth} placeholder={LGBM_DEFAULTS.max_depth} min={-1} error={errors.max_depth} onChange={(v) => onChange("max_depth", v)} />
          <HpNumInput label="learning_rate" value={params.learning_rate} placeholder={LGBM_DEFAULTS.learning_rate} step="0.001" min={0} error={errors.learning_rate} onChange={(v) => onChange("learning_rate", v)} />
          <HpNumInput label="num_leaves" value={params.num_leaves} placeholder={LGBM_DEFAULTS.num_leaves} min={2} error={errors.num_leaves} onChange={(v) => onChange("num_leaves", v)} />
          <HpNumInput label="subsample" value={params.subsample} placeholder={LGBM_DEFAULTS.subsample} step="0.05" min={0} max={1} error={errors.subsample} onChange={(v) => onChange("subsample", v)} />
          <HpNumInput label="colsample_bytree" value={params.colsample_bytree} placeholder={LGBM_DEFAULTS.colsample_bytree} step="0.05" min={0} max={1} error={errors.colsample_bytree} onChange={(v) => onChange("colsample_bytree", v)} />
          <HpNumInput label="min_child_samples" value={params.min_child_samples} placeholder={LGBM_DEFAULTS.min_child_samples} min={1} error={errors.min_child_samples} onChange={(v) => onChange("min_child_samples", v)} />
          <HpNumInput label="reg_alpha" value={params.reg_alpha} placeholder={LGBM_DEFAULTS.reg_alpha} step="0.01" min={0} error={errors.reg_alpha} onChange={(v) => onChange("reg_alpha", v)} />
          <HpNumInput label="reg_lambda" value={params.reg_lambda} placeholder={LGBM_DEFAULTS.reg_lambda} step="0.1" min={0} error={errors.reg_lambda} onChange={(v) => onChange("reg_lambda", v)} />
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
  const plusRef = useRef<HTMLSpanElement>(null);
  const showPicker = hovered && !isDragActive;

  // Position the portal picker centered above the + button
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const updatePos = () => {
    if (!plusRef.current) return;
    const r = plusRef.current.getBoundingClientRect();
    setPickerPos({ top: r.top - 8, left: r.left + r.width / 2 });
  };

  return (
    <div
      className={`lstm-insert-zone${isDropTarget ? " is-drop-target" : ""}${showPicker ? " is-open" : ""}`}
      onMouseEnter={() => { setHovered(true); updatePos(); }}
      onMouseLeave={() => setHovered(false)}
      onDragEnter={(e) => { e.preventDefault(); onDragEnter(insertIndex); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={(e) => { e.preventDefault(); onDrop(insertIndex); }}
    >
      <span ref={plusRef} className="lstm-insert-plus">+</span>
      {showPicker && pickerPos && createPortal(
        <div
          className="lstm-insert-picker"
          style={{
            position: "fixed",
            top: pickerPos.top,
            left: pickerPos.left,
            transform: "translate(-50%, -100%)",
            zIndex: 99999,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {(["linear", "relu", "lstm", "dropout", "gru", "attention"] as LSTMLayerType[]).map((t) => (
            <button
              key={t}
              className="lstm-insert-type-btn"
              style={{ color: LAYER_COLORS[t] }}
              onMouseDown={(e) => { e.preventDefault(); onInsert(t, insertIndex); setHovered(false); }}
            >
              <span className="lstm-insert-dot" style={{ background: LAYER_COLORS[t] }} />
              {LAYER_LABELS[t]}
              <LayerInfoTip type={t} />
            </button>
          ))}
        </div>,
        document.body,
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
        {layer.type === "gru" && (
          <>
            <div className="lstm-layer-param">
              <span className="lstm-layer-param-label">hidden</span>
              <input type="number" className="lstm-layer-param-input" value={layer.hidden ?? "128"} min={1}
                onDragStart={(e) => e.stopPropagation()}
                onChange={(e) => onChange({ ...layer, hidden: e.target.value })} />
            </div>
            <div className="lstm-layer-param">
              <span className="lstm-layer-param-label">num_layers</span>
              <input type="number" className="lstm-layer-param-input" value={layer.num_layers ?? "1"} min={1} max={8}
                onDragStart={(e) => e.stopPropagation()}
                onChange={(e) => onChange({ ...layer, num_layers: e.target.value })} />
            </div>
          </>
        )}
        {(layer.type === "relu" || layer.type === "attention") && (
          <span className="lstm-layer-noparam">{layer.type === "attention" ? "no params" : "activation only"}</span>
        )}
      </div>
      <button className="lstm-layer-delete" onClick={onDelete} title="Remove layer">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ─── Neural-network shape visualiser ──────────────────────────────────────────

export function NNViz({ layers }: { layers: LSTMLayer[] }) {
  const INPUT_DIM  = 12;  // fixed: 12 features per timestep
  const OUTPUT_DIM = 96;  // fixed: 96 × 15-min slots = 24 h

  const resolvedDims: number[] = [];
  let lastDim = INPUT_DIM;
  for (const l of layers) {
    if (l.type === "linear")  { lastDim = Number(l.out ?? 64);  resolvedDims.push(lastDim); }
    else if (l.type === "lstm") { lastDim = Number(l.hidden ?? 128); resolvedDims.push(lastDim); }
    else if (l.type === "gru")  { lastDim = Number(l.hidden ?? 128); resolvedDims.push(lastDim); }
    else resolvedDims.push(lastDim); // relu / dropout / attention: pass-through
  }

  type Entry = { label: string; dimLabel: string; color: string; passThrough: boolean };

  const entries: Entry[] = [
    { label: "Input",  dimLabel: String(INPUT_DIM),  color: "#94a3b8", passThrough: false },
    ...layers.map((l) => ({
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

export function LSTMForm({ params, onChange, layers, onLayersChange, errors }: {
  params: { [K in LSTMKey]: string };
  onChange: (k: LSTMKey, v: string) => void;
  layers: LSTMLayer[];
  onLayersChange: (l: LSTMLayer[]) => void;
  errors: Record<string, string>;
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
          <HpNumInput label="epochs" value={params.epochs} placeholder={LSTM_DEFAULTS.epochs} min={1} error={errors.epochs} onChange={(v) => onChange("epochs", v)} />
          <HpNumInput label="batch_size" value={params.batch_size} placeholder={LSTM_DEFAULTS.batch_size} min={1} error={errors.batch_size} onChange={(v) => onChange("batch_size", v)} />
          <HpNumInput label="lr" value={params.lr} placeholder={LSTM_DEFAULTS.lr} step="0.0001" min={0} error={errors.lr} onChange={(v) => onChange("lr", v)} />
          <HpNumInput label="patience" value={params.patience} placeholder={LSTM_DEFAULTS.patience} min={1} error={errors.patience} onChange={(v) => onChange("patience", v)} />
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

