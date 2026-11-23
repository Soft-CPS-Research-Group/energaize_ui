import {expect,it} from 'vitest';
import {forecastPoints} from './HouseEnergy';
it('starts at Now inside a published period and preserves uncovered intervals and zero',()=>{
 const now=Date.parse('2026-11-23T02:05Z');
 const rows=forecastPoints([
  {lane:'solar',start:'2026-11-23T02:00Z',end:'2026-11-23T02:15Z',value:1.2},
  {lane:'solar',start:'2026-11-23T02:30Z',end:'2026-11-23T02:45Z',value:0}],now);
 expect(rows.map(r=>r.value)).toEqual([1.2,1.2,null,0,0]);
 expect(Date.parse(rows[0].timestamp)).toBe(now);
 expect(Date.parse(rows[3].timestamp)).toBe(Date.parse('2026-11-23T02:30Z'));
});
