import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimePanel } from './RuntimePanel';
const base={id:'one',name:'House collector',kind:'percepta',site_ids:['site'],host_id:'preview',mode:'simulation',managed:true,image:'collector:1',observed_state:'not_deployed',health:'unknown',last_checked_at:null,active_operation:null};
function mock(items:unknown[]){const fetcher=vi.fn(async(input:RequestInfo|URL,_init?:RequestInit)=>{const url=String(input);return new Response(JSON.stringify(url.endsWith('/hosts')?[{id:'preview',name:'Preview',mode:'simulation'}]:url.includes('/operations')?[]:items),{status:200,headers:{'Content-Type':'application/json'}});});vi.stubGlobal('fetch',fetcher);return fetcher;}
afterEach(()=>vi.unstubAllGlobals());
it('shows an honest empty state without invented running instances',async()=>{mock([]);render(<RuntimePanel siteId="site" siteName="House" kind="percepta" navigate={vi.fn()}/>);expect(await screen.findByText('No Percepta instance assigned')).toBeInTheDocument();expect(screen.queryByText('Running')).not.toBeInTheDocument();});
it('labels simulation and starts only after the play action',async()=>{const fetcher=mock([base]);render(<RuntimePanel siteId="site" kind="percepta" navigate={vi.fn()}/>);expect(await screen.findByText('Simulation')).toBeInTheDocument();expect(screen.queryByText('Manage service')).not.toBeInTheDocument();expect(fetcher.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);fireEvent.click(screen.getByRole('button',{name:'Simulate deployment'}));await waitFor(()=>expect(fetcher.mock.calls.some(([,init])=>init?.method==='POST'&&JSON.parse(String(init.body)).action==='deploy')).toBe(true));});
it('does not offer stop/start for existing observed services',async()=>{mock([{...base,mode:'docker',managed:false,observed_state:'running',health:'not_reported'}]);render(<RuntimePanel siteId="site" kind="percepta" navigate={vi.fn()}/>);expect(await screen.findByText('Existing deployment · observation only')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Stop'})).not.toBeInTheDocument();});
it('reports API failure instead of showing mocked success',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({detail:'Runtime unavailable'}),{status:503})));render(<RuntimePanel siteId="site" kind="controller" navigate={vi.fn()}/>);await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Runtime unavailable'));});

it('keeps configuration behind an explicit button and bounds history to three events',async()=>{
 const events=Array.from({length:4},(_,n)=>({id:'event-'+n,instance_id:'one',action:'refresh',status:'succeeded',created_at:'2026-10-17T12:00:00Z'}));
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);return new Response(JSON.stringify(url.includes('/hosts')?[]:url.includes('/operations')?events:[base]),{status:200});});
 vi.stubGlobal('fetch',fetcher);
 render(<RuntimePanel siteId="site" kind="percepta" navigate={vi.fn()}/>);
 expect(await screen.findByRole('button',{name:'Configure collection'})).toBeInTheDocument();
 expect(screen.queryByRole('dialog',{name:'Configure Percepta'})).not.toBeInTheDocument();
 expect(screen.getAllByText('Refresh · Succeeded')).toHaveLength(3);
 fireEvent.click(screen.getByRole('button',{name:'Older'}));
 await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>String(url).includes('offset=3'))).toBe(true));
});

function deletionFixture(stopStatus='succeeded'){
 const running={...base,observed_state:'running',mode:'docker',configuration_mode:'generated',health:'not_reported'};
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);let data:unknown=[];
  if(init?.method==='POST'){
   const action=JSON.parse(String(init.body)).action;
   data={id:action+'-op',status:action==='stop'?stopStatus:'succeeded',error:stopStatus==='failed'?'Stop failed':undefined};
  }else if(url.endsWith('/instances/one'))data=running;
  else if(url.includes('/instances?'))data=[running];
  else if(url.includes('/telemetry'))data={state:'receiving',last_received_at:null,generated_entities:[]};
  return new Response(JSON.stringify(data),{status:200});
 });
 vi.stubGlobal('fetch',fetcher);
 render(<RuntimePanel siteId="site" kind="percepta" navigate={vi.fn()}/>);
 return fetcher;
}
it('requires confirmation to delete and confirms a stop before removing a running instance',async()=>{
 const fetcher=deletionFixture();
 fireEvent.click(await screen.findByRole('button',{name:'Delete instance'}));
 expect(screen.getByText(/Saved readings, equipment and channel configuration are kept/)).toBeInTheDocument();
 expect(fetcher.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
 expect(fetcher.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Delete instance'}));
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete instance'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>JSON.parse(String(init?.body)).action)).toEqual(['stop','retire']);
});
it('keeps the confirmation open and does not remove the instance if stopping fails',async()=>{
 const fetcher=deletionFixture('failed');
 fireEvent.click(await screen.findByRole('button',{name:'Delete instance'}));
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete instance'}));
 await waitFor(()=>expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Stop failed'));
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>JSON.parse(String(init?.body)).action)).toEqual(['stop']);
});
