/* One inventory status vocabulary across overview, sites and equipment. */
'use strict';
const technicalChecklist={
 battery:['capacity_kwh','max_charge_kw','max_discharge_kw','min_state_of_charge','max_state_of_charge'],
 pv_system:['inverter_capacity_kw','dc_peak_power_kwp'],ev:['battery_capacity_kwh','max_charging_power_kw'],
 ev_charger:['max_charging_power','plugs'],heat_pump:['nominal_power_kw','coefficient_of_performance','supported_modes'],
 heater:['nominal_power_kw','efficiency'],water_pump:['nominal_power_kw','pump_efficiency'],
 micro_wind_turbine:['rated_power_kw','power_curve'],thermal_storage:['capacity_kwh','loss_per_hour'],
 non_shiftable_load:['consumption_unit','coverage'],appliance:['appliance_type'],generic_device:['device_category'],grid_meter:['meter_role']
};
const hasDefinition=v=>v!==null&&v!==undefined&&v!==''&&(!Array.isArray(v)||v.length>0);
function channelConfiguration(c){
 const missing=[],local=!!c.simulation_binding,stored=!!c.mongo_binding;
 if(!local&&!stored){
  if(!c.source)missing.push('Source');
  if(!(c.tag||(c.external_device_id&&c.source_field)))missing.push('Tag or device reference + field');
 }
 if(!c.unit||c.unit==='unknown')missing.push('Unit');
 if(!c.value_semantics||c.value_semantics==='unknown')missing.push('Value meaning');
 if(c.capability_type==='sensor'&&!c.sampling_interval_seconds)missing.push('Sampling interval');
 if(c.capability_type==='actuator'&&!c.sign_convention&&!Object.keys(c.enum_mapping||{}).length)missing.push('Command definition');
 const configured=!!(local||stored||c.source||c.tag||c.external_device_id);
 return {tone:!missing.length?'complete':configured?'partial':'empty',missing};
}
function equipmentConfiguration(a){
 const data=a.sourcePayload||a.specification||{},fields=technicalChecklist[a.assetType||a.asset_type]||[];
 const missing=fields.filter(k=>!hasDefinition(data[k])).map(k=>DomainForm.label(k));
 const channels=(a.channels||[]).filter(c=>c.configuration_status!=='template'||c.enabled||c.tag||c.external_device_id||c.mongo_binding||c.simulation_binding);
 for(const c of channels){const review=channelConfiguration(c);if(review.missing.length)missing.push((c.label||c.description||c.name)+': '+review.missing.join(', '));}
 if(!channels.length)missing.push('Configure measurement or control channels');
 const populated=fields.some(k=>hasDefinition(data[k]))||(a.channels||[]).some(c=>channelConfiguration(c).tone!=='empty');
 return {tone:!missing.length?'complete':populated?'partial':'empty',missing};
}
function siteConfiguration(s){
 const assets=s.assets||[],reviews=assets.map(equipmentConfiguration),missing=[];
 if(!assets.length)missing.push('No equipment registered');
 for(let i=0;i<assets.length;i++)if(reviews[i].missing.length)missing.push(assets[i].name+': '+reviews[i].missing.slice(0,3).join('; ')+(reviews[i].missing.length>3?' · '+(reviews[i].missing.length-3)+' more items in Equipment':''));
 return {tone:!missing.length?'complete':reviews.some(r=>r.tone!=='empty')?'partial':'empty',missing};
}
function configurationDot(review,label='Configuration'){
 const text=review.tone==='complete'?'Configuration complete':review.tone==='empty'?'Not configured':'Information missing';
 const detail=text+(review.missing.length?'\n'+review.missing.join('\n'):'\nInventory and channel definitions are filled in. This does not confirm live data or control readiness.');
 return `<span class="configuration-dot is-${review.tone}" role="img" tabindex="0" aria-label="${esc(label+': '+detail)}" title="${esc(detail)}"><i aria-hidden="true"></i></span>`;
}
siteIssues=s=>siteConfiguration(s).missing.length;
siteRows=function(list){return list.map(s=>`<tr class="action-row" data-site="${esc(s.id)}" tabindex="0" aria-label="Open ${esc(s.name)}"><td><span class="namebtn"><span class="square">${icon(s.icon)}</span><span>${esc(s.name)}<small>${esc(s.type)} · ${s.assets.length} equipment</small></span></span></td><td>${configurationDot(siteConfiguration(s),s.name)}</td><td>${status(s.assets.flatMap(a=>a.channels||[]).some(c=>c.mongo_binding||c.simulation_binding)?'Sources linked':'No source linked','unknown')}</td><td>${esc(s.algorithm)}</td></tr>`).join('');};
siteTable=function(list){return `<div class="tablewrap"><table><thead><tr><th>Site</th><th>Status</th><th>Latest data</th><th>Control</th></tr></thead><tbody>${siteRows(list)||'<tr><td colspan="4" class="empty">No sites match your search.</td></tr>'}</tbody></table></div>`;};
filteredSites=function(){return siteTable(scoped().filter(s=>s.name.toLowerCase().includes(state.search.toLowerCase())&&(state.filter==='all'||state.filter==='warnings'&&siteConfiguration(s).tone!=='complete'||state.filter==='complete'&&siteConfiguration(s).tone==='complete')));};
healthSection=function(){
 const list=scoped(),counts={complete:0,partial:0,empty:0};for(const s of list)counts[siteConfiguration(s).tone]++;
 return `<section class="community-health"><header><div><h2>Community health</h2><p>Inventory and channel configuration</p></div><button class="btn text" data-page="sites">View inventory ${icon('arrow')}</button></header><div class="health-summary">${[['complete','Complete'],['partial','Missing information'],['empty','Not configured']].map(([tone,label])=>`<div><span class="health-count">${counts[tone]}</span><span><i class="health-dot is-${tone}"></i>${label}</span></div>`).join('')}</div>${list.length?`<div class="health-site-list">${list.map(s=>`<button data-site="${esc(s.id)}"><span class="health-site-name">${icon(s.icon)}${esc(s.name)}</span>${configurationDot(siteConfiguration(s),s.name)}</button>`).join('')}</div>`:'<p class="muted">Add a site to start configuring your community.</p>'}</section>`;
};
assetTable=function(){return `<div class="sectionhead"><h2>Equipment</h2>${person().role==='manager'||P.sitePermission(person(),chosen()?.id,'manage')?button('Add equipment','add-asset','plus'):''}</div><div class="tablewrap"><table><thead><tr><th>Equipment</th><th title="One channel per measured quantity or command">Channels</th><th title="External collection references; several channels can share one tag">Tags</th><th>Status</th></tr></thead><tbody>${currentAssets().map(a=>`<tr class="action-row" data-asset="${esc(a.id)}" tabindex="0" aria-label="Open ${esc(a.name)}"><td><span class="namebtn"><span class="square">${icon(a.icon)}</span>${esc(a.name)}</span></td><td>${a.channels.length}</td><td>${new Set(a.channels.map(c=>c.tag).filter(Boolean)).size}</td><td>${configurationDot(equipmentConfiguration(a),a.name)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No equipment installed yet.</td></tr>'}</tbody></table></div>`;};
// Replace each channel's status cell independently, retaining its settings action.
channelTable=function(a){return ['sensor','actuator'].map(kind=>{const channels=a.channels.filter(c=>c.capability_type===kind);return channels.length?`<section class="channels-section"><div class="sectionhead"><h2>${kind==='sensor'?'Measurement channels':'Control channels'}</h2><span class="muted">${channels.length} channels</span></div><div class="tablewrap"><table><thead><tr><th>Channel</th><th>Collection reference</th><th>Unit</th><th>Interval</th><th>Status</th></tr></thead><tbody>${channels.map(c=>`<tr class="action-row" data-channel-edit="${esc(c.name)}" tabindex="0" aria-label="Configure ${esc(c.label||c.name)}"><td><strong>${esc(c.label||c.name)}</strong></td><td class="tag-value">${esc(c.tag||c.external_device_id||'—')}${c.source_field?`<small>${esc(c.source_field)}</small>`:''}</td><td>${esc(c.unit||'—')}</td><td>${kind==='sensor'?intervalLabel(c.sampling_interval_seconds):'—'}</td><td>${configurationDot(channelConfiguration(c),c.label||c.name)}</td></tr>`).join('')}</tbody></table></div></section>`:'';}).join('');};
function communitySettingsView(){
 const c=comm(),p=c.sourcePayload||{},contracts=p.community_contracts||[];
 return title('Community settings','Community identity, operating interval and shared tariff rules.')+`<section class="settings-section"><div><h2>General</h2><p>Name, location and managing entity.</p></div><div><dl class="definition-list"><div><dt>Name</dt><dd>${esc(c.name)}</dd></div><div><dt>Location</dt><dd>${esc(c.place||'Not set')}</dd></div><div><dt>Managing entity</dt><dd>${esc(c.manager)}</dd></div><div><dt>Control interval</dt><dd>${intervalLabel(c.cadence)}</dd></div></dl><button class="btn" data-action="edit-community-details">Edit community</button></div></section><section class="settings-section"><div><h2>Community tariff</h2><p>Shared prices and rules. Site-specific exceptions stay in each site's settings.</p></div><div>${contracts.map(v=>`<div class="record"><div><strong>${esc(v.name)} · v${v.version}</strong><small>${esc(v.valid_from)} — ${esc(v.valid_until||'Open ended')} · ${v.components.length} price components</small></div></div>`).join('')||'<p class="muted">No community tariff configured.</p>'}<button class="btn" data-action="contracts">Edit community tariff</button></div></section>`;
}
const refinementAction=action;
action=function(key){if(key==='community-settings'){state.page='settings';state.operationsPage=null;state.site=null;state.equipment=null;render();return;}if(key==='edit-community-details'){structuredEditor({title:'Community settings',schema:'RecUpdate',value:comm().sourcePayload,order:['name','localization','description','managing_entity','activity_period','action_interval_seconds'],requiredFields:['name'],omit:['community_contracts','measurement_groups','price_series'],method:'PUT',path:'/api/recs/'+comm().recId,permission:['rec',comm().recId],intro:'Community identity, location, managing entity and activity dates.'});return;}refinementAction(key);};
function siteSettingsSummary(s){
 const p=s.sourcePayload||{},address=p.address||{},location=p.location||{},grid=p.grid_connection||{};
 const rows=[['Name',s.name],['Type',s.type],['Subtype',s.subtype],['Address',[address.street,address.postal_code,address.city,address.country_code].filter(Boolean).join(', ')],['Location',location.latitude!=null&&location.longitude!=null?location.latitude+', '+location.longitude:null],['Timezone',p.timezone],['CPE',grid.cpe],['Electrical phases',grid.phase_type],['Import limit',s.importLimit!=null?s.importLimit+' kW':null],['Export limit',s.exportLimit!=null?s.exportLimit+' kW':null],['Contracted power',p.supply_survey?.contracted_power_kva!=null?p.supply_survey.contracted_power_kva+' kVA':null]];
 return '<h2>Site configuration</h2><dl class="definition-list">'+rows.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value||'Not set')}</dd></div>`).join('')+'</dl>';
}
const refinementSite=siteDetailOriginal;
siteDetailOriginal=function(){let html=refinementSite();if(state.tab==='settings')html=html.replace(/<h2>Site configuration<\/h2><dl class="definition-list">[\s\S]*?<\/dl>/,siteSettingsSummary(chosen())).replace('Comparison contracts</button>','Comparison contract</button>').replace('Community conditions</button>','Site tariff overrides</button>').replace('<div class="actions"><button class="btn" data-action="site-contracts">','<p class="footnote">Comparison contract: your external supplier terms, used only for comparison. Site tariff overrides: exceptions to the community tariff; leave empty to inherit the shared rules.</p><div class="actions"><button class="btn" data-action="site-contracts">');return html;};
const refinementRender=render;
render=function(){refinementRender();if(connection.loading||connection.error||!state.loggedIn)return;document.querySelectorAll('.topbar-nav [data-page="insights"],.topbar-nav [data-op-page="contracts"]').forEach(n=>n.remove());if(person().role==='manager'&&state.page==='settings'){document.querySelector('main.content').innerHTML=communitySettingsView();document.querySelectorAll('.topbar-nav .is-active').forEach(n=>n.classList.remove('is-active'));}};
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('tr.action-row')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});

// Residents use the same row-sized targets without broadening their resource scope.
const refinementPersonalAssets=personalAssetsTable;
personalAssetsTable=function(assets){let html=refinementPersonalAssets(assets);return html.replace(/<tr><td><button class="namebtn" data-personal-asset="([^"]+)"/g,'<tr class="action-row" data-personal-asset="$1" tabindex="0"><td><button class="namebtn" data-personal-asset="$1"');};

const refinementTree=tree;
tree=function(){return refinementTree().replace(/(<button data-site="([^"]+)"[^>]*>[\s\S]*?)<i class="dot[^"]*"><\/i>/g,(all,start,id)=>{const site=scoped().find(s=>s.id===id);return site?start+`<i class="dot is-${siteConfiguration(site).tone}"></i>`:all;});};
