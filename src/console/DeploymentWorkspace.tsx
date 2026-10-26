import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, Box, Cable, CheckCircle2, Circle, Cpu, HardDrive, Network, Radio, RefreshCw, Server} from 'lucide-react';
import {runtimeRequest} from '../api/runtimeApi';
import {RuntimePanel} from './RuntimePanel';

interface Check {state:string;checked_at?:string|null;architecture?:string|null;memory_bytes?:number|null;cpus?:number|null;network_ready?:boolean|null;memory_limits?:boolean|null;message?:string|null}
interface Destination {id:string;name:string;placement:string;registered:boolean;check:Check}
interface Component {id:string;name:string;kind:string;destination_id:string;planned_destination_id:string;state:string;health?:string|null;instance_id?:string|null;image?:string|null;planned:boolean;supported:boolean}
interface Link {id:string;source:string;target:string;label:string;endpoint?:string|null;port?:number|null;state:string;message:string}
export interface DeploymentMap {site_id:string;revision:string|null;destinations:Destination[];components:Component[];links:Link[];warnings:string[]}
const states:Record<string,string>={online:'Online',unreachable:'Unreachable',needs_setup:'Setup required',not_checked:'Not checked',not_registered:'Not registered',stale:'Check expired',running:'Running',exited:'Stopped',not_deployed:'Not deployed',created:'Created',missing:'Container missing',simulation:'Simulation',unknown:'Unknown',configured:'Configured · unverified',not_configured:'Not configured'};
const stateName=(state:string)=>states[state]||state.replaceAll('_',' ');
const stamp=(value?:string|null)=>value?new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Not checked';
const icon=(kind:string)=>kind==='percepta'?<Radio size={21}/>:kind==='controller'?<Cpu size={21}/>:<Network size={21}/>;

export function DeploymentWorkspace({siteId,siteName,navigate}:{siteId:string;siteName:string;navigate:(path:string)=>void}) {
 const [map,setMap]=useState<DeploymentMap|null>(null),[error,setError]=useState(''),[checking,setChecking]=useState(false),[selected,setSelected]=useState<'percepta'|'controller'|null>(null);
 const sequence=useRef(0);
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),10000);return()=>clearInterval(timer);},[]);
 const load=useCallback(async(check=false)=>{
  const current=++sequence.current;setError('');if(check)setChecking(true);
  try {const result=await runtimeRequest<DeploymentMap>(`/api/runtime/sites/${encodeURIComponent(siteId)}/${check?'deployment-check':'deployment-view'}`,check?{method:'POST',signal:AbortSignal.timeout(60000)}:undefined);if(current===sequence.current)setMap(result);}
  catch(e){if(current===sequence.current)setError((e as Error).message);}
  finally{if(current===sequence.current)setChecking(false);}
 },[siteId]);
 useEffect(()=>{setMap(null);setSelected(null);void load();return()=>{sequence.current++;};},[load]);
 if(selected)return <section className="deployment-detail"><button className="btn text deployment-back" onClick={()=>{setSelected(null);void load();}}><ArrowLeft size={16}/> Deployment</button><RuntimePanel siteId={siteId} siteName={siteName} kind={selected} navigate={navigate}/></section>;
 return <section className="deployment-workspace" aria-label="Deployment">
  <header className="deployment-heading"><div><h2>Deployment</h2><p>Where this house’s services run and how they connect.</p></div><button className="btn" disabled={checking} onClick={()=>void load(true)}><RefreshCw size={16} className={checking?'deployment-spinning':''}/>{checking?'Checking machines…':'Check machines'}</button></header>
  {error&&<div className="notice" role="alert">{error}<button className="btn text" onClick={()=>void load()}>Retry</button></div>}
  {!map?<p role="status">Loading deployment…</p>:<>
   {map.warnings.map(w=><p className="notice" key={w}>{w}</p>)}
   <div className={'deployment-canvas'+(map.destinations.length===1?' single-destination':'')}>
    <div className="deployment-destinations">
     {map.destinations.map((original,index)=>{const expired=original.check.checked_at&&now-Date.parse(original.check.checked_at)>90000;const destination=expired?{...original,check:{...original.check,state:'stale',message:'Last check is out of date. Check again.'}}:original;return <div className="deployment-destination-group" key={destination.id}>
      {index>0&&<div className="deployment-management-link" aria-label="Management connection"><span/><Cable size={20}/><strong>{map.links.some(l=>l.id==='management'&&l.source===destination.id)?'VPN / SSH':'Connection'}</strong><small>{map.links.some(l=>l.id==='management'&&l.source===destination.id)?'Management · port 22':'Not verified'}</small><span/></div>}
      <section className="deployment-destination" aria-label={destination.name}>
       <header><span className="deployment-machine-icon">{destination.placement==='cloud'?<Server size={25}/>:<Cpu size={25}/>}</span><div><span className="eyebrow">{destination.placement==='cloud'?'CENTRAL SERVER':destination.placement==='local'?'HOUSE MACHINE':'OTHER DESTINATION'}</span><h3>{destination.name}</h3></div><span className={'deployment-state state-'+destination.check.state}><i/>{stateName(destination.check.state)}</span></header>
       <div className="deployment-components">
        {destination.placement==='cloud'&&<div className="deployment-core"><Server size={18}/><span>Deployment manager</span><small>Central backend</small></div>}
        {map.components.filter(c=>c.destination_id===destination.id).map(component=><button key={component.id} className={'deployment-component'+(component.planned?' is-planned':'')} disabled={!component.supported} onClick={()=>setSelected(component.kind as 'percepta'|'controller')}>
         <span className="deployment-component-icon">{icon(component.kind)}</span><span><strong>{component.name}</strong><small>{component.supported?stateName(component.state):'Planned · deployment not available'}</small></span>{component.supported?<ArrowRight size={17}/>:<Circle size={13}/>}
        </button>)}
        {!map.components.some(c=>c.destination_id===destination.id)&&destination.placement!=='cloud'&&<p className="deployment-unassigned">No services assigned.</p>}
       </div>
       <footer><span><i className={'deployment-status-dot state-'+destination.check.state}/>{checking?'Checking Docker access…':destination.check.message||'Docker access has not been checked.'}</span><div>{destination.check.memory_bytes!=null&&<span>{(destination.check.memory_bytes/1024**3).toFixed(1)} GiB RAM</span>}{destination.check.architecture&&<span>{destination.check.architecture}</span>}<span>Checked {stamp(destination.check.checked_at)}</span></div></footer>
      </section>
     </div>;})}
    </div>
    <p className="deployment-legend"><span><Box size={14}/> Dashed components are planned, not installed.</span><span><CheckCircle2 size={14}/> Online confirms Docker access, not application health.</span></p>
   </div>
   <section className="deployment-connections" aria-label="Application connections"><div className="sectionhead"><h3><Cable size={18}/> Application connections</h3><span>From Percepta’s planned destination</span></div>
    <div className="deployment-connection-list">{map.links.filter(l=>l.id!=='management').map(link=><div className="deployment-connection" key={link.id}><span className="deployment-link-icon">{link.id==='mongo'?<HardDrive size={18}/>:link.id==='broker'?<Radio size={18}/>:<Cpu size={18}/>}</span><div><strong>{link.label}</strong><p>{link.message}</p></div><div className="deployment-link-address">{link.endpoint?<code>{link.endpoint}:{link.port}</code>:<span>Address pending</span>}<small>{stateName(link.state)}</small></div></div>)}</div>
   </section>
  </>}
 </section>;
}
