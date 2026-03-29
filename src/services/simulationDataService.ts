import { http } from "../api/client";
import type { SimulationDataFileEntry } from "../types";
import { parseSimulationDataFile } from "../utils/simulationData";

interface MockCsvEntry {
  jobId: string;
  relativePath: string;
  loader: () => Promise<string>;
}

interface BackendIndexResponse {
  root_path?: string;
  session?: string;
  files: string[];
  available_days?: string[];
}

export interface SimulationDataSource {
  provider: "mock" | "backend";
  jobId: string;
  session: string | null;
  rootPath: string;
  files: SimulationDataFileEntry[];
  availableDays?: string[];
}

interface GetSimulationDataIndexInput {
  jobId: string;
  simulationDataDir?: string | null;
  simulationDataSessionDefault?: string | null;
}

const PROVIDER_MODE = String(import.meta.env.VITE_SIMULATION_DATA_PROVIDER || "backend").toLowerCase();

const csvLoaders = import.meta.glob("../../example/jobs/*/results/simulation_data/**/*.csv", {
  import: "default",
  query: "?raw"
}) as Record<string, () => Promise<string>>;

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function parseMockEntry(path: string, loader: () => Promise<string>): MockCsvEntry | null {
  const normalized = normalizePath(path);
  const match = normalized.match(/example\/jobs\/([^/]+)\/results\/simulation_data\/(.+)$/);
  if (!match) return null;
  return {
    jobId: match[1],
    relativePath: match[2],
    loader
  };
}

const mockEntries: MockCsvEntry[] = Object.entries(csvLoaders)
  .map(([path, loader]) => parseMockEntry(path, loader))
  .filter((entry): entry is MockCsvEntry => Boolean(entry));

const mockByJob = new Map<string, MockCsvEntry[]>();
mockEntries.forEach((entry) => {
  const group = mockByJob.get(entry.jobId) || [];
  group.push(entry);
  mockByJob.set(entry.jobId, group);
});

function resolveJobId(jobId: string, simulationDataDir: string | null): string {
  if (jobId) return jobId;
  if (!simulationDataDir) return "";
  const normalized = simulationDataDir.replace(/\\/g, "/");
  const match = normalized.match(/\/jobs\/([^/]+)\/results\/simulation_data/i);
  return match ? match[1] : "";
}

async function getBackendIndex(jobId: string, session: string | null): Promise<BackendIndexResponse> {
  return http<BackendIndexResponse>("/simulation-data/index", {
    method: "POST",
    body: JSON.stringify({
      job_id: jobId,
      session: session || "latest"
    })
  });
}

async function readBackendFile(jobId: string, session: string | null, relativePath: string): Promise<string> {
  return http<string>(
    "/simulation-data/file",
    {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        session: session || "latest",
        relative_path: relativePath
      })
    },
    { responseType: "text" }
  );
}

function getMockFiles(jobId: string): SimulationDataFileEntry[] {
  return (mockByJob.get(jobId) || [])
    .map((entry) => parseSimulationDataFile(entry.relativePath))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function getSimulationDataIndex({
  jobId,
  simulationDataDir,
  simulationDataSessionDefault
}: GetSimulationDataIndexInput): Promise<SimulationDataSource> {
  const resolvedJobId = resolveJobId(jobId, simulationDataDir ?? null);

  if (PROVIDER_MODE === "backend" && resolvedJobId) {
    try {
      const response = await getBackendIndex(resolvedJobId, simulationDataSessionDefault || null);
      const files = response.files
        .map((relativePath) => parseSimulationDataFile(relativePath))
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

      return {
        provider: "backend",
        jobId: resolvedJobId || jobId,
        session: response.session || simulationDataSessionDefault || "latest",
        rootPath: response.root_path || simulationDataDir || "",
        files,
        availableDays: response.available_days || []
      };
    } catch {
      // Fall back to local mock source when backend bridge is unavailable.
    }
  }

  return {
    provider: "mock",
    jobId: resolvedJobId || jobId,
    session: null,
    rootPath: simulationDataDir || "",
    files: getMockFiles(resolvedJobId || jobId),
    availableDays: []
  };
}

export async function readSimulationDataFile(
  source: SimulationDataSource,
  relativePath: string
): Promise<string> {
  const normalized = normalizePath(relativePath);
  if (source.provider === "backend") {
    return readBackendFile(source.jobId, source.session, normalized);
  }

  const candidates = mockByJob.get(source.jobId) || [];
  const match = candidates.find((entry) => normalizePath(entry.relativePath) === normalized);
  if (!match) {
    throw new Error(`Simulation file not found: ${relativePath}`);
  }
  return match.loader();
}

export function findSimulationDataDir(resultPayload: unknown): string | null {
  if (!resultPayload || typeof resultPayload !== "object") return null;
  const record = resultPayload as Record<string, unknown>;
  const candidates = [
    record.simulation_data_dir,
    record.simulation_data_path,
    record.results_dir,
    (record.evaluation as Record<string, unknown> | undefined)?.simulation_data_dir
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return null;
}

export function findSimulationDataSessionDefault(resultPayload: unknown): string | null {
  if (!resultPayload || typeof resultPayload !== "object") return null;
  const record = resultPayload as Record<string, unknown>;
  const value = record.simulation_data_session_default;
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  return null;
}

export function findSimulationDataAvailable(resultPayload: unknown): boolean | null {
  if (!resultPayload || typeof resultPayload !== "object") return null;
  const record = resultPayload as Record<string, unknown>;
  const value = record.simulation_data_available;
  return typeof value === "boolean" ? value : null;
}

export function findKpiSource(resultPayload: unknown): string | null {
  if (!resultPayload || typeof resultPayload !== "object") return null;
  const record = resultPayload as Record<string, unknown>;
  const value = record.kpi_source;
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  return null;
}
