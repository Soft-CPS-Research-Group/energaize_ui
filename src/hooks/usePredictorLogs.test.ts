import { describe, expect, it } from 'vitest';
import { predictorWebSocketUrl } from './usePredictorLogs';

describe('Predictor log stream URL', () => {
  it('resolves the relative gateway path against the page origin', () => {
    const origin = window.location.origin.replace(/^http/, 'ws');
    expect(predictorWebSocketUrl('/ws/logs', '/predictor-api')).toBe(`${origin}/predictor-api/ws/logs`);
  });

  it('switches an absolute http(s) base to ws(s)', () => {
    expect(predictorWebSocketUrl('/ws/logs', 'http://predictor.local:8006')).toBe('ws://predictor.local:8006/ws/logs');
    expect(predictorWebSocketUrl('/ws/logs', 'https://predictor.example')).toBe('wss://predictor.example/ws/logs');
  });
});
