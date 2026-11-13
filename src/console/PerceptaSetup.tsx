import {useEffect,useRef,useState,useId} from 'react';
import {Settings2,Pencil,X,ArrowLeft,ChevronRight,PlugZap,Plus,Activity,SlidersHorizontal,Users} from 'lucide-react';
import {runtimeRequest as runtime,runtimeRequestId,type RuntimeSnapshot,type RuntimeHost,type RuntimeOperation} from '../api/runtimeApi';
import {EVChargingLoader} from '../components/ui/EVChargingLoader';
import {PerceptaConnectionEditor} from './PerceptaConnectionEditor';
import {EquipmentArt} from './EquipmentArt';
import {PerceptaActuatorEditor} from './PerceptaActuatorEditor';
import {PerceptaMeasurementEditor} from './PerceptaMeasurementEditor';
import {api,equipmentConnector,equipmentSource,isPriceSource,sourceForHouse,sourceLabel,type Connection,type Connector,type Channel,type Profile,type Owner,type Source} from './perceptaSetupModel';

type CollectionTarget = { host_id: string; image: string; recSharing?: boolean };
type RecPeer = { site_id: string; name: string };
type SiteCollectionSettings = {
  environment_key: string;
  frequency_seconds: number;
  grace_seconds?: number;
  timezone: string;
  share_with_rec?: boolean;
  rec_peers?: RecPeer[];
};
type Props={target?:CollectionTarget;equipmentId?:string;siteId?:string;communityId?:string;onChange:()=>void;configured?:boolean;compact?:boolean;initialSetup?:boolean;configurationOnly?:boolean;open?:boolean;onOpenChange?:(open:boolean)=>void;hideTrigger?:boolean};
export function PerceptaSetup({target,equipmentId,siteId,communityId,onChange,configured=false,compact=false,initialSetup=false,configurationOnly=false,open:controlledOpen,onOpenChange,hideTrigger=false}:Props){
 const [localOpen,setLocalOpen]=useState(false),open=controlledOpen??localOpen;
 const setOpen=(value:boolean)=>{setLocalOpen(value);onOpenChange?.(value);};
 const label=equipmentId?'Collection settings':communityId?'Community data':configured?'Edit configuration':'Configure Percepta';
 return <>{!hideTrigger&&<button className={compact?'btn runtime-icon-button':'btn'} aria-label={label} title={label} onClick={()=>setOpen(true)}>{compact?<Pencil size={17}/>:<><Settings2 size={16}/>{label}</>}</button>}{open&&<PerceptaWizard target={target} equipmentId={equipmentId} siteId={siteId} communityId={communityId} initialSetup={initialSetup} configurationOnly={configurationOnly} onChange={onChange} onClose={()=>setOpen(false)}/>}</>;
}
function PerceptaWizard({target,equipmentId,siteId,communityId,onChange,onClose,initialSetup,configurationOnly}:{target?:CollectionTarget;equipmentId?:string;siteId?:string;communityId?:string;onChange:()=>void;onClose:()=>void;initialSetup:boolean;configurationOnly:boolean}){
 const communityMode=!!communityId,dialog=useRef<HTMLDialogElement>(null),titleId=useId();
 const [actuatorEditor,setActuatorEditor]=useState(false),[measurementKind,setMeasurementKind]=useState<'calculated'|'forecast'>('calculated');
 const [tab,setTab]=useState(communityMode?'connections':'channels'),[siteName,setSiteName]=useState(''),[rec,setRec]=useState(communityId||''),[owners,setOwners]=useState<Owner[]>([]),[ownerId,setOwner]=useState('');
 const [profiles,setProfiles]=useState<Record<string,Profile|null>>({}),[sources,setSources]=useState<Source[]>([]);
 const [connections,setConnections]=useState<Connection[]>([]),[connectors,setConnectors]=useState<Connector[]>([]);
 const [sourceEditor,setSourceEditor]=useState<Connection|null|undefined>(),[editing,setEditing]=useState<Channel|null|undefined>();
 const [equipmentSourceEditing,setEquipmentSourceEditing]=useState(false);
 const [sourceConnection,setSourceConnection]=useState(''),[device,setDevice]=useState('');
 const [conflict,setConflict]=useState(false);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [envKey,setEnvKey]=useState(''),[frequency,setFrequency]=useState(15),[timezone,setTimezone]=useState('UTC'),[snapshot,setSnapshot]=useState<RuntimeSnapshot|null>(null);
 const [grace, setGrace] = useState(2);
 const [shareWithRec, setShareWithRec] = useState(false);
 const [recPeers, setRecPeers] = useState<RecPeer[]>([]);
 const [destinations,setDestinations]=useState<RuntimeHost[]>([]),[destination,setDestination]=useState(''),[launchPending,setLaunchPending]=useState(false);
 const launchRequest=useRef<string|null>(null);
 const destinationImage = (host?: RuntimeHost) =>
   host?.allowed_images?.find(image => image === host.percepta_collection_image)
   ?? host?.allowed_images?.find(image => /percepta|data-provider/i.test(image));
 const selectedHost = destinations.find(host => host.id === destination);
 const selectedImage = destinationImage(selectedHost);
 const selectedTarget = initialSetup && selectedImage
   ? {host_id: destination, image: selectedImage, recSharing: selectedImage === selectedHost?.percepta_collection_image}
   : target;
 const supportsRecSharing = !!selectedTarget?.recSharing && !!rec;
 const owner=owners.find(o=>o.id===ownerId),profile=profiles[ownerId]||null;
 const source=owner?equipmentSource(owner,profile,sources,connections):null;
 const sourceProvider=connections.find(c=>c.id===sourceConnection)?.provider;
 const needsDevice=sourceProvider==='softcps'||sourceProvider==='cleanwatts_2';
 const sourceDirty=owner?.scope==='assets'&&(sourceConnection!==(source?.connection_id||'')||(needsDevice?device:'')!==(source?.device_id||''));
 const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await work();}catch(e){const stale=editing!==undefined&&(e as {status?:number}).status===409;if(stale)setConflict(true);setError(stale?'This change conflicts with the current data. Your edits have been kept. Copy anything you need before discarding and reloading.':(e as Error).message);}finally{setBusy(false);}};
 const readProfile=async(o:Owner)=>{const r=await fetch(`/community-api/api/${o.scope}/${o.id}/signals`);if(r.status===404)return null;if(!r.ok)throw Error('Unable to load measurements');const p=await r.json();if(!Array.isArray(p.capabilities))throw Error('Invalid measurement catalogue');return p as Profile;};
 const reloadProfile=async(o:Owner)=>{const p=await readProfile(o);setProfiles(previous=>({...previous,[o.id]:p}));};
 const selectOwner=(o:Owner)=>{const s=equipmentSource(o,profiles[o.id],sources,connections);setOwner(o.id);setSourceConnection(s?.connection_id||'');setDevice(s?.device_id||'');setEditing(undefined);setConflict(false);setActuatorEditor(false);setEquipmentSourceEditing(false);setNotice('');setError('');};
 const changed=()=>{setSnapshot(null);onChange();};
 useEffect(()=>{const node=dialog.current!,root=document.documentElement,overflow=root.style.overflow;root.style.overflow='hidden';node.showModal();return()=>{node.close();root.style.overflow=overflow;};},[]);
 useEffect(()=>{let live=true;void run(async()=>{
  let items:Owner[],community=communityId||'',assignmentsForEquipment:Source[]=[];
  if(communityMode){items=[{id:community,name:'Community data',scope:'recs'}];}
  else{
   const [site,assets,settings,assignments]=await Promise.all([api<{name:string;assigned_rec_id:string}>(`/community-api/api/sites/${siteId}`),api<Array<{id?:string;asset_id?:string;data?:{site_id?:string;site_Id?:string;name?:string};name?:string}>>('/community-api/api/assets/'),runtime<SiteCollectionSettings>(`/api/runtime/percepta/sites/${siteId}`),runtime<Source[]>(`/api/runtime/percepta/sites/${siteId}/equipment-sources`)]);
   if(!live)return;community=site.assigned_rec_id;setSiteName(site.name);setEnvKey(settings.environment_key);setFrequency(settings.frequency_seconds);setTimezone(settings.timezone);setSources(assignments);
   setGrace(settings.grace_seconds ?? 2);
   setShareWithRec(settings.share_with_rec ?? false);
   setRecPeers(settings.rec_peers ?? []);assignmentsForEquipment=assignments;
   items=[...assets.filter(a=>String(a.data?.site_id||a.data?.site_Id)===siteId).map(a=>({id:String(a.id||a.asset_id),name:a.data?.name||a.name||'Equipment',scope:'assets' as const})),{id:siteId!,name:'House measurements',scope:'sites'},...(community?[{id:community,name:'Shared community data',scope:'recs' as const}]:[])];
  }
  const [cons,types,entries]=await Promise.all([runtime<Connection[]>(`/api/runtime/connections?community_id=${community}`),runtime<Connector[]>('/api/runtime/connector-types'),Promise.all(items.map(async o=>[o.id,await readProfile(o)] as const))]);
  if(!live)return;setRec(community);setOwners(items);setProfiles(Object.fromEntries(entries));setConnections(cons);setConnectors(types);
  if(communityMode)setOwner(community);
  if(equipmentId){const item=items.find(o=>o.id===equipmentId);if(!item)throw Error('Equipment is no longer available in this house.');const assigned=equipmentSource(item,Object.fromEntries(entries)[equipmentId],assignmentsForEquipment,cons);setOwner(equipmentId);setSourceConnection(assigned?.connection_id||'');setDevice(assigned?.device_id||'');}
  if(initialSetup&&!configurationOnly){const hosts=(await runtime<RuntimeHost[]>('/api/runtime/hosts')).filter(h=>h.mode==='docker'&&destinationImage(h));setDestinations(hosts);setDestination(hosts[0]?.id||'');}
  setReady(true);
 });return()=>{live=false;};},[siteId,communityId,initialSetup,configurationOnly,equipmentId]);
 const saveSource=()=>void run(async()=>{const saved=await runtime<Source>(`/api/runtime/percepta/sites/${siteId}/equipment/${owner!.id}/source`,{method:'PUT',body:JSON.stringify({connection_id:sourceConnection,device_id:needsDevice?device:null})});setSources(previous=>[...previous.filter(s=>s.asset_id!==owner!.id),saved]);setDevice(saved.device_id||'');setEquipmentSourceEditing(false);changed();setNotice('Source saved for this equipment and its measurements.');});
 const saveMeasurement=(body:unknown)=>void run(async()=>{if(conflict)return;if(owner?.scope==='recs'&&!communityMode)throw Error('Community data is edited from community Inventory only.');await api(`/community-api/api/${owner!.scope}/${owner!.id}/signals${editing?'/'+editing.capability_id:''}`,editing?.version?{...(body as object),expected_version:editing.version}:body,editing?'PUT':'POST');await reloadProfile(owner!);setEditing(undefined);changed();setNotice(actuatorEditor?'Actuator definition saved. No command was sent.':communityMode?'Shared measurement saved. Houses use this definition when their configuration is applied.':'Measurement saved.');});
 const startCollection=()=>void run(async()=>{
  if(configurationOnly||!snapshot)return;const host=destinations.find(h=>h.id===destination),image=destinationImage(host);if(!host||!image)throw Error('Choose a deployment destination.');launchRequest.current??=runtimeRequestId();setLaunchPending(true);
  try{const result=await runtime<{instance_id:string;operation:RuntimeOperation}>(`/api/runtime/percepta/sites/${siteId}/launch`,{method:'POST',body:JSON.stringify({request_id:launchRequest.current,version:snapshot.version,host_id:host.id,image})});let operation=result.operation;
   for(let attempt=0;operation.status==='pending'&&attempt<45;attempt++){await new Promise(resolve=>setTimeout(resolve,1000));operation=await runtime<RuntimeOperation>('/api/runtime/operations/'+operation.id);}
   if(operation.status==='failed'){launchRequest.current=null;throw Error(operation.error||'Collection could not start.');}if(operation.status!=='succeeded')throw Error('Start has not been confirmed yet. Check the existing operation before retrying.');onChange();onClose();
  }catch(e){
   if((e as {status?:number}).status===409){setSnapshot(null);launchRequest.current=null;}
   throw e;
  }finally{setLaunchPending(false);}
 });
 const steps=equipmentId?[['channels','Equipment']]:communityMode?[['connections','Sources'],['channels','Shared data']]:[['channels','Equipment'],['general','House data'],...configurationOnly?[]:[['settings',initialSetup?'Review & start':'Review changes']]];
 const step=steps.findIndex(([id])=>id===tab),hasEditor=sourceEditor!==undefined||editing!==undefined||!!sourceDirty;
 const goToStep=(id:string)=>{setNotice('');setError('');if(id==='general')selectOwner(owners.find(o=>o.scope==='sites')!);else if(communityMode&&id==='channels')selectOwner(owners.find(o=>o.scope==='recs')!);else setOwner('');setTab(id);};
 const equipment=owners.filter(o=>o.scope==='assets');
 const readingChannels=(id:string)=>(profiles[id]?.capabilities||[]).filter(c=>c.enabled&&c.capability_type!=='actuator');
 const collected=(c:Channel)=>!!c.collection||!c.mongo_binding;
 const reviewRows=owners.flatMap(o=>(profiles[o.id]?.capabilities||[]).filter(c=>c.enabled&&collected(c)).map(channel=>({owner:o,channel})));
 const connectionName=(c:Connection)=>sourceLabel(c,connections.filter(v=>v.provider===c.provider).length>1);
 const originName=(o:Owner,c:Channel)=>{
  if(c.capability_type==='actuator')return 'Actuator definition';
  if(c.collection?.role?.includes('output'))return 'Calculated by Percepta';
  if(!collected(c))return 'Stored readings';
  const id=o.scope==='assets'?equipmentSource(o,profiles[o.id],sources,connections)?.connection_id||c.collection?.source_binding?.connection_id:c.collection?.source_binding?.connection_id;
  const connection=connections.find(v=>v.id===id);
  return connection?connectionName(connection):'Source missing';
 };
 const equipmentSources=connections.filter(c=>c.id===source?.connection_id||(equipmentConnector(c.provider,profile?.asset_type)&&sourceForHouse(c,siteName,envKey)));
 const selectedSource=connections.find(c=>c.id===source?.connection_id);
 const forecasts=connections.filter(c=>c.provider==='predictor'&&sourceForHouse(c,siteName,envKey));
 const houseChannels=readingChannels(siteId||'');
 const isForecast=(c:Channel)=>c.collection?.role==='input';
 const saveConnection=(connection:Connection)=>{
  setConnections(previous=>[...previous.filter(c=>c.id!==connection.id),connection]);
  if(owner?.scope==='assets'&&sourceEditor===null){setSourceConnection(connection.id);setDevice('');setEquipmentSourceEditing(true);}
  setSourceEditor(undefined);changed();
 };
 const equipmentRow=(o:Owner)=>{
  const assigned=equipmentSource(o,profiles[o.id],sources,connections),current=connections.find(c=>c.id===assigned?.connection_id);
  const channels=readingChannels(o.id).filter(collected).length;
  return <button key={o.id} className="percepta-equipment-row" onClick={()=>selectOwner(o)}><EquipmentArt type={profiles[o.id]?.asset_type}/><span className="percepta-equipment-copy"><strong>{o.name}</strong><small>{current?connectionName(current):'No source connected'}</small></span>{channels>0&&<small>{channels} {channels===1?'measurement':'measurements'}</small>}<ChevronRight size={17}/></button>;
 };
 const sharedData=rec&&<section className="percepta-shared-summary" aria-label="From your community"><div className="percepta-section-heading"><h3><Users size={18}/>From your community</h3></div><p>Included automatically. Edit these in community Inventory → Community data.</p>{readingChannels(rec).length?<ul>{readingChannels(rec).map(c=><li key={c.capability_id}><strong>{c.name}</strong><span>{originName(owners.find(o=>o.id===rec)!,c)}</span></li>)}</ul>:<p>No shared data configured.</p>}</section>;
 const measurementCard=(c:Channel,stored=false)=><button key={c.capability_id} className="percepta-measurement-card" disabled={!!sourceDirty||(stored&&!source)} onClick={()=>{setActuatorEditor(false);setMeasurementKind(isForecast(c)?'forecast':'calculated');setEditing(c);}}><Activity size={18}/><strong>{c.name}</strong><span>{c.unit||'State'}{stored?' · Stored readings':''}<ChevronRight size={14}/></span></button>;
 return <dialog ref={dialog} className="percepta-dialog runtime-modal" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
 <header className="percepta-dialog-header"><div><span className="eyebrow">{equipmentId?'Equipment settings':<>{communityMode?'Community setup':'Collection setup'} · step {step+1} of {steps.length}</>}</span><h2 id={titleId}>{equipmentId?'Equipment collection':communityMode?'Community data':'Configure Percepta'}</h2></div><button className="btn" aria-label="Close configuration" disabled={busy} onClick={onClose}><X size={18}/></button></header>
 {!equipmentId&&<ol className="wizard-steps" aria-label="Collection setup steps">{steps.map(([id,title],i)=><li key={id}><button disabled={busy||!ready||hasEditor||i>step} aria-current={i===step?'step':undefined} onClick={()=>goToStep(id)}><span>{i+1}</span>{title}</button></li>)}</ol>}
 <div className="percepta-dialog-content percepta-setup"><fieldset className="percepta-wizard-content" disabled={busy}>
 {error&&<p role="alert" className="notice">{error}{conflict&&owner&&<button className="btn" disabled={busy} onClick={()=>void run(async()=>{await reloadProfile(owner);setEditing(undefined);setConflict(false);setNotice('Latest data loaded. Select the measurement again to review and edit.');})}>Discard edits and reload</button>}</p>}{notice&&<p role="status">{notice}</p>}{!ready&&!error&&<div className="percepta-configuration-loading"><EVChargingLoader label="Loading configuration…"/></div>}
 {ready&&sourceEditor!==undefined?<PerceptaConnectionEditor
   key={sourceEditor?.id||'new'}
   communityId={rec}
   connection={sourceEditor||undefined}
   connectors={connectors.filter(c=>communityMode?isPriceSource(c.id):tab==='general'?c.id==='predictor':equipmentConnector(c.id,profile?.asset_type)||c.id===sourceEditor?.provider)}
   onBusyChange={setBusy}
   onSave={saveConnection}
   onCancel={()=>setSourceEditor(undefined)}
 />:ready&&<>
 {tab==='connections'&&<>
   <div className="percepta-section-heading"><div><h3>Community sources</h3><p>Connect the services that supply shared data.</p></div><button className="btn" onClick={()=>setSourceEditor(null)}><Plus size={16}/>Add source</button></div>
   <div className="percepta-source-grid">{connections.filter(c=>isPriceSource(c.provider)).map(c=><article className="percepta-source-card" key={c.id}>
     <div className="percepta-source-identity"><strong>{c.name}</strong><span>{connectors.find(t=>t.id===c.provider)?.name||c.provider}</span></div>
     <button className="percepta-source-edit" aria-label={'Edit connection '+c.name} title="Edit connection" onClick={()=>setSourceEditor(c)}><Pencil size={15}/></button>
   </article>)}</div>
 </>}
 {tab==='channels'&&!owner&&<section aria-label="Equipment in this house">
   <div className="percepta-section-heading"><div><h3>Equipment in {siteName||'this house'}</h3><p>Choose a device to connect its source and set up its measurements.</p></div></div>
   {equipment.length?<div className="percepta-device-list">{equipment.map(equipmentRow)}</div>:<p className="percepta-empty">Add equipment in Inventory to start collecting readings.</p>}
 </section>}
 {owner&&tab!=='settings'&&<>
   {owner.scope==='assets'&&!equipmentId&&<button className="btn text" disabled={hasEditor} onClick={()=>goToStep('channels')}><ArrowLeft size={15}/>All equipment</button>}
   {owner.scope==='assets'&&<div className="percepta-device-heading"><EquipmentArt type={profile?.asset_type}/><h3>{owner.name}</h3></div>}
   {editing!==undefined?actuatorEditor?<PerceptaActuatorEditor channel={editing||undefined} onSave={saveMeasurement} onCancel={()=>{setEditing(undefined);setConflict(false);setError('');}} busy={busy||conflict}/>:
     <PerceptaMeasurementEditor
       key={editing?.capability_id||'new'}
       channel={editing||undefined}
       owner={owner} profile={profile} source={source}
       connections={connections.map(c=>({...c,name:connectionName(c)}))}
       forecastSourceIds={forecasts.map(c=>c.id)}
       houseMeasurementKind={owner.scope==='sites'?measurementKind:undefined}
       frequency={frequency}
       vehicles={equipment.filter(o=>['ev','electric_vehicle'].includes(profiles[o.id]?.asset_type||''))}
       onSave={saveMeasurement}
       onCancel={()=>{setEditing(undefined);setConflict(false);setError('');}}
       busy={busy||conflict}
     />:tab==='general'?<>
       <section aria-label="Calculated measurements">
         <div className="percepta-section-heading"><div><h3>Calculated measurements</h3><p>Percepta calculates these from the house readings.</p></div><button className="btn" onClick={()=>{setMeasurementKind('calculated');setEditing(null);}}><Plus size={16}/>Add calculation</button></div>
         {houseChannels.some(c=>!isForecast(c))&&<div className="percepta-measurement-grid">{houseChannels.filter(c=>!isForecast(c)).map(c=>measurementCard(c))}</div>}
       </section>
       <section className="percepta-shared-summary" aria-label="Forecasts">
         <div className="percepta-section-heading"><div><h3>Forecasts</h3>{!forecasts.length&&<p>Connect a Predictor feed for this house to add forecasts.</p>}</div><div className="percepta-source-form-actions">{forecasts.map(c=><button className="btn text" key={c.id} onClick={()=>setSourceEditor(c)}>Edit {c.name}</button>)}{forecasts.length>0?<button className="btn" onClick={()=>{setMeasurementKind('forecast');setEditing(null);}}><Plus size={16}/>Add forecast</button>:<button className="btn" disabled={!connectors.some(c=>c.id==='predictor'&&c.available)} onClick={()=>setSourceEditor(null)}><Plus size={16}/>Add forecast source</button>}</div></div>
         {houseChannels.some(isForecast)&&<div className="percepta-measurement-grid">{houseChannels.filter(isForecast).map(c=>measurementCard(c))}</div>}
       </section>
       {sharedData}
     </>:<>
       {owner.scope==='assets'&&(equipmentSourceEditing||!source||sourceDirty?<form className="percepta-equipment-source" onSubmit={e=>{e.preventDefault();saveSource();}}>
         <div className="percepta-fields"><label>Data source<select required value={sourceConnection} onChange={e=>{setSourceConnection(e.target.value);if(e.target.value!==sourceConnection)setDevice(e.target.value===source?.connection_id?source.device_id||'':'');}}><option value="">Choose a source</option>{equipmentSources.map(c=><option key={c.id} value={c.id}>{connectionName(c)}</option>)}</select></label>{needsDevice&&<label>Device identifier<input required value={device} onChange={e=>setDevice(e.target.value)} placeholder="Identifier used by the source"/></label>}</div>
         <div className="percepta-source-form-actions"><button type="button" className="btn text" onClick={()=>setSourceEditor(null)}><Plus size={15}/>Create source</button>{source&&<button type="button" className="btn text" onClick={()=>{setSourceConnection(source.connection_id);setDevice(source.device_id||'');setEquipmentSourceEditing(false);}}>Cancel</button>}{sourceDirty&&<button className="btn primary" disabled={!sourceConnection||(needsDevice&&!device.trim())}>Save connection</button>}</div>
       </form>:<div className="percepta-source-summary">
         <PlugZap size={18}/><span>{selectedSource?connectionName(selectedSource):'Source unavailable'}{source.device_id&&<small>Device {source.device_id}</small>}</span>
         <button className="btn text" onClick={()=>setEquipmentSourceEditing(true)}>Change source</button>
         {selectedSource&&<button className="btn text" aria-label="Edit source settings" title="Edit source settings" onClick={()=>setSourceEditor(selectedSource)}><Pencil size={16}/></button>}
       </div>)}
       {communityMode&&<p className="percepta-step-description">Shared prices and totals are included when houses apply their configuration.</p>}
       <div className="percepta-section-heading"><div><h4>Measurements</h4>{owner.scope==='assets'&&!source&&<p>Connect a source to set up live readings.</p>}</div><button className="btn" disabled={!!sourceDirty||(owner.scope==='assets'&&!source)} onClick={()=>{setActuatorEditor(false);setEditing(null);}}><Plus size={15}/>Add measurement</button></div>
       {readingChannels(owner.id).some(collected)&&<div className="percepta-measurement-grid">{readingChannels(owner.id).filter(collected).map(c=>measurementCard(c))}</div>}
       {readingChannels(owner.id).some(c=>!collected(c))&&<details>
         <summary>Stored readings ({readingChannels(owner.id).filter(c=>!collected(c)).length})</summary>
         <p className="percepta-helper">Connect a source and open a stored channel to configure live collection for it.</p>
         <div className="percepta-measurement-grid">{readingChannels(owner.id).filter(c=>!collected(c)).map(c=>measurementCard(c,true))}</div>
       </details>}
       {owner.scope==='assets'&&(['battery','ev_charger','pv_panel','solar_pv','solar_panel'].includes(profile?.asset_type||'')||profile?.capabilities.some(c=>c.capability_type==='actuator'))&&
         <section className="percepta-actuators"><div className="percepta-section-heading"><h4><SlidersHorizontal size={16}/>Actuators</h4>{['battery','ev_charger','pv_panel','solar_pv','solar_panel'].includes(profile?.asset_type||'')&&<button className="btn" disabled={!!sourceDirty} onClick={()=>{setActuatorEditor(true);setEditing(null);}}><Plus size={15}/>Add actuator</button>}</div>
         <div className="percepta-measurement-grid">{profile?.capabilities.filter(c=>c.capability_type==='actuator').map(c=><button key={c.capability_id} className="percepta-measurement-card" disabled={!!sourceDirty} onClick={()=>{setActuatorEditor(true);setEditing(c);}}><SlidersHorizontal size={16}/><strong>{c.name}</strong><span>{c.unit||'Command'}<ChevronRight size={14}/></span></button>)}</div></section>}
       {owner.scope==='assets'&&profile&&<details className="percepta-technical-settings"><summary>Advanced equipment settings</summary><form onSubmit={e=>{e.preventDefault();void run(async()=>{await api('/telemetry-api/api/telemetry-profiles/'+profile.profile_id,{entity_key:profile.entity_key||null},'PUT');changed();setNotice('Technical identifier saved.');});}}><label>Technical key<input value={profile.entity_key||''} onChange={e=>setProfiles(previous=>({...previous,[ownerId]:{...profile,entity_key:e.target.value}}))}/></label><button className="btn">Save technical settings</button></form></details>}
     </>}
 </>}
 {!configurationOnly&&tab==='settings'&&<><h3>Review collection</h3>
 <p className="percepta-helper">{reviewRows.length} configured {reviewRows.length===1?'channel':'channels'} for {siteName}.</p>
 {reviewRows.length>0&&<details className="percepta-review-table"><summary>Review channels and sources</summary><table><thead><tr><th>Channel</th><th>Equipment or scope</th><th>Source</th></tr></thead><tbody>{reviewRows.map(({owner:o,channel:c})=><tr key={c.capability_id}><td>{c.name}</td><td>{o.name}</td><td>{originName(o,c)}</td></tr>)}</tbody></table></details>}
 {initialSetup&&<div className="percepta-launch-destination">{destinations.length>1?<label>Run collection on<select value={destination} onChange={e=>{setDestination(e.target.value);setSnapshot(null);launchRequest.current=null;}}>{destinations.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>:destinations.length===1?<p>Run collection on {destinations[0].name}</p>:<p role="alert">A platform administrator needs to enable a deployment destination before collection can start.</p>}</div>}
 <form id="percepta-review-form" onSubmit={event => {
   event.preventDefault();
   void run(async () => {
     await runtime(`/api/runtime/percepta/sites/${siteId}`, {
       method: 'PUT',
       body: JSON.stringify({
         environment_key: envKey, frequency_seconds: frequency, timezone, grace_seconds: grace,
         ...(supportsRecSharing ? {share_with_rec: shareWithRec} : {}),
       }),
     });
     const params = selectedTarget
       ? '?' + new URLSearchParams({host_id: selectedTarget.host_id, image: selectedTarget.image})
       : '';
     setSnapshot(await runtime(`/api/runtime/percepta/sites/${siteId}/preview${params}`, {method: 'POST'}));
     if (supportsRecSharing) {
       const settings = await runtime<SiteCollectionSettings>(`/api/runtime/percepta/sites/${siteId}`);
       setRecPeers(settings.rec_peers ?? []);
     }
     launchRequest.current = null;
     onChange();
   });
 }}>
   <div className="percepta-fields">
     <label>Collection interval (seconds)<input type="number" min="5" value={frequency} onChange={event => {setFrequency(Number(event.target.value)); setSnapshot(null);}} /></label>
     <label>Timezone<input value={timezone} onChange={event => {setTimezone(event.target.value); setSnapshot(null);}} /></label>
   </div>
   {supportsRecSharing && <section aria-label="Community sharing">
     <h4>Community sharing</h4>
     <label className="percepta-check">
       <input type="checkbox" checked={shareWithRec} onChange={event => {setShareWithRec(event.target.checked); setSnapshot(null);}} />
       Share readings with this community
     </label>
     <p className="percepta-helper">Houses that enable sharing become peers. Choose Community in the measurement settings to share a reading. Apply the new configuration on each affected house.</p>
     {shareWithRec && (recPeers.length > 0
       ? <ul aria-label="Other houses sharing readings">{recPeers.map(peer => <li key={peer.site_id}>{peer.name}</li>)}</ul>
       : <p className="percepta-helper">No other house has enabled sharing yet.</p>)}
   </section>}
   <details>
     <summary>Advanced settings</summary>
     <div className="percepta-fields">
       <label>House key<input required value={envKey} onChange={event => {setEnvKey(event.target.value); setSnapshot(null);}} /></label>
       <label>Grace period (seconds)<input type="number" min="0" max="30" value={grace} onChange={event => {setGrace(Number(event.target.value)); setSnapshot(null);}} /></label>
     </div>
   </details>
 </form>
 {snapshot&&<div className="percepta-review" role="status"><h4>Configuration ready</h4><p>{initialSetup?'Ready to create the instance and start collection.':supportsRecSharing?'Apply the configuration from the instance controls.':'Stop the instance before applying changes from its controls.'}</p>{snapshot.warnings.map(w=><p key={w}>{w}</p>)}<details><summary>Generated configuration</summary><pre>{JSON.stringify(snapshot.payload,null,2)}</pre></details></div>}</>}
 </>}
 </fieldset></div>
 <footer className="percepta-wizard-footer"><p>{hasEditor?'Save or cancel the current edit to continue.':configurationOnly?'Save changes in each editor.':communityMode?'Shared changes take effect when each house applies its configuration.':initialSetup?'Collection starts only when you select Create & start.':'Saved changes take effect when you apply the configuration.'}</p><div><button className="btn" disabled={busy||hasEditor} onClick={()=>step?goToStep(steps[step-1][0]):onClose()}>{step?'Back':'Close'}</button>{equipmentId?<button className="btn primary" disabled={busy||hasEditor} onClick={onClose}>Done</button>:step<steps.length-1?<button className="btn primary" disabled={!ready||busy||hasEditor} onClick={()=>goToStep(steps[step+1][0])}>{communityMode?'Next: shared data':step===0?'Next: house data':'Next: review'}</button>:(communityMode||configurationOnly)?<button className="btn primary" disabled={busy||hasEditor} onClick={onClose}>Done</button>:snapshot?<button className="btn primary" disabled={busy||(initialSetup&&!destination)} onClick={initialSetup?startCollection:onClose}>{launchPending?'Starting…':initialSetup?'Create & start':'Done'}</button>:<button form="percepta-review-form" type="submit" className="btn primary" disabled={!ready||busy}>{busy?'Generating…':'Generate configuration'}</button>}</div></footer>
 </dialog>;
}
