import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, FlaskConical, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./AuthContext";
import { listRecs, listSites } from "../api/communityApi";
import type { CommunityRec, CommunitySite } from "../data/communityDomain";
import { usePredictorHouses } from "../hooks/usePredictor";
import { isPredictorRole } from "../utils/roles";
import { readStorage, writeStorage, STORAGE_KEYS } from "../utils/storage";
import { communityHouses, LABORATORY_WORKSPACE_ID, type CommunityHouses } from "../pages/ai/predictor/workspaceScope";

/**
 * The predictor's workspace: the Laboratory shows every house the predictor forecasts,
 * a community workspace only the houses of that community's sites. Communities and
 * sites come from the community service (bounded context); the filtering is done here,
 * the predictor itself is not scoped.
 */
interface PredictorWorkspaceValue {
  /** The workspace in use: "laboratory" or a community id. */
  id: string;
  community: CommunityRec | null;
  communities: CommunityRec[];
  sites: CommunitySite[];
  /** True while the selected community's data is loading. */
  loading: boolean;
  error: string | null;
  retry: () => void;
  select: (id: string) => void;
}

const Context = createContext<PredictorWorkspaceValue>({
  id: LABORATORY_WORKSPACE_ID, community: null, communities: [], sites: [],
  loading: false, error: null, retry: () => {}, select: () => {},
});

export const usePredictorWorkspace = () => useContext(Context);

const COMMUNITY_REFRESH_MS = 300000;

export function PredictorWorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const enabled = isPredictorRole(session?.role);
  const [stored, setStored] = useState(() => readStorage<string>(STORAGE_KEYS.predictorWorkspace, LABORATORY_WORKSPACE_ID));
  // Sites are added and moved between communities in the community service, so both refresh.
  const recs = useQuery({ queryKey: ["predictor-workspace", "recs"], queryFn: listRecs, enabled, staleTime: 60000, refetchInterval: COMMUNITY_REFRESH_MS });
  const sites = useQuery({ queryKey: ["predictor-workspace", "sites"], queryFn: listSites, enabled, staleTime: 60000, refetchInterval: COMMUNITY_REFRESH_MS });

  const communities = useMemo(
    () => [...(recs.data ?? [])].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)),
    [recs.data],
  );
  const wantsCommunity = stored !== LABORATORY_WORKSPACE_ID;
  const community = wantsCommunity ? communities.find((c) => c.id === stored) ?? null : null;
  // A community that no longer exists falls back to the Laboratory once the list is known.
  const id = community ? community.id : wantsCommunity && !recs.isSuccess ? stored : LABORATORY_WORKSPACE_ID;
  const scoped = id !== LABORATORY_WORKSPACE_ID;
  const failed = scoped ? recs.error ?? sites.error : null;

  const value: PredictorWorkspaceValue = {
    id,
    community,
    communities,
    sites: sites.data ?? [],
    loading: scoped && !failed && (recs.isLoading || sites.isLoading),
    error: failed ? failed.message || "The community service did not answer." : null,
    retry: () => { void recs.refetch(); void sites.refetch(); },
    select: (next) => { writeStorage(STORAGE_KEYS.predictorWorkspace, next); setStored(next); },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export interface PredictorScope {
  /** Houses of the workspace, in the predictor's order. */
  houses: string[];
  /** Every house the predictor knows. */
  allHouses: string[];
  /** The workspace's houses as a set; null in the Laboratory (every house). */
  scope: ReadonlySet<string> | null;
  community: CommunityRec | null;
  /** How the community's sites map to houses; null in the Laboratory. */
  detail: CommunityHouses | null;
}

/** The predictor houses the selected workspace shows. */
export function usePredictorScope(): PredictorScope {
  const { community, sites } = usePredictorWorkspace();
  const { data } = usePredictorHouses();
  return useMemo(() => {
    const allHouses = data ?? [];
    if (!community) return { houses: allHouses, allHouses, scope: null, community: null, detail: null };
    const detail = communityHouses(sites, community.id, allHouses);
    const scope = new Set(detail.houses);
    return { houses: allHouses.filter((h) => scope.has(h)), allHouses, scope, community, detail };
  }, [data, community, sites]);
}

export function PredictorWorkspaceSelector() {
  const { id, communities, sites, select } = usePredictorWorkspace();
  const { data: predictorHouses } = usePredictorHouses();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const current = communities.find((c) => c.id === id);
  const needle = search.trim().toLowerCase();
  const shown = communities.filter((c) => (c.name || c.id).toLowerCase().includes(needle));
  const houseCount = (recId: string) =>
    predictorHouses && sites.length ? communityHouses(sites, recId, predictorHouses).houses.length : null;
  const close = () => { setOpen(false); setSearch(""); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) { setOpen(false); setSearch(""); }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); setSearch(""); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const choose = (next: string) => { select(next); close(); trigger.current?.focus(); };
  const countText = (n: number | null) => (n == null ? null : n === 0 ? "No houses forecast" : `${n} ${n === 1 ? "house" : "houses"}`);

  return <div className="training-workspace-picker" ref={picker} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
  }}>
    <button ref={trigger} type="button" className="training-workspace-trigger" aria-expanded={open} aria-controls={menuId}
      onClick={() => { if (open) close(); else setOpen(true); }}>
      <span className="training-workspace-copy"><small>Predictor · Workspace</small><strong>{current?.name || (id === LABORATORY_WORKSPACE_ID ? "Laboratory" : "Loading…")}</strong></span>
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div id={menuId} className="training-workspace-menu" role="region" aria-label="Workspace picker">
      <button className="training-workspace-option training-workspace-lab" type="button" aria-current={id === LABORATORY_WORKSPACE_ID} onClick={() => choose(LABORATORY_WORKSPACE_ID)}>
        <FlaskConical size={17} aria-hidden="true" /><span><strong>Laboratory</strong><small>Every house</small></span>{id === LABORATORY_WORKSPACE_ID && <Check size={16} aria-hidden="true" />}
      </button>
      <div className="training-workspace-divider" role="separator" />
      <label className="training-workspace-search"><Search size={14} aria-hidden="true" /><input aria-label="Search communities" placeholder="Find a community…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <div className="training-workspace-communities">
        {shown.map((c) => {
          const count = countText(houseCount(c.id));
          return <button className="training-workspace-option" type="button" key={c.id} aria-current={id === c.id} onClick={() => choose(c.id)}>
            <span><strong>{c.name || c.id}</strong>{count && <small>{count}</small>}</span>{id === c.id && <Check size={16} aria-hidden="true" />}
          </button>;
        })}
        {!shown.length && <p className="training-workspace-empty" role="status">{search ? "No matching communities." : "No communities available."}</p>}
      </div>
    </div>}
  </div>;
}
