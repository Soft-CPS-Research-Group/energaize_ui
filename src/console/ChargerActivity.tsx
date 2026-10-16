import { useEffect, useRef, useState } from 'react';
import { Line, Tooltip, XAxis, YAxis } from 'recharts';
import { TimeseriesPlot } from '../components/charts/TimeseriesPlot';
import type { MeasurementRequest, TimeWindow } from './measurementData';
import { observedSessions, type ChargerObservation } from './chargerObservations';
interface Activity {samples: ChargerObservation[]; previous: ChargerObservation | null; expected_seconds: number}
const date = (t: number) => new Date(t).toLocaleString('en-GB', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'});
export function ChargerActivity({endpoint, request, range}: {endpoint: string; request: MeasurementRequest; range: TimeWindow | null}) {
 const [data,setData]=useState<Activity>({samples:[],previous:null,expected_seconds:15}),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const cache=useRef<{endpoint:string;start:number;end:number;data:Activity}>();
 const requestRef=useRef(request);requestRef.current=request;
 const start=range?Math.max(range.start,range.end-86400000):null,end=range?.end;
 useEffect(()=>{
  if(start==null||end==null)return;const abort=new AbortController();let mounted=true;
  const before=cache.current,incremental=before&&before.endpoint===endpoint&&before.start<=start&&before.end>=start&&before.end<end;
  const from=incremental?Math.max(start,before.end-30000):start;
  setLoading(true);setError('');
  void requestRef.current(endpoint+'?'+new URLSearchParams({from_ts:new Date(from).toISOString(),until_ts:new Date(end).toISOString()}),abort.signal).then(raw=>{
   if(!mounted)return;let next=raw as unknown as Activity;
   if(!Array.isArray(next.samples))throw Error('Activity response is incomplete.');
   if(incremental){
    const map=new Map(before.data.samples.map(s=>[s.id,s]));next.samples.forEach(s=>map.set(s.id,s));
    const sorted=[...map.values()].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)||a.id.localeCompare(b.id));
    next={...next,previous:sorted.filter(s=>Date.parse(s.timestamp)<start).at(-1)||before.data.previous,samples:sorted.filter(s=>Date.parse(s.timestamp)>=start&&Date.parse(s.timestamp)<end)};
   }
   cache.current={endpoint,start,end,data:next};setData(next);
  }).catch(e=>{if(mounted&&!abort.signal.aborted)setError((e as Error).message);}).finally(()=>{if(mounted)setLoading(false);});
  return()=>{mounted=false;abort.abort();};
 },[endpoint,start,end]);
 if(!range||start==null||end==null)return null;
 const sessions=observedSessions(data.samples,data.previous,data.expected_seconds);
 const soc=data.samples.map(s=>({epochMs:Date.parse(s.timestamp),value:s.soc,vehicle:s.vehicle_id,generated:s.soc_generated}));
 const hasSoc=soc.some(s=>s.value!==null),width=end-start;
 return <section className="charger-observations" aria-label="Observed charging activity">
  <div className="sectionhead"><div><h3>Vehicle activity</h3><p className="muted">{range.start<start?'Last 24 hours of the selected window. ':''}Connections reported by Percepta · times reflect observations.</p></div></div>
  {data.samples.length>0 && <div className="charger-live-reading"><strong>{data.samples.at(-1)!.power_kw?.toLocaleString('en-GB',{maximumFractionDigits:2}) ?? '—'} <small>kW</small></strong><span>{data.samples.at(-1)!.power_kw==null?'Power unavailable':data.samples.at(-1)!.power_kw!>0?'Charging':data.samples.at(-1)!.power_kw!<0?'Discharging':'No charging power'}<small>{date(Date.parse(data.samples.at(-1)!.timestamp))}{data.samples.at(-1)!.generated?' · source-generated':''}</small></span></div>}
  {error?<p role="alert">{error}</p>:<>
   {sessions.length?<><div className="charger-observed-timeline" aria-label="Reported vehicle connections">{sessions.map((s,i)=><span key={i} className={s.generated?'is-generated':''} style={{left:((s.firstSeen-start)/width*100)+'%',width:Math.max(.35,((s.departure??s.lastSeen)-s.firstSeen)/width*100)+'%'}} title={`Vehicle ${s.vehicle} · ${date(s.firstSeen)} – ${date(s.departure??s.lastSeen)}${s.generated?' · source-generated':''}`}/>)}</div>
   <div className="charger-timeline-axis"><span>{date(start)}</span><span>{date(end)}</span></div>
   <div className="tablewrap"><table><thead><tr><th>Vehicle</th><th>Arrival observed</th><th>Departure observed</th><th>Peak charge / discharge</th><th>Source</th></tr></thead><tbody>{sessions.slice(-20).map((s,i)=><tr key={i}><td>{s.vehicle}</td><td>{s.arrival?date(s.arrival):'Already present / start unknown'}</td><td>{s.departure?date(s.departure):s.gap?'Observation gap':'Not observed'}</td><td>{s.peakCharge==null?'—':s.peakCharge.toFixed(2)} / {s.peakDischarge==null?'—':s.peakDischarge.toFixed(2)} kW</td><td>{s.generated?'Includes generated values':'Reported'}</td></tr>)}</tbody></table></div>{sessions.length>20&&<p className="muted">Showing the last 20 of {sessions.length} observed sessions.</p>}</>:<p className="muted">{loading?'Loading vehicle activity…':'No vehicle association reported in this window. Charging power alone does not establish a connection.'}</p>}
   {hasSoc?<><h3>Vehicle state of charge · source units</h3><TimeseriesPlot data={soc} height={200} margin={{top:10,left:10,right:20,bottom:24}}><XAxis dataKey="epochMs" type="number" scale="time" domain={[start,end]} tickFormatter={t=>new Date(t).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}/><YAxis label={{value:'SoC · unit unconfirmed',angle:-90,position:'insideLeft'}}/><Tooltip labelFormatter={t=>date(Number(t))}/><Line dataKey="value" stroke="var(--brand)" dot={false} connectNulls={false} isAnimationActive={false}/></TimeseriesPlot><p className="muted">SoC is shown exactly as reported. Its unit still needs confirmation.</p></>:<p className="muted">Vehicle SoC is not available in the selected observations.</p>}
  </>}
 </section>;
}
