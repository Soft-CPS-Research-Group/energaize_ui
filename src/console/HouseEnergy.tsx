import {useCallback, useMemo, useState} from 'react';
import {MeasurementChart} from './MeasurementChart';
import type {MeasurementChannel} from './measurementChannels';
import {compactPoints, type MeasurementPoint, type ReadingSource, type TimeWindow} from './measurementData';
import {type Feed, readJson} from './DeploymentFlow';

export interface HouseArchive {site:string; database:string; collection:string; meter?:string; exportMeter?:string; period?:number}
type Lane = 'grid_in' | 'grid_out' | 'load' | 'solar' | 'price';
type Series = MeasurementChannel & {id:Lane; color:string};
type Sample = Record<Lane,number|null> & {at:string;price_at?:string|null;partial:Lane[];source_readings?:Partial<Record<Lane,ReadingSource>>};
interface Interval {lane:'load'|'solar'|'price';start:string;end:string;value:number}
interface WindowPage {samples:Sample[];horizon:Interval[];next_cursor?:string|null}

const series:Series[] = [
  {id:'grid_in',title:'Grid import',color:'#166d87',unit:'kW'},
  {id:'grid_out',title:'Grid export',color:'#a34578',unit:'kW'},
  {id:'load',title:'Non-shiftable load',color:'#5361a8',unit:'kW',curve:'monotone',forecastEndpoint:'/forecast'},
  {id:'solar',title:'Solar production',color:'#ac741e',unit:'kW',curve:'monotone',forecastEndpoint:'/forecast'},
  {id:'price',title:'Electricity price',color:'#437c70',unit:'€/kWh',curve:'stepAfter',forecastEndpoint:'/forecast'}
];
export function forecastPoints(intervals:Interval[],now:number):MeasurementPoint[] {
  const points:MeasurementPoint[]=[];
  for(const lane of ['price','load','solar'] as const){
    let previousEnd=0;
    const add=(time:number,value:number|null)=>points.push({channelId:lane,id:lane+'-'+time,timestamp:new Date(time).toISOString(),value});
    const rows=intervals.filter(r=>r.lane===lane && Date.parse(r.end)>now).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
    rows.forEach((row,index)=>{
      const start=Math.max(now,Date.parse(row.start)),end=Date.parse(row.end);
      if(previousEnd && previousEnd<start)add(previousEnd,null);
      add(start,row.value);
      if(end>start+1 && (lane==='price' || !rows[index+1] || Date.parse(rows[index+1].start)>end))add(end-1,row.value);
      previousEnd=end;
    });
  }
  return points;
}
export function cyclePoint(row:Sample,id:Lane,range:TimeWindow):MeasurementPoint {
  const start=id==='price' && row.price_at ? Date.parse(row.price_at) : Date.parse(row.at);
  const timestamp=id==='price' && start<range.start ? new Date(range.start).toISOString()
    : id==='price' && row.price_at ? row.price_at : row.at;
  return {channelId:id,id:id+'@'+row.at,timestamp,value:row[id],source:row.source_readings?.[id],quality:row.partial.includes(id)?'partial':undefined};
}
export function HouseEnergy({archive}:{archive:HouseArchive}){
  const [prices,setPrices]=useState(false);
  const [selected,setSelected]=useState<Lane[]>(['grid_in','grid_out','load','solar']);
  const period=archive.period||60;
  const available=useMemo(()=>series.filter(s=>(s.id!=='grid_in'||archive.meter)&&(s.id!=='grid_out'||archive.exportMeter)).map(s=>({...s,expectedSeconds:period})),[archive.meter,archive.exportMeter,period]);
  const active=useMemo(()=>available.filter(s=>prices?s.id==='price':s.id!=='price'&&selected.includes(s.id)),[available,prices,selected]);
  const prefix='/telemetry-api/api/measurements/sites/'+encodeURIComponent(archive.site);
  const request=useCallback(async(path:string,signal:AbortSignal)=>{
    if(path==='/latest'){
      const feed=await readJson<Feed>(prefix+'/cycle-archive?limit=1&summary=true',signal);
      const cycle=feed.messages[0];
      return {points:[],point:cycle?{id:cycle.id,timestamp:cycle.timestamp,value:null}:undefined};
    }
    const query=new URL(path,'http://console.local').searchParams;
    query.delete('limit');query.delete('max_points');
    if(archive.meter)query.set('grid_import',archive.meter);
    if(archive.exportMeter)query.set('grid_export',archive.exportMeter);
    const range={start:Date.parse(query.get('from_ts')!),end:Date.parse(query.get('until_ts')!)};
    const points:MeasurementPoint[]=[];
    let horizon:MeasurementPoint[]=[];
    const seen=new Set<string>();
    for(;;){
      const page=await readJson<WindowPage>(prefix+'/energy-window?'+query,signal);
      if(!seen.size)horizon=forecastPoints(page.horizon,range.end);
      for(const row of page.samples){
        for(const {id} of available)points.push(cyclePoint(row,id,range));
      }
      if(!page.next_cursor)break;
      if(seen.has(page.next_cursor))throw Error('Archive cursor repeated.');
      seen.add(page.next_cursor);query.set('cursor',page.next_cursor);
    }
    const budget=1200*available.length;
    return {points:compactPoints(points,range,budget),horizon,bucket_seconds:points.length>budget?(range.end-range.start)/200000:0};
  },[prefix,available,archive.meter,archive.exportMeter]);
  return <section className="surface chart-section house-energy">
    <nav className="tabs" aria-label="Energy data view">{['Energy','Electricity price'].map((name,i)=><button key={name} aria-pressed={prices===!!i} className={prices===!!i?'active':''} onClick={()=>setPrices(!!i)}>{name}</button>)}</nav>
    {!prices && <div className="telemetry-series-legend" role="group" aria-label="Visible measurements">{available.filter(s=>s.id!=='price').map(s=><button key={s.id} aria-pressed={selected.includes(s.id)} onClick={()=>setSelected(ids=>ids.includes(s.id)?ids.filter(id=>id!==s.id):[...ids,s.id])}><i style={{background:s.color}}/>{s.title}</button>)}</div>}
    <MeasurementChart title={prices?'Electricity price':'House energy'} series={active} compactHeader startLive initialDurationMs={21600000} inlineHorizon
      queryKey={[archive.site,archive.meter,archive.exportMeter].join('/')} request={request} endpoint="/series" latestEndpoint="/latest" expectedSeconds={period} forecastLabel={prices?'Published prices':'Forecast'}/>
  </section>;
}
