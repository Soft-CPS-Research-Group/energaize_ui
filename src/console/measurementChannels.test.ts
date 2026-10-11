import { expect, it, vi } from 'vitest';
import { channelRequest, initialChannels, type MeasurementChannel } from './measurementChannels';
import { compactPoints } from './measurementData';
const channels: MeasurementChannel[] = [
  { id: 'a', name: 'active_power_import', title: 'Grid import', unit: 'W', endpoint: '/a/series', latestEndpoint: '/a/latest' },
  { id: 'b', name: 'active_power_export', title: 'Grid export', unit: 'W', endpoint: '/b/series', latestEndpoint: '/b/latest' },
  { id: 'c', name: 'soc', title: 'Battery', unit: '%', endpoint: '/c/series' },
  { id: 'd', name: 'voltage', title: 'Voltage', unit: 'V' }
];
const path = '/selected/series?from_ts=2026-09-30T07:00:00Z&until_ts=2026-09-30T08:00:00Z';
it('opens a small set of linked power channels and does not select an unlinked or unrelated unit', () => {
  expect(initialChannels(channels)).toEqual(['a', 'b']);
  expect(initialChannels([channels[3]])).toEqual([]);
});
it('fetches selected series only and keeps same-document readings distinct', async () => {
  const request = vi.fn(async () => ({ points: [{ id: 'same-mongo-document', timestamp: '2026-09-30T07:01:00Z', value: 1 }] }));
  const result = await channelRequest(channels.slice(0, 2), request)(path, new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(2);
  expect(result.points.map(p => p.id)).toEqual(['a:same-mongo-document', 'b:same-mongo-document']);
  expect(result.points.map(p => p.channelId)).toEqual(['a', 'b']);
});
it('reports one unavailable series while preserving successful readings', async () => {
  const request = vi.fn(async (path: string) => { if (path.startsWith('/b/')) throw Error('Unavailable'); return { points: [{ id: 'one', timestamp: '2026-09-30T07:01:00Z', value: 0 }] }; });
  const result = await channelRequest(channels.slice(0, 2), request)(path, new AbortController().signal);
  expect(result.points[0].value).toBe(0); expect(result.errors).toEqual(['Grid export: Unavailable']);
});
it('preserves each selected channel extrema when compacting live windows', () => {
  const start = Date.parse('2026-09-30T07:00:00Z');
  const points = ['a', 'b'].flatMap(channelId => Array.from({ length: 1000 }, (_, i) => ({ id: channelId + i, channelId, timestamp: new Date(start + i * 1000).toISOString(), value: i === 250 ? channelId === 'a' ? 10000 : -500 : 1 })));
  const result = compactPoints(points, { start, end: start + 1000000 }, 500);
  expect(result.some(p => p.channelId === 'a' && p.value === 10000)).toBe(true);
  expect(result.some(p => p.channelId === 'b' && p.value === -500)).toBe(true);
});
