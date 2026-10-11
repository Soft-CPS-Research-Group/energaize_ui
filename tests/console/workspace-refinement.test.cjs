const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {JSDOM}=require('jsdom');
function workspace(){
 const dom=new JSDOM('<div id="app"></div><div id="overlay"></div><div id="toast"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.workbookInventory={entities:[]};w.structuredClone=structuredClone;w.fetch=()=>new Promise(()=>{});w.AbortSignal=AbortSignal;
 const context=dom.getInternalVMContext(),run=s=>vm.runInContext(s,context);
 for(const file of ['inventory-model','app','inventory-ui','people-model','people-ui','backend-client','connected-ui','telemetry-ui','domain-form','operations-ui','price-rules','community-charts','workspace-refinement','equipment-wizard'])run(fs.readFileSync('public/console/'+file+'.js','utf8'));
 return {dom,w,run};
}
test('configuration distinguishes empty, partial and complete without treating unused templates as faults',()=>{
 const {dom,run}=workspace();try{
 run(`var asset={assetType:'grid_meter',sourcePayload:{},channels:[{name:'optional_voltage',configuration_status:'template'}]};`);
 assert.equal(run('equipmentConfiguration(asset).tone'),'empty');
 run(`asset.sourcePayload.meter_role='grid';asset.channels.push({name:'power',capability_type:'sensor',unit:'kW',source:'gateway',tag:'00123',value_semantics:'instantaneous'});`);
 assert.equal(run('equipmentConfiguration(asset).tone'),'partial');assert.match(run('equipmentConfiguration(asset).missing.join()'),/Sampling interval/);
 run('asset.channels[1].sampling_interval_seconds=15;');assert.equal(run('equipmentConfiguration(asset).tone'),'complete');
 assert.equal(run('siteConfiguration({assets:[]}).tone'),'empty');
 assert.equal(run('siteConfiguration({assets:[asset]}).tone'),'complete');
 assert.equal(run("channelConfiguration({unit:'kW',capability_type:'sensor',value_semantics:'instantaneous',sampling_interval_seconds:15,simulation_binding:{baseline:1}}).tone"),'complete');
 }finally{dom.window.close();}
});
test('equipment wizard preserves values across steps and creates only once after review',async()=>{
 const {dom,w,run}=workspace();try{
 run(`communities.splice(0,communities.length,{recId:'rec',name:'Test community',sites:[{id:'site',name:'Test home',assets:[]}]});state.community=0;state.site='site';
 var requests=[],resolveCreate;checkPermission=async()=>{};loadBackend=async()=>{};toast=()=>{};
 B.request=async(service,path,method,payload)=>{requests.push({service,path,method,payload});if(service==='community')return new Promise(resolve=>resolveCreate=resolve);return {};};
 operationSchemas=async()=>({BatteryCreate:{type:'object',required:['name'],properties:{name:{type:'string',minLength:1},capacity_kwh:{type:'number',minimum:0},max_state_of_charge:{type:'number',minimum:0,maximum:1},site_Id:{type:'string'}}}});`);
 await run("createEquipment('battery')");const doc=w.document;
 const submit=()=>doc.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 submit();submit();assert.equal(doc.querySelector('[data-wizard-panel="1"]').hidden,false,'empty required name blocks advancement');
 doc.querySelector('[data-field="name"]').value='My battery';submit();
 doc.querySelector('[data-field="capacity_kwh"]').value='12';doc.querySelector('[data-field="max_state_of_charge"]').value='95';
 doc.querySelector('[data-wizard-back]').click();assert.equal(doc.querySelector('[data-field="name"]').value,'My battery');submit();assert.equal(doc.querySelector('[data-field="capacity_kwh"]').value,'12');submit();
 assert.equal(run('requests.length'),0);assert.match(doc.querySelector('[data-wizard-review]').textContent,/95/);
 submit();submit();await new Promise(setImmediate);assert.equal(run("requests.filter(r=>r.service==='community').length"),1);
 assert.equal(run('requests[0].payload.site_Id'),'site');assert.equal(run('requests[0].payload.max_state_of_charge'),.95);assert.equal(run('requests[0].payload.capacity_kwh'),12);
 run("resolveCreate({id:'created'})");await new Promise(setImmediate);assert.equal(doc.querySelector('[role="dialog"]'),null);
 }finally{dom.window.close();}
});
test('cancelling equipment creation never writes and EVs cannot receive manual flexibility requests',async()=>{
 const {dom,w,run}=workspace();try{
 run(`var requests=[];B.request=async(...args)=>{requests.push(args);return {};};operationSchemas=async()=>({BatteryCreate:{type:'object',required:['name'],properties:{name:{type:'string'}}}});state.site=communities[0].sites[0].id;state.community=0;`);
 await run("createEquipment('battery')");w.document.querySelector('.wizard-footer [data-action="close"]').click();assert.equal(run('requests.length'),0);assert.equal(w.document.querySelector('[role="dialog"]'),null);
 run("connection.raw={assets:[{id:'ev',asset_type:'ev',data:{name:'EV'}}],events:[]};var message='';toast=text=>message=text;");await run("editSession(null,'ev')");assert.equal(run('requests.length'),0);assert.match(run('message'),/observed data/);
 }finally{dom.window.close();}
});
