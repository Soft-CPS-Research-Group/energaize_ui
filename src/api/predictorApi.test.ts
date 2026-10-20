import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The published image is built without VITE_PREDICTOR_API_URL, so the gateway path applies.
async function loadApis() {
  vi.resetModules();
  vi.stubEnv('VITE_PREDICTOR_API_URL', '');
  vi.stubEnv('VITE_API_BASE_URL', '/training-api');
  const predictor = await import('./predictorApi');
  const analysis = await import('./analysisApi');
  return { predictor, analysis };
}

function stubFetch(body: unknown = {}) {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Predictor API gateway paths', () => {
  it('calls the predictor gateway instead of nesting it under the training API', async () => {
    const { predictor } = await loadApis();
    const fetch = stubFetch({ houses: ['R-H-01'] });
    await expect(predictor.getHouses()).resolves.toEqual(['R-H-01']);
    expect(fetch.mock.calls[0][0]).toBe('/predictor-api/api/houses');
  });

  it('loads logs from a relative base with the query string intact', async () => {
    const { predictor } = await loadApis();
    const fetch = stubFetch({ lines: ['a'] });
    await expect(predictor.getLogs('error', 50)).resolves.toEqual({ lines: ['a'] });
    expect(fetch.mock.calls[0][0]).toBe('/predictor-api/api/logs?limit=50&filter=error');
  });

  it('keeps an absolute predictor URL when one is configured', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_PREDICTOR_API_URL', 'http://predictor.local:8006/');
    const predictor = await import('./predictorApi');
    const fetch = stubFetch({});
    await predictor.getStats();
    expect(fetch.mock.calls[0][0]).toBe('http://predictor.local:8006/api/stats');
  });

  it('builds analysis export links on the predictor gateway', async () => {
    const { analysis } = await loadApis();
    expect(analysis.getExportUrl('job-1')).toBe('/predictor-api/api/analysis/jobs/job-1/export?format=csv');
  });
});
