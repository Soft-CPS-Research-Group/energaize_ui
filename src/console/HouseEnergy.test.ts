import {expect,it} from 'vitest';
import {forecastPoints,meanPower} from './HouseEnergy';

it('uses the recorded interval for mean power',()=>{
 const point={id:'a',timestamp:'2026-11-23T02:40:00Z',period_start:'2026-11-23T02:39:00Z',period_end:'2026-11-23T02:40:00Z',value:.03734};
 expect(meanPower(point).value).toBeCloseTo(2.2404);
 expect(meanPower({...point,period_start:undefined}).value).toBeNull();
});

it('compares forecast energy at the house cycle duration, preserving zeros and gaps',()=>{
 const p={parameter_type_id:'solar_energy_prediction',measurement_unit:'kWh',generated:false,final_values:[
  {period_start:'2026-11-23T02:00Z',period_end:'2026-11-23T02:15Z',value:.3},
  {period_start:'2026-11-23T02:30Z',period_end:'2026-11-23T02:45Z',value:0}]};
 const rows=forecastPoints([p],'solar',60,Date.parse('2026-11-23T02:00Z'));
 expect(rows.map(r=>r.value)).toEqual([.02,null,0]);
 expect(rows.map(r=>r.channelId)).toEqual(['solar','solar','solar']);
});
