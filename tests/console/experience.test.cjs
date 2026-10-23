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
    "flexibility-planning",
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

test('calendar reads resolved occurrences and never expands a second client-side recurrence', async () => {
 const {dom,run}=workspace();try{
  run(`render=()=>{};state.personId='manager';FlexCalendar.month=new Date(2026,9,1);FlexCalendar.day='2026-10-22';var assets=[{id:'washer',asset_type:'appliance',data:{name:'Laundry machine'}}];sessionAssets=()=>assets;for(const a of assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);connection.raw={assets,events:[]};var calls=[];window.FlexRecurrence={expand(){throw Error('Client recurrence must not be authoritative');}};B.request=async(s,p,m,b)=>{calls.push({s,p,m,b});return {occurrences:[{event_id:'request',occurrence_id:'request@date',occurrence_at:'2026-10-22T18:00:00Z',starts_at:'2026-10-22T18:00:00Z',ends_at:'2026-10-22T23:00:00Z',asset_id:'washer',title:'Laundry',session_type:'appliance',type_specific_data:{duration_minutes:80,energy_required_kwh:.6},status:'active',resolution:'eligible',latest_start:'2026-10-22T21:40:00Z'}],predictions:[]};};sessionsView();`);
  await new Promise(setImmediate);
  const html=run('sessionsView()');
  assert.match(html,/Laundry machine/);assert.match(html,/80 minute cycle/);assert.doesNotMatch(html,/0.6 kWh required/);assert.match(html,/Cycle can start as late/);
  assert.equal(run('calls.length'),1);assert.equal(run('calls[0].p'),'/api/flexibility/effective');assert.equal(run('calls[0].b.asset_ids[0]'),'washer');
 }finally{dom.window.close();}
});

test('failed calendar read is visible and does not reuse another account’s requests', async () => {
 const {dom,run}=workspace();try{
  run(`render=()=>{};state.personId='manager';var assets=[{id:'washer',asset_type:'appliance',data:{name:'Laundry'}}];sessionAssets=()=>assets;for(const a of assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);connection.raw={assets,events:[]};FlexPlan.result={occurrences:[{title:'Private old request'}]};B.request=async()=>{throw Error('Permissions unavailable');};sessionsView();`);
  await new Promise(setImmediate);
  const html=run('sessionsView()');assert.match(html,/Permissions unavailable/);assert.match(html,/Calendar unavailable/);assert.doesNotMatch(html,/Private old request/);
 }finally{dom.window.close();}
});

test('appliance wizard selects a machine cycle and submits only its ID and availability', async () => {
 const {dom,w,run}=workspace();try{
  run(`state.personId='manager';var assets=[{id:'washer-a',asset_type:'appliance',data:{name:'Kitchen washer',power_profiles:[{id:'other',name:'Other machine cycle',duration_minutes:120}]}},{id:'washer-b',asset_type:'appliance',data:{name:'Utility washer',power_profiles:[{id:'eco',name:'Eco',duration_minutes:80,energy_consumption_kwh:.6}]}}];sessionAssets=()=>assets;for(const a of assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);connection.raw={assets,events:[]};var writes=[];checkPermission=async()=>{};loadBackend=async()=>{};toast=()=>{};B.request=async(s,p,m,b)=>{if(p.endsWith('/access'))return {can_edit:true};if(p.includes('available-types'))return {session_types:['appliance']};writes.push({s,p,m,b});return {};};operationSchemas=async()=>({ApplianceSessionCreate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},selected_power_profile:{type:'string'},duration_minutes:{type:'integer',minimum:1},energy_required_kwh:{type:'number'},interruptible:{type:'boolean'}}}});`);
  await run("editSession(null,'washer-b')");
  const doc=w.document,submit=()=>doc.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  doc.querySelector('[data-field="starts_at"]').value='2026-10-22T22:00';doc.querySelector('[data-field="ends_at"]').value='2026-10-23T07:00';
  const cycle=doc.querySelector('[data-field="selected_power_profile"]');cycle.value='eco';cycle.dispatchEvent(new w.Event('change'));
  assert.equal(cycle.querySelector('[value=other]'),null);assert.equal(doc.querySelector('[data-field="duration_minutes"]'),null);assert.equal(doc.querySelector('[data-field="energy_required_kwh"]'),null);assert.match(doc.querySelector('[data-flex-fields]').textContent,/80 minutes/);
  submit();assert.equal(run('writes.length'),0);submit();await new Promise(setImmediate);
  assert.equal(run('writes[0].b.asset_id'),'washer-b');assert.equal(run('writes[0].b.selected_power_profile'),'eco');assert.equal(run('writes[0].b.duration_minutes'),undefined);assert.equal(run('writes[0].b.energy_required_kwh'),undefined);assert.equal(run('writes[0].b.interruptible'),undefined);
  assert.equal(run('writes[0].p'),'/api/flexibility-events/appliances');
 }finally{dom.window.close();}
});

test('editing a single recurring appliance occurrence sends an exception with both revisions', async () => {
 const {dom,w,run}=workspace();try{
  run(`state.personId='manager';var assets=[{id:'washer',asset_type:'appliance',data:{name:'Washer',power_profiles:[{id:'eco',name:'Eco',duration_minutes:60},{id:'intensive',name:'Intensive',duration_minutes:90}]}}];sessionAssets=()=>assets;sessionVisible=()=>true;var savedEvent={event_id:'event',asset_id:'washer',session_type:'appliance',mode:'recurrent',recurrence:{freq:'DAILY',count:7},title:'Wash',starts_at:'2026-10-22T18:00:00Z',ends_at:'2026-10-22T23:00:00Z',revision:4,type_specific_data:{selected_power_profile:'eco',cycle_snapshot:{name:'Eco',duration_minutes:60},duration_minutes:60,energy_required_kwh:.6}};var occurrence={...savedEvent,occurrence_at:'2026-10-23T18:00:00Z',starts_at:'2026-10-23T18:00:00Z',ends_at:'2026-10-23T23:00:00Z',exception_revision:2};for(const a of assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);connection.raw={assets,events:[savedEvent]};var writes=[];checkPermission=async()=>{};loadBackend=async()=>{};toast=()=>{};B.request=async(s,p,m,b)=>{if(p.endsWith('/access'))return {can_edit:true};if(p.includes('available-types'))return {session_types:['appliance']};writes.push({s,p,m,b});return {};};operationSchemas=async()=>({ApplianceSessionUpdate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},selected_power_profile:{type:'string'},duration_minutes:{type:'integer',minimum:1},energy_required_kwh:{type:'number'}}}});`);
  await run("editSession('event',null,null,occurrence)");
  const doc=w.document,submit=()=>doc.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(doc.querySelector('.repeat-plan').hidden,true);
  doc.querySelector('[data-field="selected_power_profile"]').value='intensive';submit();submit();await new Promise(setImmediate);
  assert.equal(run('writes.length'),1);assert.equal(run('writes[0].p'),'/api/flexibility/events/event/exceptions');
  assert.equal(run('writes[0].b.expected_event_revision'),4);assert.equal(run('writes[0].b.expected_exception_revision'),2);assert.equal(run('writes[0].b.occurrence_at'),'2026-10-23T18:00:00Z');assert.equal(run('writes[0].b.selected_power_profile'),'intensive');assert.equal(run('writes[0].b.duration_minutes'),undefined);
 }finally{dom.window.close();}
});
test("request wizard writes only after review, converts SoC and preserves fields when going back", async () => {
  const { dom, w, run } = workspace();
  try {
    run(
      `state.personId='manager';var assets=[{id:'charger',asset_type:'ev_charger',data:{name:'Home charger'}}];sessionAssets=()=>assets;for(const a of assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);connection.raw={assets,events:[]};var writes=[];checkPermission=async()=>{};loadBackend=async()=>{};toast=()=>{};B.request=async(s,p,m,b)=>{if(p.endsWith('/access'))return {can_edit:true};if(p.includes('available-types'))return {session_types:['ev_charging']};writes.push({s,p,m,b});return {};};operationSchemas=async()=>({EVChargingSessionCreate:{type:'object',required:['soc_at_departure'],properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},soc_at_departure:{type:'number',minimum:0,maximum:1},soc_at_arrival:{anyOf:[{type:'number'},{type:'null'}]},vehicle_id:{type:'string'}}}});`,
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
      `state.personId='manager';var assets=[{id:'heater',asset_type:'heater',data:{name:'Heater'}}];sessionAssets=()=>assets;for(const a of assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);connection.raw={assets,events:[]};var writes=[];B.request=async(s,p,m,b)=>{if(p.endsWith('/access'))return {can_edit:true};if(p.includes('available-types'))return {session_types:['electric_heater']};writes.push(b);};operationSchemas=async()=>({ElectricHeaterSessionCreate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},setpoint:{type:'number'}}}});`,
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
      `state.personId='manager';var assets=[{id:'charger',asset_type:'ev_charger',data:{name:'Home charger'}}];sessionAssets=()=>assets;for(const a of assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);connection.raw={assets,events:[{event_id:'existing',asset_id:'charger',session_type:'ev_charging',title:'Morning commute',mode:'recurrent',recurrence:{freq:'WEEKLY'},starts_at:'2026-10-13T08:00:00Z',ends_at:'2026-10-13T17:00:00Z',timezone:'Europe/Lisbon',type_specific_data:{soc_at_departure:.8,soc_at_arrival:.2}}]};var writes=[];checkPermission=async()=>{};loadBackend=async()=>{};toast=()=>{};B.request=async(s,p,m,b)=>{if(p.endsWith('/access'))return {can_edit:true};if(p.includes('available-types'))return {session_types:['ev_charging']};writes.push({p,m,b});return {};};operationSchemas=async()=>({EVChargingSessionUpdate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},soc_at_departure:{type:'number'},soc_at_arrival:{anyOf:[{type:'number'},{type:'null'}]},vehicle_id:{type:'string'}}}});`,
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
test("calendar requests only scoped equipment and site navigation clears the prior operation view", async () => {
  const { dom, w, run } = workspace();
  try {
    run(
      `render=()=>{};state.personId='manager';sessionAssets=()=>[{id:'mine',asset_type:'appliance',data:{name:'Washer'}}];B.request=async(s,p,m,b)=>({occurrences:connection.raw.events.filter(e=>b.asset_ids.includes(e.asset_id)).map(e=>({...e,resolution:'eligible',occurrence_id:e.event_id})),predictions:[]});connection.raw={assets:[],events:[{event_id:'a',asset_id:'mine',title:'My request',session_type:'appliance',starts_at:'2026-10-13T10:00:00',ends_at:'2026-10-13T12:00:00',type_specific_data:{duration_minutes:60}},{event_id:'b',asset_id:'other',title:'Private request',session_type:'appliance',starts_at:'2026-10-13T10:00:00',ends_at:'2026-10-13T12:00:00',type_specific_data:{duration_minutes:60}}]};FlexCalendar.month=new Date(2026,9,1);FlexCalendar.day='2026-10-13';`,
    );
    run("sessionsView()");
    await new Promise(setImmediate);
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
 run(`state.personId='manager';var assets=[{id:'charger',asset_type:'ev_charger',data:{name:'Charger'}}];sessionAssets=()=>assets;for(const a of assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);connection.raw={assets,events:[]};var writes=[];checkPermission=async()=>{};loadBackend=async()=>{};toast=()=>{};B.request=async(s,p,m,b)=>{if(p.endsWith('/access'))return {can_edit:true};if(p.includes('available-types'))return {session_types:['ev_charging']};writes.push(b);return {};};operationSchemas=async()=>({EVChargingSessionCreate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},soc_at_departure:{type:'number',minimum:0,maximum:1}}}});`);
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
 run(`state.personId='manager';var assets=[{id:'charger',asset_type:'ev_charger',data:{name:'Home charger'}},{id:'ev-one',asset_type:'ev',data:{name:'First EV'}},{id:'ev-two',asset_type:'ev',data:{name:'Second EV'}}];sessionAssets=()=>assets;for(const a of assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);connection.raw={assets,events:[]};B.request=async()=>({session_types:['ev_charging']});operationSchemas=async()=>({EVChargingSessionCreate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},soc_at_departure:{type:'number',minimum:0,maximum:1},soc_at_arrival:{anyOf:[{type:'number'},{type:'null'}]},vehicle_id:{type:'string'}}}});`);
 await run("editSession(null,'charger','ev-two')");
 const doc=w.document,slider=doc.querySelector('input[type="range"]'),arrival=doc.querySelector('[data-field="soc_at_arrival"]'),vehicle=doc.querySelector('[data-field="vehicle_id"]');
 assert.equal(vehicle.value,'ev-two','Vehicle detail preselects the requested EV even when it is not first');
 arrival.value='25';vehicle.value='ev-two';slider.value='90';slider.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(doc.querySelector('[data-field="soc_at_departure"]').value,'90');assert.equal(arrival.value,'25');assert.equal(vehicle.value,'ev-two');assert.equal(vehicle.querySelectorAll('option[value^="ev-"]').length,2);
 assert.equal(doc.querySelector('.charge-exact').hidden,true);assert.equal(slider.getAttribute('aria-label'),'Minimum departure charge');assert.equal(doc.querySelector('[data-charge-label]').textContent,'90%');
 }finally{dom.window.close();}
});

test('pump asks for total hours and minutes, rejects oversized windows and never sends flow',async()=>{
 const {dom,w,run}=workspace();try{
  run(`state.personId='manager';var assets=[{id:'pump',asset_type:'water_pump',data:{name:'Pool pump'}}];sessionAssets=()=>assets;for(const a of assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);connection.raw={assets,events:[]};var writes=[];checkPermission=async()=>{};loadBackend=async()=>{};toast=()=>{};B.request=async(s,p,m,b)=>{if(p.endsWith('/access'))return {can_edit:true};if(p.includes('available-types'))return {session_types:['water_pump']};writes.push({p,b});return {};};operationSchemas=async()=>({WaterPumpSessionCreate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},duration_minutes:{type:'integer',minimum:1},setpoint:{type:'number'}}}});`);
  await run("editSession(null,'pump')");const doc=w.document;
  doc.querySelector('[data-field=starts_at]').value='2026-10-22T08:00';doc.querySelector('[data-field=ends_at]').value='2026-10-22T12:00';
  const hours=doc.querySelector('[data-runtime-hours]'),mins=doc.querySelector('[data-runtime-minutes]');
  hours.value='5';mins.value='15';hours.dispatchEvent(new w.Event('input',{bubbles:true}));formSubmit(w);
  assert.match(doc.querySelector('[role=alert]').textContent,/running time must fit/);assert.equal(run('writes.length'),0);
  hours.value='2';hours.dispatchEvent(new w.Event('input',{bubbles:true}));formSubmit(w);
  assert.match(doc.querySelector('[data-flex-review]').textContent,/2 h 15 min total running time/);assert.equal(doc.querySelector('[data-field=setpoint]'),null);
  formSubmit(w);await new Promise(setImmediate);assert.equal(run('writes[0].b.duration_minutes'),135);assert.equal(run('writes[0].b.setpoint'),undefined);
 }finally{dom.window.close();}
});

test('appliance without configured cycles cannot create a request and links to equipment setup',async()=>{
 const {dom,w,run}=workspace();try{
  run(`state.personId='manager';var assets=[{id:'washer',asset_type:'appliance',data:{name:'Washer',power_profiles:[]}}];sessionAssets=()=>assets;for(const a of assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);connection.raw={assets,events:[]};var writes=[];B.request=async()=>({session_types:['appliance']});operationSchemas=async()=>({ApplianceSessionCreate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},selected_power_profile:{type:'string'}}}});var configured=null;editEquipment=async id=>configured=id;`);
  await run("editSession(null,'washer')");formSubmit(w);assert.equal(run('writes.length'),0);assert.equal(w.document.querySelector('[data-flex-panel="2"]').hidden,true);
  const setup=[...w.document.querySelectorAll('button')].find(n=>n.textContent==='Set up equipment cycles');assert.ok(setup);setup.click();assert.equal(run('configured'),'washer');
 }finally{dom.window.close();}
});

test('chosen machine cycle must fit the window before reviewing',async()=>{
 const {dom,w,run}=workspace();try{
  run(`state.personId='manager';var assets=[{id:'washer',asset_type:'appliance',data:{name:'Washer',power_profiles:[{id:'long',name:'Long wash',duration_minutes:180}]}}];sessionAssets=()=>assets;for(const a of assets)connection.permissions.set(permissionKey('asset',a.id,'request'),true);connection.raw={assets,events:[]};B.request=async()=>({session_types:['appliance']});operationSchemas=async()=>({ApplianceSessionCreate:{type:'object',properties:{starts_at:{type:'string',format:'date-time'},ends_at:{type:'string',format:'date-time'},selected_power_profile:{type:'string'}}}});`);
  await run("editSession(null,'washer')");const doc=w.document;doc.querySelector('[data-field=starts_at]').value='2026-10-22T08:00';doc.querySelector('[data-field=ends_at]').value='2026-10-22T10:00';doc.querySelector('[data-field=selected_power_profile]').value='long';formSubmit(w);
  assert.match(doc.querySelector('[role=alert]').textContent,/selected cycle needs to fit/);assert.equal(doc.querySelector('[data-flex-panel="2"]').hidden,true);
 }finally{dom.window.close();}
});


test('manager sees requests but only an author with current access gets edit actions',()=>{
 const {dom,run}=workspace();try{
  run(`state.personId='manager';var assets=[{id:'washer',asset_type:'appliance',data:{name:'Laundry'}}];connection.raw={assets,events:[]};var request={event_id:'r',occurrence_id:'r@time',asset_id:'washer',created_by:'resident',status:'active',revision:2,title:'Laundry',starts_at:'2026-10-23T18:00:00Z',ends_at:'2026-10-23T22:00:00Z',session_type:'appliance',type_specific_data:{duration_minutes:90},resolution:'eligible'};`);
  assert.doesNotMatch(run('flexRow(request)'),/data-flex-occ-edit/);
  run("connection.permissions.set(permissionKey('asset','washer','request'),true)");
  assert.doesNotMatch(run('flexRow(request)'),/data-flex-occ-edit/,'own access does not permit editing another author');
  run("request.created_by='manager'");assert.match(run('flexRow(request)'),/data-flex-occ-edit/);
  run('connection.permissions.clear()');assert.doesNotMatch(run('flexRow(request)'),/data-flex-occ-cancel/);
 }finally{dom.window.close();}
});

test('request details show live sharing, revisions and pending consumer delivery without claiming execution',async()=>{
 const {dom,w,run}=workspace();try{
  run(`connection.raw={events:[{event_id:'r',title:'Evening charge'}]};B.request=async(s,p)=>p.endsWith('/access')?{author_name:'Ana',can_edit:false,revision:3,readers:[{name:'Ana',is_author:true},{name:'REC manager'}],sharing:'Inherited from equipment access'}:p.endsWith('/revisions')?[{revision:3,recorded_at:'2026-10-23T10:00:00Z',snapshot:{status:'cancelled'}}]:{changes:[{deliveries:[{state:'pending'}]}]};`);
  await run("flexRequestDetails('r')");const text=w.document.querySelector('[role=dialog]').textContent;
  assert.match(text,/Ana/);assert.match(text,/REC manager/);assert.match(text,/revision 3/);assert.match(text,/Waiting for 1 consumer/);assert.match(text,/does not confirm a physical action/);assert.match(text,/Read only/);
 }finally{dom.window.close();}
});

test('stale permission is rechecked before opening another author request',async()=>{
 const {dom,w,run}=workspace();try{
  run(`connection.raw={events:[{event_id:'r',asset_id:'washer',created_by:'manager'}]};B.request=async()=>({can_edit:false});`);
  await assert.rejects(run("editSession('r')"),/Only the author/);
  assert.equal(w.document.querySelector('[role=dialog]'),null);
 }finally{dom.window.close();}
});
