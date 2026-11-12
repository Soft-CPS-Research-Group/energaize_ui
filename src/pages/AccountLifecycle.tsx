import {useCallback, useEffect, useState} from 'react';
import {AccountDeletion, type OwnedHome} from './AccountDeletion';
import {identity} from '../api/identityApi';

type Operation = {id:string; reason:string; status:string; retrying:boolean};
type Overview = {owned_homes?:OwnedHome[];owned_assets?:OwnedHome[];demo?:boolean;communities:Array<{id:string;name:string;owned_home_ids:string[]}>;operations:Operation[]};

export function AccountLifecycle():JSX.Element {
  const [data,setData]=useState<Overview|null>(null);
  const [error,setError]=useState(''); const [message,setMessage]=useState('');
  const [selected,setSelected]=useState('');const [password,setPassword]=useState('');const [confirmation,setConfirmation]=useState('');const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>setData(await identity<Overview>('/lifecycle')),[]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  async function leave(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('');setMessage('');
    try { const result=await identity<{message:string}>(`/communities/${selected}/leave`,'POST',{password,confirmation});setPassword('');setConfirmation('');setSelected('');await load();setMessage(result.message); }
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <>
    <section className="account-section"><div><h2>Your account data</h2><p>Download your profile, photo and access relationships.</p></div><div className="account-fields">
      <p>This account export excludes passwords, security links, other people’s profiles and shared home telemetry, models or jobs.</p>
      <a className="btn btn-secondary" href="/community-api/api/identity/export" download="energaize-account.json">Download account data</a>
    </div></section>
    <section className="account-section"><div><h2>Community membership</h2><p>Leaving removes access to that community and its homes. Your other communities and your account stay available.</p></div><div className="account-fields">
      {error&&<p role="alert" className="error-text">{error}</p>}{message&&<p role="status" className="account-feedback">{message}</p>}
      {!data&&!error&&<p role="status">Loading memberships…</p>}
      {data?.communities.map(c=><div key={c.id}><strong>{c.name}</strong>{c.owned_home_ids.length>0?<p>Transfer your home ownership before leaving this community.</p>:<button className="btn text" disabled={busy} onClick={()=>{setSelected(c.id);setPassword('');setConfirmation('');}}>Leave community</button>}</div>)}
      {data&&!data.communities.length&&<p>No active community memberships.</p>}
      {selected&&<form className="account-fields" onSubmit={e=>void leave(e)}><h3>Leave {data?.communities.find(c=>c.id===selected)?.name}?</h3><p>Your access is removed immediately. Updates to connected services may continue in the background. A new invitation is needed to return.</p>
        <label>Current password<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <label>Type LEAVE to confirm<input required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
        <button className="btn btn-primary" disabled={busy||confirmation!=='LEAVE'}>{busy?'Removing access…':'Confirm departure'}</button><button type="button" className="btn text" disabled={busy} onClick={()=>setSelected('')}>Keep membership</button>
      </form>}
      {!!data?.operations.length&&<><h3>Recent account operations</h3>{data.operations.map(op=><p key={op.id}>{op.reason==='membership_ended'?'Community departure':'Access update'} · {op.status==='applied'?'Completed':op.retrying?'Updating connected services · retrying':'Updating connected services'}</p>)}<button className="btn text" disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>Refresh status</button></>}
    </div></section>
    {data&&<AccountDeletion homes={data.owned_homes??[]} assets={data.owned_assets??[]} demo={data.demo??true} onChange={load}/>}
  </>;
}
