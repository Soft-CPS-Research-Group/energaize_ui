/* Shared UI model: catalogue configuration is distinct from observations and topology. */
(function(root){
 const templates={
  meter:[['grid_import_energy','Grid import energy','kWh','energy_import','unknown',900],['grid_export_energy','Grid export energy','kWh','energy_export','unknown',900]],
  battery:[['state_of_charge','State of charge','%','state_of_charge','state',900],['charge_energy','Charged energy','kWh','charge_energy','unknown',900],['discharge_energy','Discharged energy','kWh','discharge_energy','unknown',900],['manual_mode','Manual control mode','code','manual_mode','command',null,'actuator'],['power_setpoint','Power setpoint','kW','active_power_setpoint','command',null,'actuator']],
  pv:[['generation_energy','Generated energy','kWh','energy_generation','unknown',null]],
  charger:[['charge_energy','Charging energy','kWh','charge_energy','unknown',null],['power_setpoint','Charging power setpoint','unknown','active_power_setpoint','command',null,'actuator']]
 };
 const fields=['source_kind','source_field','simulation_binding','mongo_binding','name','description','capability_type','unit','data_type','tag','source','external_device_id','quantity','value_semantics','sampling_interval_seconds','interval_note','phase','measurement_scope','timezone','timestamp_semantics','canonical_unit','scale','offset','sign_convention','enum_mapping','min_value','max_value','command_group','source_note','enabled'];
 function make(row){const [name,label,unit,quantity,semantics,interval,kind='sensor']=row;return {name,label,description:label,capability_type:kind,unit,quantity,value_semantics:semantics,sampling_interval_seconds:interval,tag:null,source:null,data_type:name==='manual_mode'?'integer':'float',timestamp_semantics:'unknown',enabled:false};}
 function channels(kind,existing=[]){const result=(templates[kind]||[]).map(make);for(const c of existing){const i=result.findIndex(x=>x.name===c.name);if(i>=0)result[i]={...result[i],...c,label:result[i].label};else result.push({...c,label:c.label||c.description||c.name});}return result;}
 function payload(c){return Object.fromEntries(fields.filter(k=>c[k]!==undefined).map(k=>[k,c[k]]));}
 function review(c){const notes=[];if((c.tag||c.external_device_id)&&c.unit==='unknown')notes.push('Source unit unconfirmed');if((c.tag||c.external_device_id)&&!c.source)notes.push('Data source missing');if((c.tag||c.external_device_id)&&c.value_semantics==='unknown')notes.push('Value meaning unconfirmed');if((c.tag||c.external_device_id)&&c.capability_type==='sensor'&&!c.sampling_interval_seconds)notes.push('Interval unconfirmed');if(c.capability_type==='actuator'&&c.tag&&!c.sign_convention&&!Object.keys(c.enum_mapping||{}).length)notes.push('Command definition unconfirmed');return notes;}
 function validation(c){if(!c.name.trim()||!c.unit.trim())return 'Name and source unit are required.';if(c.sampling_interval_seconds!=null&&(!Number.isInteger(c.sampling_interval_seconds)||c.sampling_interval_seconds<=0))return 'Interval must be a positive whole number.';if(c.enabled&&(!c.source||!(c.tag||(c.external_device_id&&c.source_field))))return 'An enabled channel needs a source and either a tag or a device reference with a field.';if(c.simulation_binding&&(!c.sampling_interval_seconds||c.simulation_binding.period_seconds%c.sampling_interval_seconds))return 'Simulation cycle must be a multiple of the sampling interval.';if(c.tag&&c.tag.length>255)return 'Tags cannot exceed 255 characters.';return null;}
 function topology(site){
  const meter=site.assets.find(a=>(a.kindKey||a.id)==='meter');
  const nodes=[{id:'grid',type:'utility_grid'},{id:site.id,type:'site'},...site.assets.map(a=>({id:a.backendId||a.id,type:'asset',assetType:a.assetType||a.id}))];
  const edges=[{from:'grid',to:meter?(meter.backendId||meter.id):site.id,direction:'bidirectional',import_limit_kw:site.importLimit??null,export_limit_kw:site.exportLimit??null}];
  if(meter)edges.push({from:meter.backendId||meter.id,to:site.id,direction:'bidirectional'});
  for(const a of site.assets.filter(a=>a!==meter)){const p=a.specification||{};edges.push({from:site.id,to:a.backendId||a.id,direction:(a.kindKey||a.id)==='pv'?'upstream':(a.kindKey||a.id)==='battery'?'bidirectional':'downstream',max_generation_kw:p.inverter_capacity_kw??null,max_charge_kw:p.max_charge_kw??p.max_charging_power??null,max_discharge_kw:p.max_discharge_kw??null});}
  return {kind:'conceptual_asset_connections',physical_wiring_verified:false,nodes,edges};
 }
 root.InventoryModel={templates,channels,payload,review,validation,topology};
})(globalThis);
