// Local, named Sandbox only. Demonstrates the connected forms and charts without touching Mongo.
const base='http://127.0.0.1:8017';
async function api(path,method='GET',body,port=8017){const r=await fetch(`http://127.0.0.1:${port}`+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error(path+' '+r.status+' '+await r.text());return r.status===204?null:r.json();}
if(!process.argv.includes('--apply')){console.log('Use --apply to configure explicitly simulated assets in the existing Console Sandbox.');process.exit(0);}
const rec=(await api('/api/recs/')).find(r=>r.name==='Console Sandbox');if(!rec)throw Error('Existing Console Sandbox required');
const site=(await api('/api/sites/')).find(s=>s.assigned_rec_id===rec.id&&s.name==='Demo Home');if(!site)throw Error('Existing Demo Home required');
let assets=await api('/api/assets/');
async function asset(type,path,name,data){let a=assets.find(a=>a.asset_type===type&&a.data.name===name&&(type==='ev'||(a.data.site_Id||a.data.site_id)===site.id));if(!a){const created=await api('/api/assets/'+path,'POST',{name,...data,...(type==='ev'?{}:{site_Id:site.id}),inventory_notes:'Console Sandbox fixture. Not installed physical equipment.'});assets=await api('/api/assets/');a=assets.find(a=>a.id===(created.id||created.asset_id))||assets.find(a=>a.data.name===name&&a.asset_type===type);}if(!a)throw Error('Asset creation not found');return a;}
const meter=assets.find(a=>a.asset_type==='grid_meter'&&(a.data.site_Id||a.data.site_id)===site.id);
const battery=assets.find(a=>a.asset_type==='battery'&&(a.data.site_Id||a.data.site_id)===site.id);
const pv=await asset('pv_system','pv-systems','Solar PV',{nominal_power_kw:3.6,inverter_capacity_kw:3.6,dc_peak_power_kwp:4});
const charger=await asset('ev_charger','ev-chargers','EV charger',{nominal_power_kw:7.4,max_charging_power:7.4,min_charging_power:1.4});
const washer=await asset('appliance','appliances','Washing machine',{appliance_type:'washing_machine',interruptible:false});
const ev=await asset('ev','evs','Demo EV',{battery_capacity_kwh:60,max_charging_power_kw:11});
const user=(await api('/api/users/')).find(u=>u.email==='prosumer@energaize.io');if(user&&!user.asset_ownerships.some(o=>o.energy_asset_id===ev.id))await api('/api/users/'+user.id+'/asset-ownerships','POST',{energy_asset_id:ev.id,ownership_type:'owned'});
await api('/api/access/reconcile','POST',undefined,8018);
let profiles=[];for(let attempt=0;attempt<20;attempt++){profiles=await api('/api/telemetry-profiles/','GET',undefined,8019);if([meter,battery,pv,charger,ev].every(a=>profiles.some(p=>p.asset_id===a.id)))break;await new Promise(r=>setTimeout(r,500));}
async function signal(a,name,description,unit,semantics,baseline,amplitude,interval=15){
 const profile=profiles.find(p=>p.asset_id===a.id);if(!profile)throw Error('Telemetry profile not ready for '+a.data.name);
 const existing=profile.capabilities.find(c=>c.name===name);const data={name,description,unit,capability_type:'sensor',data_type:'float',source_kind:'simulated',source:'console-sandbox',external_device_id:'sandbox-'+a.id,source_field:name,enabled:true,value_semantics:semantics,timestamp_semantics:'instant',sampling_interval_seconds:interval,simulation_binding:{start_at:new Date(Date.now()-7*86400000).toISOString(),baseline,amplitude,period_seconds:3600},mongo_binding:null};
 // Preserve an existing simulation's start so repeat runs don't shift the data.
 if(existing?.simulation_binding)data.simulation_binding.start_at=existing.simulation_binding.start_at;
 const saved=await api('/api/assets/'+a.id+'/signals'+(existing?'/'+existing.capability_id:''),existing?'PUT':'POST',data);return saved.capability_id;
}
const imported=await signal(meter,'sandbox_power_import','Grid import power','kW','instantaneous',3,.8);
const solar=await signal(pv,'sandbox_power','Solar power','kW','instantaneous',1.5,1.2);
const charge=await signal(charger,'sandbox_power','Charging power','kW','instantaneous',3.5,2);
await signal(ev,'sandbox_soc','State of charge','%','state',60,15);
const price=await signal(meter,'sandbox_price','Community price reference','EUR/kWh','instantaneous',.15,.04,900);
const batteryPower=profiles.find(p=>p.asset_id===battery.id).capabilities.find(c=>c.simulation_binding&&(c.canonical_unit||c.unit)==='kW').capability_id;
const contract={id:rec.community_contracts.find(c=>c.name==='Sandbox variable tariff')?.id||crypto.randomUUID(),name:'Sandbox variable tariff',version:1,valid_from:'2026-01-01',currency:'EUR',tariff_option:'single',components:[{code:'community_buy',flow:'community_import',category:'energy',unit:'EUR/kWh',period:'all',price:{kind:'indexed',source:'sandbox-community-price',multiplier:1,adder:0}},{code:'community_sell',flow:'community_export',category:'energy',unit:'EUR/kWh',period:'all',price:{kind:'relative',reference_component:'community_buy',multiplier:.8}}]};
const groups=[{key:'grid_import',name:'Grid import',capability_ids:[imported]},{key:'solar',name:'Solar production',capability_ids:[solar]},{key:'battery_power',name:'Battery power',capability_ids:[batteryPower]},{key:'ev_charging',name:'EV charging',capability_ids:[charge]}];
await api('/api/recs/'+rec.id,'PUT',{measurement_groups:[...(rec.measurement_groups||[]).filter(g=>!groups.some(n=>n.key===g.key)),...groups],price_sources:{...rec.price_sources,'sandbox-community-price':price},community_contracts:[...rec.community_contracts.filter(c=>c.name!=='Sandbox variable tariff'),contract]});
console.log('Sandbox ready: power totals, variable prices (member sales at 80%), PV, charger, appliance and owned EV. All new readings are explicitly simulated.');
