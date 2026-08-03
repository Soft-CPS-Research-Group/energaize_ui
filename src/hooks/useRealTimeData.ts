import { useState, useEffect, useRef, useCallback } from "react";
import { connectRealTimeData } from "../api/communityDataApi";
import { mapRealTimeToEnergyCommunity } from "../mappers/energy.real_time_raw.model.mapper";
import type { EnergyCommunity, BuildingItems } from "../models/energy.model.ts";

const WINDOW_MINUTES = 10;

export function useRealTimeData(
    exchangeNames: string[],
    isLive: boolean
) {
    const [data, setData] = useState<EnergyCommunity | null>(null);
    const socketsRef = useRef<Map<string, WebSocket>>(new Map());

    const pruneOldItems = useCallback((items: BuildingItems[]) => {
        const cutoff = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
        return items.filter((item) => item.timestamp >= cutoff);
    }, []);

    // Helper para extrair o ID simplificado (ex: RH-02)
    const getShortName = (fullName: string) => fullName.split("_").pop() || fullName;

    // Reset de dados ao mudar seleção ou desligar Live
    useEffect(() => {
        setData(null);
    }, [exchangeNames, isLive]);

    useEffect(() => {
        if (!isLive) {
            socketsRef.current.forEach(ws => ws.close());
            socketsRef.current.clear();
            return;
        }

        // 1. Fechar sockets que já não estão na lista
        socketsRef.current.forEach((ws, name) => {
            if (!exchangeNames.includes(name)) {
                ws.close();
                socketsRef.current.delete(name);
            }
        });

        // 2. Abrir novos sockets
        exchangeNames.forEach((fullName) => {
            if (socketsRef.current.has(fullName)) return;

            const shortName = getShortName(fullName);

            const ws = connectRealTimeData(fullName, (newData) => {
                // Mapeamos usando o nome curto para o ID da coleção
                const incoming = mapRealTimeToEnergyCommunity(newData, shortName);
                const newBuildingData = incoming.collections[0];

                setData((prev) => {
                    if (!prev) {
                        return {
                            id: "Shared_Community",
                            collections: [newBuildingData]
                        };
                    }

                    const buildingIndex = prev.collections.findIndex(b => b.id === shortName);
                    let updatedCollections = [...prev.collections];

                    if (buildingIndex !== -1) {
                        const existingBuilding = updatedCollections[buildingIndex];
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
                    
                    return { ...prev, collections: updatedCollections };
                });
            });

            socketsRef.current.set(fullName, ws);
        });
    }, [isLive, exchangeNames, pruneOldItems]);

    useEffect(() => {
        return () => {
            socketsRef.current.forEach(ws => ws.close());
        };
    }, []);

    return { data };
}