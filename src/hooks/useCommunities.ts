import { useState, useEffect } from "react";
import { api as axios } from "../api/kpiApi";

export interface CommunitiesMap {
  [community: string]: string[];
}

export interface UseCommunitiesResult {
  communities: CommunitiesMap;
  loading: boolean;
  error: string | null;
}

const FALLBACK: CommunitiesMap = {
  living_lab: ["building_R-H-01"],
  "i-charging_headquarters": ["building_i-charging_headquarters_2"],
  sao_mamede: ["building_SaoMamede"],
};

export function useCommunities(): UseCommunitiesResult {
  const [communities, setCommunities] = useState<CommunitiesMap>(FALLBACK);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    axios.get<{ status: string; data: CommunitiesMap }>("api/v1/communities")
      .then((res: any) => {
        if (res?.data?.data && typeof res.data.data === "object") {
          setCommunities(res.data.data);
        } else {
          console.warn("Unexpected communities data:", res.data);
        }
      })
      .catch((err: any) => setError(err?.message || "Failed to load communities"))
      .finally(() => setLoading(false));
  }, []);

  return { communities, loading, error };
}
