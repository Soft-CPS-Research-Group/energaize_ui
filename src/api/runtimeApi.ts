export const RUNTIME_API_URL = import.meta.env.VITE_RUNTIME_API_URL?.replace(/\/$/, '') || '/runtime-api';
export async function runtimeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(RUNTIME_API_URL + path, {...init, headers, signal: init?.signal || AbortSignal.timeout(30000)});
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : `Runtime request failed (${response.status})`);
  }
  return response.json();
}
export interface RuntimeHost { id: string; name: string; mode: 'simulation' | 'docker'; allowed_images?: string[]; network?: string }
export interface RuntimeInstance {
  id: string; name: string; kind: 'percepta' | 'controller'; site_ids: string[]; host_id: string;
  mode: 'simulation' | 'docker'; managed: boolean; image: string; container_name: string;
  observed_state: string; desired_state: string; health: string; error?: string | null;
  active_operation: string | null; last_checked_at: string | null; desired_config_version: string | null;
  applied_config_version: string | null; legacy_target_id?: string; base_url?: string | null;
}
export interface RuntimeOperation { id: string; instance_id: string; action: string; status: string; created_at: string; error?: string }
export interface RuntimeSnapshot { version: string; channel_count: number; warnings: string[]; payload: unknown; executable: boolean; applied: boolean }
