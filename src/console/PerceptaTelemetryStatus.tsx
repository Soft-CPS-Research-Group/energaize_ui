import {useEffect,useState} from 'react';
import {Activity, RefreshCw} from 'lucide-react';
import {runtimeRequest, type RuntimeInstance} from '../api/runtimeApi';
import {configurationState, serviceState} from './RuntimeServiceStatus';

type ReadingStatus={state:'waiting'|'stale'|'receiving';last_received_at:string|null;generated_entities:string[]|null};
export function PerceptaTelemetryStatus({siteId,item,refreshKey=0,onCheck,checking=false}:{siteId:string;item:RuntimeInstance;refreshKey?:number;onCheck:()=>void;checking?:boolean}){
 const [status,setStatus]=useState<ReadingStatus|null>(null),[error,setError]=useState('');
 const [lastCheck,setLastCheck]=useState<string|null>(null);
 useEffect(()=>{
  let live=true;
  const check=async()=>{
   try{
    const next=await runtimeRequest<ReadingStatus>('/api/runtime/percepta/sites/'+siteId+'/telemetry');
    if(live){setStatus(next);setError('');setLastCheck(new Date().toISOString());}
   }catch(e){if(live){setError((e as Error).message);setLastCheck(new Date().toISOString());}}
  };
  void check();const timer=setInterval(()=>void check(),15000);
  return()=>{live=false;clearInterval(timer);};
 },[siteId,refreshKey]);
 const fallback=!!status?.generated_entities?.length;
 const running=item.observed_state==='running';
 const confirmedConfiguration=!!item.applied_config_version&&item.applied_config_version===item.desired_config_version&&!item.configuration_error;
 const healthy=running&&!item.error&&item.health!=='unhealthy'&&!error&&status?.state==='receiving'&&!fallback&&confirmedConfiguration;
 const headline=healthy?'Healthy':error?'Check unavailable':!running?serviceState(item):!status?'Checking…':status.state==='waiting'?'Waiting for readings':'Needs attention';
 const readings=error?'Unable to check':!status?'Checking…':status.state==='receiving'?(fallback?'Fallback readings present':'Receiving data'):status.state==='stale'?'Readings are stale':'No readings yet';
 return <section className="percepta-health" aria-label="Percepta health check">
  <header><div><Activity size={17}/><h4>Health check</h4><strong className={healthy?'health-good':'health-attention'} role="status">{headline}</strong></div><button className="btn" disabled={checking||!!item.active_operation} onClick={onCheck}><RefreshCw size={14}/>Check now</button></header>
  <dl><div><dt>Service</dt><dd>{serviceState(item)}</dd><small>{item.last_checked_at?'Checked '+new Date(item.last_checked_at).toLocaleTimeString('en-GB'):'Not checked yet'}</small></div><div><dt>Configuration</dt><dd>{configurationState(item)}</dd><small>{confirmedConfiguration?'Applied version confirmed':'Generate and apply the latest configuration'}</small></div><div><dt>Readings</dt><dd>{readings}</dd><small>{status?.last_received_at?'Last reading '+new Date(status.last_received_at).toLocaleString('en-GB'):'Waiting for collection'}</small></div></dl>
  {fallback&&<p>{status!.generated_entities!.length} equipment readings use fallback values. Check the source connections.</p>}
  {error&&<p role="alert">{error}</p>}
  <small className="percepta-health-time">Readings checked automatically every 15 seconds{lastCheck?' · Last check '+new Date(lastCheck).toLocaleTimeString('en-GB'):''}</small>
 </section>;
}
