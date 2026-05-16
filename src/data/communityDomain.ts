import type { CommunityContext, UserRole } from "../types";
import type { EnergyEntity, EnergyEntityKind, EnergyEntityStatus } from "./energyCommunity";

export type CommunityAssetType =
  | "appliance"
  | "battery"
  | "ev"
  | "ev_charger"
  | "generic_device"
  | "grid_meter"
  | "heater"
  | "heat_pump"
  | "micro_wind_turbine"
  | "non_shiftable_load"
  | "pv_system"
  | "water_pump";

export interface CommunityRec {
  id: string;
  name: string;
  action_frequency: "realtime" | "hourly" | "daily" | "weekly";
  localization: {
    name: string;
    latitude?: number;
    longitude?: number;
  };
  power_limit_export: { megawatts: number };
  power_limit_import: { megawatts: number };
  description?: string;
}

export interface CommunitySite {
  id: string;
  site_type: "community" | "residential" | "commercial" | "industrial" | "public";
  objective_preference: "self_consumption" | "cost" | "reliability" | "comfort" | "flexibility";
  assigned_rec_id: string;
  name?: string;
  location?: string;
  is_community_site?: boolean;
}

export interface CommunityAsset {
  id: string;
  asset_type: CommunityAssetType;
  name: string;
  site_Id?: string;
  site_id?: string;
  manufacturer?: {
    name: string;
    country?: string;
  };
  phase_connection?: {
    phases: Array<{ index: number }>;
  };
  status?: EnergyEntityStatus;
  serial_number?: string;
  meter_id?: string;
  vin?: string;
  capacity_kwh?: number;
  nominal_power_kw?: number;
  max_charging_power?: number;
  max_charging_power_kw?: number;
  max_discharging_power?: number;
  max_discharging_power_kw?: number;
  rated_power_kw?: number;
  inverter_capacity_kw?: number;
  number_of_panels?: number;
  consumption?: number;
  charger_type?: "ac" | "dc";
  vehicle_to_grid_allowed?: boolean;
}

export interface CommunityUser {
  id: string;
  name: string;
  email: string;
  timezone: string;
}

export interface CommunityRole {
  id: string;
  role_name: "rec_manager" | "prosumer" | string;
  description: string;
  permissions: Array<{ action: string; resource_type: string }>;
}

export interface CommunityGrant {
  id: string;
  role_id: string;
  user_id: string;
  scope: {
    scope_type: "rec" | "site" | "asset" | "";
    scope_id: string;
  };
  validity?: {
    start: string;
    end: string;
  };
  grant_status: "active" | "pending" | "revoked" | "expired";
}

export interface RecMembership {
  id: string;
  user_id: string;
  rec_id: string;
  member_type: "individual" | "organization";
  membership_status: "pending" | "active" | "suspended";
}

export interface SiteAccess {
  id: string;
  user_id: string;
  site_id: string;
  relation: "owner" | "visitor" | "operator" | "manager";
  validity_start?: string;
  validity_end?: string;
}

export interface AssetOwnership {
  id: string;
  user_id: string;
  energy_asset_id: string;
  ownership_type: "owned" | "leased" | "managed";
}

export interface CommunityDomainSnapshot {
  recs: CommunityRec[];
  sites: CommunitySite[];
  assets: CommunityAsset[];
  users: CommunityUser[];
  roles: CommunityRole[];
  grants: CommunityGrant[];
  recMemberships: RecMembership[];
  siteAccesses: SiteAccess[];
  assetOwnerships: AssetOwnership[];
}

const COMMUNITY_DOMAIN_STORAGE_KEY = "energaize:community-domain:v1";
const PROSUMER_USER_ID = "user-prosumer-01";

const INITIAL_DOMAIN: CommunityDomainSnapshot = {
  recs: [
    {
      id: "solar-community",
      name: "Solar Community",
      description: "Residential REC with local PV, storage and flexible EV charging.",
      action_frequency: "daily",
      localization: { name: "Porto, PT", latitude: 41.1579, longitude: -8.6291 },
      power_limit_export: { megawatts: 5 },
      power_limit_import: { megawatts: 3 }
    },
    {
      id: "river-grid",
      name: "River Grid",
      description: "Mixed-use REC with shared BESS orchestration.",
      action_frequency: "hourly",
      localization: { name: "Gaia, PT", latitude: 41.1239, longitude: -8.6118 },
      power_limit_export: { megawatts: 3.2 },
      power_limit_import: { megawatts: 4.4 }
    },
    {
      id: "wind-hub",
      name: "Wind Hub",
      description: "Pilot site for distributed flexibility operations.",
      action_frequency: "daily",
      localization: { name: "Braga, PT", latitude: 41.5454, longitude: -8.4265 },
      power_limit_export: { megawatts: 1.8 },
      power_limit_import: { megawatts: 2.1 }
    }
  ],
  sites: [
    {
      id: "site-solar-community",
      name: "Community Site",
      site_type: "community",
      objective_preference: "flexibility",
      assigned_rec_id: "solar-community",
      location: "Shared infrastructure",
      is_community_site: true
    },
    {
      id: "site-building-a",
      name: "Building A",
      site_type: "commercial",
      objective_preference: "self_consumption",
      assigned_rec_id: "solar-community",
      location: "North block"
    },
    {
      id: "site-house-1",
      name: "House 1",
      site_type: "residential",
      objective_preference: "self_consumption",
      assigned_rec_id: "solar-community",
      location: "Rua do Sol 12"
    },
    {
      id: "site-house-2",
      name: "House 2",
      site_type: "residential",
      objective_preference: "cost",
      assigned_rec_id: "solar-community",
      location: "Rua do Sol 16"
    },
    {
      id: "site-river-community",
      name: "Community Site",
      site_type: "community",
      objective_preference: "reliability",
      assigned_rec_id: "river-grid",
      location: "Shared infrastructure",
      is_community_site: true
    },
    {
      id: "site-river-campus",
      name: "Campus Building",
      site_type: "commercial",
      objective_preference: "reliability",
      assigned_rec_id: "river-grid",
      location: "West campus"
    },
    {
      id: "site-wind-community",
      name: "Community Site",
      site_type: "community",
      objective_preference: "flexibility",
      assigned_rec_id: "wind-hub",
      location: "Shared infrastructure",
      is_community_site: true
    },
    {
      id: "site-wind-lab",
      name: "Living Lab",
      site_type: "public",
      objective_preference: "flexibility",
      assigned_rec_id: "wind-hub",
      location: "Pilot building"
    }
  ],
  assets: [
    {
      id: "asset-main-transformer",
      asset_type: "grid_meter",
      name: "Main Transformer Meter",
      site_Id: "site-solar-community",
      manufacturer: { name: "MeterMaker" },
      phase_connection: { phases: [{ index: 3 }] },
      meter_id: "GM-0001",
      nominal_power_kw: 1200,
      status: "online"
    },
    {
      id: "asset-solar-plant",
      asset_type: "pv_system",
      name: "Solar Plant",
      site_Id: "site-solar-community",
      manufacturer: { name: "SolarCorp", country: "PT" },
      nominal_power_kw: 850,
      inverter_capacity_kw: 820,
      number_of_panels: 1800,
      status: "online"
    },
    {
      id: "asset-shared-bess",
      asset_type: "battery",
      name: "Shared BESS",
      site_Id: "site-solar-community",
      manufacturer: { name: "BatteryCo" },
      capacity_kwh: 240,
      nominal_power_kw: 120,
      status: "online"
    },
    {
      id: "asset-building-a-meter",
      asset_type: "grid_meter",
      name: "Building A Grid Meter",
      site_Id: "site-building-a",
      manufacturer: { name: "MeterMaker" },
      meter_id: "GM-A-01",
      nominal_power_kw: 180,
      status: "warning"
    },
    {
      id: "asset-house-1-battery",
      asset_type: "battery",
      name: "Home Battery",
      site_Id: "site-house-1",
      manufacturer: { name: "BatteryCo" },
      capacity_kwh: 13.5,
      nominal_power_kw: 5,
      status: "online"
    },
    {
      id: "asset-house-1-pv",
      asset_type: "pv_system",
      name: "Rooftop PV",
      site_Id: "site-house-1",
      manufacturer: { name: "SolarCorp" },
      nominal_power_kw: 4.2,
      inverter_capacity_kw: 4,
      number_of_panels: 10,
      status: "online"
    },
    {
      id: "asset-house-1-charger",
      asset_type: "ev_charger",
      name: "EV Charger",
      site_Id: "site-house-1",
      manufacturer: { name: "ChargeCorp" },
      serial_number: "EVSE-014",
      nominal_power_kw: 11,
      max_charging_power: 7.8,
      charger_type: "ac",
      status: "warning"
    },
    {
      id: "asset-house-1-ev",
      asset_type: "ev",
      name: "Electric Vehicle",
      site_Id: "site-house-1",
      manufacturer: { name: "EVMaker" },
      vin: "1HGBH41JXMN109186",
      capacity_kwh: 50,
      max_charging_power_kw: 10,
      vehicle_to_grid_allowed: true,
      status: "online"
    },
    {
      id: "asset-house-2-load",
      asset_type: "non_shiftable_load",
      name: "Base Load",
      site_Id: "site-house-2",
      manufacturer: { name: "AppliancesCo" },
      consumption: 0.15,
      status: "online"
    },
    {
      id: "asset-river-bess",
      asset_type: "battery",
      name: "River BESS",
      site_Id: "site-river-community",
      manufacturer: { name: "BatteryCo" },
      capacity_kwh: 96,
      nominal_power_kw: 48,
      status: "online"
    },
    {
      id: "asset-river-pv",
      asset_type: "pv_system",
      name: "Campus PV",
      site_Id: "site-river-campus",
      manufacturer: { name: "SolarCorp" },
      nominal_power_kw: 64,
      number_of_panels: 144,
      status: "online"
    },
    {
      id: "asset-wind-turbine",
      asset_type: "micro_wind_turbine",
      name: "Micro Wind Turbine",
      site_Id: "site-wind-community",
      manufacturer: { name: "WindMaker" },
      rated_power_kw: 3,
      status: "offline"
    }
  ],
  users: [
    { id: "user-rec-manager-01", name: "REC Manager", email: "rec@energaize.io", timezone: "Europe/Lisbon" },
    { id: PROSUMER_USER_ID, name: "Prosumer", email: "prosumer@energaize.io", timezone: "Europe/Lisbon" }
  ],
  roles: [
    {
      id: "role-rec-manager",
      role_name: "rec_manager",
      description: "Manage RECs, sites, assets and memberships.",
      permissions: [
        { action: "read", resource_type: "rec" },
        { action: "write", resource_type: "rec" },
        { action: "write", resource_type: "site" },
        { action: "write", resource_type: "asset" }
      ]
    },
    {
      id: "role-prosumer",
      role_name: "prosumer",
      description: "Read own site and assets.",
      permissions: [
        { action: "read", resource_type: "rec" },
        { action: "read", resource_type: "site" },
        { action: "read", resource_type: "asset" }
      ]
    }
  ],
  grants: [
    {
      id: "grant-rec-manager-solar",
      role_id: "role-rec-manager",
      user_id: "user-rec-manager-01",
      scope: { scope_type: "rec", scope_id: "solar-community" },
      grant_status: "active"
    },
    {
      id: "grant-prosumer-house-1",
      role_id: "role-prosumer",
      user_id: PROSUMER_USER_ID,
      scope: { scope_type: "site", scope_id: "site-house-1" },
      grant_status: "active"
    }
  ],
  recMemberships: [
    {
      id: "membership-prosumer-solar",
      user_id: PROSUMER_USER_ID,
      rec_id: "solar-community",
      member_type: "individual",
      membership_status: "active"
    }
  ],
  siteAccesses: [
    {
      id: "site-access-prosumer-house-1",
      user_id: PROSUMER_USER_ID,
      site_id: "site-house-1",
      relation: "owner",
      validity_start: "2026-01-01",
      validity_end: "2026-12-31"
    }
  ],
  assetOwnerships: [
    {
      id: "ownership-prosumer-battery",
      user_id: PROSUMER_USER_ID,
      energy_asset_id: "asset-house-1-battery",
      ownership_type: "owned"
    },
    {
      id: "ownership-prosumer-ev",
      user_id: PROSUMER_USER_ID,
      energy_asset_id: "asset-house-1-ev",
      ownership_type: "owned"
    }
  ]
};

function cloneSnapshot(snapshot: CommunityDomainSnapshot): CommunityDomainSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as CommunityDomainSnapshot;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function mergeById<T extends { id: string }>(base: T[], persisted?: T[]): T[] {
  if (!persisted) return base;
  const persistedIds = new Set(persisted.map((item) => item.id));
  return [...persisted, ...base.filter((item) => !persistedIds.has(item.id))];
}

export function readCommunityDomainSnapshot(): CommunityDomainSnapshot {
  if (!canUseStorage()) return cloneSnapshot(INITIAL_DOMAIN);
  const raw = window.localStorage.getItem(COMMUNITY_DOMAIN_STORAGE_KEY);
  if (!raw) return cloneSnapshot(INITIAL_DOMAIN);
  try {
    const base = cloneSnapshot(INITIAL_DOMAIN);
    const persisted = JSON.parse(raw) as Partial<CommunityDomainSnapshot>;
    return {
      recs: mergeById(base.recs, persisted.recs),
      sites: mergeById(base.sites, persisted.sites),
      assets: mergeById(base.assets, persisted.assets),
      users: mergeById(base.users, persisted.users),
      roles: mergeById(base.roles, persisted.roles),
      grants: mergeById(base.grants, persisted.grants),
      recMemberships: mergeById(base.recMemberships, persisted.recMemberships),
      siteAccesses: mergeById(base.siteAccesses, persisted.siteAccesses),
      assetOwnerships: mergeById(base.assetOwnerships, persisted.assetOwnerships)
    };
  } catch {
    return cloneSnapshot(INITIAL_DOMAIN);
  }
}

export function writeCommunityDomainSnapshot(snapshot: CommunityDomainSnapshot): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(COMMUNITY_DOMAIN_STORAGE_KEY, JSON.stringify(snapshot));
}

function assetSiteId(asset: CommunityAsset): string | undefined {
  return asset.site_Id || asset.site_id;
}

function recStatusFor(rec: CommunityRec, snapshot: CommunityDomainSnapshot): CommunityContext["status"] {
  const siteIds = new Set(snapshot.sites.filter((site) => site.assigned_rec_id === rec.id).map((site) => site.id));
  const assets = snapshot.assets.filter((asset) => {
    const siteId = assetSiteId(asset);
    return siteId ? siteIds.has(siteId) : false;
  });

  if (assets.length > 0 && assets.every((asset) => asset.status === "offline")) return "offline";
  if (assets.some((asset) => asset.status === "warning" || asset.status === "offline")) return "alerts";
  return "normal";
}

export function communityContextsFromDomain(snapshot = readCommunityDomainSnapshot()): CommunityContext[] {
  return snapshot.recs.map((rec) => {
    const sites = snapshot.sites.filter((site) => site.assigned_rec_id === rec.id);
    const siteIds = new Set(sites.map((site) => site.id));
    const assets = snapshot.assets.filter((asset) => {
      const siteId = assetSiteId(asset);
      return siteId ? siteIds.has(siteId) : false;
    });

    return {
      id: rec.id,
      name: rec.name,
      location: rec.localization.name,
      description: rec.description,
      buildings: sites.filter((site) => !site.is_community_site).length,
      assets: assets.length,
      status: recStatusFor(rec, snapshot)
    };
  });
}

function valueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDomainRec(input: {
  name: string;
  location: string;
  description?: string;
  action_frequency?: CommunityRec["action_frequency"];
}): CommunityContext {
  const snapshot = readCommunityDomainSnapshot();
  const id = valueId("rec");
  const rec: CommunityRec = {
    id,
    name: input.name,
    description: input.description,
    action_frequency: input.action_frequency || "daily",
    localization: { name: input.location },
    power_limit_export: { megawatts: 0 },
    power_limit_import: { megawatts: 0 }
  };
  snapshot.recs = [rec, ...snapshot.recs];
  writeCommunityDomainSnapshot(snapshot);

  return {
    id,
    name: rec.name,
    location: rec.localization.name,
    description: rec.description,
    buildings: 0,
    assets: 0,
    status: "normal",
    topologyPreset: "blank"
  };
}

function kindForAsset(asset: CommunityAsset, site?: CommunitySite): EnergyEntityKind {
  if (asset.asset_type === "battery") return "battery";
  if (asset.asset_type === "ev") return "ev";
  if (asset.asset_type === "ev_charger") return "ev_charger";
  if (asset.asset_type === "pv_system") {
    return site?.is_community_site || (asset.nominal_power_kw || 0) >= 100 ? "solar_plant" : "pv";
  }
  if (asset.asset_type === "grid_meter") return "grid_meter";
  if (asset.asset_type === "micro_wind_turbine") return "micro_wind_turbine";
  if (asset.asset_type === "heat_pump") return "heat_pump";
  if (asset.asset_type === "heater") return "heater";
  if (asset.asset_type === "water_pump") return "water_pump";
  if (asset.asset_type === "non_shiftable_load") return "non_shiftable_load";
  if (asset.asset_type === "appliance") return "appliance";
  return "generic_device";
}

function formatNumeric(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function capacityForAsset(asset: CommunityAsset): string | undefined {
  if (typeof asset.capacity_kwh === "number") return `${formatNumeric(asset.capacity_kwh)} kWh`;
  if (typeof asset.nominal_power_kw === "number") return `${formatNumeric(asset.nominal_power_kw)} kW`;
  if (typeof asset.rated_power_kw === "number") return `${formatNumeric(asset.rated_power_kw)} kW`;
  if (typeof asset.max_charging_power === "number") return `${formatNumeric(asset.max_charging_power)} kW`;
  if (typeof asset.max_charging_power_kw === "number") return `${formatNumeric(asset.max_charging_power_kw)} kW`;
  if (typeof asset.consumption === "number") return `${formatNumeric(asset.consumption)} kW`;
  return undefined;
}

function assetSerial(asset: CommunityAsset): string | undefined {
  return asset.serial_number || asset.meter_id || asset.vin;
}

function siteName(site: CommunitySite): string {
  return site.name || `${site.site_type.charAt(0).toUpperCase()}${site.site_type.slice(1)} site`;
}

function siteOwnerScope(site: CommunitySite, role: UserRole | null | undefined, snapshot: CommunityDomainSnapshot): EnergyEntity["ownerScope"] {
  if (role !== "prosumer") return "community";
  return snapshot.siteAccesses.some(
    (access) => access.user_id === PROSUMER_USER_ID && access.site_id === site.id
  )
    ? "prosumer"
    : "community";
}

function assetOwnerScope(asset: CommunityAsset, siteOwner: EnergyEntity["ownerScope"], snapshot: CommunityDomainSnapshot): EnergyEntity["ownerScope"] {
  if (siteOwner === "prosumer") return "prosumer";
  return snapshot.assetOwnerships.some(
    (ownership) => ownership.user_id === PROSUMER_USER_ID && ownership.energy_asset_id === asset.id
  )
    ? "prosumer"
    : "community";
}

function prosumerAllowedSiteIds(snapshot: CommunityDomainSnapshot): Set<string> {
  return new Set(snapshot.siteAccesses.filter((access) => access.user_id === PROSUMER_USER_ID).map((access) => access.site_id));
}

export function energyEntitiesFromDomain(
  community: CommunityContext,
  role: UserRole | null | undefined,
  snapshot = readCommunityDomainSnapshot()
): EnergyEntity[] {
  const rec = snapshot.recs.find((item) => item.id === community.id);
  if (!rec) {
    return [
      {
        id: "community",
        parentId: null,
        label: community.name,
        kind: "community",
        status: community.status === "offline" ? "offline" : community.status === "alerts" ? "warning" : "online",
        ownerScope: "community",
        location: community.location,
        description: community.description
      }
    ];
  }

  const allowedSiteIds = role === "prosumer" ? prosumerAllowedSiteIds(snapshot) : null;
  const sites = snapshot.sites.filter((site) => site.assigned_rec_id === rec.id);
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const assets = snapshot.assets.filter((asset) => {
    const siteId = assetSiteId(asset);
    return siteId ? siteById.has(siteId) : false;
  });

  const root: EnergyEntity = {
    id: "community",
    parentId: null,
    label: rec.name,
    kind: "community",
    status: recStatusFor(rec, snapshot) === "offline" ? "offline" : recStatusFor(rec, snapshot) === "alerts" ? "warning" : "online",
    ownerScope: "community",
    location: rec.localization.name,
    description: rec.description
  };

  const siteEntities: EnergyEntity[] = sites
    .filter((site) => !allowedSiteIds || allowedSiteIds.has(site.id))
    .map((site) => {
      const ownerScope = siteOwnerScope(site, role, snapshot);
      return {
        id: site.id,
        parentId: "community",
        label: siteName(site),
        kind: site.is_community_site ? "group" : "building",
        status: "online",
        ownerScope,
        location: site.location,
        description: `${site.site_type} site - ${site.objective_preference.replace("_", " ")}`
      };
    });

  const visibleSiteIds = new Set(siteEntities.map((site) => site.id));
  const assetEntities: EnergyEntity[] = assets
    .filter((asset) => {
      const siteId = assetSiteId(asset);
      return siteId ? visibleSiteIds.has(siteId) : false;
    })
    .map((asset) => {
      const site = siteById.get(assetSiteId(asset) || "");
      const siteEntity = site ? siteEntities.find((entity) => entity.id === site.id) : undefined;
      return {
        id: asset.id,
        parentId: assetSiteId(asset) || "community",
        label: asset.name,
        kind: kindForAsset(asset, site),
        status: asset.status || "online",
        ownerScope: assetOwnerScope(asset, siteEntity?.ownerScope || "community", snapshot),
        description: asset.manufacturer?.name ? `${asset.manufacturer.name} ${asset.asset_type.replace(/_/g, " ")}` : asset.asset_type.replace(/_/g, " "),
        serial: assetSerial(asset),
        capacity: capacityForAsset(asset)
      };
    });

  if (role === "prosumer") {
    return [root, ...siteEntities, ...assetEntities.filter((asset) => asset.ownerScope === "prosumer")];
  }

  return [root, ...siteEntities, ...assetEntities];
}
