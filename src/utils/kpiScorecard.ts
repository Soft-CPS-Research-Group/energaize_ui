import type { KpiImprovementTone } from "../types";

export type KpiScorecardValueStyle = "number" | "currency" | "energy" | "duration" | "speed" | "percentage" | "ratio" | "count";
export type KpiScorecardToneRule =
  | "neutral"
  | "positive-saving"
  | "service-rate"
  | "zero-risk"
  | "lower-ratio-better"
  | "higher-rate-better"
  | "lower-is-better";
export type KpiScorecardReferenceMode = "compare" | "none";
export type KpiScorecardComparisonDirection = "lower-is-better" | "higher-is-better" | "closer-to-zero" | "neutral";
export type KpiScorecardScope = "community" | "building" | "other";

export interface KpiScorecardSourceRow {
  key: string;
  label: string;
  unit?: string;
  value: number | null;
}

interface KpiScorecardCandidateTransform {
  key: string;
  transform?: "negate";
}

type KpiScorecardCandidate = string | KpiScorecardCandidateTransform;

export interface KpiScorecardDefinition {
  id: string;
  title: string;
  description: string;
  candidates: KpiScorecardCandidate[];
  valueStyle: KpiScorecardValueStyle;
  unit?: string;
  toneRule: KpiScorecardToneRule;
  referenceMode?: KpiScorecardReferenceMode;
  comparisonDirection?: KpiScorecardComparisonDirection;
  scopes?: KpiScorecardScope[];
  tooltip?: string;
}

export interface KpiScorecardSignal {
  definition: KpiScorecardDefinition;
  value: number | null;
  sourceKey: string | null;
  sourceLabel: string | null;
  unit?: string;
  tone: KpiImprovementTone;
}

export interface KpiScorecardSectionDefinition {
  id: string;
  title: string;
  subtitle: string;
  definitions: KpiScorecardDefinition[];
}

export interface KpiScorecardSection {
  id: string;
  title: string;
  subtitle: string;
  reportedCount: number;
  signals: KpiScorecardSignal[];
}

function candidate(key: string, transform?: "negate"): KpiScorecardCandidateTransform {
  return transform ? { key, transform } : { key };
}

const COMMON_COST_SAVING_CANDIDATES: KpiScorecardCandidate[] = [
  "cost_saving_vs_bau_eur",
  candidate("district_cost_total_delta_to_business_as_usual_eur", "negate"),
  candidate("building_cost_total_delta_to_business_as_usual_eur", "negate"),
  candidate("cost_delta_vs_bau_eur", "negate"),
  "cost_saving_vs_reference_eur",
  candidate("cost_delta_vs_reference_eur", "negate"),
  "cost_saving_vs_rbcsmart_eur",
  candidate("cost_delta_vs_rbcsmart_eur", "negate"),
  candidate("district_cost_total_delta_eur", "negate")
];

const COST: KpiScorecardDefinition = {
  id: "community-cost",
  title: "Cost",
  description: "Total cost for the selected scope.",
  candidates: [
    "community_cost_eur",
    "district_cost_total_control_eur",
    "district_community_settled_cost_total_eur",
    "building_cost_total_control_eur"
  ],
  valueStyle: "currency",
  unit: "€",
  toneRule: "neutral"
};

const COST_SAVING: KpiScorecardDefinition = {
  id: "cost-saving-reference",
  title: "Cost saving vs reference",
  description: "Positive values mean the trained policy is cheaper than BAU when exported, otherwise than simulator baseline.",
  candidates: COMMON_COST_SAVING_CANDIDATES,
  valueStyle: "currency",
  unit: "€",
  toneRule: "positive-saving"
};

const EV_MIN_FEASIBLE: KpiScorecardDefinition = {
  id: "ev-min-feasible",
  title: "EV minimum feasible service",
  description: "Share of feasible EV departures that meet the minimum acceptable service level.",
  candidates: [
    "ev_min_acceptable_feasible_rate",
    "district_ev_performance_departure_min_acceptable_feasible_ratio",
    "district_ev_performance_departure_min_acceptable_ratio",
    "district_ev_performance_departure_success_ratio",
    "building_ev_performance_departure_min_acceptable_feasible_ratio",
    "building_ev_performance_departure_min_acceptable_ratio",
    "building_ev_performance_departure_success_ratio"
  ],
  valueStyle: "percentage",
  unit: "%",
  toneRule: "service-rate",
  referenceMode: "none"
};

const EV_WITHIN_TOLERANCE: KpiScorecardDefinition = {
  id: "ev-within-tolerance",
  title: "EV within tolerance",
  description: "Share of feasible EV departures that finish within the target SOC tolerance band, currently ±5% SOC.",
  candidates: [
    "ev_within_tolerance_rate",
    "district_ev_performance_departure_within_tolerance_feasible_ratio",
    "district_ev_performance_departure_within_tolerance_ratio",
    "building_ev_performance_departure_within_tolerance_feasible_ratio",
    "building_ev_performance_departure_within_tolerance_ratio"
  ],
  valueStyle: "percentage",
  unit: "%",
  toneRule: "service-rate",
  referenceMode: "none"
};

const ELECTRICAL_VIOLATIONS: KpiScorecardDefinition = {
  id: "electrical-violations",
  title: "Electrical violations",
  description: "Energy associated with electrical service phase violations.",
  candidates: [
    "electrical_violation_kwh",
    "electrical_violations_kwh",
    "district_electrical_service_phase_violations_energy_total_kwh",
    "building_electrical_service_phase_violations_energy_total_kwh"
  ],
  valueStyle: "energy",
  unit: "kWh",
  toneRule: "zero-risk",
  referenceMode: "none"
};

const BATTERY_THROUGHPUT: KpiScorecardDefinition = {
  id: "battery-throughput",
  title: "Battery throughput",
  description: "Total battery cycling energy: charge plus discharge throughput.",
  candidates: [
    "battery_throughput_kwh",
    "district_battery_total_throughput_kwh",
    "building_battery_total_throughput_kwh"
  ],
  valueStyle: "energy",
  unit: "kWh",
  toneRule: "neutral",
  comparisonDirection: "lower-is-better",
  tooltip: "Lower throughput means less battery cycling and usually less degradation. Read it with cost and EV service: very low throughput can also mean the battery was barely used."
};

const V2G_EXPORT: KpiScorecardDefinition = {
  id: "v2g-export",
  title: "V2G export",
  description: "Total EV energy exported back to the community/grid.",
  candidates: [
    "v2g_export_kwh",
    "district_ev_total_v2g_export_kwh",
    "building_ev_total_v2g_export_kwh"
  ],
  valueStyle: "energy",
  unit: "kWh",
  toneRule: "neutral",
  comparisonDirection: "neutral",
  tooltip: "BAU normally charges EVs and does not discharge them. V2G export vs BAU is therefore often 0 vs 0 or policy vs 0, so ratios are not very informative; use the absolute export and delta instead."
};

const SOLAR_SELF_CONSUMPTION: KpiScorecardDefinition = {
  id: "solar-self-consumption",
  title: "Solar self-consumption",
  description: "Share of generated solar energy consumed locally.",
  candidates: [
    "community_solar_self_consumption_rate",
    "district_solar_self_consumption_ratio_self_consumption_ratio",
    "building_solar_self_consumption_ratio_self_consumption_ratio"
  ],
  valueStyle: "percentage",
  unit: "%",
  toneRule: "higher-rate-better",
  comparisonDirection: "higher-is-better",
  tooltip: "Uses the simulator self-consumption ratio. When BAU rows are exported, the scorecard also shows the BAU value and delta."
};

const COMMUNITY_IMPORT: KpiScorecardDefinition = {
  id: "community-import",
  title: "Community import",
  description: "Total imported energy for the selected scope.",
  candidates: [
    "community_import_kwh",
    "district_energy_grid_total_import_control_kwh",
    "building_energy_grid_total_import_control_kwh"
  ],
  valueStyle: "energy",
  unit: "kWh",
  toneRule: "neutral",
  comparisonDirection: "lower-is-better"
};

const COMMUNITY_EXPORT: KpiScorecardDefinition = {
  id: "community-export",
  title: "Community export",
  description: "Total exported energy for the selected scope.",
  candidates: [
    "community_export_kwh",
    "district_energy_grid_total_export_control_kwh",
    "building_energy_grid_total_export_control_kwh"
  ],
  valueStyle: "energy",
  unit: "kWh",
  toneRule: "neutral",
  comparisonDirection: "lower-is-better"
};

const COMMUNITY_NET_EXCHANGE: KpiScorecardDefinition = {
  id: "community-net-exchange",
  title: "Community net exchange",
  description: "Net grid exchange for the selected scope.",
  candidates: [
    "community_net_exchange_kwh",
    "district_energy_grid_total_net_exchange_control_kwh",
    "building_energy_grid_total_net_exchange_control_kwh"
  ],
  valueStyle: "energy",
  unit: "kWh",
  toneRule: "neutral",
  comparisonDirection: "closer-to-zero"
};

const LOAD_FACTOR_PENALTY: KpiScorecardDefinition = {
  id: "load-factor-penalty",
  title: "Load factor penalty",
  description: "Load-factor penalty ratio against BAU when exported, otherwise simulator baseline. Values below 1 are better.",
  candidates: [
    "load_factor_penalty_ratio_to_bau",
    "district_energy_grid_shape_quality_load_factor_penalty_daily_average_to_business_as_usual_ratio",
    "district_energy_grid_shape_quality_load_factor_penalty_monthly_average_to_business_as_usual_ratio",
    "load_factor_penalty_ratio_to_baseline",
    "district_energy_grid_shape_quality_load_factor_penalty_daily_average_to_baseline_ratio",
    "district_energy_grid_shape_quality_load_factor_penalty_monthly_average_to_baseline_ratio",
    "building_energy_grid_shape_quality_load_factor_penalty_daily_average_to_baseline_ratio",
    "building_energy_grid_shape_quality_load_factor_penalty_monthly_average_to_baseline_ratio",
    "load_factor_penalty_ratio"
  ],
  valueStyle: "ratio",
  unit: "x",
  toneRule: "lower-ratio-better",
  scopes: ["community"]
};

const DAILY_PEAK_RATIO: KpiScorecardDefinition = {
  id: "daily-peak-ratio",
  title: "Daily peak ratio",
  description: "Average daily peak ratio against BAU when exported, otherwise simulator baseline. Values below 1 are better.",
  candidates: [
    "peak_daily_ratio_to_bau",
    "district_energy_grid_shape_quality_peak_daily_average_to_business_as_usual_ratio",
    "building_energy_grid_shape_quality_peak_daily_average_to_business_as_usual_ratio",
    "peak_daily_ratio_to_baseline",
    "district_energy_grid_shape_quality_peak_daily_average_to_baseline_ratio",
    "building_energy_grid_shape_quality_peak_daily_average_to_baseline_ratio"
  ],
  valueStyle: "ratio",
  unit: "x",
  toneRule: "lower-ratio-better",
  scopes: ["community"]
};

const ALL_TIME_PEAK_RATIO: KpiScorecardDefinition = {
  id: "all-time-peak-ratio",
  title: "All-time peak ratio",
  description: "All-time peak ratio against BAU when exported, otherwise simulator baseline. Values below 1 are better.",
  candidates: [
    "peak_all_time_ratio_to_bau",
    "district_energy_grid_shape_quality_peak_all_time_average_to_business_as_usual_ratio",
    "building_energy_grid_shape_quality_peak_all_time_average_to_business_as_usual_ratio",
    "peak_all_time_ratio_to_baseline",
    "district_energy_grid_shape_quality_peak_all_time_average_to_baseline_ratio",
    "building_energy_grid_shape_quality_peak_all_time_average_to_baseline_ratio"
  ],
  valueStyle: "ratio",
  unit: "x",
  toneRule: "lower-ratio-better",
  scopes: ["community"]
};

export const KPI_COST_CONTEXT = COST;

export const KPI_DASHBOARD_FOCUS: KpiScorecardDefinition[] = [
  COST_SAVING,
  EV_MIN_FEASIBLE,
  EV_WITHIN_TOLERANCE,
  ELECTRICAL_VIOLATIONS,
  BATTERY_THROUGHPUT,
  SOLAR_SELF_CONSUMPTION
];

export const KPI_IMPORTANT_SECTIONS: KpiScorecardSectionDefinition[] = [
  {
    id: "selected-kpis",
    title: "Selected KPIs",
    subtitle: "Expanded scorecard for cost, EV service, grid safety, battery throughput, V2G export, solar and grid shape.",
    definitions: [
      COST_SAVING,
      EV_MIN_FEASIBLE,
      EV_WITHIN_TOLERANCE,
      ELECTRICAL_VIOLATIONS,
      BATTERY_THROUGHPUT,
      V2G_EXPORT,
      SOLAR_SELF_CONSUMPTION,
      COMMUNITY_IMPORT,
      COMMUNITY_EXPORT,
      COMMUNITY_NET_EXCHANGE,
      DAILY_PEAK_RATIO,
      ALL_TIME_PEAK_RATIO,
      LOAD_FACTOR_PENALTY
    ]
  }
];

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeRateValue(value: number): number {
  return Math.abs(value) <= 1.5 ? value * 100 : value;
}

function hasSignalValue(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compareToZero(value: number, zeroIsGood: boolean): KpiImprovementTone {
  if (Math.abs(value) < 1e-9) return zeroIsGood ? "better" : "neutral";
  if (zeroIsGood) return "worse";
  return value > 0 ? "better" : "worse";
}

function scoreTone(definition: KpiScorecardDefinition, value: number | null): KpiImprovementTone {
  if (!hasSignalValue(value)) return "unknown";

  switch (definition.toneRule) {
    case "positive-saving":
      return compareToZero(value, false);
    case "service-rate": {
      const pct = normalizeRateValue(value);
      if (pct >= 98) return "better";
      if (pct >= 95) return "neutral";
      return "worse";
    }
    case "zero-risk":
      return compareToZero(value, true);
    case "lower-ratio-better":
      if (value <= 0.98) return "better";
      if (value <= 1.02) return "neutral";
      return "worse";
    case "higher-rate-better": {
      const pct = normalizeRateValue(value);
      if (pct >= 80) return "better";
      if (pct >= 50) return "neutral";
      return "worse";
    }
    case "lower-is-better":
      return "neutral";
    case "neutral":
    default:
      return "neutral";
  }
}

function definitionAppliesToScope(definition: KpiScorecardDefinition, scope?: KpiScorecardScope): boolean {
  if (!scope || !definition.scopes) return true;
  return definition.scopes.includes(scope);
}

export function resolveKpiScorecardSignal(
  rows: KpiScorecardSourceRow[],
  definition: KpiScorecardDefinition
): KpiScorecardSignal {
  const rowByKey = new Map(rows.map((row) => [normalizeKey(row.key), row]));

  for (const rawCandidate of definition.candidates) {
    const candidateDef = typeof rawCandidate === "string" ? { key: rawCandidate } : rawCandidate;
    const normalizedCandidate = normalizeKey(candidateDef.key);
    const matched =
      rowByKey.get(normalizedCandidate) ||
      rows.find((row) => normalizeKey(row.key).endsWith(`_${normalizedCandidate}`));
    if (!matched || !hasSignalValue(matched.value)) continue;
    const value = candidateDef.transform === "negate" ? -matched.value : matched.value;

    return {
      definition,
      value,
      sourceKey: matched.key,
      sourceLabel: matched.label,
      unit: definition.unit || matched.unit,
      tone: scoreTone(definition, value)
    };
  }

  return {
    definition,
    value: null,
    sourceKey: null,
    sourceLabel: null,
    unit: definition.unit,
    tone: "unknown"
  };
}

export function resolveKpiScorecardSignals(
  rows: KpiScorecardSourceRow[],
  definitions: KpiScorecardDefinition[] = KPI_DASHBOARD_FOCUS,
  scope?: KpiScorecardScope
): KpiScorecardSignal[] {
  return definitions
    .filter((definition) => definitionAppliesToScope(definition, scope))
    .map((definition) => resolveKpiScorecardSignal(rows, definition));
}

export function resolveKpiScorecardSections(
  rows: KpiScorecardSourceRow[],
  sections: KpiScorecardSectionDefinition[] = KPI_IMPORTANT_SECTIONS,
  scope?: KpiScorecardScope
): KpiScorecardSection[] {
  return sections
    .map((section) => {
      const signals = resolveKpiScorecardSignals(rows, section.definitions, scope);
      const reportedCount = signals.filter((signal) => hasSignalValue(signal.value)).length;
      return {
        id: section.id,
        title: section.title,
        subtitle: section.subtitle,
        reportedCount,
        signals
      };
    })
    .filter((section) => section.reportedCount > 0);
}

function formatCompactNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits,
    minimumFractionDigits: 0
  }).format(value);
}

export function formatKpiScorecardValue(signal: KpiScorecardSignal): string {
  const { value, definition } = signal;
  if (!hasSignalValue(value)) return "Not reported";

  switch (definition.valueStyle) {
    case "currency":
      return `${formatCompactNumber(value, Math.abs(value) >= 100 ? 0 : 2)} ${signal.unit || "€"}`;
    case "energy":
      return `${formatCompactNumber(value, Math.abs(value) >= 100 ? 1 : 2)} ${signal.unit || "kWh"}`;
    case "duration":
      return `${formatCompactNumber(value, Math.abs(value) >= 100 ? 0 : 1)} ${signal.unit || "s"}`;
    case "speed":
      return `${formatCompactNumber(value, 2)} ${signal.unit || "steps/s"}`;
    case "percentage":
      return `${formatCompactNumber(normalizeRateValue(value), 1)}%`;
    case "ratio":
      return `${formatCompactNumber(value, 3)}x`;
    case "count":
      return `${formatCompactNumber(value, 0)} ${signal.unit || ""}`.trim();
    case "number":
    default:
      return `${formatCompactNumber(value, 3)}${signal.unit ? ` ${signal.unit}` : ""}`;
  }
}
