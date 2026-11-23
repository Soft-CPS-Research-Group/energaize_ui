import { useState } from "react";

export type SeriesPoint = { start: string; end?: string; value: number | null; quality?: string };
const number = new Intl.NumberFormat("en-GB", { maximumSignificantDigits: 6 });
// Native Percepta intervals use a space and a compact UTC offset.
const epoch = (s: string) => Date.parse(s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/, "$1T$2$3:$4"));
const time = (s: string) => Number.isFinite(epoch(s))
  ? new Date(epoch(s)).toLocaleString("en-GB", {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"}) : s || "—";

/** Each interval has its own extent. Missing samples leave a gap. */
export function DeploymentSeries({ title, unit, points }: { title: string; unit: string; points: SeriesPoint[] }) {
  const [table, setTable] = useState(false);
  const samples = points.map(p=>({...p, x:epoch(p.start), until:epoch(p.end || "")})).filter(p=>Number.isFinite(p.x)).sort((a,b)=>a.x-b.x);
  const values = samples.flatMap(p=>p.value != null && Number.isFinite(p.value) ? [p.value] : []);
  const lo = Math.min(0,...values), hi = Math.max(0,...values);
  const hasEnd = points.some(p=>p.end), hasQuality = points.some(p=>p.quality);
  const first = samples[0], last = samples[samples.length-1];
  const end = Math.max(...samples.map(p=>Number.isFinite(p.until) ? p.until : p.x));
  const x = (v:number) => 2+396*(v-first.x)/(end-first.x || 1);
  const y = (v:number) => 58-55*(v-lo)/(hi-lo || 1);
  return <section className="deployment-series" aria-label={title}>
    <header><h4>{title}</h4><span>{points.length} {hasEnd ? "intervals" : "samples"}</span></header>
    {first && last && values.length > 0 ? <>
      <div className="series-range">{number.format(Math.min(...values))} – {number.format(Math.max(...values))} {unit}</div>
      <svg viewBox="0 0 400 62" preserveAspectRatio="none" role="img" aria-label={title+" from "+time(first.start)+" to "+time(last.end || last.start)}>
        <path d={'M0 '+y(0)+' H400'} stroke="currentColor" opacity=".25"/>
        {samples.map((p,i)=>p.value == null || !Number.isFinite(p.value) ? null :
          <rect key={i} x={x(p.x)} y={Math.min(y(p.value),y(0))} width={Number.isFinite(p.until) ? Math.max(1,x(p.until)-x(p.x)-.8) : 2}
            height={Math.max(1,Math.abs(y(p.value)-y(0)))} fill="currentColor"><title>{time(p.start)} · {number.format(p.value)} {unit}</title></rect>)}
      </svg>
      <div className="series-axis"><span>{time(first.start)}</span><span>{time(last.end || last.start)}</span></div>
    </> : <p>No dated values available to plot.</p>}
    <button type="button" className="btn text" aria-expanded={table} onClick={()=>setTable(!table)}>{table ? "Hide values" : "View values"}</button>
    {table && <div className="series-table"><table><thead><tr><th>From</th>{hasEnd&&<th>Until</th>}<th>Value {unit && "("+unit+")"}</th>{hasQuality&&<th>Quality</th>}</tr></thead>
      <tbody>{points.map((p,i)=><tr key={i}><td>{time(p.start)}</td>{hasEnd&&<td>{time(p.end || "")}</td>}<td>{p.value == null ? "Missing" : number.format(p.value)}</td>{hasQuality&&<td>{p.quality || "—"}</td>}</tr>)}</tbody></table></div>}
  </section>;
}
