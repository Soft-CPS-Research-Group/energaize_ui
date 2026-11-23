import { useState } from "react";
import { FlaskConical } from "lucide-react";

const stages = [
  { id:"request", name:"Cycle", route:"Percepta → Inference", fields:[["Grid import","0.04 kWh"],["Cycle duration","60 s"]] },
  { id:"decision", name:"Proposal", route:"Inference → Percepta", fields:[["Proposed power reference","2.4 kW"],["Mode","Observation"]] },
  { id:"safety", name:"Review", route:"Percepta → Fail-safe supervisor", fields:[["Proposed reference","2.4 kW"],["Example power limit","3 kW"]] },
  { id:"verdict", name:"Verdict", route:"Fail-safe supervisor → Percepta", fields:[["Result","Within example limit"],["Reviewed reference","2.4 kW"]] },
  { id:"dispatch", name:"Command", route:"Percepta → Equipment", fields:[["Power reference","2.4 kW"],["Dispatch","Simulated only"]] },
];
export function ControlPreview({ stage }: { stage: string }) {
  const [index,setIndex] = useState<number>();
  const from = stages.findIndex(s=>s.id===stage);
  if (from < 0) return null;
  if (index == null) return <button className="btn" type="button" onClick={()=>setIndex(from)}><FlaskConical size={16}/>Preview example</button>;
  const step = stages[index];
  return <section className="control-example" aria-label="Simulated control cycle">
    <header><FlaskConical size={17}/><strong>Example cycle</strong><span>Simulation only</span></header>
    <nav aria-label="Example steps">{stages.map((s,i)=><button type="button" key={s.id} onClick={()=>setIndex(i)} aria-current={i===index ? "step" : undefined}>{i+2} · {s.name}</button>)}</nav>
    <h4>{step.route}</h4><dl className="cycle-fields">{step.fields.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <small>Sample values. No services are called or equipment commands sent.</small>
  </section>;
}
