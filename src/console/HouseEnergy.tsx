import {useCallback, useMemo, useState} from 'react';
import {MeasurementChart} from './MeasurementChart';
import type {MeasurementChannel} from './measurementChannels';
import {compactPoints, type MeasurementPoint, type ReadingSource, type TimeWindow} from './measurementData';
import {type Feed, readJson} from './DeploymentFlow';

export interface HouseArchive {site:string; database:string; collection:string; meter?:string; exportMeter?:string; period?:number}
type ArchiveLane = 'grid_in' | 'grid_out' | 'load' | 'solar' | 'price';
type Lane = ArchiveLane | 'grid_net';
type View = 'power' | 'energy' | 'price';
type Series = MeasurementChannel & {id:Lane; color:string};
type Sample = Record<ArchiveLane,number|null> & {at:string;interval_start?:string|null;price_at?:string|null;partial:ArchiveLane[];source_readings?:Partial<Record<ArchiveLane,ReadingSource>>};
interface Interval {lane:'load'|'solar'|'price';start:string;end:string;value:number}
interface WindowPage {samples:Sample[];horizon:Interval[];next_cursor?:string|null}

const series:Series[] = [
  {id:'grid_net',title:'Grid balance',color:'#326c8a',unit:'kW'},
  {id:'grid_in',title:'Grid import',color:'#166d87',unit:'kW'},
  {id:'grid_out',title:'Grid export',color:'#a34578',unit:'kW'},
  {id:'load',title:'Estimated base load',color:'#5361a8',unit:'kW',curve:'monotone',forecastEndpoint:'/forecast'},
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
  const paired = row.grid_in != null && row.grid_out != null;
  const inputs = id === 'grid_net' ? ['grid_in','grid_out'] as const : [id];
  const sources = inputs.map(lane => row.source_readings?.[lane]);
  const source = sources.find(value => value?.status === 'reused') ??
    (sources.every(value => value?.status === 'fresh') ? sources[0] : undefined);
  const value = id === 'grid_net' ? (paired ? row.grid_in! - row.grid_out! : null) : row[id];
  return {channelId:id,id:id+'@'+row.at,timestamp,value,source,
    quality:inputs.some(lane => row.partial.includes(lane)) ? 'partial' : undefined};
}

const hour = 3600000;
const day = 24 * hour;

export function energyBuckets(samples:Sample[], lanes:Lane[], range:TimeWindow) {
  const daily = range.end - range.start > 48 * hour;
  const bucketStart = (time:number) => {
    if (!daily) return Math.floor(time / hour) * hour;
    return new Date(time).setHours(0, 0, 0, 0);
  };
  const bucketEnd = (time:number) => {
    if (!daily) return time + hour;
    const next = new Date(time);
    return next.setDate(next.getDate() + 1);
  };
  const buckets = new Map<number,Map<Lane,{value:number;covered:number;reused:boolean;partial:boolean}>>();
  let previousEnd = range.start;

  for (const sample of samples) {
    const end = Math.min(Date.parse(sample.at), range.end);
    const start = Math.max(Date.parse(sample.interval_start || ''), previousEnd);
    if (!(end > start)) continue;
    previousEnd = end;
    const measurements = lanes.map(id => cyclePoint(sample, id, range));
    for (let bucket = bucketStart(start); bucket < end; bucket = bucketEnd(bucket)) {
      const overlap = Math.min(end, bucketEnd(bucket)) - Math.max(start, bucket);
      const values = buckets.get(bucket) ?? new Map();
      buckets.set(bucket, values);
      for (const point of measurements) {
        if (typeof point.value !== 'number') continue;
        const lane = point.channelId as Lane;
        const entry = values.get(lane) ?? {value:0,covered:0,reused:false,partial:false};
        entry.value += point.value * overlap / hour * (lane === 'grid_out' ? -1 : 1);
        entry.covered += overlap;
        entry.reused ||= point.source?.status === 'reused';
        entry.partial ||= point.quality === 'partial';
        values.set(lane, entry);
      }
    }
  }

  const points: MeasurementPoint[] = [];
  let net = 0, netCovered = 0, netPartial = false;
  for (const [bucket, values] of buckets) {
    const start = Math.max(bucket, range.start);
    const end = Math.min(bucketEnd(bucket), range.end);
    const timestamp = new Date(start + (end - start) / 2).toISOString();
    for (const [lane, entry] of values) {
      points.push({
        channelId:lane, id:lane+'@'+bucket, timestamp, value:entry.value,
        source:entry.reused ? {status:'reused',at:null} : undefined,
        quality:entry.partial || entry.covered < end - start ? 'partial' : undefined,
      });
      if (lane === 'grid_net') {
        net += entry.value;
        netCovered += entry.covered;
        netPartial ||= entry.partial || entry.reused;
      }
    }
  }
  return {
    points, bucket_seconds: (daily ? day : hour) / 1000,
    period_total: netCovered ? {value:net, partial:netPartial || netCovered < range.end - range.start} : undefined,
  };
}

export function HouseEnergy({archive}:{archive:HouseArchive}){
  const [view,setView]=useState<View>('power');
  const hasBalance=!!(archive.meter && archive.exportMeter);
  const [powerSeries,setPowerSeries]=useState<Lane[]>(()=>hasBalance ? ['grid_net','solar'] : ['grid_in','solar']);
  const [energySeries,setEnergySeries]=useState<Lane[]>(['grid_in','grid_out']);
  const bars=view==='energy';
  const prices=view==='price';
  const selected=bars ? energySeries : powerSeries;
  const setSelected=bars ? setEnergySeries : setPowerSeries;
  const period=archive.period||60;
  const available=useMemo(()=>series.filter(s=>(s.id!=='grid_in'||archive.meter)
    && (s.id!=='grid_out'||archive.exportMeter) && (s.id!=='grid_net'||hasBalance)),
    [archive.meter,archive.exportMeter,hasBalance]);
  const active=useMemo(()=>available.filter(s=>prices?s.id==='price':s.id!=='price'&&selected.includes(s.id))
    .map(s=>({...s,unit:bars?'kWh':s.unit,expectedSeconds:bars?3600:period})),
    [available,prices,selected,bars,period]);
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
    if (bars) {
      // An interval closing on the range boundary belongs to the period just ended.
      query.set('from_ts',new Date(range.start+1).toISOString());
      query.set('until_ts',new Date(range.end+1).toISOString());
    }
    const points:MeasurementPoint[]=[];
    const samples:Sample[]=[];
    const lanes=available.filter(s=>bars ? s.id!=='price' : true).map(s=>s.id);
    let horizon:MeasurementPoint[]=[];
    const seen=new Set<string>();
    for(;;){
      const page=await readJson<WindowPage>(prefix+'/energy-window?'+query,signal);
      if(bars) samples.push(...page.samples);
      else {
        if(!seen.size)horizon=forecastPoints(page.horizon,range.end);
        for(const row of page.samples)for(const id of lanes)points.push(cyclePoint(row,id,range));
      }
      if(!page.next_cursor)break;
      if(seen.has(page.next_cursor))throw Error('Archive cursor repeated.');
      seen.add(page.next_cursor);query.set('cursor',page.next_cursor);
    }
    if(bars)return energyBuckets(samples,lanes,range);
    const budget=1200*available.length;
    return {points:compactPoints(points,range,budget),horizon,bucket_seconds:points.length>budget?(range.end-range.start)/200000:0};
  },[prefix,available,archive.meter,archive.exportMeter,bars]);
  const tabs = [{id:'power',label:'Power · kW'},{id:'energy',label:'Energy · kWh'},{id:'price',label:'Electricity price'}] as const;
  return <section className="surface chart-section house-energy">
    <nav className="tabs" aria-label="Energy data view">{tabs.map(tab=><button key={tab.id} aria-pressed={view===tab.id}
      className={view===tab.id?'active':''} onClick={()=>setView(tab.id)}>{tab.label}</button>)}</nav>
    {!prices && <div className="telemetry-series-legend" role="group" aria-label="Visible measurements">
      {available.filter(s=>s.id!=='price').map(s=><button key={s.id} aria-pressed={selected.includes(s.id)}
        onClick={()=>setSelected(ids=>ids.includes(s.id)?ids.filter(id=>id!==s.id):[...ids,s.id])}><i style={{background:s.color}}/>{s.title}</button>)}</div>}
    <MeasurementChart title={prices?'Electricity price':bars?'House energy':'House power'} series={active}
      compactHeader startLive initialDurationMs={21600000} inlineHorizon dashedGapFills bars={bars}
      zeroLine={bars || active.some(s=>s.id==='grid_net')} incremental={!bars} liveRefreshMs={bars?60000:undefined}
      queryKey={[archive.site,archive.meter,archive.exportMeter,bars?'energy':'power'].join('/')}
      request={request} endpoint="/series" latestEndpoint="/latest" expectedSeconds={period}
      forecastLabel={prices?'Published prices':'Forecast'}/>
  </section>;
}
