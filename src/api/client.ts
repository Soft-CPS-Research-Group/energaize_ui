import type { ApiErrorShape } from "../types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "http://193.136.62.78:8000";

function normalizeBaseUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim().replace(/\/$/, "");
  return trimmed || null;
}

function deriveBaseUrlWithPort(baseUrl: string, port: string): string | null {
  try {
    const parsed = new URL(baseUrl);
    parsed.port = port;
    parsed.hash = "";
    parsed.pathname = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export const JOB_ORCHESTRATOR_API_URL =
  normalizeBaseUrl(import.meta.env.VITE_JOB_ORCHESTRATOR_API_URL) ||
  deriveBaseUrlWithPort(API_BASE_URL, "8011") ||
  "http://193.136.62.78:8011";

function buildUrl(path: string, baseUrl = API_BASE_URL): string {
  if (path.startsWith("http")) return path;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
  options?: { responseType?: "json" | "text" | "blob" }
): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const headers = new Headers(init?.headers || {});
  if (isFormData) {
    headers.delete("Content-Type");
  } else if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(buildUrl(path, baseUrl), {
    headers,
    ...init
  });

  const responseType = options?.responseType ?? "json";
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as ApiErrorShape;
      message = data.detail || data.message || message;
    } catch {
      message = response.statusText || message;
    }
    throw new ApiError(message, response.status);
  }

  if (responseType === "text") {
    return (await response.text()) as T;
  }
  if (responseType === "blob") {
    return (await response.blob()) as T;
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function http<T>(
  path: string,
  init?: RequestInit,
  options?: { responseType?: "json" | "text" | "blob" }
): Promise<T> {
  return request<T>(API_BASE_URL, path, init, options);
}

export async function jobOrchestratorHttp<T>(
  path: string,
  init?: RequestInit,
  options?: { responseType?: "json" | "text" | "blob" }
): Promise<T> {
  return request<T>(JOB_ORCHESTRATOR_API_URL, path, init, options);
}

export function apiFileUrl(path: string): string {
  return buildUrl(path);
}

export function jobOrchestratorFileUrl(path: string): string {
  return buildUrl(path, JOB_ORCHESTRATOR_API_URL);
}
