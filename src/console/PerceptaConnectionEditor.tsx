import {useState} from 'react';
import {runtimeRequest as runtime} from '../api/runtimeApi';
import type {Connection,Connector} from './perceptaSetupModel';
export function PerceptaConnectionEditor({communityId,connection,connectors,onSave,onCancel,onBusyChange}:{communityId:string;connection?:Connection;connectors:Connector[];onSave:(c:Connection)=>void;onCancel:()=>void;onBusyChange:(busy:boolean)=>void}){
 const first=connectors.find(c=>c.id===connection?.provider)||connectors.find(c=>c.available);
 const [provider,setProvider]=useState(first?.id||''),[name,setName]=useState(connection?.name||'');
 const values={...first?.defaults,...connection?.settings};
 const [address,setAddress]=useState(values.url||values.host||''),[path,setPath]=useState(values.data_path||'');
 const [port,setPort]=useState(values.port||5672),[vhost,setVhost]=useState(values.vhost||'/');
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const connector=connectors.find(c=>c.id===provider),broker=connector?.transport==='amqp';
 const select=(id:string)=>{const c=connectors.find(c=>c.id===id)!;setProvider(id);setAddress(c.defaults.url||c.defaults.host||'');setPath(c.defaults.data_path||'');setPort(c.defaults.port||5672);setVhost(c.defaults.vhost||'/');setUsername('');setPassword('');};
 return <form onSubmit={async event=>{event.preventDefault();setBusy(true);onBusyChange(true);setError('');try{
  const auth={...(username?{username}:{}),...(password?{password}:{})};
  const configuration=broker?{host:address,port,vhost,ssl_conf:{enabled:port===5671}}:{url:address,data_path:path||connector?.defaults.data_path};
  const saved=await runtime<Connection>('/api/runtime/connections'+(connection?'/'+connection.id:''),{method:connection?'PUT':'POST',body:JSON.stringify({name:name||connector?.name,community_id:communityId,provider,configuration:{...configuration,...(Object.keys(auth).length?{auth}:{})}})});
  setUsername('');setPassword('');onSave(saved);
 }catch(e){setError((e as Error).message);}finally{setBusy(false);onBusyChange(false);}}}>
  <h4>{connection?'Edit source':'Add a data source'}</h4>{connection&&<p className="percepta-helper">Shared source. Changes affect all equipment using it.</p>}{error&&<p role="alert">{error}</p>}
  <fieldset disabled={busy} className="percepta-wizard-content"><div className="percepta-fields">
   <label>Service<select value={provider} disabled={!!connection} onChange={e=>select(e.target.value)}>{connectors.filter(c=>c.available).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label>Name<input value={name} onChange={e=>setName(e.target.value)} placeholder={connector?.name}/></label>
   <label>{broker?'Server address':'Service address'}<input required value={address} onChange={e=>setAddress(e.target.value)} placeholder={broker?'broker.example.com':'https://your-service.example'}/></label>
  </div>
  {connector?.credentials!=='none'&&<><div className="percepta-fields"><label>Username<input required={connector?.credentials==='required'&&!connection?.has_credentials} autoComplete="off" value={username} onChange={e=>setUsername(e.target.value)}/></label><label>Password<input required={connector?.credentials==='required'&&!connection?.has_credentials} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label></div><p className="percepta-helper">{connection?.has_credentials?'Credentials saved. Leave blank to keep them.':'Use the credentials for this service. They are stored encrypted in the backend.'}</p></>}
  <details><summary>Advanced connection settings</summary><p className="percepta-helper">The connector supplies the standard endpoint. Change it only if your server uses a different one.</p>{broker?<div className="percepta-fields"><label>Port<input type="number" min="1" max="65535" required value={port} onChange={e=>setPort(Number(e.target.value))}/></label><label>Virtual host<input value={vhost} onChange={e=>setVhost(e.target.value)}/></label></div>:<label>Data endpoint<input value={path} onChange={e=>setPath(e.target.value)}/></label>}</details>
  <footer className="percepta-editor-actions"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={!connector}>Save source</button></footer></fieldset>
 </form>;
}
