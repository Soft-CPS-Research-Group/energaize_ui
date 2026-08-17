import type {
    EnergyCommunity,
    BuildingItems,
} from "../models/energy.model.ts";

import type {
    BatteryDataDTO,
    ElectricVehicleDataDTO,
    ChargerDataDTO,
    ConsumptionProductionDTO,
    PricingDTO,
} from "../dto/energy.graphics.dto.ts";

// ============================================================
// CACHE
// ============================================================

interface Cache<T> {
    lastLength: number;
    cached: T[];
}


interface SortedCache<T> extends Cache<T> {
    timestamps: number[];
}

// ============================================================
// CONSUMPTION + PRODUCTION
// ============================================================

export function mapConsumptionProductionToDTO(
    community: EnergyCommunity
): ConsumptionProductionDTO[] {
    const data: ConsumptionProductionDTO[] = [];

    community.collections.forEach((building) => {
        building.items.forEach(
            (item: BuildingItems) => {
                if (!item.observations) return;

                data.push(
                    mapConsumptionProductionItem(
                        item
                    )
                );
            }
        );
    });

    return data;
}

function mapConsumptionProductionItem(
    item: BuildingItems
): ConsumptionProductionDTO {
    const obs = item.observations;

    const netConsumption =
        (obs?.grid_meters || []).reduce(
            (total, meter) =>
                total +
                ((meter.energyIn ?? 0) -
                    (meter.energyOut ?? 0)),
            0
        );

    return {
        timestamp: item.timestamp
            .toISOString()
            .replace("T", " ")
            .split(".")[0],

        "Non-shiftable Load-kWh":
            obs?.non_shiftable_load ?? 0,

        "Net Electricity Consumption-kWh":
        netConsumption,

        "Energy Production from PV-kWh":
            obs?.solar_generation ?? 0,
    };
}

// ============================================================
// INCREMENTAL CONSUMPTION + PRODUCTION
// ============================================================

export function createIncrementalConsumptionProductionMapper() {
    const state = new Map<
        string,
        SortedCache<ConsumptionProductionDTO>
    >();

    return function mapIncremental(
        community: EnergyCommunity | null
    ): ConsumptionProductionDTO[] {
        if (!community) {
            state.clear();
            return [];
        }

        /*
         * Remove buildings que já não existem.
         */
        const activeIds = new Set(
            community.collections.map(
                (building) => building.id
            )
        );

        for (const key of state.keys()) {
            if (!activeIds.has(key)) {
                state.delete(key);
            }
        }

        /*
         * Processa apenas os items novos.
         */
        community.collections.forEach(
            (building) => {
                const items =
                    building.items || [];

                let entry =
                    state.get(building.id);

                /*
                 * Primeiro carregamento ou reset.
                 */
                if (
                    !entry ||
                    items.length <
                    entry.lastLength
                ) {
                    entry = {
                        lastLength: 0,
                        cached: [],
                        timestamps: [],
                    };

                    state.set(
                        building.id,
                        entry
                    );
                }

                /*
                 * Apenas items novos são convertidos.
                 */
                if (
                    items.length >
                    entry.lastLength
                ) {
                    for (
                        let i =
                            entry.lastLength;
                        i < items.length;
                        i++
                    ) {
                        const item =
                            items[i];

                        if (
                            !item.observations
                        ) {
                            continue;
                        }

                        const dto =
                            mapConsumptionProductionItem(
                                item
                            );

                        entry.cached.push(dto);

                        /*
                         * Guardamos o timestamp
                         * numérico uma única vez.
                         */
                        entry.timestamps.push(
                            item.timestamp.getTime()
                        );
                    }

                    entry.lastLength =
                        items.length;
                }
            }
        );

        /*
         * Merge otimizado dos buildings.
         */
        return mergeSortedCaches(
            Array.from(
                state.values()
            )
        );
    };
}

// ============================================================
// SINGLE BUILDING - CONSUMPTION + PRODUCTION
// ============================================================

export function createIncrementalSingleBuildingConsumptionProductionMapper() {
    const state = new Map<
        string,
        SortedCache<ConsumptionProductionDTO>
    >();

    return function mapIncremental(
        community: EnergyCommunity | null,
        buildingId: string
    ): ConsumptionProductionDTO[] {
        if (!community) {
            state.delete(buildingId);
            return [];
        }

        const building =
            community.collections.find(
                (b) =>
                    b.id === buildingId
            );

        if (!building) {
            state.delete(buildingId);
            return [];
        }

        const items =
            building.items || [];

        let entry =
            state.get(buildingId);

        if (
            !entry ||
            items.length <
            entry.lastLength
        ) {
            entry = {
                lastLength: 0,
                cached: [],
                timestamps: [],
            };

            state.set(
                buildingId,
                entry
            );
        }

        if (
            items.length >
            entry.lastLength
        ) {
            for (
                let i =
                    entry.lastLength;
                i < items.length;
                i++
            ) {
                const item =
                    items[i];

                if (!item.observations) {
                    continue;
                }

                const dto =
                    mapConsumptionProductionItem(
                        item
                    );

                entry.cached.push(dto);

                entry.timestamps.push(
                    item.timestamp.getTime()
                );
            }

            entry.lastLength =
                items.length;
        }

        /*
         * Apenas um building:
         * não precisamos de merge nenhum.
         */
        return entry.cached;
    };
}

// ============================================================
// BATTERIES
// ============================================================

function mapBatteryItem(
    item: BuildingItems,
    batteryId: string
): BatteryDataDTO | null {
    const obs = item.observations;

    if (!obs) return null;

    const battery =
        (obs.batteries || []).find(
            (battery) =>
                battery.id === batteryId
        );

    if (!battery) return null;

    return {
        timestamp: item.timestamp
            .toISOString()
            .replace("T", " ")
            .split(".")[0],

        "Battery Soc-%":
            battery.soc * 100,

        "Battery (Dis)Charge-kWh":
            (battery.energyIn ?? 0) -
            (battery.energyOut ?? 0),
    };
}

// ============================================================
// BATTERIES - SIMPLE
// ============================================================

export function mapBatteryDataToBatteryDTOMap(
    community: EnergyCommunity | null,
    buildingId: string,
    batteryId: string
): BatteryDataDTO[] {
    if (!community) return [];

    const building =
        community.collections.find(
            (b) =>
                b.id === buildingId
        );

    if (!building) return [];

    const data: BatteryDataDTO[] = [];

    for (
        const item of
    building.items || []
        ) {
        const dto =
            mapBatteryItem(
                item,
                batteryId
            );

        if (dto) {
            data.push(dto);
        }
    }

    return data;
}

// ============================================================
// BATTERIES - INCREMENTAL
// ============================================================

export function createIncrementalBatteryMapper() {
    const state = new Map<
        string,
        Cache<BatteryDataDTO>
    >();

    return function mapIncremental(
        community: EnergyCommunity | null,
        buildingId: string,
        batteryId: string
    ): BatteryDataDTO[] {
        if (!community) {
            state.delete(
                `${buildingId}:${batteryId}`
            );

            return [];
        }

        const key =
            `${buildingId}:${batteryId}`;

        const building =
            community.collections.find(
                (b) =>
                    b.id === buildingId
            );

        if (!building) {
            state.delete(key);
            return [];
        }

        const items =
            building.items || [];

        let entry =
            state.get(key);

        if (
            !entry ||
            items.length <
            entry.lastLength
        ) {
            entry = {
                lastLength: 0,
                cached: [],
            };

            state.set(key, entry);
        }

        if (
            items.length >
            entry.lastLength
        ) {
            for (
                let i =
                    entry.lastLength;
                i < items.length;
                i++
            ) {
                const dto =
                    mapBatteryItem(
                        items[i],
                        batteryId
                    );

                if (dto) {
                    entry.cached.push(
                        dto
                    );
                }
            }

            entry.lastLength =
                items.length;
        }

        return entry.cached;
    };
}

// ============================================================
// ELECTRIC VEHICLES
// ============================================================

function mapEVItem(
    item: BuildingItems,
    evId: string
): ElectricVehicleDataDTO | null {
    const obs = item.observations;

    if (!obs) return null;

    const ev =
        (obs.electric_vehicles || [])
            .find(
                (vehicle) =>
                    vehicle.id === evId
            );

    if (!ev) return null;

    return {
        timestamp:
            item.timestamp.toISOString(),

        "EV SOC-%":
            ev.SoC != null
                ? ev.SoC * 100
                : 0,

        "EV Estimated SOC Arrival-%":
            ev.estimated_soc_at_arrival != null
                ? ev.estimated_soc_at_arrival *
                100
                : null,

        "EV Required SOC Departure-%":
            ev.estimated_soc_at_departure != null
                ? ev.estimated_soc_at_departure *
                100
                : null,

        "EV Departure Time":
            ev.estimated_time_at_departure ||
            undefined,

        "EV Arrival Time":
            ev.estimated_time_at_arrival ||
            undefined,
    };
}

// ============================================================
// ELECTRIC VEHICLES - SIMPLE
// ============================================================

export function mapEVDataToEVDTOMap(
    community: EnergyCommunity,
    buildingId: string,
    evId: string
): ElectricVehicleDataDTO[] {
    const building =
        community.collections.find(
            (b) =>
                b.id === buildingId
        );

    if (!building) return [];

    const data: ElectricVehicleDataDTO[] = [];

    for (
        const item of
    building.items || []
        ) {
        const dto =
            mapEVItem(
                item,
                evId
            );

        if (dto) {
            data.push(dto);
        }
    }

    return data;
}

// ============================================================
// ELECTRIC VEHICLES - INCREMENTAL
// ============================================================

export function createIncrementalEVMapper() {
    const state = new Map<
        string,
        Cache<ElectricVehicleDataDTO>
    >();

    return function mapIncremental(
        community: EnergyCommunity | null,
        buildingId: string,
        evId: string
    ): ElectricVehicleDataDTO[] {
        if (!community) {
            state.delete(
                `${buildingId}:${evId}`
            );

            return [];
        }

        const key =
            `${buildingId}:${evId}`;

        const building =
            community.collections.find(
                (b) =>
                    b.id === buildingId
            );

        if (!building) {
            state.delete(key);
            return [];
        }

        const items =
            building.items || [];

        let entry =
            state.get(key);

        if (
            !entry ||
            items.length <
            entry.lastLength
        ) {
            entry = {
                lastLength: 0,
                cached: [],
            };

            state.set(key, entry);
        }

        if (
            items.length >
            entry.lastLength
        ) {
            for (
                let i =
                    entry.lastLength;
                i < items.length;
                i++
            ) {
                const dto =
                    mapEVItem(
                        items[i],
                        evId
                    );

                if (dto) {
                    entry.cached.push(
                        dto
                    );
                }
            }

            entry.lastLength =
                items.length;
        }

        return entry.cached;
    };
}

// ============================================================
// CHARGERS
// ============================================================

function mapChargerItem(
    item: BuildingItems,
    chargerId: string
): ChargerDataDTO | null {
    const obs = item.observations;

    if (!obs) return null;

    const charger =
        (obs.charging_session || [])
            .find(
                (chargingSession) =>
                    chargingSession.id ===
                    chargerId
            );

    if (!charger) return null;

    return {
        timestamp:
            item.timestamp.toISOString(),

        Power:
            charger.power ?? 0,

        electric_vehicle:
            charger.electric_vehicle ??
            "",
    };
}

// ============================================================
// CHARGERS - SIMPLE
// ============================================================

export function mapChargerDataToChargerDTOMap(
    community: EnergyCommunity | null,
    buildingId: string,
    chargerId: string
): ChargerDataDTO[] {
    if (!community) return [];

    const building =
        community.collections.find(
            (b) =>
                b.id === buildingId
        );

    if (!building) return [];

    const data: ChargerDataDTO[] = [];

    for (
        const item of
    building.items || []
        ) {
        const dto =
            mapChargerItem(
                item,
                chargerId
            );

        if (dto) {
            data.push(dto);
        }
    }

    return data;
}

// ============================================================
// CHARGERS - INCREMENTAL
// ============================================================

export function createIncrementalChargerMapper() {
    const state = new Map<
        string,
        Cache<ChargerDataDTO>
    >();

    return function mapIncremental(
        community: EnergyCommunity | null,
        buildingId: string,
        chargerId: string
    ): ChargerDataDTO[] {
        if (!community) {
            state.delete(
                `${buildingId}:${chargerId}`
            );

            return [];
        }

        const key =
            `${buildingId}:${chargerId}`;

        const building =
            community.collections.find(
                (b) =>
                    b.id === buildingId
            );

        if (!building) {
            state.delete(key);
            return [];
        }

        const items =
            building.items || [];

        let entry =
            state.get(key);

        if (
            !entry ||
            items.length <
            entry.lastLength
        ) {
            entry = {
                lastLength: 0,
                cached: [],
            };

            state.set(key, entry);
        }

        if (
            items.length >
            entry.lastLength
        ) {
            for (
                let i =
                    entry.lastLength;
                i < items.length;
                i++
            ) {
                const dto =
                    mapChargerItem(
                        items[i],
                        chargerId
                    );

                if (dto) {
                    entry.cached.push(
                        dto
                    );
                }
            }

            entry.lastLength =
                items.length;
        }

        return entry.cached;
    };
}

// ============================================================
// PRICING
// ============================================================

function mapPricingItem(
    item: BuildingItems
): PricingDTO {
    const obs = item.observations;

    return {
        timestamp: item.timestamp
            .toISOString()
            .replace("T", " ")
            .split(".")[0],

        "electricity_pricing-$/kWh":
            obs?.energy_price ?? 0,
    };
}

// ============================================================
// PRICING - SIMPLE
// ============================================================

export function mapPricingDataToPricingDTO(
    community: EnergyCommunity
): PricingDTO[] {
    const data: PricingDTO[] = [];

    for (
        const building of
    community.collections || []
        ) {
        for (
            const item of
        building.items || []
            ) {
            if (!item.observations) {
                continue;
            }

            data.push(
                mapPricingItem(item)
            );
        }
    }

    return data.sort(
        (a, b) =>
            new Date(
                a.timestamp
            ).getTime() -
            new Date(
                b.timestamp
            ).getTime()
    );
}

// ============================================================
// PRICING - INCREMENTAL
// ============================================================

export function createIncrementalPricingMapper() {
    const state = new Map<
        string,
        SortedCache<PricingDTO>
    >();

    return function mapIncremental(
        community: EnergyCommunity | null
    ): PricingDTO[] {
        if (!community) {
            state.clear();
            return [];
        }

        /*
         * Remove buildings antigos.
         */
        const activeIds = new Set(
            community.collections.map(
                (building) => building.id
            )
        );

        for (const key of state.keys()) {
            if (!activeIds.has(key)) {
                state.delete(key);
            }
        }

        /*
         * Processa apenas os novos items.
         */
        community.collections.forEach(
            (building) => {
                const items =
                    building.items || [];

                let entry =
                    state.get(building.id);

                if (
                    !entry ||
                    items.length <
                    entry.lastLength
                ) {
                    entry = {
                        lastLength: 0,
                        cached: [],
                        timestamps: [],
                    };

                    state.set(
                        building.id,
                        entry
                    );
                }

                if (
                    items.length >
                    entry.lastLength
                ) {
                    for (
                        let i =
                            entry.lastLength;
                        i < items.length;
                        i++
                    ) {
                        const item =
                            items[i];

                        if (
                            !item.observations
                        ) {
                            continue;
                        }

                        const dto =
                            mapPricingItem(
                                item
                            );

                        entry.cached.push(
                            dto
                        );

                        entry.timestamps.push(
                            item.timestamp.getTime()
                        );
                    }

                    entry.lastLength =
                        items.length;
                }
            }
        );

        return mergeSortedCaches(
            Array.from(
                state.values()
            )
        );
    };
}

// ============================================================
// SINGLE BUILDING - PRICING
// ============================================================

export function createIncrementalSingleBuildingPricingMapper() {
    const state = new Map<
        string,
        SortedCache<PricingDTO>
    >();

    return function mapIncremental(
        community: EnergyCommunity | null,
        buildingId: string
    ): PricingDTO[] {
        if (!community) {
            state.delete(buildingId);
            return [];
        }

        const building =
            community.collections.find(
                (b) =>
                    b.id === buildingId
            );

        if (!building) {
            state.delete(buildingId);
            return [];
        }

        const items =
            building.items || [];

        let entry =
            state.get(buildingId);

        if (
            !entry ||
            items.length <
            entry.lastLength
        ) {
            entry = {
                lastLength: 0,
                cached: [],
                timestamps: [],
            };

            state.set(
                buildingId,
                entry
            );
        }

        if (
            items.length >
            entry.lastLength
        ) {
            for (
                let i =
                    entry.lastLength;
                i < items.length;
                i++
            ) {
                const item =
                    items[i];

                if (!item.observations) {
                    continue;
                }

                const dto =
                    mapPricingItem(
                        item
                    );

                entry.cached.push(dto);

                entry.timestamps.push(
                    item.timestamp.getTime()
                );
            }

            entry.lastLength =
                items.length;
        }

        /*
         * Um único building já está
         * cronologicamente ordenado.
         */
        return entry.cached;
    };
}

// ============================================================
// OPTIMIZED MERGE
// ============================================================

function mergeSortedCaches<
    T
>(
    caches: SortedCache<T>[]
): T[] {

    const activeCaches =
        caches.filter(
            (cache) =>
                cache.cached.length > 0
        );

    if (activeCaches.length === 0) {
        return [];
    }


    if (activeCaches.length === 1) {
        return activeCaches[0].cached;
    }


    const indices =
        new Array(
            activeCaches.length
        ).fill(0);

    const total =
        activeCaches.reduce(
            (sum, cache) =>
                sum + cache.cached.length,
            0
        );


    const result =
        new Array<T>(total);


    for (
        let resultIndex = 0;
        resultIndex < total;
        resultIndex++
    ) {
        let bestCache = -1;
        let bestTimestamp =
            Infinity;

        for (
            let cacheIndex = 0;
            cacheIndex <
            activeCaches.length;
            cacheIndex++
        ) {
            const index =
                indices[cacheIndex];

            const cache =
                activeCaches[
                    cacheIndex
                    ];

            if (
                index >=
                cache.cached.length
            ) {
                continue;
            }

            const timestamp =
                cache.timestamps[index];

            if (
                timestamp <
                bestTimestamp
            ) {
                bestTimestamp =
                    timestamp;

                bestCache =
                    cacheIndex;
            }
        }

        if (bestCache === -1) {
            break;
        }

        const index =
            indices[bestCache];

        result[resultIndex] =
            activeCaches[
                bestCache
                ].cached[index];

        indices[bestCache]++;
    }

    return result;
}