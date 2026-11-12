import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); vi.resetModules(); });

it('keeps an uncertain intent across a page reload and creates a new one after acknowledgement', async () => {
  let { submissionIdentity } = await import('./submissionIdentity');
  const first = submissionIdentity({ config_path: 'a.yaml', target_host: 'server' });
  vi.resetModules();
  ({ submissionIdentity } = await import('./submissionIdentity'));
  const retry = submissionIdentity({ target_host: 'server', config_path: 'a.yaml' });
  expect(retry.key).toBe(first.key);
  retry.acknowledge();
  expect(submissionIdentity({ config_path: 'a.yaml', target_host: 'server' }).key).not.toBe(first.key);
});

it('separates workspaces and changed parameters and preserves a newer pending intent', async () => {
  const { submissionIdentity } = await import('./submissionIdentity');
  const first = submissionIdentity({ config_path: 'a.yaml' });
  const changed = submissionIdentity({ config_path: 'b.yaml' });
  first.acknowledge();
  expect(submissionIdentity({ config_path: 'b.yaml' }).key).toBe(changed.key);
  localStorage.setItem('energaize_training_workspace', 'community:other');
  expect(submissionIdentity({ config_path: 'b.yaml' }).key).not.toBe(changed.key);
});
