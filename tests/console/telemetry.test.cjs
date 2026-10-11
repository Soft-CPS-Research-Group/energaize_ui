const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function context(){
 const elements=new Map();const ctx=vm.createContext({window:{workbookInventory:{entities:[]},addEventListener:()=>{}},setInterval:()=>0,setTimeout:()=>0,document:{addEventListener:()=>{},getElementById:id=>{if(!elements.has(id))elements.set(id,{innerHTML:''});return elements.get(id);}}});
 for(const f of ['inventory-model.js','app.js','inventory-ui.js','people-model.js','people-ui.js','backend-client.js'])vm.runInContext(fs.readFileSync('public/console/'+f,'utf8'),ctx,{filename:f});
 vm.runInContext('const B=ConsoleBackend;const connection={};function siteGraph(){};function refreshHistory(){};',ctx);
 vm.runInContext(fs.readFileSync('public/console/telemetry-ui.js','utf8'),ctx,{filename:'telemetry-ui.js'});return ctx;
}
test('passes all catalogue channels to the pill workspace without inventing bindings or units',()=>{
 const ctx=context();vm.runInContext(`tPanel([{backendId:'empty',assetId:'battery-2',assetName:'Battery 2',tag:'00123',source:'provider',name:'Power',unit:'W'},{backendId:'bound',name:'Import',unit:'unconfirmed',mongo_binding:{database:'demo'}}],'site:one');window.TelemetryCharts={mount:(node,props)=>window.chartProps=props};tLoad({dataset:{telemetryPanel:'site:one'},querySelector:()=>({})});`,ctx);
 const channels=ctx.window.chartProps.channels;
 assert.equal(channels.length,2);assert.equal(channels[0].assetId,'battery-2');assert.equal(channels[0].tag,'00123');assert.equal(typeof ctx.window.chartProps.onConfigureChannel,'function');assert.equal(channels[0].endpoint,undefined);assert.equal(channels[1].endpoint,'/capabilities/bound/series');assert.equal(channels[1].unit,'unconfirmed');
});

test('opens sensor settings on its owning equipment and enforces permission first',async()=>{
 const ctx=context();vm.runInContext(`communities.splice(0,communities.length,{sites:[{id:'site',assets:[{id:'battery-1',backendId:'battery-1',channels:[{backendId:'c1',name:'soc'}]},{id:'battery-2',backendId:'battery-2',channels:[{backendId:'c2',name:'soc'}]}]}]});state.community=0;state.site='site';var calls=[];var checkPermission=async(kind,id)=>{calls.push(['permission',kind,id]);};inspectAsset=(id,name)=>calls.push(['editor',id,name]);`,ctx);
 await vm.runInContext("tConfigure('c2')",ctx);
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(calls)',ctx)),[['permission','asset','battery-2'],['editor','battery-2','soc']]);
 vm.runInContext("calls=[];checkPermission=async()=>{throw Error('Denied');};toast=message=>calls.push(['message',message]);",ctx);
 await vm.runInContext("tConfigure('c1')",ctx);
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(calls)',ctx)),[['message','Denied']]);
});

test('device fields configure without a tag and simulation settings survive payload mapping',()=>{
 const ctx=context();
 vm.runInContext("var cap={name:'soc',unit:'%',tag:null,source:'simulator',external_device_id:'battery-01',source_field:'soc',source_kind:'simulated',enabled:true,sampling_interval_seconds:15,simulation_binding:{baseline:60,amplitude:20,period_seconds:3600,start_at:'2026-10-01T00:00:00Z'}};",ctx);
 assert.equal(vm.runInContext('InventoryModel.validation(cap)',ctx),null);
 assert.equal(vm.runInContext('InventoryModel.payload(cap).source_field',ctx),'soc');
 assert.equal(vm.runInContext('InventoryModel.payload(cap).simulation_binding.baseline',ctx),60);
 assert.match(vm.runInContext('InventoryModel.validation({...cap,source_field:null})',ctx),/device reference with a field/);
 assert.match(vm.runInContext('InventoryModel.validation({...cap,sampling_interval_seconds:7})',ctx),/multiple/);
});
