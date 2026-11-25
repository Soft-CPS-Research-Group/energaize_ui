import {expect,it} from 'vitest';
import {cyclePoint,energyBuckets,forecastPoints} from './HouseEnergy';
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

it('derives a signed balance only from coincident import and export and keeps gap fills',()=>{
 const range={start:Date.parse('2026-11-25T22:00:00Z'),end:Date.parse('2026-11-25T23:00:00Z')};
 const reused={status:'reused' as const,at:'2026-11-25T21:45:00Z'};
 const cycle={at:'2026-11-25T22:01:00Z',interval_start:'2026-11-25T22:00:00Z',price:null,
  grid_in:2,grid_out:5,load:null,solar:null,partial:[],source_readings:{grid_out:reused}};
 expect(cyclePoint(cycle,'grid_net',range)).toMatchObject({value:-3,source:reused});
 expect(cyclePoint({...cycle,grid_out:null},'grid_net',range).value).toBeNull();
 expect(cyclePoint({...cycle,grid_out:0},'grid_net',range).value).toBe(2);
});

it('adds actual interval energy and leaves absent series out of each bar',()=>{
 const range={start:Date.parse('2026-11-25T22:00:00Z'),end:Date.parse('2026-11-25T22:03:00Z')};
 const row={price:null,grid_in:6,grid_out:3,load:null,solar:null,partial:[]};
 const data=energyBuckets([
  {...row,at:'2026-11-25T22:01:00Z',interval_start:'2026-11-25T22:00:00Z'},
  {...row,grid_in:12,grid_out:null,at:'2026-11-25T22:03:00Z',interval_start:'2026-11-25T22:01:00Z',
   source_readings:{grid_in:{status:'reused',at:null}}},
 ],['grid_in','grid_out','grid_net','solar'],range);
 expect(data.points.map(p=>p.channelId)).toEqual(['grid_in','grid_out','grid_net']);
 expect(data.points[0]).toMatchObject({value:0.5,source:{status:'reused'}});
 expect(data.points[1]).toMatchObject({value:-0.05,quality:'partial'});
 expect(data.period_total).toEqual({value:0.05,partial:true});
});
