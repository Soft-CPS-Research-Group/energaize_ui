import { describe, expect, it } from "vitest";
import { buildJobsListStateFromSearchParams, toJobsListSearchParams } from "./jobsListState";

describe("jobsListState helpers", () => {
  it("reads search params with defaults", () => {
    const state = buildJobsListStateFromSearchParams(new URLSearchParams("q=solar&status=completed"));
    expect(state).toEqual({ q: "solar", status: "completed", host: "all", submitted: "all" });
  });

  it("uses the current submitter as the default when submitted is absent", () => {
    const state = buildJobsListStateFromSearchParams(new URLSearchParams("q=solar"), {
      defaultSubmitted: "Tiago Fonseca"
    });
    expect(state).toEqual({ q: "solar", status: "all", host: "all", submitted: "Tiago Fonseca" });
  });

  it("keeps explicit submitted filters over the current submitter default", () => {
    const state = buildJobsListStateFromSearchParams(new URLSearchParams("submitted=all"), {
      defaultSubmitted: "Tiago Fonseca"
    });
    expect(state.submitted).toBe("all");
  });

  it("serializes only non-default values", () => {
    const params = toJobsListSearchParams({
      q: "abc",
      status: "all",
      host: "worker-a",
      submitted: "Tiago"
    });
    expect(params.toString()).toContain("q=abc");
    expect(params.toString()).toContain("host=worker-a");
    expect(params.toString()).toContain("submitted=Tiago");
    expect(params.toString()).not.toContain("status=");
  });

  it("serializes all submitters when the current submitter is the default", () => {
    const params = toJobsListSearchParams(
      {
        q: "",
        status: "all",
        host: "all",
        submitted: "all"
      },
      { defaultSubmitted: "Tiago Fonseca" }
    );
    expect(params.toString()).toBe("submitted=all");
  });
});
