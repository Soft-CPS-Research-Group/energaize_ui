/** Transparent vector versions of Inventory's original product illustrations.
 * The SVG assets are rendered from public/console/product-art.js, without a paper tile. */
export function EquipmentArt({type}:{type?:string}){
 const kinds:Record<string,string>={home:'home',pv_system:'sun',pv_panel:'sun',solar_pv:'sun',solar_panel:'sun',battery:'battery',ev_charger:'charger',electric_vehicle:'car',ev:'car',community:'community',grid_meter:'bolt',appliance:'appliance',heat_pump:'heat',heater:'heat',thermal_storage:'heat',water_pump:'pump',micro_wind_turbine:'wind'};
 return <img className="percepta-equipment-art" src={`/assets/equipment-icons/${kinds[type||'']||'device'}.svg`} alt="" aria-hidden="true"/>;
}
