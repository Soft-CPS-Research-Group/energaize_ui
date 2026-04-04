import { ApiError, apiFileUrl, http } from "./client";

export interface DeployInferenceTarget {
  id: string;
  name: string;
  base_url: string;
  container_name: string;
  bundle_mount_path: string;
}

export interface DeployInferenceHealth {
  id: string;
  name: string;
  base_url: string;
  container_name: string;
  bundle_mount_path: string;
  reachable: boolean;
  configured: boolean;
  healthy: boolean;
  active_manifest_path: string | null;
  error?: string;
  raw?: Record<string, unknown> | null;
}

export interface DeployBundleRecord {
  bundle_id: string;
  name?: string;
  file_count?: number;
  artifacts_dir_host: string;
  manifest_path_host: string;
  created_at?: string;
  updated_at?: string;
}

export interface DeployUploadResponse {
  created: boolean;
  bundle: DeployBundleRecord;
}

export interface DeploySwitchResponse {
  status: string;
  target_id: string;
  bundle_id: string;
  requested_manifest_path: string;
  load_response: Record<string, unknown>;
  health: DeployInferenceHealth;
}

export async function listDeployInferences(): Promise<DeployInferenceTarget[]> {
  return http<DeployInferenceTarget[]>("/deploy/inferences");
}

export async function getDeployInferenceHealth(targetId: string): Promise<DeployInferenceHealth> {
  return http<DeployInferenceHealth>(`/deploy/inferences/${encodeURIComponent(targetId)}/health`);
}

export async function switchDeployInferenceBundle(
  targetId: string,
  bundleId: string
): Promise<DeploySwitchResponse> {
  return http<DeploySwitchResponse>(`/deploy/inferences/${encodeURIComponent(targetId)}/switch-bundle`, {
    method: "POST",
    body: JSON.stringify({ bundle_id: bundleId })
  });
}

export async function listDeployBundles(): Promise<DeployBundleRecord[]> {
  return http<DeployBundleRecord[]>("/deploy/bundles");
}

export async function uploadDeployBundleFolder(files: File[]): Promise<DeployUploadResponse> {
  const form = new FormData();
  files.forEach((file) => {
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    form.append("files", file, relativePath);
    form.append("relative_paths", relativePath);
  });

  return http<DeployUploadResponse>("/deploy/bundles/upload-folder", {
    method: "POST",
    body: form
  });
}

export async function deleteDeployBundle(bundleId: string): Promise<{ status: string; bundle_id: string }> {
  return http<{ status: string; bundle_id: string }>(`/deploy/bundles/${encodeURIComponent(bundleId)}`, {
    method: "DELETE"
  });
}

export async function openDeployLogsStream(
  targetId: string,
  tail: number,
  signal?: AbortSignal
): Promise<Response> {
  const url = apiFileUrl(
    `/deploy/inferences/${encodeURIComponent(targetId)}/logs/stream?tail=${encodeURIComponent(String(tail))}`
  );
  const response = await fetch(url, { signal });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { detail?: string; message?: string };
      message = payload.detail || payload.message || message;
    } catch {
      const text = await response.text();
      if (text.trim()) message = text;
    }
    throw new ApiError(message, response.status);
  }
  return response;
}
