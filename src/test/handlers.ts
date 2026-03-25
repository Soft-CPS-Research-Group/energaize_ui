import { http, HttpResponse } from "msw";
import { API_BASE_URL } from "../api/client";

type JobRecord = {
  job_id: string;
  status: string;
  job_info: Record<string, unknown>;
};

let jobs: JobRecord[] = [];
const api = API_BASE_URL.replace(/\/$/, "");
const endpoint = (path: string) => `${api}${path}`;

export function resetMockState(): void {
  jobs = [
    {
      job_id: "job-initial-001",
      status: "queued",
      job_info: {
        experiment_name: "Baseline",
        target_host: "worker-a"
      }
    }
  ];
}

resetMockState();

export const handlers = [
  http.get(endpoint("/datasets"), () => HttpResponse.json([])),
  http.get(endpoint("/experiment-configs"), () => HttpResponse.json(["demo.yaml"])),
  http.get(endpoint("/jobs"), () => HttpResponse.json(jobs)),
  http.get(endpoint("/queue"), () => HttpResponse.json([])),
  http.get(endpoint("/hosts"), () =>
    HttpResponse.json({
      available_hosts: ["worker-a"],
      hosts: {
        "worker-a": {
          online: true,
          last_seen: Date.now() / 1000,
          info: {},
          running: 1
        }
      }
    })
  ),
  http.get(endpoint("/file-logs/:jobId"), () => HttpResponse.text("")),
  http.get(endpoint("/logs/:jobId"), () => HttpResponse.text("")),
  http.get(endpoint("/status/:jobId"), ({ params }) =>
    HttpResponse.json({ job_id: params.jobId, status: "queued" })
  ),
  http.get(endpoint("/job-info/:jobId"), ({ params }) =>
    HttpResponse.json({ job_id: params.jobId, job_name: "preview-job" })
  ),
  http.get(endpoint("/progress/:jobId"), () => HttpResponse.json({ progress: 12 })),
  http.get(endpoint("/result/:jobId"), () => HttpResponse.json({ score: 0.9 })),
  http.post(endpoint("/run-simulation"), async () => {
    const next = {
      job_id: `job-${jobs.length + 1}`,
      status: "queued",
      job_info: {
        experiment_name: "New Simulation",
        target_host: "worker-a"
      }
    };
    jobs = [next, ...jobs];
    return HttpResponse.json({
      job_id: next.job_id,
      status: "queued",
      host: "worker-a",
      job_name: "new-simulation"
    });
  }),
  http.post(endpoint("/stop/:jobId"), ({ params }) =>
    HttpResponse.json({ message: `stop requested ${params.jobId}` })
  ),
  http.delete(endpoint("/job/:jobId"), ({ params }) => {
    jobs = jobs.filter((item) => item.job_id !== params.jobId);
    return HttpResponse.json({ message: "deleted" });
  }),
  http.post(endpoint("/ops/jobs/:jobId/requeue"), ({ params }) =>
    HttpResponse.json({ message: "requeued", job_id: params.jobId, status: "queued" })
  ),
  http.post(endpoint("/ops/jobs/:jobId/cancel"), ({ params }) =>
    HttpResponse.json({ message: "canceled", job_id: params.jobId, status: "canceled" })
  ),
  http.post(endpoint("/ops/jobs/:jobId/fail"), ({ params }) =>
    HttpResponse.json({ message: "failed", job_id: params.jobId, status: "failed" })
  ),
  http.post(endpoint("/ops/queue/cleanup"), () =>
    HttpResponse.json({ removed: [], count: 0 })
  ),
  http.post(endpoint("/ops/jobs/cleanup"), () =>
    HttpResponse.json({ removed: [], kept: ["job-initial-001"], count: 0 })
  )
];
