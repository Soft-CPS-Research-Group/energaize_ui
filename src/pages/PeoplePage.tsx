import {useCallback,useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {identity,type PeopleDirectory} from '../api/identityApi';
import {useAuth} from '../contexts/AuthContext';
import {PageHeader} from '../components/ui/PageHeader';
import {roleLabel} from '../utils/roles';
import './Accounts.css';
export function PeoplePage():JSX.Element{
  const {session}=useAuth();const [directory,setDirectory]=useState<PeopleDirectory|null>(null);const [name,setName]=useState('');const [email,setEmail]=useState('');const [resource,setResource]=useState('');const [relation,setRelation]=useState('visitor');const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{setDirectory(await identity<PeopleDirectory>('/people'));},[]);useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  async function run(action:()=>Promise<unknown>,success:string){setBusy(true);setError('');setMessage('');try{await action();await load();setMessage(success);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const homeName=(id:string)=>{const h=directory?.homes.find(h=>h.id===id);return h?.name||h?.details?.name||'Home';};const shareable=directory?.homes.filter(h=>directory.shareable_homes.includes(h.id))||[];
  return <div className="page account-workspace"><PageHeader title="Homes and people" subtitle="Manage shared access and invite people to your homes or community."/><Link to="/app/account">My account</Link>
    {error&&<p role="alert" className="error-text">{error}</p>}{message&&<p role="status" className="account-feedback">{message}</p>}{!directory&&!error&&<p role="status">Loading your homes…</p>}
    {directory&&<><section className="account-section"><div><h2>Invite someone</h2><p>They receive a link to activate their account and accept access.</p></div>
      {shareable.length||directory.communities.length?<form className="account-fields" onSubmit={e=>{e.preventDefault();void run(async()=>{const [kind,id]=resource.split(':');await identity('/invitations','POST',{name,email,relation,...(kind==='site'?{site_id:id}:{rec_id:id})});setName('');setEmail('');},'Invitation queued. You can resend it below if needed.');}}>
        <label>Name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><label>Email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label>Home or community<select required value={resource} onChange={e=>setResource(e.target.value)}><option value="">Choose…</option>{shareable.map(h=><option key={h.id} value={'site:'+h.id}>{homeName(h.id)}</option>)}{directory.communities.map(c=><option key={c.id} value={'rec:'+c.id}>{c.name} · community member</option>)}</select></label>
        {resource.startsWith('site:')&&<label>Access<select value={relation} onChange={e=>setRelation(e.target.value)}>{session?.role==='rec_manager'&&<option value="owner">Home owner · manage and share</option>}<option value="visitor">View home</option><option value="manager">Manage home and equipment</option></select></label>}<button className="btn btn-primary" disabled={busy}>Send invitation</button>
      </form>:<p>Your community manager can assign a home to your account. Home owners can then invite other residents.</p>}
    </section><h2>People with shared access</h2><div className="people-table-wrap"><table className="people-table"><thead><tr><th>Person</th><th>Account</th><th>Homes and access</th><th>Invitation</th></tr></thead><tbody>
      {directory.people.map(p=><tr key={p.id}><td>{p.name}<small>{p.contact_email||p.email}</small></td><td>{(p.roles||[p.role]).map(roleLabel).join(', ')}<small>{p.activated?'Active':'Awaiting activation'}</small></td><td>
        {p.homes.map(h=><div key={h.site_id} className="people-actions"><span>{homeName(h.site_id)} · {h.relation}</span>{directory.shareable_homes.includes(h.site_id)&&h.relation!=='owner'&&p.id!==session?.id&&<><select aria-label={'Access for '+p.name+' at '+homeName(h.site_id)} disabled={busy} value={h.relation} onChange={e=>void run(()=>identity(`/homes/${h.site_id}/members/${p.id}`,'PATCH',{relation:e.target.value}),'Access updated.')}><option value="visitor">View</option><option value="manager">Manage</option></select><button className="btn text" disabled={busy} onClick={()=>{if(window.confirm(`Remove ${p.name}'s access to ${homeName(h.site_id)}?`))void run(()=>identity(`/homes/${h.site_id}/members/${p.id}`,'DELETE'),'Access removed.');}}>Remove access</button></>}</div>)}{!p.homes.length&&<span>—</span>}
      </td><td>{p.invitation?<><small>{p.invitation.expired?'Invitation expired. Send a new link.':p.email_delivery==='failed'?'Email could not be queued. Please resend.':p.email_delivery==='queued'?'Queued with email service':'Pending email delivery'}</small><button className="btn text" disabled={busy} onClick={()=>void run(()=>identity(`/invitations/${p.id}/resend`,'POST'),'Invitation resent.')}>Resend invitation</button></>:'—'}</td></tr>)}
    </tbody></table></div></>}
  </div>;
}
