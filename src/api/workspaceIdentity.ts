import { TRAINING_ENABLED, TRAINING_API } from './trainingContext';
import { MOCK_USERS } from '../constants';
import type { Session } from '../types';

async function read<T>(url:string):Promise<T>{
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Community sign-in is unavailable. Please try again.');
  return response.json();
}
/** One test sign-in for all roles. Community identities/ownership come from the
 * new backends; Jobs, predictor and KPI accounts retain their existing fixtures. */
export async function authenticateWorkspace(email:string,password:string,remember:boolean):Promise<Session>{
  const key=email.trim().toLowerCase(),fixture=MOCK_USERS[key];
  if (TRAINING_ENABLED && (!fixture || ['ai_manager','training_manager'].includes(fixture.role))) {
    const response = await fetch(TRAINING_API + '/api/training/session', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:key,password})});
    if (response.ok) return {...await response.json(),remember};
    if (fixture) throw new Error('Training sign-in failed. Check your credentials or service connection.');
  }
  if(fixture&&!['rec_manager','prosumer'].includes(fixture.role)){
    if(fixture.password!==password)throw new Error('Invalid email or password.');
    return {email:key,name:fixture.name,role:fixture.role,remember};
  }
  const [users,roles,grants]=await Promise.all([
    read<Array<{id:string;email:string;name:string}>>('/community-api/api/users/'),
    read<Array<{role_id?:string;id?:string;role_name:string}>>('/access-api/api/roles/'),
    read<Array<{role_id:string;user_id:string;grant_status:string;validity:{start:string;end:string}}>>('/access-api/api/grants/')
  ]);
  const user=users.find(user=>user.email.toLowerCase()===key);
  if(!user)throw new Error('Invalid email or password.');
  const managerRoles=new Set(roles.filter(role=>role.role_name==='rec_manager').map(role=>role.role_id||role.id));
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Lisbon'});
  const manager=grants.some(grant=>grant.user_id===user.id&&managerRoles.has(grant.role_id)&&grant.grant_status==='active'&&grant.validity.start<=today&&grant.validity.end>=today);
  if(password!==(manager?'rec123':'pros123'))throw new Error('Invalid email or password.');
  return {email:key,name:user.name,role:manager?'rec_manager':'prosumer',remember};
}

export async function updateCommunityIdentity(email:string,patch:Partial<Pick<Session,'name'|'email'>>):Promise<void>{
  const users=await read<Array<{id:string;email:string;name:string}>>('/community-api/api/users/');
  const user=users.find(user=>user.email.toLowerCase()===email.toLowerCase());
  if(!user)throw new Error('Your community account is no longer available.');
  const response=await fetch('/community-api/api/users/'+encodeURIComponent(user.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...user,...patch}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Your profile could not be saved. Check the name and email and try again.');
}
