import { getHistoricDataByCommunity } from "../api/communityDataApi";

const LIMIT = 1000;
const PARALLEL_PAGES = 4;

export interface FetchParams {
    community: string;
    minutes?: number;
    from_ts?: string;
    until_ts?: string;
    granularity_minutes?: number;
    onPageReceived?: (pageData: any) => void;
    signal?: AbortSignal;
}

export async function paginatedFetch(params: FetchParams): Promise<any> {
    const { community, minutes, from_ts, until_ts, granularity_minutes, onPageReceived, signal } = params;

    let currentOffset = 0;
    let done = false;
    let merged: any = null;

    // 1. PRIMEIRO PEDIDO (Página 0)
    const firstResponse = await getHistoricDataByCommunity(
        community, minutes, currentOffset, LIMIT, from_ts, until_ts, granularity_minutes
    );

    if (signal?.aborted) return firstResponse;

    merged = JSON.parse(JSON.stringify(firstResponse));

    // Dispara a primeira página com a estrutura intacta
    onPageReceived?.(firstResponse);

    const firstPageTotal = Object.values(firstResponse.collections ?? {})
        .flatMap((b: any) => b.items ?? []).length;

    if (firstPageTotal < LIMIT) {
        return merged;
    }

    currentOffset += LIMIT;

    // 2. PEDIDOS EM PARALELO (Ronda de Páginas)
    while (!done && !signal?.aborted) {
        const promises = [];

        for (let i = 0; i < PARALLEL_PAGES; i++) {
            const nextOffset = currentOffset + (i * LIMIT);
            promises.push(
                getHistoricDataByCommunity(
                    community, minutes, nextOffset, LIMIT, from_ts, until_ts, granularity_minutes
                )
            );
        }

        const responses = await Promise.all(promises);

        for (const response of responses) {
            if (signal?.aborted) break;

            let itemsInPage = 0;

            // Criamos o chunk copiando as propriedades do nível superior (ex: status, community_id)
            const singlePageChunk: any = { ...response, collections: {} };

            for (const buildingKey of Object.keys(response.collections ?? {})) {
                const rawBuilding = response.collections[buildingKey];
                const incoming = rawBuilding?.items ?? [];
                itemsInPage += incoming.length;

                // 1. Agrega no merged global
                if (!merged.collections[buildingKey]) {
                    merged.collections[buildingKey] = { ...rawBuilding, items: [] };
                }
                merged.collections[buildingKey].items.push(...incoming);

                // 2. Clona o edifício mantendo metadados (IDs, nomes) e isola os items deste lote
                singlePageChunk.collections[buildingKey] = {
                    ...rawBuilding,
                    items: [...incoming]
                };
            }

            // Envia a página estruturada corretamente de forma incremental
            if (itemsInPage > 0) {
                onPageReceived?.(singlePageChunk);
            }

            if (itemsInPage < LIMIT) {
                done = true;
            }
        }

        if (done) break;
        currentOffset += PARALLEL_PAGES * LIMIT;
    }

    return merged;
}