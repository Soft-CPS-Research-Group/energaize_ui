import type { JobStatus } from "../types";

export function normalizeJobStatus(value: string | undefined | null): JobStatus {
  if (!value) return "unknown";
  return value.trim() || "unknown";
}

export function jobStatusTone(status: JobStatus): "info" | "success" | "warning" | "error" {
  const key = status.toLowerCase();

  if (
    key.includes("fail") ||
    key.includes("error") ||
    key.includes("cancel") ||
    key.includes("offline")
  ) {
    return "error";
  }

  if (
    key.includes("finish") ||
    key.includes("complete") ||
    key.includes("success") ||
    key.includes("stopped") ||
    key.includes("done")
  ) {
    return "success";
  }

  if (
    key.includes("queue") ||
    key.includes("running") ||
    key.includes("launch") ||
    key.includes("dispatch") ||
    key.includes("progress") ||
    key.includes("pending") ||
    key.includes("stop_requested")
  ) {
    return "warning";
  }

  return "info";
}

export function prettyJobStatus(status: JobStatus): string {
  return status.replaceAll("_", " ");
}
