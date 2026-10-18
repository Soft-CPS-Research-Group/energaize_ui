import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {PerceptaSetup} from './PerceptaSetup';
beforeAll(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};});
afterEach(()=>vi.unstubAllGlobals());
function setup(initialSetup=false,failLaunch=false,community=false){
 const channel={capability_id:'channel',name:'Grid import',unit:'kWh',enabled:true,capability_type:'sensor',data_type:'float',collection:{parameter_type_id:'energy_in_total',role:'input',privacy:'private',necessary:true,source_binding:{connection_id:'connection',fetch_key:'meter',mapping_required:true}}};
 const total={...channel,capability_id:'total',name:'Community import',collection:{parameter_type_id:'energy_in_total',role:'community_output',privacy:'community',necessary:true}};
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);let data:unknown={};
  if(url.endsWith('/hosts'))data=[{id:'local',name:'Local collector',mode:'docker',allowed_images:['energaize/percepta:1']}];
  else if(url.endsWith('/equipment-sources'))data=[];
  else if(url.endsWith('/equipment/asset/source'))data={asset_id:'asset',...JSON.parse(String(init?.body))};
  else if(url.endsWith('/connector-types'))data=[{id:'softcps',name:'SoftCPS',transport:'http',available:true,credentials:'none',defaults:{data_path:'/assets/{entity_id}/observations?window_seconds={time_interval}'}},{id:'cleanwatts',name:'Cleanwatts HTTP',transport:'http',available:true,credentials:'required',defaults:{url:'https://operator-default.example',data_path:'/data/request/Instant?instantType=avg&tags='}}];
  else if(url.endsWith('/launch'))data={instance_id:'instance',operation:{id:'operation',status:failLaunch?'failed':'succeeded',error:failLaunch?'Source unavailable':undefined}};
  else if(url.includes('/sites/site/signals'))data={capabilities:[]};
  else if(url.includes('/recs/rec/signals'))data={capabilities:[total]};
  else if(url.includes('/assets/asset/signals'))data={profile_id:'profile',asset_type:'grid_meter',capabilities:[channel]};
  else if(url.includes('/community-api/api/sites/site'))data={id:'site',name:'My house',assigned_rec_id:'rec'};
  else if(url.includes('/community-api/api/assets/'))data=[{id:'asset',data:{site_id:'site',name:'Grid meter'}}];
  else if(url.includes('/connections'))data=[{id:'connection',name:'Meter connection',provider:'softcps'}];
  else if(url.endsWith('/preview'))data={version:'123abc',channel_count:1,warnings:[],payload:{},executable:true,applied:false};
  else if(url.includes('/percepta/sites/site'))data={environment_key:'house',frequency_seconds:15,timezone:'UTC'};
  return new Response(JSON.stringify(data));
 });
 vi.stubGlobal('fetch',fetcher);
 render(<PerceptaSetup {...(community?{communityId:'rec'}:{siteId:'site'})} configured initialSetup={initialSetup} onChange={vi.fn()}/>);
 return fetcher;
}
async function openEquipment(){fireEvent.click(screen.getByRole('button',{name:'Edit configuration'}));await screen.findByText('Meter connection');fireEvent.click(screen.getByRole('button',{name:'Next: equipment'}));}
it('groups equipment by its source and saves a device assignment once for all its measurements',async()=>{
 const fetcher=setup();await openEquipment();
 expect(screen.queryByRole('combobox',{name:'Equipment or scope'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Grid meter 1 measurements selected/}));
 expect(screen.getByRole('combobox',{name:'Data source'})).toHaveValue('connection');
 fireEvent.change(screen.getByRole('textbox',{name:'Device identifier'}),{target:{value:'new-meter'}});
 expect(screen.getByRole('button',{name:'Next: review'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Save equipment source'}));
 await screen.findByText('Source saved for this equipment and its measurements.');
 const save=fetcher.mock.calls.find(([url,init])=>String(url).endsWith('/equipment/asset/source')&&init?.method==='PUT');
 expect(JSON.parse(String(save?.[1]?.body))).toEqual({connection_id:'connection',device_id:'new-meter'});
 expect(fetcher.mock.calls.some(([url,init])=>String(url).includes('/signals/')&&init?.method==='PUT')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:/Grid import/}));
 expect(screen.queryByRole('combobox',{name:'Connection'})).not.toBeInTheDocument();
 expect(screen.getByText('Source: Meter connection · new-meter')).toBeInTheDocument();
});
it('shows shared data separately and only edits it in the community form',async()=>{
 setup();await openEquipment();
 expect(screen.getByText('Shared community data')).toBeInTheDocument();
 expect(screen.getByText('Community import')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Community import/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Community data'}));
 const dialog=await screen.findByRole('dialog',{name:'Community data'});
 fireEvent.click(await within(dialog).findByRole('button',{name:'Next: shared data'}));
 expect(within(dialog).getByRole('button',{name:/Community import/})).toBeInTheDocument();
 expect(within(dialog).queryByRole('button',{name:'Generate configuration'})).not.toBeInTheDocument();
});
it('fills known connection defaults and asks for credentials only for the selected connector',async()=>{
 setup();fireEvent.click(screen.getByRole('button',{name:'Edit configuration'}));await screen.findByText('Meter connection');
 fireEvent.click(screen.getByRole('button',{name:'Add source'}));
 expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
 expect(screen.getByLabelText('Data endpoint')).toHaveValue('/assets/{entity_id}/observations?window_seconds={time_interval}');
 fireEvent.change(screen.getByRole('combobox',{name:'Service'}),{target:{value:'cleanwatts'}});
 expect(screen.getByLabelText('Service address')).toHaveValue('https://operator-default.example');
 expect(screen.getByLabelText('Username')).toBeRequired();expect(screen.getByLabelText('Password')).toBeRequired();
 expect(screen.getByLabelText('Data endpoint')).toHaveValue('/data/request/Instant?instantType=avg&tags=');
});
async function reviewInitial(){await openEquipment();fireEvent.click(screen.getByRole('button',{name:'Next: review'}));fireEvent.click(screen.getByRole('button',{name:'Generate configuration'}));await screen.findByText('Configuration ready');}
it('starts only after Create & start and closes after confirmation',async()=>{
 const fetcher=setup(true);await reviewInitial();
 expect(fetcher.mock.calls.some(([url])=>String(url).endsWith('/launch'))).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Create & start'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 const launch=fetcher.mock.calls.find(([url])=>String(url).endsWith('/launch'));
 expect(JSON.parse(String(launch?.[1]?.body))).toMatchObject({version:'123abc',host_id:'local',image:'energaize/percepta:1'});
});
it('keeps setup open when starting fails',async()=>{
 setup(true,true);await reviewInitial();fireEvent.click(screen.getByRole('button',{name:'Create & start'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Source unavailable');expect(screen.getByRole('dialog')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Create & start'})).toBeEnabled();
});
