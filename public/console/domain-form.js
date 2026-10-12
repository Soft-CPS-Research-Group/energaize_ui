/* Structured forms from the API schema; no JSON editing and no implicit defaults on PATCH. */
(function(root){
 const copy=v=>v===undefined?undefined:structuredClone(v);
 const label=k=>({site_Id:'Site',max_charging_power:'Maximum charging power (kW)',min_charging_power:'Minimum charging power (kW)',max_discharging_power:'Maximum discharging power (kW)',min_discharging_power:'Minimum discharging power (kW)',efficiency:'Efficiency (0–1)',charging_efficiency:'Charging efficiency (0–1)',discharging_efficiency:'Discharging efficiency (0–1)',charger_id:'Charger',vehicle_id:'Vehicle',selected_power_profile:'Power profile',starts_at:'Available from',ends_at:'Available until',soc_at_arrival:'Arrival SoC (%)',soc_at_departure:'Minimum departure SoC (%)',min_state_of_charge:'Minimum state of charge (%)',max_state_of_charge:'Maximum state of charge (%)',valid_until:'Valid until (exclusive)',source:'Price source name',external_device_id:'External device reference'}[k]||k.replaceAll('_',' ').replace(/\b(kwh|kw|kva|soc|pv|ev)\b/gi,v=>({kwh:'kWh',kw:'kW',kva:'kVA',soc:'SoC',pv:'PV',ev:'EV'}[v.toLowerCase()])).replace(/^./,v=>v.toUpperCase()));
 const percent=new Set(['soc_at_arrival','soc_at_departure','min_state_of_charge','max_state_of_charge']);
 function resolve(schema,defs){return schema?.$ref?{...defs[schema.$ref.split('/').pop()],...Object.fromEntries(Object.entries(schema).filter(([k])=>k!=='$ref'))}:schema||{};}
 function nullable(s){return s.type==='null'||(s.anyOf||s.oneOf||[]).some(v=>v.type==='null');}
 function variants(schema,defs){return (schema.anyOf||schema.oneOf||[schema]).filter(s=>s.type!=='null').map(s=>resolve(s,defs));}
 function blank(s,defs){s=resolve(s,defs);if(s.default!==undefined)return copy(s.default);if(s.oneOf||s.anyOf)return blank(variants(s,defs)[0],defs);if(s.const!==undefined)return s.const;if(s.type==='object'||s.properties)return Object.fromEntries(Object.entries(s.properties||{}).filter(([k,v])=>(s.required||[]).includes(k)||resolve(v,defs).const!==undefined).map(([k,v])=>[k,blank(v,defs)]));if(s.type==='array')return [];return undefined;}
 function element(tag,attrs={},text){const node=document.createElement(tag);Object.entries(attrs).forEach(([k,v])=>{if(v!==undefined)node.setAttribute(k,String(v));});if(text!==undefined)node.textContent=text;return node;}
 function build(schema,value,defs,options={},key='',required=false,path=key){
  schema=resolve(schema,defs);if(!schema.type&&!schema.properties&&!schema.anyOf&&!schema.oneOf&&!schema.const&&!schema.enum)schema={oneOf:[{type:'string'},{type:'number'},{type:'boolean'},{type:'object',additionalProperties:{}},{type:'array',items:{}}]};const wrapper=element('div',{class:'domain-field'}),choices=variants(schema,defs);
  if(choices.length>1&&!(choices.every(s=>['number','string'].includes(s.type))&&choices.some(s=>s.type==='number'))){
   let selected=value?.kind?choices.findIndex(s=>s.properties?.kind?.const===value.kind):choices.findIndex(s=>(s.type==='array'&&Array.isArray(value))||(s.type==='object'&&value&&typeof value==='object'&&!Array.isArray(value))||(s.type===typeof value));if(selected<0)selected=0;
   const title=element('label',{class:'formlabel'},label(key)+' type'),select=element('select');choices.forEach((s,i)=>select.append(element('option',{value:i,selected:i===selected?'':undefined},s.properties?.kind?.const||s.title||s.type||'Details')));title.append(select);wrapper.append(title);let child=build(choices[selected],value,defs,options,key,required,path);wrapper.append(child.node);
   select.addEventListener('change',()=>{child.node.remove();child=build(choices[Number(select.value)],blank(choices[Number(select.value)],defs),defs,options,key,required,path);wrapper.append(child.node);});return {node:wrapper,read:()=>child.read()};
  }
  const s=choices.find(s=>s.type==='number')||choices[0]||schema;
  const omitted=options.omit||new Set();
  if(s.type==='object'||s.properties||s.additionalProperties){
   const optional=!!key&&!required;const head=element('div',{class:'domain-object-head'}),box=element('input',{type:'checkbox','aria-label':'Include '+label(key)});box.checked=value!=null;const body=element('fieldset',{class:'domain-object'});body.append(element('legend',{},label(key)||'Details'));
   if(optional){const l=element('label',{class:'channel-enable'});l.append(box,document.createTextNode(' '+label(key)));head.append(l);wrapper.append(head);body.hidden=!box.checked;body.disabled=!box.checked;box.addEventListener('change',()=>{body.hidden=!box.checked;body.disabled=!box.checked;});}
   const fields=[];
   for(const [k,definition] of Object.entries(s.properties||{}).sort(([a],[b])=>{const rank=k=>options.order?.includes(k)?options.order.indexOf(k):-1;return (rank(a)<0?999:rank(a))-(rank(b)<0?999:rank(b));})){
    if(omitted.has(k)||k==='id'||resolve(definition,defs).readOnly)continue;
    const child=build(definition,value?.[k],defs,options,k,((s.required||[]).includes(k)||options.requiredFields?.includes(k)),path?path+'.'+k:k);fields.push([k,child]);body.append(child.node);
   }
   let dictionary=null;
   if(s.additionalProperties){
    dictionary=build({type:'array',items:{type:'object',required:['key','value'],properties:{key:{type:'string',minLength:1},value:s.additionalProperties===true?{}:s.additionalProperties}}},Object.entries(value||{}).map(([key,value])=>({key,value})),defs,options,'Entries',true,path);body.append(dictionary.node);
   }
   if(optional&&options.inlineObjects?.includes(key)){
    head.hidden=true;body.hidden=false;body.disabled=false;
    const controls=[...body.querySelectorAll('input,select,textarea')];
    const requiredInputs=controls.filter(n=>n.required);
    const sync=()=>{const populated=controls.some(n=>n.value.trim()!=='');box.checked=populated;requiredInputs.forEach(n=>n.required=populated);};
    body.addEventListener('input',sync);body.addEventListener('change',sync);sync();
   }
   wrapper.append(body);return {node:wrapper,read:()=>{if(optional&&!box.checked)return value!=null?null:undefined;const result={};for(const [k,f] of fields){const v=f.read();if(v!==undefined)result[k]=v;}if(value?.id)result.id=value.id;if(dictionary){for(const row of dictionary.read()){if(!row.key||['__proto__','prototype','constructor'].includes(row.key))throw Error('Use a valid entry name');if(Object.hasOwn(result,row.key))throw Error('Duplicate entry '+row.key);result[row.key]=row.value;}}return result;}};
  }
  if(s.type==='array'&&s.prefixItems){const row=element('div',{class:'formcolumns'});const children=s.prefixItems.map((item,i)=>{const child=build(item,value?.[i],defs,options,(path.includes('power_curve')?['Wind speed (m/s)','Power (kW)'][i]:['X','Y'][i])||String(i+1),true,path+'.'+i);row.append(child.node);return child;});wrapper.append(row);return {node:wrapper,read:()=>children.map(c=>c.read())};}
  if(s.type==='array'){
   const list=element('div',{class:'domain-array'});list.append(element('h3',{},label(key)));const rows=element('div');let children=[];let values=key==='power_curve'&&value?.points?value.points:value||[];if(!Array.isArray(values))throw Error(label(key)+' must be a list');
   const render=()=>{rows.replaceChildren();children=values.map((v,i)=>{const row=element('div',{class:'domain-array-row'});const child=build(s.items,v,defs,options.arrayChoices?.[key]?{...options,choices:{...options.choices,[`${label(key)} ${i+1}`]:options.arrayChoices[key]}}:options,`${label(key)} ${i+1}`,true,path+'.'+i);row.append(child.node);const remove=element('button',{type:'button',class:'btn text','aria-label':`Remove ${label(key)} ${i+1}`},'Remove');remove.onclick=()=>{values=children.map(c=>c.read()).filter((_,j)=>j!==i);render();};row.append(remove);rows.append(row);return child;});};render();
   const add=element('button',{type:'button',class:'btn'},'Add '+label(key));add.onclick=()=>{values=children.map(c=>c.read());values.push(blank(s.items,defs));render();};list.append(rows,add);wrapper.append(list);return {node:wrapper,read:()=>children.map(c=>c.read())};
  }
  if(s.const!==undefined)return {node:element('span',{class:'domain-constant'},String(s.const)),read:()=>s.const};
  const title=element('label',{class:'formlabel'},label(key)+(required?' *':''));let input;const optionsFor=options.choices?.[key];const values=optionsFor||s.enum?.map(v=>[v,label(String(v))]);
  if(values||s.type==='boolean'){
   input=element('select');if(!required)input.append(element('option',{value:''},'Not set'));for(const [v,l] of values||[[true,'Yes'],[false,'No']])input.append(element('option',{value:String(v)},l));input.value=value==null?'':String(value);
  }else{
   const type=s.type==='number'||s.type==='integer'?'number':s.format==='date'?'date':s.format==='date-time'?'datetime-local':'text';input=element('input',{type,step:s.type==='integer'?1:type==='number'?'any':undefined,min:s.minimum,max:s.maximum,minlength:s.minLength,maxlength:s.maxLength});
   let display=value;if(type==='datetime-local'&&value){const d=new Date(value);display=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}if(percent.has(key)){if(value!=null)display=Number(value)*100;input.min='0';input.max='100';}input.value=display??'';
  }
  input.dataset.field=key;input.required=required;title.append(input);if(s.description&&!percent.has(key))title.append(element('small',{class:'domain-hint'},s.description));wrapper.append(title);
  return {node:wrapper,read:()=>{const v=input.value;if(v==='')return value===''?'':value!=null&&nullable(schema)?null:undefined;if(s.type==='boolean')return v==='true';if(s.type==='number'||s.type==='integer')return Number(v)/(percent.has(key)?100:1);if(s.format==='date-time'){const date=new Date(v);if(!Number.isFinite(date.getTime()))throw Error('Invalid '+label(key));return date.toISOString();}return v;}};
 }
 function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
 function diff(before,after){return Object.fromEntries(Object.entries(after).filter(([k,v])=>JSON.stringify(canonical(v))!==JSON.stringify(canonical(before?.[k]))));}
 root.DomainForm={build,resolve,blank,label,diff};
})(globalThis);
