import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateWorker, listJobs, listJobsInitialData, listLocalJobs } from "./trainingApi";

function backendHangUntilAbort(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new Error("AbortError"));
      return;
    }
    signal?.addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
  });
}

describe("training API jobs", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exposes local example jobs synchronously for dev initial render", () => {
    const jobs = listJobsInitialData();

    expect(jobs?.some((job) => job.job_id === "live-rbc-ev-native-2000-300s-post026")).toBe(true);
    expect(listLocalJobs().length).toBeGreaterThan(0);
  });

  it("returns local example jobs when the backend list request stalls in dev", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => backendHangUntilAbort(init)));

    const jobsPromise = listJobs();
    await vi.advanceTimersByTimeAsync(15100);
    const jobs = await jobsPromise;

    expect(jobs.some((job) => job.job_id === "live-rbc-ev-native-2000-300s-post026")).toBe(true);
  });

  it("merges backend jobs with local example jobs when the backend responds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                job_id: "backend-job-001",
                status: "queued",
                job_info: {
                  experiment_name: "Backend Job",
                  target_host: "worker-a"
                }
              }
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        )
      )
    );

    const jobs = await listJobs();

    expect(jobs.some((job) => job.job_id === "backend-job-001")).toBe(true);
    expect(jobs.some((job) => job.job_id === "live-rbc-ev-native-2000-300s-post026")).toBe(true);
  });

  it("requests interactive authentication for the selected worker", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            worker_id: "union-inesctec",
            action: "union_authenticate",
            request_id: "request-1",
            requested_at: 1
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await authenticateWorker("union-inesctec");

    expect(result.request_id).toBe("request-1");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/ops/workers/union-inesctec/authenticate");
  });
});
