import { describe, expect, it } from "vitest";
import type { HostInfo } from "../types";
import { resolveHostCapacitySummary } from "./hostCapacity";

function host(overrides: Partial<HostInfo> = {}): HostInfo {
  return {
    online: true,
    last_seen: Date.now() / 1000,
    info: {},
    running: 0,
    ...overrides
  };
}

describe("hostCapacity", () => {
  it("uses Deucalion CPU/GPU profile slots", () => {
    const summary = resolveHostCapacitySummary(
      "deucalion",
      host({
        info: {
          active_job_count_by_profile: { cpu: 1, gpu: 0 },
          max_active_jobs_by_profile: { cpu: 1, gpu: 1 }
        },
        running: 1
      })
    );

    expect(summary.label).toBe("CPU 1/1 · GPU 0/1");
    expect(summary.active).toBe(1);
    expect(summary.max).toBe(2);
    expect(summary.overCapacity).toBe(false);
  });

  it("flags over capacity without expanding the limit", () => {
    const summary = resolveHostCapacitySummary(
      "deucalion",
      host({
        info: {
          active_job_count_by_profile: { cpu: 2, gpu: 1 },
          max_active_jobs_by_profile: { cpu: 1, gpu: 1 }
        },
        running: 3
      })
    );

    expect(summary.label).toBe("CPU 2/1 · GPU 1/1");
    expect(summary.overCapacity).toBe(true);
  });

  it("falls back to generic slots for other hosts", () => {
    const summary = resolveHostCapacitySummary(
      "worker-a",
      host({
        info: { active_job_count: 2, max_active_jobs: 4 },
        running: 2
      })
    );

    expect(summary.label).toBe("Slots: 2/4");
    expect(summary.overCapacity).toBe(false);
  });

  it("separates running and provisioning Union jobs", () => {
    const summary = resolveHostCapacitySummary(
      "union-inesctec",
      host({
        info: {
          active_job_count: 8,
          running_job_count: 7,
          provisioning_job_count: 1,
          max_active_jobs: 10
        },
        running: 8
      })
    );

    expect(summary.label).toBe("Slots: 8/10 · 7 running · 1 provisioning");
  });
});
