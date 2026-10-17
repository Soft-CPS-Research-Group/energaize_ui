import {useEffect,useState} from 'react';
import {runtimeRequest} from '../api/runtimeApi';
type ReadingStatus={state:'waiting'|'stale'|'receiving';last_received_at:string|null;generated_entities:string[]|null};
export function PerceptaTelemetryStatus({siteId}:{siteId:string}){
 const [status,setStatus]=useState<ReadingStatus|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;const check=async()=>{try{const next=await runtimeRequest<ReadingStatus>('/api/runtime/percepta/sites/'+siteId+'/telemetry');if(live){setStatus(next);setError('');}}catch(e){if(live)setError((e as Error).message);}};void check();const timer=setInterval(()=>void check(),15000);return()=>{live=false;clearInterval(timer);};},[siteId]);
 return <div className="percepta-receiving" role="status"><strong>{error?'Collection check unavailable':status?.state==='receiving'?'Receiving data':status?.state==='stale'?'Readings are stale':status?.state==='waiting'?'Waiting for first readings':'Checking collection…'}</strong>{status?.last_received_at&&<span> · {new Date(status.last_received_at).toLocaleString('en-GB')}</span>}{!!status?.generated_entities?.length&&<p>{status.generated_entities.length} equipment readings use Percepta fallback values.</p>}{error&&<p>{error}</p>}</div>;
}
