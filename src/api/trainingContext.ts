export const TRAINING_ENABLED = import.meta.env.VITE_AI_TRAINING_ENABLED === 'true';
export const TRAINING_API = import.meta.env.VITE_AI_TRAINING_API_URL || '/ai-training-api';
export const TRAINING_WORKSPACE_KEY = 'energaize_training_workspace';
export interface TrainingWorkspace { id: string; name: string; kind: 'laboratory' | 'community'; community_id: string | null; actions: string[] }
export interface TrainingResource { id: string; kind: string; name: string; folder_id: string | null; version: number; created_by: string; detail: Record<string, unknown> }
export interface TrainingFolder { id: string; name: string; kind: string; owner: string }

export function trainingSession(): { email?: string; name?: string; training_token?: string } {
  try { return JSON.parse(localStorage.getItem('energaize_session') || sessionStorage.getItem('energaize_session') || '{}'); }
  catch { return {}; }
}
export function trainingWorkspaceId(): string { return localStorage.getItem(TRAINING_WORKSPACE_KEY) || 'laboratory'; }
export function trainingScopeUrl(path = ''): string { return `/api/training/workspaces/${encodeURIComponent(trainingWorkspaceId())}${path}`; }
export function trainingHeaders(): Record<string, string> { return { Authorization: `Bearer ${trainingSession().training_token || ''}` }; }
export async function trainingRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', trainingHeaders().Authorization);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(TRAINING_API + path, { ...init, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : `Training request failed (${response.status})`);
  }
  return response.json();
}
