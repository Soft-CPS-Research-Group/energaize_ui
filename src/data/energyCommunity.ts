import type { CommunityContext, LogEntry, UserRole } from "../types";

export type EnergyEntityKind =
  | "community"
  | "group"
  | "building"
  | "apartment"
  | "house"
  | "battery"
  | "ev"
  | "pv"
  | "transformer"
  | "solar_plant";

export type EnergyEntityStatus = "online" | "warning" | "offline";

export interface EnergyEntity {
  id: string;
  parentId: string | null;
  label: string;
  kind: EnergyEntityKind;
  status: EnergyEntityStatus;
  ownerScope: "community" | "prosumer";
  location?: string;
  description?: string;
  serial?: string;
  capacity?: string;
}

export interface EnergyTreeNode extends EnergyEntity {
  children: EnergyTreeNode[];
}

export interface EnergyKpi {
  id: string;
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  sparkline?: number[];
}

export interface EnergySeriesPoint {
  label: string;
  consumption: number;
  production: number;
  importKw: number;
  exportKw: number;
  price: number;
  forecast: number;
}

export interface TopologyNode {
  id: string;
  x: number;
  y: number;
}

export interface TopologyEdge {
  id: string;
  from: string;
  to: string;
  tone: "production" | "storage" | "demand" | "grid";
}

export type EnergyRange = "live" | "1h" | "6h" | "24h" | "7d" | "30d";

const BASE_ENTITIES: EnergyEntity[] = [
  {
    id: "community",
    parentId: null,
    label: "Solar Community",
    kind: "community",
    status: "online",
    ownerScope: "community",
    description: "Shared renewable community with PV, storage and flexible EV charging."
  },
  {
    id: "building-a",
    parentId: "community",
    label: "Building A",
    kind: "building",
    status: "online",
    ownerScope: "community",
    location: "North block"
  },
  {
    id: "apartment-1",
    parentId: "building-a",
    label: "Apartment 1",
    kind: "apartment",
    status: "online",
    ownerScope: "community"
  },
  {
    id: "apartment-2",
    parentId: "building-a",
    label: "Apartment 2",
    kind: "apartment",
    status: "warning",
    ownerScope: "community"
  },
  {
    id: "building-b",
    parentId: "community",
    label: "Building B",
    kind: "building",
    status: "online",
    ownerScope: "community",
    location: "Residential row"
  },
  {
    id: "house-1",
    parentId: "building-b",
    label: "House 1",
    kind: "house",
    status: "online",
    ownerScope: "prosumer",
    location: "Rua do Sol 12"
  },
  {
    id: "house-2",
    parentId: "building-b",
    label: "House 2",
    kind: "house",
    status: "online",
    ownerScope: "community"
  },
  {
    id: "battery-bank",
    parentId: "house-1",
    label: "Battery Bank",
    kind: "battery",
    status: "online",
    ownerScope: "prosumer",
    serial: "BBK-001",
    capacity: "6.5 kWh"
  },
  {
    id: "ev-charger",
    parentId: "house-1",
    label: "EV Charger",
    kind: "ev",
    status: "warning",
    ownerScope: "prosumer",
    serial: "EVSE-014",
    capacity: "11 kW"
  },
  {
    id: "rooftop-pv",
    parentId: "house-1",
    label: "Rooftop PV",
    kind: "pv",
    status: "online",
    ownerScope: "prosumer",
    capacity: "4.2 kWp"
  },
  {
    id: "community-assets",
    parentId: "community",
    label: "Community Assets",
    kind: "group",
    status: "online",
    ownerScope: "community"
  },
  {
    id: "main-transformer",
    parentId: "community-assets",
    label: "Main Transformer",
    kind: "transformer",
    status: "online",
    ownerScope: "community",
    serial: "TRF-02"
  },
  {
    id: "solar-plant",
    parentId: "community-assets",
    label: "Solar Plant",
    kind: "solar_plant",
    status: "online",
    ownerScope: "community",
    capacity: "850 kWp"
  },
  {
    id: "shared-bess",
    parentId: "community-assets",
    label: "Shared BESS",
    kind: "battery",
    status: "online",
    ownerScope: "community",
    serial: "BESS-08",
    capacity: "240 kWh"
  }
];

const PROSUMER_ENTITY_IDS = new Set(["community", "building-b", "house-1", "battery-bank", "ev-charger", "rooftop-pv"]);

const TOPOLOGY_NODES: TopologyNode[] = [
  { id: "solar-plant", x: 46, y: 10 },
  { id: "main-transformer", x: 48, y: 42 },
  { id: "shared-bess", x: 24, y: 68 },
  { id: "building-a", x: 22, y: 34 },
  { id: "building-b", x: 72, y: 58 },
  { id: "house-1", x: 74, y: 78 },
  { id: "battery-bank", x: 57, y: 76 },
  { id: "ev-charger", x: 88, y: 82 },
  { id: "rooftop-pv", x: 68, y: 28 }
];

const TOPOLOGY_EDGES: TopologyEdge[] = [
  { id: "solar-transformer", from: "solar-plant", to: "main-transformer", tone: "production" },
  { id: "pv-house", from: "rooftop-pv", to: "house-1", tone: "production" },
  { id: "bess-transformer", from: "shared-bess", to: "main-transformer", tone: "storage" },
  { id: "transformer-a", from: "main-transformer", to: "building-a", tone: "demand" },
  { id: "transformer-b", from: "main-transformer", to: "building-b", tone: "demand" },
  { id: "house-battery", from: "house-1", to: "battery-bank", tone: "storage" },
  { id: "house-ev", from: "house-1", to: "ev-charger", tone: "demand" }
];

function isProsumerRole(role: UserRole | null | undefined): boolean {
  return role === "prosumer";
}

function entityWithCommunity(entity: EnergyEntity, community: CommunityContext): EnergyEntity {
  if (entity.id !== "community") return entity;
  return {
    ...entity,
    label: community.name,
    location: community.location,
    status: community.status === "offline" ? "offline" : community.status === "alerts" ? "warning" : "online",
    description: community.description || entity.description
  };
}

function isBlankTopology(community: CommunityContext): boolean {
  return community.topologyPreset === "blank";
}

export function getEnergyEntities(community: CommunityContext, role: UserRole | null | undefined): EnergyEntity[] {
  if (isBlankTopology(community)) {
    return [entityWithCommunity(BASE_ENTITIES[0], community)];
  }

  return BASE_ENTITIES
    .filter((entity) => !isProsumerRole(role) || PROSUMER_ENTITY_IDS.has(entity.id))
    .map((entity) => entityWithCommunity(entity, community));
}

export function getProsumerBuildingScopes(community: CommunityContext): EnergyEntity[] {
  const entities = getEnergyEntities(community, "prosumer");
  const ownScopes = entities.filter(
    (entity) =>
      entity.ownerScope === "prosumer" &&
      (entity.kind === "building" || entity.kind === "house" || entity.kind === "apartment")
  );

  if (ownScopes.length > 0) return ownScopes;

  return entities.filter((entity) => entity.kind === "building" || entity.kind === "house" || entity.kind === "apartment");
}

export function getProsumerScopeForEntity(community: CommunityContext, entityId: string): EnergyEntity {
  const scopes = getProsumerBuildingScopes(community);
  const lineage = getEntityLineage(community, "prosumer", entityId);
  return scopes.find((scope) => lineage.some((entity) => entity.id === scope.id)) || scopes[0] || getEnergyEntity(community, "prosumer", "community");
}

export function getEnergyEntity(
  community: CommunityContext,
  role: UserRole | null | undefined,
  entityId: string
): EnergyEntity {
  const entities = getEnergyEntities(community, role);
  return entities.find((entity) => entity.id === entityId) || entities.find((entity) => entity.id === "community") || entities[0];
}

export function getEnergyTree(community: CommunityContext, role: UserRole | null | undefined): EnergyTreeNode[] {
  const entities = getEnergyEntities(community, role);
  const byParent = new Map<string | null, EnergyEntity[]>();

  entities.forEach((entity) => {
    const siblings = byParent.get(entity.parentId) || [];
    siblings.push(entity);
    byParent.set(entity.parentId, siblings);
  });

  function toNode(entity: EnergyEntity): EnergyTreeNode {
    return {
      ...entity,
      children: (byParent.get(entity.id) || []).map(toNode)
    };
  }

  return (byParent.get(null) || []).map(toNode);
}

export function getEntityLineage(
  community: CommunityContext,
  role: UserRole | null | undefined,
  entityId: string
): EnergyEntity[] {
  const entities = getEnergyEntities(community, role);
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const lineage: EnergyEntity[] = [];
  let cursor: EnergyEntity | undefined = byId.get(entityId);

  while (cursor) {
    lineage.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  return lineage;
}

function seedFor(id: string): number {
  return id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function baseLoadFor(kind: EnergyEntityKind): number {
  if (kind === "community") return 1550;
  if (kind === "building") return 620;
  if (kind === "house") return 220;
  if (kind === "apartment") return 110;
  if (kind === "battery") return 38;
  if (kind === "ev") return 78;
  if (kind === "pv") return 12;
  if (kind === "solar_plant") return 28;
  if (kind === "transformer") return 1120;
  return 320;
}

function baseProductionFor(kind: EnergyEntityKind): number {
  if (kind === "community") return 1850;
  if (kind === "building") return 420;
  if (kind === "house") return 145;
  if (kind === "apartment") return 46;
  if (kind === "pv") return 180;
  if (kind === "solar_plant") return 1780;
  if (kind === "battery") return 72;
  return 0;
}

function labelForIndex(index: number, count: number, range: EnergyRange): string {
  if (range === "live") return `${String((index * 5) % 60).padStart(2, "0")}s`;
  if (range === "1h" || range === "6h") return `${String(Math.floor((index / Math.max(count - 1, 1)) * 60)).padStart(2, "0")}m`;
  if (range === "24h") return `${String(Math.floor((index / Math.max(count - 1, 1)) * 24)).padStart(2, "0")}:00`;
  if (range === "7d") return `D${index + 1}`;
  return `W${Math.floor(index / 7) + 1}`;
}

export function buildEnergySeries(entity: EnergyEntity, range: EnergyRange): EnergySeriesPoint[] {
  const count = range === "live" ? 36 : range === "1h" ? 48 : range === "6h" ? 54 : 60;
  const seed = seedFor(entity.id);
  const loadBase = baseLoadFor(entity.kind);
  const productionBase = baseProductionFor(entity.kind);

  return Array.from({ length: count }, (_, index) => {
    const t = index / Math.max(count - 1, 1);
    const dailyCurve = Math.sin(t * Math.PI);
    const ripple = Math.sin((index + seed) * 0.71) * 0.06 + Math.cos((index + seed) * 0.37) * 0.04;
    const evening = Math.max(0, Math.sin((t - 0.62) * Math.PI * 2));
    const consumption = Math.max(0, loadBase * (0.72 + evening * 0.42 + ripple));
    const production = Math.max(0, productionBase * (0.2 + dailyCurve * 0.92 + ripple));
    const importKw = Math.max(0, consumption - production) * 0.62;
    const exportKw = Math.max(0, production - consumption) * 0.55;
    const price = 0.11 + Math.max(0, Math.sin((t + 0.1) * Math.PI * 2)) * 0.08 + ripple * 0.04;
    const forecast = production * (1 + Math.sin((index + seed) * 0.17) * 0.04);

    return {
      label: labelForIndex(index, count, range),
      consumption: Math.round(consumption),
      production: Math.round(production),
      importKw: Math.round(importKw),
      exportKw: Math.round(exportKw),
      price: Number(Math.max(0.04, price).toFixed(3)),
      forecast: Math.round(forecast)
    };
  });
}

export function getEntityKpis(entity: EnergyEntity, role: UserRole | null | undefined): EnergyKpi[] {
  if (entity.kind === "community") {
    return [
      { id: "consumption", label: "Total Consumption", value: "3.65 MWh", detail: "4.2% vs prev. period", tone: "success" },
      { id: "production", label: "Total Production", value: "5.18 MWh", detail: "8.1% vs prev. period", tone: "success" },
      { id: "self", label: "Self-consumption", value: "86%", detail: "Renewable use inside community", tone: "success" },
      { id: "alerts", label: "Active Alerts", value: role === "prosumer" ? "1" : "3", detail: "1 needs acknowledgement", tone: "warning" }
    ];
  }

  if (entity.kind === "building" || entity.kind === "house" || entity.kind === "apartment") {
    return [
      { id: "consumption", label: "Consumption", value: entity.kind === "house" ? "24.5 kWh" : "148 kWh", detail: "4.2% below expected", tone: "success" },
      { id: "production", label: "Production", value: entity.kind === "house" ? "37.2 kWh" : "96 kWh", detail: "8.1% above forecast", tone: "success" },
      { id: "balance", label: "Energy Balance", value: "+12.7 kWh", detail: "Currently self-sufficient", tone: "success" },
      { id: "flex", label: "Flexibility", value: entity.kind === "house" ? "0.8 kWh" : "4.4 kWh", detail: "Available next 2h", tone: "info" }
    ];
  }

  if (entity.kind === "battery") {
    return [
      { id: "soc", label: "State of Charge", value: entity.ownerScope === "prosumer" ? "65%" : "81%", detail: "Ready for peak shaving", tone: "success" },
      { id: "current", label: "Current Power", value: "1.2 kW", detail: "Charging from local PV", tone: "info" },
      { id: "capacity", label: "Capacity", value: entity.capacity || "24.2 kWh", detail: entity.serial, tone: "neutral" },
      { id: "availability", label: "Availability", value: "Online", detail: "Last seen 5 min ago", tone: "success" }
    ];
  }

  if (entity.kind === "ev") {
    return [
      { id: "soc", label: "Vehicle SoC", value: "78%", detail: "Target 85% by 14:00", tone: "success" },
      { id: "charging", label: "Charging Power", value: "7.8 kW", detail: "Currently charging", tone: "warning" },
      { id: "energy", label: "Energy Charged", value: "13.4 kWh", detail: "Today", tone: "info" },
      { id: "flex", label: "Flexible Window", value: "08:00-14:00", detail: "Managed schedule", tone: "success" }
    ];
  }

  if (entity.kind === "pv" || entity.kind === "solar_plant") {
    return [
      { id: "power", label: "Power", value: entity.kind === "solar_plant" ? "612 kW" : "3.8 kW", detail: "Live output", tone: "success" },
      { id: "daily", label: "Daily Production", value: entity.kind === "solar_plant" ? "4.8 MWh" : "18.6 kWh", detail: "Forecast 92%", tone: "success" },
      { id: "capacity", label: "Capacity", value: entity.capacity || "4.2 kWp", detail: "Nominal", tone: "neutral" },
      { id: "availability", label: "Availability", value: "99.1%", detail: "Last 30 days", tone: "success" }
    ];
  }

  return [
    { id: "load", label: "Load", value: "72%", detail: "Normal operating range", tone: "success" },
    { id: "status", label: "Status", value: "Online", detail: "Last seen 5 min ago", tone: "success" },
    { id: "capacity", label: "Capacity", value: "1.2 MW", detail: "Rated", tone: "neutral" },
    { id: "events", label: "Events", value: "0", detail: "No critical issues", tone: "success" }
  ];
}

export function getTopology(
  community: CommunityContext,
  role: UserRole | null | undefined
): { nodes: Array<TopologyNode & { entity: EnergyEntity }>; edges: TopologyEdge[] } {
  const entities = getEnergyEntities(community, role);
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const nodes = TOPOLOGY_NODES
    .filter((node) => byId.has(node.id))
    .map((node) => ({ ...node, entity: byId.get(node.id) as EnergyEntity }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = TOPOLOGY_EDGES.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  return { nodes, edges };
}

function event(id: string, minutesAgo: number, level: LogEntry["level"], source: string, entity: string, message: string): LogEntry {
  return {
    id,
    timestamp: Date.now() - minutesAgo * 60_000,
    level,
    source,
    entity,
    message
  };
}

export function getEnergyLogs(role: UserRole | null | undefined): LogEntry[] {
  const logs = [
    event("evt-001", 3, "info", "telemetry", "House 1", "Live meter packet received from prosumer gateway."),
    event("evt-002", 8, "warning", "ev-orchestrator", "EV Charger", "Charging window shifted to avoid import peak."),
    event("evt-003", 14, "info", "pricing", "Solar Community", "Day-ahead price forecast updated."),
    event("evt-004", 21, "info", "battery-controller", "Battery Bank", "Battery entered self-consumption mode."),
    event("evt-005", 34, "warning", "asset-health", "Apartment 2", "Meter heartbeat delayed for 2 intervals."),
    event("evt-006", 51, "debug", "topology", "Main Transformer", "Topology solver recalculated feeder balance."),
    event("evt-007", 74, "error", "gateway", "River Grid", "Remote gateway disconnected from telemetry broker.")
  ];

  if (isProsumerRole(role)) {
    const allowed = new Set(["House 1", "EV Charger", "Battery Bank", "Solar Community"]);
    return logs.filter((item) => allowed.has(item.entity || "") && item.level !== "debug");
  }

  return logs;
}

export function formatPower(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} MW`;
  return `${Math.round(value)} kW`;
}
