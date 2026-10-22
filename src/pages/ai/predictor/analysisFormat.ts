import { normalizeTs } from "../../../utils/predictorTransforms";
import type { Lane, ModelMeta, ModelUse } from "../../../api/analysisApi";

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
  active: "In use", in_use_by: "Used by", file_path: "File", file_size_kb: "Size", stored_mae: "Stored MAE",
  n_features: "Features", n_outputs: "Outputs", model_schema: "Feature schema",
};

export function formatDetail(key: string, value: unknown): string {
  if (value == null) return key === "house_id" ? "Generic" : "—";
  if (key === "lane") return LANE_LABELS[String(value)] ?? String(value);
  if (key === "model_type") return VARIANT_LABELS[String(value)] ?? String(value);
  if (key === "model_backend") return BACKEND_LABELS[String(value)] ?? String(value);
  if (key === "active") return value ? "Yes" : "No";
  if (key === "in_use_by" && Array.isArray(value)) {
    if (value.length === 0) return "—";
    return (value as ModelUse[]).map((u) => `${u.house_id} (${LANE_LABELS[u.lane] ?? u.lane})`).join(", ");
  }
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

// ─── Models in use ────────────────────────────────────────────────────────────

/** Where a model is used; older predictor builds only send `active` for house models. */
export function usesOf(m: ModelMeta): ModelUse[] {
  if (m.in_use_by) return m.in_use_by;
  if (m.active === true && m.house_id) return [{ house_id: m.house_id, lane: m.lane, model_kind: m.model_type, confirmed: true }];
  return [];
}

export interface HouseInUse {
  house_id: string;
  lanes: Partial<Record<Lane, { model: ModelMeta; use: ModelUse }>>;
}

/** One row per house with the model each lane forecasts with, and the generic models with the houses using them. */
export function modelsInUse(models: ModelMeta[]): { houses: HouseInUse[]; generic: { model: ModelMeta; houses: string[] }[] } {
  const byHouse = new Map<string, HouseInUse>();
  const generic: { model: ModelMeta; houses: string[] }[] = [];
  for (const model of models) {
    if (model.model_key.startsWith("old/")) continue;
    const uses = usesOf(model);
    if (!model.house_id) generic.push({ model, houses: [...new Set(uses.map((u) => u.house_id))].sort() });
    for (const use of uses) {
      const row = byHouse.get(use.house_id) ?? { house_id: use.house_id, lanes: {} };
      row.lanes[use.lane] = { model, use };
      byHouse.set(use.house_id, row);
    }
  }
  const houses = [...byHouse.values()].sort((a, b) => a.house_id.localeCompare(b.house_id));
  generic.sort((a, b) => a.model.lane.localeCompare(b.model.lane) || a.model.model_key.localeCompare(b.model.model_key));
  return { houses, generic };
}

/**
 * The model list after `chosen` was set as active, so the table shows it at once:
 * it takes over its house + lane from whichever model had it.
 */
export function markInUse(models: ModelMeta[], chosen: ModelMeta): ModelMeta[] {
  if (!chosen.house_id) return models;
  const isLane = (u: ModelUse) => u.house_id === chosen.house_id && u.lane === chosen.lane;
  const use: ModelUse = { house_id: chosen.house_id, lane: chosen.lane, model_kind: "warm", confirmed: false };
  return models.map((m) => {
    if (m.model_key.startsWith("old/")) return m;
    const rest = usesOf(m).filter((u) => !isLane(u));
    const uses = m.model_key === chosen.model_key ? [...rest, use] : rest;
    return { ...m, in_use_by: uses, active: uses.length > 0 };
  });
}

/** "In use" pill text: generic models say how many houses they cover. */
export function inUseLabel(m: ModelMeta): string | null {
  const uses = usesOf(m);
  if (uses.length === 0) return null;
  if (m.house_id) return "In use";
  const houses = new Set(uses.map((u) => u.house_id)).size;
  return `In use · ${houses} ${houses === 1 ? "house" : "houses"}`;
}

/** Models split per house (sorted), generic models last; each group keeps the given order. */
export function groupByHouse(models: ModelMeta[]): { house: string | null; models: ModelMeta[] }[] {
  const groups = new Map<string | null, ModelMeta[]>();
  for (const m of models) groups.set(m.house_id, [...(groups.get(m.house_id) ?? []), m]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a == null ? 1 : b == null ? -1 : a.localeCompare(b)))
    .map(([house, group]) => ({ house, models: group }));
}
