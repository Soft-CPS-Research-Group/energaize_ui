import {fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {SiteMachine} from './SiteMachine';

afterEach(() => vi.unstubAllGlobals());
const machine = {name:'Jetson da Casa Régua',hardware_model:'Jetson AGX Xavier',memory_gb:32,runtime_host_id:'regua-jetson'};
const response = (site: string, local_machine: unknown) => new Response(JSON.stringify({site_id:site,local_machine}),{status:200});

it('shows a saved association without claiming that the machine is online or writing a plan',async () => {
  const fetcher=vi.fn(async () => response('regua',machine));vi.stubGlobal('fetch',fetcher);
  render(<SiteMachine siteId="regua"/>);
  expect(await screen.findByText(machine.name)).toBeInTheDocument();
  expect(screen.getByText('32 GB')).toBeInTheDocument();
  expect(screen.getByText(/Connection and running services are not verified/)).toBeInTheDocument();
  expect(screen.queryByText(/online/i)).not.toBeInTheDocument();
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('distinguishes an associated but unregistered Raspberry from no local machine',async () => {
  vi.stubGlobal('fetch',vi.fn(async (url:string) => response(url.includes('/sites/pi/')?'pi':'lavra',url.includes('/sites/pi/')?{...machine,name:'Raspberry',runtime_host_id:null}:null)));
  const {rerender}=render(<SiteMachine siteId="pi"/>);
  expect(await screen.findByText('Connection setup pending')).toBeInTheDocument();
  rerender(<SiteMachine siteId="lavra"/>);
  expect(screen.queryByText('Raspberry')).not.toBeInTheDocument();
  expect(await screen.findByText('No local machine associated')).toBeInTheDocument();
});

it('does not let a delayed previous house response replace the current association',async () => {
  let finish!: (value:Response)=>void;
  vi.stubGlobal('fetch',vi.fn((url:string) => url.includes('regua/')?new Promise<Response>(resolve=>{finish=resolve;}):Promise.resolve(response('lavra',null))));
  const {rerender}=render(<SiteMachine siteId="regua"/>);
  rerender(<SiteMachine siteId="lavra"/>);
  expect(await screen.findByText('No local machine associated')).toBeInTheDocument();
  finish(response('regua',machine));
  expect(await screen.findByText('No local machine associated')).toBeInTheDocument();
  expect(screen.queryByText(machine.name)).not.toBeInTheDocument();
});

it('shows an unavailable association as an error, with retry, instead of no machine',async () => {
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:503})).mockResolvedValueOnce(response('regua',machine));
  vi.stubGlobal('fetch',fetcher);render(<SiteMachine siteId="regua"/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load');
  expect(screen.queryByText('No local machine associated')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));
  expect(await screen.findByText(machine.name)).toBeInTheDocument();
});
