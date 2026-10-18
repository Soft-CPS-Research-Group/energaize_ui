import {useEffect,useState,useId,type ReactNode} from 'react';
import {Activity, RefreshCw, CircleCheck, TriangleAlert, CircleAlert} from 'lucide-react';
import {runtimeRequest, type RuntimeInstance} from '../api/runtimeApi';

export type ChannelHealth={channel_id:string;name:string;owner:string;scope:string;state:'receiving'|'missing'|'stale'|'invalid'|'fallback'|'unverified';message:string;last_received_at:string|null};
type ReadingStatus={state:'waiting'|'stale'|'receiving';last_received_at:string|null;generated_entities:string[]|null;channels?:ChannelHealth[];channel_summary?:{total:number;receiving:number;issues:number}};
export function PerceptaTelemetryStatus({siteId,item,refreshKey=0,onCheck,checking=false,actions,monitoringError='',heading}:{siteId:string;item:RuntimeInstance;refreshKey?:number;onCheck:()=>void;checking?:boolean;actions?:ReactNode;monitoringError?:string;heading?:ReactNode}){
 const [detailsOpen,setDetailsOpen]=useState(false);
 const tooltipId=useId();
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
 const channelIssues=status?.channels?.filter(channel=>channel.state!=='receiving')||[];
 const [showAllChannels,setShowAllChannels]=useState(false);
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
 if(channelIssues.length)issues.push(`${channelIssues.length} channels need attention.`);
 if(status&&!status.channel_summary?.total)issues.push('Channel verification is not available yet.');
 const healthy=running&&!issues.length&&status?.state==='receiving'&&!item.active_operation;
 const failed=!!item.error||item.health==='unhealthy'||status?.state==='stale'||['missing','unreachable'].includes(item.observed_state)||channelIssues.some(c=>['stale','invalid','missing'].includes(c.state));
 const tone=healthy?'good':failed?'error':issues.length?'warning':'checking';
 const headline=healthy?'Working normally':failed?'Collection needs attention':issues.length?'Check required':item.active_operation?'Updating service…':'Checking collection…';
 const Icon=healthy?CircleCheck:failed?CircleAlert:issues.length?TriangleAlert:Activity;
 const readings=error?'Unable to check':!status?'Checking…':status.state==='receiving'?(fallback?'Fallback readings present':'Receiving data'):status.state==='stale'?'Readings are stale':'No readings yet';
 const description=healthy?'Service running, configuration applied and all monitored channels receiving valid recent data.':issues.length?issues.join(' '):item.active_operation?'Waiting for the operation to finish before confirming the state.':'Verifying the service, configuration and incoming readings.';
 return <>
  <div className="runtime-instance-head runtime-monitored-head">{heading}<div className="percepta-status-anchor" onMouseEnter={()=>setDetailsOpen(true)} onMouseLeave={()=>setDetailsOpen(false)}>
   <button type="button" className={'percepta-status-icon health-icon-'+tone} aria-label={headline} aria-describedby={detailsOpen?tooltipId:undefined} onFocus={()=>setDetailsOpen(true)} onBlur={()=>setDetailsOpen(false)} onClick={()=>setDetailsOpen(true)} onKeyDown={event=>{if(event.key==='Escape'){setDetailsOpen(false);event.stopPropagation();}}}><Icon size={22} aria-hidden="true"/></button>
   {detailsOpen&&<div id={tooltipId} role="tooltip" className="percepta-status-tooltip"><strong>{headline}</strong><p>{description}</p><small>{lastCheck?'Last check '+new Date(lastCheck).toLocaleTimeString('en-GB'):'Checking…'} · Updates automatically</small></div>}
  </div></div>
  <span className="percepta-status-announcement" role={issues.length?'alert':'status'} aria-atomic="true">{headline}. {description}</span>
  <section className="percepta-health" aria-label="Percepta health check">
  <header><div><Activity size={17}/><h4>Health check</h4></div>{actions||<button className="btn" disabled={checking||!!item.active_operation} onClick={onCheck}><RefreshCw size={14}/>Check now</button>}</header>
  {(!confirmedConfiguration)&&<p className="percepta-configuration-warning"><TriangleAlert size={15}/>{item.configuration_error?'Configuration needs review. Open Edit configuration.':'Configuration changes have not been applied yet.'}</p>}
  <div className="percepta-reading-summary"><span>{error?'Unable to check readings':status?.last_received_at?'Last data received '+new Date(status.last_received_at).toLocaleString('en-GB'):readings}</span>{status?.channel_summary&&<button className="btn text" aria-expanded={showAllChannels} onClick={()=>setShowAllChannels(!showAllChannels)}>{status.channel_summary.receiving}/{status.channel_summary.total} channels healthy</button>}</div>
  {(channelIssues.length>0||showAllChannels)&&<div className="percepta-channel-health" aria-label="Channel status"><ul>{(showAllChannels?status?.channels||[]:channelIssues).map(channel=><li key={channel.channel_id}><div><strong>{channel.name}</strong><small>{channel.owner}</small></div><div className={'channel-health-'+channel.state}><span>{({receiving:'Receiving',missing:'No data',stale:'Delayed',invalid:'Invalid value',fallback:'Substitute value',unverified:'Not verified'})[channel.state]}</span><small>{channel.message}{channel.state!=='receiving'&&channel.last_received_at?' Last seen '+new Date(channel.last_received_at).toLocaleString('en-GB'):''}</small></div></li>)}</ul></div>}

  {error&&<p role="alert">{error}</p>}
 </section></>;
}
