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
      job_id: "job-completed-001",
      status: "completed",
      job_info: {
        experiment_name: "Baseline Alpha",
        target_host: "worker-a",
        run_name: "alpha-run",
        config_path: "alpha.yaml",
        mlflow_run_url: "http://mlflow.local/run/alpha"
      }
    },
    {
      job_id: "job-completed-002",
      status: "completed",
      job_info: {
        experiment_name: "Baseline Beta",
        target_host: "worker-b",
        run_name: "beta-run",
        config_path: "beta.yaml",
        mlflow_run_url: "http://mlflow.local/run/beta"
      }
    },
    {
      job_id: "job-running-001",
      status: "queued",
      job_info: {
        experiment_name: "Live Queue Job",
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
      available_hosts: ["worker-a", "worker-b"],
      hosts: {
        "worker-a": {
          online: true,
          last_seen: Date.now() / 1000,
          info: {},
          running: 1
        },
        "worker-b": {
          online: true,
          last_seen: Date.now() / 1000,
          info: {},
          running: 0
        }
      }
    })
  ),
  http.get(endpoint("/file-logs/:jobId"), () => HttpResponse.text("")),
  http.get(endpoint("/logs/:jobId"), () => HttpResponse.text("")),
  http.get(endpoint("/status/:jobId"), ({ params }) => {
    const found = jobs.find((job) => job.job_id === params.jobId);
    return HttpResponse.json({ job_id: params.jobId, status: found?.status || "queued" });
  }),
  http.get(endpoint("/job-info/:jobId"), ({ params }) => {
    const found = jobs.find((job) => job.job_id === params.jobId);
    return HttpResponse.json({ job_id: params.jobId, ...(found?.job_info || {}) });
  }),
  http.get(endpoint("/progress/:jobId"), ({ params }) => {
    const found = jobs.find((job) => job.job_id === params.jobId);
    if (!found) return HttpResponse.json({ progress: 0, updated_at: Date.now() / 1000 });
    if (found.status === "completed") {
      return HttpResponse.json({ progress: 100, updated_at: Date.now() / 1000 });
    }
    return HttpResponse.json({ progress: 24, updated_at: Date.now() / 1000 });
  }),
  http.get(endpoint("/result/:jobId"), ({ params }) => {
    if (params.jobId === "job-completed-001") {
      return HttpResponse.json({
        kpis: {
          total_cost_eur: 120.5,
          self_consumption_pct: 71.2
        },
        timeseries: {
          load_kw: [2.2, 2.5, 3.1, 2.7, 2.3],
          price_eur: [
            { time: "2025-01-01T00:00:00Z", value: 0.12 },
            { time: "2025-01-01T01:00:00Z", value: 0.14 }
          ]
        },
        artifacts: {
          model_path: "/tmp/alpha-model.pkl"
        }
      });
    }

    if (params.jobId === "job-completed-002") {
      return HttpResponse.json({
        kpis: {
          total_cost_eur: 97.4,
          self_consumption_pct: 79.6
        },
        timeseries: {
          load_kw: [1.9, 2.1, 2.7, 2.2, 2.0]
        },
        artifacts: {
          model_path: "/tmp/beta-model.pkl"
        }
      });
    }

    return HttpResponse.json({});
  }),
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
    HttpResponse.json({ removed: [], kept: ["job-completed-001"], count: 0 })
  )
];
