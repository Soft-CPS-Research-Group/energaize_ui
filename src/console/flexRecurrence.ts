import { RRule } from "rrule";
type FlexEvent = {
  event_id?: string;
  mode?: string;
  starts_at: string;
  ends_at: string;
  timezone?: string;
  recurrence?: {
    freq: string;
    interval?: number;
    count?: number;
    until?: string;
    by_day?: string;
  } | null;
  [key: string]: unknown;
};
/** RRule's TZID dates use UTC fields to express local wall-clock time. */
function wallTime(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const n = (key: string) => Number(parts.find((p) => p.type === key)?.value);
  return new Date(
    Date.UTC(
      n("year"),
      n("month") - 1,
      n("day"),
      n("hour"),
      n("minute"),
      n("second"),
    ),
  );
}
function instantFromWall(date: Date, zone: string) {
  let candidate = new Date(date);
  for (let i = 0; i < 3; i++) {
    const offset = wallTime(candidate, zone).getTime() - candidate.getTime();
    const next = new Date(date.getTime() - offset);
    if (next.getTime() === candidate.getTime()) break;
    candidate = next;
  }
  return candidate;
}
export function expandFlexEvents(
  events: FlexEvent[],
  from: Date,
  to: Date,
): FlexEvent[] {
  return events.flatMap((event) => {
    const start = new Date(event.starts_at),
      end = new Date(event.ends_at),
      duration = end.getTime() - start.getTime();
    if (!Number.isFinite(duration) || duration <= 0) return [];
    if (event.mode !== "recurrent" || !event.recurrence)
      return start < to && end > from ? [event] : [];
    try {
      const r = event.recurrence,
        zone = event.timezone || "Europe/Lisbon";
      const freq = {
        DAILY: RRule.DAILY,
        WEEKLY: RRule.WEEKLY,
        MONTHLY: RRule.MONTHLY,
      }[r.freq];
      if (freq === undefined) return [];
      const weekdays = {
        MO: RRule.MO,
        TU: RRule.TU,
        WE: RRule.WE,
        TH: RRule.TH,
        FR: RRule.FR,
        SA: RRule.SA,
        SU: RRule.SU,
      };
      const rule = new RRule({
        freq,
        dtstart: wallTime(start, zone),

        interval: r.interval || 1,
        count: r.count,
        until: r.until ? wallTime(new Date(r.until), zone) : undefined,
        byweekday: r.by_day
          ?.split(",")
          .map((d) => weekdays[d.trim() as keyof typeof weekdays]),
      });
      return rule
        .between(
          new Date(from.getTime() - duration - 172800000),
          new Date(to.getTime() + 172800000),
          true,
        )
        .map((d) => instantFromWall(d, zone))
        .filter((d) => d < to && d.getTime() + duration > from.getTime())
        .map((d) => ({
          ...event,
          starts_at: d.toISOString(),
          ends_at: new Date(d.getTime() + duration).toISOString(),
          series_starts_at: event.starts_at,
        }));
    } catch {
      return start < to && end > from
        ? [{ ...event, recurrence_error: true }]
        : [];
    }
  });
}
