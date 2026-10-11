// Explicitly synthetic local accounts; never associates people from the Excel by name.
const base=process.env.COMMUNITY_API_URL||'http://127.0.0.1:8017';
const access=process.env.ACCESS_API_URL||'http://127.0.0.1:8018';
async function req(path,method='GET',body,url=base){const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(await r.text());return r.json();}
const recs=await req('/api/recs/');
let rec=recs.find(r=>r.name==='Console Sandbox');if(!rec){rec=await req('/api/recs/','POST',{name:'Console Sandbox',action_interval_seconds:900,localization:{name:'Local test environment',latitude:41.15,longitude:-8.61}});recs.push(rec);}
const sites=await req('/api/sites/');
const owned=[];for(const name of ['Demo Home','Demo Second Home']){let s=sites.find(s=>s.name===name&&s.assigned_rec_id===rec.id);if(!s)s=await req('/api/sites/','POST',{name,site_type:'residential',objective_preference:'cost',assigned_rec_id:rec.id});owned.push(s);}
const assets=await req('/api/assets/');
for(const s of owned){if(!assets.some(a=>a.data.site_id===s.id)){assets.push(await req('/api/assets/grid-meters','POST',{name:'Grid meter',site_id:s.id}));}}
const users=await req('/api/users/');
let member=users.find(u=>u.email==='prosumer@energaize.io');if(!member){member=await req('/api/users/','POST',{name:'Demo Resident',email:'prosumer@energaize.io',password:'Console-demo-2026',timezone:'Europe/Lisbon',rec_memberships:[{rec_id:rec.id,member_type:'individual',membership_status:'active'}],site_accesses:owned.map(s=>({site_id:s.id,relation:'owner',validity_start:'2026-01-01',validity_end:'2030-12-31'}))});}
let manager=users.find(u=>u.email==='rec@energaize.io');if(!manager)manager=await req('/api/users/','POST',{name:'REC Manager',email:'rec@energaize.io',password:'Console-manager-2026',timezone:'Europe/Lisbon'});
await req('/api/access/reconcile','POST',{},access);
const roles=await req('/api/roles/','GET',undefined,access),role=roles.find(r=>r.role_name==='rec_manager'),grants=await req('/api/grants/','GET',undefined,access);
for(const r of recs)if(!grants.some(g=>g.user_id===manager.id&&g.role_id===(role.role_id||role.id)&&g.scope.scope_id===r.id))await req('/api/grants/','POST',{user_id:manager.id,role_id:role.role_id||role.id,scope:{scope_type:'rec',scope_id:r.id},validity:{start:'2026-01-01',end:'2030-12-31'},grant_status:'active'},access);
console.log('Local console accounts ready; existing ownership was preserved.');
