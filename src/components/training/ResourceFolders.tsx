import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TRAINING_ENABLED, trainingRequest, trainingScopeUrl, type TrainingFolder, type TrainingResource } from '../../api/trainingContext';

export function useResourceFolders(kind: 'dataset' | 'config') {
  const [selected, setSelected] = useState('all');
  const folders = useQuery({ queryKey: ['training-folders', kind], queryFn: () => trainingRequest<TrainingFolder[]>(trainingScopeUrl(`/folders?kind=${kind}`)), enabled: TRAINING_ENABLED });
  const resources = useQuery({ queryKey: ['training-resources', kind], queryFn: async () => {
    const all: TrainingResource[] = [];
    for (let offset = 0; ; offset += 500) { const page = await trainingRequest<TrainingResource[]>(trainingScopeUrl(`/resources?kind=${kind}&limit=500&offset=${offset}`)); all.push(...page); if (page.length < 500) return all; }
  }, enabled: TRAINING_ENABLED, refetchInterval: 10000 });
  return { kind, selected, setSelected, folders: folders.data || [], resources: resources.data || [], error: folders.error?.message || resources.error?.message,
    visible: (name: string) => !TRAINING_ENABLED || selected === 'all' || (resources.data || []).some(r => r.name === name && (selected === 'general' ? !r.folder_id : r.folder_id === selected)) };
}
type FolderState = ReturnType<typeof useResourceFolders>;
export function ResourceFolders({ state }: { state: FolderState }) {
  const [name, setName] = useState('');
  const client = useQueryClient();
  const mutation = useMutation({ mutationFn: async (action: 'create' | 'rename' | 'delete') => {
    const path = action === 'create' ? '/folders' : `/folders/${encodeURIComponent(state.selected)}`;
    return trainingRequest(trainingScopeUrl(path + (action === 'delete' ? `?kind=${state.kind}` : '')), { method: action === 'create' ? 'POST' : action === 'rename' ? 'PUT' : 'DELETE', body: action === 'delete' ? undefined : JSON.stringify({ name, kind: state.kind }) });
  }, onSuccess: () => { setName(''); state.setSelected('all'); client.invalidateQueries({ queryKey: ['training-folders', state.kind] }); client.invalidateQueries({ queryKey: ['training-resources', state.kind] }); } });
  if (!TRAINING_ENABLED) return null;
  const specific = !['all', 'general'].includes(state.selected);
  return <section className="training-folder-toolbar" aria-label="Resource folders"><label>Folder <select value={state.selected} onChange={e => state.setSelected(e.target.value)}><option value="all">All folders</option><option value="general">General</option>{state.folders.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label>
    <input aria-label="Folder name" placeholder="Folder name" value={name} onChange={e => setName(e.target.value)} maxLength={80} />
    <button type="button" disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate('create')}>New folder</button>
    {specific && <><button type="button" disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate('rename')}>Rename</button><button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate('delete')}>Remove folder</button></>}
    {(state.error || mutation.error) && <p role="alert">{state.error || mutation.error?.message}</p>}
  </section>;
}
export function ResourceFolderSelect({ name, state }: { name: string; state: FolderState }) {
  const client = useQueryClient(); const row = state.resources.find(r => r.name === name);
  const mutation = useMutation({ mutationFn: (folder: string) => trainingRequest(trainingScopeUrl(`/resources/${row?.id}/folder`), { method: 'PUT', body: JSON.stringify({ folder_id: folder || null }) }), onSuccess: () => client.invalidateQueries({ queryKey: ['training-resources', state.kind] }) });
  if (!TRAINING_ENABLED || !row) return null;
  return <span className="training-folder-assignment"><select aria-label={`Folder for ${name}`} value={row.folder_id || ''} disabled={mutation.isPending} onChange={e => mutation.mutate(e.target.value)}><option value="">General</option>{state.folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>{mutation.error && <small role="alert">{mutation.error.message}</small>}</span>;
}
