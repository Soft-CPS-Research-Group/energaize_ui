import { useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import { usePredictorCommand, usePredictorGenericModel, useSetGenericModel } from "../../../hooks/usePredictor";
import type { GenericBackend, GenericModelLane } from "../../../api/predictorApi";
import { fmtTs } from "./analysisFormat";

const BACKENDS: readonly (readonly [GenericBackend, string])[] = [["xgboost", "XGBoost"], ["lgbm", "LightGBM"]];
const LANES = ["consumption", "production"] as const;
type Lane = (typeof LANES)[number];

function LaneCard({ lane, info, timezone }: { lane: Lane; info: GenericModelLane | undefined; timezone: string }) {
  const { notifySuccess, notifyError } = useApiFeedback();
  const setMutation = useSetGenericModel();
  const available = info?.available ?? {};
  const chosen = info?.model_type ?? null;

  const choose = (model_type: GenericBackend) =>
    setMutation.mutate({ lane, model_type }, {
      onSuccess: () => notifySuccess("Generic model changed", `The ${lane} lane now uses ${model_type === "lgbm" ? "LightGBM" : "XGBoost"}.`),
      onError: (err) => notifyError("Generic model not changed", err),
    });

  return (
    <section className="generic-lane" aria-label={`Generic ${lane} model`}>
      <div className="generic-lane-head">
        <h4 className="is-capitalized">{lane}</h4>
        <div className="predictor-lane-toggle" role="group" aria-label={`Backend for ${lane}`}>
          {BACKENDS.map(([id, text]) => (
            <button key={id} type="button" className={`predictor-lane-btn${chosen === id ? " is-active" : ""}`}
              aria-pressed={chosen === id} disabled={!available[id] || setMutation.isPending}
              title={available[id] ? undefined : "Not trained yet"} onClick={() => choose(id)}>
              {text}
            </button>
          ))}
        </div>
      </div>
      {!chosen && (
        <small className="is-muted">No backend chosen: each house uses the generic model of its own backend, XGBoost when that one is missing.</small>
      )}
      {BACKENDS.map(([id, text]) => {
        const file = available[id];
        if (!file) return null;
        const excluded = file.excluded ?? [];
        return (
          <div key={id} className="generic-file">
            <div className="generic-file-row">
              <strong>{text}</strong>
              {chosen === id && <Badge tone="success">In use</Badge>}
              <span className="is-muted">
                Trained {fmtTs(file.trained_at, timezone)}
                {file.houses ? ` · ${file.houses.length} ${file.houses.length === 1 ? "house" : "houses"}` : ""}
              </span>
            </div>
            {excluded.length > 0 && (
              <ul className="generic-excluded" aria-label={`Houses left out of the ${text} model`}>
                {excluded.map((e) => (
                  <li key={e.house_id}><strong>{e.house_id}</strong> <span className="is-muted">{e.reason}</span></li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {!available.xgboost && !available.lgbm && <small className="is-muted">Not trained yet.</small>}
    </section>
  );
}

/** Generic (cold-start) model: which backend forecasts, what it was trained on, and retraining it. */
export function GenericModelModal({ open, onClose, timezone }: { open: boolean; onClose: () => void; timezone: string }) {
  const { notifySuccess, notifyError } = useApiFeedback();
  const { data, isLoading, isError } = usePredictorGenericModel(open);
  const commandMutation = usePredictorCommand();
  const [lanes, setLanes] = useState<"both" | Lane>("both");
  const [backend, setBackend] = useState<"chosen" | GenericBackend>("chosen");
  const [force, setForce] = useState(false);

  const retrain = () =>
    commandMutation.mutate(
      { command: "train-cold", lane: lanes, ...(backend !== "chosen" && { model_type: backend }), ...(force && { force }) },
      {
        onSuccess: (res) => { notifySuccess("Generic model training queued", res.message); onClose(); },
        onError: (err) => notifyError("Training not started", err),
      },
    );

  return (
    <Modal title="Generic model" open={open} onClose={onClose} width="lg">
      <div className="predictor-wizard-step">
        <p className="predictor-wizard-note-text">
          Forecasts houses that have too little history or no model of their own. It is trained on the pooled data of
          every house, leaving out houses whose readings would skew it: an uncertain meter unit, a level far from the
          other houses (likely another unit), or no production at all.
        </p>

        {isLoading ? (
          <p className="is-muted">Loading…</p>
        ) : isError ? (
          <p className="predictor-wizard-warning" role="alert">
            The generic model could not be loaded. The predictor may be an older version without this option.
          </p>
        ) : (
          <div className="generic-lanes">
            {LANES.map((lane) => <LaneCard key={lane} lane={lane} info={data?.[lane]} timezone={timezone} />)}
          </div>
        )}

        <section className="retrain-all-plan" aria-label="Retrain">
          <h4>Retrain</h4>
          <div className="retrain-all-options">
            <fieldset className="predictor-choice-group">
              <legend>Lanes</legend>
              <div className="predictor-lane-toggle" role="group" aria-label="Lanes">
                {([["both", "Both"], ["consumption", "Consumption"], ["production", "Production"]] as const).map(([id, text]) => (
                  <button key={id} type="button" className={`predictor-lane-btn${lanes === id ? " is-active" : ""}`}
                    aria-pressed={lanes === id} onClick={() => setLanes(id)}>{text}</button>
                ))}
              </div>
            </fieldset>
            <fieldset className="predictor-choice-group">
              <legend>Model</legend>
              <div className="predictor-lane-toggle" role="group" aria-label="Model">
                {([["chosen", "Chosen type"], ...BACKENDS] as const).map(([id, text]) => (
                  <button key={id} type="button" className={`predictor-lane-btn${backend === id ? " is-active" : ""}`}
                    aria-pressed={backend === id} onClick={() => setBackend(id)}>{text}</button>
                ))}
              </div>
              {backend === "chosen" && <small>Each lane retrains the backend chosen above, XGBoost when none is.</small>}
            </fieldset>
          </div>
          <ForceOption force={force} onChange={setForce} />
        </section>

        <div className="train-modal-footer">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={retrain} disabled={commandMutation.isPending}>
            {commandMutation.isPending ? "Starting…" : "Retrain generic model"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** "Keep the new model even if it is worse", with the warning shown while it is on. */
export function ForceOption({ force, onChange }: { force: boolean; onChange: (force: boolean) => void }) {
  return (
    <div className="predictor-choice-group">
      <label className="analysis-filter-check generic-force">
        <input type="checkbox" checked={force} onChange={(e) => onChange(e.target.checked)} />
        <span>Keep the new model even if its error is higher</span>
      </label>
      {force && (
        <p className="predictor-wizard-warning" role="status">
          The new model replaces the current one whatever its error (MAE). The current one is archived and can be promoted back from the Analysis tab.
        </p>
      )}
    </div>
  );
}
