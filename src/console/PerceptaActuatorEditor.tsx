import {useState} from 'react';
import type {Channel} from './perceptaSetupModel';
export function PerceptaActuatorEditor({channel,onSave,onCancel}:{channel?:Channel;onSave:(body:unknown)=>void;onCancel:()=>void}){
 const [actuatorType,setActuatorType]=useState(channel?.collection?.parameter_type_id||(channel&&!channel.name.toLowerCase().includes('power')?channel.name:'power_actuation'));
 const [name,setName]=useState(channel?.name||'Power setpoint'),[unit,setUnit]=useState(channel?.unit||'kW'),[key,setKey]=useState(channel?.collection?.parameter_key||''),[enabled,setEnabled]=useState(channel?.collection?channel.enabled:true);
 return <form className="percepta-channel-editor" onSubmit={e=>{e.preventDefault();onSave({name,unit,enabled,data_type:channel?.data_type||'float',capability_type:'actuator',...(!channel?{source_kind:'physical'}:{}),collection:{...channel?.collection,parameter_type_id:actuatorType,parameter_key:key||null,role:'actuator',necessary:channel?.collection?.necessary??true,privacy:channel?.collection?.privacy||'private'}});}}>
 <h4>{channel?'Edit actuator':'Add actuator'}</h4><p>Save the command definition for this equipment. No command is sent.</p><div className="percepta-fields"><label>Name<input required value={name} onChange={e=>setName(e.target.value)}/></label><label>Unit<input required value={unit} onChange={e=>setUnit(e.target.value)}/></label></div>
 <details><summary>Advanced actuator settings</summary><label>Technical key<input value={key} onChange={e=>setKey(e.target.value)}/></label><label>Actuator type<input required value={actuatorType} onChange={e=>setActuatorType(e.target.value)}/></label></details>
 <label className="percepta-check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Include this definition in configuration</label><footer className="percepta-editor-actions"><button className="btn" type="button" onClick={onCancel}>Cancel</button><button className="btn primary">Save actuator</button></footer>
 </form>;
}
