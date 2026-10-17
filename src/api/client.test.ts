import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => vi.resetModules());
import { jobOrchestratorHttp } from './client';
vi.mock('./trainingContext', () => ({ TRAINING_ENABLED:true, TRAINING_API:'/ai-training-api', trainingScopeUrl:(path:string)=>'/api/training/workspaces/laboratory'+path, trainingHeaders:()=>({Authorization:'Bearer signed-token'}) }));
afterEach(() => vi.unstubAllGlobals());
describe('Signed training API compatibility', () => {
  it('preserves JSON content type when injecting the signed authorization header', async () => {
    const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
    await jobOrchestratorHttp('/experiment-config/create',{method:'POST',body:JSON.stringify({file_name:'demo.yaml',yaml_content:'metadata: {}'})});
    const [url,request]=fetch.mock.calls[0];
    expect(url).toBe('/ai-training-api/api/training/workspaces/laboratory/bridge/experiment-config/create');
    expect(request.headers.get('Content-Type')).toBe('application/json');
    expect(request.headers.get('Authorization')).toBe('Bearer signed-token');
  });
  it('lets the browser generate the multipart boundary on uploads', async () => {
    const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
    await jobOrchestratorHttp('/dataset/upload',{method:'POST',body:new FormData()});
    expect(fetch.mock.calls[0][1].headers.has('Content-Type')).toBe(false);
    expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer signed-token');
  });
});
