import type {
  ComparedKpiRow,
  KpiEntry,
  KpiImprovementTone,
  KpiMatrixRow,
  SimulationDataFileEntry,
  SimulationFileKind,
  SimulationSeries,
  SimulationSeriesPoint,
  SimulationTreeNode
} from "../types";
import type { ChargerStateSample } from "./chargerActivity";
import Papa from "papaparse";

type UnknownRecord = Record<string, unknown>;

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toTitle(input: string): string {
  return input
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (chunk) => chunk.toUpperCase());
}

function normalizeToken(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeSiteId(input: string): string {
  return normalizeToken(input);
}

function isLikelyElectricVehicleEntity(entity: string): boolean {
  const normalized = normalizeToken(entity);
  if (!normalized) return false;
  return (
    normalized.startsWith("electric_vehicle_") ||
    normalized.startsWith("ev_") ||
    normalized.startsWith("vehicle_")
  );
}

function toVehicleId(entity: string): string {
  const normalized = normalizeToken(entity);
  return (
    normalized
      .replace(/^electric_vehicle_/, "")
      .replace(/^ev_/, "")
      .replace(/^vehicle_/, "") || normalized
  );
}

function isKnownNamedSite(entity: string): boolean {
  const normalized = normalizeSiteId(entity);
  if (!normalized) return false;
  if (normalized === "hq" || normalized === "boavista") return true;
  if (normalized === "sao_mamede" || normalized === "saomamede") return true;
  if (/^r_h_\d+$/i.test(normalized) || /^rh\d+$/i.test(normalized)) return true;
  return false;
}

export function inferMetricUnit(metric: string): string | undefined {
  const key = metric.toLowerCase();
  if (key.includes("kg_co2") || key.includes("co2")) return "kgCO2";
  if (key.includes("percent") || key.includes("pct") || key.includes("soc")) return "%";
  if (key.includes("price") || key.includes("cost") || key.includes("-$") || key.includes("eur")) return "€";
  if (key.includes("kwh")) return "kWh";
  if (key.includes("kw")) return "kW";
  return undefined;
}

export function parseSimulationDataFile(relativePath: string): SimulationDataFileEntry {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const fileName = segments[segments.length - 1] || normalized;
  const runFolder = segments.length > 1 ? segments[0] : null;
  const baseName = fileName.replace(/\.csv$/i, "");
  const lower = baseName.toLowerCase();
  const episodeMatch = lower.match(/_ep(\d+)$/);
  const episode = episodeMatch ? `ep${episodeMatch[1]}` : null;
  const trimmed = baseName.replace(/_ep\d+$/i, "");

  if (/^exported_kpis$/i.test(trimmed)) {
    return {
      id: normalized,
      relativePath: normalized,
      fileName,
      runFolder,
      episode,
      kind: "kpi"
    };
  }

  const entity = trimmed.replace(/^exported_data_/i, "");
  let kind: SimulationFileKind = "unknown";
  let buildingId: string | undefined;
  let chargerId: string | undefined;
  let vehicleId: string | undefined;

  if (/^community$/i.test(entity)) {
    kind = "community";
  } else {
    const buildingChargerMatch = entity.match(/^building_(\d+)_charger_(\d+_\d+)$/i);
    const buildingBatteryMatch = entity.match(/^building_(\d+)_battery$/i);
    const buildingMatch = entity.match(/^building_(\d+)$/i);
    const evMatch = entity.match(/^electric_vehicle_(\d+)$/i);
    const siteChargerMatch = entity.match(/^(.+?)_charger_(.+)$/i);
    const siteBatteryMatch = entity.match(/^(.+?)_battery$/i);

    if (buildingChargerMatch) {
      kind = "charger";
      buildingId = buildingChargerMatch[1];
      chargerId = buildingChargerMatch[2];
    } else if (buildingBatteryMatch) {
      kind = "battery";
      buildingId = buildingBatteryMatch[1];
    } else if (buildingMatch) {
      kind = "building";
      buildingId = buildingMatch[1];
    } else if (siteChargerMatch) {
      kind = "charger";
      buildingId = normalizeSiteId(siteChargerMatch[1]);
      chargerId = normalizeToken(siteChargerMatch[2]);
    } else if (siteBatteryMatch) {
      kind = "battery";
      buildingId = normalizeSiteId(siteBatteryMatch[1]);
    } else if (evMatch) {
      kind = "electric_vehicle";
      vehicleId = evMatch[1];
    } else if (isLikelyElectricVehicleEntity(entity)) {
      kind = "electric_vehicle";
      vehicleId = toVehicleId(entity);
    } else if (isKnownNamedSite(entity)) {
      kind = "building";
      buildingId = normalizeSiteId(entity);
    } else if (/^pricing$/i.test(entity)) {
      kind = "pricing";
    }
  }

  return {
    id: normalized,
    relativePath: normalized,
    fileName,
    runFolder,
    episode,
    kind,
    buildingId,
    chargerId,
    vehicleId
  };
}

function sortByLabel<T extends { label: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.label.localeCompare(b.label));
}

function sortByLeadingNumber<T extends { label: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const numA = Number((a.label.match(/\d+/) || ["0"])[0]);
    const numB = Number((b.label.match(/\d+/) || ["0"])[0]);
    if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) {
      return numA - numB;
    }
    return a.label.localeCompare(b.label);
  });
}

function formatBuildingLabel(buildingId: string): string {
  const normalized = normalizeSiteId(buildingId);
  if (!normalized || normalized === "unknown") return "Building";

  if (/^\d+$/.test(normalized)) {
    return `Building ${Number(normalized)}`;
  }

  if (normalized === "hq" || normalized === "boavista") return "Boavista (HQ)";
  if (normalized === "sao_mamede" || normalized === "saomamede") return "Sao Mamede";

  const rhMatch = normalized.match(/^r_h_(\d+)$/i) || normalized.match(/^rh(\d+)$/i);
  if (rhMatch) {
    return `R-H-${rhMatch[1]!.padStart(2, "0")}`;
  }

  return toTitle(buildingId);
}

function formatChargerLabel(chargerId: string | undefined): string {
  if (!chargerId) return "Charger";
  if (/^\d+_\d+$/.test(chargerId)) return `Charger ${chargerId}`;
  const titled = toTitle(chargerId).replace(/\bHq\b/g, "HQ");
  return `Charger ${titled}`;
}

function leafNode(
  id: string,
  label: string,
  kind: SimulationTreeNode["kind"],
  fileRef: string
): SimulationTreeNode {
  return {
    id,
    label,
    kind,
    selectable: true,
    fileRefs: [fileRef],
    children: []
  };
}

function enrichFileRefs(node: SimulationTreeNode): SimulationTreeNode {
  if (node.children.length === 0) return node;
  const enrichedChildren = node.children.map((child) => {
    return enrichFileRefs(child);
  });

  if (node.kind !== "root" && node.kind !== "group") {
    return {
      ...node,
      children: enrichedChildren
    };
  }

  const refs = new Set<string>(node.fileRefs);
  enrichedChildren.forEach((child) => {
    child.fileRefs.forEach((ref) => refs.add(ref));
  });

  return {
    ...node,
    children: enrichedChildren,
    fileRefs: Array.from(refs)
  };
}

export function buildSimulationTree(files: SimulationDataFileEntry[]): SimulationTreeNode {
  const dataFiles = filterFilesToLatestEpisode(files).filter((file) => file.kind !== "kpi");
  const communityLeaves: SimulationTreeNode[] = [];
  const pricingLeaves: SimulationTreeNode[] = [];
  const evLeaves: SimulationTreeNode[] = [];
  const unknownLeaves: SimulationTreeNode[] = [];
  const buildings = new Map<
    string,
    {
      buildingFiles: string[];
      batteries: SimulationTreeNode[];
      chargers: SimulationTreeNode[];
    }
  >();

  dataFiles.forEach((file) => {
    if (file.kind === "community") {
      communityLeaves.push(leafNode(`leaf:${file.relativePath}`, "Community", "community", file.relativePath));
      return;
    }

    if (file.kind === "pricing") {
      pricingLeaves.push(leafNode(`leaf:${file.relativePath}`, "Pricing", "pricing", file.relativePath));
      return;
    }

    if (file.kind === "electric_vehicle") {
      const label = file.vehicleId ? `EV ${toTitle(file.vehicleId)}` : toTitle(file.fileName);
      evLeaves.push(leafNode(`leaf:${file.relativePath}`, label, "electric_vehicle", file.relativePath));
      return;
    }

    if (file.kind === "building" || file.kind === "battery" || file.kind === "charger") {
      const buildingId = file.buildingId || "unknown";
      const entry = buildings.get(buildingId) || { buildingFiles: [], batteries: [], chargers: [] };

      if (file.kind === "building") {
        entry.buildingFiles.push(file.relativePath);
      } else if (file.kind === "battery") {
        entry.batteries.push(
          leafNode(`leaf:${file.relativePath}`, "Battery", "battery", file.relativePath)
        );
      } else if (file.kind === "charger") {
        const label = formatChargerLabel(file.chargerId);
        entry.chargers.push(
          leafNode(`leaf:${file.relativePath}`, label, "charger", file.relativePath)
        );
      }

      buildings.set(buildingId, entry);
      return;
    }

    unknownLeaves.push(leafNode(`leaf:${file.relativePath}`, toTitle(file.fileName), "unknown", file.relativePath));
  });

  const buildingNodes: SimulationTreeNode[] = sortByLabel(
    Array.from(buildings.entries()).map(([buildingId, value]) => {
      const children: SimulationTreeNode[] = [];
      children.push(...sortByLabel(value.batteries));
      children.push(...sortByLabel(value.chargers));
      return {
        id: `building:${buildingId}`,
        label: formatBuildingLabel(buildingId),
        kind: "building",
        selectable: true,
        fileRefs: [...value.buildingFiles],
        children
      };
    })
  );

  const rootChildren: SimulationTreeNode[] = [];

  void communityLeaves;

  rootChildren.push(...sortByLeadingNumber(buildingNodes));

  if (evLeaves.length > 0) {
    rootChildren.push({
      id: "group:electric-vehicles",
      label: "Electric Vehicles",
      kind: "group",
      selectable: true,
      fileRefs: [],
      children: sortByLeadingNumber(evLeaves)
    });
  }

  if (unknownLeaves.length > 0) {
    rootChildren.push({
      id: "group:other-assets",
      label: "Other Assets",
      kind: "group",
      selectable: true,
      fileRefs: [],
      children: sortByLabel(unknownLeaves)
    });
  }

  void pricingLeaves;

  return enrichFileRefs({
    id: "root",
    label: "Simulation",
    kind: "root",
    selectable: true,
    fileRefs: [],
    children: rootChildren
  });
}

export function flattenTreeNodes(root: SimulationTreeNode): SimulationTreeNode[] {
  const output: SimulationTreeNode[] = [];
  function walk(node: SimulationTreeNode): void {
    output.push(node);
    node.children.forEach(walk);
  }
  walk(root);
  return output;
}

export function listEpisodes(files: SimulationDataFileEntry[]): string[] {
  const values = new Set<string>();
  files.forEach((file) => {
    if (file.episode) values.add(file.episode);
  });
  return Array.from(values).sort((a, b) => {
    const numA = Number(a.replace(/^ep/i, ""));
    const numB = Number(b.replace(/^ep/i, ""));
    if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;
    return a.localeCompare(b);
  });
}

export function latestEpisode(files: SimulationDataFileEntry[]): string | null {
  const episodes = listEpisodes(files);
  if (episodes.length === 0) return null;
  return episodes[episodes.length - 1];
}

export function filterFilesToLatestEpisode(files: SimulationDataFileEntry[]): SimulationDataFileEntry[] {
  const episode = latestEpisode(files);
  if (!episode) return files;
  return files.filter((file) => file.episode === null || file.episode === episode);
}

export function filterFileRefsByEpisode(
  fileRefs: string[],
  files: SimulationDataFileEntry[],
  episode: string | null
): string[] {
  if (!episode) return fileRefs;
  const byPath = new Map(files.map((file) => [file.relativePath, file]));
  return fileRefs.filter((fileRef) => {
    const file = byPath.get(fileRef);
    return !file || file.episode === null || file.episode === episode;
  });
}

const filePriorityMatchers: Array<{ regex: RegExp; score: number }> = [
  { regex: /community/i, score: 0 },
  { regex: /building_\d+_ep/i, score: 1 },
  { regex: /battery/i, score: 2 },
  { regex: /charger/i, score: 3 },
  { regex: /electric_vehicle/i, score: 4 },
  { regex: /pricing/i, score: 5 }
];

function scoreFilePriority(fileRef: string): number {
  for (const matcher of filePriorityMatchers) {
    if (matcher.regex.test(fileRef)) return matcher.score;
  }
  return 9;
}

export function pickFeaturedFileRefs(fileRefs: string[], limit = 4): string[] {
  return [...fileRefs]
    .sort((a, b) => {
      const score = scoreFilePriority(a) - scoreFilePriority(b);
      if (score !== 0) return score;
      return a.localeCompare(b);
    })
    .slice(0, limit);
}

function parseCsvRows(content: string): UnknownRecord[] {
  const parsed = Papa.parse<UnknownRecord>(content, {
    header: true,
    skipEmptyLines: true
  });
  return parsed.data.filter((row) => Object.values(row).some((value) => String(value || "").trim() !== ""));
}

function resolveTimestampEpoch(value: unknown): number | null {
  if (typeof value === "number") {
    return value > 9999999999 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber > 9999999999 ? asNumber : asNumber * 1000;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeChargerState(value: number): 0 | 1 | 2 {
  const rounded = Math.round(value);
  if (rounded === 1 || rounded === 2) return rounded;
  return 0;
}

export function extractChargerStateSamples(content: string): ChargerStateSample[] {
  const rows = parseCsvRows(content);
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0] || {});
  if (headers.length === 0) return [];

  const timestampHeader = headers.find((header) => /timestamp|time|date/i.test(header)) || headers[0];
  const stateHeader =
    headers.find((header) => /ev\s*charger\s*state/i.test(header)) ||
    headers.find((header) => /charger[_\s-]*state/i.test(header));
  const isConnectedHeader = headers.find((header) => /is[_\s-]*ev[_\s-]*connected/i.test(header));
  const incomingEvHeader = headers.find((header) => /incoming[_\s-]*ev[_\s-]*name/i.test(header));
  const evNameHeader = headers.find((header) => /^ev[_\s-]*name$/i.test(header));

  if (!stateHeader && !isConnectedHeader) return [];

  return rows
    .map((row, index) => {
      let stateValue = stateHeader ? asNumber(row[stateHeader]) : null;
      if (stateValue === null && isConnectedHeader) {
        const rawConnected = row[isConnectedHeader];
        if (typeof rawConnected === "boolean") {
          stateValue = rawConnected ? 1 : 0;
        } else if (typeof rawConnected === "string") {
          const normalized = rawConnected.trim().toLowerCase();
          if (normalized === "true" || normalized === "yes" || normalized === "1") {
            stateValue = 1;
          } else if (normalized === "false" || normalized === "no" || normalized === "0") {
            stateValue = 0;
          } else {
            const asNumeric = asNumber(rawConnected);
            stateValue = asNumeric === null ? null : asNumeric > 0 ? 1 : 0;
          }
        } else if (typeof rawConnected === "number") {
          stateValue = rawConnected > 0 ? 1 : 0;
        }
      }

      if (stateValue === null) return null;

      const timestampValue = row[timestampHeader] ?? index;
      const epochMs = resolveTimestampEpoch(timestampValue);
      if (epochMs === null || !Number.isFinite(epochMs)) return null;

      return {
        timestamp: String(timestampValue),
        epochMs,
        chargerState: normalizeChargerState(stateValue),
        incomingEvName: incomingEvHeader ? normalizeText(row[incomingEvHeader]) : null,
        evName: evNameHeader ? normalizeText(row[evNameHeader]) : null
      } satisfies ChargerStateSample;
    })
    .filter((item): item is ChargerStateSample => Boolean(item))
    .sort((left, right) => left.epochMs - right.epochMs);
}

export function loadSimulationCsv(content: string, fileRef: string): SimulationSeries[] {
  const rows = parseCsvRows(content);
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0] || {});
  if (headers.length === 0) return [];

  const timestampHeader =
    headers.find((header) => /timestamp|time|date/i.test(header)) || headers[0];

  const metricHeaders = headers.filter((header) => header !== timestampHeader);
  return metricHeaders
    .map((header) => {
      const points: SimulationSeriesPoint[] = rows
        .map((row, index) => {
          const numeric = asNumber(row[header]);
          if (numeric === null) return null;
          const timestampValue = row[timestampHeader] ?? index;
          return {
            timestamp: String(timestampValue),
            epochMs: resolveTimestampEpoch(timestampValue),
            value: numeric
          };
        })
        .filter((item): item is SimulationSeriesPoint => Boolean(item));

      if (points.length < 2) return null;

      return {
        id: `${fileRef}::${header}`,
        fileRef,
        metric: header,
        unit: inferMetricUnit(header),
        points
      } as SimulationSeries;
    })
    .filter((item): item is SimulationSeries => Boolean(item));
}

export interface ParsedKpiCsv {
  rows: KpiMatrixRow[];
  entries: KpiEntry[];
  entities: string[];
}

function inferKpiUnit(key: string): string | undefined {
  const normalized = key.toLowerCase();
  if (normalized.includes("percent") || normalized.includes("rate") || normalized.includes("ratio")) return "%";
  if (normalized.includes("cost") || normalized.includes("price") || normalized.includes("eur")) return "€";
  if (normalized.includes("kg_co2") || normalized.includes("co2")) return "kgCO2";
  if (normalized.includes("kwh")) return "kWh";
  if (normalized.includes("kw")) return "kW";
  return undefined;
}

export function extractKpisFromSimulationData(content: string): ParsedKpiCsv {
  const rows = parseCsvRows(content);
  if (rows.length === 0) return { rows: [], entries: [], entities: [] };

  const headers = Object.keys(rows[0] || {});
  if (headers.length <= 1) return { rows: [], entries: [], entities: [] };

  const kpiHeader = headers[0];
  const entities = headers.slice(1);
  const matrixRows: KpiMatrixRow[] = [];
  const entries: KpiEntry[] = [];

  rows.forEach((row, rowIndex) => {
    const rawKey = row[kpiHeader];
    const key = String(rawKey || `kpi_${rowIndex + 1}`).trim();
    if (!key) return;

    const values: Record<string, number | null> = {};
    entities.forEach((entity) => {
      const numeric = asNumber(row[entity]);
      values[entity] = numeric;
      if (numeric !== null) {
        entries.push({
          key: `${key}::${entity}`,
          label: `${toTitle(key)} - ${toTitle(entity)}`,
          value: numeric,
          unit: inferKpiUnit(key),
          source: entity
        });
      }
    });

    matrixRows.push({
      key,
      label: toTitle(key),
      unit: inferKpiUnit(key),
      values
    });
  });

  return {
    rows: matrixRows,
    entries: entries.sort((a, b) => a.label.localeCompare(b.label)),
    entities
  };
}

const lowerIsBetterMatchers = [
  /cost/i,
  /price/i,
  /emission/i,
  /co2/i,
  /consumption/i,
  /import/i,
  /export/i,
  /violation/i,
  /unserved/i,
  /peak/i,
  /ramping/i,
  /discomfort/i
];

const higherIsBetterMatchers = [
  /success/i,
  /rate/i,
  /autonomy/i,
  /self[_\s-]?consumption/i,
  /renewable/i,
  /saving/i,
  /reward/i,
  /score/i
];

export function scoreKpiImprovement(key: string, deltaAbs: number | null): KpiImprovementTone {
  if (deltaAbs === null || Number.isNaN(deltaAbs)) return "unknown";
  if (Math.abs(deltaAbs) < 1e-9) return "neutral";

  if (lowerIsBetterMatchers.some((matcher) => matcher.test(key))) {
    return deltaAbs < 0 ? "better" : "worse";
  }

  if (higherIsBetterMatchers.some((matcher) => matcher.test(key))) {
    return deltaAbs > 0 ? "better" : "worse";
  }

  return "unknown";
}

export function buildComparedKpis(
  leftEntries: KpiEntry[],
  rightEntries: KpiEntry[],
  showAll: boolean
): ComparedKpiRow[] {
  const leftMap = new Map(leftEntries.map((entry) => [entry.key, entry]));
  const rightMap = new Map(rightEntries.map((entry) => [entry.key, entry]));
  const keySet = new Set<string>();

  if (showAll) {
    leftMap.forEach((_, key) => keySet.add(key));
    rightMap.forEach((_, key) => keySet.add(key));
  } else {
    leftMap.forEach((_, key) => {
      if (rightMap.has(key)) keySet.add(key);
    });
  }

  return Array.from(keySet)
    .map((key) => {
      const left = leftMap.get(key)?.value ?? null;
      const right = rightMap.get(key)?.value ?? null;
      const deltaAbs = left !== null && right !== null ? right - left : null;
      const deltaPct =
        left !== null && right !== null && left !== 0 ? ((right - left) / Math.abs(left)) * 100 : null;
      const tone = scoreKpiImprovement(key, deltaAbs);
      return {
        key,
        label: leftMap.get(key)?.label || rightMap.get(key)?.label || toTitle(key),
        left,
        right,
        deltaAbs,
        deltaPct,
        tone
      } satisfies ComparedKpiRow;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
