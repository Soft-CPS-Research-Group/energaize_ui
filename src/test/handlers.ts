import { http, HttpResponse } from "msw";
import { API_BASE_URL } from "../api/client";

type JobRecord = {
  job_id: string;
  status: string;
  job_info: Record<string, unknown>;
};

let jobs: JobRecord[] = [];
let experimentConfigs: Record<string, string> = {};
let deployBundles: Array<{
  bundle_id: string;
  name: string;
  storage_dir_name?: string;
  file_count: number;
  artifacts_dir_host: string;
  manifest_path_host: string;
  created_at: string;
  updated_at: string;
}> = [];

const deployTargets = [
  {
    id: "hq",
    name: "HQ Inference",
    base_url: "http://inference-hq:8000",
    container_name: "inference_hq",
    bundle_mount_path: "/data/bundles"
  },
  {
    id: "sm",
    name: "Sao Mamede Inference",
    base_url: "http://inference-sm:8000",
    container_name: "inference_sm",
    bundle_mount_path: "/data/bundles"
  }
];
const api = API_BASE_URL.replace(/\/$/, "");
const endpoint = (path: string) => `${api}${path}`;
const DEMO_SIM_FILES = [
  "2026-03-20_10-00-00/exported_data_community_ep0.csv",
  "2026-03-20_10-00-00/exported_kpis.csv"
];
const DEMO_COMMUNITY_CSV = `timestamp,net_electricity_consumption_kwh,self_consumption_kwh
2026-03-20T00:00:00Z,10,7
2026-03-20T01:00:00Z,11,8
`;
const DEMO_KPIS_CSV = `kpi,value
total_cost_eur,120.5
self_consumption_pct,71.2
`;

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
  experimentConfigs = {
    "demo.yaml": "metadata:\n  experiment_name: Demo\n  run_name: baseline\n"
  };
  deployBundles = [
    {
      bundle_id: "bundle_demo_001",
      name: "hq_bundle",
      storage_dir_name: "hq_bundle",
      file_count: 4,
      artifacts_dir_host: "/opt/opeva_shared_data/inference_bundles/bundles/hq_bundle",
      manifest_path_host: "/opt/opeva_shared_data/inference_bundles/bundles/hq_bundle/artifact_manifest.json",
      created_at: "2026-04-01T12:00:00Z",
      updated_at: "2026-04-01T12:00:00Z"
    }
  ];
}

resetMockState();

export const handlers = [
  http.get(endpoint("/datasets"), () => HttpResponse.json([])),
  http.post(endpoint("/dataset/upload"), () =>
    HttpResponse.json({ message: "Dataset uploaded", name: "uploaded_dataset" })
  ),
  http.get(endpoint("/experiment-configs"), () => HttpResponse.json(Object.keys(experimentConfigs))),
  http.get(endpoint("/experiment-config/:fileName"), ({ params }) => {
    const fileName = String(params.fileName || "");
    if (!experimentConfigs[fileName]) {
      return HttpResponse.json({ detail: "Config not found" }, { status: 404 });
    }
    return HttpResponse.text(experimentConfigs[fileName], {
      headers: { "Content-Type": "text/yaml" }
    });
  }),
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
  http.get(endpoint("/deploy/inferences"), () => HttpResponse.json(deployTargets)),
  http.get(endpoint("/deploy/inferences/:targetId/health"), ({ params }) => {
    const targetId = String(params.targetId || "");
    const target = deployTargets.find((item) => item.id === targetId);
    if (!target) {
      return HttpResponse.json({ detail: "Inference target not found" }, { status: 404 });
    }
    return HttpResponse.json({
      ...target,
      reachable: true,
      configured: true,
      healthy: true,
      active_manifest_path: `/data/bundles/${deployBundles[0]?.storage_dir_name || deployBundles[0]?.bundle_id || "bundle_demo_001"}/artifact_manifest.json`
    });
  }),
  http.post(endpoint("/deploy/inferences/:targetId/switch-bundle"), async ({ params, request }) => {
    const targetId = String(params.targetId || "");
    const target = deployTargets.find((item) => item.id === targetId);
    if (!target) {
      return HttpResponse.json({ detail: "Inference target not found" }, { status: 404 });
    }
    const body = (await request.json()) as { bundle_id?: string };
    if (!body.bundle_id) {
      return HttpResponse.json({ detail: "Missing bundle_id" }, { status: 400 });
    }
    const selected = deployBundles.find((item) => item.bundle_id === body.bundle_id);
    const selectedStorage = selected?.storage_dir_name || body.bundle_id;
    return HttpResponse.json({
      status: "switched",
      target_id: target.id,
      bundle_id: body.bundle_id,
      requested_manifest_path: `/data/bundles/${selectedStorage}/artifact_manifest.json`,
      load_response: { status: "loaded" },
      health: {
        ...target,
        reachable: true,
        configured: true,
        healthy: true,
        active_manifest_path: `/data/bundles/${selectedStorage}/artifact_manifest.json`
      }
    });
  }),
  http.get(endpoint("/deploy/inferences/:targetId/logs/stream"), ({ params }) =>
    HttpResponse.text(`[${params.targetId}] inference logs\\nline 2\\n`)
  ),
  http.get(endpoint("/deploy/bundles"), () => HttpResponse.json(deployBundles)),
  http.get(endpoint("/deploy/bundles/:bundleId/files"), ({ params }) => {
    const bundleId = String(params.bundleId || "");
    const exists = deployBundles.some((item) => item.bundle_id === bundleId);
    if (!exists) {
      return HttpResponse.json({ detail: "Bundle not found" }, { status: 404 });
    }
    const files = [
      { path: "artifact_manifest.json", size_bytes: 832 },
      { path: "policy_agent_0.json", size_bytes: 256 },
      { path: "aliases.json", size_bytes: 192 }
    ];
    return HttpResponse.json({
      bundle_id: bundleId,
      bundle_name: deployBundles.find((item) => item.bundle_id === bundleId)?.name || bundleId,
      file_count: files.length,
      files
    });
  }),
  http.get(endpoint("/deploy/bundles/:bundleId/files/content"), ({ params, request }) => {
    const bundleId = String(params.bundleId || "");
    const exists = deployBundles.some((item) => item.bundle_id === bundleId);
    if (!exists) {
      return HttpResponse.json({ detail: "Bundle not found" }, { status: 404 });
    }
    const url = new URL(request.url);
    const path = url.searchParams.get("path") || "";
    if (!path) {
      return HttpResponse.json({ detail: "Missing path" }, { status: 400 });
    }
    const contentByPath: Record<string, string> = {
      "artifact_manifest.json": '{\n  "manifest_version": 1,\n  "topology": { "num_agents": 1 }\n}',
      "policy_agent_0.json": '{\n  "default_actions": { "a": 0.0 },\n  "rules": []\n}',
      "aliases.json": '{\n  "community.energy_in_total": "community.energy_in_total"\n}'
    };
    return HttpResponse.json({
      bundle_id: bundleId,
      path,
      is_text: true,
      size_bytes: contentByPath[path]?.length || 0,
      truncated: false,
      content: contentByPath[path] || ""
    });
  }),
  http.post(endpoint("/deploy/bundles/upload-folder"), () => {
    const created = {
      bundle_id: `bundle_uploaded_${deployBundles.length + 1}`,
      name: "uploaded_bundle",
      storage_dir_name: "uploaded_bundle",
      file_count: 2,
      artifacts_dir_host: "/opt/opeva_shared_data/inference_bundles/bundles/uploaded_bundle",
      manifest_path_host: "/opt/opeva_shared_data/inference_bundles/bundles/uploaded_bundle/artifact_manifest.json",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    deployBundles = [created, ...deployBundles];
    return HttpResponse.json({ created: true, bundle: created });
  }),
  http.delete(endpoint("/deploy/bundles/:bundleId"), ({ params }) => {
    const bundleId = String(params.bundleId || "");
    deployBundles = deployBundles.filter((item) => item.bundle_id !== bundleId);
    return HttpResponse.json({ status: "deleted", bundle_id: bundleId });
  }),
  http.get(endpoint("/job-images/versions"), () =>
    HttpResponse.json({
      repository: "calof/opeva_simulator",
      sif_repository: "calof/opeva_simulator_sif",
      tags: [
        { name: "latest", last_updated: "2026-03-31T09:00:00Z", digest: "sha256:latest", deucalion_ready: true },
        { name: "v1.4.2", last_updated: "2026-03-30T18:10:00Z", digest: "sha256:v142", deucalion_ready: false }
      ],
      count: 2,
      cached: false,
      fetched_at: Date.now() / 1000
    })
  ),
  http.get(endpoint("/logs-chunk/:jobId"), ({ params, request }) => {
    const url = new URL(request.url);
    const offsetRaw = url.searchParams.get("offset");
    const offset = offsetRaw ? Number(offsetRaw) : null;
    const text = offset && Number.isFinite(offset) && offset > 0 ? "" : "";
    const nextOffset = offset && Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) + text.length : text.length;
    return HttpResponse.json({
      job_id: params.jobId,
      text,
      next_offset: nextOffset,
      truncated: false,
      available: true,
      message: null
    });
  }),
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
        simulation_data_available: true,
        simulation_data_session_default: "latest",
        kpi_source: "simulation_data_csv",
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
        simulation_data_available: true,
        simulation_data_session_default: "latest",
        kpi_source: "simulation_data_csv",
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
  http.post(endpoint("/simulation-data/index"), async () =>
    HttpResponse.json({
      root_path: "/mock/jobs/job-completed-001/results/simulation_data",
      session: "latest",
      files: DEMO_SIM_FILES,
      available_days: ["2026-03-20"]
    })
  ),
  http.post(endpoint("/simulation-data/file"), async ({ request }) => {
    const body = (await request.json()) as { relative_path?: string };
    const file = body.relative_path || "";
    if (file.endsWith("exported_kpis.csv")) {
      return HttpResponse.text(DEMO_KPIS_CSV, {
        headers: { "Content-Type": "text/plain" }
      });
    }
    if (file.endsWith("exported_data_community_ep0.csv")) {
      return HttpResponse.text(DEMO_COMMUNITY_CSV, {
        headers: { "Content-Type": "text/plain" }
      });
    }
    return HttpResponse.json({ detail: "file not found" }, { status: 404 });
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
  http.post(endpoint("/experiment-config/create"), async ({ request }) => {
    const body = (await request.json()) as { file_name?: string; yaml_content?: string };
    if (!body.file_name) {
      return HttpResponse.json({ detail: "Missing file_name" }, { status: 400 });
    }
    experimentConfigs[body.file_name] = body.yaml_content || "";
    return HttpResponse.json({ message: "Config saved", file: body.file_name });
  }),
  http.put(endpoint("/experiment-config/:fileName"), async ({ params, request }) => {
    const fileName = String(params.fileName || "");
    const body = (await request.json()) as { yaml_content?: string };
    if (!experimentConfigs[fileName]) {
      return HttpResponse.json({ detail: "Config not found" }, { status: 404 });
    }
    experimentConfigs[fileName] = body.yaml_content || "";
    return HttpResponse.json({ message: "Config updated", file: fileName });
  }),
  http.delete(endpoint("/experiment-config/:fileName"), ({ params }) => {
    const fileName = String(params.fileName || "");
    delete experimentConfigs[fileName];
    return HttpResponse.json({ message: "deleted" });
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
  http.post(endpoint("/ops/jobs/:jobId/stop"), ({ params }) =>
    HttpResponse.json({ message: "stop requested", job_id: params.jobId, status: "stop_requested" })
  ),
  http.post(endpoint("/ops/queue/cleanup"), () =>
    HttpResponse.json({ removed: [], count: 0 })
  ),
  http.post(endpoint("/ops/jobs/cleanup"), () =>
    HttpResponse.json({ removed: [], kept: ["job-completed-001"], count: 0 })
  )
];
