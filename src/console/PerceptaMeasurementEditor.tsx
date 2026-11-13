import {useState} from 'react';
import {isPriceSource,type Channel,type Connection,type Contract,type Owner,type Profile,type Source} from './perceptaSetupModel';
const labels:Record<string,string>={energy_in_total:'Grid import',energy_out_total:'Grid export',energy_in:'Energy imported',energy_out:'Energy exported',energy:'Solar energy',state_of_charge:'Battery charge',soc:'Vehicle charge',power:'Power',session_status:'Charging session',electric_vehicle:'Connected vehicle',flexibility:'Vehicle flexibility',price:'Electricity price',energy_price:'Electricity price',solar_generation:'Solar generation',non_shiftable_load:'Non-shiftable consumption',energy_consumption_prediction:'Consumption forecast',solar_energy_prediction:'Solar forecast'};
const available:Record<string,string[]>={grid_meter:['energy_in_total','energy_out_total',...['in','out'].flatMap(flow=>['l1','l2','l3'].map(phase=>'energy_'+flow+'_'+phase))],battery:['energy_in','energy_out','state_of_charge'],pv_panel:['energy'],pv_system:['energy'],solar_pv:['energy'],solar_panel:['energy'],ev_charger:['power','energy_in','session_status','electric_vehicle'],electric_vehicle:['soc','flexibility'],ev:['soc','flexibility']};
const forecasts:Record<string,string>={energy_consumption_prediction:'consumption',solar_energy_prediction:'production'};
export const measurementLabel=(parameter:string,assetType?:string)=>assetType==='ev_charger'&&parameter==='energy_in'?'Charging energy':labels[parameter]||parameter;
export const equipmentMeasurements=(assetType?:string)=>available[assetType||'']||['energy_in_total'];
const valueType=(p:string)=>p==='flexibility'?'object':['session_status','electric_vehicle'].includes(p)?'string':'float';
const shelly:Record<string,string>={energy_in_total:'total_act',energy_out_total:'total_act_ret',energy_in_l1:'a_total_act_energy',energy_in_l2:'b_total_act_energy',energy_in_l3:'c_total_act_energy',energy_out_l1:'a_total_act_ret_energy',energy_out_l2:'b_total_act_ret_energy',energy_out_l3:'c_total_act_ret_energy'};
export function PerceptaMeasurementEditor({channel,initialMeasurement,owner,profile,source,connections,forecastSourceIds,houseMeasurementKind,frequency,vehicles,onSave,onCancel,busy}:{channel?:Channel;initialMeasurement?:string;owner:Owner;profile:Profile|null;source:Source|null;connections:Connection[];forecastSourceIds?:string[];houseMeasurementKind?:'calculated'|'forecast';frequency:number;vehicles:Array<{id:string;name:string}>;onSave:(body:unknown)=>void;onCancel:()=>void;busy:boolean}){
 const provider=connections.find(c=>c.id===source?.connection_id)?.provider;
 const choices=owner.scope==='recs'?['energy_in_total','energy_out_total','price']:owner.scope==='sites'?houseMeasurementKind==='forecast'?Object.keys(forecasts):['solar_generation','non_shiftable_load']:equipmentMeasurements(profile?.asset_type);
 const forecastSources = connections.filter(c=>c.provider==='predictor'&&(!forecastSourceIds||forecastSourceIds.includes(c.id)||c.id===channel?.collection?.source_binding?.connection_id));
 const priceSources = connections.filter(c => isPriceSource(c.provider));
 const defaultPriceSource = priceSources.find(c => c.provider === 'omie') ?? priceSources[0];
 const priceBinding = (id: string, market = 'pt_spot_price') => {
   const native = priceSources.some(c => c.id === id && c.provider === 'omie');
   return {connection_id: id, match_key: native ? market : 'price', mapping_required: native};
 };
 const priceTiming = (native: boolean) => ({
   cumulative: false,
   periodicity: native ? {value: 15, unit: 'min'} : {value: frequency, unit: 'seconds'},
   aggregation_operation: 'mean',
   fill_operation: 'linear',
 });
 const make=(parameter:string):Contract=>{
  if(parameter==='price'||parameter==='energy_price')return {
    parameter_type_id: parameter, role: 'input', necessary: true, privacy: 'community',
    temporal_behavior: priceTiming(defaultPriceSource?.provider === 'omie'),
    source_binding: priceBinding(defaultPriceSource?.id ?? ''),
  };
  if(forecasts[parameter])return {parameter_type_id:parameter, role:'input', necessary:true, privacy:'private', source_binding:{connection_id:forecastSources[0]?.id||'',match_key:forecasts[parameter],source_measurement_unit:'kWh',mapping_required:true}};
  const output = owner.scope !== 'assets';
  const state = ['state_of_charge','soc','session_status','electric_vehicle','flexibility'].includes(parameter);
  const needsTemporal = provider !== 'pulsecharge' && !['session_status','electric_vehicle','flexibility'].includes(parameter);
  const temporal = {
    cumulative: parameter.startsWith('energy'),
    periodicity: {
      value: provider === 'cleanwatts_2' ? Math.max(60, Math.ceil(frequency / 60) * 60)
        : provider === 'cleanwatts' ? (state ? 60 : 300) : frequency,
      unit: 'seconds',
    },
    aggregation_operation: state ? 'last' : parameter === 'power' ? 'mean' : 'sum',
    fill_operation: 'linear',
  };
  const sourceUnit = state ? (parameter === 'session_status' ? 'Status' : '%') : parameter === 'power' ? 'kW' : 'kWh';
  return {
    parameter_type_id: parameter,
    role: output ? (owner.scope === 'recs' ? 'community_output' : 'site_output') : 'input',
    necessary: parameter !== 'session_status',
    privacy: owner.scope === 'recs' ? 'community' : 'private',
    ...(output ? {} : {
      ...(needsTemporal ? {temporal_behavior: temporal} : {}),
      source_binding: {
        connection_id: source?.connection_id || '',
        fetch_key: source?.device_id,
        match_key: provider === 'cleanwatts_2' ? shelly[parameter] : undefined,
        mapping_required: parameter !== 'electric_vehicle',
        ...(provider === 'cleanwatts_2' ? {shelly_accumulation: 'lifetime'} : {}),
        ...((provider === 'cleanwatts' || provider === 'pulsecharge') &&
          !['electric_vehicle','flexibility'].includes(parameter) ? {source_measurement_unit: sourceUnit as 'kWh'|'kW'|'%'|'Status'} : {}),
      },
    }),
  };
 };
 const parameter=channel?.collection?.parameter_type_id||initialMeasurement||(channel&&choices.includes(channel.name)?channel.name:choices[0]);
 const [contract,setContract]=useState<Contract>(()=>{const c=channel?.collection?structuredClone(channel.collection):make(parameter);if(source&&c.source_binding&&c.source_binding.connection_id!==source.connection_id&&!source.device_id){c.source_binding.fetch_key=null;c.source_binding.match_key=null;}if(source&&c.role==='input')c.source_binding={mapping_required:true,...c.source_binding,connection_id:source.connection_id,...(source.device_id?{fetch_key:source.device_id}:{})};return c;});
 const defaultUnit=(parameter:string)=>parameter==='price'||parameter==='energy_price'?(defaultPriceSource?.provider==='omie'?'EUR/kWh':'EUR/MWh'):parameter.includes('charge')||parameter==='soc'?(provider==='cleanwatts'||provider==='pulsecharge'?'ratio':'%'):parameter==='power'?'kW':parameter==='session_status'?'Status':['electric_vehicle','flexibility'].includes(parameter)?'':'kWh';
 const [name,setName]=useState(channel?.name||measurementLabel(parameter,profile?.asset_type)),[unit,setUnit]=useState(channel?.unit||defaultUnit(parameter));
 const [dataType,setDataType]=useState(channel?.data_type||valueType(parameter)),[enabled,setEnabled]=useState(true);
 const binding=contract.source_binding,chosenProvider=connections.find(c=>c.id===binding?.connection_id)?.provider;
 const forecast = !!forecasts[contract.parameter_type_id];
 const nativePrice=chosenProvider==='omie';
 const setBinding=(key:string,value:unknown)=>setContract({...contract,source_binding:{connection_id:binding?.connection_id||'',mapping_required:true,...binding,[key]:value}});
 return <form onSubmit={e=>{e.preventDefault();onSave({name,unit,data_type:dataType,enabled,collection:contract,capability_type:contract.role==='actuator'?'actuator':'sensor',...(!channel?{source_kind:contract.role.includes('output')?'derived':'physical'}:{})});}} className="percepta-channel-editor">
  <h4>{channel?.enabled?'Edit measurement':'Add measurement'}</h4><fieldset className="percepta-wizard-content" disabled={busy}><div className="percepta-fields">
  <label>Measurement<select disabled={!!initialMeasurement} value={contract.parameter_type_id} onChange={e=>{const p=e.target.value;setContract(make(p));setName(measurementLabel(p,profile?.asset_type));setUnit(defaultUnit(p));setDataType(valueType(p));}}>{[...new Set([...choices,contract.parameter_type_id])].map(p=><option key={p} value={p}>{measurementLabel(p,profile?.asset_type)}</option>)}</select></label>
  <label>Name<input required value={name} onChange={e=>setName(e.target.value)}/></label>
  </div>
  {contract.role==='input'&&(forecast?<label>Forecast source<select required value={binding?.connection_id||''} onChange={event=>setBinding('connection_id',event.target.value)}><option value="">Choose a forecast source</option>{forecastSources.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><small>Includes the forecast horizon in 15-minute intervals.</small></label>:owner.scope!=='assets'?<label>Price source<select required value={binding?.connection_id||''} onChange={event=>{
    const id = event.target.value;
    const next = priceBinding(id);
    if (binding && nativePrice === next.mapping_required) {
      setBinding('connection_id', id);
      return;
    }
    setContract({...contract, source_binding: next, temporal_behavior: priceTiming(next.mapping_required)});
    setUnit(next.mapping_required ? 'EUR/kWh' : 'EUR/MWh');
  }}><option value="">Choose a price source</option>{priceSources.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>:<p className="percepta-helper">Source: {connections.find(c=>c.id===binding?.connection_id)?.name||'Choose the equipment source first'}{source?.device_id?' · '+source.device_id:''}</p>)}
  {nativePrice&&<label>Market<select value={binding?.match_key||'pt_spot_price'} onChange={event=>setBinding('match_key',event.target.value)}><option value="pt_spot_price">Portugal</option><option value="es_spot_price">Spain</option></select><small>Day-ahead prices are supplied in 15-minute blocks.</small></label>}
  {contract.role==='input'&&chosenProvider==='cleanwatts'&&contract.parameter_type_id!=='electric_vehicle'&&<label>Measurement reference<input required value={binding?.fetch_key||''} onChange={e=>setBinding('fetch_key',e.target.value)}/><small>The tag supplied by Cleanwatts for this measurement.</small></label>}
  {contract.role==='input'&&chosenProvider==='pulsecharge'&&<label>Source user identifier<input required value={binding?.match_key||''} onChange={e=>setBinding('match_key',e.target.value)}/></label>}
  {chosenProvider==='cleanwatts'&&contract.parameter_type_id==='session_status'&&<p className="percepta-helper">Percepta uses the session reading to report the connected vehicle.</p>}
  {contract.parameter_type_id==='electric_vehicle'&&<label>Linked vehicle<select value={contract.vehicle_id||''} onChange={e=>setContract({...contract,vehicle_id:e.target.value||null})}><option value="">No fixed vehicle</option>{vehicles.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}
  {contract.role.includes('output')&&<p className="percepta-helper">Calculated by Percepta{owner.scope==='recs'?' for the whole community':''}. No source connection is needed.</p>}
  {owner.scope==='sites'&&contract.parameter_type_id==='non_shiftable_load'&&<p role="note" className="percepta-helper">This Percepta calculation currently omits solar generation. Its output needs validation before use.</p>}
  <details><summary>Advanced measurement settings</summary><div className="percepta-fields"><label>Unit<input value={unit} onChange={e=>setUnit(e.target.value)}/></label><label>Value type<select value={dataType} onChange={e=>setDataType(e.target.value)}>{['float','integer','boolean','string','object'].map(v=><option key={v}>{v}</option>)}</select></label><label>Technical parameter key<input value={contract.parameter_key||''} onChange={e=>setContract({...contract,parameter_key:e.target.value||null})}/></label><label>Privacy<select value={contract.privacy} onChange={e=>setContract({...contract,privacy:e.target.value})}>{['private','community','public'].map(v=><option key={v}>{v}</option>)}</select></label></div>
  {contract.role==='input'&&!nativePrice&&!forecast&&<div className="percepta-fields"><label>Field or match key<input value={binding?.match_key||''} onChange={e=>setBinding('match_key',e.target.value||null)}/></label><label>Topic<input value={binding?.topic||''} onChange={e=>setBinding('topic',e.target.value||null)}/></label></div>}
  {contract.role === 'input' && ['cleanwatts_2','cleanwatts','pulsecharge'].includes(chosenProvider||'') && !['electric_vehicle','flexibility'].includes(contract.parameter_type_id) && (
    <label>
      Unit reported by the device
      <select
        value={binding?.source_measurement_unit ?? ''}
        onChange={event => setBinding('source_measurement_unit', event.target.value || null)}
      >
        <option value="">Select a unit</option>
        {(chosenProvider==='cleanwatts_2'?['Wh','kWh']:['Wh','kWh','W','kW','%','ratio','Status']).map(value=><option key={value}>{value}</option>)}
      </select>
      <small>Required for the current Percepta format. The measurement unit above is the unit used after conversion.</small>
    </label>
  )}
  {contract.temporal_behavior&&!nativePrice&&!forecast&&<div className="percepta-fields"><label>Period<input type="number" required min="1" value={contract.temporal_behavior.periodicity.value} onChange={e=>setContract({...contract,temporal_behavior:{...contract.temporal_behavior!,periodicity:{...contract.temporal_behavior!.periodicity,value:Number(e.target.value)}}})}/></label><label>Time unit<select value={contract.temporal_behavior.periodicity.unit} onChange={e=>setContract({...contract,temporal_behavior:{...contract.temporal_behavior!,periodicity:{...contract.temporal_behavior!.periodicity,unit:e.target.value}}})}>{['seconds','min','hours'].map(v=><option key={v}>{v}</option>)}</select></label><label>Aggregation<select value={contract.temporal_behavior.aggregation_operation} onChange={e=>setContract({...contract,temporal_behavior:{...contract.temporal_behavior!,aggregation_operation:e.target.value}})}>{['sum','mean','last','min','max'].map(v=><option key={v}>{v}</option>)}</select></label><label>Fill missing periods<select value={contract.temporal_behavior.fill_operation} onChange={e=>setContract({...contract,temporal_behavior:{...contract.temporal_behavior!,fill_operation:e.target.value}})}>{['none','linear','ffill','zero'].map(v=><option key={v}>{v}</option>)}</select></label></div>}
  {contract.temporal_behavior&&!nativePrice&&!forecast&&<label className="percepta-check"><input type="checkbox" checked={contract.temporal_behavior.cumulative} onChange={e=>setContract({...contract,temporal_behavior:{...contract.temporal_behavior!,cumulative:e.target.checked}})}/>Accumulated quantity over the period</label>}
  {contract.role==='input'&&!nativePrice&&!forecast&&<label className="percepta-check"><input type="checkbox" checked={binding?.mapping_required??true} onChange={e=>setBinding('mapping_required',e.target.checked)}/>External mapping required</label>}
  <label className="percepta-check"><input type="checkbox" checked={contract.necessary} onChange={e=>setContract({...contract,necessary:e.target.checked})}/>Required measurement</label></details>
  <label className="percepta-check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Collect this measurement</label>
  <footer className="percepta-editor-actions"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={contract.role==='input'&&!binding?.connection_id}>Save measurement</button></footer></fieldset>
 </form>;
}
