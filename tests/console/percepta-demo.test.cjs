const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(sites=[]){
 const c=vm.createContext({scoped:()=>sites,channelForChart:c=>({id:c.backendId,title:c.description||c.name||"Channel"}),communityMeasurementViews:()=>'',overview:()=>'',siteGraph:()=>'',tLoad:()=>{},siteDetailOriginal:()=>'',ceramicCharts:new Set(),energyIndicators:()=> 'illustrative',document:{addEventListener(){}},sourcePath:s=>'/sources/'+s.database+'/'+s.collection});
 vm.runInContext(fs.readFileSync('public/console/percepta-demo.js','utf8'),c);return c;
}
const source=(collection,database='living_lab')=>({sourcePayload:{external_references:[{system:'percepta-mongo',identifier:database+'/'+collection}]}});
test('limits the demo adapter to the five selected sources and does not infer by site name',()=>{
 const sites=['building_R-H-01','building_R-H-02','building_R-H-03','building_R-H-04'].map(x=>source(x));sites.push(source('building_i-charging_headquarters_3Phase','i-charging_headquarters_3Phase'));
 const c=setup(sites);assert.equal(c.matisseDemo(),true);assert.equal(c.energyIndicators(),'illustrative');
 sites.pop();assert.equal(c.matisseDemo(),false);assert.equal(c.energyIndicators(),'illustrative');
 assert.equal(c.perceptaSource({name:'RH01'}),null);
});
test('uses an explicit RH power aggregate instead of the unverified shared community values',()=>{
 const c=setup([source('building_i-charging_headquarters_3Phase','i-charging_headquarters_3Phase')]);
 const channels=c.perceptaCommunityChannels();assert.equal(channels.length,2);
 assert.ok(channels.every(x=>x.endpoint.includes('/percepta/matisse/power/')));
 assert.ok(channels.every(x=>x.unit==='kW'&&x.defaultVisible));
});
test('prefers grid totals over per-phase series, and battery SoC when no grid exists',()=>{
 const c=setup();const channel=(id,field,name)=>({backendId:id,name,enabled:true,mongo_binding:{field}});
 const channels=[channel('l1','observations.grid_meters.GR01.energy_in_l1'),channel('in','observations.grid_meters.GR01.energy_in_total'),channel('out','observations.grid_meters.GR01.energy_out_total'),channel('soc','observations.batteries.B01.SoC','state_of_charge')];
 assert.deepEqual(Array.from(c.perceptaChartChannels(channels).filter(x=>x.defaultVisible),x=>x.id),['in','out']);
 assert.deepEqual(Array.from(c.perceptaChartChannels(channels.slice(-1)).filter(x=>x.defaultVisible),x=>x.id),['soc']);
});
test('charger activity is bound to its own enabled Mongo power channel',()=>{
 const c=setup();const asset={assetType:'ev_charger',channels:[{enabled:true,mongo_binding:{database:'living_lab',collection:'building_R-H-01',field:'observations.charging_sessions.EVC01.power'}}]};
 assert.equal(c.perceptaChargerActivity(asset),'/percepta/living_lab/building_R-H-01/chargers/EVC01/activity');
 asset.channels[0].enabled=false;assert.equal(c.perceptaChargerActivity(asset),undefined);
});

test('opening charts once does not override the user hiding them',()=>{
 const c=setup();c.perceptaOpenOnce('community:test');assert.equal(c.ceramicCharts.has('community:test'),true);
 c.ceramicCharts.delete('community:test');c.perceptaOpenOnce('community:test');assert.equal(c.ceramicCharts.has('community:test'),false);
});

test('RH grid power uses the harmonized output window, leaving other sources untouched',()=>{
 const c=setup();
 const meter={backendId:'meter',name:'energy_in_total',enabled:true,unit:'kWh',mongo_binding:{database:'living_lab',field:'observations.grid_meters.GR01.energy_in_total'}};
 const pv={...meter,backendId:'pv',mongo_binding:{database:'living_lab',field:'observations.pv_panels.PV01.energy'}};
 const hq={...meter,backendId:'hq',mongo_binding:{...meter.mongo_binding,database:'i-charging_headquarters_3Phase'}};
 const rows=c.perceptaChartChannels([meter,pv,hq]);
 assert.equal(rows[0].displayScale,240);assert.equal(rows[0].unit,'kW');
 assert.equal(rows[1].displayScale,undefined);assert.equal(rows[2].displayScale,undefined);
});
