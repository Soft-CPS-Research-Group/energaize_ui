/* Guided community administration; API payloads retain the existing domain model. */
'use strict';
function managementDialog(label,steps,onSave){
 centralDrawer(label,steps.map(([name,body])=>`<section class="management-step" data-management-step><h3>${esc(name)}</h3>${body}</section>`).join(''),save(),data=>saveRemote(()=>onSave(data)));
 stageForm(steps.map(s=>s[0]),[...overlay.querySelectorAll('[data-management-step]')].map(n=>[n]));
}
const managementNumber=(d,key)=>d.get(key)===''?null:Number(d.get(key));
function editCommunitySimple(){
 const c=comm(),p=c.sourcePayload,l=p.localization||{};
 managementDialog('Edit community',[
 ['Identity',field('Community name','name',p.name)+optionalField('Description','description',p.description,'text','maxlength="2000"')+optionalField('Managing entity','manager',p.managing_entity?.name)],
 ['Location',field('Location name','place',l.name)+`<div class="formcolumns">${field('Latitude','lat',l.latitude,'number','min="-90" max="90"')}${field('Longitude','lon',l.longitude,'number','min="-180" max="180"')}</div>`+field('Timezone','timezone',p.timezone||'Europe/Lisbon')],
 ['Operation',`<p class="subtitle">How often the community controller makes a decision.</p><div class="interval-choices">${[1,5,10,15,30,60,300,900,1800,3600].map(n=>`<label><input type="radio" name="interval" value="${n}" ${n===p.action_interval_seconds?'checked':''} required><span>${intervalLabel(n)}</span></label>`).join('')}</div><div class="formcolumns">${optionalField('Import limit (kW)','import_limit',p.power_limit_import?.megawatts==null?'':p.power_limit_import.megawatts*1000,'number','min="0" step="any"')}${optionalField('Export limit (kW)','export_limit',p.power_limit_export?.megawatts==null?'':p.power_limit_export.megawatts*1000,'number','min="0" step="any"')}</div><div class="formcolumns">${optionalField('Active from','from',p.active_from,'date')}${optionalField('Active until','until',p.active_until,'date')}</div>`]
 ],async d=>{
 await checkPermission('rec',c.recId);
 await B.request('community','/api/recs/'+c.recId,'PUT',{name:d.get('name').trim(),description:d.get('description')||null,localization:{...l,name:d.get('place'),latitude:Number(d.get('lat')),longitude:Number(d.get('lon'))},timezone:d.get('timezone'),managing_entity:d.get('manager').trim()?{...p.managing_entity,name:d.get('manager').trim()}:null,action_interval_seconds:Number(d.get('interval')),power_limit_import:d.get('import_limit')===''?null:{megawatts:Number(d.get('import_limit'))/1000},power_limit_export:d.get('export_limit')===''?null:{megawatts:Number(d.get('export_limit'))/1000},active_from:d.get('from')||null,active_until:d.get('until')||null});
 });
}
const detailedContractEditor=contractEditor;
function basicContractVersion(versions){return [...versions].sort((a,b)=>a.valid_from.localeCompare(b.valid_from)).at(-1);}
function contractComponent(code,flow,price,unit='EUR/kWh'){return {code,flow,category:flow==='standing'?'fee':'energy',unit,period:'all',price};}
contractEditor=async function(scope='community'){
 if(scope==='conditions')return detailedContractEditor(scope);
 const community=scope==='community',c=comm(),s=community?null:chosen(),record=community?c.sourcePayload:s.sourcePayload,key=community?'community_contracts':'reference_contracts',versions=record[key]||[],v=basicContractVersion(versions);
 // Keep the detailed editor for models that cannot be represented losslessly here.
 const energy=v?.components.find(x=>x.flow===(community?'community_import':'grid_import')&&x.category==='energy');
 if(v&&(v.tariff_option!=='single'||(energy&&energy.price.kind!==(community?'indexed':'fixed'))||(community&&energy&&(Number(energy.price.multiplier??1)!==1||Number(energy.price.adder??0)!==0||energy.price.floor!=null||energy.price.cap!=null))))return detailedContractEditor(scope);
 const priceChannels=communityChannels().filter(ch=>(ch.canonical_unit||ch.unit)==='EUR/kWh'&&ch.capability_type==='sensor');
 const source=energy?.price.source||'community_price',selected=c.sourcePayload.price_sources?.[source];
 const extra=(v?.components||[]).filter(x=>x.flow==='standing'&&x.price.kind==='fixed');
 const existingSale=v?.components.find(x=>x.flow==='community_export'&&x.category==='energy');
 const priceStep=community?`<p class="subtitle">Use the price stream collected by Percepta. Values arrive in EUR/kWh, normally every 15 minutes.</p><label class="formlabel">Price channel<select name="channel" required><option value="">Choose a price channel</option>${priceChannels.map(ch=>`<option value="${esc(ch.backendId)}" ${ch.backendId===selected?'selected':''}>${esc(ch.siteName+' · '+ch.assetName+' · '+ch.label)}</option>`).join('')}</select></label>${priceChannels.length?'':'<p class="notice">Add an EUR/kWh measurement channel to an equipment item first. It can later be connected to Percepta.</p>'}<p class="subtitle">Member purchases follow this stream. Member sales receive a percentage of the same price.</p>${field('Member sale (% of price)','sale',existingSale?.price.kind==='relative'?Number(existingSale.price.multiplier)*100:80,'number','min="0" max="100"')}`:
 `<p class="subtitle">The supplier contract this home would have outside the community. Used only as the comparison reference.</p><div class="formcolumns">${field('Energy price (EUR/kWh)','energy',energy?.price.value??'','number','min="0"')}${optionalField('Contracted power (kVA)','power',v?.contracted_power_kva,'number','min="0.01" step="any"')}</div>`;
 managementDialog(community?'Community price':'Comparison contract',[
 ['Contract',field('Contract name','name',v?.name||(community?'Community price':'Comparison contract'))+optionalField('Supplier','supplier',v?.supplier)+`<div class="formcolumns">${field('Valid from','from',v?.valid_from||new Date().toISOString().slice(0,10),'date')}${optionalField('Valid until','until',v?.valid_until,'date')}</div>`],
 [community?'Price stream':'Energy & power',priceStep],
 ...(community?[]:[['Fixed charges',`<p class="subtitle">Standing charges and extras, separate from the energy price.</p><div id="simple-charges">${extra.map((x,i)=>chargeRow(x,i)).join('')}</div><button class="btn" type="button" data-charge-add>Add a fixed charge</button>`]])
 ],async d=>{
  await checkPermission(community?'rec':'site',community?c.recId:s.id);
  const base={...(v||{}),name:d.get('name'),supplier:d.get('supplier')||null,version:v?.version||1,valid_from:d.get('from'),valid_until:d.get('until')||null,tariff_option:'single'};
  let components=[...(v?.components||[])],patch={};
  const replace=(old,next)=>{if(old)components=components.map(x=>x.code===old.code?next:x);else components.push(next);};
  if(community){
   const channel=priceChannels.find(ch=>ch.backendId===d.get('channel'));if(!channel)throw Error('Choose a price channel.');
   const buy={...(energy||contractComponent('community_buy','community_import',{})),price:{kind:'indexed',source,multiplier:1,adder:0}};
   replace(energy,buy);replace(existingSale,{...(existingSale||contractComponent('community_sell','community_export',{})),price:{kind:'relative',reference_component:buy.code,multiplier:Number(d.get('sale'))/100}});
   patch.price_sources={...(c.sourcePayload.price_sources||{}),[source]:channel.backendId};
  }else{
   base.contracted_power_kva=managementNumber(d,'power');replace(energy,{...(energy||contractComponent('reference_energy','grid_import',{})),price:{kind:'fixed',value:Number(d.get('energy'))}});
   const rows=[...overlay.querySelectorAll('[data-charge-row]')];
   components=components.filter(x=>!extra.some(e=>e.code===x.code));
   rows.forEach((row,i)=>{const get=n=>row.querySelector(`[name="${n}"]`).value;const old=extra[Number(row.dataset.chargeRow)];let code=old?.code||'fixed_charge_'+i;while(components.some(c=>c.code===code))code+='_extra';components.push({...contractComponent(code,'standing',{}),...old,code,unit:get('charge_unit_'+row.dataset.chargeRow),price:{kind:'fixed',value:Number(get('charge_value_'+row.dataset.chargeRow))}});});
  }
  base.components=components;patch[key]=v?versions.map(x=>x.id===v.id?base:x):[base];
  await B.request('community','/api/'+(community?'recs/'+c.recId:'sites/'+s.id),'PUT',patch);
 });
 const add=overlay.querySelector('[data-charge-add]');let index=extra.length;
 add?.addEventListener('click',()=>overlay.querySelector('#simple-charges').insertAdjacentHTML('beforeend',chargeRow(null,index++)));
};
function chargeRow(c,i){return `<div class="formcolumns charge-row" data-charge-row="${i}">${field(c?.code?.replaceAll('_',' ')||'Fixed charge','charge_value_'+i,c?.price.value??'','number','min="0"')}<label class="formlabel">Unit<select name="charge_unit_${i}">${['EUR/day','EUR/month','EUR/kVA/day'].map(unit=>`<option ${unit===c?.unit?'selected':''}>${unit}</option>`).join('')}</select></label><button type="button" class="btn" data-charge-remove aria-label="Remove charge">${icon('x')}</button></div>`;}
const managementAction=action;
action=function(key){if(key==='edit-community-details'){editCommunitySimple();return;}managementAction(key);};
document.addEventListener('click',e=>{e.target.closest('[data-charge-remove]')?.closest('[data-charge-row]')?.remove();});
const previousEditProfile=editProfile;
editProfile=function(id){
 if(id)return previousEditProfile(id);
 if(person().role!=='manager')return;
 const c=comm(),sites=scoped();let created=null;
 managementDialog('Create resident account',[
 ['Person',field('Full name','name','')+field('Email','email','','email')+field('Timezone','timezone',c.sourcePayload.timezone||'Europe/Lisbon')],
 ['Homes',`<p class="subtitle">The resident can manage equipment in these homes. Vehicles keep their own ownership association.</p><div class="home-access-options">${sites.map(s=>`<label><input type="checkbox" name="home" value="${esc(s.id)}">${productArt(siteIllustration(s.type))}<span>${esc(s.name)}</span></label>`).join('')}</div>${sites.length?'':'<p>No sites in this community yet. You can associate homes later.</p>'}`],
 ['Access',`<p>This account uses the existing test sign-in. Share these instructions with the resident after saving.</p><dl class="definition-list"><div><dt>Login</dt><dd>The email entered above</dd></div><div><dt>Test password</dt><dd><code>pros123</code></dd></div></dl><p class="subtitle">Personal passwords and invitation codes are not enabled yet.</p>`]
 ],async d=>{
  await checkPermission('rec',c.recId);
  if(!created){
   const selected=d.getAll('home');if(selected.some(id=>!sites.some(s=>s.id===id)))throw Error('Choose homes in this community.');
   created=await B.request('community','/api/users/','POST',{name:d.get('name').trim(),email:d.get('email').trim(),timezone:d.get('timezone'),password:'Console-demo-2026',rec_memberships:[{rec_id:c.recId,member_type:'member',membership_status:'active'}],site_accesses:selected.map(site_id=>({site_id,relation:'owner',validity_start:new Date().toISOString().slice(0,10),validity_end:'2099-12-31'}))});
  }
  try{await B.request('access','/api/access/reconcile','POST');}catch(e){throw Error('Account created. Access synchronisation failed; save again to retry without creating another account.');}
 });
};
const reviewLabels={algorithm:'Algorithm configuration',percepta:'Percepta configuration',other_integrations:'Other integrations'};
const configurationWork={rows:[],error:null};
async function refreshConfigurationWork(){
 if(person().role!=='manager')return;
 try{configurationWork.rows=await B.request('community','/api/configuration-reviews');configurationWork.error=null;}
 catch(e){configurationWork.error='Configuration reviews are unavailable.';}
}
const managementLoad=loadBackend;
loadBackend=async function(){await managementLoad();await refreshConfigurationWork();render();};
function currentConfigurationWork(){return configurationWork.rows.filter(r=>r.rec_id===comm().recId&&(state.page!=='sites'||!state.site||r.site_id===state.site));}
const managementRender=render;
render=function(){managementRender();if(connection.loading||connection.error||!state.loggedIn||person().role!=='manager'||state.page==='communities')return;
 const pending=currentConfigurationWork().filter(r=>r.status==='pending');
 const actions=document.querySelector('.community-identity .identity-actions,.sitehead .identity-actions');
 if(actions&&!actions.querySelector('[data-config-work]'))actions.insertAdjacentHTML('afterbegin',`<button class="configuration-work-button ${pending.length?'has-pending':''}" data-config-work title="${configurationWork.error||'Configuration changes'}" aria-label="Configuration changes${pending.length?' · '+pending.length+' pending':''}">${icon('settings')}${pending.length?`<span>${pending.length}</span>`:''}</button>`);
 const administration=document.querySelector('.surface.settings');
 if(administration&&!administration.querySelector('[data-config-work]'))administration.insertAdjacentHTML('beforeend',`<div class="settingsrow"><div><h3>Configuration reviews</h3><p>${configurationWork.error||`${pending.length} changes awaiting confirmation. Review the algorithm, Percepta and other integrations.`}</p></div><button class="btn" data-config-work>Review changes</button></div>`);
 const runtime=document.querySelector('[data-runtime-site]');
 if(runtime&&pending.length)runtime.insertAdjacentHTML('beforebegin',`<div class="configuration-work-banner"><strong>Inventory review pending</strong><span>${pending.length} changes await review across the connected services.</span><button class="btn" data-config-work>Review changes</button></div>`);
};
async function showConfigurationWork(){
 await refreshConfigurationWork();const rows=currentConfigurationWork();
 centralDrawer('Configuration changes',`<p class="subtitle">Inventory changes require review of the algorithm, Percepta and other integrations. Each confirmation is recorded; it does not deploy anything.</p>${configurationWork.error?`<p role="alert">${esc(configurationWork.error)}</p>`:''}<div class="configuration-work-list">${rows.map(r=>`<article><header><div><h3>${esc(r.resource_name)}</h3><p>${esc(r.reason.replaceAll('_',' '))} · ${esc(new Date(r.created_at).toLocaleString('en-GB'))}</p></div><span class="badge">${r.status==='resolved'?'Resolved':'Needs review'}</span></header>${Object.entries(reviewLabels).map(([key,label])=>`<div class="configuration-task"><span><strong>${label}</strong>${r.resolutions[key]?`<small>${esc(r.resolutions[key].note)}</small><small>${esc(r.resolutions[key].actor)} · ${esc(new Date(r.resolutions[key].resolved_at).toLocaleString('en-GB'))} · Manual confirmation</small>`:'<small>Prepare and review the updated configuration.</small>'}</span>${r.resolutions[key]?icon('check'):`<button class="btn" type="button" data-resolve-review="${r.id}" data-review-target="${key}">Resolve</button>`}</div>`).join('')}</article>`).join('')||'<p>No inventory changes awaiting review.</p>'}</div>`);
}
function resolveConfigurationWork(id,target){
 const item=configurationWork.rows.find(r=>r.id===id);if(!item||!reviewLabels[target])return;
 managementDialog('Resolve '+reviewLabels[target],[['Confirmation',`<p>${esc(item.resource_name)} · ${esc(item.reason.replaceAll('_',' '))}</p><p class="subtitle">Confirm what was regenerated or reviewed. For unaffected integrations, explain why no change was needed.</p><label class="formlabel">Resolution note<textarea name="note" required minlength="5" maxlength="2000" rows="4"></textarea></label>${optionalField('Configuration version or reference','reference','')}`]],async d=>{
 await checkPermission('rec',item.rec_id);
 await B.request('community','/api/configuration-reviews/'+id+'/resolve','POST',{target,actor:person().email,note:d.get('note').trim(),reference:d.get('reference')||null});
 });
}
document.addEventListener('click',e=>{
 if(person().role!=='manager')return;
 if(e.target.closest('[data-config-work]'))showConfigurationWork().catch(e=>toast(e.message));
 const r=e.target.closest('[data-resolve-review]');if(r)resolveConfigurationWork(r.dataset.resolveReview,r.dataset.reviewTarget);
});
