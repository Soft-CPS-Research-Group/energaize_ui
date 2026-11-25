import {expect,it} from 'vitest';
import {cyclePoint,forecastPoints} from './HouseEnergy';
it('starts at Now inside a published period and preserves uncovered intervals and zero',()=>{
 const now=Date.parse('2026-11-23T02:05Z');
 const rows=forecastPoints([
  {lane:'solar',start:'2026-11-23T02:00Z',end:'2026-11-23T02:15Z',value:1.2},
  {lane:'solar',start:'2026-11-23T02:30Z',end:'2026-11-23T02:45Z',value:0}],now);
 expect(rows.map(r=>r.value)).toEqual([1.2,1.2,null,0,0]);
 expect(Date.parse(rows[0].timestamp)).toBe(now);
 expect(Date.parse(rows[3].timestamp)).toBe(Date.parse('2026-11-23T02:30Z'));
});

it('plots the OMIE price from the start of its cycle and keeps meter timestamps',()=>{
 const range={start:Date.parse('2026-11-25T21:59Z'),end:Date.parse('2026-11-25T22:10Z')};
 const cycle={at:'2026-11-25T22:01:00Z',price_at:'2026-11-25T22:00:00Z',price:0.195,
  grid_in:0.8,grid_out:0,load:null,solar:null,partial:[]};
 expect(cyclePoint(cycle,'price',range).timestamp).toBe('2026-11-25T22:00:00Z');
 expect(cyclePoint(cycle,'grid_in',range).timestamp).toBe(cycle.at);
});
