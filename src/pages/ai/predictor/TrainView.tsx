import { usePredictorTrainingProgress, usePredictorCommand, useCancelTrainingJob } from "../../../hooks/usePredictor";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import { useState } from "react";
import { PlusCircle, Search } from "lucide-react";

interface TrainViewProps {
  selectedHouseId: string | null;
}

export function TrainView({ selectedHouseId }: TrainViewProps) {
  const { notifySuccess, notifyError } = useApiFeedback();
  const { data: jobs } = usePredictorTrainingProgress();
  const commandMutation = usePredictorCommand();
  const cancelMutation = useCancelTrainingJob();

  const [showTrainDialog, setShowTrainDialog] = useState(false);
  const [showColdTrainDialog, setShowColdTrainDialog] = useState(false);
  const [jobToCancel, setJobToCancel] = useState<string | null>(null);

  const activeJobs = jobs?.filter((j) => ["PENDING", "FETCHING", "RUNNING"].includes(j.status)) || [];
  const completedJobs = jobs?.filter((j) => !["PENDING", "FETCHING", "RUNNING"].includes(j.status)) || [];

  const handleTrain = (lane: "consumption" | "production" | "both") => {
    if (!selectedHouseId) return;
    commandMutation.mutate(
      { command: "train", house_id: selectedHouseId, lane },
      {
        onSuccess: (res) => {
          notifySuccess("Training Queued", res.message);
          setShowTrainDialog(false);
        },
        onError: (err) => notifyError("Training Error", err),
      }
    );
  };

  const handleColdTrain = () => {
    commandMutation.mutate(
      { command: "train-cold", lane: "both" },
      {
        onSuccess: (res) => {
          notifySuccess("Cold Training", res.message);
          setShowColdTrainDialog(false);
        },
        onError: (err) => notifyError("Training Error", err),
      }
    );
  };

  const handleCancelJob = () => {
    if (!jobToCancel) return;
    cancelMutation.mutate(jobToCancel, {
      onSuccess: () => {
        notifySuccess("Job Cancelled", "Job cancelled successfully.");
        setJobToCancel(null);
      },
      onError: (err) => notifyError("Cancel Error", err),
    });
  };

  const getStatusColor = (status: string) => {
    if (status === "RUNNING") return "info";
    if (status === "ACCEPTED") return "success";
    if (status === "REJECTED") return "warning";
    if (status === "FAILED") return "danger";
    return "neutral";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", padding: "16px" }}>
      <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
        <Button onClick={() => setShowTrainDialog(true)} disabled={!selectedHouseId || commandMutation.isPending}>
          <PlusCircle style={{ marginRight: "8px" }} size={16} /> Train Selected House
        </Button>
        <Button variant="secondary" onClick={() => setShowColdTrainDialog(true)} disabled={commandMutation.isPending}>
          <Search style={{ marginRight: "8px" }} size={16} /> Retrain Cold Start (All)
        </Button>
      </div>

      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Active Jobs panel */}
        <div className="panel" style={{ flex: 2, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", border: "1px solid var(--border)", minWidth: "400px" }}>
          <div style={{ padding: "16px", borderBottom: "1px solid var(--border)", backgroundColor: "var(--bg-subtle)" }}>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Active Training Jobs</h2>
          </div>
          <div style={{ overflowX: "auto" }}>
            {activeJobs.length === 0 ? (
              <div style={{ padding: "32px", textAlign: "center", fontSize: "0.875rem", opacity: 0.5 }}>No active jobs.</div>
            ) : (
              <table className="table" style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ backgroundColor: "var(--bg-subtle)", fontSize: "0.75rem", textTransform: "uppercase", opacity: 0.7 }}>
                    <th style={{ padding: "12px 16px" }}>ID</th>
                    <th style={{ padding: "12px 16px" }}>House</th>
                    <th style={{ padding: "12px 16px" }}>Lane</th>
                    <th style={{ padding: "12px 16px" }}>Status</th>
                    <th style={{ padding: "12px 16px", width: "33%" }}>Progress</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                {activeJobs.map((job, idx) => (
                  <tr key={`${job.job_id}-${idx}`} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "12px 16px", fontSize: "0.875rem", fontFamily: "monospace" }}>{job.job_id.slice(0, 8)}...</td>
                      <td style={{ padding: "12px 16px" }}>{job.house_id}</td>
                      <td style={{ padding: "12px 16px", textTransform: "capitalize" }}>{job.lane}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <Badge tone={getStatusColor(job.status) as any}>{job.status}</Badge>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ flex: 1, backgroundColor: "var(--bg-subtle)", height: "8px", borderRadius: "999px", overflow: "hidden" }}>
                            <div
                              style={{ height: "100%", backgroundColor: "var(--brand)", transition: "all 0.5s", width: `${(job.progress / Math.max(1, job.total)) * 100}%` }}
                            />
                          </div>
                          <span style={{ fontSize: "0.75rem", opacity: 0.7, width: "32px", textAlign: "right" }}>{job.progress}/{job.total}</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        <Button variant="ghost" size="sm" onClick={() => setJobToCancel(job.job_id)}>
                          Cancel
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Completed History panel */}
        <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", border: "1px solid var(--border)", minWidth: "300px" }}>
          <div style={{ padding: "16px", borderBottom: "1px solid var(--border)", backgroundColor: "var(--bg-subtle)" }}>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Completed History</h2>
          </div>
          <div style={{ overflowX: "auto", maxHeight: "600px" }}>
            <table className="table" style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "var(--bg-subtle)", fontSize: "0.75rem", textTransform: "uppercase", opacity: 0.7 }}>
                  <th style={{ padding: "12px 16px" }}>House</th>
                  <th style={{ padding: "12px 16px" }}>Status</th>
                  <th style={{ padding: "12px 16px" }}>Prev MAE</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>New MAE</th>
                </tr>
              </thead>
              <tbody>
                {completedJobs.slice(0, 50).map((job, idx) => (
                  <tr key={`${job.job_id}-${idx}`} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "12px 16px" }}>{job.house_id}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <Badge tone={getStatusColor(job.status) as any}>{job.status}</Badge>
                    </td>
                    <td style={{ padding: "12px 16px", opacity: 0.7 }}>{job.prev_mae?.toFixed(4) ?? "-"}</td>
                    <td style={{ padding: "12px 16px", fontWeight: "bold", textAlign: "right", color: job.new_mae! < job.prev_mae! ? "var(--success)" : "inherit" }}>
                      {job.new_mae?.toFixed(4) ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showTrainDialog}
        title="Train Model"
        message={`Do you want to start a new training job for house ${selectedHouseId}? If the new model performs better, it will be automatically hot-swapped.`}
        confirmLabel="Train Both Lanes"
        confirmVariant="primary"
        pending={commandMutation.isPending}
        onConfirm={() => handleTrain("both")}
        onCancel={() => setShowTrainDialog(false)}
      />

      <ConfirmDialog
        open={showColdTrainDialog}
        title="Retrain Cold Start Model"
        message="This will submit a distributed cold-start training job across all houses in the cluster."
        confirmLabel="Start Cold Training"
        confirmVariant="primary"
        pending={commandMutation.isPending}
        onConfirm={() => handleColdTrain()}
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