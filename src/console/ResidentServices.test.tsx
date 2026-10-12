import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResidentServices } from './ResidentServices';

afterEach(()=>vi.unstubAllGlobals());
it('shows only assigned active services without claiming they are running', async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify([
    {name:'Home controller',kind:'controller',site_ids:['home'],observed_state:'not_deployed',mode:'simulation'},
    {name:'Other home collector',kind:'percepta',site_ids:['other'],observed_state:'running',mode:'docker'},
    {name:'Retired collector',kind:'percepta',site_ids:['home'],observed_state:'retired',mode:'docker'},
  ]),{status:200}));
  vi.stubGlobal('fetch',fetcher);
  render(<ResidentServices siteId="home"/>);
  expect(await screen.findByText('Home controller')).toBeInTheDocument();
  expect(screen.getByText('Assigned to your home · Simulation')).toBeInTheDocument();
  expect(screen.getByText('No service assigned to this home.')).toBeInTheDocument();
  expect(screen.queryByText('Other home collector')).not.toBeInTheDocument();
  expect(screen.queryByText('Retired collector')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(fetcher.mock.calls).toHaveLength(1);
});
it('distinguishes a failed lookup from no assigned services',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
  render(<ResidentServices siteId="home"/>);
  expect(await screen.findAllByText('Service information is unavailable.')).toHaveLength(2);
  expect(screen.queryByText('No service assigned to this home.')).not.toBeInTheDocument();
});
