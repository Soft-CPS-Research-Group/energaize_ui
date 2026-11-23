import { useEffect, useState } from "react";
import { CheckCheck, CircuitBoard, Waves, Zap } from "lucide-react";
import { fieldName, FieldValues } from "./CycleReadings";
import { runtimeRequest } from "../api/runtimeApi";
import { EquipmentArt } from "./EquipmentArt";
import type { Profile, Source, Connection } from "./perceptaSetupModel";

export function EquipmentIcon({ kind }: { kind: string }) {
  if (kind === "forecast_service") return <Waves aria-hidden="true" size={19}/>;
  if (kind === "energy_market") return <Zap aria-hidden="true" size={19}/>;
  return <EquipmentArt type={kind}/>;

}
export function readingValue(value: unknown) {
  return typeof value === "number" ? value.toLocaleString("en-GB", {maximumSignificantDigits: 7}) : String(value);
}

type Asset = {id?: string; asset_id?: string; name?: string; asset_type?: string; data?: {name?: string; site_id?: string; site_Id?: string; lifecycle_status?: string}};
type NativeParameter = {parameter_type_id: string; measurement_unit?: string; derived_from?: string};
type NativeSource = {fetch_key?: string; match_key?: string; topic?: string; source_measurement_unit?: string};
type NativeEnvironment = {
  entities: Record<string, {parameters: Record<string, NativeParameter>}>;
  telemetry_systems: Record<string, {source_mapping: Record<string, NativeSource>}>;
};
type Equipment = {id: string; name: string; kind: string; profile?: Profile; unavailable?: boolean; source?: Source; sourcesUnavailable?: boolean};
export function EquipmentSources({ siteId }: { siteId: string }) {
  const [items, setItems] = useState<Equipment[]>();
  const [adapters,setAdapters] = useState<Record<string,Connection>>({});
  const [environment, setEnvironment] = useState<NativeEnvironment>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const options = {signal: controller.signal};
    async function load() {
      async function adapterNames() {
        const house = await fetch("/community-api/api/sites/"+encodeURIComponent(siteId), options);
        if (!house.ok) return {};
        const {assigned_rec_id} = await house.json();
        if (!assigned_rec_id) return {};
        const connections = await runtimeRequest<Connection[]>("/api/runtime/connections?community_id="+encodeURIComponent(assigned_rec_id),options);
        return Object.fromEntries(connections.map(connection => [connection.id, connection]));
      }
      const [response, sources, names, preview] = await Promise.all([
        fetch("/community-api/api/assets/", options),
        runtimeRequest<Source[]>("/api/runtime/percepta/sites/"+encodeURIComponent(siteId)+"/equipment-sources",options).catch(() => undefined),
        adapterNames().catch(()=>({})),
        runtimeRequest<{payload: {environment: Record<string, NativeEnvironment>}}>(
          "/api/runtime/percepta/sites/"+encodeURIComponent(siteId)+"/preview?mode=current_environment",
          {...options,method:"POST"},
        ).catch(()=>undefined),
      ]);
      if (!response.ok) throw Error("Equipment inventory is unavailable.");
      const assets: Asset[] = await response.json();
      const house = assets.filter(a => (a.data?.site_id || a.data?.site_Id) === siteId && a.data?.lifecycle_status !== "retired");
      const results = await Promise.all(house.map(async asset => {
        const item = {id: String(asset.id || asset.asset_id), name: asset.data?.name || asset.name || "Equipment", kind: asset.asset_type || "", source: sources?.find(s => s.asset_id === (asset.id || asset.asset_id)), sourcesUnavailable: !sources};
        try {
          const res = await fetch("/community-api/api/assets/"+encodeURIComponent(item.id)+"/signals", options);
          if (res.status === 404) return item;
          if (!res.ok) throw Error();
          const profile: Profile = await res.json();
          if (!Array.isArray(profile.capabilities)) throw Error();
          return {...item, kind: profile.asset_type || item.kind, profile};
        } catch { return {...item, unavailable: true}; }
      }));
      if (!controller.signal.aborted) {setItems(results);setAdapters(names);setEnvironment(Object.values(preview?.payload?.environment || {})[0]);}
    }
    void load().catch(() => { if (!controller.signal.aborted) setError("Equipment inventory is unavailable."); });
    return () => controller.abort();
  }, [siteId]);
  if (error) return <p role="alert">{error}</p>;
  if (!items) return <div className="equipment-loading" role="status"><EquipmentArt type="grid_meter"/><span>Loading equipment…</span></div>;
  if (!items.length) return <p>No equipment registered for this house.</p>;
  return <><p>{environment ? "Equipment sources and the outputs defined in this house’s Percepta environment." : "Saved equipment mappings. The generated environment is unavailable."}</p>
    <div className="evidence-stack">{items.map(item => {
      const channels = item.profile?.capabilities.filter(c => c.capability_type !== "actuator" && (c.collection?.role === "input" || (c.enabled && !c.collection && !c.mongo_binding))) || [];
      return <section className="evidence-group" key={item.id}><header><EquipmentIcon kind={item.kind}/><h4>{item.name}</h4></header>
        {item.unavailable ? <p>Measurement configuration unavailable</p> : !channels.length ? <p>No measurement inputs configured</p> :
          <ul className="equipment-source-list">{channels.map(channel => {
            const contract = channel.collection;
            const binding = contract?.source_binding;
            const id = binding?.connection_id || item.source?.connection_id;
            const adapter = id ? adapters[id] : undefined;
            const key = contract?.parameter_key || channel.capability_id;
            const output = environment?.entities[item.profile?.entity_key || item.id]?.parameters[key];
            const mapping = Object.values(environment?.telemetry_systems || {}).find(system => system.source_mapping[key])?.source_mapping[key] || binding;
            const device = mapping?.fetch_key || (id === item.source?.connection_id ? item.source?.device_id : undefined);
            const derived = !!output?.derived_from || contract?.parameter_type_id === "electric_vehicle" && !binding?.mapping_required;
            const reference = derived ? "Charging session" : [
              device && (adapter?.provider === "cleanwatts" ? "Tag " + device : device),
              mapping?.topic,
              mapping?.match_key !== device && mapping?.match_key,
            ].filter(Boolean).join(" · ");
            const inputUnit = mapping?.source_measurement_unit;
            const outputUnit = output?.measurement_unit ?? channel.unit;
            return <li key={channel.capability_id}>
              <div><strong>{fieldName(channel.name)}</strong>
                <small>{derived ? "Derived by Percepta" : adapter?.name || (id || item.sourcesUnavailable ? "Source unavailable" : "No source linked")}</small>
                {reference && <small className="equipment-source-reference">{reference}</small>}
              </div>
              <div className="equipment-source-output">
                {contract && <code>{output?.parameter_type_id || contract.parameter_type_id}</code>}
                <small>{inputUnit && inputUnit !== outputUnit ? inputUnit + " → " : ""}{outputUnit}</small>
                {!channel.enabled && <small>Pending</small>}
              </div>
            </li>;
          })}</ul>}
      </section>;
    })}</div></>;
}

export function ProposalReceipt({ decision }: { decision: Record<string, unknown> }) {
  const actions = Array.isArray(decision.actions) ? decision.actions : [];
  return <section className="evidence-group proposal-receipt"><header><CheckCheck size={21}/><h4>Returned to Percepta</h4></header>
    {actions.length ? <ul>{actions.map((a,i) => <li key={i}><span>{a?.action_name === "reference_kw" ? "Power reference" : fieldName(String(a?.action_name || "Proposed action"))}</span><strong>{a?.value == null ? "—" : readingValue(a.value)} {String(a?.unit || "")}</strong></li>)}</ul> : <p>No actions in this proposal.</p>}
    <footer><CircuitBoard size={16}/>{[decision.bundle_id, decision.bundle_revision, ...(Array.isArray(decision.providers) ? decision.providers : []), decision.mode].filter(Boolean).map(String).join(" · ")}</footer>
    <details><summary>Receipt details</summary><FieldValues value={decision}/></details>
  </section>;
}
