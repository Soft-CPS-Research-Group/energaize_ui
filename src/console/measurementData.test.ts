import { describe, expect, it, vi } from 'vitest';
import { compactPoints, loadWindow, mergeWindow, plotRows, type MeasurementPoint } from './measurementData';
const start = Date.parse('2026-10-11T00:00:00Z');
const point = (id: number, value: number | null = id): MeasurementPoint => ({ id: String(id), timestamp: new Date(start + id * 15000).toISOString(), value });
const range = { start, end: start + 3600000 };
describe('Telemetry chart transport', () => {
  it('follows every cursor with the same fixed time window, deduplicating boundaries', async () => {
    const request = vi.fn().mockResolvedValueOnce({ points: [point(0), point(1)], truncated: true, next_cursor: 'second' })
      .mockResolvedValueOnce({ points: [point(1), point(2)], next_cursor: null });
    const result = await loadWindow(request, '/capabilities/a/series', range, new AbortController().signal);
    expect(result.points.map(p => p.id)).toEqual(['0', '1', '2']);
    const urls = request.mock.calls.map(([path]) => new URL(path, 'http://local'));
    expect(urls[1].searchParams.get('cursor')).toBe('second');
    expect(urls[1].searchParams.get('until_ts')).toBe(urls[0].searchParams.get('until_ts'));
    expect(result.truncated).toBe(false);
  });
  it('does not silently accept truncated or cyclic pagination', async () => {
    const request = vi.fn().mockResolvedValue({ points: [point(0)], truncated: true });
    await expect(loadWindow(request, '/a/series', range, new AbortController().signal)).rejects.toThrow('without a continuation');
    request.mockResolvedValue({ points: [point(0)], truncated: true, next_cursor: 'same' });
    await expect(loadWindow(request, '/a/series', range, new AbortController().signal)).rejects.toThrow('repeated');
  });
  it('cancels pages when the user changes sensor or leaves the view', async () => {
    const controller = new AbortController();
    const request = vi.fn().mockImplementation(async () => { controller.abort(); return { points: [point(0)], next_cursor: 'next' }; });
    await expect(loadWindow(request, '/a/series', range, controller.signal)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('requests a bounded visual envelope for long windows and keeps source field parameters', async () => {
    const request = vi.fn().mockResolvedValue({ points: [], sample_count: 5760, resolution: 'extrema_envelope' });
    await loadWindow(request, '/sources/a/b/series?field=observations.power', { start, end: start + 86400000 }, new AbortController().signal);
    const url = new URL(request.mock.calls[0][0], 'http://local');
    expect(url.pathname).toBe('/sources/a/b/chart'); expect(url.searchParams.get('field')).toBe('observations.power');
    expect(url.searchParams.get('max_points')).toBe('1200');
  });
});
describe('Rolling measurement data', () => {
  it('keeps overlapping corrections and zero, evicts expired points and excludes the next window boundary', () => {
    const points = mergeWindow([point(0), point(1, 10)], [point(1, 0), point(2), point(3)], { start: start + 15000, end: start + 45000 });
    expect(points.map(p => [p.id, p.value])).toEqual([['1', 0], ['2', 2]]);
  });
  it('reduces display points while preserving extrema and a missing observation', () => {
    const points = Array.from({ length: 2000 }, (_, i) => point(i, 1));
    points[10].value = 1000; points[20].value = -10; points[30].value = null;
    const compact = compactPoints(points, { start, end: start + 2000 * 15000 }, 100);
    expect(compact.length).toBeLessThanOrEqual(100);
    expect(compact.map(p => p.value)).toEqual(expect.arrayContaining([1000, -10, null]));
  });
  it('breaks missing and delayed observations without inferring zeros or interpolating gaps', () => {
    const rows = plotRows({ points: [point(0, 0), point(1, null), point(10, 3)] }, 15);
    expect(rows[0].value).toBe(0); expect(rows.filter(r => r.value === null)).toHaveLength(2);
    expect(rows[rows.length - 1].value).toBe(3);
  });
});
