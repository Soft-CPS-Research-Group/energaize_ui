import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { TRAINING_ENABLED, trainingRequest, trainingScopeUrl, type TrainingResource } from '../../api/trainingContext';
import { useTrainingWorkspace } from '../../contexts/TrainingWorkspaceContext';
import { Button } from '../ui/Button';

export interface ModelProvenance {
  mapping_status?: string;
  config_version?: number;
  datasets?: Array<{ resource_id: string; name: string; version: number }>;
  bindings?: Array<{ agent_id: string | null; agent_index: number; stage_index: number | null; scope: string; site_ids: string[]; building_ids: string[]; artifact_path: string }>;
  topology?: { mode: string; version: number | null; num_agents: number; central_agent: boolean };
}

export function ModelHouseMapping({ provenance }: { provenance?: ModelProvenance }) {
  if (!provenance || provenance.mapping_status !== 'verified') return <p>House mapping is not verified for this export. Laboratory runs and older models can still be inspected.</p>;
  return <div className="training-kpi-results">
    <p>Verified house mapping · {provenance.topology?.num_agents ?? provenance.bindings?.length} agents{provenance.topology?.mode === 'dynamic' ? ' · dynamic topology' : ''}</p>
    <table><thead><tr><th>Model</th><th>Scope</th><th>House IDs</th></tr></thead><tbody>
      {provenance.bindings?.map(binding => <tr key={`${binding.stage_index}:${binding.agent_index}:${binding.artifact_path}`}>
        <td>{binding.stage_index !== null ? `Stage ${binding.stage_index + 1} · ` : ''}Agent {binding.agent_index + 1}</td>
        <td>{binding.scope === 'community' ? 'Community' : 'House'}</td>
        <td>{binding.site_ids.join(', ')}</td>
      </tr>)}
    </tbody></table>
  </div>;
}

export function JobProvenance({ jobId, status }: { jobId: string; status: string }) {
  const { workspace, id } = useTrainingWorkspace();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['job-provenance', id, jobId, status],
    queryFn: () => trainingRequest<{ input: ModelProvenance; exported: ModelProvenance | null; models: TrainingResource[] }>(trainingScopeUrl(`/jobs/${encodeURIComponent(jobId)}/provenance`)),
    enabled: TRAINING_ENABLED && Boolean(jobId), refetchInterval: status === 'running' ? 15000 : false });
  const promote = useMutation({ mutationFn: () => trainingRequest(trainingScopeUrl(`/models/from-job/${encodeURIComponent(jobId)}`), { method: 'POST' }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['job-provenance'] }); client.invalidateQueries({ queryKey: ['training-operations'] }); client.invalidateQueries({ queryKey: ['deploy-bundles'] }); } });
  if (!TRAINING_ENABLED) return null;
  const data = query.data;
  const canRegister = status === 'finished' && workspace?.actions.includes('manage') && Boolean(data?.exported) &&
    (workspace?.kind === 'laboratory' || data?.exported?.mapping_status === 'verified');
  return <section className="job-overview-section" aria-label="Experiment and model origin">
    <h3>Experiment and model origin</h3>
    {query.isPending && <p role="status">Loading experiment origin…</p>}
    {query.error && <p role="alert">{query.error.message}</p>}
    {data && <>
      <p>{workspace?.name || 'Workspace'}{data.input.config_version ? ` · configuration version ${data.input.config_version}` : ' · submitted configuration'}</p>
      {data.input.datasets?.map(ds => <p key={ds.resource_id}>{ds.name} · dataset version {ds.version}</p>)}
      {data.exported ? <ModelHouseMapping provenance={data.exported} /> : <p>No model provenance was exported for this job yet.</p>}
      {data.models.map(model => <p key={model.id}><strong>{model.name}</strong> · candidate version {model.version}{model.detail.is_current_export ? '' : ' · previous export'} · <Link to="/app/ai/deploy">Open candidates</Link></p>)}
      {canRegister && !data.models.some(model => model.detail.is_current_export) && <Button disabled={promote.isPending} onClick={() => promote.mutate()}>{promote.isPending ? 'Registering…' : 'Register model candidate'}</Button>}
    </>}
    {promote.error && <p role="alert">{promote.error.message}</p>}
    {promote.isSuccess && <p role="status">Candidate registered with its original configuration and house mapping.</p>}
  </section>;
}
