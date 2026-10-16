import {render,screen,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {ChargerActivity} from './ChargerActivity';
import type {MeasurementRequest} from './measurementData';
const start=Date.parse('2026-10-15T12:00:00Z');
const point=(seconds:number,vehicle:string|null)=>({id:String(seconds),timestamp:new Date(start+seconds*1000).toISOString(),vehicle_id:vehicle,association_known:true,generated:false,power_kw:0,soc:null,soc_generated:null,soc_unit:'unconfirmed'});
it('keeps a connection across live refreshes and fetches only an overlapping tail',async()=>{
 const request=vi.fn().mockResolvedValueOnce({samples:[point(0,'A'),point(15,'A'),point(30,'A')],previous:point(-15,null),expected_seconds:15})
  .mockResolvedValueOnce({samples:[point(15,'A'),point(30,'A'),point(45,null)],previous:point(0,'A'),expected_seconds:15});
 const {rerender,unmount}=render(<ChargerActivity endpoint="/charger/activity" request={request as MeasurementRequest} range={{start,end:start+45000}}/>);
 await waitFor(()=>expect(screen.getByText('A',{exact:true})).toBeInTheDocument());
 expect(screen.getByText('Not observed')).toBeInTheDocument();
 rerender(<ChargerActivity endpoint="/charger/activity" request={request as MeasurementRequest} range={{start:start+15000,end:start+60000}}/>);
 await waitFor(()=>expect(screen.queryByText('Not observed')).not.toBeInTheDocument());
 expect(request).toHaveBeenCalledTimes(2);
 const q=new URL(request.mock.calls[1][0],'http://local').searchParams;
 expect(Date.parse(q.get('from_ts')!)).toBe(start+15000);
 expect(screen.getByText('Already present / start unknown')).toBeInTheDocument();
 expect(screen.getByText(/Vehicle SoC is not available/)).toBeInTheDocument();
 const signal=request.mock.calls[1][1];unmount();expect(signal.aborted).toBe(true);
});
