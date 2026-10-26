import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {DeploymentWorkspace,type DeploymentMap} from './DeploymentWorkspace';
vi.mock('./RuntimePanel',()=>({RuntimePanel:({kind}:{kind:string})=><div>Configure {kind}</div>}));
afterEach(()=>vi.unstubAllGlobals());
const data:DeploymentMap={site_id:'house',revision:'r1',destinations:[{id:'cloud',name:'SoftCPS server',placement:'cloud',registered:true,check:{state:'not_checked'}},{id:'pi',name:'Raspberry · Leça',placement:'local',registered:true,check:{state:'not_checked'}}],components:[{id:'percepta',name:'Percepta',kind:'percepta',destination_id:'pi',planned_destination_id:'pi',state:'not_deployed',planned:true,supported:true},{id:'controller',name:'Inference',kind:'controller',destination_id:'cloud',planned_destination_id:'cloud',state:'not_deployed',planned:true,supported:true},{id:'forecasting',name:'Forecasting',kind:'forecasting',destination_id:'cloud',planned_destination_id:'cloud',state:'not_deployed',planned:true,supported:false}],links:[{id:'broker',source:'percepta',target:'broker',label:'Message broker · AMQP',state:'not_configured',message:'Configure an address reachable from this deployment destination.'}],warnings:[]};
it('shows planned destinations without claiming online and nests configuration under deployment',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(data))));
 render(<DeploymentWorkspace siteId="house" siteName="House" navigate={()=>{}}/>);
 expect(await screen.findByRole('heading',{name:'SoftCPS server'})).toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'Raspberry · Leça'})).toBeInTheDocument();
 expect(screen.queryByText('Online')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:/Forecasting/})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:/Percepta Not deployed/}));
 expect(screen.getByText('Configure percepta')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Deployment'}));
 expect(await screen.findByRole('heading',{name:'Deployment'})).toBeInTheDocument();
});
it('checks only the selected site and renders failures instead of a false online state',async()=>{
 const fetcher=vi.fn(async(_url:string,options?:RequestInit)=>options?.method==='POST'?new Response(JSON.stringify({detail:'Machine check unavailable'}),{status:503}):new Response(JSON.stringify(data)));
 vi.stubGlobal('fetch',fetcher);render(<DeploymentWorkspace siteId="house" siteName="House" navigate={()=>{}}/>);
 await screen.findByRole('heading',{name:'SoftCPS server'});fireEvent.click(screen.getByRole('button',{name:'Check machines'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Machine check unavailable');
 expect(fetcher.mock.calls[1][0]).toContain('/sites/house/deployment-check');
 expect(screen.queryByText('Online')).not.toBeInTheDocument();
});
it('ignores a late response for a previously selected house',async()=>{
 let finish!:(value:Response)=>void;
 vi.stubGlobal('fetch',vi.fn((url:string)=>url.includes('/old/')?new Promise<Response>(r=>{finish=r;}):Promise.resolve(new Response(JSON.stringify({...data,site_id:'new',destinations:[data.destinations[0]]})))));
 const {rerender}=render(<DeploymentWorkspace siteId="old" siteName="Old" navigate={()=>{}}/>);
 rerender(<DeploymentWorkspace siteId="new" siteName="New" navigate={()=>{}}/>);
 await screen.findByRole('heading',{name:'SoftCPS server'});finish(new Response(JSON.stringify(data)));
 await waitFor(()=>expect(screen.queryByRole('heading',{name:'Raspberry · Leça'})).not.toBeInTheDocument());
});
it('does not keep an expired machine observation online',async()=>{
 const expired={...data,destinations:[{...data.destinations[0],check:{state:'online',checked_at:new Date(Date.now()-120000).toISOString()}}]};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(expired))));
 render(<DeploymentWorkspace siteId="house" siteName="House" navigate={()=>{}}/>);
 expect(await screen.findByText('Check expired')).toBeInTheDocument();
 expect(screen.queryByText('Online')).not.toBeInTheDocument();
});
