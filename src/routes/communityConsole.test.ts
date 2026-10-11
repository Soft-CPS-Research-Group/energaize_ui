import { describe, expect, it } from 'vitest';
import { communityConsoleTarget, isCommunityConsolePath, usesCommunityConsole } from './communityConsole';
describe('single community workspace entry', () => {
  it.each(['/communities', '/communities/', '/communities?sort=name', '/app/community', '/app/community/dashboard', '/app/community/topology', '/app/prosumer/dashboard'])('recognizes old entry %s', path => {
    expect(isCommunityConsolePath(path)).toBe(true);
    expect(usesCommunityConsole('rec_manager', path)).toBe(true);
    expect(usesCommunityConsole('prosumer', path)).toBe(true);
  });
  it.each(['/app/ai/jobs', '/app/ai/deploy', '/app/kpi-manager', '/app/predictor', '/community-api/api/recs/', '/measurement-api/energy-communities'])('preserves unrelated route %s', path => expect(isCommunityConsolePath(path)).toBe(false));
  it('preserves other roles’ community selection and unauthenticated routing', () => {
    expect(usesCommunityConsole('training_manager', '/communities')).toBe(false);
    expect(usesCommunityConsole(undefined, '/communities')).toBe(false);
  });
  it('opens the same selection page for the manager entry', () => {
    expect(communityConsoleTarget('/communities/')).toBe('/communities');
    expect(communityConsoleTarget('/app/community/dashboard')).toBe('/app/community/dashboard');
  });
});
