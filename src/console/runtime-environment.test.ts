import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceEnvironment, type WorkspaceBridge } from './runtime-environment';

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();document.body.replaceChildren();});
function fixture(){
  const host=document.createElement('div');document.body.append(host);
  const root=host.attachShadow({mode:'open'}),body=document.createElement('div');root.append(body);
  const bridge:WorkspaceBridge={session:{email:'member@example.org',name:'Member',role:'prosumer',remember:false},path:'/app/community/dashboard',logout:vi.fn(),navigate:vi.fn(),onRoute:vi.fn(),charts:{}};
  return {host,root,body,bridge};
}
describe('workspace lifecycle within the shared app',()=>{
  it('isolates DOM access and removes handlers/timers before the next user opens it',()=>{
    vi.useFakeTimers();const {root,body,bridge}=fixture();
    body.innerHTML='<button id="app">Equipment</button>';
    const old=createWorkspaceEnvironment(root,body,bridge),previous=vi.fn();
    old.document.addEventListener('click',previous);old.setInterval(previous,1000);
    document.body.click();expect(previous).not.toHaveBeenCalled();
    expect(old.document.getElementById('app')).toBe(root.querySelector('button'));
    old.dispose();
    const next=createWorkspaceEnvironment(root,body,bridge),current=vi.fn();next.document.addEventListener('click',current);
    root.querySelector('button')!.click();vi.advanceTimersByTime(5000);
    expect(previous).not.toHaveBeenCalled();expect(current).toHaveBeenCalledTimes(1);
    next.dispose();expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts pending backend requests when leaving the workspace',async()=>{
    const {root,body,bridge}=fixture();
    vi.spyOn(globalThis,'fetch').mockImplementation((_input,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));}));
    const env=createWorkspaceEnvironment(root,body,bridge);const response=env.fetch('/community-api/api/recs/');
    env.dispose();await expect(response).rejects.toMatchObject({name:'AbortError'});
  });
});
