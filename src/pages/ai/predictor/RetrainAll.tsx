import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import { useCancelBatch, usePredictorBatch, usePredictorBatches, useStartBatch } from "../../../hooks/usePredictor";
import { planBatch, type BatchOptions, type ModelBackend } from "../../../api/predictorApi";
import {
  BATCH_ITEM_LABELS, BATCH_STATUS_LABELS, batchCountsText, batchPercent, countByReason, currentBatch,
} from "./batchFormat";
import { fmtTs } from "./analysisFormat";

const MODEL_LABELS: Record<string, string> = { xgboost: "XGBoost", lgbm: "LightGBM", lstm: "LSTM" };
const PREVIEW_ROWS = 50;

type Only = "needed" | "all";
type Lanes = "both" | "consumption" | "production";
type ModelChoice = "active" | ModelBackend;

function Toggle<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="predictor-lane-toggle" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" className={`predictor-lane-btn${value === id ? " is-active" : ""}`}
          aria-pressed={value === id} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Choose which houses to retrain, see the plan the predictor would run, then start it. */
export function RetrainAllModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notifySuccess, notifyError } = useApiFeedback();
  const startMutation = useStartBatch();
  const [only, setOnly] = useState<Only>("needed");
  const [lanes, setLanes] = useState<Lanes>("both");
  const [model, setModel] = useState<ModelChoice>("active");
  const [maxAge, setMaxAge] = useState("30");
  const [parallel, setParallel] = useState("2");

  const ageDays = Number(maxAge);
  const ageValid = maxAge.trim() !== "" && Number.isFinite(ageDays) && ageDays >= 0;
  const options: BatchOptions = {
    houses: "all", lanes, only, model_type: model,
    max_model_age_days: ageValid ? ageDays : 30, max_parallel: Number(parallel),
  };

  const plan = useQuery({
    queryKey: ["predictor", "batch-plan", options],
    queryFn: () => planBatch(options),
    enabled: open && ageValid,
    staleTime: 10000,
  });
  const items = plan.data?.items ?? [];
  const groups = countByReason(items);
  const largest = Math.max(1, ...groups.map((g) => g.count));

  const start = () =>
    startMutation.mutate(options, {
      onSuccess: (res) => {
        notifySuccess("Retraining started", res.message);
        onClose();
      },
      onError: (err) => notifyError("Retraining not started", err),
    });

  return (
    <Modal title="Retrain all houses" open={open} onClose={onClose} width="lg">
      <div className="predictor-wizard-step">
        <div className="retrain-all-options">
          <fieldset className="predictor-choice-group">
            <legend>Houses</legend>
            <Toggle label="Houses" value={only} onChange={setOnly}
              options={[["needed", "Only those that need it"], ["all", "Every house"]] as const} />
            <small>
              {only === "needed"
                ? "Lanes whose forecast is refused, that have no model, that predate unit detection, or whose model is old."
                : "Every house and lane, most urgent first. Up-to-date models go last."}
            </small>
          </fieldset>
          {only === "needed" && (
            <label className="predictor-choice-group retrain-all-age">
              <span className="retrain-all-field-label">Old after (days)</span>
              <input type="number" min={0} step={1} value={maxAge} onChange={(e) => setMaxAge(e.target.value)}
                aria-invalid={!ageValid} />
              <small>{ageValid ? (ageDays === 0 ? "Age alone never counts." : "") : "Enter 0 or more."}</small>
            </label>
          )}
          <fieldset className="predictor-choice-group">
            <legend>Lanes</legend>
            <Toggle label="Lanes" value={lanes} onChange={setLanes}
              options={[["both", "Both"], ["consumption", "Consumption"], ["production", "Production"]] as const} />
          </fieldset>
          <fieldset className="predictor-choice-group">
            <legend>Model</legend>
            <Toggle label="Model" value={model} onChange={setModel}
              options={[["active", "Current type"], ["xgboost", "XGBoost"], ["lgbm", "LightGBM"], ["lstm", "LSTM"]] as const} />
            <small>
              {model === "active"
                ? "Each lane retrains the model type it forecasts with now."
                : model === "lstm" ? "LSTM jobs run one at a time, so this takes longest." : ""}
            </small>
          </fieldset>
          <fieldset className="predictor-choice-group">
            <legend>Jobs at once</legend>
            <Toggle label="Jobs at once" value={parallel} onChange={setParallel}
              options={[["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]] as const} />
            <small>More is faster but uses more of the predictor's CPU and memory while forecasts run.</small>
          </fieldset>
        </div>

        <section className="retrain-all-plan" aria-label="Plan">
          <h4>Plan</h4>
          {!ageValid ? null : plan.isLoading ? (
            <p className="is-muted">Working out which houses need retraining…</p>
          ) : plan.isError ? (
            <p className="predictor-wizard-warning" role="alert">
              The plan could not be loaded ({(plan.error as Error)?.message || "unknown error"}). The predictor may be an older version without batch retraining.
            </p>
          ) : items.length === 0 ? (
            <p className="is-muted">No house needs retraining with these options.</p>
          ) : (
            <>
              <p className="is-muted">{items.length} {items.length === 1 ? "lane" : "lanes"} will be retrained, in this order.</p>
              <div className="retrain-all-bars">
                {groups.map((g) => (
                  <div key={g.priority} className="retrain-all-bar-row">
                    <span>{g.label}</span>
                    <div className="retrain-all-bar"><div className={`retrain-all-bar-fill is-p${g.priority}`} style={{ width: `${(g.count / largest) * 100}%` }} /></div>
                    <strong>{g.count}</strong>
                  </div>
                ))}
              </div>
              <div className="retrain-all-table-scroll">
                <table className="table predictor-jobs-table">
                  <thead>
                    <tr><th>#</th><th>House</th><th>Lane</th><th>Model</th><th>Why</th></tr>
                  </thead>
                  <tbody>
                    {items.slice(0, PREVIEW_ROWS).map((item, i) => (
                      <tr key={`${item.house_id}-${item.lane}`}>
                        <td className="is-muted">{i + 1}</td>
                        <td>{item.house_id}</td>
                        <td className="is-capitalized">{item.lane}</td>
                        <td>{MODEL_LABELS[item.model_type] ?? item.model_type}</td>
                        <td className="is-muted">{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {items.length > PREVIEW_ROWS && <p className="is-muted retrain-all-more">and {items.length - PREVIEW_ROWS} more</p>}
              </div>
            </>
          )}
        </section>

        <p className="predictor-wizard-note-text">
          Each lane becomes a normal training job. A new model replaces the current one only if its error (MAE) is lower.
          Lanes that are already training are skipped.
        </p>

        <div className="train-modal-footer">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={start} disabled={startMutation.isPending || !ageValid || plan.isLoading || items.length === 0}>
            {startMutation.isPending ? "Starting…" : items.length ? `Retrain ${items.length} ${items.length === 1 ? "lane" : "lanes"}` : "Retrain"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The running batch (or the last one): progress, results per lane, and stop. */
export function BatchPanel({ timezone }: { timezone: string }) {
  const { notifySuccess, notifyError } = useApiFeedback();
  const { data: batches } = usePredictorBatches();
  const summary = currentBatch(batches);
  const [expanded, setExpanded] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const { data: detail } = usePredictorBatch(summary && (expanded || summary.status === "RUNNING") ? summary.batch_id : null);
  const cancelMutation = useCancelBatch();

  if (!summary) return null;
  const batch = detail && detail.batch_id === summary.batch_id ? { ...summary, ...detail } : summary;
  const running = batch.status === "RUNNING";
  const status = BATCH_STATUS_LABELS[batch.status] ?? { label: batch.status, tone: "neutral" as const };
  const pct = batchPercent(batch);
  const counts = batchCountsText(batch.counts);
  const items = detail && detail.batch_id === summary.batch_id ? detail.items : [];

  const stop = () =>
    cancelMutation.mutate(batch.batch_id, {
      onSuccess: () => { notifySuccess("Retraining stopped", "Waiting lanes were dropped and running jobs are stopping."); setConfirmStop(false); },
      onError: (err) => notifyError("Could not stop retraining", err),
    });

  return (
    <section className="panel predictor-jobs-panel" aria-label="Retrain all houses">
      <div className="predictor-panel-header">
        <h2>{running ? "Retraining all houses" : "Last retrain of all houses"}</h2>
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="is-muted retrain-all-when">
          {running ? `Started ${fmtTs(batch.created_at, timezone)}` : `Finished ${fmtTs(batch.finished_at, timezone)}`}
        </span>
        {running && (
          <Button variant="danger" size="sm" onClick={() => setConfirmStop(true)} disabled={cancelMutation.isPending}>
            Stop
          </Button>
        )}
      </div>
      <div className="predictor-panel-body retrain-all-summary">
        <div className="predictor-progress-cell">
          <div className="predictor-progress-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="predictor-progress-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <span className="is-muted">{batch.finished} / {batch.total} lanes</span>
        </div>
        {counts && <p className="is-muted">{counts}</p>}
        {batch.status !== "DONE" && batch.message && <p className="is-muted">{batch.message}</p>}
        <Button variant="secondary" size="sm" className="retrain-all-toggle" aria-expanded={expanded}
          iconLeft={expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Hide lanes" : "Show lanes"}
        </Button>
        {expanded && (
          <div className="retrain-all-table-scroll">
            <table className="table predictor-jobs-table">
              <thead>
                <tr><th>House</th><th>Lane</th><th>Model</th><th>Why</th><th>Status</th><th>Error (MAE)</th></tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const s = BATCH_ITEM_LABELS[item.status] ?? { label: item.status, tone: "neutral" as const };
                  const improved = item.new_mae != null && item.prev_mae != null && item.new_mae < item.prev_mae;
                  return (
                    <tr key={`${item.house_id}-${item.lane}`} title={item.message || undefined}>
                      <td>{item.house_id}</td>
                      <td className="is-capitalized">{item.lane}</td>
                      <td>{MODEL_LABELS[item.model_type] ?? item.model_type}</td>
                      <td className="is-muted">{item.reason}</td>
                      <td><Badge tone={s.tone}>{s.label}</Badge></td>
                      <td className="predictor-mae-cell">
                        {item.new_mae == null ? <span className="is-muted">—</span> : (
                          <><span className="is-muted">{item.prev_mae == null ? "—" : item.prev_mae.toFixed(4)}</span> → <strong className={improved ? "is-improved" : undefined}>{item.new_mae.toFixed(4)}</strong></>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmStop}
        title="Stop retraining"
        message="Lanes that have not started are dropped and the jobs running now are stopped. Models already accepted stay in use."
        confirmLabel="Stop retraining"
        pending={cancelMutation.isPending}
        onConfirm={stop}
        onCancel={() => setConfirmStop(false)}
      />
    </section>
  );
}
