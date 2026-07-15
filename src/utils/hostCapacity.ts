import type { HostInfo } from "../types";

export interface HostCapacityProfileSummary {
  active: number;
  max: number;
}

export interface HostCapacitySummary {
  label: string;
  active: number;
  max: number;
  overCapacity: boolean;
  profiles?: {
    cpu: HostCapacityProfileSummary;
    gpu: HostCapacityProfileSummary;
  };
}

function readCount(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed === null ? null : Math.max(0, Math.floor(parsed));
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readProfileCount(record: unknown, profile: "cpu" | "gpu"): number | null {
  const value = asNumber(asRecord(record)?.[profile]);
  return value === null ? null : Math.max(0, Math.floor(value));
}

function fallbackActiveCount(host: HostInfo): number {
  const reported = asNumber(host.info?.active_job_count);
  if (reported !== null) return Math.max(0, Math.floor(reported));
  if (Array.isArray(host.active_job_ids)) return host.active_job_ids.length;
  return Math.max(0, Math.floor(host.running || 0));
}

export function resolveHostCapacitySummary(hostName: string, host: HostInfo): HostCapacitySummary {
  const isDeucalion = hostName.toLowerCase() === "deucalion";
  const activeByProfile = host.info?.active_job_count_by_profile;
  const maxByProfile = host.info?.max_active_jobs_by_profile;

  if (isDeucalion) {
    const cpuActive = readProfileCount(activeByProfile, "cpu") ?? 0;
    const gpuActive = readProfileCount(activeByProfile, "gpu") ?? 0;
    const cpuMax = readProfileCount(maxByProfile, "cpu") ?? 1;
    const gpuMax = readProfileCount(maxByProfile, "gpu") ?? 1;
    const active = cpuActive + gpuActive;
    const max = cpuMax + gpuMax;

    return {
      label: `CPU ${cpuActive}/${cpuMax} · GPU ${gpuActive}/${gpuMax}`,
      active,
      max,
      overCapacity: cpuActive > cpuMax || gpuActive > gpuMax,
      profiles: {
        cpu: { active: cpuActive, max: cpuMax },
        gpu: { active: gpuActive, max: gpuMax }
      }
    };
  }

  const active = fallbackActiveCount(host);
  const max = Math.max(1, Math.floor(asNumber(host.info?.max_active_jobs) ?? 1));
  const running = readCount(host.info?.running_job_count);
  const provisioning = readCount(host.info?.provisioning_job_count);
  const unionBreakdown = hostName.toLowerCase() === "union-inesctec" && (running !== null || provisioning !== null)
    ? ` · ${running ?? 0} running · ${provisioning ?? 0} provisioning`
    : "";
  return {
    label: `Slots: ${active}/${max}${unionBreakdown}`,
    active,
    max,
    overCapacity: active > max
  };
}
