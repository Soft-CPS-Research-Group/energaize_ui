import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, FlaskConical, Search } from 'lucide-react';
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
  const query = useQuery({ queryKey: ['training-workspaces', session?.email], queryFn: () => trainingRequest<{ items: TrainingWorkspace[]; warnings: string[] }>('/api/training/workspaces'), enabled: active && Boolean(session), retry: false });
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
  if (!session) return <section className="training-notice"><h2>Sign in to your training workspace</h2><p>Your previous session needs to be renewed for the connected training service.</p><Link to="/login">Sign in</Link></section>;
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
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const laboratory = workspaces.find(w => w.kind === 'laboratory');
  const communities = workspaces.filter(w => w.kind === 'community' && w.name.toLowerCase().includes(search.trim().toLowerCase()));
  const close = () => { setOpen(false); setSearch(''); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) { setOpen(false); setSearch(''); }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); setSearch(''); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const choose = (next: string) => { select(next); close(); trigger.current?.focus(); };
  return <div className="training-workspace-picker" ref={picker} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
  }}>
    <button ref={trigger} type="button" className="training-workspace-trigger" aria-expanded={open} aria-controls={menuId} onClick={() => { if (open) close(); else setOpen(true); }}>
      <span className="training-workspace-copy"><small>AI Manager · Workspace</small><strong>{workspace?.name || 'Select workspace'}</strong></span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div id={menuId} className="training-workspace-menu" role="region" aria-label="Workspace picker">
      {laboratory && <>
        <button className="training-workspace-option training-workspace-lab" type="button" disabled={mutations > 0} aria-current={id === laboratory.id} onClick={() => choose(laboratory.id)}>
          <FlaskConical size={17} aria-hidden="true" /><span><strong>{laboratory.name}</strong><small>Personal training</small></span>{id === laboratory.id && <Check size={16} aria-hidden="true" />}
        </button>
        <div className="training-workspace-divider" role="separator" />
      </>}
      <label className="training-workspace-search"><Search size={14} aria-hidden="true" /><input aria-label="Search communities" placeholder="Find a community…" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <div className="training-workspace-communities">
        {communities.map(w => <button className="training-workspace-option" type="button" key={w.id} disabled={mutations > 0} aria-current={id === w.id} onClick={() => choose(w.id)}><strong>{w.name}</strong>{id === w.id && <Check size={16} aria-hidden="true" />}</button>)}
        {!communities.length && <p className="training-workspace-empty" role="status">{search ? 'No matching communities.' : 'No communities available.'}</p>}
      </div>
      {warnings.map(w => <p className="training-workspace-warning" role="status" key={w}>{w}</p>)}
    </div>}
  </div>;
}
