import {describe,it,expect} from 'vitest';
import {observedSessions,type ChargerObservation} from './chargerObservations';
const start=Date.parse('2026-10-15T12:00:00Z');
const sample=(seconds:number,vehicle:string|null,power=0,generated=false):ChargerObservation=>({id:String(seconds),timestamp:new Date(start+seconds*1000).toISOString(),vehicle_id:vehicle,association_known:true,power_kw:power,generated,soc:null,soc_generated:null,soc_unit:'unconfirmed'});
describe('Observed charger sessions',()=>{
 it('does not call zero power a disconnection and preserves charging/discharging peaks',()=>{
  const result=observedSessions([sample(0,'A',4),sample(15,'A',0),sample(30,'A',-2),sample(45,null)],sample(-15,null));
  expect(result).toHaveLength(1);expect(result[0]).toMatchObject({arrival:start,departure:start+45000,peakCharge:4,peakDischarge:2});
 });
 it('does not invent an arrival at the window boundary',()=>{
  expect(observedSessions([sample(0,'A')],sample(-15,'A'))[0].arrival).toBeNull();
  expect(observedSessions([sample(0,'A')],null)[0].arrival).toBeNull();
 });
 it('breaks connections at missing data rather than inventing departure times',()=>{
  const result=observedSessions([sample(0,'A'),sample(120,null)],null);
  expect(result[0]).toMatchObject({gap:true,departure:null});
 });
 it('records vehicle changes separately and retains source-generated status',()=>{
  const result=observedSessions([sample(0,'A',0,true),sample(15,'B')],sample(-15,null));
  expect(result).toHaveLength(2);expect(result[0].generated).toBe(true);expect(result[0].departure).toBe(start+15000);expect(result[1].arrival).toBe(start+15000);
 });
});

it('marks a departure inferred from a generated observation',()=>{
 const result=observedSessions([sample(0,'A'),sample(15,null,0,true)],sample(-15,'A'));
 expect(result[0].generated).toBe(true);
});
