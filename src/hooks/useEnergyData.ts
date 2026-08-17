import {
    useState,
    useEffect,
    useRef,
    useCallback,
    startTransition,
} from "react";

import { paginatedFetch } from "../services/paginatedFetchService";
import type { EnergyCommunity } from "../models/energy.model.ts";
import { mapRawToEnergyCommunity } from "../mappers/energy.raw.model.mapper";

export type TimeFilter =
    | {
    type: "minutes";
    minutes: number;
}
    | {
    type: "range";
    from_ts: string;
    until_ts: string;
};

function appendEnergyCommunityPage(
    accumulated: EnergyCommunity,
    next: EnergyCommunity
): EnergyCommunity {
    const collectionsMap = new Map(
        accumulated.collections.map(
            (collection) => [
                collection.id,
                collection,
            ]
        )
    );

    for (const nextCollection of next.collections) {
        const previous =
            collectionsMap.get(
                nextCollection.id
            );

        if (previous) {
            if (
                nextCollection.items.length > 0
            ) {
                previous.items.push(
                    ...nextCollection.items
                );
            }
        } else {
            accumulated.collections.push(
                nextCollection
            );
        }
    }

    return accumulated;
}

function createCommunitySnapshot(
    accumulated: EnergyCommunity
): EnergyCommunity {
    return {
        ...accumulated,

        collections:
            accumulated.collections.map(
                (collection) => ({
                    ...collection,
                    items: collection.items,
                })
            ),
    };
}

export function useEnergyData(
    communityId: string,
    filter: TimeFilter | null
) {
    const [community, setCommunity] =
        useState<EnergyCommunity | null>(
            null
        );

    const [loading, setLoading] =
        useState(false);

    const [loadingMore, setLoadingMore] =
        useState(false);

    const abortRef =
        useRef<AbortController | null>(
            null
        );

    const accumulatedRef =
        useRef<EnergyCommunity | null>(
            null
        );

    const fetchData =
        useCallback(async () => {

            if (
                !communityId ||
                !filter
            ) {
                abortRef.current?.abort();

                accumulatedRef.current =
                    null;

                setCommunity(null);
                setLoading(false);
                setLoadingMore(false);

                return;
            }


            abortRef.current?.abort();

            const controller =
                new AbortController();

            abortRef.current =
                controller;


            accumulatedRef.current =
                null;

            setCommunity(null);

            setLoading(true);
            setLoadingMore(false);

            try {
                const params =
                    filter.type === "minutes"
                        ? {
                            community:
                            communityId,
                            minutes:
                            filter.minutes,
                        }
                        : {
                            community:
                            communityId,
                            from_ts:
                            filter.from_ts,
                            until_ts:
                            filter.until_ts,
                        };

                await paginatedFetch({
                    ...params,

                    signal:
                    controller.signal,

                    onPageReceived:
                        (
                            newPageRaw: any
                        ) => {

                            if (
                                controller.signal
                                    .aborted
                            ) {
                                return;
                            }

                            const newPageModel =
                                mapRawToEnergyCommunity(
                                    newPageRaw
                                );


                            if (
                                !accumulatedRef.current
                            ) {
                                accumulatedRef.current =
                                    newPageModel;
                            } else {

                                appendEnergyCommunityPage(
                                    accumulatedRef.current,
                                    newPageModel
                                );
                            }

                            const snapshot =
                                createCommunitySnapshot(
                                    accumulatedRef.current
                                );

                            startTransition(
                                () => {
                                    setCommunity(
                                        snapshot
                                    );


                                    setLoading(
                                        false
                                    );

                                    setLoadingMore(
                                        true
                                    );
                                }
                            );
                        },
                });

                if (
                    !controller.signal.aborted
                ) {
                    setLoading(false);
                    setLoadingMore(false);
                }

            } catch (error: any) {

                if (
                    error?.name ===
                    "AbortError"
                ) {
                    return;
                }

                console.error(
                    "Error loading energy data:",
                    error
                );


                if (
                    !controller.signal.aborted
                ) {
                    setLoading(false);
                    setLoadingMore(false);
                }
            }
        }, [
            communityId,
            filter,
        ]);

    useEffect(() => {
        fetchData();

        return () => {
            abortRef.current?.abort();
        };
    }, [fetchData]);

    return {
        community,
        loading,
        loadingMore,
    };
}