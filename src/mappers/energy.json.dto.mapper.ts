import type { EnergyCommunityDTO, BuildingDTO } from "../dto/energy.dto";

export function mapApiToEnergyCommunityDTO(apiResponse: any): EnergyCommunityDTO {
    return {
        energy_community: apiResponse.energy_community,
        collections: Object.entries(apiResponse.collections || {}).reduce((acc, [id, data]) => {
            const buildingData = data as any;
            acc[id] = {
                items: (buildingData.items || []).map((item: any) => ({
                    _id: item._id,
                    timestamp: item.timestamp,
                    observations: {
                        batteries: item.observations?.batteries || {},
                        grid_meters: item.observations?.grid_meters || {},
                        solar_generation: item.observations?.solar_generation || 0,
                        energy_price: item.observations?.energy_tariffs?.OMIE?.energy_price?.values?.[0] || 0,
                        charging_session: item.observations?.charging_sessions || {},
                        electric_vehicles: item.observations?.electric_vehicles || {},
                        non_shiftable_load: item.observations?.non_shiftable_load || 0
                    }
                }))
            };
            return acc;
        }, {} as Record<string, BuildingDTO>)
    };
}