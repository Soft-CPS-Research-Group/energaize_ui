import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw } from "lucide-react";
import { listQueue, opsCancelJob, opsRequeueJob } from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useApiFeedback } from "../../hooks/useApiFeedback";
import type { QueueItem } from "../../types";

function queueTargetLabel(item: QueueItem): string {
  if (item.require_host !== false) return item.preferred_host || "-";
  if (item.target_worker_profile === "gpu") return "Any GPU";
  if (item.target_worker_profile === "cpu") return "Any CPU";
  return "Any host";
}

export function QueuePage(): JSX.Element {
  const queryClient = useQueryClient();
  const { notifyError, notifyInfo } = useApiFeedback();

  const queueQuery = useQuery({
    queryKey: ["queue"],
    queryFn: listQueue,
    refetchInterval: 5000
  });

  const actionMutation = useMutation({
    mutationFn: async (payload: { type: "requeue" | "cancel"; jobId: string }) => {
      if (payload.type === "requeue") {
        return opsRequeueJob({ job_id: payload.jobId, force: false });
      }
      return opsCancelJob({ job_id: payload.jobId, reason: "queue_cancel", force: false });
    },
    onSuccess: (_, payload) => {
      notifyInfo("Queue updated", `${payload.type} applied to ${payload.jobId}.`);
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => notifyError("Queue operation failed", error)
  });

  return (
    <div className="page">
      <PageHeader
        title="Queue"
        subtitle="Inspect pending queue entries and host constraints."
        actions={
          <Button variant="secondary" iconLeft={<RefreshCcw size={14} />} onClick={() => queueQuery.refetch()}>
            Refresh
          </Button>
        }
      />

      {queueQuery.data && queueQuery.data.length > 0 ? (
        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Preferred Host</th>
                <th>Require Host</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {queueQuery.data.map((item) => (
                <tr key={item.job_id}>
                  <td>{item.job_id}</td>
                  <td>{queueTargetLabel(item)}</td>
                  <td>{String(Boolean(item.require_host))}</td>
                  <td>
                    <div className="table-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => actionMutation.mutate({ type: "requeue", jobId: item.job_id })}
                      >
                        Requeue
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => actionMutation.mutate({ type: "cancel", jobId: item.job_id })}
                      >
                        Cancel
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <EmptyState
          title="Queue is empty"
          message="No pending entries at the moment."
          action={
            <Button variant="secondary" onClick={() => queueQuery.refetch()}>
              Refresh queue
            </Button>
          }
        />
      )}
    </div>
  );
}
