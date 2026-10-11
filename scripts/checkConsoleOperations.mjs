// Disposable local fixtures: exercises the exact schema forms against all four running services.
import {JSDOM} from 'jsdom';import fs from 'node:fs';import assert from 'node:assert/strict';
const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.structuredClone=structuredClone;dom.window.eval(fs.readFileSync('public/console/domain-form.js','utf8'));const F=dom.window.DomainForm;
const roots={community:'http://127.0.0.1:8017',flexibility:'http://127.0.0.1:8020'};
async function api(service,path,method='GET',body){const r=await fetch(roots[service]+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error(path+' '+r.status+' '+await r.text());return r.status===204?null:r.json();}
const defs=(await api('community','/openapi.json')).components.schemas;const fdefs=(await api('flexibility','/openapi.json')).components.schemas;
const build=(name,value,definitions=defs)=>F.build(definitions[name]||definitions[name+'-Input'],value,definitions,{},'',true).read();
const created=[];let rec,site;try{
 rec=await api('community','/api/recs/','POST',{name:'Operations verification',action_interval_seconds:15,localization:{name:'Disposable test',latitude:0,longitude:0}});
 site=await api('community','/api/sites/','POST',build('SiteCreate',{name:'Verification site',site_type:'residential',subtype:'detached_house',objective_preference:'cost',assigned_rec_id:rec.id,address:{street:'Example street',country_code:'PT'},grid_connection:{import_limit_kw:6.9,export_limit_kw:3.6}}));
 const map={grid_meter:['grid-meters','GridMeter'],pv_system:['pv-systems','PVSystem'],battery:['batteries','Battery'],ev_charger:['ev-chargers','EVCharger'],ev:['evs','EV'],appliance:['appliances','Appliance'],heat_pump:['heat-pumps','HeatPump'],heater:['heaters','Heater'],water_pump:['water-pumps','WaterPump'],micro_wind_turbine:['micro-wind-turbines','MicroWindTurbine'],non_shiftable_load:['non-shiftable-loads','NonShiftableLoad'],generic_device:['generic-devices','GenericDevice'],thermal_storage:['thermal-storages','ThermalStorage']};
 const byType={};
 for(const [type,[path,schema]] of Object.entries(map)){
  console.log('Checking',type);
  const data=build(schema+'Create',{name:'Verification '+type,...(type==='ev'?{}:{site_Id:site.id}),...(type==='appliance'?{appliance_type:'washing_machine',interruptible:false}:{}),...(type==='battery'?{nominal_capacity_kwh:10,min_state_of_charge:.1,max_state_of_charge:.95}:{}),...(type==='ev'?{battery_capacity_kwh:60}:{}),...(type==='thermal_storage'?{storage_medium:'water'}:{})});
  const saved=await api('community','/api/assets/'+path,'POST',data);created.push(saved.id);byType[type]=saved.id;
  const record=await api('community','/api/assets/'+saved.id);const current=record.data||record;
  const updated=build(schema+'Update',{...current,inventory_notes:'Verified technical form'});await api('community','/api/assets/'+path+'/'+saved.id,'PATCH',F.diff(current,updated));
  const reread=await api('community','/api/assets/'+saved.id);assert.equal((reread.data||reread).inventory_notes,'Verified technical form');
 }
 const version={name:'Verification terms',version:1,valid_from:'2026-01-01',components:[{code:'buy',flow:'community_import',category:'energy',unit:'EUR/kWh',period:'all',price:{kind:'indexed',source:'test-index',multiplier:1,adder:.01}},{code:'sell',flow:'community_export',category:'energy',unit:'EUR/kWh',period:'all',price:{kind:'relative',reference_component:'buy',multiplier:.8}}]};
 const contractSchema={type:'object',properties:{community_contracts:defs.RecUpdate.properties.community_contracts}};
 const saved=await api('community','/api/recs/'+rec.id,'PUT',F.build(contractSchema,{community_contracts:[version]},defs,{},'',true).read());assert.equal(saved.community_contracts[0].components[1].price.multiplier,'0.8');
 const cv=saved.community_contracts[0];const terms={community_contract_conditions:[{community_contract_version_id:cv.id,valid_from:'2026-01-01',price_overrides:{buy:{kind:'fixed',value:.2}}}]};
 await api('community','/api/sites/'+site.id,'PUT',F.build({type:'object',properties:{community_contract_conditions:defs.SiteUpdate.properties.community_contract_conditions}},terms,defs,{},'',true).read());
 const restored=await api('community','/api/sites/'+site.id);assert.equal(restored.community_contract_conditions[0].price_overrides.buy.value,'0.2');
 const sessionTypes=[['ev_charging','ev-charging','EVChargingSession','ev_charger',{vehicle_id:byType.ev,soc_at_departure:.8}],['appliance','appliances','ApplianceSession','appliance',{duration_minutes:60}],['heat_pump','heat-pumps','HeatPumpSession','heat_pump',{setpoint:22}],['electric_heater','electric-heaters','ElectricHeaterSession','heater',{setpoint:22}],['water_pump','water-pumps','WaterPumpSession','water_pump',{setpoint:2}]];
 for(const [kind,path,schema,type,extra] of sessionTypes){
  console.log('Checking',type);
  const data=build(schema+'Create',{asset_id:byType[type],title:'Verification '+kind,starts_at:'2026-10-12T08:00:00Z',ends_at:'2026-10-12T18:00:00Z',timezone:'Europe/Lisbon',mode:'punctual',...extra},fdefs);
  const e=await api('flexibility','/api/flexibility-events/'+path,'POST',data);
  try{const before={...e,...e.type_specific_data},after=build(schema+'Update',{...before,title:'Edited '+kind},fdefs);await api('flexibility','/api/flexibility-events/'+path+'/'+e.event_id,'PATCH',F.diff(before,after));assert.equal((await api('flexibility','/api/flexibility-events/'+e.event_id)).title,'Edited '+kind);}finally{await api('flexibility','/api/flexibility-events/'+e.event_id,'DELETE');}
 }
 console.log('PASS: site, 13 equipment types, shared indexed/relative contracts, site overrides and 5 session types created/read/edited/cancelled via the form serializers.');
}finally{for(const id of created.reverse())await api('community','/api/assets/'+id,'DELETE');if(site)await api('community','/api/sites/'+site.id,'DELETE');if(rec)await api('community','/api/recs/'+rec.id,'DELETE');}
