import { getHistoricDataByCommunity } from "../api/communityDataApi";

const LIMIT = 1000;

export interface FetchParams {
    community: string;
    minutes?: number;
    from_ts?: string;
    until_ts?: string;
    granularity_minutes?: number;
    onPageReceived?: (pageData: any) => void;
    signal?: AbortSignal;
}

function countItems(response: any): number {
    return Object.values(
        response?.collections ?? {}
    ).reduce(
        (total: number, building: any) =>
            total + (building?.items?.length ?? 0),
        0
    );
}


export async function paginatedFetch(
    params: FetchParams
): Promise<void> {
    const {
        community,
        minutes,
        from_ts,
        until_ts,
        granularity_minutes,
        onPageReceived,
        signal,
    } = params;

    let offset = 0;

    while (!signal?.aborted) {
        const response =
            await getHistoricDataByCommunity(
                community,
                minutes,
                offset,
                LIMIT,
                from_ts,
                until_ts,
                granularity_minutes
            );

        if (signal?.aborted) {
            return;
        }

        const itemsInPage =
            countItems(response);


        if (itemsInPage > 0) {
            onPageReceived?.(response);
        }


        if (itemsInPage < LIMIT) {
            break;
        }

        offset += LIMIT;
    }
}