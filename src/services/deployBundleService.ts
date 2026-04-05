import { http } from "../api/client";

export interface ExampleBundleManifestFile {
  content: string;
  relativePath: string;
}

export interface BackendBundleManifestFile {
  content: string;
  relativePath: string;
  basePrefix: string;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function parseExampleBundlePath(path: string): { jobId: string; relativePath: string } | null {
  const normalized = normalizePath(path);
  const match = normalized.match(/example\/jobs\/([^/]+)\/bundle\/(.+)$/);
  if (!match) return null;
  return {
    jobId: match[1],
    relativePath: match[2]
  };
}

const exampleManifestRawLoaders = import.meta.glob("../../example/jobs/*/bundle/artifact_manifest.json", {
  import: "default",
  query: "?raw"
}) as Record<string, () => Promise<string>>;

const exampleOnnxAssetUrls = import.meta.glob("../../example/jobs/*/bundle/**/*.onnx", {
  eager: true,
  import: "default"
}) as Record<string, string>;

const exampleManifestLoaderByJob = new Map<string, () => Promise<string>>();
Object.entries(exampleManifestRawLoaders).forEach(([path, loader]) => {
  const parsed = parseExampleBundlePath(path);
  if (!parsed || parsed.relativePath !== "artifact_manifest.json") return;
  exampleManifestLoaderByJob.set(parsed.jobId, loader);
});

const exampleOnnxUrlByJobAndPath = new Map<string, Map<string, string>>();
Object.entries(exampleOnnxAssetUrls).forEach(([path, url]) => {
  const parsed = parseExampleBundlePath(path);
  if (!parsed) return;
  const group = exampleOnnxUrlByJobAndPath.get(parsed.jobId) || new Map<string, string>();
  group.set(normalizePath(parsed.relativePath), url);
  exampleOnnxUrlByJobAndPath.set(parsed.jobId, group);
});

export async function readExampleBundleManifest(jobId: string): Promise<ExampleBundleManifestFile | null> {
  const loader = exampleManifestLoaderByJob.get(jobId);
  if (!loader) return null;
  const content = await loader();
  return {
    content,
    relativePath: "artifact_manifest.json"
  };
}

export function resolveExampleOnnxAssetUrl(jobId: string, relativePath: string): string | null {
  const group = exampleOnnxUrlByJobAndPath.get(jobId);
  if (!group) return null;
  return group.get(normalizePath(relativePath)) || null;
}

async function readBackendFileText(jobId: string, session: string | null, relativePath: string): Promise<string | null> {
  try {
    return await http<string>(
      "/simulation-data/file",
      {
        method: "POST",
        body: JSON.stringify({
          job_id: jobId,
          session: session || "latest",
          relative_path: normalizePath(relativePath)
        })
      },
      { responseType: "text" }
    );
  } catch {
    return null;
  }
}

async function readBackendFileBlob(jobId: string, session: string | null, relativePath: string): Promise<Blob | null> {
  try {
    return await http<Blob>(
      "/simulation-data/file",
      {
        method: "POST",
        body: JSON.stringify({
          job_id: jobId,
          session: session || "latest",
          relative_path: normalizePath(relativePath)
        })
      },
      { responseType: "blob" }
    );
  } catch {
    return null;
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  values.forEach((value) => {
    const normalized = normalizePath(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    ordered.push(normalized);
  });
  return ordered;
}

function resolveBasePrefix(relativePath: string): string {
  const normalized = normalizePath(relativePath);
  if (!normalized.endsWith("artifact_manifest.json")) return "";
  return normalized.replace(/artifact_manifest\.json$/i, "");
}

export async function readBackendBundleManifest(
  jobId: string,
  session: string | null
): Promise<BackendBundleManifestFile | null> {
  const candidates = uniqueStrings([
    "bundle/artifact_manifest.json",
    "artifact_manifest.json"
  ]);

  for (const candidate of candidates) {
    const content = await readBackendFileText(jobId, session, candidate);
    if (!content) continue;
    return {
      content,
      relativePath: candidate,
      basePrefix: resolveBasePrefix(candidate)
    };
  }

  return null;
}

export async function readBackendBundleFileAsBlob(
  jobId: string,
  session: string | null,
  bundleRelativePath: string,
  preferredBasePrefix?: string | null
): Promise<{ blob: Blob; relativePath: string } | null> {
  const normalized = normalizePath(bundleRelativePath);
  if (!normalized) return null;

  const prefixes = uniqueStrings([
    preferredBasePrefix || "",
    "bundle/",
    ""
  ]);

  const candidates = uniqueStrings(prefixes.map((prefix) => `${prefix}${normalized}`));
  for (const candidate of candidates) {
    const blob = await readBackendFileBlob(jobId, session, candidate);
    if (!blob) continue;
    return { blob, relativePath: candidate };
  }

  return null;
}
