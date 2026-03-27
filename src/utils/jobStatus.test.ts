import { describe, expect, it } from "vitest";
import {
  isCompletedForResults,
  jobStatusTone,
  normalizeJobStatus,
  prettyJobStatus
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
    expect(jobStatusTone("unknown")).toBe("info");
  });

  it("pretty prints underscore statuses", () => {
    expect(prettyJobStatus("stop_requested")).toBe("stop requested");
  });

  it("identifies statuses that can expose results", () => {
    expect(isCompletedForResults("completed")).toBe(true);
    expect(isCompletedForResults("SUCCESS")).toBe(true);
    expect(isCompletedForResults("running")).toBe(false);
    expect(isCompletedForResults("queued")).toBe(false);
    expect(isCompletedForResults("failed")).toBe(false);
  });
});
