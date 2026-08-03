export type EnergyCommunity = {
    id: string
    collections: Building[]
}

export type Building = {
    id: string
    items: BuildingItems[]
}

export type BuildingItems = {
    id: string
    timestamp: Date
    community_snapshot: CommunitySnapshot
    observations: Observation
}

export type CommunitySnapshot = {
    energy_in_total: number
    energy_out_total: number
}

export type Observation = {
    batteries: Battery[]
    grid_meters: Grid[]
    solar_generation: number
    energy_price: number
    charging_session: Charger[]
    electric_vehicles: ElectricVehicle[]
    pv_panels: Pv_panel[]
    non_shiftable_load: number
}

export type Pv_panel = {
    id: string
    energy: number
}

export type Charger = {
    id: string
    power: number | string
    electric_vehicle: string
}

export type Grid = {
    id: string
    energyIn: number
    energyOut: number
}

export type Battery = {
    id: string
    energyIn: number
    energyOut: number
    soc: number
}

export type ElectricVehicle = {
    id: string
    SoC: number
    estimated_soc_at_arrival: number | null,
    estimated_soc_at_departure: number | null,
    estimated_time_at_arrival: string,
    estimated_time_at_departure: string,
    charger: string,
    mode: string
}

/**
 * Retorna os nomes de todos os equipamentos de um edifício específico
 * (Extraído da primeira observação disponível)
 */
export function getBuildingEquipmentNames(building: Building) {
    const firstObs = building.items[0]?.observations;

    if (!firstObs) return { batteries: [], evs: [], chargers: [] };

    return {
        batteries: firstObs.batteries.map(b => b.id),
        evs: firstObs.electric_vehicles.map(ev => ev.id),
        chargers: firstObs.charging_session.map(c => c.id),
    };
}