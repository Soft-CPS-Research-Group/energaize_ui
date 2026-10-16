import { loadWindow, type MeasurementRequest, type MeasurementSeries } from './measurementData';
export interface MeasurementChannel {
  defaultVisible?: boolean; displayScale?: number; curve?: 'linear' | 'stepAfter'; forecastEndpoint?: string;
  incremental?: boolean; id: string; title: string; unit?: string; endpoint?: string; latestEndpoint?: string;
  expectedSeconds?: number | null; note?: string; name?: string;
  assetId?: string; assetName?: string; tag?: string | null; source?: string | null;
  valueSemantics?: string; enabled?: boolean;
  sourceKind?: string; externalDeviceId?: string | null; sourceField?: string | null; simulated?: boolean;
}
export const SERIES_COLORS = ['#12845a', '#377bb5', '#b57b23', '#9367bb', '#d16472', '#397f82'];
export function initialChannels(channels: MeasurementChannel[]) {
  const linked = channels.filter(c => c.endpoint);
  const defaults = linked.filter(c => c.defaultVisible);
  if (defaults.length) return defaults.map(c => c.id);
  const preferred = linked.filter(c => /active_power|power_import|power_export/.test(c.name || ''));
  const first = preferred[0] || linked.find(c => c.simulated) || linked[0];
  return first ? [first.id, ...preferred.filter(c => c.id !== first.id && c.unit === first.unit).slice(0, 1).map(c => c.id)] : [];
}
/** One time window across selected channels. Inactive channels never cause requests. */
export function channelRequest(channels: MeasurementChannel[], request: MeasurementRequest): MeasurementRequest {
  return async (path, signal) => {
    if (!channels.length) return { points: [] };
    if (path.endsWith('/latest')) {
      const results = await Promise.allSettled(channels.map(c => c.latestEndpoint ? request(c.latestEndpoint, signal) : Promise.resolve(null)));
      signal.throwIfAborted();
      const points = results.flatMap(r => r.status === 'fulfilled' && r.value?.point ? [r.value.point] : []).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      if (!points.length && results.every(r => r.status === 'rejected')) throw Error('Selected measurement sources are unavailable.');
      return { points: [], point: points[0] };
    }
    const query = new URL(path, 'http://console.local').searchParams;
    const range = { start: Date.parse(query.get('from_ts')!), end: Date.parse(query.get('until_ts')!) };
    // Small batches avoid flooding the store if many pills are enabled.
    const results: { channel: MeasurementChannel; data?: MeasurementSeries; error?: string }[] = [];
    for (let i = 0; i < channels.length; i += 3) {
      signal.throwIfAborted();
      results.push(...await Promise.all(channels.slice(i, i + 3).map(async channel => {
        try { return { channel, data: await loadWindow(request, channel.endpoint!, range, signal) }; }
        catch (e) { if (signal.aborted) throw e; return { channel, error: (e as Error).message }; }
      })));
    }
    signal.throwIfAborted();
    const successful = results.filter(r => r.data);
    if (!successful.length) throw Error(results.map(r => `${r.channel.title}: ${r.error}`).join('; '));
    return {
      points: successful.flatMap(({ channel, data }) => data!.points.map(p => ({ ...p, value: typeof p.value === 'number' ? p.value * (channel.displayScale ?? 1) : p.value, id: `${channel.id}:${p.id}`, channelId: channel.id }))).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id)),
      sample_count: successful.reduce((n, r) => n + (r.data!.sample_count ?? r.data!.points.length), 0),
      generated_count: successful.reduce((n, r) => n + (r.data!.generated_count ?? r.data!.points.filter(p => p.generated).length), 0),
      bucket_seconds: Math.max(...successful.map(r => r.data!.bucket_seconds || 0)),
      resolution: successful.some(r => r.data!.resolution === 'aligned_mean_sum') ? 'aligned_mean_sum' : successful.some(r => r.data!.resolution === 'extrema_envelope') ? 'extrema_envelope' : 'raw',
      errors: results.filter(r => r.error).map(r => `${r.channel.title}: ${r.error}`), next_cursor: null, truncated: false
    };
  };
}
