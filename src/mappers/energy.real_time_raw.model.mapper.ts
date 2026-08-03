import type {
    EnergyCommunity,
    BuildingItems,
    Observation,
    Battery,
    Grid,
    Charger,
    ElectricVehicle,
    Pv_panel,
    CommunitySnapshot,
} from "../models/energy.model.ts";


export function mapRealTimeToEnergyCommunity(raw: any, exchangeName: string): EnergyCommunity {
    return {
        id: "Global_Community",
        collections: [
            {
                id: exchangeName,
                items: [mapBuildingItem(raw)]
            }
        ]
    };
}

function mapBuildingItem(item: any): BuildingItems {
    const obs = item.observations ?? {};
    return {
        id: item.timestamp,
        timestamp: new Date(item.timestamp),
        community_snapshot: mapCommunitySnapshot(item.community ?? {}),  
        observations: mapObservation(obs),
    };
}

function mapCommunitySnapshot(community: any): CommunitySnapshot {
    return {
        energy_in_total: community.energy_in_total ?? 0,
        energy_out_total: community.energy_out_total ?? 0,
    };
}

function mapObservation(obs: any): Observation {
    return {
        batteries: mapBatteries(obs.batteries ?? {}),
        grid_meters: obs.grid_meters ? mapGrids(obs.grid_meters) : [],
        solar_generation: obs.solar_generation ?? 0,
        energy_price: obs.energy_tariffs?.OMIE?.energy_price?.values?.[0] ?? 0,
        charging_session: mapChargingSessions(obs.charging_sessions ?? {}),
        electric_vehicles: mapElectricVehicles(obs.electric_vehicles ?? {}),
        pv_panels: mapPvPanels(obs.pv_panels ?? {}),  
        non_shiftable_load: obs.non_shiftable_load ?? 0,
    };
}

function mapBatteries(batteries: Record<string, any>): Battery[] {
    return Object.entries(batteries).map(([id, b]) => ({
        id,
        energyIn: b.energy_in ?? 0,
        energyOut: b.energy_out ?? 0,
        soc: b.SoC ?? 0,
    }));
}

function mapGrids(grids: Record<string, any>): Grid[] {
    return Object.entries(grids).map(([id, g]) => ({
        id,
        energyIn: g.energy_in_total ?? 0,
        energyOut: g.energy_out_total ?? 0,
    }));
}

function mapChargingSessions(chargers: Record<string, any>): Charger[] {
    return Object.entries(chargers).map(([id, c]) => ({
        id,
        power: c.power ?? 0,
        electric_vehicle: c.electric_vehicle ?? "",
    }));
}

function mapElectricVehicles(vehicles: Record<string, any>): ElectricVehicle[] {
    return Object.entries(vehicles).map(([id, ev]) => ({
        id,
        SoC: ev.SoC ?? null,
        estimated_soc_at_arrival: ev.flexibility?.estimated_soc_at_arrival ?? null,
        estimated_soc_at_departure: ev.flexibility?.estimated_soc_at_departure ?? null,
        estimated_time_at_arrival: ev.flexibility?.estimated_time_at_arrival ?? "",
        estimated_time_at_departure: ev.flexibility?.estimated_time_at_departure ?? "",
        charger: ev.flexibility?.charger ?? "",
        mode: ev.flexibility?.mode ?? "",
    }));
}

function mapPvPanels(panels: Record<string, any>): Pv_panel[] {
    return Object.entries(panels).map(([id, p]) => ({
        id,
        energy: p.energy ?? 0
    }));
}