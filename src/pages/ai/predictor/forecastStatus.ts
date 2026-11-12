import type { PredictorHistoryResponse, PredictorPredictionsResponse } from "../../../api/predictorApi";
import { normalizeTs, snap15 } from "../../../utils/predictorTransforms";

/** A forecast older than this is no longer the one the scheduler would have published. */
export const STALE_AFTER_MINUTES = 30;
/** History is stored per 15-min slot, so a delay up to an hour is normal meter latency. */
export const METER_LAG_WARN_MINUTES = 60;
const SLOT_MS = 15 * 60_000;

export interface ForecastNotice {
  tone: "warning" | "info";
  title: string;
  message: string;
}

export function hasForecast(predictions: PredictorPredictionsResponse | undefined): boolean {
  return !!predictions?.target_time && !!(predictions.consumption?.length || predictions.production?.length);
}

export function minutesSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const time = new Date(normalizeTs(iso)).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((now - time) / 60_000));
}

/** "Published 09:03:12 UTC (10:03 Europe/Lisbon)": target_time is the cycle time in UTC. */
export function forecastTimeTitle(targetTime: string, timezone: string): string {
  const date = new Date(normalizeTs(targetTime));
  if (Number.isNaN(date.getTime())) return "";
  const utc = date.toISOString().slice(11, 19);
  if (timezone === "UTC") return `Published ${utc} UTC`;
  const local = date.toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
  return `Published ${utc} UTC (${local} ${timezone})`;
}

export function formatAge(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min ago` : `${hours} h ago`;
  }
  return `${Math.floor(hours / 24)} days ago`;
}

/** End of the newest metered slot across both lanes, as an ISO string. */
export function meterDataEnd(history: PredictorHistoryResponse | undefined): string | null {
  let latest = -Infinity;
  for (const point of [...(history?.consumption ?? []), ...(history?.production ?? [])]) {
    if (point.value == null) continue;
    const time = new Date(normalizeTs(point.timestamp)).getTime();
    if (time > latest) latest = time;
  }
  return Number.isFinite(latest) ? new Date(latest + SLOT_MS).toISOString() : null;
}

/** Chart key of the 15-min slot that contains `now`, matching the keys of buildPredictorTimeline. */
export function currentSlotKey(now: number): string {
  return normalizeTs(snap15(new Date(now)).toISOString());
}

/** Latest chart slot at or before `slotKey`, so the Now line lands on a category that exists. */
export function nowLineSlot(times: string[], slotKey: string): string | null {
  let found: string | null = null;
  for (const time of times) {
    if (time <= slotKey) found = time;
    else break;
  }
  return found;
}

export function forecastNotices({
  houseId,
  predictions,
  history,
  paused,
  now,
  formatTime,
}: {
  houseId: string;
  predictions: PredictorPredictionsResponse | undefined;
  history: PredictorHistoryResponse | undefined;
  paused: boolean;
  now: number;
  formatTime: (iso: string) => string;
}): ForecastNotice[] {
  const notices: ForecastNotice[] = [];

  if (predictions && !hasForecast(predictions)) {
    notices.push({
      tone: "warning",
      title: "No forecast yet",
      message: `The predictor has not published a forecast for ${houseId} since it last started. New houses, and houses whose meters report kW, need a retrained model first (Train tab). After a restart, the first forecasts arrive with the next 15-minute cycle.`,
    });
  } else {
    const age = minutesSince(predictions?.target_time, now);
    if (age != null && age > STALE_AFTER_MINUTES) {
      notices.push(
        paused
          ? {
              tone: "info",
              title: `Forecast from ${formatAge(age)}`,
              message: "Scheduled forecasts are paused, so this is the last one published.",
            }
          : {
              tone: "warning",
              title: `Forecast from ${formatAge(age)}`,
              message: "Later cycles did not publish a forecast for this house, so the last good one is still shown. The logs say why.",
            }
      );
    }
  }

  if (history) {
    const end = meterDataEnd(history);
    const lag = minutesSince(end, now);
    if (end == null) {
      notices.push({ tone: "info", title: "No meter data", message: "No measurements were found for this house in the last 3 days." });
    } else if (lag != null && lag > METER_LAG_WARN_MINUTES) {
      notices.push({
        tone: "info",
        title: `Meter data last seen ${formatAge(lag)}`,
        message: `Measurements stop at ${formatTime(end)}, so accuracy is only measured up to then.`,
      });
    }
  }

  return notices;
}
