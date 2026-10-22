import type { DataQualityResponse, LaneDataQuality, MeterSpec, RefusalReason } from "../../../api/predictorApi";
import type { ForecastNotice } from "./forecastStatus";

const LANES = ["consumption", "production"] as const;
const LANE_NAMES = { consumption: "Consumption", production: "Production" } as const;

/** Where the predictor got the meter unit from. */
export const METER_SOURCE_LABELS: Record<string, string> = {
  declared: "Declared",
  model: "As trained",
  "legacy-model": "Old rule",
  detected: "Detected",
};

export const METER_SOURCE_TIPS: Record<string, string> = {
  declared: "Set in the predictor's house_units.json, so it is never guessed.",
  model: "Read the same way the model was trained to read it.",
  "legacy-model": "The model predates unit detection, so the data is read with the old rule (values up to 5 are kWh). Retrain to record the unit.",
  detected: "Detected from the readings: the unit that gives a plausible household power at the measured reading interval.",
};

const REFUSAL_TEXT: Record<RefusalReason, string> = {
  "pre-kwh-fix": "its model was trained before kW readings were converted to kWh",
  "meter-changed": "the meter is now read differently from how its model was trained",
  "unit-mismatch": "its model was trained with the wrong meter unit",
  "scale-drift": "the recent readings are on a very different scale from the training data",
  "low-confidence": "the meter unit is uncertain and uncertain units are set not to publish",
};

export function refusalText(reason: string): string {
  return REFUSAL_TEXT[reason as RefusalReason] ?? reason;
}

const UNIT_NAMES: Record<MeterSpec["unit"], string> = { kwh: "kWh", kw: "kW", wh: "Wh", w: "W" };

/** Short unit name, e.g. "kW", "Wh counter", "kWh, sign flipped". */
export function meterUnitLabel(spec: MeterSpec | null | undefined): string {
  if (!spec) return "—";
  let text = UNIT_NAMES[spec.unit] ?? spec.unit;
  if (spec.cumulative) text += " counter";
  if (spec.negated) text += ", sign flipped";
  return text;
}

export function coveragePct(lane: LaneDataQuality | undefined): number | null {
  const w = lane?.window;
  return w && w.slots_total > 0 ? (w.slots_with_data / w.slots_total) * 100 : null;
}

/** Readings the predictor left out of the last window: duplicates, unreadable, negative and implausible values. */
export function droppedReadings(lane: LaneDataQuality | undefined): number {
  const w = lane?.window;
  if (!w) return 0;
  return w.duplicates + w.unreadable + w.negatives_dropped + w.spikes_dropped + w.counter_resets;
}

/** Warnings for the Predict tab: lanes that publish nothing, and units the predictor is unsure of. */
export function inputNotices(houseId: string, dq: DataQualityResponse | undefined): ForecastNotice[] {
  if (!dq) return [];
  const notices: ForecastNotice[] = [];
  for (const lane of LANES) {
    const q = dq.lanes[lane];
    if (!q) continue;
    if (q.refused) {
      notices.push({
        tone: "warning",
        title: `${LANE_NAMES[lane]} forecast not published`,
        message: `The predictor publishes nothing for ${houseId} ${lane} because ${refusalText(q.refused.reason)}. Retrain this house (Train tab) to fix it.`,
      });
      continue;
    }
    const meter = q.meter;
    if (meter && meter.source !== "declared" && meter.confidence === "low") {
      notices.push({
        tone: "info",
        title: `${LANE_NAMES[lane]} unit is a best guess`,
        message: `The predictor reads this meter as "${meter.label}" but could not rule out another unit. Forecasts are still published; declaring the unit in house_units.json removes the doubt.`,
      });
    } else if (meter && meter.confidence === "none" && meter.source === "detected") {
      notices.push({
        tone: "info",
        title: `${LANE_NAMES[lane]} unit not detected`,
        message: "There are too few readings to tell the meter's unit, so it is read as kWh per reading.",
      });
    }
  }
  return notices;
}
