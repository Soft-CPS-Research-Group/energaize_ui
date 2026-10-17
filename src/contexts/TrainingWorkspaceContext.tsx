import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, QueryClient, QueryClientProvider, useIsMutating } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { TRAINING_ENABLED, TRAINING_WORKSPACE_KEY, trainingRequest, trainingWorkspaceId, type TrainingWorkspace } from '../api/trainingContext';
import { isTrainingManagerRole } from '../utils/roles';

const Context = createContext<{ workspace?: TrainingWorkspace; id: string; workspaces: TrainingWorkspace[]; select: (id: string) => void; error?: string; loading: boolean; warnings: string[]; pending: number; setPending: (n: number) => void }>({ id: 'laboratory', workspaces: [], select: () => {}, loading: false, warnings: [], pending: 0, setPending: () => {} });
export const useTrainingWorkspace = () => useContext(Context);
export function TrainingWorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [id, setId] = useState(trainingWorkspaceId);
  const [pending, setPending] = useState(0);
  const active = TRAINING_ENABLED && isTrainingManagerRole(session?.role);
  const query = useQuery({ queryKey: ['training-workspaces', session?.email], queryFn: () => trainingRequest<{ items: TrainingWorkspace[]; warnings: string[] }>('/api/training/workspaces'), enabled: active && Boolean(session?.training_token), retry: false });
  const workspaces = query.data?.items || [];
  const workspace = workspaces.find(item => item.id === id);
  return <Context.Provider value={{ id, workspace, workspaces, loading: query.isLoading, pending, setPending,
    error: query.error?.message, warnings: query.data?.warnings || [],
    select: next => { if (pending) return; localStorage.setItem(TRAINING_WORKSPACE_KEY, next); setId(next); } }}>{children}</Context.Provider>;
}
export function TrainingWorkspaceGate({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const context = useTrainingWorkspace();
  if (!TRAINING_ENABLED || !isTrainingManagerRole(session?.role)) return <>{children}</>;
  if (!session?.training_token) return <section className="training-notice"><h2>Sign in to your training workspace</h2><p>Your previous session needs to be renewed for the connected training service.</p><Link to="/login">Sign in</Link></section>;
  if (context.loading) return <p role="status">Loading workspaces…</p>;
  if (context.error) return <p role="alert">{context.error}</p>;
  if (!context.workspace) return <p role="status">Select an available workspace above.</p>;
  return <ScopedQueries key={session.email + ':' + context.id}>{children}</ScopedQueries>;
}
function ScopedQueries({ children }: { children: ReactNode }) {
  // Each workspace owns its cache, pending responses and local page state.
  const client = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }), []);
  return <QueryClientProvider client={client}><MutationState />{children}</QueryClientProvider>;
}
function MutationState() {
  const pending = useIsMutating();
  const { setPending } = useTrainingWorkspace();
  useEffect(() => { setPending(pending); return () => setPending(0); }, [pending, setPending]);
  return null;
}
export function TrainingWorkspaceSelector() {
  const { workspace, id, workspaces, select, warnings, pending: mutations } = useTrainingWorkspace();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  return <div className="training-workspace-picker">
    <button type="button" className="training-workspace-trigger" aria-expanded={open} onClick={() => setOpen(!open)}><small>AI Manager · Workspace</small><strong>{workspace?.name || 'Select workspace'} <span aria-hidden>⌄</span></strong></button>
    {open && <div className="training-workspace-menu"><input autoFocus aria-label="Search workspaces" placeholder="Search communities…" value={search} onChange={e => setSearch(e.target.value)} />
      {workspaces.filter(w => w.name.toLowerCase().includes(search.toLowerCase())).map(w => <button type="button" key={w.id} disabled={mutations > 0} aria-current={id === w.id} onClick={() => { select(w.id); setOpen(false); setSearch(''); }}><strong>{w.name}</strong><small>{w.kind === 'laboratory' ? 'Personal training folders' : 'Community workspace'}</small></button>)}
      {warnings.map(w => <p role="status" key={w}>{w}</p>)}
    </div>}
  </div>;
}
