/* Equipment creation uses the API schema inside a central, staged dialog.
   Nothing is persisted until the final review is submitted. */
'use strict';
createEquipment=async function(initialType){
 let defs;try{defs=await operationSchemas('community');}catch(e){toast(e.message);return;}
 const site=chosen(),steps=['Equipment type','Identity','Specifications','Review'];
 let step=0,type=initialType||(site?'grid_meter':'ev'),editors=[],busy=false;
 const drafts=new Map(),identityKeys=new Set(['name','manufacturer','model_name','lifecycle_status','inventory_notes']);
 drawer('Add equipment',`<ol class="wizard-steps" aria-label="Creation steps">${steps.map((label,i)=>`<li><button type="button" data-wizard-step="${i}" disabled><span>${i+1}</span>${label}</button></li>`).join('')}</ol><div class="wizard-content"><section data-wizard-panel="0"><h3>Choose your equipment</h3><p class="subtitle">The technical fields will match the equipment you select.</p><div class="equipment-type-grid">${Object.entries(Operations.assetTypes).map(([key,spec])=>`<button type="button" data-wizard-type="${key}" ${!site&&key!=='ev'?'disabled title="Open a site to install this equipment"':''} aria-pressed="${key===type}">${icon(({grid_meter:'bolt',battery:'battery',pv_system:'sun',ev:'car',ev_charger:'car'})[key]||'grid')}<span>${spec[2]}</span></button>`).join('')}</div></section><fieldset data-wizard-panel="1" hidden disabled><h3>Equipment identity</h3><p class="subtitle" data-wizard-context></p><div data-wizard-identity></div></fieldset><fieldset data-wizard-panel="2" hidden disabled><h3>Technical specifications</h3><p class="subtitle">Fill in what you know. Missing optional information can be completed later.</p><div data-wizard-specifications></div></fieldset><section data-wizard-panel="3" hidden><h3>Review equipment</h3><div data-wizard-review></div><p class="footnote">Measurement channels are provisioned after creation. Configure their tags and data sources in the equipment page.</p></section></div><p class="wizard-error" role="alert" hidden></p><footer class="wizard-footer"><button class="btn text" type="button" data-action="close">Cancel</button><span data-wizard-progress></span><div class="actions"><button class="btn" type="button" data-wizard-back>Back</button><button class="btn primary" type="submit" data-wizard-next>Continue</button></div></footer>`,'',submit);
 const modal=overlay.querySelector('.drawer'),form=overlay.querySelector('form');
 modal.classList.add('equipment-wizard');modal.parentElement.classList.add('wizard-backdrop');
 form.noValidate=true;
 const panels=[...modal.querySelectorAll('[data-wizard-panel]')],error=modal.querySelector('.wizard-error');
 function payload(){return Object.assign({},...editors.map(e=>e.read()));}
 function build(){
  const spec=Operations.assetTypes[type],schema=defs[spec[1]+'Create']||defs[spec[1]+'Create-Input'];
  if(!schema)throw Error('Equipment definition is unavailable.');
  const fields=Object.entries(schema.properties||{}).filter(([key])=>!['id','site_id','site_Id'].includes(key)),value=drafts.get(type)||{};
  editors=[true,false].map(identity=>{
   const subset=fields.filter(([key])=>identityKeys.has(key)===identity),properties=Object.fromEntries(subset);
   return DomainForm.build({...schema,properties,required:(schema.required||[]).filter(k=>k in properties)},value,defs,{order:identity?['name','manufacturer','model_name','lifecycle_status','inventory_notes']:[...(technicalChecklist[type]||[]),'nominal_power_kw','usable_capacity_kwh']},'',true);
  });
  modal.querySelector('[data-wizard-identity]').replaceChildren(editors[0].node);
  modal.querySelector('[data-wizard-specifications]').replaceChildren(editors[1].node);
  modal.querySelector('[data-wizard-context]').textContent=type==='ev'?'Register the vehicle here. Assign its owner in Administration after creation.':'Installing '+spec[2]+' in '+(site?.name||'the selected site')+'.';
 }
 function displayValue(v){if(Array.isArray(v))return v.map(displayValue).join(' · ');if(v&&typeof v==='object')return Object.entries(v).map(([k,x])=>DomainForm.label(k)+': '+displayValue(x)).join(' · ');return typeof v==='boolean'?(v?'Yes':'No'):String(v);}
 function show(){
  for(let i=0;i<panels.length;i++){panels[i].hidden=i!==step;if(panels[i].tagName==='FIELDSET')panels[i].disabled=i!==step;}
  modal.querySelectorAll('[data-wizard-step]').forEach((b,i)=>{b.disabled=busy||i>step;b.setAttribute('aria-current',i===step?'step':'false');b.classList.toggle('is-complete',i<step);});
  const next=modal.querySelector('[data-wizard-next]'),back=modal.querySelector('[data-wizard-back]');next.textContent=busy?'Creating…':step===3?'Create equipment':'Continue';next.disabled=busy;back.hidden=step===0;back.disabled=busy;
  modal.querySelector('[data-wizard-progress]').textContent=`Step ${step+1} of ${steps.length}`;
  if(step===3){const data=payload();modal.querySelector('[data-wizard-review]').innerHTML=`<dl class="definition-list"><div><dt>Equipment</dt><dd>${esc(Operations.assetTypes[type][2])}</dd></div><div><dt>${type==='ev'?'Ownership':'Site'}</dt><dd>${esc(type==='ev'?'Assign after creation':site?.name||'Not selected')}</dd></div>${Object.entries(data).filter(([,v])=>hasDefinition(v)).map(([k,v])=>`<div><dt>${esc(DomainForm.label(k))}</dt><dd>${esc(displayValue(['min_state_of_charge','max_state_of_charge'].includes(k)?Number(v)*100:v))}</dd></div>`).join('')}</dl>`;}
 }
 function valid(){for(const input of panels[step].querySelectorAll('input,select,textarea'))if(!input.disabled&&!input.checkValidity()){input.reportValidity();input.focus();return false;}return true;}
 function go(next){if(busy)return;error.hidden=true;step=next;show();panels[step].scrollTop=0;panels[step].querySelector('input:not(:disabled),select:not(:disabled),button')?.focus();}
 async function submit(){
  if(busy)return;
  if(step<3){if(!valid())return;go(step+1);return;}
  busy=true;error.hidden=true;show();
  try{
   const spec=Operations.assetTypes[type];if(type!=='ev'&&!site)throw Error('Select a site before adding equipment.');
   await checkPermission(type==='ev'?'rec':'site',type==='ev'?comm().recId:site.id);
   const saved=await B.request('community','/api/assets/'+spec[0],'POST',{...payload(),...(type==='ev'?{}:{site_Id:site.id})});
   closeDrawer();
   try{await B.request('access','/api/access/reconcile','POST');await loadBackend();toast('Equipment created. Configure its channels when ready.');}catch(e){toast('Equipment was created, but the workspace could not refresh. Reload before trying again.');}
   return saved;
  }catch(e){busy=false;error.hidden=false;error.textContent=e.message;show();}
 }
 modal.querySelectorAll('[data-wizard-type]').forEach(b=>b.addEventListener('click',()=>{if(busy)return;drafts.set(type,payload());type=b.dataset.wizardType;modal.querySelectorAll('[data-wizard-type]').forEach(item=>item.setAttribute('aria-pressed',String(item===b)));build();}));
 modal.querySelector('[data-wizard-back]').addEventListener('click',()=>go(Math.max(0,step-1)));
 modal.querySelectorAll('[data-wizard-step]').forEach(b=>b.addEventListener('click',()=>{if(Number(b.dataset.wizardStep)<step)go(Number(b.dataset.wizardStep));}));
 build();show();
};
