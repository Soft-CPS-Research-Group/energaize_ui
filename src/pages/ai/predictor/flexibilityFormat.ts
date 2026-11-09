import type { FlexAsset, FlexForecastSource, FlexJobStatus, FlexWindow } from "../../../api/predictorApi";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

/** One-word status of a job: what Flexibility got from the predictor. */
export function jobBadge(job: { status: FlexJobStatus; delivery: "delivered" | "lost" } | null | undefined): { label: string; tone: Tone } {
  if (!job) return { label: "Waiting", tone: "neutral" };
  if (job.delivery === "lost") return { label: "Lost", tone: "danger" };
  if (job.status === "completed") return { label: "Forecast", tone: "success" };
  if (job.status === "insufficient_data") return { label: "Insufficient", tone: "warning" };
  return { label: "Failed", tone: "danger" };
}

export function jobBadgeTip(job: { status: FlexJobStatus; delivery: "delivered" | "lost" } | null | undefined): string {
  if (!job) return "No job for this charger yet.";
  if (job.delivery === "lost") return "Flexibility did not take the result (the lease expired or it was unreachable). It hands the job out again.";
  if (job.status === "completed") return "Plug-in windows were sent to Flexibility.";
  if (job.status === "insufficient_data") return "Not enough charging history to forecast; Flexibility was told so.";
  return "The forecast failed; Flexibility was told why.";
}

const TARGET_LABELS: Record<string, string> = {
  arrival: "arrival",
  duration: "dwell",
  soc_start: "SoC at arrival",
  soc_stop: "SoC at departure",
};

/** Which forest made the forecast: the charger's own history, the fleet's, or a mix per target. */
export function sourceSummary(sources: Record<string, FlexForecastSource> | null | undefined): string | null {
  if (!sources) return null;
  const entries = Object.entries(sources);
  if (entries.length === 0) return null;
  const fleet = entries.filter(([, source]) => source === "global").map(([target]) => TARGET_LABELS[target] ?? target);
  if (fleet.length === 0) return "Own history";
  if (fleet.length === entries.length) return "Fleet forest";
  return `Fleet forest for ${fleet.join(", ")}`;
}

export function modelLabel(model: { name: string; version: string } | null | undefined): string {
  if (!model) return "—";
  if (model.name === "flex-qrf") return "Quantile forest";
  if (model.name === "flex-kde") return "Kernel density";
  return model.name;
}

export function formatSoc(fraction: number | null | undefined): string {
  return fraction == null ? "—" : `${Math.round(fraction * 100)}%`;
}

export function formatSocChange(window: Pick<FlexWindow, "soc_at_arrival" | "soc_at_departure">): string | null {
  if (window.soc_at_arrival == null && window.soc_at_departure == null) return null;
  return `${formatSoc(window.soc_at_arrival)} → ${formatSoc(window.soc_at_departure)}`;
}

export interface TimelineBar {
  /** Percent of the horizon from its start: the median plug-in session. */
  left: number;
  width: number;
  /** Percent span from the early arrival (P10) to the late departure (P90). */
  rangeLeft: number;
  rangeWidth: number;
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** Where a window sits on a horizontal bar spanning [fromAt, untilAt]. */
export function timelineBar(window: FlexWindow, fromAt: string, untilAt: string): TimelineBar {
  const start = Date.parse(fromAt);
  const span = Math.max(1, Date.parse(untilAt) - start);
  const at = (iso: string) => clamp(((Date.parse(iso) - start) / span) * 100);
  const left = at(window.starts_at);
  const rangeLeft = Math.min(at(window.arrival_range.p10), left);
  const right = at(window.ends_at);
  const rangeRight = Math.max(at(window.departure_range.p90), right);
  return { left, width: Math.max(0.5, right - left), rangeLeft, rangeWidth: Math.max(0.5, rangeRight - rangeLeft) };
}

/** Day boundaries inside the horizon, in *timezone*, as percent positions with a short label. */
export function dayTicks(fromAt: string, untilAt: string, timezone: string): { left: number; label: string }[] {
  const start = Date.parse(fromAt);
  const end = Date.parse(untilAt);
  if (!(end > start)) return [];
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric" });
  const hourOf = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const ticks: { left: number; label: string }[] = [];
  // Walk hour by hour and keep local midnights (works across daylight-saving changes).
  for (let t = Math.ceil(start / 3_600_000) * 3_600_000; t < end && ticks.length < 62; t += 3_600_000) {
    if (hourOf.format(t) === "00:00") ticks.push({ left: ((t - start) / (end - start)) * 100, label: label.format(t) });
  }
  return ticks;
}

/** The chargers of the houses in the workspace; every charger in the Laboratory (houses = null). */
export function assetsInScope(assets: FlexAsset[], houses: string[] | null): FlexAsset[] {
  if (!houses) return assets;
  const allowed = new Set(houses);
  return assets.filter((asset) => asset.house_id != null && allowed.has(asset.house_id));
}

export function chargerName(asset: Pick<FlexAsset, "house_id" | "charger_id" | "asset_id">): string {
  if (asset.house_id && asset.charger_id) return `${asset.house_id} · ${asset.charger_id}`;
  return asset.charger_id ?? asset.house_id ?? asset.asset_id.slice(0, 8);
}
