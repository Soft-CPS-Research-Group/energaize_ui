import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityDatasetGenerator } from './CommunityDatasetGenerator';
import { trainingRequest } from '../../api/trainingContext';
vi.mock('../../api/trainingContext', () => ({ trainingRequest: vi.fn() }));
vi.mock('../../contexts/TrainingWorkspaceContext', () => ({ useTrainingWorkspace: () => ({ id: 'community:one' }) }));
const options = { name: 'community', site_ids: ['house'], asset_ids: ['battery'], from_ts: null, until_ts: null, seconds_per_time_step: 900, signals: {}, battery_initial_soc: {}, market_enabled: null, grid_import_price: null, grid_export_price: null, community_buy_price: null, community_sell_price: null, description: '' };
const defaults = { options, sites: [{ site: { id: 'house', name: 'Casa' }, assets: [{ id: 'battery', asset_type: 'battery', data: { name: 'Bateria' } }], channels: [], signals: {} }], timezone: 'Europe/Lisbon', community: { name: 'Comunidade' }, suggested_period: { from_ts: '2026-10-01T00:00:00Z', until_ts: '2026-10-02T00:00:00Z' }, problems: [] };
function setup() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CommunityDatasetGenerator open onClose={() => {}} /></QueryClientProvider>); }
beforeEach(() => {
  vi.mocked(trainingRequest).mockReset();
  vi.mocked(trainingRequest).mockImplementation(async (url, init) => {
    if (url.endsWith('/defaults')) return defaults as never;
    if (url.endsWith('/builds') && init?.method === 'POST') return { id: 'build-one', state: 'queued', options, report: {} } as never;
    if (url.endsWith('/builds/build-one')) return { id: 'build-one', state: 'completed', options, report: { result: { name: 'community-v0001', version: 1 } } } as never;
    return [] as never;
  });
});
describe('community dataset defaults', () => {
  it('selects every house and asset and generates without an algorithm or job selection', async () => {
    setup();
    await screen.findByText('Comunidade');
    expect(screen.getByRole('checkbox', { name: 'Casa' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Bateria/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar dataset' }));
    await screen.findByText('Dataset community-v0001 disponível');
    const call = vi.mocked(trainingRequest).mock.calls.find(([, init]) => init?.method === 'POST');
    const payload = JSON.parse(call![1]!.body as string);
    expect(payload.generate).toBe(true);
    expect(payload.options.site_ids).toEqual(['house']);
    expect(payload.options.asset_ids).toEqual(['battery']);
    expect(payload.options).not.toHaveProperty('algorithm');
    expect(payload.options).not.toHaveProperty('target_host');
  });
  it('verifies a scenario separately when requested', async () => {
    setup(); await screen.findByText('Comunidade');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar dados' }));
    await waitFor(() => expect(vi.mocked(trainingRequest).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const call = vi.mocked(trainingRequest).mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(call![1]!.body as string).generate).toBe(false);
  });
});
