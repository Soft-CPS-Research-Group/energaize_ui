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
    await screen.findByLabelText('Nome do dataset');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mercado interno')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Alterar seleção' }));
    expect(screen.getByRole('checkbox', { name: 'Casa' })).toBeChecked();
    fireEvent.click(screen.getByText('Escolher equipamentos'));
    expect(screen.getByRole('checkbox', { name: /Bateria/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Usar predefinições' }));
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
    setup(); await screen.findByLabelText('Nome do dataset');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('heading', { name: 'Preparar a simulação' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verificar dados' }));
    await waitFor(() => expect(vi.mocked(trainingRequest).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const call = vi.mocked(trainingRequest).mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(call![1]!.body as string).generate).toBe(false);
  });
  it('preserves edits across steps and excludes equipment owned by an unselected house', async () => {
    vi.mocked(trainingRequest).mockImplementation(async (url, init) => {
      if (url.endsWith('/defaults')) return { ...defaults, options: { ...options, site_ids: ['house', 'second'], asset_ids: ['battery', 'solar'] }, sites: [...defaults.sites, { site: { id: 'second', name: 'Outra casa' }, assets: [{ id: 'solar', asset_type: 'pv_system', data: { name: 'Solar' } }], channels: [], signals: {} }] } as never;
      if (init?.method === 'POST') return { id: 'build-one', state: 'queued', options, report: {} } as never;
      return [] as never;
    });
    setup(); await screen.findByLabelText('Nome do dataset');
    fireEvent.click(screen.getByRole('button', { name: 'Alterar seleção' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Outra casa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByText('Simulação e tarifas'));
    fireEvent.change(screen.getByLabelText('Compra à rede (€/kWh)'), { target: { value: '0.23' } });
    fireEvent.change(screen.getByLabelText('Mercado interno'), { target: { value: 'false' } });
    expect(screen.queryByLabelText('Compra na comunidade (€/kWh)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('checkbox', { name: 'Outra casa' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Usar predefinições' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar dataset' }));
    await waitFor(() => expect(vi.mocked(trainingRequest).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const call = vi.mocked(trainingRequest).mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(call![1]!.body as string).options).toMatchObject({ site_ids: ['house'], asset_ids: ['battery'], grid_import_price: 0.23, market_enabled: false });
  });
  it('publishes a verified version without creating a second preparation', async () => {
    vi.mocked(trainingRequest).mockImplementation(async (url, init) => {
      if (url.endsWith('/defaults')) return defaults as never;
      if (url.endsWith('/publish')) return { id: 'build-one', state: 'completed', options, report: { result: { name: 'community-v0001' } } } as never;
      if (url.includes('/builds/build-one') || init?.method === 'POST') return { id: 'build-one', state: 'ready', options, report: {} } as never;
      return [] as never;
    });
    setup(); await screen.findByLabelText('Nome do dataset');
    fireEvent.click(screen.getByRole('button', { name: 'Usar predefinições' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verificar dados' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar versão validada' }));
    await screen.findByText('Dataset community-v0001 disponível');
    expect(vi.mocked(trainingRequest).mock.calls.filter(([url, init]) => url.endsWith('/builds') && init?.method === 'POST')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Gerar dataset' })).not.toBeInTheDocument();
  });

});
