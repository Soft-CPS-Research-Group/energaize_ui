import {expect,it} from 'vitest';
import {archiveValues} from './HouseEnergy';

it('uses actual period length for power and keeps missing measurements out of the cumulative import',()=>{
 const sample={id:'a',timestamp:'2026-11-23T02:40:00Z',period_start:'2026-11-23T02:39:00Z',period_end:'2026-11-23T02:40:00Z',value:.03734};
 expect(archiveValues([sample],'power',900)[0].value).toBeCloseTo(2.2404);
 const result=archiveValues([sample,{...sample,id:'b',timestamp:'2026-11-23T02:41:00Z',value:null},{...sample,id:'c',timestamp:'2026-11-23T02:42:00Z',value:0}],'cumulative',60);
 expect(result.map(r=>r.value)).toEqual([.03734,null,.03734]);
 expect(result[2].quality).toBe('partial_coverage');
});
