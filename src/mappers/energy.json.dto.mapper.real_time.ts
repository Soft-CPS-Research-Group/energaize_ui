import type { EnergyCommunityDTO, BuildingDTO } from "../dto/energy.dto";

export function mapRealTimeToEnergyCommunityDTO(raw: any, exchangeName: string): EnergyCommunityDTO {
    const obs = raw.observations ?? {};

    const item = {
        _id: raw.timestamp,
        timestamp: raw.timestamp,
        observations: {
            batteries: obs.batteries ?? {},
            grid_meters: obs.grid_meters ?? {},
            solar_generation: obs.solar_generation ?? 0,
            energy_price: obs.energy_tariffs?.OMIE?.energy_price?.values?.[0] ?? 0,
            charging_session: obs.charging_sessions ?? {},
            electric_vehicles: obs.electric_vehicles ?? {},
            non_shiftable_load: obs.non_shiftable_load ?? 0,
        }
    };

    return {
        energy_community: exchangeName,
        collections: {
            [exchangeName]: {
                items: [item]
            } as BuildingDTO
        }
    };
}