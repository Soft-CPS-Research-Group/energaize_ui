const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
function workspace() {
  const dom = new JSDOM(
    '<div id="app"></div><div id="overlay"></div><div id="toast"></div>',
    {
      url: "http://localhost/",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
  const w = dom.window;
  w.workbookInventory = { entities: [] };
  w.structuredClone = structuredClone;
  w.fetch = () => new Promise(() => {});
  w.AbortSignal = AbortSignal;
  const run = (s) => vm.runInContext(s, dom.getInternalVMContext());
  for (const f of [
    "inventory-model",
    "app",
    "inventory-ui",
    "people-model",
    "people-ui",
    "backend-client",
    "connected-ui",
    "telemetry-ui",
    "domain-form",
    "operations-ui",
    "price-rules",
    "community-charts",
    "workspace-refinement",
    "equipment-wizard",
    "runtime-ui",
    "experience-ui",
    "product-art",
    "flexibility-calendar",
    "community-management",
    "mediterranean-scenes",
    "mediterranean-ui",
  ])
    run(fs.readFileSync("public/console/" + f + ".js", "utf8"));
  return { dom, w, run };
}

test("architecture follows site type and exact equipment, with no invented devices", () => {
 const {dom,run}=workspace();
 try {
  run(`var site={id:'s',type:'residential',assets:[]}; var solar={id:'solar',assetType:'pv_system'}; var battery={id:'battery',assetType:'battery'}; var charger={id:'charger',assetType:'ev_charger'};`);
  assert.equal(run("MediterraneanScenes.select(site,[]).file"),'house-none');
  assert.equal(run("MediterraneanScenes.select(site,[solar]).file"),'house-solar');
  assert.equal(run("MediterraneanScenes.select(site,[solar,battery]).file"),'house-solar-battery');
  assert.equal(run("MediterraneanScenes.select(site,[battery,charger,solar]).file"),'house-solar-battery-charger');
  assert.equal(run("MediterraneanScenes.select({...site,type:'industrial'},[solar,battery,charger]).file"),'factory-solar-battery-charger');
  assert.equal(run("MediterraneanScenes.select({...site,subtype:'apartment'},[]).file"),'building-none');
  assert.equal(run("MediterraneanScenes.select(site,[charger]).exact"),false);
  assert.equal(run("MediterraneanScenes.select(site,[solar,{...solar,id:'solar-2'}]).exact"),false);
  assert.equal(run("Object.keys(MediterraneanScenes.select(site,[charger]).points).length"),0);
  assert.equal(run("MediterraneanScenes.select({...site,type:'utility'},[])") ,null);
  assert.equal(run("MediterraneanScenes.select(site,[{...solar,sourcePayload:{lifecycle_status:'retired'}}]).file"),'house-none');
  for(const file of JSON.parse(run("JSON.stringify(Object.values(MediterraneanScenes.registry).map(s=>s.file))"))) assert.ok(fs.existsSync('public/assets/mediterranean/'+file+'.webp'));
 } finally {dom.window.close();}
});

function setupScene(run) {
 run(`state.personId='manager'; connection.loading=false; connection.error=null; state.loggedIn=true;
 var sceneSite={id:'s',name:'Site A',type:'residential',sourcePayload:{},assets:[
 {id:'solar',backendId:'solar',assetType:'pv_system',name:'Roof solar',channels:[],sourcePayload:{}},
 {id:'battery',backendId:'battery',assetType:'battery',name:'Home battery',channels:[],sourcePayload:{}},
 {id:'charger',backendId:'charger',assetType:'ev_charger',name:'EV charger',channels:[],sourcePayload:{}},
 {id:'meter',backendId:'meter',assetType:'grid_meter',name:'Grid meter',channels:[{backendId:'grid-import',name:'active_power_import',capability_type:'sensor',enabled:true}],sourcePayload:{}}]};
 for(const a of sceneSite.assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);communities[0].sites=[sceneSite];state.community=0;sessionAssets=()=>sceneSite.assets.map(a=>({id:a.id,asset_type:a.assetType}));
 render=()=>{app.innerHTML=siteGraph(sceneSite);};render();`);
}

test("equipment selection moves the marker, preserves the chart node and opens existing equipment actions", () => {
 const {dom,w,run}=workspace();
 try {
  setupScene(run);
  w.document.querySelector('.ceramic-chart-toggle').click();
  const chart=w.document.querySelector('[data-telemetry-panel]');
  assert.ok(chart,'The existing real measurement panel is mounted on demand');
  w.document.querySelector('[data-med-select="solar"]').click();
  assert.equal(w.document.querySelector('.ceramic-hotspot').style.left,'52%');
  assert.equal(w.document.querySelector('.ceramic-inspector [data-asset]').dataset.asset,'solar');
  assert.equal(w.document.querySelector('[data-telemetry-panel]'),chart);
  w.document.querySelector('[data-med-select="battery"]').click();
  assert.equal(w.document.querySelector('.ceramic-hotspot').style.left,'64.8%');
  w.document.querySelector('[data-med-select="charger"]').click();
  assert.ok(w.document.querySelector('[data-equipment-session="charger"]'));
  w.document.querySelector('[data-med-select="meter"]').click();
  assert.equal(w.document.querySelector('.ceramic-hotspot'),null);
  assert.match(w.document.querySelector('.ceramic-inspector').textContent,/specifications have not been added/);
  assert.equal(w.document.querySelector('[data-med-select="meter"]'),w.document.activeElement);
  w.document.querySelector('.ceramic-chart-toggle').click();
  assert.equal(w.document.querySelector('[data-telemetry-panel]'),null);
 } finally {dom.window.close();}
});

test("resident image, equipment dock and graph exclude equipment outside access grants", () => {
 const {dom,w,run}=workspace();
 try {
  setupScene(run);
  run(`state.personId='ana';connection.permissions.clear();availableSites=()=>[sceneSite];availableAssets=()=>[{id:'solar'}];render();`);
  assert.equal(w.document.querySelectorAll('.ceramic-equipment-dock [data-med-select]').length,2);
  assert.match(w.document.querySelector('.ceramic-photo img').src,/house-solar.webp$/);
  w.document.querySelector('[data-med-select="solar"]').click();
  assert.ok(w.document.querySelector('[data-personal-asset="solar"]'));
  assert.equal(w.document.querySelector('[data-med-select="battery"]'),null);
  assert.equal(w.document.querySelector('[data-equipment-session]'),null);
 } finally {dom.window.close();}
});

test("flexibility action is shown only for controllable equipment and user strings are escaped", () => {
 const {dom,w,run}=workspace();
 try {
  setupScene(run);
  run(`state.personId='ana';connection.permissions.clear();availableSites=()=>[sceneSite];availableAssets=()=>[{id:'charger'}];sceneSite.assets[2].name='<img src=x onerror=alert(1)>';render();`);
  w.document.querySelector('[data-med-select="charger"]').click();
  assert.equal(w.document.querySelector('.ceramic-inspector img'),null);
  assert.equal(w.document.querySelector('[data-equipment-session]'),null);
  run(`connection.permissions.set(permissionKey('asset','charger','request'),true);render();`);
  assert.ok(w.document.querySelector('[data-equipment-session="charger"]'));
 } finally {dom.window.close();}
});


test("equipment groups preserve individual navigation and show registered specifications", () => {
 const {dom,w,run}=workspace();
 try {
  setupScene(run);
  run(`sceneSite.assets[1].sourcePayload={capacity_kwh:9.6,max_charge_kw:4.8};sceneSite.assets[2].sourcePayload={max_charging_power:9.6,max_current_a:32};sceneSite.assets.push({...sceneSite.assets[2],id:'charger-2',backendId:'charger-2',name:'Garage charger'});render();`);
  assert.equal(w.document.querySelectorAll('.ceramic-equipment-dock [data-med-select="group:ev_charger"]').length,1);
  assert.equal(w.document.querySelector('.ceramic-equipment-dock [data-med-select="charger"]'),null);
  w.document.querySelector('[data-med-select="group:ev_charger"]').click();
  assert.equal(w.document.querySelectorAll('.ceramic-device-list button').length,2);
  w.document.querySelector('[data-med-select="charger-2"]').click();
  assert.ok(w.document.querySelector('[data-asset="charger-2"]'));
  assert.match(w.document.querySelector('.ceramic-facts').textContent,/9.6 kW/);
  assert.doesNotMatch(w.document.querySelector('.ceramic-inspector').textContent,/Measurements|Channels|AI-generated/);
  w.document.querySelector('[data-med-select="battery"]').click();
  assert.match(w.document.querySelector('.ceramic-facts').textContent,/Battery capacity9.6 kWh/);
  assert.match(w.document.querySelector('.ceramic-facts').textContent,/Charge power4.8 kW/);
 } finally {dom.window.close();}
});

test("mouse wheel moves the site strip and releases page scrolling at its boundaries", () => {
 const {dom,w,run}=workspace();
 try {
  setupScene(run);run(`app.innerHTML='<div class="ceramic-sites-strip"><button>Site</button></div>'`);
  const strip=w.document.querySelector('.ceramic-sites-strip');
  Object.defineProperties(strip,{scrollWidth:{value:1000},clientWidth:{value:300}});
  const wheel=delta=>{const e=new w.WheelEvent('wheel',{deltaY:delta,bubbles:true,cancelable:true});strip.firstChild.dispatchEvent(e);return e;};
  assert.equal(wheel(100).defaultPrevented,true);assert.equal(strip.scrollLeft,100);
  strip.scrollLeft=700;assert.equal(wheel(100).defaultPrevented,false);
  strip.scrollLeft=0;assert.equal(wheel(-100).defaultPrevented,false);
 } finally {dom.window.close();}
});

test("topology shows all sites without intersecting wires and limits resident equipment to access grants", () => {
 const {dom,w,run}=workspace();
 try {
  setupScene(run);run(`state.site='s';app.innerHTML=communityTopology();`);
  assert.equal(w.document.querySelectorAll('.ceramic-topology-node[data-site]').length,1);
  assert.equal(w.document.querySelectorAll('.ceramic-topology .edge').length,0);
  assert.ok(w.document.querySelector('.ceramic-export image'));
  run(`state.personId='ana';connection.permissions.clear();availableSites=()=>[sceneSite];availableAssets=()=>[{id:'solar'}];app.innerHTML=siteTopology();`);
  assert.equal(w.document.querySelectorAll('.ceramic-topology-node').length,1);
  assert.ok(w.document.querySelector('[data-personal-asset="solar"]'));
  assert.doesNotMatch(w.document.querySelector('.ceramic-export').textContent,/Home battery|EV charger/);
 } finally {dom.window.close();}
});

test("topology export embeds Ceramic artwork and produces a self-contained SVG", async () => {
 const {dom,w,run}=workspace();
 try {
  setupScene(run);run(`app.innerHTML=communityTopology();`);
  let exported, downloads=0, requested=0;
  w.fetch=async()=>{requested++;return {ok:true,blob:async()=>new w.Blob(['art'],{type:'image/webp'})};};
  w.URL.createObjectURL=blob=>{exported=blob;return 'blob:topology';};
  w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){downloads++;assert.equal(this.download,'energy-topology.svg');};
  await run('exportTopology()');
  assert.equal(downloads,1);assert.equal(requested,1,'Shared icon sheet is fetched once');
  const content=await new Promise(resolve=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(exported);});
  const svg=new w.DOMParser().parseFromString(content,'image/svg+xml');
  assert.equal(svg.querySelector('parsererror'),null);
  assert.ok([...svg.querySelectorAll('image')].every(img=>img.getAttribute('href').startsWith('data:image/webp;base64,')));
  assert.equal(svg.documentElement.getAttribute('width'),'1040');
  assert.match(svg.querySelector('title').textContent,/equipment and membership/);
 } finally {dom.window.close();}
});

test("clicking visible equipment in the image selects the same device without replacing charts", () => {
 const {dom,w,run}=workspace();
 try { setupScene(run);w.document.querySelector('.ceramic-chart-toggle').click();const chart=w.document.querySelector('[data-telemetry-panel]');
 const target=w.document.querySelector('[data-med-from-image][data-med-select="solar"]');assert.ok(target);target.click();
 assert.equal(w.document.querySelector('.ceramic-hotspot').style.left,'52%');assert.ok(w.document.querySelector('.ceramic-inspector [data-asset="solar"]'));assert.equal(w.document.querySelector('[data-telemetry-panel]'),chart);
 run(`sceneSite.assets.push({...sceneSite.assets[2],id:'second-charger'});render();`);assert.equal(w.document.querySelectorAll('[data-med-from-image]').length,0,'No invented locations for duplicate devices');
 }finally{dom.window.close();}
});
test("topology retains directional limits and distinguishes missing values from zero", () => {
 const {dom,w,run}=workspace();
 try { setupScene(run);run(`state.site='s';sceneSite.importLimit=0;sceneSite.exportLimit=null;sceneSite.assets[1].sourcePayload={max_charge_kw:4.8,max_discharge_kw:3,min_discharge_kw:0};app.innerHTML=siteTopology();`);
 assert.match(w.document.querySelector('.ceramic-grid-link').textContent,/Import: ≤ 0.0 kW/);assert.match(w.document.querySelector('.ceramic-grid-link').textContent,/Export: not set/);
 const battery=w.document.querySelector('.ceramic-topology-node[data-asset="battery"]');assert.match(battery.textContent,/Charge: ≤ 4.8 kW/);assert.match(battery.textContent,/Discharge: 0.0–3.0 kW/);
 assert.match(w.document.querySelector('.ceramic-topology-node[data-asset="solar"]').textContent,/Generation: not set/);
 assert.match(w.document.querySelector('.ceramic-export').textContent,/Charge: ≤ 4.8 kW/);
 }finally{dom.window.close();}
});

test('garage bays are whole buttons and EV details separate channels and vehicle-specific sessions',()=>{
 const {dom,w,run}=workspace();
 try {
  run(`state.personId='ana';state.loggedIn=true;connection.loading=false;
  var cars=[{id:'ev-a',name:'Family EV',asset_type:'ev',capacity:60,sourcePayload:{battery_capacity_kwh:60}},{id:'ev-b',name:'City EV',asset_type:'ev',capacity:40,sourcePayload:{battery_capacity_kwh:40}}];
  demoVehicles.splice(0,demoVehicles.length,...cars);availableAssets=()=>cars;
  connection.raw={profiles:[],assets:cars.map(a=>({...a,data:{name:a.name}})),events:[{event_id:'ea',asset_id:'charger',title:'Family plan',starts_at:'2026-10-14T18:00:00Z',ends_at:'2026-10-14T20:00:00Z',session_type:'ev_charging',type_specific_data:{vehicle_id:'ev-a',soc_at_departure:.8}},{event_id:'eb',asset_id:'charger',title:'City plan',type_specific_data:{vehicle_id:'ev-b'}}]};
  sessionAssets=()=>[...connection.raw.assets,{id:'charger',asset_type:'ev_charger',data:{name:'Charger'}}];
  app.innerHTML=myVehicles();`);
  assert.equal(w.document.querySelectorAll('button.ceramic-parking-bay').length,2);
  run(`state.personalAsset='ev-a';state.vehicleTab='overview';app.innerHTML=vehicleView('ev-a');`);
  assert.equal(run('state.personalPage'),'vehicles');
  assert.equal(w.document.querySelector('table'),null);
  assert.ok(w.document.querySelector('[data-med-vehicle-tab="channels"]'));
  assert.equal(w.document.querySelector('[data-med-vehicle-plan]'),null,'read access does not show control actions');
  run(`state.vehicleTab='sessions';app.innerHTML=vehicleView('ev-a');`);
  assert.match(w.document.body.textContent,/Family plan/);assert.doesNotMatch(w.document.body.textContent,/City plan/);
  run(`sessionAssets=()=>connection.raw.assets;app.innerHTML=vehicleView('ev-a');`);
  assert.doesNotMatch(w.document.body.textContent,/Family plan/,'sessions on inaccessible chargers remain hidden');
 }finally{dom.window.close();}
});
test('Equipment defaults to topology and the list uses a single full-row button per device',()=>{
 const {dom,w,run}=workspace();
 try {
  setupScene(run);run(`availableAssets=()=>sceneSite.assets.map(a=>({...a,asset_type:a.assetType,site_id:'s'}));state.site='s';app.innerHTML=personalEquipmentLanding(sceneSite);`);
  assert.ok(w.document.querySelector('[aria-label="Site equipment topology"]'));
  run(`state.ceramicEquipmentView='list';app.innerHTML=personalEquipmentLanding(sceneSite);`);
  assert.equal(w.document.querySelectorAll('button.ceramic-equipment-row').length,4);
  assert.equal(w.document.querySelector('[aria-label="Site equipment topology"]'),null);
  assert.doesNotMatch(w.document.querySelector('.ceramic-equipment-list').textContent,/Open/);
 }finally{dom.window.close();}
});

test('workspace loading reserves one empty React slot and keeps the error state usable',()=>{
 const {dom,w,run}=workspace();
 try {
  run(`connection.error=null;app.innerHTML=connectionScreen();`);
  assert.equal(w.document.querySelectorAll('[data-console-loader]').length,1);
  assert.equal(w.document.querySelector('[data-console-loader]').textContent,'','React supplies the loading message once, without a duplicated fallback');
  assert.match(w.document.querySelector('h1').textContent,/Preparing your workspace/);
  run(`connection.error='Connection unavailable';app.innerHTML=connectionScreen();`);
  assert.equal(w.document.querySelector('[data-console-loader]'),null);
  assert.equal(w.document.querySelector('[role=alert]').textContent,'Connection unavailable');
  assert.ok(w.document.querySelector('[data-reconnect]'));
 }finally{dom.window.close();}
});

test('site topology connects every visible device group to its site and exports individual branches',()=>{
 const {dom,w,run}=workspace();
 try {
  setupScene(run);run(`state.site='s';sceneSite.assets.push({...sceneSite.assets[2],id:'charger-2',backendId:'charger-2',name:'Second charger'});app.innerHTML=siteTopology();`);
  const branches=[...w.document.querySelectorAll('.ceramic-wired-members>[data-connection-from]')];
  assert.equal(branches.length,4,'Two chargers share one connected branch instead of overlapping icons');
  assert.ok(branches.every(node=>node.dataset.connectionFrom==='s'&&node.querySelector('.ceramic-connection-port')));
  assert.deepEqual(branches.map(node=>node.dataset.connectionTo),['solar','battery','group:ev_charger','meter']);
  assert.ok(w.document.querySelector('[data-connection-to="solar"][data-asset="solar"]'));
  assert.equal(w.document.querySelector('[data-med-topology-group="ev_charger"]').getAttribute('aria-expanded'),'false');
  assert.equal(w.document.querySelectorAll('.ceramic-export-connections [data-connection]').length,6,'Export connects the grid and each actual device, including grouped devices');
  run(`sceneSite.assets=[];app.innerHTML=siteTopology();`);
  assert.equal(w.document.querySelector('.ceramic-flow-bus'),null,'An empty site has no disconnected distribution rail');
  assert.match(w.document.querySelector('.ceramic-wiring-canvas').textContent,/No equipment registered/);
 }finally{dom.window.close();}
});
