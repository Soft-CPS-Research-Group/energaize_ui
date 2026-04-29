import { usePredictorTrainingProgress, usePredictorCommand, useCancelTrainingJob } from "../../../hooks/usePredictor";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Modal } from "../../../components/ui/Modal";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import { useState } from "react";
import { PlusCircle, RotateCcw } from "lucide-react";
import type { ModelBackend, TrainingJob } from "../../../api/predictorApi";

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

  const activeJobs = jobs?.filter((j) => ACTIVE_STATUSES.includes(j.status)) ?? [];
  const completedJobs = jobs?.filter((j) => !ACTIVE_STATUSES.includes(j.status)) ?? [];

  const handleTrain = () => {
    if (!selectedHouseId) return;
    commandMutation.mutate(
      { command: "train", house_id: selectedHouseId, lane: "both", model_type: trainModelType, model_schema: trainSchema },
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
        open={showTrainDialog}
        title="Train Model"
        message={
          <>
            <p style={{ marginBottom: 14 }}>Configure training for house <strong>{selectedHouseId}</strong>. If the new model outperforms the current one it will be hot-swapped automatically.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
                <span style={{ color: "var(--text-soft)" }}>Model type</span>
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
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
                <span style={{ color: "var(--text-soft)" }}>Feature schema</span>
                <select
                  className="predictor-house-select"
                  value={trainSchema}
                  onChange={(e) => setTrainSchema(e.target.value as "dense" | "sparse")}
                >
                  <option value="dense">Dense</option>
                  <option value="sparse">Sparse</option>
                </select>
              </label>
            </div>
          </>
        }
        confirmLabel="Start Training"
        confirmVariant="primary"
        pending={commandMutation.isPending}
        onConfirm={handleTrain}
        onCancel={() => setShowTrainDialog(false)}
      />

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
    </div>
  );
}