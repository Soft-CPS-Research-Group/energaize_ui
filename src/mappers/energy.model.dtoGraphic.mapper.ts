import type {
    EnergyCommunity,
    BuildingItems,
} from "../models/energy.model.ts";
import type {
    BatteryDataDTO,
    ElectricVehicleDataDTO,
    ChargerDataDTO,
    ConsumptionProductionDTO,
    PricingDTO
} from "../dto/energy.graphics.dto.ts";

interface Cache<T> {
    lastLength: number;
    cached: T[];
}

// ============================================================
// CONSUMPTION + PRODUCTION
// ============================================================

// Versão simples — para datasets ad-hoc/pequenos (sem cache). Um único
// edifício tem os seus items() naturalmente cronológicos (append-only),
// por isso não precisa de sort().
export function mapConsumptionProductionToDTO(community: EnergyCommunity): ConsumptionProductionDTO[] {
    const data: ConsumptionProductionDTO[] = [];
    community.collections.forEach(building => {
        building.items.forEach((item: BuildingItems) => {
            if (!item.observations) return;
            data.push(mapConsumptionProductionItem(item));
        });
    });
    return data;
}

function mapConsumptionProductionItem(item: BuildingItems): ConsumptionProductionDTO {
    const obs = item.observations;
    const netConsumption = (obs?.grid_meters || []).reduce(
        (total, meter) => total + ((meter.energyIn ?? 0) - (meter.energyOut ?? 0)),
        0
    );
    return {
        timestamp: item.timestamp.toISOString().replace('T', ' ').split('.')[0],
        "Non-shiftable Load-kWh": obs?.non_shiftable_load ?? 0,
        "Net Electricity Consumption-kWh": netConsumption,
        "Energy Production from PV-kWh": obs?.solar_generation ?? 0
    };
}

// Versão incremental — comunidade inteira, merge k-way entre edifícios.
export function createIncrementalConsumptionProductionMapper() {
    const state = new Map<string, Cache<ConsumptionProductionDTO>>();

    return function mapIncremental(community: EnergyCommunity | null): ConsumptionProductionDTO[] {
        if (!community) return [];

        const activeIds = new Set(community.collections.map(b => b.id));
        for (const key of state.keys()) {
            if (!activeIds.has(key)) state.delete(key);
        }

        community.collections.forEach(building => {
            const items = building.items || [];
            let entry = state.get(building.id);

            if (!entry || items.length < entry.lastLength) {
                entry = { lastLength: 0, cached: [] };
                state.set(building.id, entry);
            }

            if (items.length > entry.lastLength) {
                for (let i = entry.lastLength; i < items.length; i++) {
                    const item = items[i];
                    if (!item.observations) continue;
                    entry.cached.push(mapConsumptionProductionItem(item));
                }
                entry.lastLength = items.length;
            }
        });

        const arrays = Array.from(state.values()).map(e => e.cached);
        return mergeSortedArraysByTimestamp(arrays);
    };
}

// Versão incremental — UM único edifício (usada em buildingData no GraphicsView,
// quando um edifício é selecionado diretamente como "equipamento").
// Não precisa de merge k-way (só há um edifício), apenas append.
export function createIncrementalSingleBuildingConsumptionProductionMapper() {
    const state = new Map<string, Cache<ConsumptionProductionDTO>>(); // key = buildingId

    return function mapIncremental(community: EnergyCommunity | null, buildingId: string): ConsumptionProductionDTO[] {
        if (!community) return [];
        const building = community.collections.find(b => b.id === buildingId);
        if (!building) {
            state.delete(buildingId);
            return [];
        }

        const items = building.items || [];
        let entry = state.get(buildingId);

        if (!entry || items.length < entry.lastLength) {
            entry = { lastLength: 0, cached: [] };
            state.set(buildingId, entry);
        }

        if (items.length > entry.lastLength) {
            for (let i = entry.lastLength; i < items.length; i++) {
                const item = items[i];
                if (!item.observations) continue;
                entry.cached.push(mapConsumptionProductionItem(item));
            }
            entry.lastLength = items.length;
        }

        return entry.cached;
    };
}

// ============================================================
// BATTERIES
// ============================================================

function mapBatteryItem(item: BuildingItems, batteryId: string): BatteryDataDTO | null {
    const obs = item.observations;
    if (!obs) return null;
    const battery = (obs.batteries || []).find(b => b.id === batteryId);
    if (!battery) return null;
    return {
        timestamp: item.timestamp.toISOString().replace('T', ' ').split('.')[0],
        "Battery Soc-%": battery.soc * 100,
        "Battery (Dis)Charge-kWh": (battery.energyIn ?? 0) - (battery.energyOut ?? 0)
    };
}

// Versão simples (sem cache) — mantida para compatibilidade/uso ad-hoc.
export function mapBatteryDataToBatteryDTOMap(
    community: EnergyCommunity | null,
    buildingId: string,
    batteryId: string
): BatteryDataDTO[] {
    if (!community) return [];
    const building = community.collections.find(b => b.id === buildingId);
    if (!building) return [];

    const data: BatteryDataDTO[] = [];
    for (const item of building.items || []) {
        const dto = mapBatteryItem(item, batteryId);
        if (dto) data.push(dto);
    }
    return data;
}

// Versão incremental — só processa os items novos desde a última chamada,
// por bateria/edifício. items() é append-only e cronológico, por isso o
// array cache mantém-se sempre ordenado sem precisar de sort().
export function createIncrementalBatteryMapper() {
    const state = new Map<string, Cache<BatteryDataDTO>>(); // key = buildingId:batteryId

    return function mapIncremental(
        community: EnergyCommunity | null,
        buildingId: string,
        batteryId: string
    ): BatteryDataDTO[] {
        if (!community) return [];
        const key = `${buildingId}:${batteryId}`;
        const building = community.collections.find(b => b.id === buildingId);
        if (!building) {
            state.delete(key);
            return [];
        }

        const items = building.items || [];
        let entry = state.get(key);

        if (!entry || items.length < entry.lastLength) {
            entry = { lastLength: 0, cached: [] };
            state.set(key, entry);
        }

        if (items.length > entry.lastLength) {
            for (let i = entry.lastLength; i < items.length; i++) {
                const dto = mapBatteryItem(items[i], batteryId);
                if (dto) entry.cached.push(dto);
            }
            entry.lastLength = items.length;
        }

        return entry.cached;
    };
}

// ============================================================
// ELECTRIC VEHICLES
// ============================================================

function mapEVItem(item: BuildingItems, evId: string): ElectricVehicleDataDTO | null {
    const obs = item.observations;
    if (!obs) return null;
    const ev = (obs.electric_vehicles || []).find(v => v.id === evId);
    if (!ev) return null;
    return {
        timestamp: item.timestamp.toISOString(),
        'EV SOC-%': ev.SoC != null ? ev.SoC * 100 : 0,
        'EV Estimated SOC Arrival-%': ev.estimated_soc_at_arrival != null
            ? ev.estimated_soc_at_arrival * 100
            : null,
        'EV Required SOC Departure-%': ev.estimated_soc_at_departure != null
            ? ev.estimated_soc_at_departure * 100
            : null,
        'EV Departure Time': ev.estimated_time_at_departure || undefined,
        'EV Arrival Time': ev.estimated_time_at_arrival || undefined
    };
}

export function mapEVDataToEVDTOMap(
    community: EnergyCommunity,
    buildingId: string,
    evId: string
): ElectricVehicleDataDTO[] {
    const building = community.collections.find(b => b.id === buildingId);
    if (!building) return [];

    const data: ElectricVehicleDataDTO[] = [];
    for (const item of building.items || []) {
        const dto = mapEVItem(item, evId);
        if (dto) data.push(dto);
    }
    return data;
}

export function createIncrementalEVMapper() {
    const state = new Map<string, Cache<ElectricVehicleDataDTO>>(); // key = buildingId:evId

    return function mapIncremental(
        community: EnergyCommunity | null,
        buildingId: string,
        evId: string
    ): ElectricVehicleDataDTO[] {
        if (!community) return [];
        const key = `${buildingId}:${evId}`;
        const building = community.collections.find(b => b.id === buildingId);
        if (!building) {
            state.delete(key);
            return [];
        }

        const items = building.items || [];
        let entry = state.get(key);

        if (!entry || items.length < entry.lastLength) {
            entry = { lastLength: 0, cached: [] };
            state.set(key, entry);
        }

        if (items.length > entry.lastLength) {
            for (let i = entry.lastLength; i < items.length; i++) {
                const dto = mapEVItem(items[i], evId);
                if (dto) entry.cached.push(dto);
            }
            entry.lastLength = items.length;
        }

        return entry.cached;
    };
}

// ============================================================
// CHARGERS
// ============================================================

function mapChargerItem(item: BuildingItems, chargerId: string): ChargerDataDTO | null {
    const obs = item.observations;
    if (!obs) return null;
    const charger = (obs.charging_session || []).find(c => c.id === chargerId);
    if (!charger) return null;
    return {
        timestamp: item.timestamp.toISOString(),
        Power: charger.power ?? 0,
        electric_vehicle: charger.electric_vehicle ?? ""
    };
}

export function mapChargerDataToChargerDTOMap(
    community: EnergyCommunity | null,
    buildingId: string,
    chargerId: string
): ChargerDataDTO[] {
    if (!community) return [];
    const building = community.collections.find(b => b.id === buildingId);
    if (!building) return [];

    const data: ChargerDataDTO[] = [];
    for (const item of building.items || []) {
        const dto = mapChargerItem(item, chargerId);
        if (dto) data.push(dto);
    }
    return data;
}

export function createIncrementalChargerMapper() {
    const state = new Map<string, Cache<ChargerDataDTO>>(); // key = buildingId:chargerId

    return function mapIncremental(
        community: EnergyCommunity | null,
        buildingId: string,
        chargerId: string
    ): ChargerDataDTO[] {
        if (!community) return [];
        const key = `${buildingId}:${chargerId}`;
        const building = community.collections.find(b => b.id === buildingId);
        if (!building) {
            state.delete(key);
            return [];
        }

        const items = building.items || [];
        let entry = state.get(key);

        if (!entry || items.length < entry.lastLength) {
            entry = { lastLength: 0, cached: [] };
            state.set(key, entry);
        }

        if (items.length > entry.lastLength) {
            for (let i = entry.lastLength; i < items.length; i++) {
                const dto = mapChargerItem(items[i], chargerId);
                if (dto) entry.cached.push(dto);
            }
            entry.lastLength = items.length;
        }

        return entry.cached;
    };
}

// ============================================================
// PRICING
// ============================================================

function mapPricingItem(item: BuildingItems): PricingDTO {
    const obs = item.observations;
    return {
        timestamp: item.timestamp.toISOString().replace('T', ' ').split('.')[0],
        'electricity_pricing-$/kWh': obs?.energy_price ?? 0
    };
}

export function mapPricingDataToPricingDTO(community: EnergyCommunity): PricingDTO[] {
    const data: PricingDTO[] = [];
    for (const building of community.collections || []) {
        for (const item of building.items || []) {
            if (!item.observations) continue;
            data.push(mapPricingItem(item));
        }
    }
    return data.sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
}

export function createIncrementalPricingMapper() {
    const state = new Map<string, Cache<PricingDTO>>();

    return function mapIncremental(community: EnergyCommunity | null): PricingDTO[] {
        if (!community) return [];

        const activeIds = new Set(community.collections.map(b => b.id));
        for (const key of state.keys()) {
            if (!activeIds.has(key)) state.delete(key);
        }

        community.collections.forEach(building => {
            const items = building.items || [];
            let entry = state.get(building.id);

            if (!entry || items.length < entry.lastLength) {
                entry = { lastLength: 0, cached: [] };
                state.set(building.id, entry);
            }

            if (items.length > entry.lastLength) {
                for (let i = entry.lastLength; i < items.length; i++) {
                    const item = items[i];
                    if (!item.observations) continue;
                    entry.cached.push(mapPricingItem(item));
                }
                entry.lastLength = items.length;
            }
        });

        const arrays = Array.from(state.values()).map(e => e.cached);
        return mergeSortedArraysByTimestamp(arrays);
    };
}

export function createIncrementalSingleBuildingPricingMapper() {
    const state = new Map<string, Cache<PricingDTO>>(); // key = buildingId

    return function mapIncremental(community: EnergyCommunity | null, buildingId: string): PricingDTO[] {
        if (!community) return [];
        const building = community.collections.find(b => b.id === buildingId);
        if (!building) {
            state.delete(buildingId);
            return [];
        }

        const items = building.items || [];
        let entry = state.get(buildingId);

        if (!entry || items.length < entry.lastLength) {
            entry = { lastLength: 0, cached: [] };
            state.set(buildingId, entry);
        }

        if (items.length > entry.lastLength) {
            for (let i = entry.lastLength; i < items.length; i++) {
                const item = items[i];
                if (!item.observations) continue;
                entry.cached.push(mapPricingItem(item));
            }
            entry.lastLength = items.length;
        }

        return entry.cached;
    };
}

// ============================================================
// UTIL
// ============================================================

// Merge k-way entre N arrays já ordenados por timestamp — O(n·k), sem sort()
// sobre o total. Usa push() de um elemento de cada vez (nunca spread/apply,
// que rebentam com "Maximum call stack size exceeded" em arrays grandes).
function mergeSortedArraysByTimestamp<T extends { timestamp: string }>(arrays: T[][]): T[] {
    const indices = new Array(arrays.length).fill(0);
    const result: T[] = [];
    const total = arrays.reduce((sum, a) => sum + a.length, 0);

    for (let count = 0; count < total; count++) {
        let bestArr = -1;
        let bestTime = Infinity;
        for (let a = 0; a < arrays.length; a++) {
            const idx = indices[a];
            if (idx < arrays[a].length) {
                const t = new Date(arrays[a][idx].timestamp).getTime();
                if (t < bestTime) {
                    bestTime = t;
                    bestArr = a;
                }
            }
        }
        if (bestArr === -1) break;
        result.push(arrays[bestArr][indices[bestArr]]);
        indices[bestArr]++;
    }

    return result;
}