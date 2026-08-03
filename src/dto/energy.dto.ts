export type EnergyCommunityDTO = {
    energy_community: string
    collections: Record<string, BuildingDTO>
}

export type BuildingDTO = {
    items: BuildingItemDTO[]
}

export type BuildingItemDTO = {
    _id: string
    timestamp: string
    observations: ObservationDTO
}

export type ObservationDTO = {
    batteries: Record<string, BatteryDTO>
    grid_meters: Record<string, GridDTO>
    solar_generation: number
    energy_price: number
    charging_session: Record<string, ChargerDTO>
    electric_vehicles: Record<string, ElectricVehicleDTO>
    non_shiftable_load: number
}

export type ChargerDTO = {
    power: number | string
    electric_vehicle: string
}

export type GridDTO = {
    energy_in_total: number
    energy_out_total: number
}

export type BatteryDTO = {
    energy_in: number
    energy_out: number
    SoC: number
}

export type ElectricVehicleDTO = {
    SoC: number;
    flexibility: {
        estimated_soc_at_arrival: number | null;
        estimated_soc_at_departure: number | null;
        estimated_time_at_arrival: string;
        estimated_time_at_departure: string;
        charger: string;
        mode: string;
    };
}

//export type EnergyPriceDTO = {
//    values: number[]
//}