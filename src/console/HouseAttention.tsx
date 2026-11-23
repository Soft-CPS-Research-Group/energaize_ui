import {useCallback} from 'react';
import {runtimeRequest} from '../api/runtimeApi';
import {useObservation} from './DeploymentFlow';
import type {ChannelHealth} from './PerceptaTelemetryStatus';
import {fieldName} from './CycleReadings';
type Status={state:string;channels?:ChannelHealth[]};
export function HouseAttention({siteId,details=false}:{siteId:string;details?:boolean}){
 const status=useObservation(siteId,useCallback(signal=>runtimeRequest<Status>('/api/runtime/percepta/sites/'+siteId+'/telemetry',{signal}),[siteId]),60000);
 const channels=status?.value?.channels || [];
 const issues=channels.filter(c=>['missing','partial','stale','invalid','fallback'].includes(c.state));
 if(!details)return issues.length || status?.value?.state==='stale'?<a className="btn text reading-issue" href={'/app/community/inventory?site='+siteId+'&tab=deployment&deploymentView=issues'}>{issues.length ? issues.length+' reading issues' : 'Collection delayed'}</a>:null;
 if(status?.error)return <p role="alert">Reading status unavailable.</p>;
 if(!status?.value)return <p>Checking recent readings…</p>;
 return <><p>{issues.length ? 'Measurements requiring attention in the applied Percepta configuration.' : channels.length ? 'No confirmed gaps in the most recent channel check.' : 'No channel evidence available.'}</p>{issues.length>0&&<div className="evidence-stack">{[...new Set(issues.map(c=>c.owner))].map(owner=><section key={owner} className="evidence-group"><header><h4>{owner}</h4></header><ul>{issues.filter(c=>c.owner===owner).map(c=><li key={c.channel_id}><strong>{fieldName(c.name)}</strong><span>{c.state} · {c.message}</span></li>)}</ul></section>)}</div>}</>;
}
