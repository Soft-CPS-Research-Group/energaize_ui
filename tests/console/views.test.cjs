const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('real UUID assets open and render channels and topology without type/id confusion',()=>{
 const elements=new Map();const ctx=vm.createContext({window:{workbookInventory:{entities:[]}},setInterval:()=>0,setTimeout:()=>0,document:{addEventListener:()=>{},getElementById:id=>{if(!elements.has(id))elements.set(id,{innerHTML:''});return elements.get(id);}}});
 for(const f of ['inventory-model.js','app.js','inventory-ui.js','people-model.js','people-ui.js','backend-client.js'])vm.runInContext(fs.readFileSync('public/console/'+f,'utf8'),ctx,{filename:f});
 const run=s=>vm.runInContext(s,ctx);
 run(`communities.splice(0,communities.length,...ConsoleBackend.model([{id:'rec-uuid',name:'REC',localization:{name:'Porto'}}],[{id:'site-uuid',assigned_rec_id:'rec-uuid',name:'Home',site_type:'residential'}],[{id:'meter-uuid',asset_type:'grid_meter',data:{site_id:'site-uuid',name:'Meter'}}],[{asset_id:'meter-uuid',profile_id:'profile-uuid',capabilities:[{capability_id:'cap-uuid',name:'energy_in',capability_type:'sensor',unit:'kWh',description:'Imported energy',enabled:false}]}]));state.community=0;state.site='site-uuid';state.personId='manager';state.equipment='meter-uuid';state.deviceTab='overview';`);
 assert.match(run('equipmentContent()'),/Imported energy/);
 run("state.deviceTab='sensors'");assert.match(run('equipmentContent()'),/Imported energy/);
 assert.equal((run('siteTopology()').match(/data-asset="meter-uuid"/g)||[]).length,1);
});

test('connected vehicles are normalized once and ownership filtering remains explicit',()=>{
 const elements=new Map();const ctx=vm.createContext({window:{workbookInventory:{entities:[]}},setInterval:()=>0,setTimeout:()=>0,document:{addEventListener:()=>{},getElementById:id=>{if(!elements.has(id))elements.set(id,{innerHTML:''});return elements.get(id);}}});
 for(const f of ['inventory-model.js','app.js','inventory-ui.js','people-model.js','people-ui.js'])vm.runInContext(fs.readFileSync('public/console/'+f,'utf8'),ctx,{filename:f});
 const run=s=>vm.runInContext(s,ctx);
 run(`communities.splice(0,communities.length,{recId:'rec',sites:[],vehicles:[{id:'ev-owned',name:'My EV',sourcePayload:{battery_capacity_kwh:60}},{id:'ev-other',payload:{model_name:'Other EV',battery_capacity_kwh:40}}]});demoVehicles.splice(0,demoVehicles.length,{id:'ev-owned',name:'My EV',asset_type:'ev',capacity:60});`);
 assert.equal(run('peopleCatalog().assets.length'),2);
 assert.equal(run("peopleCatalog().assets.find(a=>a.id==='ev-owned').capacity"),60);
 assert.equal(run("peopleCatalog().assets.find(a=>a.id==='ev-other').name"),'Other EV');
 assert.equal(run("availableAssets({id:'owner',asset_ownerships:[{energy_asset_id:'ev-owned',ownership_type:'owned'}],site_accesses:[]}).length"),1);
});
