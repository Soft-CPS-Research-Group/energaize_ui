import { INITIAL_COMMUNITIES } from '../constants';
import { beforeEach, describe, expect, it } from 'vitest';
import { readCommunityDomainSnapshot, writeCommunityDomainSnapshot, energyEntitiesFromDomain } from './communityDomain';

describe('persisted ownership', () => {
  beforeEach(() => localStorage.clear());
  it('does not restore removed site access, ownership or membership from demo seeds', () => {
    const model = readCommunityDomainSnapshot();
    expect(model.siteAccesses.length).toBeGreaterThan(0);
    model.siteAccesses = [];
    model.assetOwnerships = [];
    model.recMemberships = [];
    writeCommunityDomainSnapshot(model);
    const restored = readCommunityDomainSnapshot();
    expect(restored.siteAccesses).toEqual([]);
    expect(restored.assetOwnerships).toEqual([]);
    expect(restored.recMemberships).toEqual([]);
  });
  it('preserves intentional removal of users and sites', () => {
    const model = readCommunityDomainSnapshot();
    model.users = [];
    model.sites = [];
    writeCommunityDomainSnapshot(model);
    expect(readCommunityDomainSnapshot().users).toEqual([]);
    expect(readCommunityDomainSnapshot().sites).toEqual([]);
  });
});


describe('personal resource visibility', () => {
  beforeEach(() => localStorage.clear());
  it('excludes expired and future site associations', () => {
    const model = readCommunityDomainSnapshot();
    const own = model.siteAccesses[0];
    for (const [start, end] of [['2000-01-01', '2001-12-31'], ['2099-01-01', '2100-12-31']]) {
      own.validity_start = start;
      own.validity_end = end;
      const entities = energyEntitiesFromDomain(INITIAL_COMMUNITIES[0], 'prosumer', model);
      expect(entities.some(e => e.id === own.site_id)).toBe(false);
    }
  });
  it('does not infer vehicle ownership from a charging site', () => {
    const model = readCommunityDomainSnapshot();
    const own = model.siteAccesses[0];
    model.assets.push({id: 'visiting-ev', name: 'Someone else’s EV', asset_type: 'ev', site_id: own.site_id});
    const entities = energyEntitiesFromDomain(INITIAL_COMMUNITIES[0], 'prosumer', model);
    expect(entities.some(e => e.id === own.site_id)).toBe(true);
    expect(entities.some(e => e.id === 'visiting-ev')).toBe(false);
    model.assetOwnerships.push({id:'ev-own', user_id:own.user_id, energy_asset_id:'visiting-ev', ownership_type:'owned'});
    expect(energyEntitiesFromDomain(INITIAL_COMMUNITIES[0], 'prosumer', model).some(e => e.id === 'visiting-ev')).toBe(true);
  });
});
