import {
  PredictorHistoryResponse,
  PredictorPredictionsResponse,
  PredictionHistoryEntry,
} from "../api/predictorApi";
import { format, parseISO } from "date-fns";

// No hard cap — use all available history runs so the band covers the full historical range.
// The computation is O(N×M) but runs in a single synchronous pass so it stays fast in practice.
const BAND_LIMIT = Infinity;

/** Linear interpolation percentile on a pre-sorted array (p in 0–100). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Normalize any ISO timestamp to a UTC ISO key, treating bare ISO (no tz) as UTC. */
function normalizeTs(ts: string): string {
  // If there's no timezone indicator, treat as UTC (append Z) to avoid local-time misinterpretation
  const utc = /Z$|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : ts + "Z";
  return new Date(utc).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Floor a Date to the nearest 15-minute boundary.
 * target_time from the API is the wall-clock time the model ran, e.g. 21:23:32.
 * Predictions are aligned to 15-min slots, so step 0 = 21:15:00, step 1 = 21:30:00, etc.
 */
function snap15(date: Date): Date {
  return new Date(Math.floor(date.getTime() / (15 * 60_000)) * (15 * 60_000));
}

export interface ChartDataPoint {
  time: string;
  label: string;
  actualConsumption: number | null;
  actualProduction: number | null;
  predictedConsumption: number | null;
  predictedProduction: number | null;
  // Confidence bands stored as (base, height) pairs for Recharts stacked <Area>
  cBandLo: number | null;   // min across history forecasts (consumption)
  cBandHi: number | null;   // max − min (consumption outer band height)
  cBandQ1Lo: number | null; // p25 (consumption inner band base)
  cBandQ1Hi: number | null; // p75 − p25 (consumption inner band height)
  pBandLo: number | null;
  pBandHi: number | null;
  pBandQ1Lo: number | null;
  pBandQ1Hi: number | null;
  [key: string]: string | number | null;
}

export interface SpectrumSeriesMeta {
  key: string;
  opacity: number;
  lane: "consumption" | "production";
}

export interface ChartBuildResult {
  data: ChartDataPoint[];
  spectrumMeta: SpectrumSeriesMeta[];
}

function makePoint(timeIso: string): ChartDataPoint {
  return {
    time: timeIso,
    label: format(parseISO(timeIso), "HH:mm dd/MM"),
    actualConsumption: null,
    actualProduction: null,
    predictedConsumption: null,
    predictedProduction: null,
    cBandLo: null, cBandHi: null, cBandQ1Lo: null, cBandQ1Hi: null,
    pBandLo: null, pBandHi: null, pBandQ1Lo: null, pBandQ1Hi: null,
  };
}

/** Compute min/max/IQR confidence bands from prediction history and write into the chart map. */
function embedBands(
  entries: PredictionHistoryEntry[],
  lane: "consumption" | "production",
  map: Map<string, ChartDataPoint>
): void {
  if (entries.length === 0) return;
  // Apply limit only if it is finite (currently unlimited)
  const limited = isFinite(BAND_LIMIT) ? entries.slice(-BAND_LIMIT) : entries;

  // Accumulate all prediction values per 15-min slot across all history runs
  const slotValues = new Map<string, number[]>();
  for (const entry of limited) {
    // normalizeTs treats bare ISO (no tz suffix) as UTC — must be consistent with actual history slots
    const anchor = snap15(new Date(normalizeTs(entry.target_time)));
    entry.prediction.forEach((val, step) => {
      const slotKey = normalizeTs(new Date(anchor.getTime() + step * 15 * 60_000).toISOString());
      if (!slotValues.has(slotKey)) slotValues.set(slotKey, []);
      slotValues.get(slotKey)!.push(val);
    });
  }

  // Derive stats per slot and write into the chart map
  for (const [slotKey, vals] of slotValues) {
    if (vals.length === 0) continue;
    const sorted = [...vals].sort((a, b) => a - b);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    const q1 = percentile(sorted, 25);
    const q3 = percentile(sorted, 75);
    if (!map.has(slotKey)) map.set(slotKey, makePoint(slotKey));
    const pt = map.get(slotKey)!;
    if (lane === "consumption") {
      pt.cBandLo = lo;  pt.cBandHi = hi - lo;
      pt.cBandQ1Lo = q1;  pt.cBandQ1Hi = q3 - q1;
    } else {
      pt.pBandLo = lo;  pt.pBandHi = hi - lo;
      pt.pBandQ1Lo = q1;  pt.pBandQ1Hi = q3 - q1;
    }
  }
}

export function buildPredictorTimeline(
  history?: PredictorHistoryResponse,
  predictions?: PredictorPredictionsResponse,
  predictionHistory?: {
    consumption: PredictionHistoryEntry[];
    production: PredictionHistoryEntry[];
  }
): ChartBuildResult {
  const map = new Map<string, ChartDataPoint>();

  function getOrCreate(timeIso: string): ChartDataPoint {
    const key = normalizeTs(timeIso);
    if (!map.has(key)) {
      map.set(key, makePoint(key));
    }
    return map.get(key)!;
  }

  // Add actual history
  if (history) {
    history.consumption?.forEach((pt) => {
      getOrCreate(pt.timestamp).actualConsumption = pt.value ?? null;
    });
    history.production?.forEach((pt) => {
      getOrCreate(pt.timestamp).actualProduction = pt.value ?? null;
    });
  }

  // Add latest predictions anchored at the snapped target_time
  if (predictions) {
    const anchor = predictions.target_time
      ? snap15(new Date(predictions.target_time))
      : (() => {
          const sorted = Array.from(map.values()).sort(
            (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
          );
          return sorted.length > 0 ? snap15(new Date(sorted[sorted.length - 1].time)) : snap15(new Date());
        })();

    predictions.consumption?.forEach((val, i) => {
      const t = normalizeTs(new Date(anchor.getTime() + i * 15 * 60_000).toISOString());
      getOrCreate(t).predictedConsumption = val;
    });
    predictions.production?.forEach((val, i) => {
      const t = normalizeTs(new Date(anchor.getTime() + i * 15 * 60_000).toISOString());
      getOrCreate(t).predictedProduction = val;
    });
  }

  // Compute confidence bands from prediction history
  if (predictionHistory) {
    if (predictionHistory.consumption?.length) {
      embedBands(predictionHistory.consumption, "consumption", map);
    }
    if (predictionHistory.production?.length) {
      embedBands(predictionHistory.production, "production", map);
    }
  }

  // Keep slots that have actual, predicted, or band data
  const data = Array.from(map.values())
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .filter(
      (pt) =>
        pt.actualConsumption    != null ||
        pt.actualProduction     != null ||
        pt.predictedConsumption != null ||
        pt.predictedProduction  != null ||
        pt.cBandLo              != null ||
        pt.pBandLo              != null
    );

  return { data, spectrumMeta: [] };
}