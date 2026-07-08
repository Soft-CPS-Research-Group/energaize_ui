import type { HostInfo } from "../types";

export type HostComputeKind = "cpu" | "gpu" | "mixed" | "unknown";

function readHostBoolean(info: HostInfo["info"] | undefined, key: string): boolean | null {
  if (!info || !(key in info)) return null;
  const value = info[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  return null;
}

export function resolveHostComputeKind(hostName: string, host?: HostInfo | null): HostComputeKind {
  const normalizedName = hostName.trim().toLowerCase();
  if (normalizedName === "deucalion") return "mixed";

  const info = host?.info;
  const profileLimits = info?.max_active_jobs_by_profile;
  const cpuSlots = typeof profileLimits?.cpu === "number" ? profileLimits.cpu : 0;
  const gpuSlots = typeof profileLimits?.gpu === "number" ? profileLimits.gpu : 0;
  if (cpuSlots > 0 && gpuSlots > 0) return "mixed";
  if (gpuSlots > 0) return "gpu";
  if (cpuSlots > 0) return "cpu";

  const gpuKeys = ["gpu_enabled", "gpu_required", "has_gpu", "gpu", "cuda_available"];
  for (const key of gpuKeys) {
    const value = readHostBoolean(info, key);
    if (value === true) return "gpu";
  }
  for (const key of gpuKeys) {
    const value = readHostBoolean(info, key);
    if (value === false) return "cpu";
  }

  return "unknown";
}

export function resolveHostComputeBadge(hostName: string, host?: HostInfo | null): {
  kind: HostComputeKind;
  label: string;
  title: string;
} {
  const kind = resolveHostComputeKind(hostName, host);
  if (kind === "gpu") return { kind, label: "GPU", title: "GPU-capable worker" };
  if (kind === "cpu") return { kind, label: "CPU", title: "CPU-only worker" };
  if (kind === "mixed") return { kind, label: "CPU+GPU", title: "Supports CPU and GPU workloads" };
  return { kind, label: "?", title: "Compute capability unknown" };
}
