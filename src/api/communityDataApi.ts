import axios from "axios";
import { mapEnergyCommunity } from "../mappers/energy.dto.model.mapper";
import { mapApiToEnergyCommunityDTO } from "../mappers/energy.json.dto.mapper";
import type { EnergyCommunityDTO } from "../dto/energy.dto";
import type { CommunityContext } from "../types";

const api = axios.create({
    baseURL: "/community-api",
});

async function getCommunitiesData(): Promise<string[]> {
    const response = await api.get("/energy-communities");

    return response.data.energy_communities;
}

async function getHistoricDataByCommunity(
    community: string,
    minutes?: number,
    offset?: number,
    limit?: number,
    from_ts?: string,
    until_ts?: string,
    granularity_minutes?: number
) {
    const response = await api.get(`/historical-data/${community}`, {
        params: {
            minutes,
            offset,
            limit,
            from_ts,
            until_ts,
            granularity_minutes,
        },
    });

    return response.data;
}

async function getCommunityInfo(community: string): Promise<any> {
    const response = await api.get(`/historical-data/${community}`, {
        params: {
            minutes: 60,
            limit: 1,
            offset: 0,
        },
    });

    return response.data;
}

function buildFallbackCommunityContexts(
    names: string[]
): CommunityContext[] {
    return names.map((name) => ({
        id: name,
        name,
        location: "Location not set",
        description: undefined,
        buildings: 0,
        assets: 0,
        status: "normal" as const,
        topologyPreset: "blank" as const,
    }));
}

function countAssetsInBuilding(
    items: ReturnType<
        typeof mapEnergyCommunity
    >["collections"][number]["items"]
): number {
    const latestItem = items[items.length - 1];

    if (!latestItem) {
        return 0;
    }

    const {
        batteries,
        grid_meters,
        electric_vehicles,
        charging_session,
    } = latestItem.observations;

    return (
        batteries.length +
        grid_meters.length +
        electric_vehicles.length +
        charging_session.length
    );
}

async function getCommunityContextsWithInfo(
    names: string[]
): Promise<CommunityContext[]> {
    const results = await Promise.allSettled(
        names.map((name) => getCommunityInfo(name))
    );

    return names.map((name, index) => {
        const result = results[index];

        if (result.status !== "fulfilled") {
            console.warn(
                `Info da comunidade "${name}" não pôde ser carregada`,
                result.reason
            );

            return buildFallbackCommunityContexts([name])[0];
        }

        try {
            const dto: EnergyCommunityDTO =
                mapApiToEnergyCommunityDTO(result.value);

            const community = mapEnergyCommunity(dto);

            const buildingsWithData = community.collections.filter(
                (building) => building.items.length > 0
            );

            const buildings = buildingsWithData.length;

            const assets = buildingsWithData.reduce(
                (total, building) =>
                    total + countAssetsInBuilding(building.items),
                0
            );

            const status =
                buildings === 0 && assets === 0
                    ? "offline"
                    : "normal";

            return {
                id: name,
                name,
                location: "Location not set",
                description: undefined,
                buildings,
                assets,
                status: status as "offline" | "normal",
                topologyPreset: "blank" as const,
            };
        } catch (error) {
            console.error(
                `Erro ao processar comunidade "${name}"`,
                error
            );

            return buildFallbackCommunityContexts([name])[0];
        }
    });
}

function connectRealTimeData(
    exchangeName: string,
    onMessageReceived: (data: any) => void
) {
    const socket = new WebSocket(
        `ws://193.136.62.78:8000/ws/data?exchange_name=${encodeURIComponent(
            exchangeName
        )}`
    );

    socket.onopen = () => {
        console.log(
            `Getting real time data from: ${exchangeName}`
        );
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onMessageReceived(data);
        } catch (error) {
            console.error(
                "Error parsing WebSocket message:",
                error
            );
        }
    };

    socket.onerror = (error) => {
        console.error(
            "WebSocket error:",
            error
        );
    };

    socket.onclose = () => {
        console.log(
            "WebSocket connection closed."
        );
    };

    return socket;
}

export {
    getCommunitiesData,
    getHistoricDataByCommunity,
    getCommunityInfo,
    getCommunityContextsWithInfo,
    buildFallbackCommunityContexts,
    connectRealTimeData,
};