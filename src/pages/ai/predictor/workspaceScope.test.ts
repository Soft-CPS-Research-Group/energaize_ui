import { describe, expect, it } from 'vitest';
import type { CommunitySite } from '../../../data/communityDomain';
import type { ModelMeta } from '../../../api/analysisApi';
import { communityHouses, houseInScope, logLineFilter, scopeModels, siteHouseId } from './workspaceScope';

const site = (id: string, rec: string, refs: { system: string; identifier: string }[] = []): CommunitySite => ({
  id, name: id, site_type: 'residential', objective_preference: 'cost', assigned_rec_id: rec, external_references: refs,
});

describe('siteHouseId', () => {
  it('reads the measurement collection of a site', () => {
    expect(siteHouseId({ external_references: [{ system: 'perceptor-site', identifier: 'building_R-H-01' }] })).toBe('R-H-01');
    expect(siteHouseId({ external_references: [{ system: 'percepta-mongo', identifier: 'living_lab/building_R-H-02' }] })).toBe('R-H-02');
  });

  it('prefers perceptor-site and keeps collections without the building_ prefix', () => {
    expect(siteHouseId({ external_references: [
      { system: 'percepta-mongo', identifier: 'db/building_A' },
      { system: 'perceptor-site', identifier: 'SaoMamede' },
    ] })).toBe('SaoMamede');
  });

  it('never guesses from names or other references', () => {
    expect(siteHouseId({ external_references: [{ system: 'demflex-livinglab', identifier: 'R-H-01' }] })).toBeNull();
    expect(siteHouseId({ external_references: [{ system: 'perceptor-site', identifier: '  ' }] })).toBeNull();
    expect(siteHouseId({})).toBeNull();
  });
});

describe('communityHouses', () => {
  const sites = [
    site('a', 'lab', [{ system: 'perceptor-site', identifier: 'building_R-H-02' }]),
    site('b', 'lab', [{ system: 'perceptor-site', identifier: 'building_R-H-01' }]),
    site('c', 'lab'),
    site('d', 'lab', [{ system: 'perceptor-site', identifier: 'building_R-H-09' }]),
    site('e', 'other', [{ system: 'perceptor-site', identifier: 'building_SaoMamede' }]),
  ];

  it('keeps the community houses the predictor forecasts and explains the rest', () => {
    const result = communityHouses(sites, 'lab', ['R-H-01', 'R-H-02', 'SaoMamede']);
    expect(result.houses).toEqual(['R-H-01', 'R-H-02']);
    expect(result.unlinked.map((s) => s.id)).toEqual(['c']);
    expect(result.notForecast).toEqual([{ site: sites[3], houseId: 'R-H-09' }]);
  });

  it('is empty for a community without sites', () => {
    expect(communityHouses(sites, 'none', ['R-H-01'])).toEqual({ houses: [], unlinked: [], notForecast: [] });
  });
});

describe('houseInScope', () => {
  it('lets the Laboratory and the generic model through', () => {
    const scope = new Set(['R-H-01']);
    expect(houseInScope(null, 'R-H-09')).toBe(true);
    expect(houseInScope(scope, 'R-H-01')).toBe(true);
    expect(houseInScope(scope, 'R-H-09')).toBe(false);
    expect(houseInScope(scope, null)).toBe(true);
    expect(houseInScope(scope, 'cold_start')).toBe(true);
  });
});

describe('scopeModels', () => {
  const model = (key: string, house: string | null, uses: string[]): ModelMeta => ({
    model_key: key, house_id: house, lane: 'consumption', model_type: house ? 'warm' : 'cold_start', active: uses.length > 0,
    in_use_by: uses.map((h) => ({ house_id: h, lane: 'consumption', model_kind: 'cold_start', confirmed: true })),
    file_path: '', file_size_kb: 1, stored_mae: 1, n_features: 1, n_outputs: 96,
  });

  it('keeps the community houses and the generic models, counting only the community uses', () => {
    const models = [model('a', 'R-H-01', ['R-H-01']), model('b', 'R-H-09', ['R-H-09']), model('g', null, ['R-H-02', 'R-H-09']), model('h', null, ['R-H-09'])];
    const scoped = scopeModels(models, new Set(['R-H-01', 'R-H-02']));
    expect(scoped.map((m) => m.model_key)).toEqual(['a', 'g', 'h']);
    expect(scoped[1].in_use_by?.map((u) => u.house_id)).toEqual(['R-H-02']);
    expect(scoped[2]).toMatchObject({ in_use_by: [], active: false });
  });

  it('returns the list untouched in the Laboratory', () => {
    const models = [model('a', 'R-H-01', [])];
    expect(scopeModels(models, null)).toBe(models);
  });
});

describe('logLineFilter', () => {
  const inScope = logLineFilter(['R-H-01', 'R-H-010', 'SaoMamede'], new Set(['R-H-010']));

  it('keeps service-wide lines and lines about the workspace houses', () => {
    expect(inScope('2026-10-22 10:00:00,1 | INFO | cloud | scheduler | Cycle started')).toBe(true);
    expect(inScope('2026-10-22 10:00:00,1 | INFO | cloud | worker | [R-H-010] forecast published')).toBe(true);
    expect(inScope('Batch: R-H-01, R-H-010 queued')).toBe(true);
  });

  it('hides lines about other houses, matching whole ids only', () => {
    expect(inScope('[R-H-01] forecast published')).toBe(false);
    expect(inScope('house SaoMamede skipped')).toBe(false);
  });

  it('keeps everything in the Laboratory', () => {
    expect(logLineFilter(['R-H-01'], null)('[R-H-01] x')).toBe(true);
  });
});
