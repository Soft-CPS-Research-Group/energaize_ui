import {fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PerceptaTelemetryStatus} from './PerceptaTelemetryStatus';
import type {RuntimeInstance} from '../api/runtimeApi';
const item={observed_state:'running',kind:'percepta',mode:'docker',health:'not_reported',applied_config_version:'version',desired_config_version:'version',last_checked_at:'2026-10-17T12:00:00Z'} as RuntimeInstance;
afterEach(()=>vi.unstubAllGlobals());
it('requires recent readings and an applied configuration for a healthy check',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({state:'receiving',last_received_at:'2026-10-17T12:00:00Z',generated_entities:[]}))));
 const check=vi.fn();
 render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={check}/>);
 expect(await screen.findByText('Healthy')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Check now'}));expect(check).toHaveBeenCalledOnce();
});
it('does not call fallback data healthy even when the service is running',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({state:'receiving',last_received_at:'2026-10-17T12:00:00Z',generated_entities:['meter']}))));
 render(<PerceptaTelemetryStatus siteId="site" item={item} onCheck={vi.fn()}/>);
 expect(await screen.findByText('Fallback readings present')).toBeInTheDocument();
 expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
});
