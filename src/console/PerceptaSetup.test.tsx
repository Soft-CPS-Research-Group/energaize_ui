import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {PerceptaSetup} from './PerceptaSetup';

beforeAll(()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
});
afterEach(()=>vi.unstubAllGlobals());
function setup(){
 const channel={capability_id:'channel',name:'Grid import',unit:'kWh',enabled:true,capability_type:'sensor',data_type:'float',collection:{parameter_type_id:'energy_in_total',role:'input',privacy:'private',necessary:true,source_binding:{connection_id:'connection',fetch_key:'meter',mapping_required:true}}};
 const fetcher=vi.fn(async(input:RequestInfo|URL,_init?:RequestInit)=>{
  const url=String(input);let data:unknown={};
  if(url.includes('/sites/site/signals')||url.includes('/recs/rec/signals'))data={capabilities:[]};
  else if(url.includes('/assets/asset/signals'))data={profile_id:'profile',asset_type:'grid_meter',capabilities:[channel]};
  else if(url.includes('/community-api/api/sites/site'))data={id:'site',name:'My house',assigned_rec_id:'rec'};
  else if(url.includes('/community-api/api/assets/'))data=[{id:'asset',data:{site_id:'site',name:'Grid meter'}}];
  else if(url.includes('/connections'))data=[{id:'connection',name:'Meter connection',provider:'softcps'}];
  else if(url.endsWith('/preview'))data={version:'123abc',channel_count:1,warnings:[],payload:{},executable:true,applied:false};
  else if(url.includes('/percepta/sites/site'))data={environment_key:'house',frequency_seconds:15,timezone:'UTC'};
  return new Response(JSON.stringify(data),{status:200});
 });
 vi.stubGlobal('fetch',fetcher);
 render(<PerceptaSetup siteId="site" configured onChange={vi.fn()}/>);
 return fetcher;
}
it('guides connections, channel mapping and generation without deploying an instance',async()=>{
 const fetcher=setup();
 expect(fetcher).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Edit configuration'}));
 await screen.findByText('Meter connection');
 expect(screen.getByRole('dialog',{name:'Configure Percepta'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Next: channels'}));
 fireEvent.click(screen.getByRole('button',{name:/Grid import/}));
 expect(screen.getByRole('combobox',{name:'Connection'})).toHaveValue('connection');
 expect(screen.getByRole('button',{name:'Next: review'})).toBeDisabled();
 fireEvent.change(screen.getByRole('textbox',{name:'Device or fetch key'}),{target:{value:'new-meter'}});
 fireEvent.click(screen.getByRole('button',{name:'Save channel'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Next: review'})).toBeEnabled());
 const save=fetcher.mock.calls.find(([url,init])=>String(url).endsWith('/signals/channel')&&init?.method==='PUT');
 expect(JSON.parse(String(save?.[1]?.body)).collection.source_binding).toMatchObject({connection_id:'connection',fetch_key:'new-meter'});
 fireEvent.click(screen.getByRole('button',{name:'Next: review'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Generate configuration'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Generate configuration'}));
 expect(await screen.findByText('Configuration ready')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Done'})).toBeInTheDocument();
 fireEvent.change(screen.getByRole('spinbutton',{name:'Collection interval (seconds)'}),{target:{value:'30'}});
 expect(screen.queryByText('Configuration ready')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Generate configuration'})).toBeInTheDocument();
 expect(fetcher.mock.calls.some(([url])=>String(url).includes('/operations'))).toBe(false);
});
it('identifies community channels as shared and closes without generating',async()=>{
 const fetcher=setup();
 fireEvent.click(screen.getByRole('button',{name:'Edit configuration'}));
 await screen.findByText('Meter connection');
 fireEvent.click(screen.getByRole('button',{name:'Next: channels'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Equipment or scope'}),{target:{value:'rec'}});
 expect(screen.getByText(/These channels are shared with the other houses/)).toBeInTheDocument();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Close configuration'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Close configuration'}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 expect(fetcher.mock.calls.some(([url])=>String(url).endsWith('/preview'))).toBe(false);
});
