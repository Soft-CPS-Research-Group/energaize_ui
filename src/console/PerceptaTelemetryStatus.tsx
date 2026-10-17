import {useEffect,useState,type ReactNode} from 'react';
import {Activity, RefreshCw, CircleCheck, TriangleAlert, CircleAlert} from 'lucide-react';
import {runtimeRequest, type RuntimeInstance} from '../api/runtimeApi';
import {configurationState, serviceState} from './RuntimeServiceStatus';

type ReadingStatus={state:'waiting'|'stale'|'receiving';last_received_at:string|null;generated_entities:string[]|null};
export function PerceptaTelemetryStatus({siteId,item,refreshKey=0,onCheck,checking=false,actions,monitoringError=''}:{siteId:string;item:RuntimeInstance;refreshKey?:number;onCheck:()=>void;checking?:boolean;actions?:ReactNode;monitoringError?:string}){
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
 const issues:string[]=[];
 if(monitoringError)issues.push('The service status could not be refreshed.');
 if(error)issues.push('Readings could not be checked.');
 if(item.error||item.health==='unhealthy')issues.push('The service reports a problem. Check the service details.');
 else if(!running)issues.push('Collection is not running.');
 if(!confirmedConfiguration)issues.push(item.configuration_error?'The configuration needs review.':'The latest configuration has not been confirmed as applied.');
 if(status?.state==='stale')issues.push('Readings have stopped arriving within the expected interval. Check the source connections.');
 if(status?.state==='waiting')issues.push('No readings have arrived yet. Check the connections if collection has already started.');
 if(fallback)issues.push(`${status!.generated_entities!.length} equipment readings use fallback values. Check the source connections.`);
 const healthy=running&&!issues.length&&status?.state==='receiving'&&!item.active_operation;
 const failed=!!item.error||item.health==='unhealthy'||status?.state==='stale'||['missing','unreachable'].includes(item.observed_state);
 const tone=healthy?'good':failed?'error':issues.length?'warning':'checking';
 const headline=healthy?'Working normally':failed?'Collection needs attention':issues.length?'Check required':item.active_operation?'Updating service…':'Checking collection…';
 const Icon=healthy?CircleCheck:failed?CircleAlert:issues.length?TriangleAlert:Activity;
 const readings=error?'Unable to check':!status?'Checking…':status.state==='receiving'?(fallback?'Fallback readings present':'Receiving data'):status.state==='stale'?'Readings are stale':'No readings yet';
 return <section className="percepta-health" aria-label="Percepta health check">
  <header><div><Activity size={17}/><h4>Health check</h4></div>{actions||<button className="btn" disabled={checking||!!item.active_operation} onClick={onCheck}><RefreshCw size={14}/>Check now</button>}</header>
  <div className={'percepta-health-summary health-summary-'+tone} role={issues.length?'alert':'status'} aria-atomic="true"><Icon size={22} aria-hidden="true"/><div><strong>{headline}</strong>{healthy?<p>Service running, configuration applied and recent readings received.</p>:issues.length?<ul>{issues.map(issue=><li key={issue}>{issue}</li>)}</ul>:<p>{item.active_operation?'Waiting for the operation to finish before confirming the state.':'Verifying the service, configuration and incoming readings.'}</p>}</div></div>
  <dl><div><dt>Service</dt><dd>{serviceState(item)}</dd><small>{item.last_checked_at?'Checked '+new Date(item.last_checked_at).toLocaleTimeString('en-GB'):'Not checked yet'}</small></div><div><dt>Configuration</dt><dd>{configurationState(item)}</dd><small>{confirmedConfiguration?'Applied version confirmed':'Generate and apply the latest configuration'}</small></div><div><dt>Readings</dt><dd>{readings}</dd><small>{status?.last_received_at?'Last reading '+new Date(status.last_received_at).toLocaleString('en-GB'):'Waiting for collection'}</small></div></dl>
  {error&&<p role="alert">{error}</p>}
  <small className="percepta-health-time">Readings checked every 15 seconds while this panel is open. This status updates automatically{lastCheck?' · Last check '+new Date(lastCheck).toLocaleTimeString('en-GB'):''}</small>
 </section>;
}
