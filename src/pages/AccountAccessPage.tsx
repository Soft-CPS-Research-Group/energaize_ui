import {useEffect,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {identity} from '../api/identityApi';
import './Accounts.css';
export function AccountAccessPage({recovery=false}:{recovery?:boolean}):JSX.Element{
  const [params]=useSearchParams();const token=params.get('token')||'';
  const [info,setInfo]=useState<{purpose:string;needs_password:boolean;login:string}|null>(null);
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [repeat,setRepeat]=useState('');const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(!recovery);
  useEffect(()=>{if(recovery)return;let active=true;identity<{purpose:string;needs_password:boolean;login:string}>('/action?token='+encodeURIComponent(token)).then(value=>{if(active)setInfo(value);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[token,recovery]);
  const title=recovery?'Reset your password':info?.purpose==='verify'?'Confirm your email':info?.purpose==='share'?'Your home invitation':info?.purpose==='reset'?'Choose a new password':'Welcome to EnergAIze';
  return <main className="access-page"><section className="access-content"><img className="access-brand" src="/assets/logos/energaize-light.png" alt="EnergAIze"/><h1>{title}</h1>
    <p>{recovery?'Enter your sign-in identifier or confirmed contact email. We will send a link to your contact email.':info?.needs_password?'Choose your password to continue.':info?'Confirm below to finish.':'Checking your link…'}</p>
    {error&&<p role="alert" className="error-text">{error}</p>}{message&&<p role="status" className="account-feedback">{message}</p>}
    {!message&&(recovery||info)&&<form className="account-fields" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{if(!recovery&&info?.needs_password&&password!==repeat)throw Error('The passwords do not match.');const result=await identity<{message:string}>(recovery?'/forgot-password':'/action','POST',recovery?{email}:{token,...(info?.needs_password?{password}:{})});setMessage(result.message);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
      {recovery?<label>Email<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>:<p>Sign in as <strong>{info?.login}</strong></p>}
      {!recovery&&info?.needs_password&&<><label>New password<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Repeat password<input type="password" required minLength={8} autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)}/></label></>}
      <button className="btn btn-primary" disabled={busy}>{busy?'Please wait…':recovery?'Send recovery link':info?.needs_password?'Save password':'Confirm'}</button>
    </form>}
    <Link to="/login">Back to sign in</Link>{!recovery&&error&&<><br/><Link to="/forgot-password">Request a new password link</Link></>}
  </section></main>;
}
