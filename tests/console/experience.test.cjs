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
  ])
    run(fs.readFileSync("public/console/" + f + ".js", "utf8"));
  return { dom, w, run };
}
test("calendar includes cross-midnight events without including exclusive end day", () => {
  const { dom, run } = workspace();
  try {
    run(
      `var events=[{starts_at:'2026-10-12T23:00:00',ends_at:'2026-10-14T00:00:00'}]`,
    );
    assert.equal(run("flexDayEvents(events,'2026-10-12').length"), 1);
    assert.equal(run("flexDayEvents(events,'2026-10-13').length"), 1);
    assert.equal(run("flexDayEvents(events,'2026-10-14').length"), 0);
  } finally {
    dom.window.close();
  }
});
test("request wizard writes only after review, converts SoC and preserves fields when going back", async () => {
  const { dom, w, run } = workspace();
  try {
    run(
      `state.personId='manager';var assets=[{id:'charger',asset_type:'ev_charger',data:{name:'Home charger'}}];sessionAssets=()=>assets;connection.raw={assets,events:[]};var writes=[];checkPermission=async()=>{};loadBackend=async()=>{};toast=()=>{};B.request=async(s,p,m,b)=>{if(p.includes('available-types'))return {session_types:['ev_charging']};writes.push({s,p,m,b});return {};};operationSchemas=async()=>({EVChargingSessionCreate:{type:'object',required:['soc_at_departure'],properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},soc_at_departure:{type:'number',minimum:0,maximum:1},soc_at_arrival:{anyOf:[{type:'number'},{type:'null'}]},vehicle_id:{type:'string'}}}});`,
    );
    await run("editSession()");
    const doc = w.document,
      submit = () =>
        doc
          .querySelector("form")
          .dispatchEvent(
            new w.Event("submit", { bubbles: true, cancelable: true }),
          );
    submit();
    await new Promise(setImmediate);
    assert.equal(doc.querySelector('[data-flex-panel="1"]').hidden, false);
    assert.equal(doc.querySelector('[data-field="mode"]'), null);
    doc.querySelector('[data-field="soc_at_departure"]').value = "85";
    doc.querySelector("[data-flex-back]").click();
    submit();
    await new Promise(setImmediate);
    assert.equal(
      doc.querySelector('[data-field="soc_at_departure"]').value,
      "85",
    );
    submit();
    assert.equal(run("writes.length"), 0);
    assert.match(doc.querySelector("[data-flex-review]").textContent, /85%/);
    submit();
    submit();
    await new Promise(setImmediate);
    assert.equal(run("writes.length"), 1);
    assert.equal(run("writes[0].b.soc_at_departure"), 0.85);
    assert.equal(run("writes[0].b.asset_id"), "charger");
    assert.equal(run("writes[0].b.charger_id"), "charger");
    assert.equal(run("writes[0].b.mode"), "punctual");
    assert.equal(doc.querySelector('[role="dialog"]'), null);
  } finally {
    dom.window.close();
  }
});
test("request wizard rejects reversed windows before posting", async () => {
  const { dom, w, run } = workspace();
  try {
    run(
      `state.personId='manager';var assets=[{id:'heater',asset_type:'heater',data:{name:'Heater'}}];sessionAssets=()=>assets;connection.raw={assets,events:[]};var writes=[];B.request=async(s,p,m,b)=>{if(p.includes('available-types'))return {session_types:['electric_heater']};writes.push(b);};operationSchemas=async()=>({ElectricHeaterSessionCreate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},setpoint:{type:'number'}}}});`,
    );
    await run("editSession(null,'heater')");
    const doc = w.document;
    doc.querySelector('[data-field="starts_at"]').value = "2026-10-15T20:00";
    doc.querySelector('[data-field="ends_at"]').value = "2026-10-15T18:00";
    doc.querySelector('[data-field="setpoint"]').value = "21";
    doc
      .querySelector("form")
      .dispatchEvent(
        new w.Event("submit", { bubbles: true, cancelable: true }),
      );
    assert.match(
      doc.querySelector('[role="alert"]').textContent,
      /end time after/,
    );
    assert.equal(run("writes.length"), 0);
  } finally {
    dom.window.close();
  }
});
test("generic create dialog keeps fields and requires review before submitting", () => {
  const { dom, w, run } = workspace();
  try {
    run(
      `var saved=0;drawer('Add channel',field('Name','name','')+field('Unit','unit',''),save(),()=>saved++);`,
    );
    const doc = w.document,
      form = doc.querySelector("form");
    doc.querySelector("[name=name]").value = "Power";
    doc.querySelector("[name=unit]").value = "kW";
    const submit = () =>
      form.dispatchEvent(
        new w.Event("submit", { bubbles: true, cancelable: true }),
      );
    submit();
    assert.equal(run("saved"), 0);
    assert.match(doc.querySelector(".stage-review").textContent, /Power/);
    submit();
    assert.equal(run("saved"), 1);
  } finally {
    dom.window.close();
  }
});
test("overview has chart first, four preview KPIs and compact actionable configuration status", () => {
  const { dom, run } = workspace();
  try {
    run(
      "communities[0].name='Community';state.community=0;communityMeasurementViews=()=>'<div>CHART</div>';healthSection=()=>'<div>HEALTH</div>';",
    );
    const html = run("overview()");
    assert.ok(html.indexOf("CHART") < html.indexOf("Scorecard"));
    assert.doesNotMatch(
      html,
      /Community sites|Linked channels|Power totals|overview-metrics/,
    );
    assert.doesNotMatch(html, /Calculations not connected|data needed|health-quiet/);
    assert.match(html, /data-values="illustrative"/);
    assert.doesNotMatch(html, />Preview</);
    assert.match(html,/Within target tolerance/);assert.match(html,/Departure shortfall/);assert.match(html,/Battery throughput/);
    assert.equal((html.match(/class="kpi-trend/g)||[]).length, 4);
    assert.match(html, /is-improved/); assert.match(html, /is-worse/);
    assert.match(html, /data-action="edit-community-details"/);
    assert.match(html, /Community notifications/);
  } finally {
    dom.window.close();
  }
});
test("editing keeps the target equipment and does not rewrite recurrence or unrelated metadata", async () => {
  const { dom, w, run } = workspace();
  try {
    run(
      `state.personId='manager';var assets=[{id:'charger',asset_type:'ev_charger',data:{name:'Home charger'}}];sessionAssets=()=>assets;connection.raw={assets,events:[{event_id:'existing',asset_id:'charger',session_type:'ev_charging',title:'Morning commute',mode:'recurrent',recurrence:{freq:'WEEKLY'},starts_at:'2026-10-13T08:00:00Z',ends_at:'2026-10-13T17:00:00Z',timezone:'Europe/Lisbon',type_specific_data:{soc_at_departure:.8,soc_at_arrival:.2}}]};var writes=[];checkPermission=async()=>{};loadBackend=async()=>{};toast=()=>{};B.request=async(s,p,m,b)=>{if(p.includes('available-types'))return {session_types:['ev_charging']};writes.push({p,m,b});return {};};operationSchemas=async()=>({EVChargingSessionUpdate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},soc_at_departure:{type:'number'},soc_at_arrival:{anyOf:[{type:'number'},{type:'null'}]},vehicle_id:{type:'string'}}}});`,
    );
    await run("editSession('existing')");
    const doc = w.document;
    assert.equal(doc.querySelector('[data-flex-step="0"]').disabled, true);
    doc.querySelector('[data-field="soc_at_departure"]').value = "90";
    doc.querySelector('[data-field="soc_at_arrival"]').value = "";
    const submit = () =>
      doc
        .querySelector("form")
        .dispatchEvent(
          new w.Event("submit", { bubbles: true, cancelable: true }),
        );
    submit();
    submit();
    await new Promise(setImmediate);
    assert.equal(run("writes[0].m"), "PATCH");
    assert.equal(
      run("writes[0].p"),
      "/api/flexibility-events/ev-charging/existing",
    );
    assert.deepEqual(JSON.parse(run("JSON.stringify(writes[0].b)")), {
      soc_at_departure: 0.9,
      soc_at_arrival: null,
    });
  } finally {
    dom.window.close();
  }
});
test("calendar shows only scoped requests and site navigation clears the prior operation view", () => {
  const { dom, w, run } = workspace();
  try {
    run(
      `state.personId='manager';sessionAssets=()=>[{id:'mine'}];connection.raw={assets:[],events:[{event_id:'a',asset_id:'mine',title:'My request',session_type:'appliance',starts_at:'2026-10-13T10:00:00',ends_at:'2026-10-13T12:00:00',type_specific_data:{duration_minutes:60}},{event_id:'b',asset_id:'other',title:'Private request',session_type:'appliance',starts_at:'2026-10-13T10:00:00',ends_at:'2026-10-13T12:00:00',type_specific_data:{duration_minutes:60}}]};FlexCalendar.month=new Date(2026,9,1);FlexCalendar.day='2026-10-13';`,
    );
    const html = run("sessionsView()");
    assert.match(html, /My request/);
    assert.doesNotMatch(html, /Private request/);
    run(
      `render=()=>{};state.operationsPage='sessions';state.inventory='vehicles';app.innerHTML='<table><tbody><tr data-site="mine"><td>Home</td></tr></tbody></table>';`,
    );
    w.document.querySelector("td").click();
    assert.equal(run("state.site"), "mine");
    assert.equal(run("state.operationsPage"), null);
    assert.equal(run("state.inventory"), "sites");
  } finally {
    dom.window.close();
  }
});
test('recurring request saves the chosen weekdays and count; predictions cannot be edited', async()=>{
 const {dom,w,run}=workspace();try{
 run(`state.personId='manager';var assets=[{id:'charger',asset_type:'ev_charger',data:{name:'Charger'}}];sessionAssets=()=>assets;connection.raw={assets,events:[]};var writes=[];checkPermission=async()=>{};loadBackend=async()=>{};toast=()=>{};B.request=async(s,p,m,b)=>{if(p.includes('available-types'))return {session_types:['ev_charging']};writes.push(b);return {};};operationSchemas=async()=>({EVChargingSessionCreate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},soc_at_departure:{type:'number',minimum:0,maximum:1}}}});`);
 await run('editSession(null,"charger")');const doc=w.document;const repeat=doc.querySelector('[data-repeat]');repeat.value='WEEKLY';repeat.dispatchEvent(new w.Event('change',{bubbles:true}));doc.querySelector('[data-repeat-day="MO"]').checked=true;doc.querySelector('[data-repeat-day="WE"]').checked=true;doc.querySelector('[data-repeat-count]').value='8';const slider=doc.querySelector('[type=range]');slider.value='75';slider.dispatchEvent(new w.Event('input',{bubbles:true}));const submit=()=>doc.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));submit();submit();await new Promise(setImmediate);
 assert.equal(run('writes[0].mode'),'recurrent');assert.equal(run('writes[0].soc_at_departure'),.75);assert.deepEqual(JSON.parse(run('JSON.stringify(writes[0].recurrence)')),{freq:'WEEKLY',interval:1,count:8,by_day:'MO,WE'});
 run(`connection.raw.events=[{event_id:'forecast',asset_id:'charger',mode:'forecast'}]`);await run('editSession("forecast")');assert.equal(doc.querySelector('[role=dialog]'),null);await run('cancelSession("forecast")');assert.equal(doc.querySelector('[role=dialog]'),null);
 }finally{dom.window.close();}
});
test('settings sections retain hidden values and reveal an invalid field before saving',async()=>{
 const {dom,w,run}=workspace();try{
 run(`var saved=[];toast=()=>{};saveRemote=async fn=>fn();B.request=async(s,p,m,b)=>saved.push(b);operationSchemas=async()=>({DemoUpdate:{type:'object',properties:{name:{type:'string'},max_charging_power:{type:'number',minimum:0}}}});`);
 await run(`structuredEditor({title:'Equipment settings',schema:'DemoUpdate',value:{name:'Battery',max_charging_power:5},method:'PATCH',path:'/test'})`);
 const doc=w.document;assert.equal(doc.querySelectorAll('.settings-section').length,2);doc.querySelector('[data-field=name]').value='Home battery';doc.querySelector('[data-field=max_charging_power]').value='-1';const submit=()=>doc.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));submit();assert.equal(run('saved.length'),0);assert.equal(doc.querySelector('[data-field=max_charging_power]').closest('section').hidden,false);doc.querySelector('[data-field=max_charging_power]').value='6';submit();await new Promise(setImmediate);assert.deepEqual(JSON.parse(run('JSON.stringify(saved[0])')),{name:'Home battery',max_charging_power:6});
 }finally{dom.window.close();}
});
test('visual site choices update the API fields and clear incompatible subtypes',async()=>{
 const {dom,w,run}=workspace();try{
 run(`operationSchemas=async()=>({SiteUpdate:{type:'object',properties:{name:{type:'string'},site_type:{type:'string'},subtype:{type:'string'}}}});`);
 await run(`structuredEditor({title:'Site settings',schema:'SiteUpdate',method:'PUT',path:'/sites/one',value:{name:'Home',site_type:'residential',subtype:'apartment'},choices:{site_type:[['residential','Residential'],['commercial','Commercial']],subtype:[['apartment','Apartment']]},onReady:node=>node.querySelector('[data-field=site_type]').addEventListener('change',()=>{node.querySelector('[data-field=subtype]').replaceChildren(new Option('Not set',''),new Option('Office','office'));})})`);
 const doc=w.document;const choose=(group,name)=>[...doc.querySelector(`[aria-label="${group}"]`).querySelectorAll('button')].find(b=>b.textContent===name).click();
 choose('Site type choices','Commercial');assert.equal(doc.querySelector('[data-field=site_type]').value,'commercial');assert.equal(doc.querySelector('[data-field=subtype]').value,'');assert.equal(doc.querySelector('[aria-label="Site subtype choices"]').textContent.includes('Apartment'),false);choose('Site subtype choices','Office');assert.equal(doc.querySelector('[data-field=subtype]').value,'office');
 }finally{dom.window.close();}
});

test('equipment technical details preserve zero and false, distinguish site phases, and report actual missing configuration',()=>{
 const {dom,run}=workspace();try{
 run(`var a={assetType:'grid_meter',name:'Meter',sourcePayload:{meter_role:'main',bidirectional:false,max_current_a:0,manufacturer:{name:'Maker',country:'PT'},electrical_connection_type:'three_phase',phase_connection:{phases:['L1','L2','L3']}},channels:[]};var s={sourcePayload:{grid_connection:{phase_type:'three_phase'}}};`);
 const html=run('equipmentDetails(a,s)+configurationNotice(equipmentConfiguration(a),a.name)');
 assert.match(html,/Site connection phases/);assert.match(html,/three phase/);assert.match(html,/Maker · PT/);assert.match(html,/L1 · L2 · L3/);assert.doesNotMatch(html,/\[object Object\]/);assert.match(html,/>No</);assert.match(html,/>0(?:\.0)? <small>A/);
 assert.match(html,/Configure measurement or control channels/);
 assert.match(html,/Live readings and service availability are checked separately/);
 assert.doesNotMatch(html,/No missing|Equipment online/);
 }finally{dom.window.close();}
});

test('grid meter shows missing electrical details explicitly and header actions have accessible names',()=>{
 const {dom,run}=workspace();try{
 const html=run(`equipmentDetails({assetType:'grid_meter',sourcePayload:{lifecycle_status:'installed'}},{sourcePayload:{}})`);
 assert.match(html,/Electrical connection/);assert.match(html,/Connected phases/);assert.match(html,/Not set/);assert.doesNotMatch(html,/three phase/);
 const button=run(`identityIcon('Edit site','edit-site')`);assert.match(button,/aria-label="Edit site"/);assert.doesNotMatch(button,/>Edit site</);
 }finally{dom.window.close();}
});
test('scorecard comparisons always use the simulated no-controller reference, with optional personal details',()=>{
 const {dom,run}=workspace();try{
 const html=run('energyIndicators("site",true)');
 assert.match(html,/vs simulated reference · no controller/);assert.match(html,/same period/);
 assert.doesNotMatch(html,/previous|last week|Cost saving vs reference/i);
 assert.match(html,/<details class="personal-scorecard-details">/);
 assert.equal((html.match(/class="kpi-reference"/g)||[]).length,4);
 }finally{dom.window.close();}
});
test('personal site navigation excludes other households and equipment',()=>{
 const {dom,run}=workspace();try{
 run(`people.push({id:'resident-test',role:'prosumer',name:'Resident'});state.personId='resident-test';state.community=0;state.site='mine';communities[0].recId='rec';availableSites=()=>[{id:'mine',rec_id:'rec',name:'My home',assets:[{id:'my-meter',name:'My meter',channels:[],icon:'bolt'},{id:'private-meter',name:'Private meter',channels:[]}]}];availableAssets=()=>[{id:'my-meter'}];`);
 const html=run('tree()');assert.match(html,/My meter/);assert.doesNotMatch(html,/Private meter/);
 }finally{dom.window.close();}
});
test('configuration completeness never asserts live readings or working control',()=>{
 const {dom,run}=workspace();try{
 const html=run(`siteOperationalSummary({assets:[{assetType:'generic_device',specification:{device_category:'other'},channels:[{capability_type:'sensor',simulation_binding:{},unit:'kW',value_semantics:'instantaneous',sampling_interval_seconds:15}]}]})`);
 assert.match(html,/Complete/);assert.match(html,/Simulated source/);assert.match(html,/Physical collection not confirmed/);assert.match(html,/Control<\/span><strong>Not confirmed/);
 }finally{dom.window.close();}
});

function managementSetup(run) {
  run(`state.personId='manager'; state.community=0; state.site=null;
    communities[0].recId='rec-1'; communities[0].sourcePayload={name:'Community',action_interval_seconds:15,localization:{name:'Porto',latitude:41,longitude:-8}};
    communities[0].sites=[{id:'home-1',name:'Home',type:'residential',assets:[],sourcePayload:{reference_contracts:[]}}];
    var writes=[];checkPermission=async()=>{};loadBackend=async()=>{};toast=()=>{};
    B.request=async(s,p,m,b)=>{writes.push({s,p,m,b});return {id:'resident-1'};};`);
}
function formSubmit(w){w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
test('comparison contract wizard preserves existing components and history', async () => {
 const {dom,w,run}=workspace();try{
  managementSetup(run);
  run(`chosen().sourcePayload.reference_contracts=[{id:'old',valid_from:'2025-01-01',valid_until:'2026-01-01'},
   {id:'current',name:'Retail',version:2,valid_from:'2026-01-01',tariff_option:'single',components:[
   {code:'energy',flow:'grid_import',category:'energy',unit:'EUR/kWh',price:{kind:'fixed',value:'0.21'}},
   {code:'tax',flow:'standing',category:'tax',unit:'EUR/day',price:{kind:'fixed',value:'0.03'}},
   {code:'network',flow:'grid_import',category:'network_access',unit:'EUR/kWh',price:{kind:'fixed',value:'0.02'}}]}];`);
  await run("contractEditor('reference')");formSubmit(w);
  w.document.querySelector('[name=energy]').value='0.25';w.document.querySelector('[name=power]').value='6.9';formSubmit(w);formSubmit(w);
  assert.equal(run('writes.length'),0);formSubmit(w);await new Promise(setImmediate);
  const patch=JSON.parse(run('JSON.stringify(writes[0].b)'));
  assert.equal(patch.reference_contracts.length,2);assert.equal(patch.reference_contracts[0].id,'old');
  const v=patch.reference_contracts[1];assert.equal(v.contracted_power_kva,6.9);
  assert.equal(v.components.find(c=>c.code==='energy').price.value,0.25);
  assert.equal(v.components.find(c=>c.code==='tax').category,'tax');
  assert.equal(v.components.find(c=>c.code==='network').price.value,'0.02');
 }finally{dom.window.close();}
});
test('community price stores channel binding and the 80 percent member sale rule',async()=>{
 const {dom,w,run}=workspace();try{
  managementSetup(run);run(`communityChannels=()=>[{backendId:'channel-price',capability_type:'sensor',canonical_unit:'EUR/kWh',siteName:'Home',assetName:'Meter',label:'Price'}];`);
  await run("contractEditor('community')");formSubmit(w);
  w.document.querySelector('[name=channel]').value='channel-price';formSubmit(w);formSubmit(w);await new Promise(setImmediate);
  const patch=JSON.parse(run('JSON.stringify(writes[0].b)'));
  assert.equal(patch.price_sources.community_price,'channel-price');
  const [buy,sell]=patch.community_contracts[0].components;
  assert.equal(buy.price.source,'community_price');assert.equal(sell.price.reference_component,buy.code);assert.equal(sell.price.multiplier,.8);
 }finally{dom.window.close();}
});
test('resident is created with ownership and retry does not duplicate an account',async()=>{
 const {dom,w,run}=workspace();try{
  managementSetup(run);run(`var failAccess=true;B.request=async(s,p,m,b)=>{writes.push({s,p,m,b});if(s==='access'&&failAccess){failAccess=false;throw Error('Offline');}return {id:'new-resident'};};editProfile();`);
  w.document.querySelector('[name=name]').value='New resident';w.document.querySelector('[name=email]').value='resident@example.org';
  formSubmit(w);w.document.querySelector('[name=home]').checked=true;formSubmit(w);formSubmit(w);
  assert.equal(run('writes.length'),0);formSubmit(w);await new Promise(setImmediate);
  assert.match(w.document.querySelector('[role=alert]').textContent,/Account created/);
  formSubmit(w);await new Promise(setImmediate);
  const calls=JSON.parse(run('JSON.stringify(writes)'));assert.equal(calls.filter(c=>c.s==='community').length,1);
  assert.equal(calls[0].b.site_accesses[0].site_id,'home-1');assert.equal(calls[0].b.site_accesses[0].relation,'owner');
  assert.equal(calls.filter(c=>c.s==='access').length,2);
 }finally{dom.window.close();}
});
test('configuration resolution sends only the selected change and requires a note',async()=>{
 const {dom,w,run}=workspace();try{
  managementSetup(run);run(`configurationWork.rows=[{id:'change-1',rec_id:'rec-1',resource_name:'Battery',reason:'equipment_created'}];resolveConfigurationWork('change-1','percepta');`);
  formSubmit(w);assert.equal(run('writes.length'),0);
  w.document.querySelector('[name=note]').value='Regenerated and reviewed v3';formSubmit(w);formSubmit(w);await new Promise(setImmediate);
  assert.equal(run('writes[0].p'),'/api/configuration-reviews/change-1/resolve');assert.equal(run('writes[0].b.target'),'percepta');
  assert.equal(run('writes[0].b.note'),'Regenerated and reviewed v3');
 }finally{dom.window.close();}
});
test('community wizard keeps the chosen cadence and converts displayed kW to the API unit',async()=>{
 const {dom,w,run}=workspace();try{
  managementSetup(run);run('editCommunitySimple()');formSubmit(w);formSubmit(w);
  w.document.querySelector('[name=import_limit]').value='25';formSubmit(w);
  const review=w.document.querySelector('.stage-review').textContent;
  assert.match(review,/15 s/);assert.doesNotMatch(review,/30 min/);
  formSubmit(w);await new Promise(setImmediate);
  assert.equal(run('writes[0].b.action_interval_seconds'),15);assert.equal(run('writes[0].b.power_limit_import.megawatts'),.025);
  assert.equal(run('writes[0].b.localization.latitude'),41);
 }finally{dom.window.close();}
});

test("departure slider is a single visible control and keeps arrival charge and vehicle independent", async () => {
 const {dom,w,run}=workspace();
 try {
 run(`state.personId='manager';var assets=[{id:'charger',asset_type:'ev_charger',data:{name:'Home charger'}},{id:'ev-one',asset_type:'ev',data:{name:'First EV'}},{id:'ev-two',asset_type:'ev',data:{name:'Second EV'}}];sessionAssets=()=>assets;connection.raw={assets,events:[]};B.request=async()=>({session_types:['ev_charging']});operationSchemas=async()=>({EVChargingSessionCreate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},soc_at_departure:{type:'number',minimum:0,maximum:1},soc_at_arrival:{anyOf:[{type:'number'},{type:'null'}]},vehicle_id:{type:'string'}}}});`);
 await run("editSession(null,'charger','ev-two')");
 const doc=w.document,slider=doc.querySelector('input[type="range"]'),arrival=doc.querySelector('[data-field="soc_at_arrival"]'),vehicle=doc.querySelector('[data-field="vehicle_id"]');
 assert.equal(vehicle.value,'ev-two','Vehicle detail preselects the requested EV even when it is not first');
 arrival.value='25';vehicle.value='ev-two';slider.value='90';slider.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(doc.querySelector('[data-field="soc_at_departure"]').value,'90');assert.equal(arrival.value,'25');assert.equal(vehicle.value,'ev-two');assert.equal(vehicle.querySelectorAll('option[value^="ev-"]').length,2);
 assert.equal(doc.querySelector('.charge-exact').hidden,true);assert.equal(slider.getAttribute('aria-label'),'Minimum departure charge');assert.equal(doc.querySelector('[data-charge-label]').textContent,'90%');
 }finally{dom.window.close();}
});
