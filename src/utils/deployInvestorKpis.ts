import type { DeployLogsHistoryLine } from "../api/deployApi";
import { parseDeployLogSamples, type ParsedLogSample } from "./deployLogCharts";

const COMMUNITY_PRICE_FACTOR = 0.7;
const DEFAULT_STEP_MS = 15_000;
const MIN_STEP_MS = 5_000;
const MAX_STEP_MS = 15 * 60 * 1000;
const MIN_SOLAR_KWH_FOR_RATIO = 0.02;
const RH01_TARGET_ALIASES = new Set(["rh01", "rh1", "rh_01", "rh_1", "r_h_01", "r_h_1", "r_h01", "r_h1"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*m/g;

type PriceSource = "rh01" | "local" | "mixed" | "none";

interface MetricPoint {
  epochMs: number;
  value: number;
  unit?: string;
}

interface EnergySample {
  epochMs: number;
  kwh: number;
}

interface CoverageStats {
  coveragePct: number;
  stepMs: number;
  slotsPresent: number;
  slotsExpected: number;
}

interface ParsedTargetContext {
  targetId: string;
  targetName: string;
  samples: ParsedLogSample[];
  message: string | null;
  available: boolean;
  metrics: {
    communityIn: MetricPoint[];
    communityOut: MetricPoint[];
    communityNet: MetricPoint[];
    meterIn: MetricPoint[];
    meterOut: MetricPoint[];
    chargerDemand: MetricPoint[];
    batteryDispatch: MetricPoint[];
    nonShiftableLoad: MetricPoint[];
    connectedTotal: MetricPoint[];
    solar: MetricPoint[];
    price: MetricPoint[];
  };
  coverage: CoverageStats;
}

interface SlotState {
  epochMs: number;
  gridImportKwh: number;
  gridExportKwh: number;
  communityInKwh: number;
  communityOutKwh: number;
  localLoadKwh: number;
  localGenerationKwh: number;
  solarGeneratedKwh: number;
}

interface TargetSlotModel {
  context: ParsedTargetContext;
  slotsByEpoch: Map<number, SlotState>;
  sortedEpochs: number[];
  localPriceLookup: (epochMs: number) => number | null;
}

export interface DeployInvestorWindow {
  localDayKey: string;
  sinceTs: string;
  untilTs: string;
  sinceEpochMs: number;
  untilEpochMs: number;
}

export interface DeployInvestorTargetInput {
  targetId: string;
  targetName: string;
  lines: DeployLogsHistoryLine[];
  available?: boolean;
  message?: string | null;
}

export interface DeployInvestorTargetSnapshot {
  targetId: string;
  targetName: string;
  savedEur: number | null;
  savedPct: number | null;
  communitySharePct: number | null;
  solarSelfConsumptionPct: number | null;
  demandKwh24: number;
  communityInKwh24: number;
  communityOutKwh24: number;
  solarGeneratedKwh24: number;
  solarSelfUsedKwh24: number;
  gridImportKwh24: number;
  gridExportKwh24: number;
  coveragePct: number;
  coverageSlotsPresent: number;
  coverageSlotsExpected: number;
  priceSource: PriceSource;
  hasData: boolean;
  message: string | null;
}

export interface DeployInvestorGlobalSnapshot {
  sourceTargetId: string | null;
  sourceTargetName: string | null;
  savedEur: number | null;
  savedPct: number | null;
  communitySharePct: number | null;
  solarSelfConsumptionPct: number | null;
  coveragePct: number;
  coverageSlotsPresent: number;
  coverageSlotsExpected: number;
  message: string | null;
}

export interface DeployInvestorSummary {
  targets: DeployInvestorTargetSnapshot[];
  global: DeployInvestorGlobalSnapshot;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeTargetId(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeUnit(value: string | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function finiteNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function collectPreferredMetricPoints(samples: ParsedLogSample[], keys: string[]): MetricPoint[] {
  const priority = new Map(keys.map((key, index) => [key, index]));
  const byEpoch = new Map<number, { priority: number; index: number; point: MetricPoint }>();

  samples.forEach((sample, index) => {
    const rank = priority.get(sample.metricKey);
    if (rank === undefined) return;

    const numeric = finiteNumber(sample.value);
    if (numeric === null) return;

    const existing = byEpoch.get(sample.epochMs);
    if (!existing || rank < existing.priority || (rank === existing.priority && index >= existing.index)) {
      byEpoch.set(sample.epochMs, {
        priority: rank,
        index,
        point: {
          epochMs: sample.epochMs,
          value: numeric,
          unit: sample.unit
        }
      });
    }
  });

  return Array.from(byEpoch.values())
    .map((entry) => entry.point)
    .sort((left, right) => left.epochMs - right.epochMs);
}

function collectSummedMetricPoints(
  samples: ParsedLogSample[],
  predicate: (sample: ParsedLogSample) => boolean
): MetricPoint[] {
  const byEpoch = new Map<number, { value: number; unit?: string }>();

  samples.forEach((sample) => {
    if (!predicate(sample)) return;
    const numeric = finiteNumber(sample.value);
    if (numeric === null) return;

    const existing = byEpoch.get(sample.epochMs);
    if (!existing) {
      byEpoch.set(sample.epochMs, {
        value: numeric,
        unit: sample.unit
      });
      return;
    }

    existing.value += numeric;
    existing.unit = existing.unit || sample.unit;
    byEpoch.set(sample.epochMs, existing);
  });

  return Array.from(byEpoch.entries())
    .map(([epochMs, metric]) => ({
      epochMs,
      value: metric.value,
      unit: metric.unit
    }))
    .sort((left, right) => left.epochMs - right.epochMs);
}

function collectChargerDemandPoints(samples: ParsedLogSample[]): MetricPoint[] {
  const perEpochAndAsset = new Map<string, { epochMs: number; assetId: string; value: number; unit?: string }>();

  samples.forEach((sample) => {
    if (sample.assetKind !== "charger" || sample.metricKey !== "action_kw") return;
    const numeric = finiteNumber(sample.value);
    if (numeric === null) return;

    const key = `${sample.epochMs}|${sample.assetId}`;
    // Keep the latest reading for the same charger in the same timestamp (e.g. 3-phase repeats).
    perEpochAndAsset.set(key, {
      epochMs: sample.epochMs,
      assetId: sample.assetId,
      value: numeric,
      unit: sample.unit
    });
  });

  return collectSummedMetricPoints(
    Array.from(perEpochAndAsset.values()).map((item) => ({
      timestamp: new Date(item.epochMs).toISOString(),
      epochMs: item.epochMs,
      source: "rbc.summary",
      assetId: item.assetId,
      assetLabel: item.assetId,
      assetKind: "charger",
      metricKey: "action_kw",
      metricLabel: "Action",
      unit: item.unit,
      value: item.value
    })),
    () => true
  );
}

function collectBatteryDispatchPoints(samples: ParsedLogSample[]): MetricPoint[] {
  const byEpoch = new Map<number, { rank: number; point: MetricPoint }>();

  samples.forEach((sample) => {
    const numeric = finiteNumber(sample.value);
    if (numeric === null) return;

    const key = sample.metricKey || "";
    const normalizedKey = key.toLowerCase();
    let rank = Number.POSITIVE_INFINITY;

    if (normalizedKey === "battery_dispatch") rank = 0;
    else if (normalizedKey.includes("battery") && normalizedKey.includes("dispatch")) rank = 1;
    else if (normalizedKey.includes("battery") && normalizedKey.includes("power")) rank = 2;
    else if (normalizedKey.includes("battery") && normalizedKey.includes("action")) rank = 3;
    else return;

    const existing = byEpoch.get(sample.epochMs);
    if (!existing || rank <= existing.rank) {
      byEpoch.set(sample.epochMs, {
        rank,
        point: {
          epochMs: sample.epochMs,
          value: numeric,
          unit: sample.unit
        }
      });
    }
  });

  return Array.from(byEpoch.values())
    .map((entry) => entry.point)
    .sort((left, right) => left.epochMs - right.epochMs);
}

function collectPricePoints(samples: ParsedLogSample[]): MetricPoint[] {
  const preferredKeys = [
    "price_now",
    "price_h1",
    "price_h2",
    "price_h6",
    "price_h12",
    "price_h24",
    "price_avg_24h",
  ];
  const preferredKeySet = new Set(preferredKeys);

  const positiveCandidates = samples.filter((sample) => {
    if (!preferredKeySet.has(sample.metricKey)) return false;
    const numeric = finiteNumber(sample.value);
    return numeric !== null && numeric > 0;
  });

  const preferredPositive = collectPreferredMetricPoints(positiveCandidates, preferredKeys);
  if (preferredPositive.length > 0) return preferredPositive;

  const fallbackSamples = samples.filter((sample) => {
    if (!preferredKeySet.has(sample.metricKey)) return false;
    return finiteNumber(sample.value) !== null;
  });

  if (fallbackSamples.length === 0) return [];

  return collectPreferredMetricPoints(fallbackSamples, preferredKeys);
}

function inferStepMsFromEpochs(epochs: number[]): number {
  const sorted = Array.from(new Set(epochs.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)));
  if (sorted.length < 2) return DEFAULT_STEP_MS;

  const diffs: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const diff = sorted[index] - sorted[index - 1];
    if (diff > 0 && diff <= MAX_STEP_MS) diffs.push(diff);
  }

  if (diffs.length === 0) return DEFAULT_STEP_MS;
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)] || DEFAULT_STEP_MS;
  return Math.max(MIN_STEP_MS, Math.min(MAX_STEP_MS, median));
}

function computeCoverageFromSamples(
  samples: ParsedLogSample[],
  windowStartEpochMs: number,
  windowEndEpochMs: number
): CoverageStats {
  if (!Number.isFinite(windowStartEpochMs) || !Number.isFinite(windowEndEpochMs) || windowEndEpochMs <= windowStartEpochMs) {
    return {
      coveragePct: 0,
      stepMs: DEFAULT_STEP_MS,
      slotsPresent: 0,
      slotsExpected: 0
    };
  }

  const relevant = samples.filter((sample) => {
    if (sample.metricKey.startsWith("price_")) return true;
    return [
      "community_in",
      "community_out",
      "community_net",
      "meter_in",
      "grid_meter_in",
      "meter_out",
      "grid_meter_out",
      "solar",
      "action_kw",
      "non_shiftable",
      "nsl",
      "unmanaged",
      "battery_dispatch",
      "connected_total"
    ].includes(sample.metricKey);
  });

  const epochs = relevant
    .map((sample) => sample.epochMs)
    .filter((epoch) => epoch >= windowStartEpochMs && epoch <= windowEndEpochMs);

  const stepMs = inferStepMsFromEpochs(epochs);
  const slotsExpected = Math.max(1, Math.floor((windowEndEpochMs - windowStartEpochMs) / stepMs) + 1);
  const slotsPresent = new Set<number>();

  epochs.forEach((epoch) => {
    const slot = Math.floor((epoch - windowStartEpochMs) / stepMs);
    if (slot >= 0 && slot < slotsExpected) slotsPresent.add(slot);
  });

  const coveragePct = Math.max(0, Math.min(100, (slotsPresent.size / slotsExpected) * 100));

  return {
    coveragePct,
    stepMs,
    slotsPresent: slotsPresent.size,
    slotsExpected
  };
}

function toEnergySamples(
  points: MetricPoint[],
  defaultStepMs: number,
  options?: {
    allowNegative?: boolean;
  }
): EnergySample[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((left, right) => left.epochMs - right.epochMs);
  const allowNegative = options?.allowNegative === true;

  return sorted
    .map((point, index) => {
      const unit = normalizeUnit(point.unit);
      const rawValue = finiteNumber(point.value);
      if (rawValue === null) return null;
      const normalizeEnergy = (value: number): number => (allowNegative ? value : Math.max(0, value));

      if (unit === "kwh") {
        return {
          epochMs: point.epochMs,
          kwh: normalizeEnergy(rawValue)
        };
      }

      if (unit === "kw") {
        const nextEpoch = sorted[index + 1]?.epochMs;
        const durationMs = Math.max(
          MIN_STEP_MS,
          Math.min(defaultStepMs, Number.isFinite(nextEpoch) ? Math.max(0, nextEpoch - point.epochMs) : defaultStepMs)
        );
        return {
          epochMs: point.epochMs,
          kwh: normalizeEnergy(rawValue * (durationMs / 3_600_000))
        };
      }

      return {
        epochMs: point.epochMs,
        kwh: normalizeEnergy(rawValue)
      };
    })
    .filter((entry): entry is EnergySample => Boolean(entry));
}

function energyByEpoch(samples: EnergySample[]): Map<number, number> {
  const byEpoch = new Map<number, number>();
  samples.forEach((sample) => {
    if (!Number.isFinite(sample.kwh)) return;
    byEpoch.set(sample.epochMs, (byEpoch.get(sample.epochMs) || 0) + sample.kwh);
  });
  return byEpoch;
}

function buildPriceLookup(points: MetricPoint[]): (epochMs: number) => number | null {
  const sorted = [...points]
    .map((point) => ({ epochMs: point.epochMs, value: finiteNumber(point.value) }))
    .filter((point): point is { epochMs: number; value: number | null } => point.value !== null)
    .map((point) => ({ epochMs: point.epochMs, value: point.value as number }))
    .sort((left, right) => left.epochMs - right.epochMs);

  if (sorted.length === 0) {
    return () => null;
  }

  return (epochMs: number): number | null => {
    if (!Number.isFinite(epochMs)) return null;
    if (epochMs < sorted[0].epochMs) return null;

    let low = 0;
    let high = sorted.length - 1;
    let candidate = -1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const point = sorted[middle];
      if (point.epochMs <= epochMs) {
        candidate = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return candidate >= 0 ? sorted[candidate].value : null;
  };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function isRh01TargetId(targetId: string): boolean {
  return RH01_TARGET_ALIASES.has(normalizeTargetId(targetId));
}

type SiteKind = "hq" | "sao_mamede" | "rh01" | "other";

function resolveSiteKind(targetId: string): SiteKind {
  const normalized = normalizeTargetId(targetId);
  if (normalized === "hq" || normalized === "boavista") return "hq";
  if (["sm", "sao_mamede", "sao_mamed", "saomamede", "sao_mamede_inference"].includes(normalized)) {
    return "sao_mamede";
  }
  if (isRh01TargetId(normalized)) return "rh01";
  return "other";
}

export function buildLocalDayWindow(referenceDate = new Date()): DeployInvestorWindow {
  const reference = new Date(referenceDate);
  const startLocal = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 0, 0, 0, 0);

  const localDayKey = `${startLocal.getFullYear()}-${pad(startLocal.getMonth() + 1)}-${pad(startLocal.getDate())}`;

  return {
    localDayKey,
    sinceTs: startLocal.toISOString(),
    untilTs: reference.toISOString(),
    sinceEpochMs: startLocal.getTime(),
    untilEpochMs: reference.getTime()
  };
}

export function buildRolling24hWindow(referenceDate = new Date()): DeployInvestorWindow {
  const until = new Date(referenceDate);
  const since = new Date(until.getTime() - DAY_MS);
  const rollingKey = `rolling_${Math.floor(until.getTime() / 60_000)}`;

  return {
    localDayKey: rollingKey,
    sinceTs: since.toISOString(),
    untilTs: until.toISOString(),
    sinceEpochMs: since.getTime(),
    untilEpochMs: until.getTime()
  };
}

function expandHistoryLines(lines: DeployLogsHistoryLine[]): DeployLogsHistoryLine[] {
  const expanded: DeployLogsHistoryLine[] = [];

  lines.forEach((line) => {
    const source = line.source;
    const ts = line.ts;
    const rawText = String(line.text || "").replace(ANSI_ESCAPE_RE, "");
    const segments = rawText.split(/\r?\n/);

    if (segments.length <= 1) {
      const clean = rawText.trimEnd();
      if (clean.trim()) {
        expanded.push({
          ts,
          source,
          text: clean
        });
      }
      return;
    }

    segments.forEach((segment) => {
      const clean = segment.replace(ANSI_ESCAPE_RE, "").trimEnd();
      if (!clean.trim()) return;
      expanded.push({
        ts,
        source,
        text: clean
      });
    });
  });

  return expanded;
}

function buildTargetContext(
  input: DeployInvestorTargetInput,
  windowStartEpochMs: number,
  windowEndEpochMs: number
): ParsedTargetContext {
  const expandedLines = expandHistoryLines(input.lines || []);
  const samples = parseDeployLogSamples(expandedLines);

  return {
    targetId: input.targetId,
    targetName: input.targetName,
    samples,
    available: input.available !== false,
    message: input.message || null,
    metrics: {
      communityIn: collectPreferredMetricPoints(samples, ["community_in"]),
      communityOut: collectPreferredMetricPoints(samples, ["community_out"]),
      communityNet: collectPreferredMetricPoints(samples, ["community_net"]),
      meterIn: collectPreferredMetricPoints(samples, ["meter_in", "grid_meter_in"]),
      meterOut: collectPreferredMetricPoints(samples, ["meter_out", "grid_meter_out"]),
      chargerDemand: collectChargerDemandPoints(samples),
      batteryDispatch: collectBatteryDispatchPoints(samples),
      nonShiftableLoad: collectPreferredMetricPoints(samples, ["non_shiftable", "nsl", "unmanaged"]),
      connectedTotal: collectPreferredMetricPoints(samples, ["connected_total", "dispatch_connected_total"]),
      solar: collectPreferredMetricPoints(samples, ["solar", "solar_generation_kwh", "solar_generation_kw"]),
      price: collectPricePoints(samples)
    },
    coverage: computeCoverageFromSamples(samples, windowStartEpochMs, windowEndEpochMs)
  };
}

function buildTargetSlotModel(context: ParsedTargetContext): TargetSlotModel {
  const stepMs = context.coverage.stepMs || DEFAULT_STEP_MS;
  const localPriceLookup = buildPriceLookup(context.metrics.price);
  const siteKind = resolveSiteKind(context.targetId);

  const communityInPoints =
    context.metrics.communityIn.length > 0
      ? context.metrics.communityIn
      : context.metrics.communityNet
          .map((point) => ({ ...point, value: Math.max(0, point.value) }))
          .filter((point) => point.value > 0);
  const communityOutPoints =
    context.metrics.communityOut.length > 0
      ? context.metrics.communityOut
      : context.metrics.communityNet
          .map((point) => ({ ...point, value: Math.max(0, -point.value) }))
          .filter((point) => point.value > 0);

  const rawCommunityIn = energyByEpoch(toEnergySamples(communityInPoints, stepMs));
  const rawCommunityOut = energyByEpoch(toEnergySamples(communityOutPoints, stepMs));
  const solarByEpoch = energyByEpoch(toEnergySamples(context.metrics.solar, stepMs));
  const chargerByEpoch = energyByEpoch(toEnergySamples(context.metrics.chargerDemand, stepMs));
  const nonShiftableByEpoch = energyByEpoch(toEnergySamples(context.metrics.nonShiftableLoad, stepMs));
  const connectedByEpoch = energyByEpoch(toEnergySamples(context.metrics.connectedTotal, stepMs));
  const batteryDispatchByEpoch = energyByEpoch(
    toEnergySamples(context.metrics.batteryDispatch, stepMs, { allowNegative: true })
  );
  const meterInByEpoch = energyByEpoch(toEnergySamples(context.metrics.meterIn, stepMs));
  const meterOutByEpoch = energyByEpoch(toEnergySamples(context.metrics.meterOut, stepMs));

  const epochs = new Set<number>([
    ...Array.from(solarByEpoch.keys()),
    ...Array.from(chargerByEpoch.keys()),
    ...Array.from(nonShiftableByEpoch.keys()),
    ...Array.from(connectedByEpoch.keys()),
    ...Array.from(batteryDispatchByEpoch.keys()),
    ...Array.from(meterInByEpoch.keys()),
    ...Array.from(meterOutByEpoch.keys()),
    ...Array.from(rawCommunityIn.keys()),
    ...Array.from(rawCommunityOut.keys())
  ]);

  const slotsByEpoch = new Map<number, SlotState>();
  Array.from(epochs)
    .sort((left, right) => left - right)
    .forEach((epochMs) => {
      const chargerDemandKwh = chargerByEpoch.has(epochMs)
        ? Math.max(0, chargerByEpoch.get(epochMs) || 0)
        : Math.max(0, connectedByEpoch.get(epochMs) || 0);
      const nonShiftableKwh = Math.max(0, nonShiftableByEpoch.get(epochMs) || 0);
      const batteryDispatchKwh = batteryDispatchByEpoch.get(epochMs) || 0;
      const batteryChargeKwh = Math.max(0, batteryDispatchKwh);
      const batteryDischargeKwh = Math.max(0, -batteryDispatchKwh);
      const solarGeneratedKwh = Math.max(0, solarByEpoch.get(epochMs) || 0);

      const localLoadKwh = Math.max(0, chargerDemandKwh + nonShiftableKwh + batteryChargeKwh);
      const localGenerationKwh = Math.max(0, solarGeneratedKwh + batteryDischargeKwh);
      const simulatedImportKwh = Math.max(0, localLoadKwh - localGenerationKwh);
      const simulatedExportKwh = Math.max(0, localGenerationKwh - localLoadKwh);

      const hasMeterIn = meterInByEpoch.has(epochMs);
      const hasMeterOut = meterOutByEpoch.has(epochMs);
      const meterInKwh = Math.max(0, meterInByEpoch.get(epochMs) || 0);
      const meterOutKwh = Math.max(0, meterOutByEpoch.get(epochMs) || 0);

      let gridImportKwh = simulatedImportKwh;
      let gridExportKwh = simulatedExportKwh;

      if (siteKind === "rh01") {
        gridImportKwh = hasMeterIn ? meterInKwh : simulatedImportKwh;
        gridExportKwh = hasMeterOut ? meterOutKwh : simulatedExportKwh;
      } else if (siteKind === "sao_mamede") {
        // Sao Mamede meter_out is not reliable; keep import from meter_in and export from local balance.
        gridImportKwh = hasMeterIn ? meterInKwh : simulatedImportKwh;
        gridExportKwh = simulatedExportKwh;
      } else if (siteKind === "hq") {
        gridImportKwh = simulatedImportKwh;
        gridExportKwh = simulatedExportKwh;
      } else {
        gridImportKwh = hasMeterIn ? meterInKwh : simulatedImportKwh;
        gridExportKwh = hasMeterOut ? meterOutKwh : simulatedExportKwh;
      }

      const communityInKwh = Math.max(0, rawCommunityIn.get(epochMs) || 0);
      const communityOutKwh = Math.max(0, rawCommunityOut.get(epochMs) || 0);

      slotsByEpoch.set(epochMs, {
        epochMs,
        gridImportKwh,
        gridExportKwh,
        communityInKwh,
        communityOutKwh,
        localLoadKwh,
        localGenerationKwh,
        solarGeneratedKwh
      });
    });

  return {
    context,
    slotsByEpoch,
    sortedEpochs: Array.from(slotsByEpoch.keys()).sort((left, right) => left - right),
    localPriceLookup
  };
}

function resolvePriceForEpoch(params: {
  epochMs: number;
  canonicalPriceLookup: ((epochMs: number) => number | null) | null;
  localPriceLookup: (epochMs: number) => number | null;
  allowLocalFallback: boolean;
}): {
  price: number | null;
  usedCanonical: boolean;
  usedLocal: boolean;
} {
  const canonical = params.canonicalPriceLookup ? params.canonicalPriceLookup(params.epochMs) : null;
  if (canonical !== null && Number.isFinite(canonical)) {
    return { price: canonical, usedCanonical: true, usedLocal: false };
  }

  if (params.allowLocalFallback) {
    const local = params.localPriceLookup(params.epochMs);
    if (local !== null && Number.isFinite(local)) {
      return { price: local, usedCanonical: false, usedLocal: true };
    }
  }

  return { price: null, usedCanonical: false, usedLocal: false };
}

function priceSourceFromFlags(input: { usedCanonical: boolean; usedLocal: boolean; pricedSlots: number }): PriceSource {
  if (input.pricedSlots <= 0) return "none";
  if (input.usedCanonical && input.usedLocal) return "mixed";
  if (input.usedCanonical) return "rh01";
  if (input.usedLocal) return "local";
  return "none";
}

export function computeDeployInvestorKpis(
  inputs: DeployInvestorTargetInput[],
  options: {
    windowStartEpochMs: number;
    windowEndEpochMs: number;
  }
): DeployInvestorSummary {
  const contexts = inputs.map((input) => buildTargetContext(input, options.windowStartEpochMs, options.windowEndEpochMs));
  const canonicalContext = contexts.find((context) => isRh01TargetId(context.targetId)) || null;
  const canonicalPriceLookup = canonicalContext ? buildPriceLookup(canonicalContext.metrics.price) : null;

  const models = contexts.map((context) => buildTargetSlotModel(context));

  interface TargetAccumulator {
    demandKwh24: number;
    communityInKwh24: number;
    communityOutKwh24: number;
    solarGeneratedKwh24: number;
    solarSelfUsedKwh24: number;
    gridImportKwh24: number;
    gridExportKwh24: number;
    actualCostEur24: number;
    tariffBaselineCostEur24: number;
    pricedSlots: number;
    usedCanonicalPrice: boolean;
    usedLocalPrice: boolean;
  }

  const accumulators = new Map<string, TargetAccumulator>();
  models.forEach((model) => {
    accumulators.set(model.context.targetId, {
      demandKwh24: 0,
      communityInKwh24: 0,
      communityOutKwh24: 0,
      solarGeneratedKwh24: 0,
      solarSelfUsedKwh24: 0,
      gridImportKwh24: 0,
      gridExportKwh24: 0,
      actualCostEur24: 0,
      tariffBaselineCostEur24: 0,
      pricedSlots: 0,
      usedCanonicalPrice: false,
      usedLocalPrice: false
    });
  });

  const epochSet = new Set<number>();
  models.forEach((model) => {
    model.sortedEpochs.forEach((epoch) => epochSet.add(epoch));
  });

  const sortedEpochs = Array.from(epochSet).sort((left, right) => left - right);

  sortedEpochs.forEach((epochMs) => {
    const rows = models
      .map((model) => {
        const slot = model.slotsByEpoch.get(epochMs);
        if (!slot) return null;
        return { model, slot };
      })
      .filter((row): row is { model: TargetSlotModel; slot: SlotState } => Boolean(row));

    if (rows.length === 0) return;

    rows.forEach((row) => {
      const acc = accumulators.get(row.model.context.targetId);
      if (!acc) return;

      const communityInKwh = Math.max(0, row.slot.communityInKwh);
      const communityOutKwh = Math.max(0, row.slot.communityOutKwh);
      const gridImportKwh = Math.max(0, row.slot.gridImportKwh);
      const gridExportKwh = Math.max(0, row.slot.gridExportKwh);
      const demandKwh = Math.max(0, row.slot.localLoadKwh, gridImportKwh + communityInKwh);
      const solarSelfUsedKwh = Math.max(0, Math.min(row.slot.solarGeneratedKwh, demandKwh));

      acc.demandKwh24 += demandKwh;
      acc.communityInKwh24 += communityInKwh;
      acc.communityOutKwh24 += communityOutKwh;
      acc.solarGeneratedKwh24 += row.slot.solarGeneratedKwh;
      acc.solarSelfUsedKwh24 += solarSelfUsedKwh;
      acc.gridImportKwh24 += gridImportKwh;
      acc.gridExportKwh24 += gridExportKwh;

      const priceResolution = resolvePriceForEpoch({
        epochMs,
        canonicalPriceLookup,
        localPriceLookup: row.model.localPriceLookup,
        allowLocalFallback: canonicalContext === null
      });

      if (priceResolution.price !== null && Number.isFinite(priceResolution.price)) {
        acc.pricedSlots += 1;
        if (priceResolution.usedCanonical) acc.usedCanonicalPrice = true;
        if (priceResolution.usedLocal) acc.usedLocalPrice = true;

        const baseline = (gridImportKwh + communityInKwh) * priceResolution.price;
        const actual =
          gridImportKwh * priceResolution.price +
          communityInKwh * priceResolution.price * COMMUNITY_PRICE_FACTOR -
          (gridExportKwh + communityOutKwh) * priceResolution.price * COMMUNITY_PRICE_FACTOR;

        acc.tariffBaselineCostEur24 += baseline;
        acc.actualCostEur24 += actual;
      }
    });
  });

  const targets = models.map((model) => {
    const acc = accumulators.get(model.context.targetId);
    const hasData = model.context.samples.length > 0;

    if (!acc) {
      return {
        targetId: model.context.targetId,
        targetName: model.context.targetName,
        savedEur: null,
        savedPct: null,
        communitySharePct: null,
        solarSelfConsumptionPct: null,
        demandKwh24: 0,
        communityInKwh24: 0,
        communityOutKwh24: 0,
        solarGeneratedKwh24: 0,
        solarSelfUsedKwh24: 0,
        gridImportKwh24: 0,
        gridExportKwh24: 0,
        coveragePct: model.context.coverage.coveragePct,
        coverageSlotsPresent: model.context.coverage.slotsPresent,
        coverageSlotsExpected: model.context.coverage.slotsExpected,
        priceSource: "none" as PriceSource,
        hasData,
        message: "No KPI accumulation data available."
      };
    }

    const savedEur =
      acc.pricedSlots > 0 ? acc.tariffBaselineCostEur24 - acc.actualCostEur24 : null;
    const savedPct =
      savedEur !== null && acc.tariffBaselineCostEur24 > 0
        ? (savedEur / acc.tariffBaselineCostEur24) * 100
        : null;
    const communitySharePct =
      acc.demandKwh24 > 0 ? clampPercent((acc.communityInKwh24 / acc.demandKwh24) * 100) : null;
    const solarSelfUsedKwh24 = Math.max(0, Math.min(acc.solarGeneratedKwh24, acc.solarSelfUsedKwh24));
    const solarSelfConsumptionPct =
      acc.solarGeneratedKwh24 >= MIN_SOLAR_KWH_FOR_RATIO
        ? clampPercent((solarSelfUsedKwh24 / acc.solarGeneratedKwh24) * 100)
        : null;

    const priceSource = priceSourceFromFlags({
      usedCanonical: acc.usedCanonicalPrice,
      usedLocal: acc.usedLocalPrice,
      pricedSlots: acc.pricedSlots
    });

    let message = model.context.message;
    if (!message && !model.context.available) {
      message = "Logs unavailable for this target.";
    } else if (!message && !hasData) {
      message = "No KPI logs found in this window.";
    } else if (!message && acc.pricedSlots === 0) {
      message = "No price samples available for this window.";
    }

    return {
      targetId: model.context.targetId,
      targetName: model.context.targetName,
      savedEur,
      savedPct,
      communitySharePct,
      solarSelfConsumptionPct,
      demandKwh24: acc.demandKwh24,
      communityInKwh24: acc.communityInKwh24,
      communityOutKwh24: acc.communityOutKwh24,
      solarGeneratedKwh24: acc.solarGeneratedKwh24,
      solarSelfUsedKwh24,
      gridImportKwh24: acc.gridImportKwh24,
      gridExportKwh24: acc.gridExportKwh24,
      coveragePct: model.context.coverage.coveragePct,
      coverageSlotsPresent: model.context.coverage.slotsPresent,
      coverageSlotsExpected: model.context.coverage.slotsExpected,
      priceSource,
      hasData,
      message
    };
  });

  const coverageSlotsPresent = targets.reduce((total, entry) => total + entry.coverageSlotsPresent, 0);
  const coverageSlotsExpected = targets.reduce((total, entry) => total + entry.coverageSlotsExpected, 0);
  const coveragePct = coverageSlotsExpected > 0 ? clampPercent((coverageSlotsPresent / coverageSlotsExpected) * 100) : 0;

  const totalDemandKwh = targets.reduce((sum, target) => sum + target.demandKwh24, 0);
  const totalCommunityInKwh = targets.reduce((sum, target) => sum + target.communityInKwh24, 0);
  const solarSelfConsumptionValues = targets
    .map((target) => target.solarSelfConsumptionPct)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const baselineCostTotal = Array.from(accumulators.values()).reduce(
    (sum, entry) => sum + entry.tariffBaselineCostEur24,
    0
  );
  const actualCostTotal = Array.from(accumulators.values()).reduce(
    (sum, entry) => sum + entry.actualCostEur24,
    0
  );
  const hasAnyPricedData = Array.from(accumulators.values()).some((entry) => entry.pricedSlots > 0);

  const savedEur = hasAnyPricedData ? baselineCostTotal - actualCostTotal : null;
  const savedPct =
    savedEur !== null && baselineCostTotal > 0 ? (savedEur / baselineCostTotal) * 100 : null;
  const communitySharePct =
    totalDemandKwh > 0 ? clampPercent((totalCommunityInKwh / totalDemandKwh) * 100) : null;
  const solarSelfConsumptionPct =
    solarSelfConsumptionValues.length > 0
      ? clampPercent(
          solarSelfConsumptionValues.reduce((sum, value) => sum + value, 0) /
            solarSelfConsumptionValues.length
        )
      : null;

  const missingRh01Message = canonicalContext
    ? null
    : "RH01 price stream is missing; values may rely on local prices only.";
  const targetMessages = targets.map((entry) => entry.message).filter(Boolean) as string[];
  const message =
    [missingRh01Message, ...targetMessages]
      .filter(Boolean)
      .slice(0, 2)
      .join(" ") || null;

  return {
    targets,
    global: {
      sourceTargetId: null,
      sourceTargetName: "All targets",
      savedEur,
      savedPct,
      communitySharePct,
      solarSelfConsumptionPct,
      coveragePct,
      coverageSlotsPresent,
      coverageSlotsExpected,
      message
    }
  };
}
