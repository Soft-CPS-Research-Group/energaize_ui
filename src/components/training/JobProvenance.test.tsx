import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { JobProvenance, ModelHouseMapping } from './JobProvenance';
import { trainingRequest } from '../../api/trainingContext';

vi.mock('../../api/trainingContext', async importOriginal => ({ ...await importOriginal<object>(), TRAINING_ENABLED: true, trainingRequest: vi.fn() }));
vi.mock('../../contexts/TrainingWorkspaceContext', () => ({ useTrainingWorkspace: () => ({ id: 'community:rec', workspace: { id: 'community:rec', name: 'REC', kind: 'community', actions: ['manage'] } }) }));
const provenance = { mapping_status: 'verified', bindings: [{ artifact_path: 'policy.json', agent_id: 'a', agent_index: 0, stage_index: null, scope: 'site', site_ids: ['site-immutable'], building_ids: ['building_1'] }] };
beforeEach(() => vi.clearAllMocks());
function show(status = 'finished') {
  render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><JobProvenance jobId="job" status={status} /></QueryClientProvider></MemoryRouter>);
}
it('shows stable site IDs and separates house and community scope', () => {
  render(<ModelHouseMapping provenance={provenance} />);
  expect(screen.getByText('site-immutable')).toBeInTheDocument();
  expect(screen.getByText('House', {selector:'td'})).toBeInTheDocument();
});
it('registers a finished mapped model through its source job', async () => {
  vi.mocked(trainingRequest).mockResolvedValue({input:{datasets:[]},exported:provenance,models:[]});
  show();
  await userEvent.click(await screen.findByRole('button',{name:'Register model candidate'}));
  await waitFor(() => expect(trainingRequest).toHaveBeenCalledWith(expect.stringContaining('/models/from-job/job'),{method:'POST'}));
});
it.each(['failed','canceled','running'])('does not offer registration for a %s job even with leftover artifacts', async status => {
  vi.mocked(trainingRequest).mockResolvedValue({input:{datasets:[]},exported:provenance,models:[]});
  show(status);
  await screen.findByText('site-immutable');
  expect(screen.queryByRole('button',{name:'Register model candidate'})).not.toBeInTheDocument();
});
it('does not assign an unverified community export to houses', async () => {
  vi.mocked(trainingRequest).mockResolvedValue({input:{datasets:[]},exported:{...provenance,mapping_status:'unmapped'},models:[]});
  show();
  await screen.findByText(/House mapping is not verified/);
  expect(screen.queryByText('site-immutable')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Register model candidate'})).not.toBeInTheDocument();
});
