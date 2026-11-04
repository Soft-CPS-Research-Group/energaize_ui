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
