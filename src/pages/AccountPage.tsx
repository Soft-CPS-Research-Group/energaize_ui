import {useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {UserCircle2} from 'lucide-react';
import {useAuth} from '../contexts/AuthContext';
import {useUI} from '../contexts/UIContext';
import {identity} from '../api/identityApi';
import {PageHeader} from '../components/ui/PageHeader';
import {roleHomePath,roleLabel} from '../utils/roles';
import './Accounts.css';
export function AccountPage():JSX.Element{
  const {session,updateProfile,refreshProfile,logout,switchRole}=useAuth();const {theme,setTheme}=useUI();const navigate=useNavigate();
  const [name,setName]=useState(session?.name||'');const [timezone,setTimezone]=useState(session?.timezone||'Europe/Lisbon');const [language,setLanguage]=useState(session?.language||'pt');
  const [email,setEmail]=useState(session?.contact_email||'');const [emailPassword,setEmailPassword]=useState('');
  const [current,setCurrent]=useState('');const [password,setPassword]=useState('');const [repeat,setRepeat]=useState('');
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
  async function run(action:()=>Promise<void>,success:string){setBusy(true);setError('');setMessage('');try{await action();setMessage(success);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function upload(file:File){if(file.size>5_000_000)throw Error('Choose an image up to 5 MB.');const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});await identity('/avatar','PUT',{data});await refreshProfile();}
  return <div className="page account-page account-workspace">
    <PageHeader title="My account" subtitle="Your profile, contact details and sign-in."/>
    {message&&<p role="status" className="account-feedback">{message}</p>}{error&&<p role="alert" className="error-text">{error}</p>}
    <section className="account-section"><div><h2>Profile</h2><p>Your name and photo appear across EnergAIze.</p></div><div>
      <div className="account-photo-row">{session?.avatar_url?<img className="account-photo" src={session.avatar_url} alt={session.name}/>:<UserCircle2 size={80} aria-label="No profile photo"/>}<div>
        <label className="btn btn-secondary account-upload">Choose photo<input aria-label="Profile photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void run(()=>upload(file),'Photo saved.');e.target.value='';}}/></label>
        {session?.avatar_url&&<button type="button" className="btn text" disabled={busy} onClick={()=>void run(async()=>{await identity('/avatar','DELETE');await refreshProfile();},'Photo removed.')}>Remove</button>}<small>JPG, PNG or WebP · up to 5 MB</small>
      </div></div>
      <form className="account-fields" onSubmit={e=>{e.preventDefault();void run(()=>updateProfile({name,timezone,language}),'Profile saved.');}}>
        <label>Full name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
        <label>Timezone<input required list="account-timezones" value={timezone} onChange={e=>setTimezone(e.target.value)}/><datalist id="account-timezones"><option>Europe/Lisbon</option><option>Atlantic/Azores</option><option>Europe/Madrid</option><option>UTC</option></datalist></label>
        <label>Language preference<select value={language} onChange={e=>setLanguage(e.target.value)}><option value="pt">Português</option><option value="en">English</option></select></label><button className="btn btn-primary" disabled={busy}>Save profile</button>
      </form>
    </div></section>
    <section className="account-section"><div><h2>Contact email</h2><p>Invitations and password recovery arrive here.</p><small>Sign-in identifier: {session?.email}</small></div>
      <form className="account-fields" onSubmit={e=>{e.preventDefault();void run(async()=>{await identity('/contact-email','POST',{email,password:emailPassword});setEmailPassword('');},'Confirmation requested. Open the link in your new email to finish.');}}>
        <p>{session?.email_verified?'Email confirmed':session?.contact_email?'Email confirmation needed':'Add an email to enable password recovery'}</p>
        <label>Contact email<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label>Current password<input required type="password" autoComplete="current-password" value={emailPassword} onChange={e=>setEmailPassword(e.target.value)}/></label><button className="btn btn-primary" disabled={busy}>Send confirmation link</button>
      </form>
    </section>
    <section className="account-section"><div><h2>Password</h2><p>Changing your password signs out your existing sessions.</p></div>
      <form className="account-fields" onSubmit={e=>{e.preventDefault();void run(async()=>{if(password!==repeat)throw Error('The new passwords do not match.');await identity('/password','POST',{current_password:current,password});await logout();navigate('/login',{state:{accountMessage:'Password changed. Sign in with your new password.'}});},'Password changed.');}}>
        <label>Current password<input required type="password" autoComplete="current-password" value={current} onChange={e=>setCurrent(e.target.value)}/></label>
        <label>New password<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <label>Repeat new password<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)}/></label><button className="btn btn-primary" disabled={busy}>Change password</button>
      </form>
    </section>
    <section className="account-section"><div><h2>Workspace</h2><p>Your assigned roles and display preferences.</p></div><div className="account-fields">
      <label>Active role<select value={session?.role} disabled={busy} onChange={e=>{const role=e.target.value as NonNullable<typeof session>['role'];void run(async()=>{await switchRole(role);navigate(roleHomePath(role));},'Workspace changed.');}}>{(session?.roles||[session!.role]).map(role=><option key={role} value={role}>{roleLabel(role)}</option>)}</select></label>
      <label>Appearance<select value={theme} onChange={e=>setTheme(e.target.value as 'light'|'dark')}><option value="light">Light</option><option value="dark">Dark</option></select></label>
      {(session?.role==='rec_manager'||session?.role==='prosumer')&&<Link className="btn btn-secondary" to="/app/people">Homes and people</Link>}
    </div></section>
  </div>;
}
