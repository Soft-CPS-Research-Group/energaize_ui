import { useState, useEffect, useRef, useCallback } from "react";
import { connectRealTimeData } from "../api/communityDataApi";
import { mapRealTimeToEnergyCommunity } from "../mappers/energy.real_time_raw.model.mapper";
import type { EnergyCommunity, BuildingItems } from "../models/energy.model.ts";

const WINDOW_MINUTES = 10;

const LIVE_TIMEOUT_MS = 20000;

const RECONNECT_DELAY_MS = 3000;

const AVAILABLE_HOUSES = [
    {
        label: "building_R-H-01",
        exchange: "percepta_live_data_R-H-01"
    },
    {
        label: "building_R-H-02",
        exchange: "percepta_live_data_R-H-02"
    },
    {
        label: "building_R-H-03",
        exchange: "percepta_live_data_R-H-03"
    },
    {
        label: "building_R-H-04",
        exchange: "percepta_live_data_R-H-04"
    },
    {
        label: "building_SaoMamede",
        exchange: "percepta_live_data_SaoMamede"
    },
    {
        label: "building_i-charging_headquarters_3Phase",
        exchange:
            "percepta_live_data_i-charging headquarters 3Phase"
    }
];

function getHouse(value: string) {
    return AVAILABLE_HOUSES.find(
        house =>
            house.label === value ||
            house.exchange === value
    );
}

export function useRealTimeData(
    exchangeNames: string[],
    isLive: boolean
) {
    const [data, setData] =
        useState<EnergyCommunity | null>(null);

    const [timedOut, setTimedOut] = useState(false);

    const socketsRef =
        useRef<Map<string, WebSocket>>(new Map());

    const reconnectTimersRef =
        useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const timeoutRef =
        useRef<ReturnType<typeof setTimeout> | null>(null);

    const isLiveRef = useRef(isLive);
    const exchangeNamesRef = useRef(exchangeNames);

    useEffect(() => {
        isLiveRef.current = isLive;
        exchangeNamesRef.current = exchangeNames;
    }, [isLive, exchangeNames]);

    const pruneOldItems = useCallback((items: BuildingItems[]) => {
        const cutoff = new Date(
            Date.now() - WINDOW_MINUTES * 60 * 1000
        );

        return items.filter(
            item => item.timestamp >= cutoff
        );
    }, []);

    const clearReconnectTimer = useCallback((exchangeName: string) => {
        const timer = reconnectTimersRef.current.get(exchangeName);

        if (timer) {
            clearTimeout(timer);
            reconnectTimersRef.current.delete(exchangeName);
        }
    }, []);

    const isExchangeStillWanted = useCallback(
        (exchangeName: string) => {
            if (!isLiveRef.current) return false;

            const wanted = exchangeNamesRef.current.map(
                value => getHouse(value)?.exchange || value
            );

            return wanted.includes(exchangeName);
        },
        []
    );

    const connectExchange = useCallback(
        (exchangeName: string, buildingId: string) => {
            clearReconnectTimer(exchangeName);

            const ws = connectRealTimeData(exchangeName, newData => {
                if (timeoutRef.current) {
                    clearTimeout(timeoutRef.current);
                    timeoutRef.current = null;
                }

                const incoming = mapRealTimeToEnergyCommunity(
                    newData,
                    buildingId
                );

                const newBuildingData = incoming.collections[0];

                setData(prev => {
                    if (!prev) {
                        return {
                            id: "Shared_Community",
                            collections: [newBuildingData]
                        };
                    }

                    const buildingIndex =
                        prev.collections.findIndex(
                            building => building.id === buildingId
                        );

                    const updatedCollections = [...prev.collections];

                    if (buildingIndex !== -1) {
                        const existingBuilding =
                            updatedCollections[buildingIndex];

                        updatedCollections[buildingIndex] = {
                            ...existingBuilding,
                            items: pruneOldItems([
                                ...existingBuilding.items,
                                ...newBuildingData.items
                            ])
                        };
                    } else {
                        updatedCollections.push(newBuildingData);
                    }

                    return {
                        ...prev,
                        collections: updatedCollections
                    };
                });
            });

            const handleClosed = () => {
                if (socketsRef.current.get(exchangeName) !== ws) {
                    return;
                }

                socketsRef.current.delete(exchangeName);

                if (!isExchangeStillWanted(exchangeName)) {
                    return;
                }

                clearReconnectTimer(exchangeName);

                const timer = setTimeout(() => {
                    reconnectTimersRef.current.delete(exchangeName);

                    if (!isExchangeStillWanted(exchangeName)) {
                        return;
                    }

                    if (socketsRef.current.has(exchangeName)) {
                        return;
                    }

                    const reconnected = connectExchange(
                        exchangeName,
                        buildingId
                    );

                    socketsRef.current.set(exchangeName, reconnected);
                }, RECONNECT_DELAY_MS);

                reconnectTimersRef.current.set(exchangeName, timer);
            };

            ws.addEventListener("close", handleClosed);
            ws.addEventListener("error", handleClosed);

            return ws;
        },
        [clearReconnectTimer, isExchangeStillWanted, pruneOldItems]
    );

    useEffect(() => {
        setData(null);
        setTimedOut(false);

        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }

        if (isLive && exchangeNames.length > 0) {
            timeoutRef.current = setTimeout(() => {
                setTimedOut(true);
                timeoutRef.current = null;
            }, LIVE_TIMEOUT_MS);
        }

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, [exchangeNames, isLive]);

    useEffect(() => {
        if (!isLive) {
            reconnectTimersRef.current.forEach(timer => clearTimeout(timer));
            reconnectTimersRef.current.clear();

            socketsRef.current.forEach(ws => {
                ws.close();
            });

            socketsRef.current.clear();
            return;
        }

        const exchanges = exchangeNames.map(value => {
            return getHouse(value)?.exchange || value;
        });

        socketsRef.current.forEach((ws, exchange) => {
            if (!exchanges.includes(exchange)) {
                ws.close();
                socketsRef.current.delete(exchange);
                clearReconnectTimer(exchange);
            }
        });

        reconnectTimersRef.current.forEach((timer, exchange) => {
            if (!exchanges.includes(exchange)) {
                clearTimeout(timer);
                reconnectTimersRef.current.delete(exchange);
            }
        });

        exchanges.forEach(exchangeName => {
            if (socketsRef.current.has(exchangeName)) return;
            if (reconnectTimersRef.current.has(exchangeName)) return;

            const house = getHouse(exchangeName);
            const buildingId = house?.label || exchangeName;

            const ws = connectExchange(exchangeName, buildingId);

            socketsRef.current.set(exchangeName, ws);
        });
    }, [isLive, exchangeNames, connectExchange, clearReconnectTimer]);

    useEffect(() => {
        return () => {
            reconnectTimersRef.current.forEach(timer => clearTimeout(timer));
            reconnectTimersRef.current.clear();

            socketsRef.current.forEach(ws => ws.close());
            socketsRef.current.clear();
        };
    }, []);


    const isWaitingForLiveData =
        isLive &&
        exchangeNames.length > 0 &&
        !data &&
        !timedOut;

    return {
        data,
        isWaitingForLiveData
    };
}

export function communityHouses(
    communityInfo: EnergyCommunity
): string[] {
    const buildings: string[] = [];

    for (const building of communityInfo.collections) {
        const isHouse = AVAILABLE_HOUSES.some(
            house =>
                house.label === building.id ||
                house.exchange === building.id
        );

        if (isHouse) {
            buildings.push(building.id);
        }
    }

    return buildings;
}