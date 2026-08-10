import { describe, expect, it } from "vitest";
import {
  canDeleteJobStatus,
  isCompletedForResults,
  jobStatusTone,
  normalizeJobStatus,
  prettyJobStatus,
  resolveDisplayJobStatus
} from "./jobStatus";

describe("jobStatus utils", () => {
  it("preserves backend status values and defaults empty to unknown", () => {
    expect(normalizeJobStatus("running")).toBe("running");
    expect(normalizeJobStatus("bad_state")).toBe("bad_state");
    expect(normalizeJobStatus(undefined)).toBe("unknown");
  });

  it("maps tones by status", () => {
    expect(jobStatusTone("finished")).toBe("success");
    expect(jobStatusTone("failed")).toBe("error");
    expect(jobStatusTone("queued")).toBe("warning");
    expect(jobStatusTone("setup")).toBe("warning");
    expect(jobStatusTone("recovering")).toBe("warning");
    expect(jobStatusTone("unknown")).toBe("info");
  });

  it("pretty prints underscore statuses", () => {
    expect(prettyJobStatus("stop_requested")).toBe("stop requested");
  });

  it("presents Union recovery as exporting", () => {
    expect(resolveDisplayJobStatus("recovering", 100)).toBe("exporting");
  });

  it("identifies statuses that can expose results", () => {
    expect(isCompletedForResults("completed")).toBe(true);
    expect(isCompletedForResults("SUCCESS")).toBe(true);
    expect(isCompletedForResults("running")).toBe(false);
    expect(isCompletedForResults("queued")).toBe(false);
    expect(isCompletedForResults("setup")).toBe(false);
    expect(isCompletedForResults("failed")).toBe(false);
    expect(isCompletedForResults("recovering")).toBe(false);
  });

  it("allows deletion only after the job reaches a terminal status", () => {
    expect(canDeleteJobStatus("finished")).toBe(true);
    expect(canDeleteJobStatus("failed")).toBe(true);
    expect(canDeleteJobStatus("stopped")).toBe(true);
    expect(canDeleteJobStatus("canceled")).toBe(true);
    expect(canDeleteJobStatus("queued")).toBe(false);
    expect(canDeleteJobStatus("setup")).toBe(false);
    expect(canDeleteJobStatus("running")).toBe(false);
    expect(canDeleteJobStatus("recovering")).toBe(false);
    expect(canDeleteJobStatus("stop_requested")).toBe(false);
  });
});
