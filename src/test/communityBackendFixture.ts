import { http, HttpResponse } from 'msw';
import { server } from './server';

export function useCommunityBackendFixture() {
  const recs=[{id:'rec-live',name:'Connected community',localization:{name:'Porto',latitude:41,longitude:-8},action_interval_seconds:900}];
  const users=[
    {id:'manager',name:'REC Manager',email:'rec@energaize.io',rec_memberships:[],site_accesses:[],asset_ownerships:[]},
    {id:'resident',name:'Resident',email:'prosumer@energaize.io',rec_memberships:[{rec_id:'rec-live',membership_status:'active'}],site_accesses:[{site_id:'owned-site',relation:'owner',validity_start:'2000-01-01',validity_end:'2099-12-31'}],asset_ownerships:[]}
  ];
  const roles=[{role_id:'manager-role',role_name:'rec_manager'}];
  const grants=[{role_id:'manager-role',user_id:'manager',grant_status:'active',validity:{start:'2000-01-01',end:'2099-12-31'}}];
  const sites=[{id:'owned-site',name:'My connected home',site_type:'residential',assigned_rec_id:'rec-live',external_references:[]},{id:'other-site',name:'Another member’s home',site_type:'residential',assigned_rec_id:'rec-live',external_references:[]}];
  const responses:Record<string,unknown>={
    '/community-api/api/identity/permissions':{read_site:['owned-site'],manage_site:['owned-site'],control_site:['owned-site']},
    '/community-api/api/recs/':recs,'/community-api/api/users/':users,'/community-api/api/sites/':sites,'/community-api/api/assets/':[],
    '/access-api/api/roles/':roles,'/access-api/api/grants/':grants,'/telemetry-api/api/telemetry-profiles/':[],
    '/flexibility-api/api/flexibility-events/':[],'/flexibility-api/api/calendars/':[],
    '/runtime-api/api/runtime/instances':[], '/community-api/api/configuration-reviews':[]
  };
  server.use(...Object.entries(responses).map(([path,value])=>http.get('*'+path,()=>new HttpResponse(JSON.stringify(value),{headers:{'Content-Type':'application/json'}}))),
    http.get('*/access-api/api/access/check',()=>HttpResponse.json({allowed:true})),
    http.post('*/community-api/api/recs/',async({request})=>{const rec={...await request.json() as typeof recs[0],id:'new-rec'};recs.push(rec);return HttpResponse.json(rec,{status:201});}),
    http.post('*/access-api/api/grants/',()=>HttpResponse.json({id:'new-grant'},{status:201}))
  );
  return {recs,users,roles,grants};
}
