// Local integration check. Creates a temporary user and restores every changed field.
import assert from 'node:assert/strict';
const ui=process.env.CONSOLE_URL||'http://127.0.0.1:5177';
async function request(service,path,method='GET',body){const response=await fetch(`${ui}/${service}-api${path}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok)throw Error(`${service} ${response.status}: ${await response.text()}`);return response.json();}
const sites=await request('community','/api/sites/'),site=sites.find(s=>s.name==='Demo Home');assert.ok(site,'Run seed:console first');
const assets=await request('community','/api/assets/'),asset=assets.find(a=>a.data.site_id===site.id);assert.ok(asset);
const profiles=await request('telemetry','/api/telemetry-profiles/'),cap=profiles.find(p=>p.asset_id===asset.id)?.capabilities[0];assert.ok(cap,'Wait for profile provisioning');
let user;
try{
 user=await request('community','/api/users/','POST',{name:'Temporary integration check',email:`console-check-${Date.now()}@example.org`,password:'Integration-2026',timezone:'Europe/Lisbon'});
 const check=()=>request('access','/api/access/check?'+new URLSearchParams({user_id:user.id,scope_type:'asset',scope_id:asset.id,action:'manage',resource_type:'asset'}));
 assert.equal((await check()).allowed,false);
 await request('community',`/api/users/${user.id}/site-accesses`,'POST',{site_id:site.id,relation:'owner',validity_start:'2026-01-01',validity_end:'2030-12-31'});
 assert.equal((await request('community',`/api/users/${user.id}`)).site_accesses.length,1);
 assert.equal((await check()).allowed,true);
 await request('telemetry',`/api/capabilities/${cap.capability_id}`,'PUT',{tag:'000-console-check',enabled:false});
 assert.equal((await request('telemetry',`/api/capabilities/${cap.capability_id}`)).tag,'000-console-check');
 await request('community',`/api/users/${user.id}/site-accesses/${site.id}`,'DELETE');
 assert.equal((await check()).allowed,false);
 const allowed=await request('flexibility',`/api/flexibility-events/available-types/${asset.id}`);assert.equal(allowed.asset_id,asset.id);assert.deepEqual(allowed.session_types,[]);
 assert.ok(Array.isArray(await request('flexibility','/api/flexibility-events/')));
 const sources=await request('telemetry','/api/measurements/sources');
 assert.ok(sources.sources.some(s=>s.database==='living_lab'&&s.collections.includes('building_R-H-01')));
 const fields=await request('telemetry','/api/measurements/sources/living_lab/building_R-H-01/fields');
 assert.ok(fields.timestamp&&fields.fields.some(f=>f.field==='observations.grid_meters.GR01.energy_in_total'));
 const until=new Date(Date.parse(fields.timestamp)+1),from=new Date(until-3600000);
 const query=new URLSearchParams({field:'observations.grid_meters.GR01.energy_in_total',from_ts:from.toISOString(),until_ts:until.toISOString(),limit:10});
 const path='/api/measurements/sources/living_lab/building_R-H-01/series?';
 const first=await request('telemetry',path+query);assert.ok(first.points.length&&first.next_cursor);assert.equal(first.unit,null);
 query.set('cursor',first.next_cursor);const second=await request('telemetry',path+query);
 assert.ok(second.points.every(p=>!first.points.some(q=>q.id===p.id)));
 const mapped=profiles.find(p=>p.asset_id===asset.id)?.capabilities.find(c=>c.mongo_binding);
 if(mapped){const latest=await request('telemetry',`/api/measurements/capabilities/${mapped.capability_id}/latest`);assert.ok(latest.point.timestamp&&latest.binding);}

 console.log('PASS: Community persistence, Access inheritance and revocation, Telemetry tag round-trip, Flexibility asset validation, Telemetry Mongo discovery, mapped readings and cursor pagination.');
}finally{
 await request('telemetry',`/api/capabilities/${cap.capability_id}`,'PUT',{tag:cap.tag,enabled:cap.enabled});
 if(user)await request('community',`/api/users/${user.id}`,'DELETE');
 await request('access','/api/access/reconcile','POST',{});
}
