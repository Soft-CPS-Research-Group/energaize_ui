// Only synthetic Console Sandbox equipment is configured. Remote Mongo is read-only.
const community='http://127.0.0.1:8017',telemetry='http://127.0.0.1:8019';
if(!process.argv.includes('--apply'))throw Error('Use --apply to configure the local Console Sandbox.');
async function request(base,path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${await r.text()}`);return r.json();}
const rec=(await request(community,'/api/recs/')).find(r=>r.name==='Console Sandbox');if(!rec)throw Error('Run seed:console first.');
const site=(await request(community,'/api/sites/')).find(s=>s.assigned_rec_id===rec.id&&s.name==='Demo Home');if(!site)throw Error('Sandbox Demo Home not found.');
let assets=await request(community,'/api/assets/');
let battery=assets.find(a=>a.asset_type==='battery'&&(a.data.site_id||a.data.site_Id)===site.id&&a.data.name==='Battery');
if(!battery)battery=await request(community,'/api/assets/batteries','POST',{name:'Battery',site_id:site.id,capacity_kwh:10,max_charge_kw:3,max_discharge_kw:3,min_state_of_charge:.1,max_state_of_charge:.95});
let profile;
for(let i=0;i<15;i++){const r=await fetch(community+'/api/assets/'+battery.id+'/signals');if(r.ok){profile=await r.json();break;}await new Promise(r=>setTimeout(r,1000));}
if(!profile)throw Error('Battery catalogue not yet provisioned. Run this script again after delivery.');
const startAt=new Date(Date.now()-7*86400000);startAt.setUTCHours(0,0,0,0);
const specifications=[
 {name:'state_of_charge',description:'State of charge',unit:'%',quantity:'state_of_charge',value_semantics:'state',source:'battery-simulator',external_device_id:'battery-01',source_field:'state_of_charge',baseline:60,amplitude:20,period_seconds:7200},
 {name:'active_power',description:'Power',unit:'kW',quantity:'active_power',value_semantics:'instantaneous',source:'battery-simulator',external_device_id:'battery-01',source_field:'power',baseline:0,amplitude:2.5,period_seconds:3600},
 {name:'temperature',description:'Temperature',unit:'°C',quantity:'temperature',value_semantics:'instantaneous',source:'thermal-simulator',tag:'battery-01.temperature',baseline:25,amplitude:3,period_seconds:10800}
];
for(const {baseline,amplitude,period_seconds,...spec} of specifications){
 const existing=profile.capabilities.find(c=>c.name===spec.name);
 const body={...spec,tag:spec.tag||null,external_device_id:spec.external_device_id||null,source_field:spec.source_field||null,capability_type:'sensor',data_type:'float',source_kind:'simulated',sampling_interval_seconds:15,timestamp_semantics:'instant',enabled:true,mongo_binding:null,simulation_binding:{start_at:existing?.simulation_binding?.start_at||startAt.toISOString(),baseline,amplitude,period_seconds},source_note:'Sandbox: independent generated signals for configuration and chart testing; not a physical battery model.'};
 await request(community,`/api/assets/${battery.id}/signals${existing?'/'+existing.capability_id:''}`,existing?'PUT':'POST',body);
}
assets=await request(community,'/api/assets/');
const meter=assets.find(a=>a.asset_type==='grid_meter'&&a.data.site_id===site.id);
if(meter){const p=await request(community,`/api/assets/${meter.id}/signals`);const archive=p.capabilities.find(c=>['percepta_import_demo','grid_import_archive'].includes(c.name));if(archive)await request(community,`/api/assets/${meter.id}/signals/${archive.capability_id}`,'PUT',{name:'grid_import_archive',description:'Grid import',source_kind:'historical',source:'percepta-archive',external_device_id:'building_R-H-01/GR01',source_field:'observations.grid_meters.GR01.energy_in_total',enabled:false,mongo_binding:{...archive.mongo_binding,note:'Historical replay from R-H-01, not measurements from Demo Home. Source unit and interval/counter meaning remain unconfirmed.'}});}
for(const cap of (await request(community,`/api/assets/${battery.id}/signals`)).capabilities.filter(c=>c.simulation_binding)){
 const latest=await request(telemetry,`/api/measurements/capabilities/${cap.capability_id}/latest`);
 if(!latest.point?.generated||latest.source_kind!=='simulated')throw Error('Missing simulated provenance');
 console.log(`${cap.description}: ${latest.point.value} ${latest.unit} — simulated`);
}
console.log(`Configured Console Sandbox / Demo Home / Battery (${battery.id}). No Mongo data was written.`);
