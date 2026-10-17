import { afterEach, describe, expect, it, vi } from 'vitest';
import { trainingRequest, trainingScopeUrl, trainingSession } from './trainingContext';

afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); });
describe('connected training context', () => {
  it('includes a signed session and escapes the selected workspace', async () => {
    sessionStorage.setItem('energaize_session', JSON.stringify({ training_token: 'signed-token' }));
    localStorage.setItem('energaize_training_workspace', 'community:abc');
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetch);
    await trainingRequest(trainingScopeUrl('/resources?kind=dataset'));
    expect(fetch.mock.calls[0][0]).toBe('/ai-training-api/api/training/workspaces/community%3Aabc/resources?kind=dataset');
    expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer signed-token');
  });
  it('reports upstream failures without a mock fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ detail: 'Community unavailable' }) }));
    await expect(trainingRequest('/api/training/workspaces')).rejects.toThrow('Community unavailable');
  });
  it('does not turn invalid persisted state into a claimed identity', () => {
    localStorage.setItem('energaize_session', 'broken');
    expect(trainingSession()).toEqual({});
  });
});
