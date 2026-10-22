// Scheduler job form logic, kept out of the page so it can be tested.

export interface JobForm {
  id: string;
  community: string;
  buildings: string[];
  kpis: string[];
  cron: string;
  lookback: string;
}

export type Frequency = "hourly" | "daily" | "weekly";

export const EMPTY_JOB_FORM: JobForm = {
  id: "",
  community: "*",
  buildings: ["*"],
  kpis: [],
  cron: "5 * * * *",
  lookback: "1h",
};

export const CRON_PRESETS: Array<{ label: string; cron: string; freq: Frequency; min: number; hr: number; day: number }> = [
  { label: "Every hour",     cron: "5 * * * *",   freq: "hourly", min: 5, hr: 0, day: 1 },
  { label: "Every 2 hours",  cron: "5 */2 * * *", freq: "hourly", min: 5, hr: 0, day: 1 },
  { label: "Every 6 hours",  cron: "5 */6 * * *", freq: "hourly", min: 5, hr: 0, day: 1 },
  { label: "Daily midnight", cron: "5 0 * * *",   freq: "daily",  min: 5, hr: 0, day: 1 },
  { label: "Weekly Monday",  cron: "5 0 * * 1",   freq: "weekly", min: 5, hr: 0, day: 1 },
];

/** 5-field UTC cron for a frequency; `day` is 1 = Monday … 7 = Sunday. */
export function buildCron(freq: Frequency, minute: number, hour: number, day: number): string {
  if (freq === "hourly") return `${minute} * * * *`;
  if (freq === "daily") return `${minute} ${hour} * * *`;
  return `${minute} ${hour} * * ${day}`;
}

const LOOKBACK = /^\d+(m|h|d|w|mo|y)$/;

export function isValidLookback(lookback: string): boolean {
  return LOOKBACK.test(lookback.trim().toLowerCase());
}

/**
 * Lookback fields for the jobs API. Hours and days use the legacy
 * lookback_hours/lookback_days fields, which every KPI module version accepts;
 * other units (15m, 1w, 1mo, 1y) need the `lookback` string, supported since the
 * KPI module's dev branch. Sending "1w" as days would silently mean one day.
 */
export function lookbackPayload(lookback: string): { lookback: string } | { lookback_hours: number; lookback_days: number } {
  const value = lookback.trim().toLowerCase();
  const legacy = /^(\d+)([hd])$/.exec(value);
  if (legacy) {
    const n = Number(legacy[1]);
    return legacy[2] === "h" ? { lookback_hours: n, lookback_days: 0 } : { lookback_hours: 0, lookback_days: n };
  }
  return { lookback: value };
}

export function jobPayload(form: JobForm) {
  return {
    id: form.id,
    community: form.community,
    buildings: form.buildings,
    kpis: form.kpis,
    cron: form.cron,
    ...lookbackPayload(form.lookback),
  };
}
