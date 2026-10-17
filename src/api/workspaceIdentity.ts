import {identity} from './identityApi';
import type {Session} from '../types';
export async function authenticateWorkspace(email:string,password:string,remember:boolean):Promise<Session>{
  return identity<Session>('/login','POST',{email:email.trim().toLowerCase(),password,remember});
}
