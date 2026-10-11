const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {JSDOM}=require('jsdom');
test('all classic Console modules boot together, including operational and vehicle views',()=>{
 const dom=new JSDOM('<div id="app"></div><div id="overlay"></div><div id="toast"></div>',{url:'http://localhost/console/',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;w.workbookInventory={entities:[]};w.structuredClone=structuredClone;w.fetch=()=>new Promise(()=>{});w.AbortSignal=AbortSignal;w.ResizeObserver=class{observe(){} disconnect(){}};
 const context=dom.getInternalVMContext();
 for(const file of ['inventory-model','app','inventory-ui','people-model','people-ui','backend-client','connected-ui','telemetry-ui','domain-form','operations-ui','price-rules','community-charts','workspace-refinement','equipment-wizard'])assert.doesNotThrow(()=>vm.runInContext(fs.readFileSync('public/console/'+file+'.js','utf8'),context,{filename:file+'.js'}),file+' must initialize');
 assert.match(vm.runInContext('vehicles.toString()',context),/vehicleView/);
 dom.window.close();
});
