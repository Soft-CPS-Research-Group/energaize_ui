import type { BatchItem, BatchStatus, BatchSummary } from "../../../api/predictorApi";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

/** One-word batch statuses. */
export const BATCH_STATUS_LABELS: Record<BatchStatus, { label: string; tone: Tone }> = {
  RUNNING: { label: "Running", tone: "info" },
  DONE: { label: "Done", tone: "success" },
  CANCELED: { label: "Stopped", tone: "neutral" },
  STOPPED: { label: "Halted", tone: "warning" },
  INTERRUPTED: { label: "Interrupted", tone: "warning" },
};

/** Item statuses: the training job statuses plus the batch's own. */
export const BATCH_ITEM_LABELS: Record<string, { label: string; tone: Tone }> = {
  QUEUED: { label: "Waiting", tone: "neutral" },
  PENDING: { label: "Queued", tone: "neutral" },
  FETCHING: { label: "Loading", tone: "info" },
  RUNNING: { label: "Training", tone: "info" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  REJECTED: { label: "Rejected", tone: "neutral" },
  CANCELED: { label: "Stopped", tone: "neutral" },
  FAILED: { label: "Failed", tone: "danger" },
  SKIPPED: { label: "Skipped", tone: "neutral" },
};

/** Why lanes are in a batch, most urgent first (the predictor's priorities 0-4). */
export const REASON_GROUPS = [
  { priority: 0, label: "Forecast refused" },
  { priority: 1, label: "No model" },
  { priority: 2, label: "Before unit detection" },
  { priority: 3, label: "Old model" },
  { priority: 4, label: "Up to date" },
] as const;

export interface ReasonCount {
  priority: number;
  label: string;
  count: number;
}

/** How many planned lanes fall in each reason group, leaving out empty groups. */
export function countByReason(items: Pick<BatchItem, "priority">[]): ReasonCount[] {
  return REASON_GROUPS
    .map((g) => ({ ...g, count: items.filter((i) => i.priority === g.priority).length }))
    .filter((g) => g.count > 0);
}

export function batchPercent(batch: Pick<BatchSummary, "finished" | "total">): number {
  return batch.total > 0 ? (batch.finished / batch.total) * 100 : 0;
}

/** "3 accepted · 1 rejected · 2 failed", in a fixed order, for a batch's counts. */
export function batchCountsText(counts: Record<string, number>): string {
  const order = ["ACCEPTED", "REJECTED", "FAILED", "SKIPPED", "CANCELED"];
  return order
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${BATCH_ITEM_LABELS[s].label.toLowerCase()}`)
    .join(" · ");
}

/** The batch to show on the Train tab: the running one, else the newest. */
export function currentBatch(batches: BatchSummary[] | undefined): BatchSummary | null {
  if (!batches || batches.length === 0) return null;
  return batches.find((b) => b.status === "RUNNING") ?? batches[0];
}
