import type { KpiImprovementTone } from "../types";

export type KpiFamily =
  | "core"
  | "energy_cost"
  | "ev"
  | "pv"
  | "bess"
  | "community_market"
  | "equity"
  | "reliability_comfort";

export type KpiVariant = "normalized" | "control" | "baseline" | "delta" | "absolute";

export type KpiAggregation = "total" | "daily_average" | "instant" | "ratio";

export type KpiDirection = "lower_better" | "higher_better" | "neutral" | "unknown";

export interface KpiTooltipInfo {
  shortDescription: string;
  formulaShort: string;
}

export interface KpiMetricMeta {
  key: string;
  family: KpiFamily;
  variant: KpiVariant;
  aggregation: KpiAggregation;
  direction: KpiDirection;
  tooltip: KpiTooltipInfo;
  comparisonKey: string;
  boardMetricKey: string;
}

export interface KpiMetricInputRow {
  key: string;
  label: string;
  unit?: string;
  value: number;
  breakdown: Array<{ entity: string; value: number }>;
}

export interface KpiMetricGroupRow {
  comparisonKey: string;
  boardMetricKey: string;
  label: string;
  unit?: string;
  family: KpiFamily;
  aggregation: KpiAggregation;
  direction: KpiDirection;
  tooltip: KpiTooltipInfo;
  sourceKeys: string[];
  control: number | null;
  baseline: number | null;
  delta: number | null;
  normalized: number | null;
  absolute: number | null;
  deltaPct: number | null;
  breakdown: {
    control: Array<{ entity: string; value: number }>;
    baseline: Array<{ entity: string; value: number }>;
    delta: Array<{ entity: string; value: number }>;
    normalized: Array<{ entity: string; value: number }>;
    absolute: Array<{ entity: string; value: number }>;
  };
}

const CORE_NORMALIZED_KEYS = new Set([
  "cost_total",
  "carbon_emissions_total",
  "electricity_consumption_total",
  "daily_peak_average",
  "all_time_peak_average",
  "ramping_average",
  "daily_one_minus_load_factor_average",
  "monthly_one_minus_load_factor_average",
  "zero_net_energy"
]);

const EXACT_TOOLTIPS: Record<string, KpiTooltipInfo> = {
  cost_total: {
    shortDescription: "Normalized electricity cost against the baseline. Lower than 1 means improvement.",
    formulaShort: "cost_total = control_cost / baseline_cost"
  },
  carbon_emissions_total: {
    shortDescription: "Normalized carbon emissions against the baseline. Lower than 1 means improvement.",
    formulaShort: "carbon_emissions_total = control_emissions / baseline_emissions"
  },
  electricity_consumption_total: {
    shortDescription: "Normalized positive grid import against baseline. Lower than 1 means lower grid dependency.",
    formulaShort: "electricity_consumption_total = control_import / baseline_import"
  },
  daily_peak_average: {
    shortDescription: "Average daily peak demand ratio versus baseline. Lower is better.",
    formulaShort: "daily_peak_average = mean_peak_control / mean_peak_baseline"
  },
  ramping_average: {
    shortDescription: "Ramping ratio (net-load variation) against baseline. Lower means smoother operation.",
    formulaShort: "ramping_average = ramping_control / ramping_baseline"
  },
  daily_one_minus_load_factor_average: {
    shortDescription: "Daily load factor penalty ratio. Lower means flatter demand profile.",
    formulaShort: "daily_1-load_factor = control / baseline"
  },
  ev_departure_success_rate: {
    shortDescription: "Share of EV departures that meet required SOC.",
    formulaShort: "success_rate = departures_met / departures_total"
  },
  ev_departure_soc_deficit_mean: {
    shortDescription: "Average SOC shortfall at EV departures. Lower is better.",
    formulaShort: "deficit_mean = mean(max(required_soc - actual_soc, 0))"
  },
  pv_self_consumption_ratio: {
    shortDescription: "Share of PV generation consumed locally instead of exported.",
    formulaShort: "self_consumption_ratio = (pv_generation - pv_export) / pv_generation"
  },
  community_market_savings_total_eur: {
    shortDescription: "Total market savings from local settlement versus counterfactual.",
    formulaShort: "savings = counterfactual_cost - settled_cost"
  },
  community_market_savings_daily_average_eur: {
    shortDescription: "Daily average market savings from local settlement.",
    formulaShort: "daily_savings = total_savings / simulated_days"
  }
};

const FAMILY_LABELS: Record<KpiFamily, string> = {
  core: "Core CityLearn",
  energy_cost: "Energy & Cost",
  ev: "Electric Vehicles",
  pv: "Photovoltaics",
  bess: "Battery Storage",
  community_market: "Community Market",
  equity: "Equity",
  reliability_comfort: "Reliability & Comfort"
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function inferFamily(key: string): KpiFamily {
  if (
    CORE_NORMALIZED_KEYS.has(key) ||
    key === "daily_peak_average" ||
    key === "all_time_peak_average" ||
    key === "ramping_average" ||
    key === "daily_one_minus_load_factor_average" ||
    key === "monthly_one_minus_load_factor_average"
  ) {
    return "core";
  }
  if (
    key.startsWith("cost_") ||
    key.startsWith("carbon_emissions_") ||
    key.startsWith("electricity_consumption_") ||
    key.startsWith("zero_net_energy")
  ) {
    return "energy_cost";
  }
  if (key.startsWith("ev_")) return "ev";
  if (key.startsWith("pv_")) return "pv";
  if (key.startsWith("bess_")) return "bess";
  if (key.startsWith("community_")) return "community_market";
  if (key.startsWith("equity_")) return "equity";
  if (
    key.startsWith("discomfort_") ||
    key.startsWith("electrical_service_") ||
    key.includes("unserved_energy")
  ) {
    return "reliability_comfort";
  }
  return "core";
}

function inferVariant(key: string): KpiVariant {
  if (key.includes("_control_")) return "control";
  if (key.includes("_baseline_")) return "baseline";
  if (key.includes("_delta_")) return "delta";
  if (CORE_NORMALIZED_KEYS.has(key)) return "normalized";
  return "absolute";
}

function inferAggregation(key: string): KpiAggregation {
  if (key.includes("_daily_average_")) return "daily_average";
  if (key.includes("_total_") || key.endsWith("_total")) return "total";
  if (key.includes("ratio") || key.includes("percent") || key.endsWith("_rate") || CORE_NORMALIZED_KEYS.has(key)) {
    return "ratio";
  }
  return "instant";
}

function inferDirection(key: string): KpiDirection {
  if (CORE_NORMALIZED_KEYS.has(key)) return "lower_better";
  if (
    key.includes("savings") ||
    key.includes("success_rate") ||
    key.includes("self_consumption_ratio") ||
    key.includes("local_share_of_") ||
    key.includes("equity_relative_benefit_percent") ||
    key.includes("equity_bpr")
  ) {
    return "higher_better";
  }
  if (
    key.includes("cost") ||
    key.includes("emission") ||
    key.includes("consumption") ||
    key.includes("zero_net_energy") ||
    key.includes("peak") ||
    key.includes("ramping") ||
    key.includes("discomfort") ||
    key.includes("violation") ||
    key.includes("deficit") ||
    key.includes("fade") ||
    key.includes("losers_percent") ||
    key.includes("gini") ||
    key.includes("cr20") ||
    key.includes("unserved")
  ) {
    return "lower_better";
  }
  return "unknown";
}

function buildGenericTooltip(meta: {
  key: string;
  family: KpiFamily;
  variant: KpiVariant;
  aggregation: KpiAggregation;
}): KpiTooltipInfo {
  const familyHint: Record<KpiFamily, string> = {
    core: "Core system-level KPI.",
    energy_cost: "Energy/cost KPI derived from control and baseline trajectories.",
    ev: "Electric-vehicle service KPI.",
    pv: "Photovoltaic production/export KPI.",
    bess: "Battery usage and aging KPI.",
    community_market: "Community-market settlement KPI.",
    equity: "Benefit-distribution KPI across buildings.",
    reliability_comfort: "Reliability and comfort KPI."
  };

  let formula = "value = exported_kpis[KPI]";
  if (meta.variant === "delta") formula = "delta = control - baseline";
  if (meta.variant === "normalized") formula = "normalized = control / baseline";
  if (meta.variant === "control") formula = "control = scenario value";
  if (meta.variant === "baseline") formula = "baseline = reference scenario value";
  if (meta.aggregation === "daily_average") formula = `${formula}; daily_average = total / simulated_days`;

  return {
    shortDescription: familyHint[meta.family],
    formulaShort: formula
  };
}

function stripVariant(key: string): string {
  return key.replace(/_(control|baseline|delta)_/g, "_");
}

function buildBoardMetricKey(key: string): string {
  return stripVariant(key)
    .replace(/_daily_average_/g, "_")
    .replace(/_total_/g, "_")
    .replace(/__+/g, "_")
    .replace(/^_|_$/g, "");
}

function variantPriority(variant: KpiVariant): number {
  if (variant === "delta") return 0;
  if (variant === "normalized") return 1;
  if (variant === "control") return 2;
  if (variant === "baseline") return 3;
  return 4;
}

export function formatKpiFamilyLabel(family: KpiFamily): string {
  return FAMILY_LABELS[family];
}

export function buildKpiMeta(keyRaw: string): KpiMetricMeta {
  const key = normalizeKey(keyRaw);
  const family = inferFamily(key);
  const variant = inferVariant(key);
  const aggregation = inferAggregation(key);
  const direction = inferDirection(key);
  const tooltip =
    EXACT_TOOLTIPS[key] ||
    buildGenericTooltip({
      key,
      family,
      variant,
      aggregation
    });

  return {
    key,
    family,
    variant,
    aggregation,
    direction,
    tooltip,
    comparisonKey: stripVariant(key),
    boardMetricKey: buildBoardMetricKey(key)
  };
}

export function groupScopedKpis(rows: KpiMetricInputRow[]): KpiMetricGroupRow[] {
  const grouped = new Map<
    string,
    KpiMetricGroupRow & {
      bestLabelPriority: number;
    }
  >();

  rows.forEach((row) => {
    const meta = buildKpiMeta(row.key);
    const groupKey = meta.comparisonKey;
    const existing = grouped.get(groupKey);
    const nextLabelPriority = variantPriority(meta.variant);

    if (!existing) {
      grouped.set(groupKey, {
        comparisonKey: groupKey,
        boardMetricKey: meta.boardMetricKey,
        label: row.label,
        unit: row.unit,
        family: meta.family,
        aggregation: meta.aggregation,
        direction: meta.direction,
        tooltip: meta.tooltip,
        sourceKeys: [meta.key],
        control: null,
        baseline: null,
        delta: null,
        normalized: null,
        absolute: null,
        deltaPct: null,
        breakdown: {
          control: [],
          baseline: [],
          delta: [],
          normalized: [],
          absolute: []
        },
        bestLabelPriority: nextLabelPriority
      });
    }

    const target = grouped.get(groupKey)!;
    if (!target.sourceKeys.includes(meta.key)) {
      target.sourceKeys.push(meta.key);
    }

    if (nextLabelPriority < target.bestLabelPriority) {
      target.label = row.label;
      target.bestLabelPriority = nextLabelPriority;
      target.tooltip = meta.tooltip;
      target.direction = meta.direction;
    }

    if (!target.unit && row.unit) target.unit = row.unit;

    if (meta.variant === "control") {
      target.control = row.value;
      target.breakdown.control = row.breakdown;
    } else if (meta.variant === "baseline") {
      target.baseline = row.value;
      target.breakdown.baseline = row.breakdown;
    } else if (meta.variant === "delta") {
      target.delta = row.value;
      target.breakdown.delta = row.breakdown;
    } else if (meta.variant === "normalized") {
      target.normalized = row.value;
      target.breakdown.normalized = row.breakdown;
    } else {
      target.absolute = row.value;
      target.breakdown.absolute = row.breakdown;
    }
  });

  return Array.from(grouped.values())
    .map((item) => {
      const deltaFromPair =
        item.delta !== null
          ? item.delta
          : item.control !== null && item.baseline !== null
            ? item.control - item.baseline
            : null;
      const deltaPct =
        deltaFromPair !== null && item.baseline !== null && Math.abs(item.baseline) > 1e-9
          ? (deltaFromPair / Math.abs(item.baseline)) * 100
          : null;

      return {
        ...item,
        delta: deltaFromPair,
        deltaPct
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function scoreKpiGroupTone(row: Pick<KpiMetricGroupRow, "direction" | "delta" | "normalized">): KpiImprovementTone {
  if (row.direction === "unknown") return "unknown";
  if (row.direction === "neutral") return "neutral";

  const delta = row.delta;
  if (delta !== null) {
    if (Math.abs(delta) < 1e-9) return "neutral";
    if (row.direction === "lower_better") return delta < 0 ? "better" : "worse";
    return delta > 0 ? "better" : "worse";
  }

  if (row.normalized !== null) {
    if (Math.abs(row.normalized - 1) < 1e-9) return "neutral";
    if (row.direction === "lower_better") return row.normalized < 1 ? "better" : "worse";
    return row.normalized > 1 ? "better" : "worse";
  }

  return "unknown";
}

export function isKpiGroupUsed(row: KpiMetricGroupRow, epsilon = 1e-9): boolean {
  const hasNonZero =
    (row.control !== null && Math.abs(row.control) > epsilon) ||
    (row.baseline !== null && Math.abs(row.baseline) > epsilon) ||
    (row.delta !== null && Math.abs(row.delta) > epsilon) ||
    (row.absolute !== null && Math.abs(row.absolute) > epsilon);

  if (hasNonZero) return true;

  if (row.normalized !== null && Math.abs(row.normalized - 1) > epsilon) return true;

  const hasBreakdownSignal = Object.values(row.breakdown).some((entries) =>
    entries.some((entry) => Math.abs(entry.value) > epsilon)
  );
  return hasBreakdownSignal;
}
