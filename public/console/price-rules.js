/* Display contract component curves. No billing, tariff-calendar inference or invented index values. */
(function(root){
 function chain(version,code,overrides={},seen=new Set()){
  if(seen.has(code))throw Error('Circular price reference');seen.add(code);
  const component=version.components.find(c=>c.code===code);if(!component)throw Error('Unknown price component '+code);
  const rule=overrides[code]||component.price;
  if(rule.kind==='fixed')return {source:null,evaluate:()=>Number(rule.value)};
  if(rule.kind==='indexed')return {source:rule.source,evaluate:value=>{if(typeof value!=='number'||!Number.isFinite(value))return null;let n=value*Number(rule.multiplier??1)+Number(rule.adder??0);if(rule.floor!=null)n=Math.max(n,Number(rule.floor));if(rule.cap!=null)n=Math.min(n,Number(rule.cap));return n;}};
  const base=chain(version,rule.reference_component,overrides,seen);return {...base,evaluate:value=>{const n=base.evaluate(value);return n===null?null:n*Number(rule.multiplier);}};
 }
 const formatters=new Map();
 function day(timestamp,timezone){if(!formatters.has(timezone))formatters.set(timezone,new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}));return formatters.get(timezone).format(new Date(timestamp));}
 function valid(timestamp,version,timezone){const d=day(timestamp,timezone);return d>=version.valid_from&&(!version.valid_until||d<version.valid_until);}
 function project(data,version,code,timezone,overrides){const rule=chain(version,code,overrides);return {...data,points:data.points.map(p=>({...p,value:valid(p.timestamp,version,timezone)?rule.evaluate(p.value):null}))};}
 function compact(data,start,end,limit=1200){
  if(data.points.length<=limit)return data;
  const width=(end-start)/Math.floor(limit/5),buckets=new Map();
  for(const p of data.points){const key=Math.floor((Date.parse(p.timestamp)-start)/width),b=buckets.get(key)||[];b.push(p);buckets.set(key,b);}
  const kept=new Map();for(const bucket of buckets.values()){const numeric=bucket.filter(p=>typeof p.value==='number'&&Number.isFinite(p.value));const min=numeric.reduce((a,b)=>!a||b.value<a.value?b:a,null),max=numeric.reduce((a,b)=>!a||b.value>a.value?b:a,null);for(const p of [bucket[0],min,max,bucket.find(p=>typeof p.value!=='number'),bucket.at(-1)])if(p)kept.set(p.id,p);}
  return {...data,points:[...kept.values()].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)),sample_count:data.points.length,resolution:'extrema_envelope',bucket_seconds:width/1000};
 }
 root.PriceRules={chain,valid,project,compact};
})(globalThis);
