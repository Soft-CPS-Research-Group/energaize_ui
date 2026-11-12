import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TRAINING_ENABLED, trainingRequest, trainingScopeUrl, type TrainingResource } from '../../api/trainingContext';
import { useTrainingWorkspace } from '../../contexts/TrainingWorkspaceContext';
import type { RuntimeInstance } from '../../api/runtimeApi';
import type { ApiResponse, KpiResult } from '../../types/kpi';
import { Button } from '../ui/Button';
import { Link } from 'react-router-dom';
import { ModelHouseMapping, type ModelProvenance } from './JobProvenance';

function KpiResults({ result }: { result: ApiResponse }) {
  const rows: Array<{scope:string; metric:string; point:KpiResult}> = [];
  for (const [scope, metrics] of Object.entries(result.data?.streaming || {})) {
    for (const [metric, points] of Object.entries(metrics)) for (const point of points) rows.push({scope,metric,point});
  }
  for (const [scope, metrics] of Object.entries(result.data?.scheduled || {})) {
    for (const [metric, value] of Object.entries(metrics)) if (value.summary) rows.push({scope,metric,point:value.summary});
  }
  if (!rows.length) return <p role="status">No operational KPI values are available for this period.</p>;
  return <div className="training-kpi-results"><table><thead><tr><th>Scope</th><th>Indicator</th><th>Value</th><th>Period</th></tr></thead><tbody>{rows.map(({scope,metric,point},i) => <tr key={`${scope}-${metric}-${i}`}><td>{scope}</td><td>{metric.replaceAll('_',' ')}</td><td>{Number.isFinite(point.value) ? new Intl.NumberFormat(undefined,{maximumFractionDigits:4}).format(point.value) : 'Unavailable'}</td><td>{point.period_start} – {point.period_end}</td></tr>)}</tbody></table></div>;
}

export function WorkspaceOperations() {
  const { workspace } = useTrainingWorkspace();
  const canManage = workspace?.actions.includes('manage');
  const client = useQueryClient(); const [jobId, setJobId] = useState('');
  const [from, setFrom] = useState(''); const [until, setUntil] = useState('');
  const state = useQuery({ queryKey: ['training-operations'], queryFn: () => trainingRequest<{ instances: RuntimeInstance[]; models: TrainingResource[]; notice?: string; kpi_available: boolean }>(trainingScopeUrl('/operations')), enabled: TRAINING_ENABLED, refetchInterval: 15000 });
  const finished = useQuery({ queryKey: ['training-finished-jobs'], queryFn: () => trainingRequest<Array<{job_id:string; status:string; job_info?:{job_name?:string}}>>(trainingScopeUrl('/bridge/jobs')), enabled: TRAINING_ENABLED && Boolean(canManage) });
  const promote = useMutation({ mutationFn: () => trainingRequest(trainingScopeUrl(`/models/from-job/${encodeURIComponent(jobId)}`), { method: 'POST' }), onSuccess: () => { client.invalidateQueries({ queryKey: ['training-operations'] }); client.invalidateQueries({ queryKey: ['deploy-bundles'] }); } });
  const kpis = useMutation({ mutationFn: () => trainingRequest<ApiResponse>(trainingScopeUrl('/kpis?'+new URLSearchParams({from_ts: new Date(from).toISOString(),until_ts:new Date(until).toISOString()}))) });
  if (!TRAINING_ENABLED) return null;
  return <section className="training-operation-list" aria-label="Workspace operation">
    <h2>Operation · {workspace?.name}</h2>
    {state.error && <p role="alert">{state.error.message}</p>}
    {state.data?.notice && <p>{state.data.notice}</p>}
    {state.data?.instances.map(i => <article className="training-operation-row" key={i.id}><header><strong>{i.name}</strong><span>{i.health.replaceAll('_',' ')} · {i.observed_state.replaceAll('_',' ')}</span></header><dl><div><dt>Image</dt><dd>{i.image}</dd></div><div><dt>Applied configuration</dt><dd>{i.applied_config_version || 'Not applied'}</dd></div><div><dt>Mode</dt><dd>{i.mode}</dd></div></dl></article>)}
    {state.data && !state.data.instances.length && workspace?.kind === 'community' && <p>No runtime instances are associated with this community.</p>}
    <h3>Model candidates</h3>
    {state.data?.models.map(m => <article key={m.id}><p><strong>{m.name}</strong> · version {m.version}{m.detail.source_job_id ? <> · <Link to={`/app/ai/jobs/${encodeURIComponent(String(m.detail.source_job_id))}`}>Source experiment</Link></> : ' · imported bundle'}</p><ModelHouseMapping provenance={m.detail.provenance as ModelProvenance | undefined} /></article>)}
    {canManage && <div className="training-folder-toolbar"><select aria-label="Finished job" value={jobId} onChange={e => setJobId(e.target.value)}><option value="">Select a finished job</option>{finished.data?.filter(j => j.status === 'finished').map(j => <option key={j.job_id} value={j.job_id}>{j.job_info?.job_name || j.job_id}</option>)}</select><Button disabled={!jobId || promote.isPending} onClick={() => promote.mutate()}>Register model from job</Button></div>}
    {promote.error && <p role="alert">{promote.error.message}</p>}{promote.isSuccess && <p role="status">Model candidate registered. Deployment remains a separate action below.</p>}
    {workspace?.kind === 'community' && <><h3>Operational KPIs</h3>{state.data && !state.data.kpi_available ? <p>Operational KPIs have not been connected to this community yet.</p> : <><p>Measured operation for a selected period. Simulation KPIs remain attached to their jobs.</p><div className="training-folder-toolbar"><label>From <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Until <input type="datetime-local" value={until} onChange={e => setUntil(e.target.value)} /></label><Button disabled={!from || !until || kpis.isPending} onClick={() => kpis.mutate()}>Load KPIs</Button></div>{kpis.error && <p role="alert">{kpis.error.message}</p>}{kpis.data && <KpiResults result={kpis.data} />}</>}</>}
  </section>;
}
