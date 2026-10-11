/* Relationship selectors shared by the manager editor and the personal workspace. */
(function(root){
 const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Lisbon'});
 const active=(r,date=today())=>!!r.validity_start&&!!r.validity_end&&r.validity_start<=date&&date<=r.validity_end;
 const siteRelation=(u,id,date=today())=>u.site_accesses.find(r=>r.site_id===id&&active(r,date));
 const assetRelation=(u,id)=>u.asset_ownerships.find(r=>r.energy_asset_id===id);
 function sitePermission(u,id,action='read',date=today()){const r=siteRelation(u,id,date);return !!r&&(action==='read'||['owner','manager'].includes(r.relation));}
 function assetPermission(u,a,action='read',date=today()){
  const own=assetRelation(u,a.id);
  if(own&&(action==='read'||own.ownership_type==='owned'||action==='control'&&own.ownership_type==='leased'))return true;
  return a.asset_type!=='ev'&&!!a.site_id&&['owner','manager'].includes(siteRelation(u,a.site_id,date)?.relation);
 }
 function validateUser(u,catalog){
  if(!u.name.trim()||!/^\S+@\S+\.\S+$/.test(u.email))throw Error('Enter a name and valid email.');
  for(const [items,key] of [[u.rec_memberships,'rec_id'],[u.site_accesses,'site_id'],[u.asset_ownerships,'energy_asset_id']])if(new Set(items.map(x=>x[key])).size!==items.length)throw Error('Each resource can only be associated once.');
  for(const m of u.rec_memberships)if(!catalog.recs.includes(m.rec_id)||!['active','pending','inactive'].includes(m.membership_status)||!['individual','organization'].includes(m.member_type))throw Error('Invalid community membership.');
  for(const s of u.site_accesses)if(!catalog.sites.includes(s.site_id)||!['owner','manager','visitor'].includes(s.relation)||!s.validity_start||!s.validity_end||s.validity_end<s.validity_start)throw Error('Choose a valid site, relation and date range.');
  for(const a of u.asset_ownerships)if(!catalog.assets.includes(a.energy_asset_id)||!['owned','leased','shared'].includes(a.ownership_type))throw Error('Choose a valid equipment association.');
  return u;
 }
 root.PeopleModel={today,active,siteRelation,assetRelation,sitePermission,assetPermission,validateUser};
})(globalThis);
