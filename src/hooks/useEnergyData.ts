import { useState, useEffect, useRef, useCallback, startTransition } from "react";
import { paginatedFetch } from "../services/paginatedFetchService";
import type { EnergyCommunity } from "../models/energy.model.ts";
import { mapRawToEnergyCommunity } from "../mappers/energy.raw.model.mapper";

export type TimeFilter =
    | { type: "minutes"; minutes: number }
    | { type: "range"; from_ts: string; until_ts: string };

function mergeEnergyCommunities(prev: EnergyCommunity | null, next: EnergyCommunity): EnergyCommunity {
    if (!prev) return next;

    const mergedCollections = [...prev.collections];

    next.collections.forEach((nextCol) => {
        const prevColIndex = mergedCollections.findIndex((c) => c.id === nextCol.id);

        if (prevColIndex !== -1) {
            mergedCollections[prevColIndex] = {
                ...mergedCollections[prevColIndex],
                items: [...mergedCollections[prevColIndex].items, ...nextCol.items]
            };
        } else {
            mergedCollections.push(nextCol);
        }
    });

    return {
        ...prev,
        collections: mergedCollections
    };
}

/**
 * Sem gate manual: todas as páginas que chegam da rede são aplicadas
 * automaticamente ao estado via startTransition, que é não-bloqueante —
 * o React pode interromper esta atualização para priorizar interações
 * do utilizador (ex: mexer no slider) enquanto os dados continuam a chegar
 * em segundo plano.
 */
export function useEnergyData(communityId: string, filter: TimeFilter | null) {
    const [community, setCommunity] = useState<EnergyCommunity | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);

    const abortRef = useRef<AbortController | null>(null);

    const fetchData = useCallback(async () => {
        if (!communityId || !filter) {
            setCommunity(null);
            setLoading(false);
            setLoadingMore(false);
            return;
        }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setLoadingMore(false);

        let accumulated: EnergyCommunity | null = null;

        const params = filter.type === "minutes"
            ? { community: communityId, minutes: filter.minutes }
            : { community: communityId, from_ts: filter.from_ts, until_ts: filter.until_ts };

        try {
            await paginatedFetch({
                ...params,
                signal: controller.signal,
                onPageReceived: (newPageRaw: any) => {
                    if (controller.signal.aborted) return;

                    const newPageModel = mapRawToEnergyCommunity(newPageRaw);
                    accumulated = mergeEnergyCommunities(accumulated, newPageModel);

                    startTransition(() => {
                        setCommunity(accumulated);
                        setLoading(false);
                        setLoadingMore(true);
                    });
                },
            });

            if (!controller.signal.aborted) {
                setLoadingMore(false);
            }
        } catch (err: any) {
            if (err?.name !== "AbortError") {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [communityId, filter]);

    useEffect(() => {
        fetchData();
        return () => abortRef.current?.abort();
    }, [fetchData]);

    return { community, loading, loadingMore };
}