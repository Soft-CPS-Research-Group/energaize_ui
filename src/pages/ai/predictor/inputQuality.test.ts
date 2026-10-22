import { describe, expect, it } from 'vitest';
import { coveragePct, droppedReadings, inputNotices, meterUnitLabel } from './inputQuality';
import type { DataQualityResponse, LaneDataQuality, MeterInfo } from '../../../api/predictorApi';

const meter = (over: Partial<MeterInfo> = {}): MeterInfo => ({
  spec: { unit: 'kw', cumulative: false, negated: false }, label: 'kW', source: 'detected',
  confidence: 'high', detection: null, ...over,
});
const lane = (over: Partial<LaneDataQuality> = {}): LaneDataQuality => ({ meter: meter(), window: null, model: null, ...over });
const dq = (lanes: DataQualityResponse['lanes']): DataQualityResponse => ({ house_id: 'R-H-01', lanes });

describe('meterUnitLabel', () => {
  it('names the unit, counters and flipped signs', () => {
    expect(meterUnitLabel({ unit: 'kw', cumulative: false, negated: false })).toBe('kW');
    expect(meterUnitLabel({ unit: 'wh', cumulative: true, negated: false })).toBe('Wh counter');
    expect(meterUnitLabel({ unit: 'kwh', cumulative: false, negated: true })).toBe('kWh, sign flipped');
    expect(meterUnitLabel(null)).toBe('—');
  });
});

describe('window quality', () => {
  const window = {
    readings: 700, unreadable: 2, duplicates: 3, counter_resets: 1, negatives_zeroed: 9, negatives_dropped: 4,
    spikes_dropped: 5, slots_total: 672, slots_with_data: 504, longest_gap_slots: 12, coverage: 0.75,
  };
  it('reports coverage and readings left out (zeroed noise is kept)', () => {
    expect(coveragePct(lane({ window }))).toBe(75);
    expect(droppedReadings(lane({ window }))).toBe(15);
    expect(coveragePct(lane())).toBeNull();
  });
});

describe('inputNotices', () => {
  it('warns when a lane publishes nothing', () => {
    const [n] = inputNotices('R-H-01', dq({ consumption: lane({ refused: { model_key: 'x', reason: 'scale-drift', at: '' } }) }));
    expect(n.tone).toBe('warning');
    expect(n.title).toBe('Consumption forecast not published');
    expect(n.message).toContain('very different scale');
  });

  it('says when a unit is a best guess, but not for declared units', () => {
    expect(inputNotices('R-H-01', dq({ production: lane({ meter: meter({ confidence: 'low' }) }) }))[0].title)
      .toBe('Production unit is a best guess');
    expect(inputNotices('R-H-01', dq({ production: lane({ meter: meter({ confidence: 'low', source: 'declared' }) }) })))
      .toEqual([]);
  });

  it('is quiet for confident units and without data', () => {
    expect(inputNotices('R-H-01', dq({ consumption: lane() }))).toEqual([]);
    expect(inputNotices('R-H-01', undefined)).toEqual([]);
  });
});
