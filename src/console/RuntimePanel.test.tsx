import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimePanel } from './RuntimePanel';
const base={id:'one',name:'House collector',kind:'percepta',site_ids:['site'],host_id:'preview',mode:'simulation',managed:true,image:'collector:1',observed_state:'not_deployed',health:'unknown',last_checked_at:null,active_operation:null};
function mock(items:unknown[]){const fetcher=vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);return new Response(JSON.stringify(url.endsWith('/hosts')?[{id:'preview',name:'Preview',mode:'simulation'}]:url.includes('/operations')?[]:items),{status:200,headers:{'Content-Type':'application/json'}});});vi.stubGlobal('fetch',fetcher);return fetcher;}
afterEach(()=>vi.unstubAllGlobals());
it('shows an honest empty state without invented running instances',async()=>{mock([]);render(<RuntimePanel siteId="site" siteName="House" kind="percepta" navigate={vi.fn()}/>);expect(await screen.findByText('No Percepta instance assigned')).toBeInTheDocument();expect(screen.queryByText('Running')).not.toBeInTheDocument();});
it('labels simulation and requires a separate deployment action',async()=>{mock([base]);render(<RuntimePanel siteId="site" kind="percepta" navigate={vi.fn()}/>);expect(await screen.findByText('Simulation')).toBeInTheDocument();expect(screen.queryByText('Manage service')).not.toBeInTheDocument();fireEvent.click(screen.getByText('Simulate deployment'));expect(screen.getByRole('dialog',{name:'Confirm operation'})).toBeInTheDocument();expect(screen.getByText('This changes simulated state only.')).toBeInTheDocument();});
it('does not offer stop/start for existing observed services',async()=>{mock([{...base,mode:'docker',managed:false,observed_state:'running',health:'not_reported'}]);render(<RuntimePanel siteId="site" kind="percepta" navigate={vi.fn()}/>);expect(await screen.findByText('Existing deployment · observation only')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Stop'})).not.toBeInTheDocument();});
it('reports API failure instead of showing mocked success',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({detail:'Runtime unavailable'}),{status:503})));render(<RuntimePanel siteId="site" kind="controller" navigate={vi.fn()}/>);await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Runtime unavailable'));});

it('keeps configuration behind an explicit button and bounds history to five events',async()=>{
 const events=Array.from({length:6},(_,n)=>({id:'event-'+n,instance_id:'one',action:'refresh',status:'succeeded',created_at:'2026-10-17T12:00:00Z'}));
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);return new Response(JSON.stringify(url.includes('/hosts')?[]:url.includes('/operations')?events:[base]),{status:200});});
 vi.stubGlobal('fetch',fetcher);
 render(<RuntimePanel siteId="site" kind="percepta" navigate={vi.fn()}/>);
 expect(await screen.findByRole('button',{name:'Configure collection'})).toBeInTheDocument();
 expect(screen.queryByRole('dialog',{name:'Configure Percepta'})).not.toBeInTheDocument();
 expect(screen.getAllByText('Refresh · Succeeded')).toHaveLength(5);
 fireEvent.click(screen.getByRole('button',{name:'Older'}));
 await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>String(url).includes('offset=5'))).toBe(true));
});
