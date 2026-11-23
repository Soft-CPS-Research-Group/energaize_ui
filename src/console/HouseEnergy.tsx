import {useCallback, useMemo, useState} from 'react';
import {MeasurementChart} from './MeasurementChart';
import {channelRequest, type MeasurementChannel} from './measurementChannels';
import {compactPoints, type MeasurementPoint, type MeasurementSeries} from './measurementData';
import {type Feed, readJson} from './DeploymentFlow';

export interface HouseArchive {site:string; database:string; collection:string; meter?:string; exportMeter?:string; period?:number}
type Metric = 'import'|'export'|'load'|'solar'|'power'|'prices';
type Series = MeasurementChannel & {id:Metric; color:string};
type PeriodPoint = MeasurementPoint & {period_start?:string; period_end?:string};
type Parameter = {parameter_type_id:string; generated?:boolean; measurement_unit?:string; final_values?:{period_start:string;period_end:string;value:number|null}[]};
const prefix='/telemetry-api/api/measurements';
const epoch=(value:unknown)=>Date.parse(String(value).replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d\d)(\d\d)$/, '$1T$2$3:$4'));

export function meanPower(point:PeriodPoint){
  const hours=(epoch(point.period_end)-epoch(point.period_start))/3600000;
  return {...point,value:typeof point.value==='number' && hours>0 ? point.value/hours : null};
}

export function forecastPoints(parameters:Parameter[], metric:Metric, period:number, now:number):MeasurementPoint[]{
  const type=metric==='prices'?'energy_price':metric==='solar'?'solar_energy_prediction':'energy_consumption_prediction';
  const matches=parameters.filter(p=>p.parameter_type_id===type && p.generated===false);
  if(matches.length!==1 || !(metric==='prices'?['€/kWh','EUR/kWh']:['kWh']).includes(matches[0].measurement_unit||''))return [];
  const points:MeasurementPoint[]=[];
  let previousEnd:number|undefined;
  for(const row of [...(matches[0].final_values||[])].sort((a,b)=>epoch(a.period_start)-epoch(b.period_start))){
    const start=epoch(row.period_start), end=epoch(row.period_end);
    if(!(end>start) || end<=now || typeof row.value!=='number')continue;
    if(previousEnd!==undefined && start>previousEnd)points.push({id:metric+'-gap-'+start,timestamp:new Date(previousEnd).toISOString(),channelId:metric,value:null});
    const value=metric==='prices'?row.value:row.value*(metric==='power'?3600000:period*1000)/(end-start);
    const add=(time:number)=>points.push({id:metric+'-'+time,channelId:metric,timestamp:new Date(time).toISOString(),value});
    if(metric==='prices'){add(Math.max(start,now));add(end-1);}
    else add(Math.max(now, (start+end)/2));
    previousEnd=end;
  }
  return points;
}

export function HouseEnergy({archive}:{archive:HouseArchive}){
  const [prices,setPrices]=useState(false);
  const [selected,setSelected]=useState<Metric[]>(['import','export','load','solar']);
  const [period,setPeriod]=useState(archive.period||60);
  const site='/sites/'+encodeURIComponent(archive.site);
  const all=useMemo(()=>{
    const series:Series[]=[];
    function add(id:Metric,title:string,base:string,color:string,forecast=false){
      series.push({id,title,endpoint:base+'/series',unit:id==='prices'?'EUR/kWh':id==='power'?'kW':'kWh',color,expectedSeconds:period,
        curve:id==='prices'?'stepAfter':id==='solar'||id==='load'||id==='power'?'monotone':'linear',forecastEndpoint:forecast?'/forecast':undefined});
    }
    if(archive.meter)add('import','Grid import','/capabilities/'+encodeURIComponent(archive.meter),'#166d87');
    if(archive.exportMeter)add('export','Grid export','/capabilities/'+encodeURIComponent(archive.exportMeter),'#a34578');
    add('load','Non-shiftable load',site+'/derived/non_shiftable_load','#5361a8',true);
    add('solar','Solar production',site+'/derived/solar_generation','#ac741e',true);
    add('power','Mean load power','/power','#238363',true);
    add('prices','Electricity price','/percepta/'+encodeURIComponent(archive.database)+'/'+encodeURIComponent(archive.collection)+'/prices','#437c70',true);
    return series;
  },[archive,site,period]);
  const active=useMemo(()=>all.filter(s=>prices?s.id==='prices':selected.includes(s.id)),[all,prices,selected]);
  const read=useCallback(async(path:string,signal:AbortSignal):Promise<MeasurementSeries>=>{
    const url=new URL(path,'http://console.local');
    const power=url.pathname.startsWith('/power/');
    // Native capability charts offer a bounded envelope. House-derived metrics use paginated raw periods.
    if(url.pathname.startsWith('/capabilities/'))return readJson(prefix+path,signal);
    const endpoint=power?site+'/derived/non_shiftable_load/series':url.pathname.replace(/\/chart$/,'/series');
    const query=url.searchParams;
    query.delete('max_points');query.set('limit','1000');
    const rows:PeriodPoint[]=[];
    const seen=new Set<string>();
    do{
      const page=await readJson<MeasurementSeries>(prefix+endpoint+'?'+query,signal);
      rows.push(...page.points);
      if(!page.next_cursor){if(page.truncated)throw Error('Incomplete archive window.');break;}
      if(seen.has(page.next_cursor))throw Error('Archive cursor repeated.');
      seen.add(page.next_cursor);query.set('cursor',page.next_cursor);
    }while(!signal.aborted);
    signal.throwIfAborted();
    const points=power?rows.map(meanPower):rows;
    return {points:compactPoints(points,{start:epoch(query.get('from_ts')),end:epoch(query.get('until_ts'))}),sample_count:rows.length};
  },[site]);
  const archived=useCallback(async(summary:boolean,signal:AbortSignal)=>{
    const feed=await readJson<Feed>(prefix+site+'/cycle-archive?limit=1&summary='+summary,signal);
    if(feed.site_id!==archive.site)throw Error('Unexpected installation in archive response.');
    if(feed.period_seconds && !signal.aborted)setPeriod(feed.period_seconds);
    return feed;
  },[site,archive.site]);
  const request=useCallback(async(path:string,signal:AbortSignal)=>{
    if(path==='/latest'){
      const cycle=(await archived(true,signal)).messages[0];
      return {points:[],point:cycle?{id:cycle.id,timestamp:cycle.timestamp,value:null}:undefined};
    }
    return channelRequest(active,read)(path,signal);
  },[active,archived,read]);
  const forecast=useCallback(async(_path:string,signal:AbortSignal)=>{
    const feed=await archived(false,signal);
    const entities=Object.values(feed.messages[0]?.payload.entities||{}) as {entity_type_id:string;parameters?:Record<string,Parameter>}[];
    return {points:active.filter(s=>s.forecastEndpoint).flatMap(s=>{
      const parameters=entities.filter(e=>e.entity_type_id===(s.id==='prices'?'energy_market':'forecast_service')).flatMap(e=>Object.values(e.parameters||{}));
      return forecastPoints(parameters,s.id,feed.period_seconds||period,Date.now());
    })};
  },[active,archived,period]);
  const key=active.map(s=>s.id).join(',');
  return <section className="surface chart-section house-energy">
    <nav className="tabs" aria-label="Energy data view">{['Energy','Electricity price'].map((name,i)=><button key={name} aria-pressed={prices===!!i} className={prices===!!i?'active':''} onClick={()=>setPrices(!!i)}>{name}</button>)}</nav>
    {!prices && <div className="telemetry-series-legend" role="group" aria-label="Visible measurements">{all.filter(s=>s.id!=='prices').map(s=><button key={s.id} aria-pressed={selected.includes(s.id)} onClick={()=>setSelected(ids=>ids.includes(s.id)?ids.filter(id=>id!==s.id):[...ids,s.id])}><i style={{background:s.color}}/>{s.title}</button>)}</div>}
    <MeasurementChart title={prices?'Electricity price':'House energy'} series={active} showLatest queryKey={key} request={request} endpoint="/series" latestEndpoint="/latest" expectedSeconds={period}
      note={prices?undefined:'Non-shiftable load excludes EV charging. Forecast energy is shown as average kWh per '+period+'-second cycle.'}
      forecastEndpoint={active.some(s=>s.forecastEndpoint)?'/forecast':undefined} forecastRequest={forecast} forecastLabel={prices?'Published prices':'Forecast'}/>
  </section>;
}
