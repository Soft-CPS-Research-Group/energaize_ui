import {useEffect,useState} from 'react';
import {runtimeRequest} from '../api/runtimeApi';
import {fieldName} from './CycleReadings';

type Input = {name:string;status:'matched'|'ambiguous'|'missing';meaning:{quantity:string;unit:string;positive_direction?:string;value_semantics?:string;interval_seconds?:number};options:{equipment:string;measurement:string;difference?:string|null}[]};
type Report = {bundle:string;revision:string;ready:boolean;inputs:Input[]};

export function useModelInputs(site:string, placement:string|undefined, model:string, device:string|undefined) {
  const url = placement && /^[a-z][a-z0-9-]{0,39}$/.test(model) ? '/api/runtime/sites/'+site+'/model-inputs?'+new URLSearchParams({placement,model_id:model,...(device?{device}:{})}) : '';
  const [result,setResult]=useState<{url:string;report?:Report;error?:string}>();
  useEffect(()=>{
    if(!url)return;
    const abort=new AbortController();
    const timer=setTimeout(()=>void runtimeRequest<Report>(url,{signal:abort.signal}).then(report=>{
      if(!abort.signal.aborted)setResult({url,report});
    }).catch(e=>{if(!abort.signal.aborted)setResult({url,error:e.message});}),400);
    return ()=>{clearTimeout(timer);abort.abort();};
  },[url]);
  return result?.url===url ? result : undefined;
}

export function ModelInputReport({report,error,onReview}:{report?:Report;error?:string;onReview:()=>void}) {
  if(error)return <p role="alert">{error}</p>;
  if(!report)return <p role="status">Reading the algorithm manifest and Percepta configuration…</p>;
  return <section className="evidence-group"><header><h4>Percepta inputs</h4><small>{report.revision}</small></header>
    <ul>{report.inputs.map(i=><li key={i.name}><span><strong>{i.name}</strong><br/><small>{fieldName(i.meaning.quantity)}{i.meaning.positive_direction && i.meaning.positive_direction!=='none' ? ' · '+fieldName(i.meaning.positive_direction) : ''} · {i.meaning.unit}{i.meaning.interval_seconds ? ' · '+i.meaning.interval_seconds+' s' : ''}</small></span>
      <span>{i.status==='missing'?'No compatible measurement':i.status==='ambiguous'?'Multiple compatible measurements':'Matched'}{i.options.map((o,n)=><small key={n} style={{display:'block'}}>{o.equipment} · {fieldName(o.measurement)}{o.difference && <><br/>{o.difference}</>}</small>)}</span></li>)}</ul>
    {!report.ready && <button type="button" className="btn text" onClick={onReview}>Review Percepta measurements</button>}
    {!report.inputs.length && <p>This algorithm declares no measurement inputs.</p>}
  </section>;
}
