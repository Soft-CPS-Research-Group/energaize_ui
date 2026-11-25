export type ReadingSource = { status: 'fresh' | 'reused'; at: string | null };
export const sourceLabel = (status: ReadingSource['status']) =>
  status === 'fresh' ? 'New source reading' : 'Previous reading';

export interface MeasurementPoint {
  channelId?: string;
  id: string;
  timestamp: string;
  value: number | string | boolean | null;
  quality?: string;
  generated?: boolean | null;
  source?: ReadingSource;
  source_samples?: number | null;
  expected_source_samples?: number | null;
  contributors?: number | null;
  expected_contributors?: number | null;
}
export interface MeasurementSeries {
  points: MeasurementPoint[]; next_cursor?: string | null; truncated?: boolean; unit?: string | null;
  errors?: string[]; resolution?: string; bucket_seconds?: number; sample_count?: number; generated_count?: number;
  partial_count?: number; horizon?: MeasurementPoint[];
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
export function incomplete(point: Pick<MeasurementPoint, 'quality'>) {
  return point.quality === 'partial' || point.quality === 'partial_coverage' || point.quality === 'unverified';
}

export function qualityLabel(point: Pick<MeasurementPoint, 'quality' | 'source_samples' | 'expected_source_samples' | 'contributors' | 'expected_contributors'>) {
  if (point.quality === 'unverified') return 'Source sample count unavailable';
  if (point.quality === 'partial' && point.source_samples != null && point.expected_source_samples != null) {
    return `${point.source_samples} of ${point.expected_source_samples} source samples`;
  }
  if (point.quality === 'partial_coverage' && point.contributors != null && point.expected_contributors != null) {
    return `${point.contributors} of ${point.expected_contributors} contributors`;
  }
  return incomplete(point) ? 'Incomplete reading' : null;
}

/** Keep actual extrema and evidence of missing or incomplete readings in each bucket. */
export function compactPoints(points: MeasurementPoint[], range: TimeWindow, budget = 1200): MeasurementPoint[] {
  if (points.length <= budget) return points;
  const channels = [...new Set(points.map(p => p.channelId))];
  if (channels.length > 1) return mergeWindow([], channels.flatMap(id => compactPoints(points.filter(p => p.channelId === id), range, Math.max(100, Math.floor(budget / channels.length)))), range);
  const buckets = new Map<number, MeasurementPoint[]>();
  const width = (range.end - range.start) / Math.max(1, Math.floor(budget / 6));
  points.forEach(p => { const key = Math.floor((Date.parse(p.timestamp) - range.start) / width); const bucket = buckets.get(key) || []; bucket.push(p); buckets.set(key, bucket); });
  const kept: MeasurementPoint[] = [];
  buckets.forEach(bucket => {
    const numeric = bucket.filter(p => typeof p.value === 'number' && Number.isFinite(p.value));
    const min = numeric.reduce<MeasurementPoint | undefined>((a, b) => !a || Number(b.value) < Number(a.value) ? b : a, undefined);
    const max = numeric.reduce<MeasurementPoint | undefined>((a, b) => !a || Number(b.value) > Number(a.value) ? b : a, undefined);
    kept.push(...[bucket[0], min, max, bucket.find(p => typeof p.value !== 'number'), bucket.find(incomplete), bucket[bucket.length - 1]].filter((p): p is MeasurementPoint => !!p));
  });
  return mergeWindow([], kept, range);
}
export function plotRows(data: MeasurementSeries, expectedSeconds?: number | null) {
  const rows: { epochMs: number; value: number | null; qualityLabel?: string | null; generated?: boolean | null; source?: ReadingSource }[] = [];
  // Envelope points are intentionally separated within buckets; only larger gaps imply missing time.
  const gapMs = Math.max((expectedSeconds || 0) * 3, (data.bucket_seconds || 0) * 2) * 1000;
  data.points.forEach(p => {
    const epochMs = Date.parse(p.timestamp), previous = rows[rows.length - 1];
    if (gapMs && previous && epochMs - previous.epochMs > gapMs) rows.push({ epochMs: previous.epochMs + 1, value: null });
    rows.push({ epochMs, value: typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : null, generated: p.generated, source: p.source, qualityLabel: qualityLabel(p) });
  });
  return rows;
}
type ReadingRow = ReturnType<typeof plotRows>[number];

export function readingLineData(rows: ReadingRow[], key: string) {
  const solid: (ReadingRow & Record<string, unknown>)[] = [];
  const dashed: typeof solid = [];
  let previous: ReadingRow | undefined;
  let lastLine: typeof solid | undefined;
  for (const row of rows) {
    if (previous?.value == null || row.value == null) {
      lastLine = undefined;
    } else {
      const line = row.source?.status === 'reused' ? dashed : solid;
      if (line !== lastLine) {
        // A null separates runs of the same style without dropping either endpoint.
        if (line.length) line.push({ ...previous, value: null, [key]: null });
        line.push({ ...previous, [key]: previous.value });
      }
      line.push({ ...row, [key]: row.value });
      lastLine = line;
    }
    previous = row;
  }
  return { solid, dashed };
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
