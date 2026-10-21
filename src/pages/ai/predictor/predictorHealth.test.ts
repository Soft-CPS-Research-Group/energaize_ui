import { describe, expect, it } from 'vitest';
import { describeHealth } from './PredictorHealthStatus';
import type { PredictorHealth } from '../../../api/predictorApi';

const healthy: PredictorHealth = {
  healthy: true, paused: false, seconds_since_progress: 60, max_cycle_age_seconds: 3600,
  last_cycle_started_at: '2026-10-20T10:00:00+00:00', last_cycle_completed_at: '2026-10-20T10:00:42+00:00',
  last_cycle_duration_s: 42.4, last_cycle_houses_failed: 0, last_publish_at: '2026-10-20T10:00:43+00:00',
  results_queue_size: 0, publisher_connected: true,
};

describe('Predictor health summary', () => {
  it('reports a working service with times in the chosen timezone', () => {
    const summary = describeHealth(healthy, false, 'Europe/Lisbon');
    expect(summary.tone).toBe('good');
    expect(summary.details).toEqual(['Last cycle finished 20/10/2026, 11:00 in 42 s', 'Last forecast published 20/10/2026, 11:00']);
  });

  it('flags an unreachable service', () => {
    expect(describeHealth(undefined, true, 'UTC').tone).toBe('error');
    expect(describeHealth(undefined, false, 'UTC').tone).toBe('checking');
  });

  it('ranks a paused scheduler above a stall', () => {
    expect(describeHealth({ ...healthy, paused: true, healthy: false }, false, 'UTC').headline).toBe('Scheduled forecasts paused');
  });

  it('explains a stall with how long it has lasted', () => {
    const summary = describeHealth({ ...healthy, healthy: false, seconds_since_progress: 2400 }, false, 'UTC');
    expect(summary.tone).toBe('error');
    expect(summary.description).toContain('for 40 min');
  });

  it('warns when forecasts are not published', () => {
    expect(describeHealth({ ...healthy, publisher_connected: false }, false, 'UTC').headline).toBe('Forecasts not delivered');
  });

  it('counts houses whose last cycle failed', () => {
    expect(describeHealth({ ...healthy, last_cycle_houses_failed: 1 }, false, 'UTC').headline).toBe('1 house without a forecast');
    expect(describeHealth({ ...healthy, last_cycle_houses_failed: 3 }, false, 'UTC').headline).toBe('3 houses without a forecast');
  });
});
