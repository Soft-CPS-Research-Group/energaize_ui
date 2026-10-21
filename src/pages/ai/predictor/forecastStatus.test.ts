import { describe, expect, it } from 'vitest';
import { currentSlotKey, formatAge, forecastNotices, meterDataEnd, nowLineSlot } from './forecastStatus';

const now = Date.parse('2026-10-20T12:07:00Z');
const formatTime = (iso: string) => iso;
const history = (last: string) => ({ consumption: [{ timestamp: last, value: 0.2 }], production: [] });
const forecast = (target: string) => ({ target_time: target, consumption: [0.1], production: [0] });

function notices(args: Partial<Parameters<typeof forecastNotices>[0]>) {
  return forecastNotices({ houseId: 'R-H-01', predictions: undefined, history: undefined, paused: false, now, formatTime, ...args });
}

describe('Forecast freshness', () => {
  it('says nothing about a fresh forecast with recent meter data', () => {
    expect(notices({ predictions: forecast('2026-10-20T13:00:30+01:00'), history: history('2026-10-20T11:45:00') })).toEqual([]);
  });

  it('explains a house that never got a forecast', () => {
    const [notice] = notices({ predictions: { target_time: null, consumption: null, production: null } });
    expect(notice).toMatchObject({ tone: 'warning', title: 'No forecast yet' });
  });

  it('warns about a forecast older than 30 minutes', () => {
    const [notice] = notices({ predictions: forecast('2026-10-20T10:00:00Z') });
    expect(notice).toMatchObject({ tone: 'warning', title: 'Forecast from 2 h 7 min ago' });
  });

  it('treats an old forecast as expected while the scheduler is paused', () => {
    expect(notices({ predictions: forecast('2026-10-20T10:00:00Z'), paused: true })[0].tone).toBe('info');
  });

  it('reports meter data that stopped more than an hour ago', () => {
    const [notice] = notices({ history: history('2026-10-20T10:30:00') });
    expect(notice.title).toBe('Meter data last seen 1 h 22 min ago');
    expect(notice.message).toContain('2026-10-20T10:45:00.000Z');
  });

  it('ends meter data at the end of the last slot, treating bare times as UTC', () => {
    expect(meterDataEnd(history('2026-10-20T11:45:00'))).toBe('2026-10-20T12:00:00.000Z');
    expect(meterDataEnd({ consumption: [], production: [] })).toBeNull();
  });
});

describe('Now line', () => {
  it('sits on the current 15-minute slot', () => {
    expect(currentSlotKey(now)).toBe('2026-10-20T12:00:00Z');
  });

  it('falls back to the latest slot before now when the current one is missing', () => {
    const times = ['2026-10-20T11:30:00Z', '2026-10-20T11:45:00Z', '2026-10-20T12:30:00Z'];
    expect(nowLineSlot(times, '2026-10-20T12:00:00Z')).toBe('2026-10-20T11:45:00Z');
    expect(nowLineSlot(times, '2026-10-20T11:00:00Z')).toBeNull();
  });
});

describe('Ages', () => {
  it('reads naturally', () => {
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(12)).toBe('12 min ago');
    expect(formatAge(120)).toBe('2 h ago');
    expect(formatAge(60 * 72)).toBe('3 days ago');
  });
});
