import { JOB_ORCHESTRATOR_API_URL } from "../api/client";

const NESTED_RECORD_KEYS = ["details", "last_status_details", "job_info", "job_meta"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeMlflowBaseUrl(value: string | null | undefined): string | null {
  const text = asNonEmptyString(value);
  if (!text) return null;
  if (!(text.startsWith("http://") || text.startsWith("https://"))) return null;

  let normalized = text;
  const hashIndex = normalized.indexOf("/#/");
  if (hashIndex > 0) {
    normalized = normalized.slice(0, hashIndex);
  }

  normalized = normalized.replace(/\/+$/, "");
  return normalized || null;
}

function isLikelyInternalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  // Common docker-compose service names and single-label hosts.
  if (!host.includes(".")) return true;
  return false;
}

function extractRunIdentityFromRunUrl(value: string): { experimentId: string; runId: string } | null {
  const match = value.match(/\/#\/experiments\/([^/]+)\/runs\/([^/?#]+)/);
  if (!match) return null;
  const experimentId = asNonEmptyString(decodeURIComponent(match[1]));
  const runId = asNonEmptyString(decodeURIComponent(match[2]));
  if (!experimentId || !runId) return null;
  return { experimentId, runId };
}

function deriveMlflowBaseUrlFromApi(): string | null {
  const normalizedApi = normalizeMlflowBaseUrl(JOB_ORCHESTRATOR_API_URL);
  if (!normalizedApi) return null;
  try {
    const parsed = new URL(normalizedApi);
    parsed.port = "5000";
    parsed.hash = "";
    parsed.pathname = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function collectSourceRecords(
  source: unknown,
  output: Array<Record<string, unknown>>,
  visited: WeakSet<object>
): void {
  const record = asRecord(source);
  if (!record) return;
  if (visited.has(record)) return;
  visited.add(record);
  output.push(record);

  NESTED_RECORD_KEYS.forEach((key) => {
    const nested = asRecord(record[key]);
    if (!nested) return;
    if (visited.has(nested)) return;
    visited.add(nested);
    output.push(nested);
  });
}

function findFirstString(records: Array<Record<string, unknown>>, keys: string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = asNonEmptyString(record[key]);
      if (value) return value;
    }
  }
  return null;
}

function resolveBaseUrl(records: Array<Record<string, unknown>>): string | null {
  const configured = normalizeMlflowBaseUrl(import.meta.env.VITE_MLFLOW_UI_BASE_URL);
  if (configured) return configured;

  const fromPayload = normalizeMlflowBaseUrl(
    findFirstString(records, ["mlflow_ui_base_url", "tracking_ui_base_url", "tracking_uri", "mlflow_uri"])
  );
  if (fromPayload) return fromPayload;

  const rawTrackingUri = findFirstString(records, ["tracking_uri", "mlflow_uri"]);
  if (rawTrackingUri && !normalizeMlflowBaseUrl(rawTrackingUri)) {
    // Example: file:/data/mlflow/mlruns on Deucalion.
    // In this case there is no externally reachable MLflow UI URL to open.
    return null;
  }

  return deriveMlflowBaseUrlFromApi();
}

export function buildMlflowRunUrl(params: {
  baseUrl: string | null;
  experimentId: string | null;
  runId: string | null;
}): string | null {
  const baseUrl = normalizeMlflowBaseUrl(params.baseUrl);
  const experimentId = asNonEmptyString(params.experimentId);
  const runId = asNonEmptyString(params.runId);
  if (!baseUrl || !experimentId || !runId) return null;
  return `${baseUrl}/#/experiments/${experimentId}/runs/${runId}`;
}

export function resolveMlflowRunUrl(...sources: unknown[]): string | null {
  const records: Array<Record<string, unknown>> = [];
  const visited = new WeakSet<object>();
  sources.forEach((source) => collectSourceRecords(source, records, visited));
  if (records.length === 0) return null;

  const directUrl = findFirstString(records, ["mlflow_run_url"]);
  const directIdentity = directUrl ? extractRunIdentityFromRunUrl(directUrl) : null;
  const runId = findFirstString(records, ["mlflow_run_id", "run_id"]) || directIdentity?.runId || null;
  const experimentId =
    findFirstString(records, ["mlflow_experiment_id", "experiment_id"]) || directIdentity?.experimentId || null;
  const baseUrl = resolveBaseUrl(records);

  if (directUrl) {
    try {
      const parsed = new URL(directUrl);
      // If the stored URL already points to an externally reachable host, keep it.
      if (!isLikelyInternalHostname(parsed.hostname)) return directUrl;
    } catch {
      // Ignore parse failures and fall back to rebuilt URL.
    }

    const rebuilt = buildMlflowRunUrl({ baseUrl, experimentId, runId });
    if (rebuilt) return rebuilt;
  }

  return buildMlflowRunUrl({ baseUrl, experimentId, runId });
}
