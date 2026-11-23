import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PerceptaMessages } from './PerceptaMessages';
import { runtimeRequest } from '../api/runtimeApi';
vi.mock('../api/runtimeApi', () => ({ runtimeRequest: vi.fn() }));
const api = vi.mocked(runtimeRequest);
const message = (id = 'one') => ({ id, timestamp: new Date().toISOString(), truncated: false, payload: { observations: { battery: { value: 68, generated: true } }, community: { energy_in_total: .01 }, forecasts: {}, decisions: {} } });
const batch = (id = 'one', site = 'house') => ({ site_id: site, checked_at: new Date().toISOString(), available: true, source: 'living_lab/building_R-H-01', messages: [message(id)], notice: null });
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it('inspects real payload sections and JSON without requiring an inference', async () => {
  api.mockResolvedValue(batch());
  const back = vi.fn();
  render(<PerceptaMessages siteId="house" siteName="RH01" onBack={back}/>);
  expect(await screen.findByText('Receiving recent messages')).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith('/api/runtime/percepta/sites/house/messages', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
  expect(screen.getByText(/"generated": true/)).toBeInTheDocument();
  expect(screen.getByText(/Source: living_lab/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Back to deployment/ }));
  expect(back).toHaveBeenCalledOnce();
});

it('shows meter exclusions and the charging deduction outside the original Percepta JSON', async () => {
  const response=batch();
  api.mockResolvedValue({...response,messages:[{...response.messages[0],calculations:{non_shiftable_load:{value:0.03,unit:'kWh',ev_charging_energy:0.02,missing_chargers:[],status:'estimated',grid_meter_status:'main_meters_only'}}}]});
  render(<PerceptaMessages siteId="house" siteName="RH01" onBack={()=>{}}/>);
  expect(await screen.findByRole('region',{name:'Platform calculation'})).toHaveTextContent('estimated from average power');
  expect(screen.getByRole('region',{name:'Platform calculation'})).toHaveTextContent('Submeters and logical meters are excluded.');
  fireEvent.click(screen.getByRole('button',{name:'JSON'}));
  expect(screen.queryByText(/"ev_charging_energy"/)).not.toBeInTheDocument();
});

it('shows configured names in the message inspector and keeps the original keys in JSON', async () => {
  const response = batch();
  api.mockResolvedValue({
    ...response,
    measurement_names: { 'reading-uuid': { equipment: 'RH03 grid meter', measurement: 'energy_in_total' } },
    messages: [{ ...response.messages[0], payload: { entities: {
      'equipment-uuid': { parameters: { 'reading-uuid': { measurement_unit: 'kWh', final_values: [{ value: 2 }] } } },
    } } }],
  });
  render(<PerceptaMessages siteId="house" siteName="RH03" onBack={() => {}}/>);
  expect(await screen.findByRole('heading', {name: 'RH03 grid meter'})).toBeVisible();
  expect(screen.getByText('Total grid import')).toBeVisible();
  expect(screen.getByText('2 kWh')).toBeVisible();
  fireEvent.click(screen.getByRole('button', {name: 'JSON'}));
  expect(screen.getByText(/"equipment-uuid"/)).toBeVisible();
});

it('pauses polling and resumes while preserving an inspected message', async () => {
  vi.useFakeTimers(); api.mockResolvedValue(batch());
  render(<PerceptaMessages siteId="house" siteName="RH01" onBack={() => {}}/>);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /Percepta output/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await act(async () => { vi.advanceTimersByTime(15000); });
  expect(api).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Paused')).toBeInTheDocument();
  api.mockResolvedValue(batch('two'));
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(api).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: /Follow latest/ })).toHaveAttribute('aria-pressed', 'false');
});

it('waits for the configured house period between two automatic reads',async()=>{
  vi.useFakeTimers();api.mockResolvedValue(batch());
  render(<PerceptaMessages siteId="house" siteName="RH01" periodSeconds={60} onBack={()=>{}}/>);
  await act(async()=>{});
  await act(async()=>{vi.advanceTimersByTime(59000);});
  expect(api).toHaveBeenCalledTimes(1);
  await act(async()=>{vi.advanceTimersByTime(1000);});
  expect(api).toHaveBeenCalledTimes(2);
});
it('distinguishes missing sources, failures and stale output', async () => {
  api.mockResolvedValue({ ...batch(), available: false, source: null, messages: [], notice: 'No Percepta message source is linked to this house.' });
  render(<PerceptaMessages siteId="house" siteName="RH01" onBack={() => {}}/>);
  expect(await screen.findByText('Source not linked')).toBeInTheDocument();
  const stale = batch(); stale.messages[0].timestamp = '2020-01-01T00:00:00Z';
  api.mockResolvedValue(stale);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('No recent messages')).toBeInTheDocument();
  api.mockRejectedValue(new Error('Service unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Previously loaded messages remain visible');
});

it('clears the previous house and ignores late responses after a context switch', async () => {
  let resolveOld!: (value: unknown) => void;
  api.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const view = render(<PerceptaMessages siteId="old" siteName="Old house" onBack={() => {}}/>);
  api.mockResolvedValue(batch('new', 'new'));
  view.rerender(<PerceptaMessages siteId="new" siteName="New house" onBack={() => {}}/>);
  expect(await screen.findByText('Receiving recent messages')).toBeInTheDocument();
  await act(async () => resolveOld({ ...batch('old', 'old'), source: 'private-old-source' }));
  expect(screen.queryByText(/private-old-source/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Old house/)).not.toBeInTheDocument();
});

it('rejects a response for a different house', async () => {
  api.mockResolvedValue(batch('one', 'other'));
  render(<PerceptaMessages siteId="house" siteName="RH01" onBack={() => {}}/>);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('does not match this house'));
  expect(screen.queryByText(/living_lab/)).not.toBeInTheDocument();
});

it('shows the received forecast horizons and distinguishes zero solar from a missing forecast', async () => {
  const sample = batch();
  const interval = { period_start: '2026-11-22T03:30:00Z', period_end: '2026-11-22T03:45:00Z', value: 0 };
  const solar = { parameter_type_id: 'solar_energy_prediction', measurement_unit: 'kWh',
    generated: false, final_values: [interval] };
  api.mockResolvedValue({ ...sample, messages: [{ ...sample.messages[0], payload: { entities: { PR01: {
    entity_type_id: 'forecast_service', parameters: { solar, load: { ...solar,
      parameter_type_id: 'energy_consumption_prediction', generated: true } },
  } } } }] });
  render(<PerceptaMessages siteId="house" siteName="RH01" onBack={() => {}}/>);
  const forecasts = await screen.findByRole('region', { name: 'Predictor forecasts' });
  expect(forecasts).toHaveTextContent('Solar forecast1 interval · 0 kWh');
  expect(forecasts).toHaveTextContent('Consumption forecastNo received forecast');
});

it('separates the page check from the published house cycle',async()=>{
  api.mockResolvedValue(batch());
  render(<PerceptaMessages siteId="house" siteName="RH25" periodSeconds={900} onBack={()=>{}}/>);
  expect(await screen.findByText(/Page checks every 900 seconds.*900 seconds/)).toBeVisible();
});
