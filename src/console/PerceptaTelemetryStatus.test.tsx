import {act,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PerceptaTelemetryStatus} from './PerceptaTelemetryStatus';
import type {RuntimeInstance} from '../api/runtimeApi';
const item={observed_state:'running',kind:'percepta',mode:'docker',health:'not_reported',applied_config_version:'version',desired_config_version:'version',last_checked_at:'2026-10-17T12:00:00Z'} as RuntimeInstance;
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('requires recent readings and an applied configuration for a healthy check',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({state:'receiving',last_received_at:'2026-10-17T12:00:00Z',generated_entities:[]}))));
 const check=vi.fn();
 render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={check}/>);
 expect(await screen.findByText('Working normally')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Check now'}));expect(check).toHaveBeenCalledOnce();
});
it('does not call fallback data healthy even when the service is running',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({state:'receiving',last_received_at:'2026-10-17T12:00:00Z',generated_entities:['meter']}))));
 render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={vi.fn()}/>);
 expect(await screen.findByText('Fallback readings present')).toBeInTheDocument();
 expect(screen.queryByText('Working normally')).not.toBeInTheDocument();
});

it('automatically alerts when readings become stale and clears the warning when they recover',async()=>{
 vi.useFakeTimers();
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({state:'receiving',generated_entities:[]})))
  .mockResolvedValueOnce(new Response(JSON.stringify({state:'stale',generated_entities:[]})))
  .mockResolvedValueOnce(new Response(JSON.stringify({state:'receiving',generated_entities:[]})));
 vi.stubGlobal('fetch',fetcher);
 render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={vi.fn()}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(screen.getByText('Working normally')).toBeInTheDocument();
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
 expect(screen.getByRole('alert')).toHaveTextContent('Readings have stopped arriving');
 expect(screen.queryByText('Working normally')).not.toBeInTheDocument();
 await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
 expect(screen.getByText('Working normally')).toBeInTheDocument();
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('does not keep a healthy indication when service monitoring fails',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({state:'receiving',generated_entities:[]}))));
 const {rerender}=render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={vi.fn()}/>);
 expect(await screen.findByText('Working normally')).toBeInTheDocument();
 rerender(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={vi.fn()} monitoringError="Offline"/>);
 expect(screen.getByRole('alert')).toHaveTextContent('The service status could not be refreshed.');
 expect(screen.queryByText('Working normally')).not.toBeInTheDocument();
});
it('explains an unapplied configuration even with recent readings',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({state:'receiving',generated_entities:[]}))));
 render(<PerceptaTelemetryStatus siteId="site" item={{...item,desired_config_version:'new'}} onCheck={vi.fn()}/>);
 expect(await screen.findByText('Receiving data')).toBeInTheDocument();
 expect(screen.getByRole('alert')).toHaveTextContent('The latest configuration has not been confirmed as applied.');
 expect(screen.queryByText('Working normally')).not.toBeInTheDocument();
});
