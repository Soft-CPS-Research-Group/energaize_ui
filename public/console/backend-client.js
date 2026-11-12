/* REST transport and boundary adapters. No mock fallback and no inferred readings. */
(function(root){
 const bases={community:'/community-api',access:'/access-api',telemetry:'/telemetry-api',flexibility:'/flexibility-api',measurements:'/measurement-api'};
 async function request(service,path,method='GET',body,signal){
  const response=await fetch(bases[service]+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:signal||AbortSignal.timeout(15000)});
  if(!response.ok){let data={};try{data=await response.json();}catch{}const detail=data.error?.message||data.detail;const error=Error(`${service}: ${typeof detail==='string'?detail:detail?JSON.stringify(detail):'Request failed ('+response.status+')'}`);error.status=response.status;error.code=data.error?.code;throw error;}
  return response.status===204?null:response.json();
 }
 const icons={grid_meter:['meter','bolt'],pv_system:['pv','sun'],battery:['battery','battery'],ev_charger:['charger','car'],ev:['ev','car']};
 function model(recs,sites,assets,profiles){
  const profileByAsset=new Map(profiles.map(p=>[p.asset_id,p]));
  return recs.map(r=>({recId:r.id,backendId:r.id,name:r.name,place:r.localization?.name||'',description:'',cadence:r.action_interval_seconds,manager:r.managing_entity?.name||'Not assigned',workbook:true,connected:true,sourcePayload:r,vehicles:[],sites:sites.filter(s=>s.assigned_rec_id===r.id).sort((a,b)=>(a.name||a.id).localeCompare(b.name||b.id)).map(s=>({id:s.id,backendId:s.id,name:s.name||'Unnamed site',type:s.site_type,subtype:s.subtype||'',icon:s.site_type==='residential'?'home':'building',power:null,pv:null,fresh:false,ready:false,algorithm:'Not connected',importLimit:s.grid_connection?.import_limit_kw??null,exportLimit:s.grid_connection?.export_limit_kw??null,workbook:true,connected:true,sourcePayload:s,assets:assets.filter(a=>a.asset_type!=='ev'&&(a.data.site_id||a.data.site_Id)===s.id).map(a=>{
   const p=profileByAsset.get(a.id),[kindKey,icon]=icons[a.asset_type]||['generic','grid'];
   const channels=(p?.capabilities||[]).map(c=>({...c,backendId:c.capability_id,assetId:a.id,assetName:a.data.name||a.asset_type,label:c.description||c.name,observation:null}));
   return {id:a.id,backendId:a.id,kindKey,assetType:a.asset_type,name:a.data.name||a.asset_type,kind:a.asset_type,icon,profileId:p?.profile_id,sourcePayload:a.data,specification:a.data,externalReferences:a.data.external_references||[],channels,primaryChannel:channels.find(c=>c.capability_type==='sensor')?.name,unit:channels[0]?.unit||'',quantity:channels[0]?.label||'Measurement',value:null,limit:'See specifications'};
  })}))}));
 }
 function measurementLink(site){const refs=site.sourcePayload?.external_references||[];return {community:refs.find(r=>r.system==='perceptor-community')?.identifier,site:refs.find(r=>r.system==='perceptor-site')?.identifier};}
 // Legacy observations are energy values. Preserve units: do not relabel kWh as kW.
 function historicalSeries(response,siteId){
  const items=response?.collections?.[siteId]?.items||[];
  const valid=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
  return items.map(item=>{const o=item.observations||{},meters=Object.values(o.grid_meters||{}),sum=key=>{const values=meters.map(m=>valid(m[key]));return values.length&&values.every(v=>v!==null)?values.reduce((a,b)=>a+b,0):null;};return {t:Date.parse(item.timestamp),import:sum('energy_in_total'),export:sum('energy_out_total'),solar:valid(o.solar_generation)};}).filter(p=>Number.isFinite(p.t)).sort((a,b)=>a.t-b.t);
 }
 function versioned(payload, original) {
  return {...payload, ...(typeof original?.version === 'string' ? {expected_version: original.version} : {})};
 }
 function versionQuery(original) { return typeof original?.version === 'string' ? '?expected_version='+encodeURIComponent(original.version) : ''; }
 function isConflict(error) { return error?.status === 409 || error?.code === 'resource.version_conflict'; }
 const conflictMessage = 'This change conflicts with the current data. Your edits are still here and have not been retried. Copy anything you want to keep, then discard these edits and reload before editing again.';
 root.ConsoleBackend={request,model,measurementLink,historicalSeries,versioned,versionQuery,isConflict,conflictMessage};
})(globalThis);
