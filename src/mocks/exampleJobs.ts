import type { JobInfo, JobItem } from "../types";

type JsonRecord = Record<string, unknown>;

interface ExampleJobSnapshot {
  job: JobItem;
  progress: JsonRecord | null;
}

function extractJobFolder(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const match = normalized.match(/\/example\/jobs\/([^/]+)\//);
  return match ? match[1] : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function inferStatus(progress: JsonRecord | null): string {
  if (!progress) return "completed";
  const fromProgress =
    (typeof progress.status === "string" && progress.status) ||
    (typeof progress.state === "string" && progress.state) ||
    null;
  if (fromProgress) return fromProgress;

  const pct = asNumber(progress.progress_pct) ?? asNumber(progress.progress) ?? 0;
  return pct >= 100 ? "completed" : "running";
}

function buildPathMap(loaders: Record<string, unknown>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  Object.keys(loaders).forEach((path) => {
    const folder = extractJobFolder(path);
    if (!folder) return;
    const previous = map.get(folder) || [];
    previous.push(path);
    map.set(folder, previous);
  });
  return map;
}

const jobInfoModules = import.meta.glob("../../example/jobs/*/job_info.json", {
  eager: true,
  import: "default"
}) as Record<string, JsonRecord>;

const artifactManifestModules = import.meta.glob("../../example/jobs/*/bundle/artifact_manifest.json", {
  eager: true,
  import: "default"
}) as Record<string, JsonRecord>;

const progressModules = import.meta.glob("../../example/jobs/*/progress/progress.json", {
  eager: true,
  import: "default"
}) as Record<string, JsonRecord>;

const resolvedConfigModules = import.meta.glob("../../example/jobs/*/config.resolved.yaml", {
  import: "default",
  query: "?raw"
});

const logLoaders = import.meta.glob("../../example/jobs/*/logs/*.log", {
  import: "default",
  query: "?raw"
}) as Record<string, () => Promise<string>>;

const metricsLoaders = import.meta.glob("../../example/jobs/*/logs/*.jsonl", {
  import: "default",
  query: "?raw"
}) as Record<string, () => Promise<string>>;

const logPathsByJob = buildPathMap(logLoaders);
const metricsPathsByJob = buildPathMap(metricsLoaders);

const jobSnapshots: ExampleJobSnapshot[] = Object.entries(jobInfoModules)
  .map(([path, payload]) => {
    const folder = extractJobFolder(path);
    if (!folder) return null;

    const progressPath = Object.keys(progressModules).find((key) =>
      key.includes(`/example/jobs/${folder}/progress/`)
    );
    const progress = progressPath ? progressModules[progressPath] : null;

    const resolvedConfigExists = Object.keys(resolvedConfigModules).some((key) =>
      key.includes(`/example/jobs/${folder}/config.resolved.yaml`)
    );

    const infoFromFile = payload || {};
    const artifactManifestPath = Object.keys(artifactManifestModules).find((key) =>
      key.includes(`/example/jobs/${folder}/bundle/artifact_manifest.json`)
    );
    const artifactManifest = artifactManifestPath ? artifactManifestModules[artifactManifestPath] : null;
    const artifactMetadata =
      artifactManifest && typeof artifactManifest.metadata === "object"
        ? (artifactManifest.metadata as JsonRecord)
        : null;
    const communityName =
      asString(infoFromFile.community_name) ||
      asString(infoFromFile.energy_community) ||
      asString(artifactMetadata?.community_name);
    const description =
      asString(infoFromFile.description) ||
      asString(infoFromFile.job_description) ||
      asString(artifactMetadata?.description);
    const jobId =
      (typeof infoFromFile.job_id === "string" && infoFromFile.job_id) || folder;
    const configPath =
      (typeof infoFromFile.config_path === "string" && infoFromFile.config_path) ||
      (resolvedConfigExists ? `${folder}/config.resolved.yaml` : undefined);

    const jobInfo: JobInfo = {
      job_id: jobId,
      ...infoFromFile,
      config_path: configPath,
      run_name:
        (typeof infoFromFile.run_name === "string" && infoFromFile.run_name) || jobId,
      ...(communityName ? { community_name: communityName, energy_community: communityName } : {}),
      ...(description ? { description } : {})
    };

    return {
      job: {
        job_id: jobId,
        status: inferStatus(progress),
        job_info: jobInfo
      },
      progress
    };
  })
  .filter((item): item is ExampleJobSnapshot => Boolean(item));

const snapshotsById = new Map(jobSnapshots.map((item) => [item.job.job_id, item]));

async function loadFirstLogFromPaths(paths: string[] | undefined, loaders: Record<string, () => Promise<string>>): Promise<string | null> {
  if (!paths || paths.length === 0) return null;
  const sorted = [...paths].sort((a, b) => a.localeCompare(b));
  for (const path of sorted) {
    const loader = loaders[path];
    if (!loader) continue;
    try {
      const text = await loader();
      if (text && text.trim() !== "") return text;
    } catch {
      // Ignore and continue with next candidate.
    }
  }
  return null;
}

export function listExampleJobs(): JobItem[] {
  return jobSnapshots.map((item) => item.job);
}

export function getExampleJobInfo(jobId: string): JobInfo | null {
  return snapshotsById.get(jobId)?.job.job_info || null;
}

export function getExampleJobStatus(jobId: string): string | null {
  return snapshotsById.get(jobId)?.job.status || null;
}

export function getExampleJobProgress(jobId: string): JsonRecord | null {
  const snapshot = snapshotsById.get(jobId);
  if (!snapshot) return null;

  const progress = snapshot.progress || {};
  const pct = asNumber(progress.progress_pct) ?? asNumber(progress.progress);
  return {
    ...progress,
    progress_pct: pct ?? null,
    status: snapshot.job.status
  };
}

export function getExampleJobResult(jobId: string): JsonRecord | null {
  const snapshot = snapshotsById.get(jobId);
  if (!snapshot) return null;

  return {
    status: snapshot.job.status,
    simulation_data_available: true,
    simulation_data_session_default: "latest",
    kpi_source: "simulation_data_csv",
    simulation_data_dir: `/home/tiago/dev/energaize_ui/example/jobs/${jobId}/results/simulation_data`
  };
}

export async function getExampleJobLogs(jobId: string): Promise<string | null> {
  if (!snapshotsById.has(jobId)) return null;

  const primaryLog = await loadFirstLogFromPaths(logPathsByJob.get(jobId), logLoaders);
  if (primaryLog) return primaryLog;

  const metricsLog = await loadFirstLogFromPaths(metricsPathsByJob.get(jobId), metricsLoaders);
  return metricsLog;
}
