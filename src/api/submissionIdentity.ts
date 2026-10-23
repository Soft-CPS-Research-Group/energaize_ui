import { trainingSession, trainingWorkspaceId } from './trainingContext';

type Pending = { request: string; key: string };
const memory = new Map<string, Pending>();

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])
  );
  return value;
}

/** Keep an uncertain submission's identity across retry/reload; an acknowledged run starts a new intent. */
export function submissionIdentity(payload: Record<string, unknown>) {
  const session = trainingSession();
  const scope = `energaize_pending_submission:${session.email || session.name || ''}:${trainingWorkspaceId()}`;
  const request = JSON.stringify(canonical(payload));
  let pending = memory.get(scope);
  try { pending = JSON.parse(sessionStorage.getItem(scope) || 'null') || pending; } catch { /* Memory still protects retries. */ }
  if (!pending || pending.request !== request) {
    // getRandomValues also works on the existing HTTP deployment.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    pending = { request, key: Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('') };
  }
  memory.set(scope, pending);
  try { sessionStorage.setItem(scope, JSON.stringify(pending)); } catch { /* Storage can be disabled. */ }
  const key = pending.key;
  return { key, acknowledge() {
    if (memory.get(scope)?.key === key) memory.delete(scope);
    try {
      if ((JSON.parse(sessionStorage.getItem(scope) || 'null') as Pending | null)?.key === key) sessionStorage.removeItem(scope);
    } catch { /* No persisted state to clear. */ }
  } };
}
