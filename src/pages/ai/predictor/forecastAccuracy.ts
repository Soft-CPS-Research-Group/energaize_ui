import type { PredictionHistoryEntry, PredictorHistoryDataPoint, PredictorHistoryResponse } from "../../../api/predictorApi";

const SLOT_MS = 15 * 60_000;
/** Slots in one scoring window (24 h). */
const WINDOW_SLOTS = 96;
/** Both windows need half a day of measured slots before they are compared. */
const MIN_SLOTS_FOR_DELTA = 48;

export interface LaneAccuracy {
  /** Mean absolute error in kWh per 15-min slot. */
  mae: number | null;
  /** Root mean squared error in kWh per 15-min slot. */
  rmse: number | null;
  /** Weighted absolute percentage error: total absolute error over total measured energy, in %. */
  wape: number | null;
  /** Forecast values scored. */
  n: number;
  /** Measured slots those values were scored against. */
  slots: number;
  /** Current minus previous 24 h: negative = lower error. Null when either window is too thin. */
  maeDelta: number | null;
  rmseDelta: number | null;
  wapeDelta: number | null;
}

export interface ForecastAccuracy {
  consumption: LaneAccuracy;
  production: LaneAccuracy;
}

/** Milliseconds of an ISO timestamp, reading a bare one (no zone) as UTC like the rest of the predictor UI. */
function parseUtc(ts: string): number {
  return Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : ts + "Z");
}

interface WindowSums {
  abs: number;
  sq: number;
  measured: number;
  n: number;
  seen: Uint8Array;
}

function emptySums(): WindowSums {
  return { abs: 0, sq: 0, measured: 0, n: 0, seen: new Uint8Array(WINDOW_SLOTS) };
}

function scores(sums: WindowSums) {
  const slots = sums.seen.reduce((count, flag) => count + flag, 0);
  if (sums.n === 0) return { mae: null, rmse: null, wape: null, n: 0, slots };
  return {
    mae: sums.abs / sums.n,
    rmse: Math.sqrt(sums.sq / sums.n),
    // A lane that measured no energy at all (no panels) has no percentage.
    wape: sums.measured > 0 ? (sums.abs / sums.measured) * 100 : null,
    n: sums.n,
    slots,
  };
}

function laneAccuracy(entries: PredictionHistoryEntry[], actuals: PredictorHistoryDataPoint[], nowSlot: number): LaneAccuracy {
  const measured = new Map<number, number>();
  for (const point of actuals) {
    const time = parseUtc(point.timestamp);
    if (point.value != null && Number.isFinite(time)) measured.set(Math.floor(time / SLOT_MS), point.value);
  }

  // One run per quarter-hour: prediction[0] is the slot that starts at floor15(target_time).
  // A second run in the same quarter (Forecast now) replaced the first, so the newest one counts.
  const runs = new Map<number, { time: number; prediction: number[] }>();
  for (const entry of entries) {
    const time = parseUtc(entry.target_time);
    if (!Number.isFinite(time) || !entry.prediction?.length) continue;
    const anchor = Math.floor(time / SLOT_MS);
    const kept = runs.get(anchor);
    if (!kept || time >= kept.time) runs.set(anchor, { time, prediction: entry.prediction });
  }

  // Score by measured slot, not by run: every forecast made for a slot in the window counts once,
  // from the one issued just before it up to the one a day ahead. Scoring by run instead mixes in
  // runs whose later slots are not measured yet, which over-weights the easy short-range steps.
  const windowStart = nowSlot - WINDOW_SLOTS;
  const current = emptySums();
  const previous = emptySums();
  for (const [anchor, { prediction }] of runs) {
    for (let step = 0; step < prediction.length; step++) {
      const slot = anchor + step;
      if (slot >= nowSlot) break;
      const sums = slot >= windowStart ? current : slot >= windowStart - WINDOW_SLOTS ? previous : null;
      if (!sums) continue;
      const actual = measured.get(slot);
      const forecast = prediction[step];
      if (actual == null || forecast == null || !Number.isFinite(forecast)) continue;
      const error = Math.abs(actual - forecast);
      sums.abs += error;
      sums.sq += error * error;
      sums.n++;
      sums.measured += Math.abs(actual);
      sums.seen[(slot - windowStart + WINDOW_SLOTS) % WINDOW_SLOTS] = 1;
    }
  }

  const latest = scores(current);
  const before = scores(previous);
  const comparable = latest.slots >= MIN_SLOTS_FOR_DELTA && before.slots >= MIN_SLOTS_FOR_DELTA;
  const delta = (a: number | null, b: number | null) => (comparable && a != null && b != null ? a - b : null);
  return {
    ...latest,
    maeDelta: delta(latest.mae, before.mae),
    rmseDelta: delta(latest.rmse, before.rmse),
    wapeDelta: delta(latest.wape, before.wape),
  };
}

/**
 * Error of the published forecasts over the last 24 h of measured 15-min slots, per lane,
 * with the change from the 24 h before. `now` only matters to the quarter-hour.
 */
export function forecastAccuracy(
  history: PredictorHistoryResponse | undefined,
  predictionHistory: { consumption: PredictionHistoryEntry[]; production: PredictionHistoryEntry[] },
  now: number,
): ForecastAccuracy {
  const nowSlot = Math.floor(now / SLOT_MS);
  return {
    consumption: laneAccuracy(predictionHistory.consumption, history?.consumption ?? [], nowSlot),
    production: laneAccuracy(predictionHistory.production, history?.production ?? [], nowSlot),
  };
}
