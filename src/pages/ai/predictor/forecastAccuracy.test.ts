import { describe, expect, it } from 'vitest';
import { forecastAccuracy } from './forecastAccuracy';

const SLOT = 15 * 60_000;
const now = Date.parse('2026-10-20T12:07:00Z');
const nowSlot = Math.floor(now / SLOT) * SLOT;
const bare = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const lisbon = (ms: number) => new Date(ms + 3_600_000).toISOString().replace(/\.\d{3}Z$/, '+01:00');

/** Three days of measured slots and a run every quarter-hour for four days, like the API returns. */
function scenario(actual: (slot: number) => number, error: (step: number, run: number) => number) {
  const measured = [];
  for (let slot = nowSlot - 288 * SLOT; slot < nowSlot; slot += SLOT) measured.push({ timestamp: bare(slot), value: actual(slot) });
  const runs = [];
  for (let run = nowSlot - 383 * SLOT; run <= nowSlot; run += SLOT) {
    runs.push({
      target_time: lisbon(run + 2_000),
      prediction: Array.from({ length: 96 }, (_, step) => actual(run + step * SLOT) + error(step, run)),
    });
  }
  return { history: { consumption: measured, production: [] }, runs: { consumption: runs, production: [] } };
}

describe('Forecast accuracy cards', () => {
  it('weights every forecast horizon equally, so steady skill shows no change', () => {
    // Error grows with horizon: 0.02 kWh one slot ahead, 0.115 kWh a day ahead, mean 0.0675.
    const { history, runs } = scenario(
      (slot) => 0.3 + 0.2 * Math.sin((slot / 86_400_000) * 2 * Math.PI),
      (step, run) => ((run / SLOT) % 2 ? 1 : -1) * (0.02 + 0.001 * step),
    );
    const { consumption } = forecastAccuracy(history, runs, now);
    expect(consumption.mae).toBeCloseTo(0.0675, 4);
    expect(consumption.slots).toBe(96);
    expect(consumption.n).toBe(96 * 96);
    expect(consumption.maeDelta).toBeCloseTo(0, 6);
    expect(consumption.rmseDelta).toBeCloseTo(0, 6);
  });

  it('reports a real change between the two days', () => {
    // Runs from the last two days miss by 0.01 kWh, older ones by 0.05 kWh. Today's slots were
    // forecast only by the newer runs, yesterday's by both.
    const { history, runs } = scenario(() => 0.4, (_, run) => (run >= nowSlot - 192 * SLOT ? 0.01 : 0.05));
    const { consumption } = forecastAccuracy(history, runs, now);
    expect(consumption.mae).toBeCloseTo(0.01, 6);
    expect(consumption.maeDelta).toBeLessThan(0);
  });

  it('starts prediction[0] at the quarter-hour of target_time, reading bare history times as UTC', () => {
    const history = {
      consumption: [
        { timestamp: '2026-10-20T11:30:00', value: 1 },
        { timestamp: '2026-10-20T11:45:00', value: 2 },
      ],
      production: [],
    };
    // 12:37 Lisbon (+01:00) is 11:37 UTC, so the run starts at the 11:30 slot.
    const runs = { consumption: [{ target_time: '2026-10-20T12:37:12.5+01:00', prediction: [1, 2, 9] }], production: [] };
    const { consumption } = forecastAccuracy(history, runs, now);
    expect(consumption).toMatchObject({ mae: 0, rmse: 0, n: 2, slots: 2 });
  });

  it('counts only the newest run of a quarter-hour', () => {
    const history = { consumption: [{ timestamp: '2026-10-20T11:30:00', value: 1 }], production: [] };
    const runs = {
      consumption: [
        { target_time: '2026-10-20T11:30:05Z', prediction: [5] },
        { target_time: '2026-10-20T11:40:00Z', prediction: [1.5] },
      ],
      production: [],
    };
    expect(forecastAccuracy(history, runs, now).consumption).toMatchObject({ mae: 0.5, n: 1 });
  });

  it('shows no change until both days have half a day of measured slots', () => {
    const { history, runs } = scenario(() => 0.4, () => 0.02);
    history.consumption = history.consumption.filter((p) => Date.parse(p.timestamp + 'Z') >= nowSlot - 120 * SLOT);
    const { consumption } = forecastAccuracy(history, runs, now);
    expect(consumption.mae).toBeCloseTo(0.02, 6);
    expect(consumption.maeDelta).toBeNull();
  });

  it('has no scores without measured slots or forecasts', () => {
    expect(forecastAccuracy(undefined, { consumption: [], production: [] }, now).production).toEqual({
      mae: null, rmse: null, wape: null, n: 0, slots: 0, maeDelta: null, rmseDelta: null, wapeDelta: null,
    });
  });

  it('gives WAPE as total error over total measured energy, so zero slots do not blow it up', () => {
    const history = {
      consumption: [],
      production: [
        { timestamp: '2026-10-20T11:15:00', value: 0 },
        { timestamp: '2026-10-20T11:30:00', value: 0 },
        { timestamp: '2026-10-20T11:45:00', value: 1 },
      ],
    };
    // Night slots forecast at 0.03 kWh and a day slot 0.24 kWh short: 0.3 kWh off out of 1 kWh.
    const runs = { consumption: [], production: [{ target_time: '2026-10-20T11:15:00Z', prediction: [0.03, 0.03, 0.76] }] };
    expect(forecastAccuracy(history, runs, now).production.wape).toBeCloseTo(30, 6);
  });

  it('has no WAPE for a lane that measured no energy', () => {
    const history = { consumption: [], production: [{ timestamp: '2026-10-20T11:45:00', value: 0 }] };
    const runs = { consumption: [], production: [{ target_time: '2026-10-20T11:45:00Z', prediction: [0.1] }] };
    expect(forecastAccuracy(history, runs, now).production).toMatchObject({ mae: 0.1, wape: null, n: 1 });
  });
});
