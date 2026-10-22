import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PredictorWorkspaceProvider, PredictorWorkspaceSelector, usePredictorScope } from './PredictorWorkspaceContext';

vi.mock('./AuthContext', () => ({ useAuth: () => ({ session: { email: 'predictor@test', role: 'predictor', id: 'predictor' } }) }));
vi.mock('../api/communityApi', () => ({
  listRecs: async () => [
    { id: 'sao', name: 'São Mamede' },
    { id: 'lab', name: 'Living Lab' },
  ],
  listSites: async () => [
    { id: 's1', name: 'House 1', assigned_rec_id: 'lab', external_references: [{ system: 'perceptor-site', identifier: 'building_R-H-01' }] },
    { id: 's2', name: 'House 2', assigned_rec_id: 'lab', external_references: [{ system: 'perceptor-site', identifier: 'building_R-H-02' }] },
    { id: 's3', name: 'Unlinked', assigned_rec_id: 'lab' },
    { id: 's4', name: 'Campus', assigned_rec_id: 'sao', external_references: [{ system: 'percepta-mongo', identifier: 'SaoMamede/building_SaoMamede' }] },
  ],
}));
vi.mock('../api/predictorApi', async (original) => ({
  ...(await original<typeof import('../api/predictorApi')>()),
  getHouses: async () => ['R-H-01', 'R-H-02', 'R-H-03', 'SaoMamede'],
}));

function Probe() {
  const { houses, community, detail } = usePredictorScope();
  return <p data-testid="probe">{community?.name ?? 'Laboratory'}: {houses.join(',')}{detail ? ` (${detail.unlinked.length} unlinked)` : ''}</p>;
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PredictorWorkspaceProvider><PredictorWorkspaceSelector /><Probe /></PredictorWorkspaceProvider></QueryClientProvider>);
}

describe('Predictor workspaces', () => {
  beforeEach(() => localStorage.clear());

  it('shows every house in the Laboratory and only a community\'s houses once it is chosen', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Laboratory: R-H-01,R-H-02,R-H-03,SaoMamede'));
    await userEvent.click(screen.getByRole('button', { name: /Predictor · Workspace/ }));
    const menu = screen.getByRole('region', { name: 'Workspace picker' });
    expect(within(menu).getAllByRole('button')[0]).toHaveAccessibleName('Laboratory Every house');
    // Communities are sorted by name and say how many of their houses are forecast.
    expect(within(menu).getAllByRole('button').slice(1).map((b) => b.textContent)).toEqual(['Living Lab2 houses', 'São Mamede1 house']);
    await userEvent.click(within(menu).getByRole('button', { name: /Living Lab/ }));
    expect(screen.getByTestId('probe')).toHaveTextContent('Living Lab: R-H-01,R-H-02 (1 unlinked)');
    expect(screen.getByRole('button', { name: /Predictor · Workspace/ })).toHaveTextContent('Living Lab');
    expect(localStorage.getItem('energaize_predictor_workspace')).toBe('"lab"');
  });

  it('remembers the workspace and falls back to the Laboratory when the community is gone', async () => {
    localStorage.setItem('energaize_predictor_workspace', '"sao"');
    const first = setup();
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('São Mamede: SaoMamede'));
    first.unmount();
    localStorage.setItem('energaize_predictor_workspace', '"deleted"');
    setup();
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Laboratory: R-H-01,R-H-02,R-H-03,SaoMamede'));
  });

  it('filters the communities by name', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /Predictor · Workspace/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Search communities' }), 'mamede');
    expect(screen.queryByRole('button', { name: /Living Lab/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /São Mamede/ })).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('textbox', { name: 'Search communities' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Search communities' }), 'nothing');
    expect(screen.getByText('No matching communities.')).toBeInTheDocument();
  });
});
