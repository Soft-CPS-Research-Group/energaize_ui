import { useState, useEffect } from "react";
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

export function useKpiMetadata(): UseKpiMetadataResult {
  const [kpis, setKpis]       = useState<KpiMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    axios.get<{ status: string; data: KpiMeta[] }>("api/v1/kpis/metadata")
      .then((res: any) => {
        if (res?.data?.data && Array.isArray(res.data.data)) {
          setKpis(res.data.data);
        } else {
          console.warn("Unexpected KPI metadata format:", res.data);
          setKpis([]);
        }
      })
      .catch((err: any) => setError(err?.message || "Failed to load KPI metadata"))
      .finally(() => setLoading(false));
  }, []);

  return { kpis, loading, error };
}
