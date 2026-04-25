import type { DeployLogsHistoryLine } from "../api/deployApi";
import type { SimulationSeries, SimulationSeriesPoint } from "../types";

export type DeployChartMode = "live" | "history";

export type DeployAssetKind = "charger" | "solar" | "battery" | "ev" | "grid" | "pricing" | "community" | "other";

export interface DeployAssetDefinition {
  id: string;
  label: string;
  kind: DeployAssetKind;
}

export interface DeploySiteProfile {
  id: string;
  label: string;
  assets: DeployAssetDefinition[];
}

export interface ParsedLogSample {
  timestamp: string;
  epochMs: number;
  source: "rbc.summary" | "rbc.actions" | "request.completed";
  assetId: string;
  assetLabel: string;
  assetKind: DeployAssetKind;
  metricKey: string;
  metricLabel: string;
  unit?: string;
  value: number;
}

export interface DeployChartSeries extends SimulationSeries {
  assetId: string;
  assetLabel: string;
  assetKind: DeployAssetKind;
}

export interface DeployMetricLeaf {
  id: string;
  label: string;
  unit?: string;
  seriesId: string;
}

export interface DeployAssetTreeNode extends DeployAssetDefinition {
  hasData: boolean;
  seriesIds: string[];
  metrics: DeployMetricLeaf[];
}

export interface AvailabilityInterval {
  startEpochMs: number;
  endEpochMs: number;
}

const ISO_TS_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+\-]\d{2}:?\d{2})?/;
const ISO_WITHOUT_TZ_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?$/;
const ISO_HAS_TZ_RE = /(Z|[+\-]\d{2}:?\d{2})$/i;
const KEY_VALUE_RE = /["']?([a-zA-Z][a-zA-Z0-9_.\-/]{1,80})["']?\s*[:=]\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
const CHARGER_ID_RE = /(?:charger|evse|cp)(?:[_\- ]?)([a-z0-9]{1,8})/i;
const PHASE_HEADER_RE = /^\s*l([123])\s*-\s*/i;
const CHARGER_LINE_RE = /^\s*([A-Z][A-Z0-9_]{3,})\s*-\s*(.+)$/;
const INFERENCE_CYCLE_RE = /inference cycle/i;
const INLINE_UNIT_RE = /^\s*(kwh|kw|wh|w|mwh|mw|eur\/kwh|eur\/mwh|ceur\/kwh|eur|kgco2|percent|ratio|count|c)\b/i;

const HQ_ASSETS: DeployAssetDefinition[] = [
  { id: "chargers", label: "Chargers", kind: "charger" },
  { id: "solar", label: "Solar", kind: "solar" },
  { id: "pricing", label: "Prices", kind: "pricing" },
  { id: "community", label: "Community", kind: "community" }
];

const SAO_MAMEDE_ASSETS: DeployAssetDefinition[] = [
  { id: "chargers", label: "Chargers", kind: "charger" },
  { id: "solar", label: "Solar", kind: "solar" },
  { id: "battery", label: "Battery", kind: "battery" },
  { id: "pricing", label: "Prices", kind: "pricing" },
  { id: "community", label: "Community", kind: "community" }
];

const RH01_ASSETS: DeployAssetDefinition[] = [
  { id: "chargers", label: "Chargers", kind: "charger" },
  { id: "solar", label: "Solar", kind: "solar" },
  { id: "battery", label: "Battery", kind: "battery" },
  { id: "grid", label: "Grid", kind: "grid" },
  { id: "pricing", label: "Prices", kind: "pricing" },
  { id: "community", label: "Community", kind: "community" }
];

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function titleFromToken(token: string): string {
  const cleaned = normalizeToken(token);
  if (!cleaned) return "Metric";
  return cleaned
    .split("_")
    .filter(Boolean)
    .map((part) => {
      if (/^l[123]$/.test(part)) return part.toUpperCase();
      if (part === "soc") return "SoC";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function normalizeTargetId(targetId: string): string {
  const normalized = normalizeToken(targetId);
  if (["hq", "boavista"].includes(normalized)) return "hq";
  if (["sm", "sao_mamede", "sao_mamed", "saomamede", "sao_mamede_inference"].includes(normalized)) {
    return "sao_mamede";
  }
  if (["rh01", "rh1", "rh_01", "rh_1", "r_h_01", "r_h_1", "r_h01", "r_h1"].includes(normalized)) return "rh01";
  return normalized;
}

export function resolveDeploySiteLabel(targetId: string, targetName?: string | null): string {
  const normalized = normalizeTargetId(targetId);
  if (normalized === "hq") return "Boavista (HQ)";
  if (normalized === "sao_mamede") return "Sao Mamede";
  if (normalized === "rh01") return "R-H-01";
  return targetName?.trim() || targetId;
}

export function resolveDeploySiteProfile(targetId: string, targetName?: string | null): DeploySiteProfile {
  const normalized = normalizeTargetId(targetId);
  if (normalized === "hq") {
    return {
      id: "hq",
      label: "Boavista (HQ)",
      assets: HQ_ASSETS
    };
  }

  if (normalized === "sao_mamede") {
    return {
      id: "sao_mamede",
      label: "Sao Mamede",
      assets: SAO_MAMEDE_ASSETS
    };
  }

  if (normalized === "rh01") {
    return {
      id: "rh01",
      label: "R-H-01",
      assets: RH01_ASSETS
    };
  }

  return {
    id: normalized || "deploy",
    label: targetName?.trim() || targetId,
    assets: HQ_ASSETS
  };
}

function detectSourceType(text: string, lineSource?: string | null): ParsedLogSample["source"] | null {
  const normalized = `${String(text || "")} ${String(lineSource || "")}`.toLowerCase();
  if (normalized.includes("rbc.summary")) return "rbc.summary";
  if (normalized.includes("rbc_summary")) return "rbc.summary";
  if (normalized.includes("rbc.actions")) return "rbc.actions";
  if (normalized.includes("rbc_actions")) return "rbc.actions";
  if (normalized.includes("request.completed")) return "request.completed";
  if (normalized.includes("request_completed")) return "request.completed";
  return null;
}

function parseTimestampEpoch(raw: string): number | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  if (/^\d{13}$/.test(trimmed)) {
    const epochMs = Number(trimmed);
    return Number.isFinite(epochMs) ? epochMs : null;
  }

  if (/^\d{10}(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds)) return null;
    return Math.round(seconds * 1000);
  }

  let normalized = trimmed.replace(" ", "T");
  normalized = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d+)/, "$1.$2");
  if (!ISO_HAS_TZ_RE.test(normalized) && ISO_WITHOUT_TZ_RE.test(normalized)) {
    normalized = `${normalized}Z`;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function resolveTimestamp(line: DeployLogsHistoryLine): string | null {
  if (line.ts) {
    const parsed = parseTimestampEpoch(line.ts);
    if (parsed !== null) return new Date(parsed).toISOString();
  }

  const match = String(line.text || "").match(ISO_TS_RE);
  if (!match) return null;
  const parsed = parseTimestampEpoch(match[0]);
  if (parsed === null) return null;
  return new Date(parsed).toISOString();
}

function detectUnit(key: string): string | undefined {
  const normalized = normalizeToken(key);
  if (normalized.endsWith("_kw") || normalized.includes("_kw_")) return "kW";
  if (normalized.endsWith("_kwh") || normalized.includes("_kwh_")) return "kWh";
  if (normalized.endsWith("_w") || normalized.includes("_w_")) return "W";
  if (normalized.endsWith("_wh") || normalized.includes("_wh_")) return "Wh";
  if (normalized.endsWith("_mw") || normalized.includes("_mw_")) return "MW";
  if (normalized.endsWith("_mwh") || normalized.includes("_mwh_")) return "MWh";
  if (normalized.endsWith("_eur") || normalized.includes("price") || normalized.includes("tariff")) return "EUR";
  if (normalized.endsWith("_ratio") || normalized.endsWith("_percent") || normalized.endsWith("_pct")) return "%";
  if (normalized.endsWith("_count") || normalized.includes("_events")) return "count";
  return undefined;
}

function normalizeUnitToken(raw: string): string | undefined {
  const value = normalizeToken(raw);
  const compactRaw = String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
  if (value === "kw") return "kW";
  if (value === "kwh") return "kWh";
  if (value === "w") return "W";
  if (value === "wh") return "Wh";
  if (value === "mw") return "MW";
  if (value === "mwh") return "MWh";
  if (value === "eur_kwh" || compactRaw === "€/kwh") return "EUR/kWh";
  if (value === "eur_mwh" || compactRaw === "€/mwh") return "EUR/MWh";
  if (value === "ceur_kwh" || compactRaw === "c€/kwh") return "cEUR/kWh";
  if (value === "eur") return "EUR";
  if (value === "kgco2") return "kgCO2";
  if (value === "percent") return "%";
  if (value === "ratio") return "ratio";
  if (value === "count") return "count";
  if (value === "c") return "C";
  if (raw === "%") return "%";
  return undefined;
}

function detectInlineUnit(text: string, afterIndex: number): string | undefined {
  const suffix = text.slice(afterIndex, afterIndex + 18);
  if (/^\s*%/.test(suffix)) return "%";
  const unitMatch = suffix.match(INLINE_UNIT_RE);
  if (!unitMatch) return undefined;
  return normalizeUnitToken(unitMatch[1]);
}

function detectPriceDefaultUnit(text: string): string {
  const match = text.match(/^prices\s*\(([^)]+)\)/i);
  if (!match?.[1]) return "EUR/kWh";
  return normalizeUnitToken(match[1]) || "EUR/kWh";
}

function classifyAsset(key: string): {
  assetId: string;
  assetLabel: string;
  assetKind: DeployAssetKind;
} {
  const normalized = normalizeToken(key);

  if (
    normalized.includes("community_battery") ||
    normalized.includes("virtual_battery") ||
    normalized.includes("battery_virtual")
  ) {
    return { assetId: "community", assetLabel: "Community", assetKind: "community" };
  }

  if (
    normalized === "community" ||
    normalized.startsWith("community_") ||
    normalized.includes("_community_") ||
    normalized.includes("community_in") ||
    normalized.includes("community_out") ||
    normalized.includes("community_net") ||
    normalized.includes("community_flex")
  ) {
    return { assetId: "community", assetLabel: "Community", assetKind: "community" };
  }

  if (normalized.includes("price") || normalized.includes("tariff") || normalized.includes("omie")) {
    return { assetId: "pricing", assetLabel: "Prices", assetKind: "pricing" };
  }

  if (normalized.includes("phase_l1") || normalized.includes("phase_l2") || normalized.includes("phase_l3")) {
    return { assetId: "grid", assetLabel: "Grid", assetKind: "grid" };
  }

  if (
    normalized.includes("grid") ||
    normalized.includes("meter_in") ||
    normalized.includes("meter_out") ||
    normalized.includes("meter_net") ||
    normalized.includes("import") ||
    normalized.includes("export") ||
    normalized.includes("runtime_limit") ||
    normalized.includes("manifest_limit") ||
    normalized.includes("board_effective") ||
    normalized.includes("per_line_effective") ||
    normalized.includes("phase") ||
    normalized.includes("l1") ||
    normalized.includes("l2") ||
    normalized.includes("l3")
  ) {
    return { assetId: "grid", assetLabel: "Grid", assetKind: "grid" };
  }

  if (normalized.includes("solar") || normalized.includes("pv")) {
    return { assetId: "solar", assetLabel: "Solar", assetKind: "solar" };
  }

  if (
    normalized.includes("commanded_total") ||
    normalized.includes("connected_total") ||
    normalized.includes("unmanaged")
  ) {
    return { assetId: "community", assetLabel: "Community", assetKind: "community" };
  }

  if (normalized.includes("battery")) {
    return { assetId: "battery", assetLabel: "Battery", assetKind: "battery" };
  }

  if (normalized.includes("non_controllable") || normalized.includes("uncontrollable") || normalized.includes("uncontrolled")) {
    return { assetId: "chargers_uncontrollable", assetLabel: "Uncontrollable Chargers", assetKind: "charger" };
  }

  if (normalized.includes("controllable") || normalized.includes("controlled")) {
    return { assetId: "chargers_controllable", assetLabel: "Controllable Chargers", assetKind: "charger" };
  }

  if (normalized.includes("charger") || normalized.includes("evse") || normalized.includes("chargepoint")) {
    const entityMatch = normalized.match(CHARGER_ID_RE);
    if (entityMatch?.[1]) {
      const suffix = entityMatch[1].toUpperCase();
      return {
        assetId: `charger_${normalizeToken(entityMatch[1])}`,
        assetLabel: `Charger ${suffix}`,
        assetKind: "charger"
      };
    }
    return { assetId: "chargers", assetLabel: "Chargers", assetKind: "charger" };
  }

  if (normalized.includes("vehicle") || normalized.includes("ev_") || normalized.startsWith("ev") || normalized.includes("departure")) {
    return { assetId: "ev", assetLabel: "EV", assetKind: "ev" };
  }

  return { assetId: "other", assetLabel: "Other", assetKind: "other" };
}

function metricLabelFromKey(key: string, asset: { assetId: string }): string {
  const normalized = normalizeToken(key);
  if (!normalized) return "Metric";

  const stripped = normalized
    .replace(/^rbc_/, "")
    .replace(/^summary_/, "")
    .replace(/^actions_/, "")
    .replace(/^request_/, "")
    .replace(new RegExp(`^${asset.assetId}_`), "")
    .replace(/^community_battery_/, "")
    .replace(/^virtual_battery_/, "")
    .replace(/^battery_/, "")
    .replace(/^charger_/, "")
    .replace(/^chargers_/, "")
    .replace(/^grid_/, "")
    .replace(/^solar_/, "")
    .replace(/^ev_/, "")
    .replace(/^pricing_/, "")
    .replace(/^price_/, "")
    .replace(/^tariff_/, "");

  return titleFromToken(stripped || normalized);
}

function toPoint(point: SimulationSeriesPoint, nextValue: number): SimulationSeriesPoint {
  return {
    timestamp: point.timestamp,
    epochMs: point.epochMs,
    value: nextValue
  };
}

export function parseDeployLogSamples(lines: DeployLogsHistoryLine[]): ParsedLogSample[] {
  const samples: ParsedLogSample[] = [];
  let lastTimestamp: string | null = null;
  let lastEpochMs: number | null = null;
  let currentPhase: "l1" | "l2" | "l3" | null = null;

  function pushSample(input: {
    timestamp: string;
    epochMs: number;
    source: ParsedLogSample["source"];
    assetId: string;
    assetLabel: string;
    assetKind: DeployAssetKind;
    metricKey: string;
    metricLabel: string;
    unit?: string;
    value: number;
  }): void {
    if (!Number.isFinite(input.value)) return;
    samples.push({
      timestamp: input.timestamp,
      epochMs: input.epochMs,
      source: input.source,
      assetId: input.assetId,
      assetLabel: input.assetLabel,
      assetKind: input.assetKind,
      metricKey: input.metricKey,
      metricLabel: input.metricLabel,
      unit: input.unit,
      value: input.value
    });
  }

  function appendKeyValueMatches(input: {
    text: string;
    timestamp: string;
    epochMs: number;
    source: ParsedLogSample["source"];
    forceAsset?: { assetId: string; assetLabel: string; assetKind: DeployAssetKind };
    keyPrefix?: string;
    metricSuffix?: string;
    defaultUnit?: string;
    allowedRawKeys?: Set<string>;
  }): void {
    const seenKeys = new Set<string>();
    KEY_VALUE_RE.lastIndex = 0;

    let match = KEY_VALUE_RE.exec(input.text);
    while (match) {
      const rawKey = (match[1] || "").trim();
      const rawValue = (match[2] || "").trim();
      const numeric = Number(rawValue);
      const keyBase = normalizeToken(rawKey);
      if (input.allowedRawKeys && keyBase && !input.allowedRawKeys.has(keyBase)) {
        match = KEY_VALUE_RE.exec(input.text);
        continue;
      }

      let normalizedKey = keyBase;
      if (input.keyPrefix && normalizedKey) {
        normalizedKey = `${normalizeToken(input.keyPrefix)}_${normalizedKey}`;
      }
      if (input.metricSuffix && normalizedKey) {
        normalizedKey = `${normalizedKey}_${normalizeToken(input.metricSuffix)}`;
      }

      if (
        normalizedKey &&
        Number.isFinite(numeric) &&
        !normalizedKey.startsWith("http") &&
        normalizedKey !== "status" &&
        normalizedKey !== "code" &&
        !seenKeys.has(normalizedKey)
      ) {
        seenKeys.add(normalizedKey);
        const asset = input.forceAsset || classifyAsset(normalizedKey);
        const metricLabel = metricLabelFromKey(normalizedKey, asset);
        const inlineUnit = detectInlineUnit(input.text, KEY_VALUE_RE.lastIndex);

        samples.push({
          timestamp: input.timestamp,
          epochMs: input.epochMs,
          source: input.source,
          assetId: asset.assetId,
          assetLabel: asset.assetLabel,
          assetKind: asset.assetKind,
          metricKey: normalizedKey,
          metricLabel,
          unit: inlineUnit || input.defaultUnit || detectUnit(normalizedKey),
          value: numeric
        });
      }

      match = KEY_VALUE_RE.exec(input.text);
    }
  }

  lines.forEach((line) => {
    const text = String(line.text || "");
    if (!text.trim()) return;

    const timestamp = resolveTimestamp(line);
    if (timestamp) {
      const epoch = Date.parse(timestamp);
      if (!Number.isNaN(epoch)) {
        lastTimestamp = timestamp;
        lastEpochMs = epoch;
      }
    }

    if (INFERENCE_CYCLE_RE.test(text)) {
      currentPhase = null;
    }

    if (!lastTimestamp || lastEpochMs === null) return;

    const source = detectSourceType(text, line.source) || "request.completed";
    const trimmed = text.trim();

    const phaseHeader = text.match(PHASE_HEADER_RE);
    if (phaseHeader?.[1]) {
      currentPhase = `l${phaseHeader[1]}` as "l1" | "l2" | "l3";
      appendKeyValueMatches({
        text,
        timestamp: lastTimestamp,
        epochMs: lastEpochMs,
        source,
        keyPrefix: `phase_${currentPhase}`,
        forceAsset: { assetId: "grid", assetLabel: "Grid", assetKind: "grid" }
      });
      return;
    }

    const chargerLine = text.match(CHARGER_LINE_RE);
    if (chargerLine?.[1]) {
      const chargerRawId = chargerLine[1].trim();
      const chargerAssetId = `charger_${normalizeToken(chargerRawId)}`;
      const chargerBody = chargerLine[2] || "";
      const actionMatch = chargerBody.match(/\baction\s*=\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i);
      if (!actionMatch) return;
      const actionRaw = Number(actionMatch[1]);
      if (!Number.isFinite(actionRaw)) return;

      const connectedMatch = chargerBody.match(/\bconnected\s*=\s*(yes|no|true|false|1|0)\b/i);
      const isConnected = connectedMatch ? /^(yes|true|1)$/i.test(connectedMatch[1]) : true;
      const effectiveAction = isConnected ? actionRaw : 0;

      pushSample({
        timestamp: lastTimestamp,
        epochMs: lastEpochMs,
        source,
        assetId: chargerAssetId,
        assetLabel: chargerRawId,
        assetKind: "charger",
        metricKey: "action_kw",
        metricLabel: chargerRawId,
        unit: "kW",
        value: effectiveAction
      });
      return;
    }

    if (/^inputs\s*:/i.test(trimmed)) {
      appendKeyValueMatches({
        text,
        timestamp: lastTimestamp,
        epochMs: lastEpochMs,
        source,
        allowedRawKeys: new Set([
          "solar",
          "non_shiftable",
          "nsl",
          "unmanaged",
          "meter_in",
          "meter_out",
          "meter_net",
          "community_in",
          "community_out",
          "community_net"
        ])
      });
      return;
    }

    if (/^ev\s*:/i.test(trimmed)) {
      const dispatchMatch = trimmed.match(/\bdispatch\s*=\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i);
      if (!dispatchMatch) return;
      const dispatchRaw = Number(dispatchMatch[1]);
      if (!Number.isFinite(dispatchRaw)) return;
      const connectedMatch = trimmed.match(/\bconnected\s*=\s*(yes|no|true|false|1|0)\b/i);
      const isConnected = connectedMatch ? /^(yes|true|1)$/i.test(connectedMatch[1]) : true;
      pushSample({
        timestamp: lastTimestamp,
        epochMs: lastEpochMs,
        source,
        assetId: "charger_ev_1",
        assetLabel: "EV Charger",
        assetKind: "charger",
        metricKey: "action_kw",
        metricLabel: "EV Charger",
        unit: "kW",
        value: isConnected ? dispatchRaw : 0
      });
      return;
    }

    if (/^battery\s*:/i.test(trimmed)) {
      appendKeyValueMatches({
        text,
        timestamp: lastTimestamp,
        epochMs: lastEpochMs,
        source,
        keyPrefix: "battery",
        forceAsset: { assetId: "battery", assetLabel: "Battery", assetKind: "battery" },
        allowedRawKeys: new Set(["soc", "dispatch"])
      });
      return;
    }

    if (/^(community|virtual)\s+battery\b/i.test(trimmed)) {
      appendKeyValueMatches({
        text,
        timestamp: lastTimestamp,
        epochMs: lastEpochMs,
        source,
        keyPrefix: "battery",
        // "Community battery" refers to a community-level virtual battery and should not
        // create a local Battery asset node for sites that do not have one.
        forceAsset: { assetId: "community", assetLabel: "Community", assetKind: "community" },
        allowedRawKeys: new Set(["action", "dispatch", "soc", "soc_raw", "charge_cap", "discharge_cap"])
      });
      return;
    }

    if (/^grid\s*:/i.test(trimmed)) {
      appendKeyValueMatches({
        text,
        timestamp: lastTimestamp,
        epochMs: lastEpochMs,
        source,
        keyPrefix: "grid",
        forceAsset: { assetId: "grid", assetLabel: "Grid", assetKind: "grid" },
        allowedRawKeys: new Set(["meter_in", "meter_out", "meter_net"])
      });
      return;
    }

    if (/^community\s*:/i.test(trimmed)) {
      appendKeyValueMatches({
        text,
        timestamp: lastTimestamp,
        epochMs: lastEpochMs,
        source,
        keyPrefix: "community",
        forceAsset: { assetId: "community", assetLabel: "Community", assetKind: "community" },
        allowedRawKeys: new Set(["in", "out", "net"])
      });
      return;
    }

    if (/^prices\b/i.test(trimmed)) {
      appendKeyValueMatches({
        text,
        timestamp: lastTimestamp,
        epochMs: lastEpochMs,
        source,
        keyPrefix: "price",
        forceAsset: { assetId: "pricing", assetLabel: "Prices", assetKind: "pricing" },
        defaultUnit: detectPriceDefaultUnit(trimmed)
      });
      return;
    }

    appendKeyValueMatches({
      text,
      timestamp: lastTimestamp,
      epochMs: lastEpochMs,
      source
    });
  });

  return samples.sort((left, right) => {
    if (left.epochMs !== right.epochMs) return left.epochMs - right.epochMs;
    const leftKey = `${left.assetId}:${left.metricKey}`;
    const rightKey = `${right.assetId}:${right.metricKey}`;
    return leftKey.localeCompare(rightKey);
  });
}

export function buildDeployChartSeries(samples: ParsedLogSample[]): DeployChartSeries[] {
  const grouped = new Map<string, DeployChartSeries>();

  samples.forEach((sample) => {
    const seriesId = `${sample.assetId}::${sample.metricKey}`;
    const existing = grouped.get(seriesId);
    if (!existing) {
      const metric = sample.assetKind === "charger" && sample.metricKey === "action_kw" ? sample.assetLabel : sample.metricLabel;
      grouped.set(seriesId, {
        id: seriesId,
        fileRef: sample.assetId,
        metric,
        unit: sample.unit,
        points: [
          {
            timestamp: sample.timestamp,
            epochMs: sample.epochMs,
            value: sample.value
          }
        ],
        assetId: sample.assetId,
        assetLabel: sample.assetLabel,
        assetKind: sample.assetKind
      });
      return;
    }

    const last = existing.points[existing.points.length - 1] || null;
    if (last && last.epochMs === sample.epochMs) {
      existing.points[existing.points.length - 1] = toPoint(last, sample.value);
      return;
    }

    existing.points.push({
      timestamp: sample.timestamp,
      epochMs: sample.epochMs,
      value: sample.value
    });
  });

  return Array.from(grouped.values())
    .map((entry) => ({
      ...entry,
      points: entry.points.sort((left, right) => {
        const leftEpoch = typeof left.epochMs === "number" ? left.epochMs : Number.POSITIVE_INFINITY;
        const rightEpoch = typeof right.epochMs === "number" ? right.epochMs : Number.POSITIVE_INFINITY;
        return leftEpoch - rightEpoch;
      })
    }))
    .sort((left, right) => {
      const leftKey = `${left.assetId}:${left.metric}`;
      const rightKey = `${right.assetId}:${right.metric}`;
      return leftKey.localeCompare(rightKey);
    });
}

export function buildDeployAssetTree(profile: DeploySiteProfile, series: DeployChartSeries[]): DeployAssetTreeNode[] {
  const HIDDEN_GROUPS = new Set(["ev", "other"]);
  if (profile.id === "hq") {
    HIDDEN_GROUPS.add("grid");
    HIDDEN_GROUPS.add("battery");
  }
  if (profile.id === "sao_mamede") {
    HIDDEN_GROUPS.add("grid");
  }
  const metricsByAsset = new Map<string, DeployMetricLeaf[]>();
  const metaByAsset = new Map<string, DeployAssetDefinition>();

  series.forEach((entry) => {
    let assetId = entry.assetId;
    let assetLabel = entry.assetLabel;
    let metricLabel = entry.metric;
    let assetKind = entry.assetKind;

    if (entry.assetKind === "charger") {
      if (!entry.assetId.startsWith("charger_")) return;
      assetId = "chargers";
      assetLabel = "Chargers";
      assetKind = "charger";
      metricLabel = entry.metric || entry.assetLabel;
    } else if (assetId.startsWith("community_")) {
      assetId = "community";
      assetLabel = "Community";
      assetKind = "community";
    }

    if (HIDDEN_GROUPS.has(assetId)) return;

    const list = metricsByAsset.get(assetId) || [];
    list.push({
      id: entry.id,
      label: metricLabel,
      unit: entry.unit,
      seriesId: entry.id
    });
    metricsByAsset.set(assetId, list);

    if (!metaByAsset.has(assetId)) {
      metaByAsset.set(assetId, {
        id: assetId,
        label: assetLabel,
        kind: assetKind
      });
    }
  });

  const profileEntries: Array<[string, DeployAssetDefinition]> = profile.assets
    .filter((asset) => !HIDDEN_GROUPS.has(asset.id))
    .map((asset) => [asset.id, asset]);
  const profileMap = new Map<string, DeployAssetDefinition>(profileEntries);
  const allAssetIds = new Set<string>([...profileMap.keys(), ...metricsByAsset.keys()]);

  const ordered = Array.from(allAssetIds).sort((left, right) => {
    const leftIndex = profile.assets.findIndex((asset) => asset.id === left);
    const rightIndex = profile.assets.findIndex((asset) => asset.id === right);
    const safeLeft = leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const safeRight = rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex;
    if (safeLeft !== safeRight) return safeLeft - safeRight;
    return left.localeCompare(right);
  });

  return ordered.map((assetId) => {
    const existing = profileMap.get(assetId) || metaByAsset.get(assetId);
    const allMetricLeaves = (metricsByAsset.get(assetId) || []).sort((left, right) => left.label.localeCompare(right.label));
    let metricLeaves = allMetricLeaves;

    if (assetId === "battery") {
      const metricKeyFromSeriesId = (seriesId: string): string => {
        const [, metricKey = ""] = String(seriesId || "").split("::");
        return metricKey;
      };
      const actionMetric =
        allMetricLeaves.find((leaf) => metricKeyFromSeriesId(leaf.seriesId) === "battery_action") ||
        allMetricLeaves.find((leaf) => metricKeyFromSeriesId(leaf.seriesId) === "battery_dispatch") ||
        null;
      const socMetric =
        allMetricLeaves.find(
          (leaf) => metricKeyFromSeriesId(leaf.seriesId) === "battery_soc" && String(leaf.unit || "") === "%"
        ) ||
        allMetricLeaves.find((leaf) => metricKeyFromSeriesId(leaf.seriesId) === "battery_soc") ||
        null;

      metricLeaves = [actionMetric, socMetric].filter((leaf): leaf is DeployMetricLeaf => Boolean(leaf));
    }

    return {
      id: assetId,
      label: existing?.label || titleFromToken(assetId),
      kind: existing?.kind || (series.find((entry) => entry.assetId === assetId)?.assetKind ?? "other"),
      hasData: metricLeaves.length > 0,
      seriesIds: metricLeaves.map((leaf) => leaf.seriesId),
      metrics: metricLeaves
    };
  });
}

function sanitizeEpoch(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function computeNoDataIntervals(
  rows: Array<{ epochMs: number | null; [key: string]: number | string | null }>,
  seriesIds: string[],
  rangeStart: number | null,
  rangeEnd: number | null,
  granularityMs: number
): AvailabilityInterval[] {
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    seriesIds.length === 0 ||
    rangeStart === null ||
    rangeEnd === null ||
    rangeEnd <= rangeStart ||
    !Number.isFinite(granularityMs) ||
    granularityMs <= 0
  ) {
    return [];
  }

  const epochs = rows
    .filter((row) =>
      seriesIds.some((seriesId) => typeof row[seriesId] === "number" && Number.isFinite(Number(row[seriesId])))
    )
    .map((row) => sanitizeEpoch(row.epochMs))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  const thresholdMs = granularityMs * 2;
  if (epochs.length === 0) {
    return [{ startEpochMs: rangeStart, endEpochMs: rangeEnd }];
  }

  const intervals: AvailabilityInterval[] = [];
  const firstEpoch = epochs[0];
  if (firstEpoch - rangeStart > thresholdMs) {
    intervals.push({
      startEpochMs: rangeStart,
      endEpochMs: firstEpoch
    });
  }

  for (let index = 1; index < epochs.length; index += 1) {
    const prev = epochs[index - 1];
    const next = epochs[index];
    if (next - prev > thresholdMs) {
      intervals.push({
        startEpochMs: prev,
        endEpochMs: next
      });
    }
  }

  const lastEpoch = epochs[epochs.length - 1];
  if (rangeEnd - lastEpoch > thresholdMs) {
    intervals.push({
      startEpochMs: lastEpoch,
      endEpochMs: rangeEnd
    });
  }

  return intervals.filter((interval) => interval.endEpochMs > interval.startEpochMs);
}

export function computeAvailabilityPercent(
  rows: Array<{ epochMs: number | null; [key: string]: number | string | null }>,
  seriesIds: string[],
  rangeStart: number | null,
  rangeEnd: number | null,
  granularityMs: number
): number {
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    seriesIds.length === 0 ||
    rangeStart === null ||
    rangeEnd === null ||
    rangeEnd <= rangeStart ||
    !Number.isFinite(granularityMs) ||
    granularityMs <= 0
  ) {
    return 0;
  }

  const expectedSlots = Math.max(1, Math.floor((rangeEnd - rangeStart) / granularityMs) + 1);

  const presentSlots = new Set<number>();
  rows.forEach((row) => {
    const epoch = sanitizeEpoch(row.epochMs);
    if (epoch === null) return;
    const hasAny = seriesIds.some((seriesId) => typeof row[seriesId] === "number" && Number.isFinite(Number(row[seriesId])));
    if (!hasAny) return;

    const slot = Math.floor((epoch - rangeStart) / granularityMs);
    if (slot >= 0 && slot < expectedSlots) {
      presentSlots.add(slot);
    }
  });

  const ratio = presentSlots.size / expectedSlots;
  return Math.max(0, Math.min(100, ratio * 100));
}

export function findLatestSampleEpoch(samples: ParsedLogSample[]): number | null {
  if (!samples.length) return null;
  const latest = samples[samples.length - 1];
  return Number.isFinite(latest.epochMs) ? latest.epochMs : null;
}
