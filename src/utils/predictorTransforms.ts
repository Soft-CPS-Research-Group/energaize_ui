import {
  PredictorHistoryResponse,
  PredictorHistoryDataPoint,
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
  // Most recent past prediction that covered this slot (only set where actual data exists)
  lastPredConsumption: number | null;
  lastPredProduction: number | null;
  [key: string]: string | number | null;
}

export interface SpectrumSeriesMeta {
  key: string;
  opacity: number;
  lane: "consumption" | "production";
}

export interface ForecastErrors {
  /** Weighted Mean Absolute Error in kWh */
  mae: number | null;
  /** Weighted Root Mean Squared Error in kWh */
  rmse: number | null;
  /** Weighted Mean Absolute Percentage Error (0–100). Only counts slots where actual > 0. */
  mape: number | null;
  /** Number of (prediction, actual) pairs that could be matched */
  n: number;
  /**
   * Delta vs the preceding 24 h window (current − previous).
   * Negative = improved (error went down), positive = worsened, null = no previous data.
   */
  maeDelta:  number | null;
  rmseDelta: number | null;
  mapeDelta: number | null;
}

export interface WeightedErrorResult {
  consumption: ForecastErrors;
  production: ForecastErrors;
}

export interface ChartBuildResult {
  data: ChartDataPoint[];
  spectrumMeta: SpectrumSeriesMeta[];
  /** Per-lane weighted MAE/RMSE over the last 24 h of prediction history. */
  errors: WeightedErrorResult;
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
    lastPredConsumption: null,
    lastPredProduction: null,
  };
}

/**
 * Compute inverse-recency-weighted MAE and RMSE from the last `windowHours` of prediction runs.
 *
 * Weighting rationale: recent runs benefit from lag features in the input data (recent actuals
 * fed as model inputs), making them artificially accurate. Older runs had less overlap with
 * the actuals they were compared against and represent "true" predictive skill, so they receive
 * a proportionally higher weight.
 *
 * Weight for run i (0 = oldest, N-1 = newest): w_i = N − i
 * (oldest run gets weight N, newest gets weight 1)
 */
function computeWeightedErrors(
  predHistory: { consumption: PredictionHistoryEntry[]; production: PredictionHistoryEntry[] },
  history: PredictorHistoryResponse | undefined,
  windowHours = 24
): WeightedErrorResult {
  const now = Date.now();
  const cutoff     = now - windowHours * 3_600_000;
  const prevCutoff = now - windowHours * 2 * 3_600_000;

  function computeLaneWindow(
    entries: PredictionHistoryEntry[],
    actuals: PredictorHistoryDataPoint[],
    from: number,
    to: number
  ): Omit<ForecastErrors, "maeDelta" | "rmseDelta" | "mapeDelta"> {
    const lookup = new Map<string, number>();
    for (const pt of actuals) lookup.set(normalizeTs(pt.timestamp), pt.value);

    const window = entries
      .filter((e) => {
        const t = new Date(normalizeTs(e.target_time)).getTime();
        return t >= from && t < to;
      })
      .sort((a, b) =>
        new Date(normalizeTs(a.target_time)).getTime() -
        new Date(normalizeTs(b.target_time)).getTime()
      );

    if (window.length === 0) return { mae: null, rmse: null, mape: null, n: 0 };

    const N = window.length;
    let wSumAbs = 0, wSumSq = 0, wSumPct = 0, wTotal = 0, wTotalPct = 0, totalMatched = 0;

    window.forEach((entry, idx) => {
      const w = N - idx;
      const anchor = snap15(new Date(normalizeTs(entry.target_time)));
      let localAbs = 0, localSq = 0, localPct = 0, matched = 0, matchedPct = 0;
      entry.prediction.forEach((val, step) => {
        const slotKey = normalizeTs(new Date(anchor.getTime() + step * 15 * 60_000).toISOString());
        const actual = lookup.get(slotKey);
        if (actual == null) return;
        const err = actual - val;
        localAbs += Math.abs(err);
        localSq  += err * err;
        matched++;
        // Skip near-zero actuals to avoid division-by-near-zero inflating MAPE
        if (actual > 0.05) { localPct += Math.abs(err / actual); matchedPct++; }
      });
      if (matched === 0) return;
      wSumAbs += w * (localAbs / matched);
      wSumSq  += w * (localSq  / matched);
      wTotal  += w;
      if (matchedPct > 0) { wSumPct += w * (localPct / matchedPct); wTotalPct += w; }
      totalMatched += matched;
    });

    if (wTotal === 0) return { mae: null, rmse: null, mape: null, n: 0 };
    return {
      mae:  wSumAbs / wTotal,
      rmse: Math.sqrt(wSumSq / wTotal),
      mape: wTotalPct > 0 ? (wSumPct / wTotalPct) * 100 : null,
      n:    totalMatched,
    };
  }

  function computeLane(
    entries: PredictionHistoryEntry[],
    actuals: PredictorHistoryDataPoint[]
  ): ForecastErrors {
    const curr = computeLaneWindow(entries, actuals, cutoff, now);
    const prev = computeLaneWindow(entries, actuals, prevCutoff, cutoff);
    return {
      ...curr,
      maeDelta:  curr.mae  != null && prev.mae  != null ? curr.mae  - prev.mae  : null,
      rmseDelta: curr.rmse != null && prev.rmse != null ? curr.rmse - prev.rmse : null,
      mapeDelta: curr.mape != null && prev.mape != null ? curr.mape - prev.mape : null,
    };
  }

  return {
    consumption: computeLane(predHistory.consumption, history?.consumption ?? []),
    production:  computeLane(predHistory.production,  history?.production  ?? []),
  };
}

/**
 * For each slot that already has actual data, store the value from the most recent prediction
 * run that covered that slot. Entries are processed oldest-first so later ones overwrite.
 */
function embedLastPred(
  entries: PredictionHistoryEntry[],
  lane: "consumption" | "production",
  map: Map<string, ChartDataPoint>
): void {
  if (entries.length === 0) return;

  // Sort oldest → newest so the last write wins (= most recent prediction)
  const sorted = [...entries].sort(
    (a, b) =>
      new Date(normalizeTs(a.target_time)).getTime() -
      new Date(normalizeTs(b.target_time)).getTime()
  );

  // Build slot → most-recent-value lookup
  const latestValue = new Map<string, number>();
  for (const entry of sorted) {
    const anchor = snap15(new Date(normalizeTs(entry.target_time)));
    entry.prediction.forEach((val, step) => {
      const slotKey = normalizeTs(
        new Date(anchor.getTime() + step * 15 * 60_000).toISOString()
      );
      latestValue.set(slotKey, val);
    });
  }

  // Write into chart points only where actual data exists (past only)
  for (const [key, pt] of map) {
    const val = latestValue.get(key);
    if (val == null) continue;
    if (lane === "consumption" && pt.actualConsumption != null) {
      pt.lastPredConsumption = val;
    } else if (lane === "production" && pt.actualProduction != null) {
      pt.lastPredProduction = val;
    }
  }
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

  // Compute confidence bands and last-prediction trace from prediction history
  if (predictionHistory) {
    if (predictionHistory.consumption?.length) {
      embedBands(predictionHistory.consumption, "consumption", map);
      embedLastPred(predictionHistory.consumption, "consumption", map);
    }
    if (predictionHistory.production?.length) {
      embedBands(predictionHistory.production, "production", map);
      embedLastPred(predictionHistory.production, "production", map);
    }
  }

  // Weighted error metrics (independent of the chart map)
  const errors = computeWeightedErrors(
    predictionHistory ?? { consumption: [], production: [] },
    history
  );

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

  return { data, spectrumMeta: [], errors };
}