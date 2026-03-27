import { describe, expect, it } from "vitest";
import { buildJobsListStateFromSearchParams, toJobsListSearchParams } from "./jobsListState";

describe("jobsListState helpers", () => {
  it("reads search params with defaults", () => {
    const state = buildJobsListStateFromSearchParams(new URLSearchParams("q=solar&status=completed"));
    expect(state).toEqual({ q: "solar", status: "completed", host: "all" });
  });

  it("serializes only non-default values", () => {
    const params = toJobsListSearchParams({
      q: "abc",
      status: "all",
      host: "worker-a"
    });
    expect(params.toString()).toContain("q=abc");
    expect(params.toString()).toContain("host=worker-a");
    expect(params.toString()).not.toContain("status=");
  });
});

