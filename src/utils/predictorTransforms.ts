import {
  PredictorHistoryResponse,
  PredictorPredictionsResponse,
  PredictionHistoryEntry,
} from "../api/predictorApi";
import { format, parseISO } from "date-fns";

const SPECTRUM_LIMIT = 12;

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
  };
}

function embedSpectrum(
  entries: PredictionHistoryEntry[],
  lane: "consumption" | "production",
  map: Map<string, ChartDataPoint>
): SpectrumSeriesMeta[] {
  const limited = entries.slice(-SPECTRUM_LIMIT);
  const meta: SpectrumSeriesMeta[] = [];

  limited.forEach((entry, idx) => {
    const key = `spec_${lane}_${idx}`;
    // Age-based opacity: oldest ≈ 0.06, newest ≈ 0.32
    const opacity = 0.06 + (idx / Math.max(1, limited.length - 1)) * 0.26;
    meta.push({ key, opacity, lane });

    const anchor = snap15(new Date(entry.target_time));
    entry.prediction.forEach((val, step) => {
      const stepTime = normalizeTs(new Date(anchor.getTime() + step * 15 * 60_000).toISOString());
      if (!map.has(stepTime)) {
        map.set(stepTime, makePoint(stepTime));
      }
      (map.get(stepTime) as ChartDataPoint)[key] = val;
    });
  });

  return meta;
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

  // Add prediction history spectrum
  const spectrumMeta: SpectrumSeriesMeta[] = [];
  if (predictionHistory) {
    if (predictionHistory.consumption?.length) {
      spectrumMeta.push(...embedSpectrum(predictionHistory.consumption, "consumption", map));
    }
    if (predictionHistory.production?.length) {
      spectrumMeta.push(...embedSpectrum(predictionHistory.production, "production", map));
    }
  }

  // Only keep slots that have actual or predicted data — spec-only slots create
  // visual gaps in the chart for periods with no readings or forecasts.
  const data = Array.from(map.values())
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .filter(
      (pt) =>
        pt.actualConsumption    != null ||
        pt.actualProduction     != null ||
        pt.predictedConsumption != null ||
        pt.predictedProduction  != null
    );

  return { data, spectrumMeta };
}