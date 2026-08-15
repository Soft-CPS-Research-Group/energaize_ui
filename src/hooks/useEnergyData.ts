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

/**
 * Faz merge de uma nova página na comunidade acumulada.
 *
 * Mantemos a estrutura imutável para o React.
 * Apenas as collections que recebem novos dados
 * são recriadas.
 */
function mergeEnergyCommunities(
    prev: EnergyCommunity | null,
    next: EnergyCommunity
): EnergyCommunity {
    if (!prev) {
        return next;
    }

    const collectionsMap = new Map(
        prev.collections.map((collection) => [
            collection.id,
            collection,
        ])
    );

    for (const nextCollection of next.collections) {
        const previous =
            collectionsMap.get(nextCollection.id);

        if (previous) {
            collectionsMap.set(
                nextCollection.id,
                {
                    ...previous,
                    items: [
                        ...previous.items,
                        ...nextCollection.items,
                    ],
                }
            );
        } else {
            collectionsMap.set(
                nextCollection.id,
                nextCollection
            );
        }
    }

    return {
        ...prev,
        collections: Array.from(
            collectionsMap.values()
        ),
    };
}

export function useEnergyData(
    communityId: string,
    filter: TimeFilter | null
) {
    const [community, setCommunity] =
        useState<EnergyCommunity | null>(null);

    const [loading, setLoading] =
        useState(false);

    const [loadingMore, setLoadingMore] =
        useState(false);

    const abortRef =
        useRef<AbortController | null>(null);

    const fetchData = useCallback(async () => {
        /**
         * Sem comunidade ou filtro:
         * limpamos os dados existentes.
         */
        if (!communityId || !filter) {
            abortRef.current?.abort();

            setCommunity(null);
            setLoading(false);
            setLoadingMore(false);

            return;
        }

        /**
         * Cancela uma pesquisa anterior antes
         * de começar outra.
         */
        abortRef.current?.abort();

        const controller =
            new AbortController();

        abortRef.current = controller;

        setLoading(true);
        setLoadingMore(false);

        let accumulated:
            | EnergyCommunity
            | null = null;

        try {
            /**
             * Construção dos parâmetros da API.
             */
            const params =
                filter.type === "minutes"
                    ? {
                        community: communityId,
                        minutes: filter.minutes,
                    }
                    : {
                        community: communityId,
                        from_ts: filter.from_ts,
                        until_ts: filter.until_ts,
                    };

            await paginatedFetch({
                ...params,

                signal: controller.signal,

                onPageReceived: (
                    newPageRaw: any
                ) => {
                    if (controller.signal.aborted) {
                        return;
                    }

                    /**
                     * Converte apenas a página recebida.
                     */
                    const newPageModel =
                        mapRawToEnergyCommunity(
                            newPageRaw
                        );

                    /**
                     * Acumula os dados para que
                     * community continue a conter
                     * todos os dados recebidos.
                     */
                    accumulated =
                        mergeEnergyCommunities(
                            accumulated,
                            newPageModel
                        );

                    /**
                     * Guardamos a referência atual
                     * antes da transition.
                     */
                    const currentAccumulated =
                        accumulated;

                    /**
                     * Atualização de baixa prioridade.
                     *
                     * Isto permite ao React dar prioridade
                     * à interação do utilizador enquanto
                     * os dados continuam a chegar.
                     */
                    startTransition(() => {
                        setCommunity(
                            currentAccumulated
                        );

                        setLoading(false);
                        setLoadingMore(true);
                    });
                },
            });

            if (!controller.signal.aborted) {
                setLoadingMore(false);
            }
        } catch (error: any) {
            /**
             * AbortError acontece normalmente quando
             * o utilizador muda de filtro.
             */
            if (
                error?.name === "AbortError"
            ) {
                return;
            }

            console.error(
                "Error loading energy data:",
                error
            );

            if (!controller.signal.aborted) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [communityId, filter]);

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