import { PredictorHistoryResponse, PredictorPredictionsResponse } from "../api/predictorApi";
import { format, parseISO } from "date-fns";

export interface ChartDataPoint {
  time: string;
  label: string;
  actualConsumption: number | null;
  actualProduction: number | null;
  predictedConsumption: number | null;
  predictedProduction: number | null;
}

export function buildPredictorTimeline(
  history?: PredictorHistoryResponse,
  predictions?: PredictorPredictionsResponse
): ChartDataPoint[] {
  const map = new Map<string, ChartDataPoint>();

  function getOrCreate(timeIso: string): ChartDataPoint {
    if (!map.has(timeIso)) {
      map.set(timeIso, {
        time: timeIso,
        label: format(parseISO(timeIso), "HH:mm\ndd/MM"),
        actualConsumption: null,
        actualProduction: null,
        predictedConsumption: null,
        predictedProduction: null,
      });
    }
    return map.get(timeIso)!;
  }

  // Add history
  if (history) {
    history.consumption?.forEach((pt) => {
      const entry = getOrCreate(pt.timestamp);
      entry.actualConsumption = pt.value ?? null;
    });
    history.production?.forEach((pt) => {
      const entry = getOrCreate(pt.timestamp);
      entry.actualProduction = pt.value ?? null;
    });
  }

  // Add predictions
  // Predictions start right where the history ends, or "now"
  // They are simple arrays of numbers, 1 step = 15 minutes
  if (predictions) {
    const sortedVals = Array.from(map.values()).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    let anchorTime = sortedVals.length > 0 
      ? new Date(sortedVals[sortedVals.length - 1].time) 
      : new Date();
    
    // If the anchor strictly lacks a value, we jump forward:
    
    predictions.consumption?.forEach((val, i) => {
      const stepTime = new Date(anchorTime.getTime() + (i + 1) * 15 * 60000).toISOString();
      const entry = getOrCreate(stepTime);
      entry.predictedConsumption = val;
    });
    predictions.production?.forEach((val, i) => {
      const stepTime = new Date(anchorTime.getTime() + (i + 1) * 15 * 60000).toISOString();
      const entry = getOrCreate(stepTime);
      entry.predictedProduction = val;
    });
  }

  // Sort chronologically
  return Array.from(map.values()).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}