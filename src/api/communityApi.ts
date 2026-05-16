import {
  communityContextsFromDomain,
  createDomainRec,
  readCommunityDomainSnapshot,
  writeCommunityDomainSnapshot,
  type CommunityAsset,
  type CommunityAssetType,
  type CommunityDomainSnapshot,
  type CommunityRec,
  type AssetOwnership,
  type CommunityRole,
  type CommunitySite,
  type CommunityUser,
  type CommunityGrant,
  type RecMembership,
  type SiteAccess
} from "../data/communityDomain";
import type { CommunityContext } from "../types";

type CommunityApiMode = "mock" | "backend";

export const COMMUNITY_API_MODE: CommunityApiMode =
  import.meta.env.VITE_COMMUNITY_API_MODE === "backend" ? "backend" : "mock";
export const COMMUNITY_API_URL =
  import.meta.env.VITE_COMMUNITY_API_URL?.replace(/\/$/, "") || "http://localhost:8000";
export const ACCESS_API_URL =
  import.meta.env.VITE_ACCESS_API_URL?.replace(/\/$/, "") || "http://localhost:8001";
export const TELEMETRY_PROFILE_API_URL =
  import.meta.env.VITE_TELEMETRY_PROFILE_API_URL?.replace(/\/$/, "") || "http://localhost:8002";

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    },
    ...init
  });

  if (!response.ok) {
    throw new Error(`Community API request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function snapshot(): CommunityDomainSnapshot {
  return readCommunityDomainSnapshot();
}

function updateSnapshot(mutator: (current: CommunityDomainSnapshot) => void): CommunityDomainSnapshot {
  const current = snapshot();
  mutator(current);
  writeCommunityDomainSnapshot(current);
  return current;
}

export interface CreateRecPayload {
  name: string;
  action_frequency: CommunityRec["action_frequency"];
  localization: CommunityRec["localization"];
  power_limit_export: CommunityRec["power_limit_export"];
  power_limit_import: CommunityRec["power_limit_import"];
  description?: string;
}

export interface CreateSitePayload {
  site_type: CommunitySite["site_type"];
  objective_preference: CommunitySite["objective_preference"];
  assigned_rec_id: string;
  name?: string;
  location?: string;
  is_community_site?: boolean;
}

export type CreateAssetPayload = Omit<CommunityAsset, "id" | "asset_type">;
export type UpdateRecPayload = Partial<CreateRecPayload>;
export type UpdateSitePayload = Partial<CreateSitePayload>;
export type UpdateAssetPayload = Partial<CreateAssetPayload>;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function assertAssetEndpoint(assetType: CommunityAssetType): string {
  const endpoints: Record<CommunityAssetType, string> = {
    appliance: "/api/assets/appliances",
    battery: "/api/assets/batteries",
    ev: "/api/assets/evs",
    ev_charger: "/api/assets/ev-chargers",
    generic_device: "/api/assets/generic-devices",
    grid_meter: "/api/assets/grid-meters",
    heater: "/api/assets/heaters",
    heat_pump: "/api/assets/heat-pumps",
    micro_wind_turbine: "/api/assets/micro-wind-turbines",
    non_shiftable_load: "/api/assets/non-shiftable-loads",
    pv_system: "/api/assets/pv-systems",
    water_pump: "/api/assets/water-pumps"
  };
  return endpoints[assetType];
}

function requireEntity<T>(entity: T | undefined, label: string): T {
  if (!entity) throw new Error(`${label} was not found in the community mock.`);
  return entity;
}

function assetSiteId(asset: CommunityAsset): string | undefined {
  return asset.site_Id || asset.site_id;
}

export async function listRecs(): Promise<CommunityRec[]> {
  if (COMMUNITY_API_MODE === "backend") return request<CommunityRec[]>(COMMUNITY_API_URL, "/api/recs");
  return snapshot().recs;
}

export async function getRec(recId: string): Promise<CommunityRec> {
  if (COMMUNITY_API_MODE === "backend") return request<CommunityRec>(COMMUNITY_API_URL, `/api/recs/${recId}`);
  return requireEntity(snapshot().recs.find((rec) => rec.id === recId), "REC");
}

export async function listSites(): Promise<CommunitySite[]> {
  if (COMMUNITY_API_MODE === "backend") return request<CommunitySite[]>(COMMUNITY_API_URL, "/api/sites");
  return snapshot().sites;
}

export async function getSite(siteId: string): Promise<CommunitySite> {
  if (COMMUNITY_API_MODE === "backend") return request<CommunitySite>(COMMUNITY_API_URL, `/api/sites/${siteId}`);
  return requireEntity(snapshot().sites.find((site) => site.id === siteId), "Site");
}

export async function listAssets(): Promise<CommunityAsset[]> {
  if (COMMUNITY_API_MODE === "backend") return request<CommunityAsset[]>(COMMUNITY_API_URL, "/api/assets");
  return snapshot().assets;
}

export async function getAsset(assetId: string): Promise<CommunityAsset> {
  if (COMMUNITY_API_MODE === "backend") return request<CommunityAsset>(COMMUNITY_API_URL, `/api/assets/${assetId}`);
  return requireEntity(snapshot().assets.find((asset) => asset.id === assetId), "Asset");
}

export async function listUsers(): Promise<CommunityUser[]> {
  if (COMMUNITY_API_MODE === "backend") return request<CommunityUser[]>(COMMUNITY_API_URL, "/api/users");
  return snapshot().users;
}

export async function listRoles(): Promise<CommunityRole[]> {
  if (COMMUNITY_API_MODE === "backend") return request<CommunityRole[]>(ACCESS_API_URL, "/api/roles");
  return snapshot().roles;
}

export async function listGrants(): Promise<CommunityGrant[]> {
  if (COMMUNITY_API_MODE === "backend") return request<CommunityGrant[]>(ACCESS_API_URL, "/api/grants");
  return snapshot().grants;
}

export async function listRecMemberships(): Promise<RecMembership[]> {
  return snapshot().recMemberships;
}

export async function listSiteAccesses(): Promise<SiteAccess[]> {
  return snapshot().siteAccesses;
}

export async function listAssetOwnerships(): Promise<AssetOwnership[]> {
  return snapshot().assetOwnerships;
}

export async function listCommunityContexts(): Promise<CommunityContext[]> {
  if (COMMUNITY_API_MODE === "backend") {
    const [recs, sites, assets] = await Promise.all([listRecs(), listSites(), listAssets()]);
    return communityContextsFromDomain({
      ...snapshot(),
      recs,
      sites,
      assets
    });
  }

  return communityContextsFromDomain();
}

export async function createRec(payload: CreateRecPayload): Promise<CommunityRec> {
  if (COMMUNITY_API_MODE === "backend") {
    return request<CommunityRec>(COMMUNITY_API_URL, "/api/recs", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  const context = createDomainRec({
    name: payload.name,
    location: payload.localization.name,
    description: payload.description,
    action_frequency: payload.action_frequency
  });
  const rec = snapshot().recs.find((item) => item.id === context.id);
  if (!rec) throw new Error("Created REC could not be loaded from mock storage.");
  return rec;
}

export async function updateRec(recId: string, payload: UpdateRecPayload): Promise<CommunityRec> {
  if (COMMUNITY_API_MODE === "backend") {
    return request<CommunityRec>(COMMUNITY_API_URL, `/api/recs/${recId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  let updated: CommunityRec | undefined;
  updateSnapshot((current) => {
    current.recs = current.recs.map((rec) => {
      if (rec.id !== recId) return rec;
      updated = {
        ...rec,
        ...payload,
        localization: payload.localization || rec.localization,
        power_limit_export: payload.power_limit_export || rec.power_limit_export,
        power_limit_import: payload.power_limit_import || rec.power_limit_import
      };
      return updated;
    });
  });
  return requireEntity(updated, "REC");
}

export async function deleteRec(recId: string): Promise<void> {
  if (COMMUNITY_API_MODE === "backend") {
    await request<void>(COMMUNITY_API_URL, `/api/recs/${recId}`, { method: "DELETE" });
    return;
  }

  updateSnapshot((current) => {
    const siteIds = new Set(current.sites.filter((site) => site.assigned_rec_id === recId).map((site) => site.id));
    const assetIds = new Set(
      current.assets
        .filter((asset) => {
          const siteId = assetSiteId(asset);
          return siteId ? siteIds.has(siteId) : false;
        })
        .map((asset) => asset.id)
    );
    current.recs = current.recs.filter((rec) => rec.id !== recId);
    current.sites = current.sites.filter((site) => site.assigned_rec_id !== recId);
    current.assets = current.assets.filter((asset) => !assetIds.has(asset.id));
    current.grants = current.grants.filter((grant) => grant.scope.scope_id !== recId && !siteIds.has(grant.scope.scope_id));
    current.recMemberships = current.recMemberships.filter((membership) => membership.rec_id !== recId);
    current.siteAccesses = current.siteAccesses.filter((access) => !siteIds.has(access.site_id));
    current.assetOwnerships = current.assetOwnerships.filter((ownership) => !assetIds.has(ownership.energy_asset_id));
  });
}

export async function createSite(payload: CreateSitePayload): Promise<CommunitySite> {
  if (COMMUNITY_API_MODE === "backend") {
    return request<CommunitySite>(COMMUNITY_API_URL, "/api/sites", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  const site: CommunitySite = { id: makeId("site"), ...payload };
  updateSnapshot((current) => {
    current.sites = [site, ...current.sites];
  });
  return site;
}

export async function updateSite(siteId: string, payload: UpdateSitePayload): Promise<CommunitySite> {
  if (COMMUNITY_API_MODE === "backend") {
    return request<CommunitySite>(COMMUNITY_API_URL, `/api/sites/${siteId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  let updated: CommunitySite | undefined;
  updateSnapshot((current) => {
    current.sites = current.sites.map((site) => {
      if (site.id !== siteId) return site;
      updated = { ...site, ...payload };
      return updated;
    });
  });
  return requireEntity(updated, "Site");
}

export async function deleteSite(siteId: string): Promise<void> {
  if (COMMUNITY_API_MODE === "backend") {
    await request<void>(COMMUNITY_API_URL, `/api/sites/${siteId}`, { method: "DELETE" });
    return;
  }

  updateSnapshot((current) => {
    const assetIds = new Set(
      current.assets
        .filter((asset) => assetSiteId(asset) === siteId)
        .map((asset) => asset.id)
    );
    current.sites = current.sites.filter((site) => site.id !== siteId);
    current.assets = current.assets.filter((asset) => assetSiteId(asset) !== siteId);
    current.grants = current.grants.filter((grant) => grant.scope.scope_id !== siteId);
    current.siteAccesses = current.siteAccesses.filter((access) => access.site_id !== siteId);
    current.assetOwnerships = current.assetOwnerships.filter((ownership) => !assetIds.has(ownership.energy_asset_id));
  });
}

export async function createAsset(assetType: CommunityAssetType, payload: CreateAssetPayload): Promise<CommunityAsset> {
  if (COMMUNITY_API_MODE === "backend") {
    return request<CommunityAsset>(COMMUNITY_API_URL, assertAssetEndpoint(assetType), {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  const asset: CommunityAsset = { id: makeId("asset"), asset_type: assetType, ...payload };
  updateSnapshot((current) => {
    current.assets = [asset, ...current.assets];
  });
  return asset;
}

export async function updateAsset(
  assetType: CommunityAssetType,
  assetId: string,
  payload: UpdateAssetPayload
): Promise<CommunityAsset> {
  if (COMMUNITY_API_MODE === "backend") {
    return request<CommunityAsset>(COMMUNITY_API_URL, `${assertAssetEndpoint(assetType)}/${assetId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  let updated: CommunityAsset | undefined;
  updateSnapshot((current) => {
    current.assets = current.assets.map((asset) => {
      if (asset.id !== assetId) return asset;
      updated = { ...asset, ...payload };
      return updated;
    });
  });
  return requireEntity(updated, "Asset");
}

export async function deleteAsset(assetId: string): Promise<void> {
  if (COMMUNITY_API_MODE === "backend") {
    await request<void>(COMMUNITY_API_URL, `/api/assets/${assetId}`, { method: "DELETE" });
    return;
  }

  updateSnapshot((current) => {
    current.assets = current.assets.filter((asset) => asset.id !== assetId);
    current.grants = current.grants.filter((grant) => grant.scope.scope_id !== assetId);
    current.assetOwnerships = current.assetOwnerships.filter((ownership) => ownership.energy_asset_id !== assetId);
  });
}
