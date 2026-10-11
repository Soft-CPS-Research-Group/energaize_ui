const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {JSDOM}=require('jsdom');
function workspace(){
 const dom=new JSDOM('<div id="app"></div><div id="overlay"></div><div id="toast"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.workbookInventory={entities:[]};w.structuredClone=structuredClone;w.fetch=()=>new Promise(()=>{});w.AbortSignal=AbortSignal;
 const context=dom.getInternalVMContext(),run=s=>vm.runInContext(s,context);
 for(const file of ['inventory-model','app','inventory-ui','people-model','people-ui','backend-client','connected-ui','telemetry-ui','domain-form','operations-ui','price-rules','community-charts','workspace-refinement'])run(fs.readFileSync('public/console/'+file+'.js','utf8'));
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
test('EVs cannot receive manual flexibility requests',async()=>{
 const {dom,run}=workspace();try{
 run("var requests=[];B.request=async(...args)=>{requests.push(args);return {};};connection.raw={assets:[{id:'ev',asset_type:'ev',data:{name:'EV'}}],events:[]};var message='';toast=text=>message=text;");
 await run("editSession(null,'ev')");assert.equal(run('requests.length'),0);assert.match(run('message'),/observed data/);
 }finally{dom.window.close();}
});
