import {useCallback,useState} from 'react';
import {MeasurementChart} from './MeasurementChart';
import {compactPoints,incomplete,type MeasurementPoint,type MeasurementSeries} from './measurementData';
import {type Feed,readJson} from './DeploymentFlow';

type Metric='import'|'power'|'load'|'solar'|'prices'|'cumulative';
const labels:Record<Metric,string>={import:'Grid import',power:'Mean load power',load:'Base consumption',solar:'Solar production',prices:'Electricity price',cumulative:'Cumulative grid import'};
export interface HouseArchive {site:string;database:string;collection:string;meter?:string;period?:number}
const epoch=(v:unknown)=>Date.parse(String(v).replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d\d)(\d\d)$/, '$1T$2$3:$4'));

type PeriodPoint=MeasurementPoint & {period_start?:string;period_end?:string};
export function archiveValues(points:PeriodPoint[],metric:Metric,period:number) {
  let total=0, complete=true, previous:number|undefined;
  return points.map(p=>{
    if(metric==='power'){
      const hours=(epoch(p.period_end)-epoch(p.period_start))/3600000;
      return {...p,value:typeof p.value==='number' && hours>0 ? p.value/hours:null};
    }
    if(metric!=='cumulative')return p;
    const ts=epoch(p.timestamp);
    if(previous!==undefined && ts-previous>period*1500)complete=false;
    previous=ts;
    if(typeof p.value!=='number' || p.generated || incomplete(p)){complete=false;return {...p,value:null};}
    total+=p.value;
    return {...p,value:total,quality:complete?p.quality:'partial_coverage'};
  });
}

type Parameter={parameter_type_id:string;generated?:boolean;measurement_unit?:string;final_values?:{period_start:string;period_end:string;value:number|null}[]};
const prefix='/telemetry-api/api/measurements';
export function HouseEnergy({archive}:{archive:HouseArchive}) {
  const [metric,setMetric]=useState<Metric>(archive.meter?'import':'load');
  const [period,setPeriod]=useState(archive.period || 60);
  const scope='/sites/'+encodeURIComponent(archive.site);
  const unit=metric==='prices'?'EUR/kWh':metric==='power'?'kW':'kWh';
  const predict=['load','solar','prices','power'].includes(metric);
  const request=useCallback(async(path:string,signal:AbortSignal):Promise<MeasurementSeries & {point?:MeasurementPoint}>=>{
    const query=new URL(path,'http://console.local').searchParams;
    if(path==='/latest' || path==='/forecast'){
      const b=await readJson<Feed>(prefix+scope+'/cycle-archive?limit=1&summary='+(path==='/latest'),signal);
      if(b.site_id!==archive.site)throw Error('Unexpected house in archive response.');
      if(b.period_seconds && !signal.aborted)setPeriod(b.period_seconds);
      const cycle=b.messages[0];
      if(!cycle)return {points:[]};
      if(path==='/latest')return {points:[],point:{id:cycle.id,timestamp:cycle.timestamp,value:null}};
      const type=metric==='prices'?'energy_price':metric==='solar'?'solar_energy_prediction':'energy_consumption_prediction';
      const entities=(cycle.payload.entities || {}) as Record<string,{entity_type_id:string;parameters?:Record<string,Parameter>}>;
      const parameters=Object.values(entities).filter(e=>e.entity_type_id===(metric==='prices'?'energy_market':'forecast_service')).flatMap(e=>Object.values(e.parameters || {})).filter(p=>p.parameter_type_id===type && p.generated===false);
      if(parameters.length!==1)return {points:[]};
      const p=parameters[0];
      if(!(metric==='prices'?['€/kWh','EUR/kWh']:['kWh']).includes(p.measurement_unit || ''))return {points:[]};
      return {points:(p.final_values || []).flatMap(r=>{
        const start=epoch(r.period_start),end=epoch(r.period_end);
        if(!Number.isFinite(start)||!(end>start)||end<=Date.now()||typeof r.value!=='number')return [];
        const value=metric==='power'?r.value*3600000/(end-start):r.value;
        return [{id:r.period_start,timestamp:new Date(start).toISOString(),value},{id:r.period_end+'-end',timestamp:new Date(end-1).toISOString(),value}];
      })};
    }
    const base=metric==='prices'?'/percepta/'+encodeURIComponent(archive.database)+'/'+encodeURIComponent(archive.collection)+'/prices':
      metric==='import'||metric==='cumulative'?'/capabilities/'+encodeURIComponent(archive.meter || ''):scope+'/derived/'+(metric==='solar'?'solar_generation':'non_shiftable_load');
    query.delete('max_points');query.set('limit','1000');
    const points:PeriodPoint[]=[];
    const seen=new Set<string>();
    do {
      const page=await readJson<MeasurementSeries>(prefix+base+'/series?'+query,signal);
      points.push(...page.points);
      if(!page.next_cursor){if(page.truncated)throw Error('Incomplete archive window.');break;}
      if(seen.has(page.next_cursor))throw Error('Archive pagination stopped advancing.');
      seen.add(page.next_cursor);query.set('cursor',page.next_cursor);
    }while(!signal.aborted);
    const values=archiveValues(points,metric,period);
    return {points:compactPoints(values,{start:epoch(query.get('from_ts')),end:epoch(query.get('until_ts'))}),sample_count:points.length,partial_count:values.filter(incomplete).length};
  },[metric,archive,scope,period]);
  const note=metric==='power'?'Average power over each measured or forecast interval.':metric==='cumulative'?'Sum of measured grid imports since the start of the selected window. Gaps make the total partial.':metric==='prices'?'Price reported by Percepta and its published tariff intervals.':metric==='load'?'Base household consumption excluding EV charging. Incomplete inputs are marked.':undefined;
  return <section className="surface chart-section"><nav className="tabs" aria-label="Energy series">{(Object.keys(labels) as Metric[]).filter(k=>archive.meter || !['import','cumulative'].includes(k)).map(k=><button key={k} aria-pressed={metric===k} className={metric===k?'active':''} onClick={()=>setMetric(k)}>{labels[k]}</button>)}</nav>
    <MeasurementChart key={metric} title={labels[metric]} unit={unit} expectedSeconds={period} request={request} endpoint="/series" latestEndpoint="/latest" forecastEndpoint={predict?'/forecast':undefined} forecastRequest={request} forecastLabel={metric==='prices'?'Published prices':'Forecast'} incremental={metric!=='cumulative'} note={note}/></section>;
}
