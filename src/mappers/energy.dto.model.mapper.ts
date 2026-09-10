import type {
    EnergyCommunityDTO,
    BuildingDTO,
    BuildingItemDTO,
    ObservationDTO,
    GridDTO,
    BatteryDTO,
    ElectricVehicleDTO,
    ChargerDTO,
} from "../dto/energy.dto";

import type {
    EnergyCommunity,
    Building,
    BuildingItems,
    Observation,
    Grid,
    Battery,
    ElectricVehicle,
    Charger,
} from "../models/energy.model";

// ============================================================
// EnergyCommunityDTO -> EnergyCommunity
// ============================================================

export function mapEnergyCommunity(
    dto: EnergyCommunityDTO
): EnergyCommunity {
    return {
        id: dto.energy_community,

        collections: Object.entries(
            dto.collections ?? {}
        ).map(([id, building]) =>
            mapBuilding(id, building)
        ),
    };
}

// ============================================================
// BuildingDTO -> Building
// ============================================================

function mapBuilding(
    id: string,
    dto: BuildingDTO
): Building {
    return {
        id,

        items: (dto.items ?? []).map(
            mapBuildingItem
        ),
    };
}

// ============================================================
// BuildingItemDTO -> BuildingItems
// ============================================================

function mapBuildingItem(
    dto: BuildingItemDTO
): BuildingItems {
    return {
        id: dto._id,

        timestamp: new Date(dto.timestamp),

        community_snapshot: {
            energy_in_total: 0,
            energy_out_total: 0,
        },

        observations: mapObservation(
            dto.observations
        ),
    };
}

// ============================================================
// ObservationDTO -> Observation
// ============================================================

function mapObservation(
    dto: ObservationDTO
): Observation {
    return {
        batteries: mapBatteries(
            dto.batteries
        ),

        grid_meters: mapGrids(
            dto.grid_meters
        ),

        solar_generation:
            dto.solar_generation ?? 0,

        energy_price:
            dto.energy_price ?? 0,

        charging_session:
            mapChargingSessions(
                dto.charging_session
            ),

        electric_vehicles:
            mapElectricVehicles(
                dto.electric_vehicles
            ),

        pv_panels: [],

        non_shiftable_load:
            dto.non_shiftable_load ?? 0,
    };
}

// ============================================================
// Chargers
// ============================================================

function mapChargingSessions(
    chargers:
        | Record<string, ChargerDTO>
        | null
        | undefined
): Charger[] {
    if (!chargers) {
        return [];
    }

    return Object.entries(chargers).map(
        ([id, charger]) => ({
            id,
            power: charger.power,
            electric_vehicle:
                charger.electric_vehicle,
        })
    );
}

// ============================================================
// Batteries
// ============================================================

function mapBatteries(
    batteries:
        | Record<string, BatteryDTO>
        | null
        | undefined
): Battery[] {
    if (!batteries) {
        return [];
    }

    return Object.entries(batteries).map(
        ([id, battery]) => ({
            id,
            energyIn:
                battery.energy_in ?? 0,
            energyOut:
                battery.energy_out ?? 0,
            soc:
                battery.SoC ?? 0,
        })
    );
}

// ============================================================
// Grid Meters
// ============================================================

function mapGrids(
    grids:
        | Record<string, GridDTO>
        | null
        | undefined
): Grid[] {
    if (!grids) {
        return [];
    }

    return Object.entries(grids).map(
        ([id, grid]) => ({
            id,

            energyIn:
                grid.energy_in_total ?? 0,

            energyOut:
                grid.energy_out_total ?? 0,
        })
    );
}

// ============================================================
// Electric Vehicles
// ============================================================

function mapElectricVehicles(
    vehicles:
        | Record<string, ElectricVehicleDTO>
        | null
        | undefined
): ElectricVehicle[] {
    if (!vehicles) {
        return [];
    }

    return Object.entries(vehicles).map(
        ([id, ev]) => ({
            id,

            SoC:
                ev.SoC ?? null,

            estimated_soc_at_arrival:
                ev.flexibility
                    ?.estimated_soc_at_arrival ??
                null,

            estimated_soc_at_departure:
                ev.flexibility
                    ?.estimated_soc_at_departure ??
                null,

            estimated_time_at_arrival:
                ev.flexibility
                    ?.estimated_time_at_arrival ||
                "",

            estimated_time_at_departure:
                ev.flexibility
                    ?.estimated_time_at_departure ||
                "",

            charger:
                ev.flexibility?.charger ||
                "",

            mode:
                ev.flexibility?.mode ||
                "",
        })
    );
}
