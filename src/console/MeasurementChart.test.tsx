import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeasurementChart } from './MeasurementChart';
vi.mock('../components/charts/TimeseriesPlot', () => ({ TimeseriesPlot: ({children}: {children: ReactNode}) => <div>Chart{children}</div> }));
vi.mock('recharts', () => ({ Line: ({data}:{data:unknown[]}) => <span data-testid="chart-series" data-points={JSON.stringify(data)}/>, ReferenceArea: () => null, ReferenceLine: () => <span>Live boundary</span>, Tooltip: () => null, XAxis: ({label}:{label:{value:string}}) => <span data-testid="x-axis-label">{label.value}</span>, YAxis: ({label}:{label:{value:string}}) => <span data-testid="y-axis-label">{label.value}</span> }));
const now = Date.parse('2026-10-11T12:00:00Z');
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
afterEach(() => vi.useRealTimers());
describe('Live chart lifecycle', () => {
  it('retains source quality in chart data without adding a provenance banner', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    let generated = true;
    const request = vi.fn(async (path: string) => {
      const point = { id: 'latest', timestamp: new Date(Date.now() - 1000).toISOString(), value: 0, generated };
      return path.endsWith('/latest') ? { points: [], point } : { points: [point] };
    });
    render(<MeasurementChart title="Charger" endpoint="/a/series" latestEndpoint="/a/latest" request={request} expectedSeconds={15} />);
    await flush();
    expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/Includes source-generated values/)).not.toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('chart-series').getAttribute('data-points')!)[0].generated).toBe(true);
    generated = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.queryByText(/Includes source-generated values/)).not.toBeInTheDocument();
  });
  it('polls only the incremental tail every 15 seconds and stops after unmount', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const request = vi.fn(async (path: string, _signal: AbortSignal) => path.endsWith('/latest')
      ? { points: [], point: { id: 'latest', timestamp: new Date(now - 15000).toISOString(), value: 4 } }
      : { points: [{ id: 'last', timestamp: new Date(Date.now() - 15000).toISOString(), value: 4 }] });
    const view = render(<MeasurementChart title="Import" endpoint="/capabilities/a/series" latestEndpoint="/capabilities/a/latest" request={request} expectedSeconds={15} />);
    await flush(); expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute('aria-pressed', 'true');
    const count = request.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(request.mock.calls.length).toBe(count + 1);
    const url = new URL(request.mock.calls[request.mock.calls.length - 1][0], 'http://local');
    expect(Date.parse(url.searchParams.get('until_ts')!) - Date.parse(url.searchParams.get('from_ts')!)).toBe(45000);
    expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute('aria-pressed', 'true');
    const signal = request.mock.calls[request.mock.calls.length - 1][1]; view.unmount(); expect(signal.aborted).toBe(true);
    const stopped = request.mock.calls.length; await act(async () => { await vi.advanceTimersByTimeAsync(45000); });
    expect(request).toHaveBeenCalledTimes(stopped);
  });
  it('queries the exact dates typed into the calendar controls', async () => {
    const request = vi.fn(async (_path: string, _signal: AbortSignal) => ({ points: [] }));
    render(<MeasurementChart title="Dates" endpoint="/a/series" initialEnd={now} request={request} />); await flush();
    fireEvent.click(screen.getByRole('button', { name: /11 Oct.*11 Oct/ }));
    fireEvent.input(screen.getByLabelText('Start date and time'), { target: { value: '2026-09-29T12:00' } });
    fireEvent.input(screen.getByLabelText('End date and time'), { target: { value: '2026-09-29T18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply range' })); await flush();
    const path = request.mock.calls[request.mock.calls.length - 1][0];
    const params = new URL(path, 'http://local').searchParams;
    expect(Date.parse(params.get('from_ts')!)).toBe(Date.parse('2026-09-29T12:00'));
    expect(Date.parse(params.get('until_ts')!)).toBe(Date.parse('2026-09-29T18:00'));
  });
  it('keeps old history visible while waiting for current readings, then shows arriving live data', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const old = now - 11 * 86400000; let resumed = false;
    const request = vi.fn(async (path: string, _signal: AbortSignal) => {
      if (path.endsWith('/latest')) return { points: [], point: { id: 'old', timestamp: new Date(old).toISOString(), value: 4 } };
      const from = Date.parse(new URL(path, 'http://local').searchParams.get('from_ts')!);
      return { points: from < old ? [{ id: 'old', timestamp: new Date(old).toISOString(), value: 4 }] : resumed ? [{ id: 'new', timestamp: new Date(Date.now() - 1).toISOString(), value: 7 }] : [] };
    });
    render(<MeasurementChart title="Demo" endpoint="/a/series" latestEndpoint="/a/latest" request={request} expectedSeconds={15} />); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Live' })); await flush();
    expect(screen.getByText(/No recent readings. Showing stored history/)).toBeInTheDocument();
    expect(screen.getByText('Chart')).toBeInTheDocument();
    expect(screen.queryByText('Live boundary')).not.toBeInTheDocument();
    resumed = true; await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.queryByText(/No recent readings. Showing stored history/)).not.toBeInTheDocument();
    expect(screen.getByText('Live boundary')).toBeInTheDocument();
    expect(screen.getByTestId('chart-series').getAttribute('data-points')).toContain('"value":7');
  });
  it('uses two explicit day clicks, includes the full end day, and disables an incomplete range', async () => {
    const request = vi.fn(async (_path: string, _signal: AbortSignal) => ({ points: [] }));
    render(<MeasurementChart title="Calendar" endpoint="/a/series" initialEnd={Date.parse('2026-09-30T12:00:00Z')} request={request} />); await flush();
    fireEvent.click(screen.getByRole('button', { name: /30 Sept.*30 Sept/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tuesday, September 22nd, 2026' }));
    expect(screen.getByRole('button', { name: 'Apply range' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday, September 23rd, 2026' }));
    expect(screen.getByLabelText('Start date and time')).toHaveValue('2026-09-22T00:00');
    expect(screen.getByLabelText('End date and time')).toHaveValue('2026-09-24T00:00');
    fireEvent.click(screen.getByRole('button', { name: 'Apply range' })); await flush();
    const params = new URL(request.mock.calls[request.mock.calls.length - 1][0], 'http://local').searchParams;
    expect(Date.parse(params.get('until_ts')!)).toBe(Date.parse('2026-09-24T00:00'));
  });
  it('aborts a stale response when the sensor changes', async () => {
    let oldSignal: AbortSignal | undefined;
    const request = vi.fn(async (path: string, signal: AbortSignal) => {
      if (path.includes('/a/')) { oldSignal = signal; return new Promise<{ points: [] }>(() => {}); }
      return { points: [] };
    });
    const view = render(<MeasurementChart title="A" endpoint="/a/series" initialEnd={now} request={request} />); await flush();
    view.rerender(<MeasurementChart title="B" endpoint="/b/series" initialEnd={now} request={request} />); await flush();
    expect(oldSignal?.aborted).toBe(true); expect(screen.getByRole('region',{name:'B chart'})).toBeInTheDocument();expect(request.mock.calls.some(([path])=>path.includes('/b/'))).toBe(true);
  });
});

it('labels time and physical units without the old footer or duplicate live control',async()=>{
 const request=vi.fn(async()=>({points:[{id:'a',timestamp:new Date(now-15000).toISOString(),value:4}]}));
 render(<MeasurementChart title="Power" unit="kW" endpoint="/power/series" initialEnd={now} request={request}/>);await flush();
 expect(screen.getByTestId('x-axis-label')).toHaveTextContent('Time (');
 expect(screen.getByTestId('y-axis-label')).toHaveTextContent('kW');
 expect(screen.queryByText('Drag to zoom')).not.toBeInTheDocument();
 expect(screen.getAllByRole('button',{name:'Live'})).toHaveLength(1);
});

it('shows published prices only in live mode and keeps them out of recorded readings',async()=>{
 vi.useFakeTimers();vi.setSystemTime(now);
 const observed={id:'observed',channelId:'price',timestamp:new Date(now-15000).toISOString(),value:.1};
 const request=vi.fn(async(path:string)=>path.endsWith('/latest')?{points:[],point:observed}:{points:[observed]});
 const horizon=vi.fn(async()=>({points:[{id:'p0',timestamp:new Date(now).toISOString(),value:.11},{id:'p1',timestamp:new Date(now+900000).toISOString(),value:.15}]}));
 render(<MeasurementChart title="Price" endpoint="/prices/series" latestEndpoint="/prices/latest" expectedSeconds={15} request={request} forecastEndpoint="/prices/forecast" forecastRequest={horizon} series={[{id:'price',title:'Price',unit:'EUR/kWh',color:'green',curve:'stepAfter',forecastEndpoint:'/prices/forecast'}]}/>);
 // Series data normally has channel IDs supplied by the workspace adapter.
 await flush();
 expect(horizon).toHaveBeenCalled();
 expect(screen.getByText('Published prices')).toBeInTheDocument();
 expect(screen.getAllByTestId('chart-series')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'Live'}));await flush();
 expect(screen.queryByText('Published prices')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Live'})).toHaveAttribute('aria-pressed','false');
});
