import { describe, expect, it } from "vitest";
import { jobStatusTone, normalizeJobStatus, prettyJobStatus } from "./jobStatus";

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
});
