/* The active console reads measurements exclusively through Telemetry. */
'use strict';
const T={exploreVersion:0,previewVersion:0,sources:[],fields:[],source:null,field:null,panels:new Map(),cache:new Map(),busy:new Set(),selection:new Map()};
const tApi=(path,method='GET',body)=>B.request('telemetry','/api/measurements'+path,method,body);
const sourcePath=s=>'/sources/'+encodeURIComponent(s.database)+'/'+encodeURIComponent(s.collection);
const tDate=value=>new Date(value).toLocaleString('en-GB');
function tPanel(channels,key){
 T.panels.set(key,channels);
 return `<section class="surface chart-section" data-telemetry-panel="${esc(key)}"><div class="sectionhead"><h2>Measurements</h2></div><div data-t-chart><p class="muted">Loading measurement workspace…</p></div></section>`;
}
const tRequest=(path,signal)=>B.request('telemetry','/api/measurements'+path,'GET',undefined,signal);
async function tUnbind(panel,cid){
 const asset=currentAssets().find(a=>(a.channels||[]).some(c=>c.backendId===cid));
 try{await checkPermission('asset',asset?.backendId||asset?.id);const channel=asset?.channels.find(c=>c.backendId===cid);if(channel?.simulation_binding)await B.request('community','/api/assets/'+asset.backendId+'/signals/'+cid,'PUT',{simulation_binding:null});else await tApi('/capabilities/'+cid+'/binding','DELETE');T.cache.clear();await loadBackend();toast('Measurement source unlinked.');}catch(err){toast(err.message);}
}
async function tConfigure(cid){
 const asset=currentAssets().find(a=>a.channels.some(c=>c.backendId===cid));
 if(!asset){toast('Equipment is not available in this site.');return;}
 try{await checkPermission('asset',asset.backendId||asset.id);inspectAsset(asset.id,asset.channels.find(c=>c.backendId===cid).name);}catch(e){toast(e.message);}
}
function tLoad(panel){
 if(!window.TelemetryCharts)return;
 const key=panel.dataset.telemetryPanel,channels=T.panels.get(key)||[];
 window.TelemetryCharts.mount(panel.querySelector('[data-t-chart]'),{
  request:tRequest,title:'Measurements',channels:channels.map(c=>({
   id:c.backendId,assetId:c.assetId,assetName:c.assetName,tag:c.tag,source:c.source,valueSemantics:c.value_semantics,enabled:c.enabled,sourceKind:c.source_kind,externalDeviceId:c.external_device_id,sourceField:c.source_field,simulated:!!c.simulation_binding,name:c.name,title:c.label||c.name,unit:c.canonical_unit||c.unit,
   endpoint:(c.mongo_binding||c.simulation_binding)?'/capabilities/'+c.backendId+'/series':undefined,
   latestEndpoint:(c.mongo_binding||c.simulation_binding)?'/capabilities/'+c.backendId+'/latest':undefined,
   note:c.simulation_binding?'Simulated signal generated locally; not a physical measurement.':c.mongo_binding?.note,expectedSeconds:c.sampling_interval_seconds
  })),onConfigureChannel:cid=>tConfigure(cid),onLinkChannel:cid=>tBind(panel,cid),onUnlinkChannel:cid=>tUnbind(panel,cid)
 },key);
}
window.addEventListener('telemetry-charts-ready',()=>{document.querySelectorAll('[data-telemetry-panel]').forEach(tLoad);if(document.getElementById('t-explorer-chart'))tPreview();});
async function tSources(){const data=await tApi('/sources');T.sources=data.sources.flatMap(d=>d.collections.map(collection=>({database:d.database,collection})));return T.sources;}
function tSourceOptions(){return T.sources.map((s,i)=>`<option value="${i}" ${T.source?.database===s.database&&T.source?.collection===s.collection?'selected':''}>${esc(s.database+' / '+s.collection)}</option>`).join('');}
async function tBind(panel,cid){
 const key=panel.dataset.telemetryPanel,c=(T.panels.get(key)||[]).find(c=>c.backendId===cid);if(!c)return;
 const asset=currentAssets().find(a=>(a.channels||[]).some(ch=>ch.backendId===c.backendId))||peopleCatalog().assets.find(a=>(a.channels||[]).some(ch=>ch.backendId===c.backendId));
 try{await checkPermission('asset',asset?.backendId||asset?.id);await tSources();}catch(e){toast(e.message);return;}
 T.source=c.mongo_binding?{database:c.mongo_binding.database,collection:c.mongo_binding.collection}:null;
 drawer('Link stored readings',`<p class="subtitle">${esc(asset?.name||'Equipment')} → ${esc(c.label||c.name)} · declared unit ${esc(c.unit)}. Confirm that the stored value uses this unit before linking. This links existing history. It does not configure or start collection by Percepta.</p><label class="formlabel">Stored site<select id="t-bind-source" name="source">${tSourceOptions()}</select></label><label class="formlabel">Stored field<select id="t-bind-field" name="field"></select></label>${field('Mapping note','note',c.mongo_binding?.note||'')}<p id="t-bind-status" role="status"></p>`,save(),async d=>{
  try{const s=T.sources[Number(d.get('source'))];await checkPermission('asset',asset?.backendId||asset?.id);await tApi('/capabilities/'+c.backendId+'/binding','PUT',{...s,field:d.get('field'),note:d.get('note')||null});T.cache.clear();await loadBackend();closeDrawer();toast('Measurement linked in Telemetry.');}catch(e){document.getElementById('t-bind-status').textContent=e.message;}
 });
 const load=async()=>{try{const s=T.sources[Number(document.getElementById('t-bind-source').value)],data=await tApi(sourcePath(s)+'/fields');document.getElementById('t-bind-field').innerHTML=data.fields.filter(f=>!f.field.endsWith('.generated')).map(f=>`<option value="${esc(f.field)}" ${f.field===c.mongo_binding?.field?'selected':''}>${esc(f.field)} · ${esc(f.value_type)}</option>`).join('');document.getElementById('t-bind-status').textContent=data.timestamp?'Latest stored observation: '+tDate(data.timestamp):'No stored observations';}catch(e){document.getElementById('t-bind-status').textContent=e.message;}};
 document.getElementById('t-bind-source').addEventListener('change',load);await load();
}
function tExplorer(){return `<div class="sectionhead"><div><div class="eyebrow">TELEMETRY</div><h1>Measurement explorer</h1><p class="subtitle">Stored source preview · these sources are not automatically assigned to community sites.</p></div><button class="btn" data-t-back>Back to community</button></div><section class="surface chart-section"><div class="actions" style="flex-wrap:wrap;margin-bottom:24px"><select id="t-source" aria-label="Stored source">${tSourceOptions()}</select><select id="t-field" aria-label="Stored measurement">${T.fields.filter(f=>['float','int'].includes(f.value_type)).map(f=>`<option value="${esc(f.field)}" ${T.field===f.field?'selected':''}>${esc(f.field)}</option>`).join('')}</select></div><div id="t-explorer-chart"></div></section>`;}
async function tExploreSource(){const version=++T.exploreVersion;try{T.source=T.sources[Number(document.getElementById('t-source')?.value||0)];if(!T.source)return;const data=await tApi(sourcePath(T.source)+'/fields');if(version!==T.exploreVersion)return;T.fields=data.fields;T.latest=data.timestamp;T.field=T.fields.find(f=>f.field.endsWith('energy_in_total'))?.field||T.fields.find(f=>['int','float'].includes(f.value_type))?.field;render();await tPreview();}catch(e){toast(e.message);}}
function tPreview(){
 const node=document.getElementById('t-explorer-chart');if(!node||!T.latest||!window.TelemetryCharts)return;
 T.field=document.getElementById('t-field').value;
 window.TelemetryCharts.mount(node,{request:tRequest,endpoint:sourcePath(T.source)+'/series?field='+encodeURIComponent(T.field),initialEnd:Date.parse(T.latest)+1,title:T.field.split('.').slice(-2).join(' · '),note:'Unmapped source preview · source units are not inferred. Link a field to a sensor only after confirming its meaning and unit.'},sourcePath(T.source)+':'+T.field);
}
// Replace legacy source fetches; both manager and resident graph components use Telemetry.
siteGraph=function(s){return tPanel(s.assets.flatMap(a=>a.channels.filter(c=>c.capability_type==='sensor')),'site:'+s.id);};
refreshHistory=async function(){};
const tOldEquipment=equipmentContent;
equipmentContent=function(){let html=tOldEquipment().replace(/<label class="metric-select">Measurement<select id="channel-series">[\s\S]*?<\/select><\/label>/,'');const a=currentAssets().find(a=>a.id===state.equipment);if(a&&state.deviceTab!=='sensors'){html=html.replace(/<div class="device-readout">[\s\S]*?<\/div><\/div>/,'');html=html.replace(/<section class="measurement-empty">[\s\S]*?<\/section>/,tPanel(a.channels.filter(c=>c.capability_type==='sensor'),'asset:'+a.id));}return html;};
const tOldSite=siteDetailOriginal;
siteDetailOriginal=function(){let html=tOldSite();if(state.tab==='summary'){html=html.replace(/<section class="measurement-empty">[\s\S]*?<\/section>/,siteGraph(chosen())).replace('No observations connected',chosen().assets.flatMap(a=>a.channels).filter(c=>c.mongo_binding||c.simulation_binding).length+' measurement sources linked').replace('DEMFLEX / Site',esc(comm().name)+' / Site');}return html;};
const tOldAdmin=admin;
admin=function(){return tOldAdmin()+`<section class="surface"><h2>Measurement sources</h2><p>Explore stored readings through the Telemetry API.</p><button class="btn" data-t-explore>Open measurement explorer</button></section>`;};
const tOldRender=render;
render=function(){tOldRender();if(connection.loading||connection.error||!state.loggedIn)return;if(person().role==='manager'&&state.page==='measurements'){document.querySelector('main.content').innerHTML=tExplorer();return;}document.querySelectorAll('[data-telemetry-panel]').forEach(p=>tLoad(p));};
document.addEventListener('click',async e=>{
 if(e.target.closest('[data-t-explore]')){try{await tSources();state.page='measurements';state.site=null;state.equipment=null;render();await tExploreSource();}catch(err){toast(err.message);}}
 if(e.target.closest('[data-t-preview]'))tPreview();
 if(e.target.closest('[data-t-back]')){state.page='overview';render();}
});
document.addEventListener('change',e=>{const p=e.target.closest('[data-telemetry-panel]');if(p&&e.target.matches('[data-t-channel]')){T.selection.set(p.dataset.telemetryPanel,p.querySelector('[data-t-channel]').value);tLoad(p);}if(e.target.id==='t-source')tExploreSource();if(e.target.id==='t-field')tPreview();});
