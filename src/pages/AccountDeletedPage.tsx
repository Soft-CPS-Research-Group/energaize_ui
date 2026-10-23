import {useCallback,useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {identity} from '../api/identityApi';
import {InstitutionalDock} from '../components/layout/InstitutionalDock';
import './Accounts.css';
export function AccountDeletedPage():JSX.Element{
  const [status,setStatus]=useState('');const [retrying,setRetrying]=useState(false);const [error,setError]=useState('');
  const receipt=window.location.hash.slice(1);
  const refresh=useCallback(async()=>{
    try{if(!/^[a-f0-9-]{36}$/i.test(receipt))throw Error('Open the private status link provided when you deleted your account.');
      const result=await identity<{status:string;retrying:boolean}>(`/erasure-status/${encodeURIComponent(receipt)}`);setStatus(result.status);setRetrying(result.retrying);setError('');
    }catch(e){setError((e as Error).message);}
  },[receipt]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),10000);return()=>window.clearInterval(timer);},[refresh]);
  return <><main className="access-page"><section className="access-content"><img className="access-brand" src="/assets/logos/energaize-light.png" alt="EnergAIze"/><h1>Account deletion</h1>
    {error?<p role="alert">{error}</p>:status==='applied'?<p role="status">Your account has been deleted and connected access has been revoked.</p>:status?<p role="status">Your profile and sign-in have been removed. Connected services are still being updated{retrying?'; we are retrying automatically':''}.</p>:<p role="status">Checking your deletion request…</p>}
    <p>Shared homes, equipment, readings and technical history remain available to their authorised members. Backup copies expire through the retention process.</p>
    <p>Keep this private page to check the result. It contains no personal account details.</p><button className="btn btn-secondary" onClick={()=>void refresh()}>Refresh status</button><Link to="/login">Back to sign in</Link>
  </section></main><InstitutionalDock/></>;
}
