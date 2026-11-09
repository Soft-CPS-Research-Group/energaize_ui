import { describe, expect, it } from 'vitest';
import type { FlexAsset, FlexWindow } from '../../../api/predictorApi';
import { assetsInScope, chargerName, dayTicks, formatSocChange, jobBadge, modelLabel, sourceSummary, timelineBar } from './flexibilityFormat';

const window = (start: string, end: string, extra: Partial<FlexWindow> = {}): FlexWindow => ({
  starts_at: start, ends_at: end,
  arrival_range: { p10: start, p90: start }, departure_range: { p10: end, p90: end },
  soc_at_arrival: 0.35, soc_at_departure: 0.9, charger_id: 'c1', vehicle_id: 'ev1',
  probability: 1, sample_count: 12, ...extra,
});

const asset = (id: string, house: string | null): FlexAsset => ({
  asset_id: id, house_id: house, charger_id: 'c1', vehicle_id: null, mapped: true, latest: null,
});

describe('EV flexibility formatting', () => {
  it('names each job outcome with one word', () => {
    expect(jobBadge(null).label).toBe('Waiting');
    expect(jobBadge({ status: 'completed', delivery: 'delivered' })).toEqual({ label: 'Forecast', tone: 'success' });
    expect(jobBadge({ status: 'insufficient_data', delivery: 'delivered' }).label).toBe('Insufficient');
    expect(jobBadge({ status: 'failed', delivery: 'delivered' }).label).toBe('Failed');
    expect(jobBadge({ status: 'completed', delivery: 'lost' }).label).toBe('Lost');
  });

  it('says which forest made the forecast', () => {
    expect(sourceSummary(null)).toBeNull();
    expect(sourceSummary({ arrival: 'personal', duration: 'personal' })).toBe('Own history');
    expect(sourceSummary({ arrival: 'global', duration: 'global' })).toBe('Fleet forest');
    expect(sourceSummary({ arrival: 'personal', duration: 'global', soc_stop: 'global' })).toBe('Fleet forest for dwell, SoC at departure');
    expect(modelLabel({ name: 'flex-qrf', version: 'v1' })).toBe('Quantile forest');
    expect(modelLabel({ name: 'flex-kde', version: 'v1' })).toBe('Kernel density');
  });

  it('places a window and its range on the horizon', () => {
    const w = window('2026-11-10T00:00:00Z', '2026-11-10T12:00:00Z', {
      arrival_range: { p10: '2026-11-09T23:00:00Z', p90: '2026-11-10T01:00:00Z' },
      departure_range: { p10: '2026-11-10T11:00:00Z', p90: '2026-11-10T13:00:00Z' },
    });
    const bar = timelineBar(w, '2026-11-09T00:00:00Z', '2026-11-11T00:00:00Z');
    expect(bar.left).toBeCloseTo(50);
    expect(bar.width).toBeCloseTo(25);
    expect(bar.rangeLeft).toBeCloseTo(47.92, 1);
    expect(bar.rangeLeft + bar.rangeWidth).toBeCloseTo(77.08, 1);
  });

  it('keeps bars inside the horizon', () => {
    const bar = timelineBar(window('2026-11-10T20:00:00Z', '2026-11-11T08:00:00Z'), '2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z');
    expect(bar.left + bar.width).toBeLessThanOrEqual(100);
  });

  it('marks local midnights, also across a daylight-saving change', () => {
    const ticks = dayTicks('2026-10-24T12:00:00Z', '2026-10-27T12:00:00Z', 'Europe/Lisbon');
    expect(ticks.map((t) => t.label)).toEqual(['Sun 25', 'Mon 26', 'Tue 27']);
    expect(ticks[0].left).toBeCloseTo((11 / 72) * 100);      // 23:00 UTC = midnight in summer time
    expect(dayTicks('2026-11-10T00:00:00Z', '2026-11-09T00:00:00Z', 'UTC')).toEqual([]);
  });

  it('formats SoC change', () => {
    expect(formatSocChange(window('a', 'b'))).toBe('35% → 90%');
    expect(formatSocChange({ soc_at_arrival: null, soc_at_departure: null })).toBeNull();
  });

  it('shows the chargers of the workspace houses only', () => {
    const assets = [asset('a', 'R-H-01'), asset('b', 'R-H-02'), asset('c', null)];
    expect(assetsInScope(assets, null)).toHaveLength(3);
    expect(assetsInScope(assets, ['R-H-02']).map((a) => a.asset_id)).toEqual(['b']);
    expect(chargerName(assets[0])).toBe('R-H-01 · c1');
    expect(chargerName({ asset_id: '0123456789', house_id: null, charger_id: null })).toBe('01234567');
  });
});
