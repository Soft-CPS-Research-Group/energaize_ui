import type { SimulationSeries } from "../types";

export type TimeseriesPreset = "all" | "1h" | "6h" | "24h" | "7d" | "30d";

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const GRANULARITY_OPTIONS = [
  { label: "1m", ms: 1 * MINUTE_MS },
  { label: "5m", ms: 5 * MINUTE_MS },
  { label: "15m", ms: 15 * MINUTE_MS },
  { label: "30m", ms: 30 * MINUTE_MS },
  { label: "1h", ms: 1 * HOUR_MS }
] as const;

export type GranularityMs = (typeof GRANULARITY_OPTIONS)[number]["ms"];

export interface TimeseriesChartRow {
  x: string;
  epochMs: number | null;
  [key: string]: number | string | null;
}

const PRESET_MIN_GRANULARITY_MS: Record<TimeseriesPreset, GranularityMs> = {
  "1h": 1 * MINUTE_MS,
  "6h": 5 * MINUTE_MS,
  "24h": 15 * MINUTE_MS,
  "7d": 1 * HOUR_MS,
  "30d": 1 * HOUR_MS,
  all: 1 * HOUR_MS
};

function alignToBoundary(epochMs: number, stepMs: number): number {
  const date = new Date(epochMs);
  if (stepMs >= DAY_MS) {
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  if (stepMs % HOUR_MS === 0) {
    const hoursStep = Math.max(1, Math.round(stepMs / HOUR_MS));
    const hour = date.getHours();
    const alignedHour = hour - (hour % hoursStep);
    date.setHours(alignedHour, 0, 0, 0);
    return date.getTime();
  }

  const minutesStep = Math.max(1, Math.round(stepMs / MINUTE_MS));
  const minutes = date.getMinutes();
  const alignedMinutes = minutes - (minutes % minutesStep);
  date.setSeconds(0, 0);
  date.setMinutes(alignedMinutes);
  return date.getTime();
}

function minGranularityFromCustomSpan(spanMs: number): GranularityMs {
  if (spanMs <= 1 * HOUR_MS) return 1 * MINUTE_MS;
  if (spanMs <= 6 * HOUR_MS) return 5 * MINUTE_MS;
  if (spanMs <= 24 * HOUR_MS) return 15 * MINUTE_MS;
  return 1 * HOUR_MS;
}

export function inferSeriesResolutionMs(series: SimulationSeries[]): number | null {
  let minDelta = Number.POSITIVE_INFINITY;

  series.forEach((entry) => {
    let previousEpoch: number | null = null;
    entry.points.forEach((point) => {
      const epoch = point.epochMs;
      if (typeof epoch !== "number" || !Number.isFinite(epoch)) return;
      if (previousEpoch !== null) {
        const delta = epoch - previousEpoch;
        if (delta > 0) {
          minDelta = Math.min(minDelta, delta);
        }
      }
      previousEpoch = epoch;
    });
  });

  if (!Number.isFinite(minDelta)) return null;
  return minDelta;
}

export function normalizeResolutionToSupportedGranularity(resolutionMs: number | null): GranularityMs {
  if (!Number.isFinite(resolutionMs) || resolutionMs === null || resolutionMs <= 0) {
    return GRANULARITY_OPTIONS[0].ms;
  }

  const match = GRANULARITY_OPTIONS.find((option) => resolutionMs <= option.ms);
  return (match?.ms ?? GRANULARITY_OPTIONS[GRANULARITY_OPTIONS.length - 1].ms) as GranularityMs;
}

export function resolveContextMinGranularityMs(input: {
  timePreset: TimeseriesPreset;
  useCustomRange: boolean;
  rangeStart: number | null;
  rangeEnd: number | null;
}): GranularityMs {
  if (!input.useCustomRange) {
    return PRESET_MIN_GRANULARITY_MS[input.timePreset];
  }

  if (input.rangeStart === null || input.rangeEnd === null) {
    return PRESET_MIN_GRANULARITY_MS[input.timePreset];
  }

  const span = Math.max(0, input.rangeEnd - input.rangeStart);
  return minGranularityFromCustomSpan(span);
}

export function resolveMinimumGranularityMs(input: {
  timePreset: TimeseriesPreset;
  useCustomRange: boolean;
  rangeStart: number | null;
  rangeEnd: number | null;
  sourceResolutionMs: number | null;
}): GranularityMs {
  const contextMin = resolveContextMinGranularityMs({
    timePreset: input.timePreset,
    useCustomRange: input.useCustomRange,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd
  });
  const sourceMin = normalizeResolutionToSupportedGranularity(input.sourceResolutionMs);
  const required = Math.max(contextMin, sourceMin);
  return normalizeResolutionToSupportedGranularity(required);
}

export function resolveAvailableGranularityOptions(minimumMs: GranularityMs): Array<{
  label: string;
  ms: GranularityMs;
  enabled: boolean;
}> {
  return GRANULARITY_OPTIONS.map((option) => ({
    label: option.label,
    ms: option.ms,
    enabled: option.ms >= minimumMs
  }));
}

function detectAggregationMode(entry: Pick<SimulationSeries, "metric" | "unit">): "sum" | "avg" {
  const unit = (entry.unit || "").toLowerCase();
  const metric = (entry.metric || "").toLowerCase();

  if (
    metric.includes("price") ||
    metric.includes("tariff") ||
    metric.includes("cost") ||
    metric.includes("omie") ||
    unit.includes("€/") ||
    unit.includes("eur")
  ) {
    return "avg";
  }

  if (unit.includes("kwh")) return "sum";
  if (metric.includes("kwh")) return "sum";

  if (unit.includes("kw")) return "avg";
  if (unit.includes("%")) return "avg";
  if (unit.includes("co2")) return "avg";
  if (unit.includes("soc")) return "avg";

  if (metric.includes("co2")) return "avg";
  if (metric.includes("soc") || metric.includes("state_of_charge")) return "avg";
  if (metric.includes("percent") || metric.includes("pct")) return "avg";

  return "avg";
}

export function buildChartRowsWithGranularity(
  series: SimulationSeries[],
  visibleSeriesIds: string[],
  rangeStart: number | null,
  rangeEnd: number | null,
  granularityMs: GranularityMs
): TimeseriesChartRow[] {
  const visibleSet = new Set(visibleSeriesIds);
  const rows = new Map<number, TimeseriesChartRow>();

  series.forEach((entry) => {
    if (!visibleSet.has(entry.id)) return;

    const mode = detectAggregationMode(entry);
    const buckets = new Map<
      number,
      { sum: number; count: number; lastTimestamp: string; lastEpoch: number; lastValue: number }
    >();

    entry.points.forEach((point) => {
      const epoch = point.epochMs;
      if (typeof epoch !== "number" || !Number.isFinite(epoch)) return;
      if (rangeStart !== null && epoch < rangeStart) return;
      if (rangeEnd !== null && epoch > rangeEnd) return;

      const bucketEpoch = alignToBoundary(epoch, granularityMs);
      const previous = buckets.get(bucketEpoch);
      if (!previous) {
        buckets.set(bucketEpoch, {
          sum: point.value,
          count: 1,
          lastTimestamp: point.timestamp,
          lastEpoch: epoch,
          lastValue: point.value
        });
        return;
      }

      previous.sum += point.value;
      previous.count += 1;
      if (epoch >= previous.lastEpoch) {
        previous.lastEpoch = epoch;
        previous.lastTimestamp = point.timestamp;
        previous.lastValue = point.value;
      }
    });

    buckets.forEach((bucket, bucketEpoch) => {
      const aggregatedValue = mode === "sum" ? bucket.sum : bucket.sum / Math.max(1, bucket.count);
      const row =
        rows.get(bucketEpoch) ??
        ({
          x: bucket.lastTimestamp || new Date(bucketEpoch).toISOString(),
          epochMs: bucketEpoch
        } as TimeseriesChartRow);
      row[entry.id] = aggregatedValue;
      rows.set(bucketEpoch, row);
    });
  });

  return Array.from(rows.values()).sort((left, right) => {
    const leftEpoch = typeof left.epochMs === "number" ? left.epochMs : 0;
    const rightEpoch = typeof right.epochMs === "number" ? right.epochMs : 0;
    return leftEpoch - rightEpoch;
  });
}

export function resolveAxisTickStepMs(
  rangeStart: number | null,
  rangeEnd: number | null,
  granularityMs: GranularityMs
): number {
  if (rangeStart === null || rangeEnd === null || rangeEnd <= rangeStart) return granularityMs;

  const span = rangeEnd - rangeStart;
  const candidates = [
    1 * MINUTE_MS,
    5 * MINUTE_MS,
    15 * MINUTE_MS,
    30 * MINUTE_MS,
    1 * HOUR_MS,
    2 * HOUR_MS,
    3 * HOUR_MS,
    6 * HOUR_MS,
    12 * HOUR_MS,
    1 * DAY_MS,
    2 * DAY_MS
  ].filter((value) => value >= granularityMs);

  const maxTicks = 24;
  for (const candidate of candidates) {
    if (span / candidate <= maxTicks) return candidate;
  }

  return candidates[candidates.length - 1] || granularityMs;
}
