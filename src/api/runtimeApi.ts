export const RUNTIME_API_URL = import.meta.env.VITE_RUNTIME_API_URL?.replace(/\/$/, '') || '/runtime-api';
export function runtimeRequestId(): string {
  // The production HTTP origin exposes getRandomValues even without randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
export async function runtimeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(RUNTIME_API_URL + path, {...init, headers, signal: init?.signal || AbortSignal.timeout(30000)});
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(typeof error.detail === 'string' ? error.detail : `Runtime request failed (${response.status})`),
      {status: response.status},
    );
  }
  return response.json();
}
export interface RuntimeHost { id: string; name: string; mode: 'simulation' | 'docker'; allowed_images?: string[]; percepta_collection_image?: string; network?: string }
export interface RuntimeInstance {
  id: string; name: string; kind: 'percepta' | 'controller'; site_ids: string[]; host_id: string;
  configuration_error?: string|null;
  rollback_available?: boolean;
  configuration_mode?: "prepared"|"generated";
  mode: 'simulation' | 'docker'; managed: boolean; image: string; container_name: string;
  observed_state: string; desired_state: string; health: string; error?: string | null;
  started_at?: string | null;
  active_operation: string | null; last_checked_at: string | null; desired_config_version: string | null;
  applied_config_version: string | null; legacy_target_id?: string; base_url?: string | null;
}
export interface RuntimeOperation { id: string; instance_id: string; action: string; status: string; created_at: string; error?: string }
export interface RuntimeSnapshot { version: string; channel_count: number; warnings: string[]; payload: unknown; executable: boolean; applied: boolean }
