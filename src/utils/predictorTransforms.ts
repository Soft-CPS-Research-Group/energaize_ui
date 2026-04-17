import {
  PredictorHistoryResponse,
  PredictorPredictionsResponse,
  PredictionHistoryEntry,
} from "../api/predictorApi";
import { format, parseISO } from "date-fns";

const SPECTRUM_LIMIT = 12;

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

    const anchor = new Date(entry.target_time);
    entry.prediction.forEach((val, step) => {
      const stepTime = new Date(anchor.getTime() + step * 15 * 60000).toISOString();
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
    if (!map.has(timeIso)) {
      map.set(timeIso, makePoint(timeIso));
    }
    return map.get(timeIso)!;
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

  // Add latest predictions (96-step arrays starting after last history point)
  if (predictions) {
    const sorted = Array.from(map.values()).sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
    );
    const anchorTime =
      sorted.length > 0 ? new Date(sorted[sorted.length - 1].time) : new Date();

    predictions.consumption?.forEach((val, i) => {
      const t = new Date(anchorTime.getTime() + (i + 1) * 15 * 60000).toISOString();
      getOrCreate(t).predictedConsumption = val;
    });
    predictions.production?.forEach((val, i) => {
      const t = new Date(anchorTime.getTime() + (i + 1) * 15 * 60000).toISOString();
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

  const data = Array.from(map.values()).sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
  );

  return { data, spectrumMeta };
}