import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MeasurementWorkspace } from './MeasurementWorkspace';
vi.mock('../components/charts/TimeseriesPlot', () => ({ TimeseriesPlot: ({ children }: {children: ReactNode}) => <div data-testid="unit-plot">{children}</div> }));
vi.mock('recharts', () => ({ Line: ({ name }: {name: string}) => <div data-testid="line">{name}</div>, ReferenceArea: () => null, ReferenceLine: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));
it('toggles real series together, preserves the chosen period and separates incompatible units', async () => {
  const request = vi.fn(async (path: string) => path.endsWith('/latest') ? { points: [], point: { id: 'latest', timestamp: '2026-09-30T08:00:00Z', value: 1 } } : { points: [{ id: 'same', timestamp: '2026-09-30T07:59:00Z', value: path.startsWith('/b') ? 60 : 100 }] });
  render(<MeasurementWorkspace title="Site" request={request} channels={[
    { id: 'a', title: 'Grid power', unit: 'W', endpoint: '/a/series', latestEndpoint: '/a/latest' },
    { id: 'b', title: 'Battery charge', unit: '%', endpoint: '/b/series', latestEndpoint: '/b/latest' },
    { id: 'c', title: 'Voltage', unit: 'V' }
  ]} />);
  await waitFor(() => expect(screen.getAllByTestId('line')).toHaveLength(1));
  expect(screen.queryByRole('button', { name: /^Voltage/ })).not.toBeInTheDocument();
  expect(request.mock.calls.some(([path]) => path.startsWith('/b/'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '6h' }));
  await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('02%3A00'))).toBe(true));
  const before = screen.getByRole('button', { name: /30 Sept.*30 Sept/ }).textContent;
  fireEvent.click(screen.getByRole('button', { name: /^Battery charge/ }));
  await waitFor(() => expect(screen.getAllByTestId('line')).toHaveLength(2));
  expect(screen.getAllByTestId('unit-plot')).toHaveLength(2);
  expect(screen.getByRole('button', { name: /30 Sept.*30 Sept/ }).textContent).toBe(before);
  const last = request.mock.calls.filter(([path]) => path.startsWith('/b/series')).slice(-1)[0][0];
  const params = new URL(last, 'http://local').searchParams;
  expect(Date.parse(params.get('until_ts')!) - Date.parse(params.get('from_ts')!)).toBe(6 * 3600000);
  fireEvent.click(screen.getByRole('button', { name: /^Grid power/ }));
  await waitFor(() => expect(screen.getAllByTestId('line')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: /^Battery charge/ }));
  await waitFor(() => expect(screen.getByText('Select a measurement below')).toBeInTheDocument());
});

it('keeps identically named sensors with their equipment and separates collection from history', () => {
  const configure = vi.fn(), link = vi.fn(), request = vi.fn(async () => ({ points: [] }));
  render(<MeasurementWorkspace title="Site" request={request} onConfigureChannel={configure} onLinkChannel={link} channels={[
    { id: 'soc-a', title: 'State of charge', assetId: 'battery-a', assetName: 'Battery A', unit: '%', tag: '000123', source: 'provider', valueSemantics: 'state', expectedSeconds: 15, enabled: false },
    { id: 'soc-b', title: 'State of charge', assetId: 'battery-b', assetName: 'Battery B', unit: '%', valueSemantics: 'unknown' }
  ]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Measurement channels' }));
  const first = within(screen.getByRole('region', { name: 'Battery A' }));
  const second = within(screen.getByRole('region', { name: 'Battery B' }));
  expect(first.getByText(/Tag: 000123/)).toBeInTheDocument();
  expect(first.getByText('Disabled in catalogue')).toBeInTheDocument();
  expect(first.getByText('No stored readings linked')).toBeInTheDocument();
  expect(second.getByText('Collection not configured')).toBeInTheDocument();
  fireEvent.click(second.getByRole('button', { name: 'Edit channel Battery B · State of charge' }));
  expect(configure).toHaveBeenCalledWith('soc-b');
  expect(link).not.toHaveBeenCalled();
  fireEvent.click(first.getByRole('button', { name: 'Link readings Battery A · State of charge' }));
  expect(link).toHaveBeenCalledWith('soc-a');
  expect(request).not.toHaveBeenCalled();
});

it('identifies simulation separately from channel names and shows a shared device with distinct fields', async () => {
  const request = vi.fn(async () => ({ points: [], point: { id: 'now', timestamp: new Date().toISOString(), value: 1, generated: true } }));
  render(<MeasurementWorkspace title="Battery" request={request} channels={[
    { id: 'soc', title: 'State of charge', assetId: 'b', assetName: 'Battery', source: 'simulator', externalDeviceId: 'battery-01', sourceField: 'soc', simulated: true, unit: '%', endpoint: '/soc/series', latestEndpoint: '/soc/latest' },
    { id: 'power', title: 'Power', assetId: 'b', assetName: 'Battery', source: 'simulator', externalDeviceId: 'battery-01', sourceField: 'power', simulated: true, unit: 'kW', endpoint: '/power/series', latestEndpoint: '/power/latest' }
  ]} />);
  expect(screen.queryByText('Simulated', { exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^State of charge/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Measurement channels' }));
  expect(screen.getByText(/Device: battery-01 → soc/)).toBeInTheDocument();
  expect(screen.getByText(/Device: battery-01 → power/)).toBeInTheDocument();
  expect(screen.getAllByText('Local simulation connected')).toHaveLength(2);
  await waitFor(() => expect(request).toHaveBeenCalled());
});
