import {useState} from 'react';
import {identity} from '../api/identityApi';

export type OwnedHome = {id:string;name:string;candidates:Array<{id:string;name:string}>};
export function AccountDeletion({homes,assets,demo,onChange}:{homes:OwnedHome[];assets:OwnedHome[];demo:boolean;onChange:()=>Promise<void>}):JSX.Element {
  const [home,setHome]=useState('');const [kind,setKind]=useState<'homes'|'assets'>('homes');const [recipient,setRecipient]=useState('');const [mode,setMode]=useState<'transfer'|'erase'|''>('');
  const [password,setPassword]=useState('');const [confirmation,setConfirmation]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
  const word=mode==='transfer'?'TRANSFER':'DELETE';
  function open(next:'transfer'|'erase',id='',resource:'homes'|'assets'='homes'){setKind(resource);setMode(next);setHome(id);setRecipient('');setPassword('');setConfirmation('');setError('');setMessage('');}
  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      if(mode==='transfer'){
        const result=await identity<{message:string}>(`/${kind}/${home}/transfer-ownership`,'POST',{new_owner_id:recipient,password,confirmation});
        setMode('');setPassword('');setConfirmation('');await onChange();setMessage(result.message);
      }else{
        const result=await identity<{receipt:string}>('/erase','POST',{password,confirmation});
        window.location.assign('/account-deleted#'+encodeURIComponent(result.receipt));
      }
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="account-section"><div><h2>Delete account</h2><p>Remove your profile and access to EnergAIze.</p></div><div className="account-fields">
    <p>Your name, email, photo, password and sign-in sessions are removed. Shared homes, equipment, readings and technical history stay with the community. Technical records may retain an account ID without your profile or contact details.</p>
    <p>Deletion cannot be undone. Connected services may take a little longer; you will receive a private status page. Backup copies expire through the backup retention process.</p>
    {demo?<p>This demonstration account is preserved for platform tests and cannot be deleted.</p>:<>
      {homes.map(h=><div key={h.id}><strong>{h.name}</strong><p>Transfer ownership before deleting your account.</p>{h.candidates.length?<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>open('transfer',h.id)}>Transfer ownership of {h.name}</button>:<p>Invite another person through Homes and people. They must accept before you can transfer ownership.</p>}</div>)}
      {assets.map(a=><div key={a.id}><strong>{a.name}</strong>{a.candidates.length?<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>open('transfer',a.id,'assets')}>Transfer ownership of {a.name}</button>:<p>Ask your community manager to add the new owner to this equipment before transferring it.</p>}</div>)}
      {!homes.length&&!assets.length&&mode!=='erase'&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>open('erase')}>Delete my account</button>}
    </>}
    {mode&&<form className="account-fields" onSubmit={e=>void submit(e)}><h3>{mode==='transfer'?'Transfer ownership':'Permanently delete your account?'}</h3>
      {mode==='transfer'&&<><p>The new owner can manage this resource. Your existing shared access remains until you leave or delete your account.</p><label>New owner<select required value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">Choose a member</option>{(kind==='homes'?homes:assets).find(h=>h.id===home)?.candidates.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></>}
      <label>Current password<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <label>Type {word} to confirm<input required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
      <button className="btn btn-primary" disabled={busy||confirmation!==word||!password||(mode==='transfer'&&!recipient)}>{busy?'Processing…':mode==='transfer'?'Confirm ownership transfer':'Confirm account deletion'}</button>
      <button type="button" className="btn text" disabled={busy} onClick={()=>{setMode('');setPassword('');}}>Cancel</button>
    </form>}
    {error&&<p role="alert" className="error-text">{error}</p>}{message&&<p role="status" className="account-feedback">{message}</p>}
  </div></section>;
}
