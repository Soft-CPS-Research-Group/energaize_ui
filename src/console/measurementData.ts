export interface MeasurementPoint { channelId?: string; id: string; timestamp: string; value: number | string | boolean | null; quality?: string; generated?: boolean | null }
export interface MeasurementSeries {
  points: MeasurementPoint[]; next_cursor?: string | null; truncated?: boolean; unit?: string | null;
  errors?: string[]; resolution?: string; bucket_seconds?: number; sample_count?: number; generated_count?: number;
  sampling_interval_seconds?: number | null; from?: string; until?: string;
}
export type MeasurementRequest = (path: string, signal: AbortSignal) => Promise<MeasurementSeries & { point?: MeasurementPoint }>;
export type TimeWindow = { start: number; end: number };
export function mergeWindow(previous: MeasurementPoint[], next: MeasurementPoint[], range: TimeWindow) {
  const points = new Map(previous.map(p => [p.id, p]));
  next.forEach(p => points.set(p.id, p));
  return [...points.values()].filter(p => { const t = Date.parse(p.timestamp); return t >= range.start && t < range.end; })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
}
/** Keep actual extrema and a missing observation in each bucket, never average energy counters. */
export function compactPoints(points: MeasurementPoint[], range: TimeWindow, budget = 1200): MeasurementPoint[] {
  if (points.length <= budget) return points;
  const channels = [...new Set(points.map(p => p.channelId))];
  if (channels.length > 1) return mergeWindow([], channels.flatMap(id => compactPoints(points.filter(p => p.channelId === id), range, Math.max(100, Math.floor(budget / channels.length)))), range);
  const buckets = new Map<number, MeasurementPoint[]>();
  const width = (range.end - range.start) / Math.floor(budget / 5);
  points.forEach(p => { const key = Math.floor((Date.parse(p.timestamp) - range.start) / width); const bucket = buckets.get(key) || []; bucket.push(p); buckets.set(key, bucket); });
  const kept: MeasurementPoint[] = [];
  buckets.forEach(bucket => {
    const numeric = bucket.filter(p => typeof p.value === 'number' && Number.isFinite(p.value));
    const min = numeric.reduce<MeasurementPoint | undefined>((a, b) => !a || Number(b.value) < Number(a.value) ? b : a, undefined);
    const max = numeric.reduce<MeasurementPoint | undefined>((a, b) => !a || Number(b.value) > Number(a.value) ? b : a, undefined);
    kept.push(...[bucket[0], min, max, bucket.find(p => typeof p.value !== 'number'), bucket[bucket.length - 1]].filter((p): p is MeasurementPoint => !!p));
  });
  return mergeWindow([], kept, range);
}
export function plotRows(data: MeasurementSeries, expectedSeconds?: number | null) {
  const rows: { epochMs: number; value: number | null; generated?: boolean | null }[] = [];
  // Envelope points are intentionally separated within buckets; only larger gaps imply missing time.
  const gapMs = Math.max((expectedSeconds || 0) * 3, (data.bucket_seconds || 0) * 2) * 1000;
  data.points.forEach(p => {
    const epochMs = Date.parse(p.timestamp), previous = rows[rows.length - 1];
    if (gapMs && previous && epochMs - previous.epochMs > gapMs) rows.push({ epochMs: previous.epochMs + 1, value: null });
    rows.push({ epochMs, value: typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : null, generated: p.generated });
  });
  return rows;
}
export async function loadWindow(request: MeasurementRequest, endpoint: string, range: TimeWindow, signal: AbortSignal, progress: (count: number) => void = () => {}) {
  const query = new URLSearchParams({ from_ts: new Date(range.start).toISOString(), until_ts: new Date(range.end).toISOString(), limit: '1000' });
  const separator = endpoint.includes('?') ? '&' : '?';
  const chart = () => request(endpoint.replace('/series', '/chart') + separator + query.toString().replace('limit=1000', 'max_points=1200'), signal);
  if (range.end - range.start > 6 * 3600000) return chart();
  let all: MeasurementPoint[] = [], cursor: string | null | undefined; const seen = new Set<string>(); let data: MeasurementSeries;
  do {
    signal.throwIfAborted();
    if (cursor) query.set('cursor', cursor);
    data = await request(endpoint + separator + query, signal);
    signal.throwIfAborted();
    all.push(...data.points); progress(all.length);
    cursor = data.next_cursor;
    if (data.truncated && !cursor) throw Error('Telemetry returned an incomplete window without a continuation cursor.');
    if (cursor && seen.has(cursor)) throw Error('Telemetry repeated a page cursor. Please retry.');
    if (cursor) seen.add(cursor);
    if (seen.size >= 20) return chart();
  } while (cursor);
  return { ...data!, points: mergeWindow([], all, range), sample_count: data!.resolution === 'extrema_envelope' ? data!.sample_count : all.length, next_cursor: null, truncated: false };
}
