import { usePredictorTrainingProgress, usePredictorCommand, useCancelTrainingJob } from "../../../hooks/usePredictor";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import { useState } from "react";
import { PlusCircle, RotateCcw } from "lucide-react";

interface TrainViewProps {
  selectedHouseId: string | null;
}

function fmtEta(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function getStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "RUNNING" || status === "FETCHING") return "info";
  if (status === "ACCEPTED" || status === "COMPLETED") return "success";
  if (status === "REJECTED") return "warning";
  if (status === "FAILED") return "danger";
  return "neutral";
}

export function TrainView({ selectedHouseId }: TrainViewProps) {
  const { notifySuccess, notifyError } = useApiFeedback();
  const { data: jobs } = usePredictorTrainingProgress();
  const commandMutation = usePredictorCommand();
  const cancelMutation = useCancelTrainingJob();

  const [showTrainDialog, setShowTrainDialog] = useState(false);
  const [showColdTrainDialog, setShowColdTrainDialog] = useState(false);
  const [jobToCancel, setJobToCancel] = useState<string | null>(null);
  const [modelSchema, setModelSchema] = useState<"dense" | "sparse">("dense");

  const activeJobs = jobs?.filter((j) => ["PENDING", "FETCHING", "RUNNING"].includes(j.status)) ?? [];
  const completedJobs = jobs?.filter((j) => !["PENDING", "FETCHING", "RUNNING"].includes(j.status)) ?? [];

  const handleTrain = () => {
    if (!selectedHouseId) return;
    commandMutation.mutate(
      { command: "train", house_id: selectedHouseId, lane: "both", model_schema: modelSchema },
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
    if (!jobToCancel) return;
    cancelMutation.mutate(jobToCancel, {
      onSuccess: () => { notifySuccess("Job Cancelled", "Job cancelled successfully."); setJobToCancel(null); },
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
                    <th>ID</th>
                    <th>House</th>
                    <th>Lane</th>
                    <th>Status</th>
                    <th style={{ minWidth: 180 }}>Progress</th>
                    <th>ETA</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {activeJobs.map((job, idx) => {
                    const pct = job.total > 0 ? (job.progress / job.total) * 100 : 0;
                    return (
                      <tr key={`${job.job_id}-${idx}`}>
                        <td className="is-muted" style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                          {job.job_id.slice(0, 8)}…
                        </td>
                        <td>{job.house_id}</td>
                        <td style={{ textTransform: "capitalize" }}>{job.lane}</td>
                        <td><Badge tone={getStatusTone(job.status)}>{job.status}</Badge></td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div className="predictor-progress-bar">
                              <div className="predictor-progress-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="is-muted" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                              {job.progress}/{job.total}
                            </span>
                          </div>
                        </td>
                        <td className="is-muted" style={{ fontSize: "0.8rem" }}>{fmtEta(job.eta_seconds)}</td>
                        <td>
                          <Button variant="ghost" size="sm" onClick={() => setJobToCancel(job.job_id)}>
                            Cancel
                          </Button>
                        </td>
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
                    <th>Status</th>
                    <th>Prev MAE</th>
                    <th>New MAE</th>
                  </tr>
                </thead>
                <tbody>
                  {completedJobs.slice(0, 50).map((job, idx) => {
                    const improved = job.new_mae != null && job.prev_mae != null && job.new_mae < job.prev_mae;
                    return (
                      <tr key={`${job.job_id}-${idx}`}>
                        <td>{job.house_id}</td>
                        <td style={{ textTransform: "capitalize" }}>{job.lane}</td>
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

      <ConfirmDialog
        open={showTrainDialog}
        title="Train Model"
        message={
          <>
            <span>{`Start a new training job for house ${selectedHouseId}? If the new model performs better, it will be automatically hot-swapped.`}</span>
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Model schema:</label>
              <select
                value={modelSchema}
                onChange={(e) => setModelSchema(e.target.value as "dense" | "sparse")}
                style={{ fontSize: "0.85rem", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", color: "inherit" }}
              >
                <option value="dense">Dense (default)</option>
                <option value="sparse">Sparse</option>
              </select>
            </div>
          </>
        }
        confirmLabel="Train Both Lanes"
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

      <ConfirmDialog
        open={!!jobToCancel}
        title="Cancel Training Job"
        message="Are you sure you want to cancel this job? It will be stopped at the next iteration boundary."
        confirmLabel="Cancel Job"
        confirmVariant="danger"
        pending={cancelMutation.isPending}
        onConfirm={handleCancelJob}
        onCancel={() => setJobToCancel(null)}
      />
    </div>
  );
}