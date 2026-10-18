import {act,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PerceptaTelemetryStatus} from './PerceptaTelemetryStatus';
import type {RuntimeInstance} from '../api/runtimeApi';
const healthyChannels={channels:[{channel_id:'in',name:'Grid import',owner:'Meter',scope:'asset',state:'receiving',message:'Recent value received.',last_received_at:null}],channel_summary:{total:1,receiving:1,issues:0}};
const item={observed_state:'running',kind:'percepta',mode:'docker',health:'not_reported',applied_config_version:'version',desired_config_version:'version',last_checked_at:'2026-10-17T12:00:00Z'} as RuntimeInstance;
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('requires recent readings and an applied configuration for a healthy check',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...healthyChannels,state:'receiving',last_received_at:'2026-10-17T12:00:00Z',generated_entities:[]}))));
 const check=vi.fn();
 render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={check}/>);
 expect(await screen.findByRole('button',{name:'Working normally'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Check now'}));expect(check).toHaveBeenCalledOnce();
});
it('does not call fallback data healthy even when the service is running',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...healthyChannels,state:'receiving',last_received_at:'2026-10-17T12:00:00Z',generated_entities:['meter']}))));
 render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={vi.fn()}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('equipment readings use fallback values');
 expect(screen.queryByRole('button',{name:'Working normally'})).not.toBeInTheDocument();
});

it('automatically alerts when readings become stale and clears the warning when they recover',async()=>{
 vi.useFakeTimers();
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({...healthyChannels,state:'receiving',generated_entities:[]})))
  .mockResolvedValueOnce(new Response(JSON.stringify({...healthyChannels,state:'stale',generated_entities:[]})))
  .mockResolvedValueOnce(new Response(JSON.stringify({...healthyChannels,state:'receiving',generated_entities:[]})));
 vi.stubGlobal('fetch',fetcher);
 render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={vi.fn()}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(screen.getByRole('button',{name:'Working normally'})).toBeInTheDocument();
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
 expect(screen.getByRole('alert')).toHaveTextContent('Readings have stopped arriving');
 expect(screen.queryByRole('button',{name:'Working normally'})).not.toBeInTheDocument();
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
 expect(screen.getByRole('button',{name:'Working normally'})).toBeInTheDocument();
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('does not keep a healthy indication when service monitoring fails',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...healthyChannels,state:'receiving',generated_entities:[]}))));
 const {rerender}=render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={vi.fn()}/>);
 expect(await screen.findByRole('button',{name:'Working normally'})).toBeInTheDocument();
 rerender(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={vi.fn()} monitoringError="Offline"/>);
 expect(screen.getByRole('alert')).toHaveTextContent('The service status could not be refreshed.');
 expect(screen.queryByRole('button',{name:'Working normally'})).not.toBeInTheDocument();
});
it('explains an unapplied configuration even with recent readings',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...healthyChannels,state:'receiving',generated_entities:[]}))));
 render(<PerceptaTelemetryStatus siteId="site" item={{...item,desired_config_version:'new'}} onCheck={vi.fn()}/>);
 expect(await screen.findByText('Receiving data')).toBeInTheDocument();
 expect(screen.getByRole('alert')).toHaveTextContent('The latest configuration has not been confirmed as applied.');
 expect(screen.queryByRole('button',{name:'Working normally'})).not.toBeInTheDocument();
});

it('keeps the details behind hover or keyboard focus and dismisses them with Escape',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...healthyChannels,state:'receiving',generated_entities:[]}))));
 render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={vi.fn()}/>);
 const icon=await screen.findByRole('button',{name:'Working normally'});
 expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
 fireEvent.mouseEnter(icon);
 expect(screen.getByRole('tooltip')).toHaveTextContent('Service running, configuration applied and all monitored channels receiving valid recent data.');
 fireEvent.mouseLeave(icon);
 expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
 fireEvent.focus(icon);
 expect(screen.getByRole('tooltip')).toBeInTheDocument();
 expect(icon).toHaveAttribute('aria-describedby',screen.getByRole('tooltip').id);
 fireEvent.keyDown(icon,{key:'Escape'});
 expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

it('names broken channels even with fresh house messages and reveals healthy channels on demand',async()=>{
 const channels=[...healthyChannels.channels,{channel_id:'out',name:'Grid export',owner:'Meter',scope:'asset',state:'missing',message:'No value found in recent records.',last_received_at:null}];
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({state:'receiving',generated_entities:[],channels,channel_summary:{total:2,receiving:1,issues:1}}))));
 render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={vi.fn()}/>);
 expect(await screen.findByText('Grid export')).toBeInTheDocument();
 expect(screen.getByText('No data')).toBeInTheDocument();
 expect(screen.queryByText('Grid import')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Working normally'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'1/2 channels healthy'}));
 expect(screen.getByText('Grid import')).toBeInTheDocument();
});
it('never shows green when channel verification is unavailable',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({state:'receiving',generated_entities:[]}))));
 render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={vi.fn()}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Channel verification is not available yet');
 expect(screen.queryByRole('button',{name:'Working normally'})).not.toBeInTheDocument();
});
