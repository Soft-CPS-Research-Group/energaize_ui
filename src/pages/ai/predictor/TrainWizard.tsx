import { useEffect, useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { usePredictorCommand } from "../../../hooks/usePredictor";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import type { ModelBackend } from "../../../api/predictorApi";
import {
  LAYER_LABELS, LGBMForm, LGBM_DEFAULTS, LSTMForm, LSTM_DEFAULTS, NNViz, XGBForm, XGB_DEFAULTS,
  emptyFields, numericParams, serializeLayer, validateParams,
  type LGBMKey, type LSTMKey, type LSTMLayer, type XGBKey,
} from "./trainForms";

type Lane = "consumption" | "production" | "both";

const STEPS = ["Model", "Settings", "Review"] as const;

const MODELS: { id: ModelBackend; name: string; description: string }[] = [
  { id: "xgboost", name: "XGBoost", description: "Gradient-boosted trees. The predictor's default model." },
  { id: "lgbm", name: "LightGBM", description: "Gradient-boosted trees that grow leaf by leaf." },
  { id: "lstm", name: "LSTM", description: "Recurrent neural network over the last 7 days (672 steps). Only one LSTM job can run at a time." },
];

const LANES: { id: Lane; label: string }[] = [
  { id: "both", label: "Both" },
  { id: "consumption", label: "Consumption" },
  { id: "production", label: "Production" },
];

export function TrainWizard({ open, houseId, lstmBusy, onClose }: {
  open: boolean;
  houseId: string | null;
  /** An LSTM job is already queued or running; the predictor rejects a second one. */
  lstmBusy: boolean;
  onClose: () => void;
}) {
  const { notifySuccess, notifyError } = useApiFeedback();
  const commandMutation = usePredictorCommand();
  const [step, setStep] = useState(0);
  const [model, setModel] = useState<ModelBackend>("xgboost");
  const [lane, setLane] = useState<Lane>("both");
  const [schema, setSchema] = useState<"dense" | "sparse">("dense");
  const [xgbParams, setXgbParams] = useState<{ [K in XGBKey]: string }>(() => emptyFields(XGB_DEFAULTS));
  const [lgbmParams, setLgbmParams] = useState<{ [K in LGBMKey]: string }>(() => ({ objective: "tweedie", ...emptyFields(LGBM_DEFAULTS) }));
  const [lstmParams, setLstmParams] = useState<{ [K in LSTMKey]: string }>(() => emptyFields(LSTM_DEFAULTS));
  const [lstmLayers, setLstmLayers] = useState<LSTMLayer[]>([]);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const numeric: Record<string, string> =
    model === "xgboost" ? xgbParams : model === "lgbm" ? (({ objective: _objective, ...rest }) => rest)(lgbmParams) : lstmParams;
  const errors = validateParams(numeric, model);
  const hasErrors = Object.keys(errors).length > 0;
  const changed = numericParams(numeric);
  const lstmBlocked = model === "lstm" && lstmBusy;

  function resetDefaults() {
    if (model === "xgboost") setXgbParams(emptyFields(XGB_DEFAULTS));
    if (model === "lgbm") setLgbmParams({ objective: "tweedie", ...emptyFields(LGBM_DEFAULTS) });
    if (model === "lstm") {
      setLstmParams(emptyFields(LSTM_DEFAULTS));
      setLstmLayers([]);
    }
  }

  function buildHyperparams(): Record<string, unknown> {
    if (model === "lgbm") return { objective: lgbmParams.objective, ...changed };
    if (model === "lstm" && lstmLayers.length > 0) return { ...changed, layers: lstmLayers.map(serializeLayer) };
    return changed;
  }

  function submit() {
    if (!houseId) return;
    commandMutation.mutate(
      {
        command: "train",
        house_id: houseId,
        lane,
        model_type: model,
        ...(model === "xgboost" ? { model_schema: schema } : {}),
        hyperparams: buildHyperparams(),
      },
      {
        onSuccess: (res) => { notifySuccess("Training queued", res.message); onClose(); },
        onError: (err) => notifyError("Training not started", err),
      }
    );
  }

  const modelName = MODELS.find((m) => m.id === model)?.name ?? model;
  const laneLabel = lane === "both" ? "Consumption and production (two jobs)" : lane === "consumption" ? "Consumption" : "Production";
  const changedEntries = [
    ...(model === "lgbm" ? [["objective", lgbmParams.objective] as const] : []),
    ...Object.entries(changed).map(([k, v]) => [k, String(v)] as const),
  ];

  return (
    <Modal
      title={`Train ${houseId ?? ""}`}
      open={open}
      onClose={onClose}
      width="lg"
      adjacentPanel={step === 1 && model === "lstm" && lstmLayers.length > 0 ? <NNViz layers={lstmLayers} /> : undefined}
    >
      <div className="train-modal-body">
        <ol className="predictor-steps" aria-label="Training steps">
          {STEPS.map((title, i) => (
            <li key={title}>
              <button
                type="button"
                disabled={i > step}
                aria-current={i === step ? "step" : undefined}
                onClick={() => setStep(i)}
              >
                <span>{i + 1}</span>{title}
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="predictor-wizard-step">
            <fieldset className="predictor-choice-group">
              <legend>Lane</legend>
              <div className="predictor-lane-toggle" role="group" aria-label="Lane">
                {LANES.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={`predictor-lane-btn${lane === l.id ? " is-active" : ""}`}
                    aria-pressed={lane === l.id}
                    onClick={() => setLane(l.id)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <small>Both starts one job per lane.</small>
            </fieldset>
            <fieldset className="predictor-choice-group">
              <legend>Model</legend>
              <div className="predictor-model-cards">
                {MODELS.map((m) => (
                  <label key={m.id} className={`predictor-model-card${model === m.id ? " is-selected" : ""}`}>
                    <input type="radio" name="train-model" value={m.id} checked={model === m.id} onChange={() => setModel(m.id)} />
                    <strong>{m.name}</strong>
                    <span>{m.description}</span>
                  </label>
                ))}
              </div>
              {lstmBlocked && (
                <p className="predictor-wizard-warning" role="alert">
                  An LSTM job is already queued or running. Wait for it to finish before starting another.
                </p>
              )}
            </fieldset>
          </div>
        )}

        {step === 1 && (
          <div className="predictor-wizard-step">
            <div className="predictor-wizard-note">
              <p>All fields are optional. Empty fields use the server default shown in grey; max_depth defaults to 7 for consumption and 5 for production.</p>
              <Button variant="secondary" size="sm" onClick={resetDefaults}>Reset to server defaults</Button>
            </div>
            <div className="train-modal-hp-area">
              {model === "xgboost" && (
                <XGBForm schema={schema} onSchemaChange={setSchema} params={xgbParams} errors={errors}
                  onChange={(k, v) => setXgbParams((p) => ({ ...p, [k]: v }))} />
              )}
              {model === "lgbm" && (
                <LGBMForm params={lgbmParams} errors={errors} onChange={(k, v) => setLgbmParams((p) => ({ ...p, [k]: v }))} />
              )}
              {model === "lstm" && (
                <LSTMForm params={lstmParams} errors={errors} layers={lstmLayers} onLayersChange={setLstmLayers}
                  onChange={(k, v) => setLstmParams((p) => ({ ...p, [k]: v }))} />
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="predictor-wizard-step">
            <dl className="predictor-review">
              <div><dt>House</dt><dd>{houseId}</dd></div>
              <div><dt>Lane</dt><dd>{laneLabel}</dd></div>
              <div><dt>Model</dt><dd>{modelName}{model === "xgboost" ? ` · ${schema} features` : ""}</dd></div>
              <div>
                <dt>Settings</dt>
                <dd>
                  {changedEntries.length === 0
                    ? "Server defaults"
                    : changedEntries.map(([k, v]) => <code key={k}>{k} = {v}</code>)}
                </dd>
              </div>
              {model === "lstm" && (
                <div>
                  <dt>Architecture</dt>
                  <dd>{lstmLayers.length === 0 ? "Server default" : lstmLayers.map((l) => LAYER_LABELS[l.type]).join(" → ")}</dd>
                </div>
              )}
            </dl>
            <p className="predictor-wizard-note-text">
              The new model replaces the current one only if its error (MAE) is lower. Otherwise the job ends as
              "Rejected" and forecasts keep using the existing one.
            </p>
          </div>
        )}

        <div className="train-modal-footer">
          <Button variant="secondary" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < 2 ? (
            <Button variant="primary" onClick={() => setStep(step + 1)} disabled={(step === 0 && lstmBlocked) || (step === 1 && hasErrors)}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" onClick={submit} disabled={commandMutation.isPending || lstmBlocked || hasErrors || !houseId}>
              {commandMutation.isPending ? "Starting…" : "Start training"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
