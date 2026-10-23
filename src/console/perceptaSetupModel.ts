export type Connection={id:string;name:string;provider:string;settings?:{url?:string;host?:string;port?:number;vhost?:string;data_path?:string};has_credentials?:boolean};
export type Connector={id:string;name:string;transport:string;available:boolean;defaults:NonNullable<Connection['settings']>;credentials:'required'|'optional'|'none'};
export type Source={asset_id:string;connection_id:string;device_id:string|null};
export type Contract={parameter_type_id:string;vehicle_id?:string|null;parameter_key?:string|null;necessary:boolean;privacy:string;role:string;temporal_behavior?:{cumulative:boolean;periodicity:{value:number;unit:string};aggregation_operation:string;fill_operation:string}|null;source_binding?:{connection_id:string;fetch_key?:string|null;match_key?:string|null;topic?:string|null;shelly_accumulation?:string|null;mapping_required:boolean}|null};
export type Channel={version?:string|null;capability_id:string;name:string;unit:string;enabled:boolean;capability_type:string;data_type:string;quantity?:string;collection?:Contract|null};
export type Profile={profile_id:string;asset_type:string;entity_key?:string;capabilities:Channel[]};
export type Owner={id:string;name:string;scope:'assets'|'sites'|'recs'};
export async function api<T>(path:string,body?:unknown,method='GET'):Promise<T>{
 const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(!response.ok){const error=await response.json().catch(()=>({}));const failure=Object.assign(new Error(error.error?.message||(typeof error.detail==='string'?error.detail:JSON.stringify(error.detail||'Unable to save configuration'))),{status:response.status,code:error.error?.code});throw failure;}
 return response.json();
}
export function equipmentSource(owner:Owner,profile:Profile|null|undefined,sources:Source[],connections:Connection[]):Source|null{
 const stored=sources.find(source=>source.asset_id===owner.id);if(stored)return stored;
 const bindings=(profile?.capabilities||[]).filter(c=>c.enabled&&c.collection?.role==='input').map(c=>c.collection?.source_binding).filter(Boolean);
 const ids=new Set(bindings.map(b=>b!.connection_id));if(ids.size!==1)return null;
 const devices=new Set(bindings.map(b=>b!.fetch_key).filter(Boolean));
 return {asset_id:owner.id,connection_id:[...ids][0],device_id:devices.size===1&&['softcps','cleanwatts_2'].includes(connections.find(c=>c.id===[...ids][0])?.provider||'')?[...devices][0]!:null};
}
