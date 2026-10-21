import type { LogEntry } from "../../../api/predictorApi";
import { normalizeTs } from "../../../utils/predictorTransforms";

/**
 * The predictor writes two formats, both in container time (UTC):
 *   log file  (GET /api/logs): "2026-10-20 10:00:00,123 | INFO | env | component | message"
 *   live feed (/ws/logs):      "10:00:00 | INFO     | message"
 * `time` is returned as an ISO string so it can be shown in the chosen timezone.
 */
export function parseLogLine(raw: string, now: number = Date.now()): LogEntry {
  const parts = raw.split(" | ");
  if (parts.length >= 5 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(parts[0])) {
    return {
      raw,
      time: normalizeTs(parts[0].trim().replace(" ", "T").replace(",", ".")),
      level: parts[1].trim(),
      logger: parts[3].trim(),
      message: parts.slice(4).join(" | ").trim(),
    };
  }
  if (parts.length >= 3 && /^\d{2}:\d{2}:\d{2}$/.test(parts[0].trim())) {
    return { raw, time: clockTimeToIso(parts[0].trim(), now), level: parts[1].trim(), logger: "", message: parts.slice(2).join(" | ").trim() };
  }
  return { raw, time: "", level: "", logger: "", message: raw.trim() };
}

/** A bare HH:MM:SS from the live feed, placed on today's UTC date (yesterday if that is in the future). */
function clockTimeToIso(clock: string, now: number): string {
  const day = new Date(now).toISOString().slice(0, 10);
  let time = Date.parse(`${day}T${clock}Z`);
  if (time - now > 60_000) time -= 86_400_000;
  return new Date(time).toISOString();
}

/** Same rule as the server's ?filter=: a case-insensitive substring of the whole line. */
export function lineMatches(entry: LogEntry, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  return !needle || entry.raw.toLowerCase().includes(needle);
}
