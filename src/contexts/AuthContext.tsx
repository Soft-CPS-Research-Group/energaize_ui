import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {authenticateWorkspace} from '../api/workspaceIdentity';
import {currentAccount,identity} from '../api/identityApi';
import type {Session,UserRole} from '../types';
import {STORAGE_KEYS} from '../utils/storage';
interface AuthContextValue {
  session:Session|null;isAuthenticated:boolean;isLoading:boolean;
  login:(payload:{email:string;password:string;remember:boolean})=>Promise<Session>;
  logout:()=>Promise<void>;
  updateProfile:(patch:{name:string;timezone:string;language:string})=>Promise<void>;
  refreshProfile:()=>Promise<void>;switchRole:(role:UserRole)=>Promise<void>;
}
const AuthContext=createContext<AuthContextValue|undefined>(undefined);
export function AuthProvider({children}:{children:ReactNode}):JSX.Element{
  const [session,setSession]=useState<Session|null>(null);const [isLoading,setLoading]=useState(true);
  useEffect(()=>{let active=true;
    localStorage.removeItem(STORAGE_KEYS.session);sessionStorage.removeItem(STORAGE_KEYS.session);sessionStorage.removeItem('console-session-email');
    currentAccount().then(value=>{if(active)setSession(value);}).catch(()=>{if(active)setSession(null);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
  },[]);
  const login=useCallback(async(payload:{email:string;password:string;remember:boolean})=>{const value=await authenticateWorkspace(payload.email,payload.password,payload.remember);setSession(value);return value;},[]);
  const logout=useCallback(async()=>{await identity('/logout','POST');setSession(null);sessionStorage.removeItem('console-session-email');},[]);
  const refreshProfile=useCallback(async()=>{setSession(await currentAccount());},[]);
  const updateProfile=useCallback(async(patch:{name:string;timezone:string;language:string})=>{setSession(await identity<Session>('/me','PATCH',patch));},[]);
  const switchRole=useCallback(async(role:UserRole)=>{setSession(await identity<Session>('/role','POST',{role}));},[]);
  const value=useMemo(()=>({session,isAuthenticated:!!session,isLoading,login,logout,updateProfile,refreshProfile,switchRole}),[session,isLoading,login,logout,updateProfile,refreshProfile,switchRole]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth():AuthContextValue{const value=useContext(AuthContext);if(!value)throw new Error('useAuth must be used inside AuthProvider');return value;}
