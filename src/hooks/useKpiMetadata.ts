import { useQuery } from "@tanstack/react-query";
import { api as axios } from "../api/kpiApi";

export interface KpiMeta {
  name: string;
  display_name?: string;
  canonical_name?: string;
  category: string;
  type: "streaming" | "scheduled";
  level: "building" | "community" | "both";
  window: string;
  unit: string;
  description: string;
  formula: string;
  status: "available" | "pending";
  registered: boolean;
  pending_reason?: string;
  scope?: string;
}

export interface UseKpiMetadataResult {
  kpis: KpiMeta[];
  loading: boolean;
  error: string | null;
}

/** Loads the KPI catalogue once and shares it (cached) across every component that asks. */
export function useKpiMetadata(): UseKpiMetadataResult {
  const query = useQuery({
    queryKey: ["kpi-metadata"],
    queryFn: async (): Promise<KpiMeta[]> => {
      const res = await axios.get<{ status: string; data: KpiMeta[] }>("api/v1/kpis/metadata");
      if (Array.isArray(res?.data?.data)) return res.data.data;
      console.warn("Unexpected KPI metadata format:", res?.data);
      return [];
    },
    staleTime: 5 * 60_000,
  });
  const error = query.error as { message?: string } | null;
  return {
    kpis: query.data ?? [],
    loading: query.isLoading,
    error: error ? error.message || "Failed to load KPI metadata" : null,
  };
}

/** Name shown to people: display name, then canonical name, then the class name. */
export function kpiDisplayName(meta: KpiMeta | undefined, name: string): string {
  return meta?.display_name || meta?.canonical_name || meta?.name || name;
}

/** Selectable KPIs (available and registered), labelled with their display names. */
export function kpiSelectOptions(kpis: KpiMeta[]): Array<{ value: string; label: string }> {
  return kpis
    .filter((k) => k.status === "available" && k.registered)
    .map((k) => ({ value: k.name, label: kpiDisplayName(k, k.name) }));
}
