import type { Session } from '../types';
export async function identity<T>(path:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch('/community-api/api/identity'+path,{method,credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(35000)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'Please check the details and try again.');
  return result as T;
}
export const currentAccount=()=>identity<Session>('/me');
export interface Person extends Session {activated:boolean;homes:Array<{site_id:string;relation:string}>;invitation?:{site_id?:string;rec_id?:string;relation:string;expired?:boolean}|null;email_delivery?:string|null;}
export interface PeopleDirectory {people:Person[];homes:Array<{id:string;name?:string;details?:{name?:string}}>;shareable_homes:string[];communities:Array<{id:string;name:string}>;}
