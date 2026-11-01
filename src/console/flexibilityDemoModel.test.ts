import { describe, expect, it } from 'vitest';
import { compareDemoPolicies, demoAction, durationHours, formatDemoTime, makeDemo, windowState } from './flexibilityDemoModel';

describe('isolated flexibility demonstration', () => {
  it('keeps sources separate without selecting a winner', () => {
    const state = makeDemo();
    expect(state.windows.map(w => w.source)).toEqual(['recurring', 'punctual', 'forecast']);
    expect(state).not.toHaveProperty('selected');
    expect(state.windows.every(w => w.assetId === state.assetId)).toBe(true);
  });
  it('changes only the one-off request and preserves the previous snapshot', () => {
    const before = makeDemo();
    const after = demoAction(before, 'earlier');
    expect(after.windows[1].revision).toBe(2);
    expect(Date.parse(before.windows[1].endsAt) - Date.parse(after.windows[1].endsAt)).toBe(3600000);
    expect(before.windows[1].revision).toBe(1);
    expect(after.windows[0]).toEqual(before.windows[0]);
    expect(after.windows[2]).toEqual(before.windows[2]);
  });
  it('cancels, then creates a distinct request while retaining forecast and cancelled history', () => {
    const before = makeDemo();
    const cancelled = demoAction(before, 'cancel');
    expect(cancelled.windows[1]).toMatchObject({ cancelled: true, revision: 2 });
    expect(cancelled.windows[2]).toEqual(before.windows[2]);
    const after = demoAction(cancelled, 'create');
    expect(after.windows).toHaveLength(4);
    expect(after.windows[3]).toMatchObject({ revision: 1, cancelled: false });
    expect(after.windows[3].id).not.toBe(after.windows[1].id);
    expect(after.history).toHaveLength(4);
  });
  it('shows no history, errors and waiting as unknown rather than zero availability', () => {
    for (const scenario of ['no-history', 'error', 'waiting']) {
      const state = makeDemo('demo-ev', scenario);
      expect(state.windows.filter(w => w.source === 'forecast')).toHaveLength(0);
      expect(state.windows.filter(w => w.source !== 'forecast')).toHaveLength(2);
    }
  });
  it('receives a waiting result without replacing an edited request', () => {
    const edited = demoAction(makeDemo('demo-ev', 'waiting'), 'earlier');
    const result = demoAction(edited, 'receive');
    expect(result.forecastStatus).toBe('ready');
    expect(result.windows).toHaveLength(3);
    expect(result.windows[1]).toEqual(edited.windows[1]);
    expect(demoAction(result, 'receive')).toBe(result);
  });
  it('repeated and stale simulated deliveries preserve the latest forecast', () => {
    const state = makeDemo();
    for (const action of ['duplicate', 'late'] as const) {
      const after = demoAction(state, action);
      expect(after.windows).toEqual(state.windows);
      expect(after.resultRevision).toBe(1);
      expect(after.history).toHaveLength(state.history.length + 1);
    }
  });
  it('retains expired results without labelling them current', () => {
    const state = makeDemo('demo-ev', 'expired');
    expect(windowState(state.windows[2], state.now)).toBe('expired');
    expect(windowState(state.windows[0], state.now)).toBe('available');
    expect(state.windows).toHaveLength(3);
  });
  it('treats the validity boundary as expired and preserves cancellation status', () => {
    const state = makeDemo();
    const forecast = state.windows[2];
    expect(windowState(forecast, forecast.validUntil!)).toBe('expired');
    expect(windowState({ ...forecast, cancelled: true }, forecast.validUntil!)).toBe('cancelled');
  });
  it.each([['spring', 13], ['autumn', 15]] as const)('keeps Lisbon 18–08 across %s using %s elapsed hours', (scenario, hours) => {
    const row = makeDemo('demo-ev', scenario).windows[0];
    expect(durationHours(row)).toBe(hours);
    expect(formatDemoTime(row.startsAt)).toContain('18:00');
    expect(formatDemoTime(row.endsAt)).toContain('08:00');
  });
  it('distinguishes usual use from a forecast of availability', () => {
    const row = makeDemo('demo-ev', 'usual-use').windows[2];
    expect(row.meaning).toBe('usual_use');
    expect(durationHours(row)).toBe(1);
  });
  it('does not allow a washer request shorter than its equipment cycle', () => {
    const state = makeDemo('demo-washer');
    const after = demoAction(state, 'earlier');
    expect(after.windows).toEqual(state.windows);
    expect(after.history.at(-1)).toContain('recusada');
  });
  it('reinitializes the fixture when equipment changes, without mixing identities', () => {
    const ev = demoAction(makeDemo(), 'cancel');
    const washer = makeDemo('demo-washer', ev.scenario);
    expect(washer.requestId).not.toBe(ev.requestId);
    expect(washer.windows.every(w => w.assetId === 'demo-washer')).toBe(true);
    expect(washer.windows.some(w => w.cancelled)).toBe(false);
  });
});

describe('hypothetical selection comparison', () => {
  it('makes the three different EV results explicit without writing a decision', () => {
    const state = makeDemo();
    const [a,b,c] = compareDemoPolicies(state);
    expect([a.startsAt,b.startsAt,c.startsAt]).toEqual(['2026-11-02T19:00:00.000Z','2026-11-02T20:00:00.000Z','2026-11-02T20:00:00.000Z']);
    expect([a.endsAt,b.endsAt,c.endsAt]).toEqual(['2026-11-03T07:00:00.000Z','2026-11-03T07:00:00.000Z','2026-11-03T08:00:00Z']);
    expect(state.history).toHaveLength(2);
  });
  it.each(['waiting','no-history','error','expired','usual-use'])('excludes unusable forecasts in %s and preserves explicit input', scenario => {
    const state = makeDemo('demo-ev',scenario);
    for (const result of compareDemoPolicies(state)) {
      expect(result.sources).toEqual(['punctual']);
      expect(result.startsAt).toBe(state.windows[1].startsAt);
      expect(result.excluded.some(reason => reason.startsWith('Forecast:'))).toBe(true);
    }
  });
  it('changes policies B/C when the waiting forecast arrives but keeps A unchanged', () => {
    const waiting = makeDemo('demo-ev','waiting');
    const before = compareDemoPolicies(waiting);
    const after = compareDemoPolicies(demoAction(waiting,'receive'));
    expect(after[0].startsAt).toBe(before[0].startsAt);
    expect(after[1].startsAt).not.toBe(before[1].startsAt);
    expect(after[2].endsAt).not.toBe(before[2].endsAt);
  });
  it('rejects a combined washer window that cannot fit its cycle', () => {
    const result = compareDemoPolicies(makeDemo('demo-washer'))[1];
    expect(result.startsAt).toBeUndefined();
    expect(result.reason).toContain('90 minutos não cabe');
  });
  it('never reselects cancelled requests and reports no window when no candidate remains', () => {
    const state = demoAction(makeDemo(),'cancel');
    expect(compareDemoPolicies(state)[0].sources).toEqual(['recurring']);
    expect(compareDemoPolicies({...state,windows:state.windows.map(w=>({...w,cancelled:true}))}).every(r=>!r.startsAt)).toBe(true);
  });
});
