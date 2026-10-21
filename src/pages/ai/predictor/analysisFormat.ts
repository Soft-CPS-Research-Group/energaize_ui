import { normalizeTs } from "../../../utils/predictorTransforms";

export const LANE_LABELS: Record<string, string> = { consumption: "Consumption", production: "Production" };
export const VARIANT_LABELS: Record<string, string> = { warm: "Warm", cold_start: "Cold start" };
export const BACKEND_LABELS: Record<string, string> = { xgboost: "XGBoost", lgbm: "LightGBM", lstm: "LSTM" };

/** The analysis endpoints accept 7 to 365 days of history. */
export const TEST_DAYS_MIN = 7;
export const TEST_DAYS_MAX = 365;
export const testDaysValid = (days: number, max = TEST_DAYS_MAX) => Number.isInteger(days) && days >= TEST_DAYS_MIN && days <= max;

export function fmt(v: number | null | undefined, d = 4): string {
  if (v == null) return "—";
  return v.toFixed(d);
}
/** Parameter values come back as floats such as 0.060000000000000005. */
export function fmtParam(v: number | null | undefined): string {
  if (v == null) return "—";
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4)));
}
export function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(2)}%`;
}
export function fmtTs(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  const date = new Date(normalizeTs(iso));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(date);
}

export const DETAIL_LABELS: Record<string, string> = {
  model_key: "Model", house_id: "House", lane: "Lane", model_type: "Variant", model_backend: "Type",
  active: "In use", file_path: "File", file_size_kb: "Size", stored_mae: "Stored MAE",
  n_features: "Features", n_outputs: "Outputs", model_schema: "Feature schema",
};

export function formatDetail(key: string, value: unknown): string {
  if (value == null) return key === "house_id" ? "Generic" : "—";
  if (key === "lane") return LANE_LABELS[String(value)] ?? String(value);
  if (key === "model_type") return VARIANT_LABELS[String(value)] ?? String(value);
  if (key === "model_backend") return BACKEND_LABELS[String(value)] ?? String(value);
  if (key === "active") return value ? "Yes" : "No";
  if (key === "file_size_kb" && typeof value === "number") return `${value.toFixed(1)} KB`;
  if (key === "stored_mae" && typeof value === "number") return `${fmt(value)} kWh`;
  return String(value);
}

/**
 * Short names for chart labels. Keys look like "xgboost_consumption_R-H-01" or
 * "old/xgboost_consumption_R-H-01_20261001_143005"; within one compare job the house and lane
 * are the same for every model, so the backend (and archive date) tells them apart.
 * Any label that would still be ambiguous falls back to the full key.
 */
export function modelLabels(keys: string[]): Record<string, string> {
  const short = keys.map((key) => {
    const archived = key.startsWith("old/");
    const stem = archived ? key.slice(4) : key;
    const [backend] = stem.split("_");
    const name = BACKEND_LABELS[backend] ?? backend;
    if (!archived) return name;
    // The predictor archives as <stem>_YYYYMMDD_HHMMSS.
    const date = stem.match(/_(\d{4})(\d{2})(\d{2})(?:_(\d{2})(\d{2})\d{2})?$/);
    if (!date) return `${name}, archived`;
    return `${name}, archived ${date[1]}-${date[2]}-${date[3]}${date[4] ? ` ${date[4]}:${date[5]}` : ""}`;
  });
  return Object.fromEntries(keys.map((key, i) => [key, short.filter((s) => s === short[i]).length > 1 ? key : short[i]]));
}

export const SEGMENT_LABELS: Record<string, string> = {
  weekday_weekend: "Weekday vs weekend",
  season: "Season",
  hour_of_day: "Time of day",
};

export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
