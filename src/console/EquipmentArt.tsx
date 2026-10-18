/** The same Mediterranean illustration sheets used by inventory and topology. */
export function EquipmentArt({type}:{type?:string}){
 const tiles:Record<string,[string,number]>={home:['ceramic',0],pv_system:['ceramic',1],pv_panel:['ceramic',1],solar_pv:['ceramic',1],solar_panel:['ceramic',1],battery:['ceramic',2],ev_charger:['ceramic',3],electric_vehicle:['ceramic',3],ev:['ceramic',3],community:['ceramic',4],grid_meter:['ceramic-extra',0],appliance:['ceramic-extra',1],heat_pump:['ceramic-extra',2],heater:['ceramic-extra',2],thermal_storage:['ceramic-extra',2]};
 const [sheet,index]=tiles[type||'']||['ceramic',5];
 return <span className="percepta-equipment-art" aria-hidden="true" style={{backgroundImage:`url('/assets/mediterranean/${sheet}.webp')`,backgroundPosition:`${(index%3)*50}% ${index<3?0:100}%`}}/>;
}
