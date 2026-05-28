import { TELEMETRY_PROFILE_API_URL } from "./communityApi";

export interface TelemetryCapability {
  capability_id: string;
  profile_id: string;
  name: string;
  description: string;
  capability_type: string;
  unit: string;
  data_type: string;
}

export interface TelemetryProfile {
  profile_id: string;
  asset_id: string;
  asset_type: string;
  capabilities: TelemetryCapability[];
}

export interface CreateTelemetryProfilePayload {
  asset_id: string;
  asset_type: string;
  capabilities?: Array<Omit<TelemetryCapability, "capability_id" | "profile_id">>;
}

export interface CreateTelemetryCapabilityPayload {
  profile_id: string;
  name: string;
  description?: string;
  capability_type: string;
  unit: string;
  data_type: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${TELEMETRY_PROFILE_API_URL}${path.startsWith("/") ? path : `/${path}`}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    },
    ...init
  });

  if (!response.ok) {
    let message = `Telemetry API request failed (${response.status})`;
    try {
      const data = await response.json();
      message = data.detail || data.message || message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function listTelemetryProfiles(): Promise<TelemetryProfile[]> {
  return request<TelemetryProfile[]>("/api/telemetry-profiles/");
}

export function getTelemetryProfile(profileId: string): Promise<TelemetryProfile> {
  return request<TelemetryProfile>(`/api/telemetry-profiles/${profileId}`);
}

export function getTelemetryProfileByAsset(assetId: string): Promise<TelemetryProfile> {
  return request<TelemetryProfile>(`/api/telemetry-profiles/by-asset/${assetId}`);
}

export function createTelemetryProfile(payload: CreateTelemetryProfilePayload): Promise<TelemetryProfile> {
  return request<TelemetryProfile>("/api/telemetry-profiles/", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listCapabilitiesByProfile(profileId: string): Promise<TelemetryCapability[]> {
  return request<TelemetryCapability[]>(`/api/capabilities/by-profile/${profileId}`);
}

export function createTelemetryCapability(payload: CreateTelemetryCapabilityPayload): Promise<TelemetryCapability> {
  return request<TelemetryCapability>("/api/capabilities/", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
