import {afterEach,describe,expect,it,vi} from 'vitest';
import {authenticateWorkspace} from './workspaceIdentity';
afterEach(()=>vi.unstubAllGlobals());
describe('server identity sign-in',()=>{
  it('sends credentials to the server and uses its roles',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:'1',email:'rec@energaize.io',role:'rec_manager',name:'Manager',roles:['rec_manager','prosumer']}),{status:200}));vi.stubGlobal('fetch',fetch);
    const result=await authenticateWorkspace(' REC@energaize.io ','individual-password',true);
    expect(result.roles).toEqual(['rec_manager','prosumer']);
    expect(fetch).toHaveBeenCalledWith('/community-api/api/identity/login',expect.objectContaining({credentials:'same-origin',method:'POST',body:JSON.stringify({email:'rec@energaize.io',password:'individual-password',remember:true})}));
  });
  it('cannot authenticate a fixture account when the server rejects it',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:'Invalid email or password.'}),{status:401})));
    await expect(authenticateWorkspace('tiago.fonseca@energaize.io','TfTm#2026!',false)).rejects.toThrow('Invalid');
  });
  it('does not fall back to local passwords when the server is unavailable',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('offline')));
    await expect(authenticateWorkspace('prosumer@energaize.io','pros123',false)).rejects.toThrow('offline');
  });
});
