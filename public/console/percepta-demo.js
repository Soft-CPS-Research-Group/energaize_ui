/* Demo adapter: domain inventory supplies source bindings; Telemetry supplies all readings.
   Visual thesis: retain the ceramic workspace and make live/history the primary working surface.
   Content: community exchange, site curves, prices; equipment detail with observed charging activity.
   Interaction: existing time controls and pills, site selection, sliding 15-second live window. */
'use strict';
function perceptaSource(site) {
 const ref=site?.sourcePayload?.external_references?.find(r=>r.system==='percepta-mongo');
 if(!ref)return null;const parts=ref.identifier.split('/');
 return parts.length===2?{database:parts[0],collection:parts[1]}:null;
}
function perceptaChartChannels(channels,assetType){
 const linked=channels.filter(c=>c.enabled&&(c.mongo_binding||c.simulation_binding));
 const meters=linked.filter(c=>/^energy_(in|out)_total$/.test(c.collection?.parameter_type_id||'')||/^observations\.grid_meters\.[^.]+\.energy_(in|out)_total$/.test(c.mongo_binding?.field||''));
 const defaults=new Set((meters.length?meters:linked.filter(c=>(c.collection?.parameter_type_id||c.name)==='state_of_charge')).map(c=>c.backendId));
 return linked.map(c=>{
  const result={...channelForChart(c),defaultVisible:defaults.has(c.backendId)};
  const kind=c.collection?.parameter_type_id||c.quantity||c.name;
  if(c.mongo_binding?.field?.startsWith('payload.entities.')){
   const names={energy_in_total:'Grid import',energy_out_total:'Grid export',state_of_charge:'State of charge',...(assetType==='battery'?{energy_in:'Charge energy',energy_out:'Discharge energy'}:{}),...(assetType==='pv_system'?{energy:'Solar production'}:{})};
   result.title=names[kind]||result.title;
   result.unit=c.mongo_binding.value_unit||result.unit;
  }
  if(c.mongo_binding?.database==='living_lab'&&c.mongo_binding.field.startsWith('observations.grid_meters.')&&c.unit==='kWh'){
   result.unit='kW';result.displayScale=240;result.title=result.title.replace(' energy','').replace(/^Energy in l(\d)$/,'Import · phase $1').replace(/^Energy out l(\d)$/,'Export · phase $1');
   result.note='Estimated mean power: interval energy × 240. Percepta proportionally trims upstream one-minute energy to a 15-second output window.';
  }
  return result;
 });
}
function perceptaPath(source){return '/percepta/'+encodeURIComponent(source.database)+'/'+encodeURIComponent(source.collection);}
function matisseDemoSites(){const sites=scoped();return sites.filter(s=>perceptaSource(s));}
function matisseDemo(){const keys=matisseDemoSites().map(s=>perceptaSource(s).collection).sort();return keys.join('|')===['building_i-charging_headquarters_3Phase','building_R-H-01','building_R-H-02','building_R-H-03','building_R-H-04'].sort().join('|');}
function perceptaCommunityChannels(){
 return [['import','Grid import'],['export','Grid export']].map(([direction,title])=>({id:'matisse-power:'+direction,title,unit:'kW',expectedSeconds:15,defaultVisible:true,sourceKind:'derived',incremental:false,endpoint:'/percepta/matisse/power/'+direction+'/series',latestEndpoint:'/percepta/matisse/power/'+direction+'/latest',note:'Estimated mean power from the RH meters’ harmonized 15-second energy intervals. HQ is excluded until its meter unit is verified.'}));
}
const perceptaPreviousCommunityViews=communityMeasurementViews;
communityMeasurementViews=function(){
 if(!matisseDemo())return perceptaPreviousCommunityViews();
 const view=state.communityChartView==='prices'?'prices':'totals';
 const tabs=[['totals','Community'],['prices','Prices']];let items=[],note='';
 if(view==='totals'){
  items=perceptaCommunityChannels();note='Grid exchange · RH01–RH04 · HQ meter awaiting verification';
 }else{
  const hq=matisseDemoSites().find(s=>perceptaSource(s).collection==='building_i-charging_headquarters_3Phase'),base=perceptaPath(perceptaSource(hq))+'/prices';
  items=[{id:'percepta-price',title:'OMIE',unit:'EUR/kWh',expectedSeconds:15,endpoint:base+'/series',latestEndpoint:base+'/latest',forecastEndpoint:base+'/forecast',curve:'stepAfter',sourceKind:'derived'}];
 }
 return `<nav class="tabs" aria-label="Community measurements">${tabs.map(([key,label])=>`<button class="${view===key?'active':''}" data-community-chart-view="${key}">${label}</button>`).join('')}</nav>`+cChart('Community measurements',items,'percepta:'+comm().recId+':'+view,note);
};
// Open only on the first visit; the user's show/hide choice always wins afterwards.
const perceptaOpened=new Set();
function perceptaOpenOnce(key){if(!perceptaOpened.has(key)){perceptaOpened.add(key);ceramicCharts.add(key);}}
const perceptaOverview=overview;
overview=function(){if(matisseDemo())perceptaOpenOnce('community:'+comm().recId);return perceptaOverview();};
const perceptaSiteGraph=siteGraph;
siteGraph=function(site){
 const assets=ceramicAssets(site);
 const selected=ceramicSelection.get(site.id);
 const equipment=assets.filter(a=>a.id===selected||selected==='group:'+ceramicAssetType(a));
 if(equipment.length){
  const key='site:'+site.id;
  const channels=equipment.flatMap(a=>(a.channels||[]).filter(c=>c.capability_type==='sensor'&&c.enabled));
  const panelKey=equipment.length===1?'asset:'+equipment[0].id:'group:'+site.id+':'+selected;
  const label=equipment.length===1?equipment[0].name:ceramicGroupLabel(ceramicAssetType(equipment[0]));
  return ceramicSiteScene(site)+ceramicChartToggle(key,'Energy data · '+label)+(ceramicCharts.has(key)?'<div class="ceramic-chart-content">'+tPanel(channels,panelKey)+'</div>':'');
 }
 const archived=assets.flatMap(a=>a.channels||[]).filter(c=>c.enabled && c.mongo_binding?.field?.startsWith('payload.entities.') && (!c.mongo_binding.percepta_site_id||c.mongo_binding.percepta_site_id===site.id));
 const first=archived[0]?.mongo_binding;
 if(first && archived.every(c=>c.mongo_binding.database===first.database && c.mongo_binding.collection===first.collection)){
  const meters=siteGridChannels({...site,assets}).filter(c=>c.enabled && c.mongo_binding);
  const meter=type=>{const matches=meters.filter(c=>(c.collection?.parameter_type_id||c.quantity)===type);return matches.length===1?matches[0].backendId:undefined;};
  const key='site:'+site.id;
  const archive={site:site.id,database:first.database,collection:first.collection,meter:meter('energy_in_total'),exportMeter:meter('energy_out_total'),
   hasSolar:assets.some(a=>['pv_system','solar_pv','pv_panel','solar_panel'].includes(ceramicAssetType(a)))};
  return ceramicSiteScene(site)+ceramicChartToggle(key,'Energy data')+(ceramicCharts.has(key)?`<div class="ceramic-chart-content" data-house-energy="${esc(JSON.stringify(archive))}"></div>`:'');
 }
 if(!perceptaSource(site))return perceptaSiteGraph(site);
 const key='site:'+site.id;perceptaOpenOnce(key);
 const channels=siteGridChannels(site).filter(c=>c.mongo_binding?.field?.startsWith('payload.')||(/^observations\.grid_meters\.[^.]+\.energy_(in|out)_total$/.test(c.mongo_binding?.field||'')&&c.unit==='kWh'));
 return ceramicSiteScene(site)+ceramicChartToggle(key,'Site grid exchange')+(ceramicCharts.has(key)?(channels.length?tPanel(channels,key):'<div class="percepta-grid-unavailable"><h3>Site grid measurements unavailable</h3><p>Open an equipment item to see its own readings.</p></div>'):'');
};
function perceptaChargerActivity(asset){
 if(!asset||asset.assetType!=='ev_charger')return undefined;
 const c=asset.channels.find(c=>{
  const field=c.mongo_binding?.field||'';
  return c.enabled&&(/^observations\.charging_sessions\.[^.]+\.power$/.test(field)||(
   /^(payload|model_inputs)\.entities\.[^.]+\.parameters\./.test(field)
   &&(c.collection?.parameter_type_id||c.quantity)==='power'));
 });
 if(!c)return undefined;
 if(asset.backendId)return '/assets/'+encodeURIComponent(asset.backendId)+'/charger-activity';
 const parts=c.mongo_binding.field.split('.');
 return perceptaPath(c.mongo_binding)+'/chargers/'+encodeURIComponent(parts[2])+'/activity';
}
// Attach activity to the same chart time controls used for charging power.
const perceptaLoad=tLoad;
tLoad=function(panel){
 const key=panel.dataset.telemetryPanel,channels=T.panels.get(key)||[];
 const asset=key.startsWith('asset:')?currentAssets().find(a=>a.id===key.slice(6)):null;
 const activityEndpoint=perceptaChargerActivity(asset);
 const site=key.startsWith('site:')?scoped().find(s=>s.id===key.slice(5)):chosen();
 const battery=asset?.assetType==='battery'&&asset.backendId
  ? channels.filter(c=>c.enabled && c.mongo_binding?.field?.startsWith('payload.entities.')
    && ['state_of_charge','energy_in','energy_out'].includes(c.collection?.parameter_type_id||c.quantity||c.name)) : [];
 if(battery.length){
  const order=['state_of_charge','energy_in','energy_out'];
  const mapped=perceptaChartChannels(battery,'battery').map(c=>{
   const source=battery.find(row=>row.backendId===c.id);
   const batteryLane=source.collection?.parameter_type_id||source.quantity||source.name;
   return {...c,batteryLane,unit:batteryLane==='state_of_charge'?'%':'kWh',defaultVisible:true};
  }).sort((a,b)=>order.indexOf(a.batteryLane)-order.indexOf(b.batteryLane));
  window.TelemetryCharts.mount(panel.querySelector('[data-t-chart]'),{
   request:tRequest,title:'Battery',channels:mapped,batteryEndpoint:'/assets/'+encodeURIComponent(asset.backendId)+'/battery-window',
   initialDurationMs:21600000,startLive:true,compactHeader:true,dashedGapFills:true,showChannelConfiguration:false
  },key);
  return;
 }
 if(!activityEndpoint&&!perceptaSource(site)&&!channels.some(c=>c.mongo_binding?.field?.startsWith('payload.entities.'))){perceptaLoad(panel);return;}
 window.TelemetryCharts.mount(panel.querySelector('[data-t-chart]'),{request:tRequest,title:asset?.name||site?.name||'Measurements',showChannelConfiguration:false,activityEndpoint,compactHeader:true,initialDurationMs:21600000,startLive:channels.some(c=>c.mongo_binding?.field?.startsWith('payload.entities.')),
  channels:perceptaChartChannels(channels,asset?.assetType),onConfigureChannel:cid=>tConfigure(cid),onLinkChannel:cid=>tBind(panel,cid),onUnlinkChannel:cid=>tUnbind(panel,cid)},key);
};

// Describe the linked collection configuration without claiming a managed deployment.
const perceptaSiteDetail=siteDetailOriginal;
siteDetailOriginal=function(){
 const html=perceptaSiteDetail(),site=chosen(),source=perceptaSource(site);
 if(state.tab!=='percepta'||!source)return html;
 const assets=ceramicAssets(site),channels=assets.flatMap(a=>a.channels).filter(c=>c.enabled&&c.mongo_binding);
 const groups=ceramicGroups(assets);
 const steps=[['network','Connected sources','Equipment readings'],['cpu','Percepta','Processing & alignment'],['database','MongoDB','History & latest values'],['chart','Telemetry','Charts & applications']];
 const panel=`<section class="percepta-connected"><header><span class="percepta-connection-mark">${icon('network')}</span><div><span class="ceramic-kicker">DATA COLLECTION</span><h2>Percepta</h2><p>Configured source for ${esc(site.name)}</p></div><span class="percepta-configured"><i></i>Source linked</span></header><div class="percepta-flow">${steps.map(([symbol,name,caption])=>`<div>${icon(symbol)}<strong>${name}</strong><small>${caption}</small></div>`).join('')}</div><dl class="percepta-configuration"><div><dt>Update interval</dt><dd>15 seconds</dd></div><div><dt>Equipment</dt><dd>${assets.length}</dd></div><div><dt>Linked channels</dt><dd>${channels.length}</dd></div><div><dt>Measurement access</dt><dd>Telemetry API</dd></div></dl><div class="percepta-equipment-summary">${groups.map(g=>`<div>${ceramicArt(ceramicAssetIcon(g.items[0]))}<span><strong>${esc(ceramicGroupLabel(g.type))}</strong><small>${g.items.length} equipment · ${g.items.reduce((n,a)=>n+a.channels.filter(c=>c.enabled&&c.mongo_binding).length,0)} linked channels</small></span></div>`).join('')}</div><details><summary>Source details</summary><p>${esc(source.database)} / ${esc(source.collection)}</p><p>Existing collector connection. Runtime deployment management is configured separately.</p></details></section>`;
 return html.replace(/<div data-runtime-site="[^"]+"[^>]*><\/div>/,panel);
};
