import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TRAINING_ENABLED, trainingRequest, trainingScopeUrl, type TrainingResource } from '../../api/trainingContext';
import { useTrainingWorkspace } from '../../contexts/TrainingWorkspaceContext';
import type { RuntimeInstance } from '../../api/runtimeApi';
import { Button } from '../ui/Button';

export function WorkspaceOperations() {
  const { workspace } = useTrainingWorkspace();
  const client = useQueryClient(); const [jobId, setJobId] = useState('');
  const [from, setFrom] = useState(''); const [until, setUntil] = useState('');
  const state = useQuery({ queryKey: ['training-operations'], queryFn: () => trainingRequest<{ instances: RuntimeInstance[]; models: TrainingResource[]; notice?: string; kpi_available: boolean }>(trainingScopeUrl('/operations')), enabled: TRAINING_ENABLED, refetchInterval: 15000 });
  const promote = useMutation({ mutationFn: () => trainingRequest(trainingScopeUrl(`/models/from-job/${encodeURIComponent(jobId.trim())}`), { method: 'POST' }), onSuccess: () => { client.invalidateQueries({ queryKey: ['training-operations'] }); client.invalidateQueries({ queryKey: ['deploy-bundles'] }); } });
  const kpis = useMutation({ mutationFn: () => trainingRequest(trainingScopeUrl('/kpis?'+new URLSearchParams({from_ts: new Date(from).toISOString(),until_ts:new Date(until).toISOString()}))) });
  if (!TRAINING_ENABLED) return null;
  return <section className="training-operation-list" aria-label="Workspace operation">
    <h2>Operation · {workspace?.name}</h2>
    {state.error && <p role="alert">{state.error.message}</p>}
    {state.data?.notice && <p>{state.data.notice}</p>}
    {state.data?.instances.map(i => <article className="training-operation-row" key={i.id}><header><strong>{i.name}</strong><span>{i.health} · {i.observed_state}</span></header><dl><div><dt>Image</dt><dd>{i.image}</dd></div><div><dt>Applied configuration</dt><dd>{i.applied_config_version || 'Not applied'}</dd></div><div><dt>Mode</dt><dd>{i.mode}</dd></div></dl></article>)}
    {state.data && !state.data.instances.length && workspace?.kind === 'community' && <p>No runtime instances are associated with this community.</p>}
    <h3>Model candidates</h3>
    {state.data?.models.map(m => <p key={m.id}><strong>{m.name}</strong> · version {m.version} · source job {String(m.detail.source_job_id || 'Not recorded')}</p>)}
    <div className="training-folder-toolbar"><input aria-label="Finished job ID" placeholder="Finished job ID" value={jobId} onChange={e => setJobId(e.target.value)} /><Button disabled={!jobId.trim() || promote.isPending} onClick={() => promote.mutate()}>Register model from job</Button></div>
    {promote.error && <p role="alert">{promote.error.message}</p>}{promote.isSuccess && <p role="status">Model candidate registered. Deployment remains a separate action below.</p>}
    {workspace?.kind === 'community' && <><h3>Operational KPIs</h3><p>Measured operation for a selected period. Simulation KPIs remain attached to their jobs.</p><div className="training-folder-toolbar"><label>From <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Until <input type="datetime-local" value={until} onChange={e => setUntil(e.target.value)} /></label><Button disabled={!from || !until || kpis.isPending} onClick={() => kpis.mutate()}>Load KPIs</Button></div>{kpis.error && <p role="alert">{kpis.error.message}</p>}{kpis.data !== undefined && <pre style={{maxHeight:300,overflow:'auto'}}>{JSON.stringify(kpis.data,null,2)}</pre>}</>}
  </section>;
}
