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

describe('Predictor health', () => {
  it('reads the status body from a 503 instead of failing', async () => {
    const { predictor } = await loadApis();
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ healthy: false, paused: false }) });
    vi.stubGlobal('fetch', fetch);
    await expect(predictor.getHealth()).resolves.toMatchObject({ healthy: false });
    expect(fetch.mock.calls[0][0]).toBe('/predictor-api/api/health');
  });

  it('fails when the gateway cannot reach the service', async () => {
    const { predictor } = await loadApis();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
    await expect(predictor.getHealth()).rejects.toThrow('502');
  });
});

describe('Setting a model as active', () => {
  const base = {
    house_id: 'R-H-01', lane: 'production' as const, model_type: 'warm' as const, active: null,
    file_path: '', file_size_kb: 1, stored_mae: 0.1, n_features: 10, n_outputs: 96,
  };

  it('restores an archived model before selecting its backend', async () => {
    const { analysis } = await loadApis();
    const fetch = stubFetch({});
    await analysis.activateModel({ ...base, model_key: 'old/lgbm_direct_model_1_year_R-H-01_production_20261001_120000', model_backend: 'lgbm' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/predictor-api/api/analysis/models/old%2Flgbm_direct_model_1_year_R-H-01_production_20261001_120000/promote',
      '/predictor-api/api/houses/R-H-01/active-model',
    ]);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ lane: 'production', model_type: 'lgbm' });
  });

  it('only selects the backend for a model already in production', async () => {
    const { analysis } = await loadApis();
    const fetch = stubFetch({});
    await analysis.activateModel({ ...base, model_key: 'direct_model_1_year_R-H-01_production', active: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/predictor-api/api/houses/R-H-01/active-model');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ lane: 'production', model_type: 'xgboost' });
  });

  it('leaves the active backend alone when the restore fails', async () => {
    const { analysis } = await loadApis();
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: 'Archived model not found' }) });
    vi.stubGlobal('fetch', fetch);
    await expect(analysis.activateModel({ ...base, model_key: 'old/direct_model_1_year_R-H-01_production_20261001_120000' }))
      .rejects.toThrow('Archived model not found');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
