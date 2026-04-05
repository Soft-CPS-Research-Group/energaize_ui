import type { KpiEntry, KpiImprovementTone } from "../types";

export type KpiFamily =
  | "legacy_normalized"
  | "extended_core"
  | "ev_chargers"
  | "pv"
  | "bess"
  | "phases_service"
  | "community"
  | "equity"
  | "comfort"
  | "other";

export type KpiVariant = "normalized" | "control" | "baseline" | "delta" | "absolute";

export type KpiAggregation = "total" | "daily_average" | "instant" | "ratio";

export type KpiDirection = "lower_better" | "higher_better" | "neutral" | "unknown";

export const KPI_FAMILY_ORDER: KpiFamily[] = [
  "legacy_normalized",
  "extended_core",
  "ev_chargers",
  "bess",
  "pv",
  "phases_service",
  "community",
  "equity",
  "comfort",
  "other"
];

export const KPI_VARIANT_ORDER: KpiVariant[] = ["normalized", "control", "baseline", "delta", "absolute"];

export const KPI_AGGREGATION_ORDER: KpiAggregation[] = ["ratio", "daily_average", "total", "instant"];

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
  canonicalGroupId: string;
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
  canonicalGroupId: string;
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

export interface KpiCompareGroupedRow {
  key: string;
  canonicalGroupId: string;
  boardMetricKey: string;
  label: string;
  unit?: string;
  family: KpiFamily;
  aggregation: KpiAggregation;
  direction: KpiDirection;
  entity: string;
  leftPrimary: number | null;
  rightPrimary: number | null;
  leftSecondary: { baseline: number | null; delta: number | null } | null;
  rightSecondary: { baseline: number | null; delta: number | null } | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  tone: KpiImprovementTone;
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

const EXTENDED_CORE_PREFIXES = ["cost", "carbon_emissions", "electricity_consumption", "zero_net_energy"];

const EXACT_TOOLTIPS: Record<string, KpiTooltipInfo> = {
  cost_total: {
    shortDescription: "Normalized electricity cost against baseline. Lower than 1 means improvement.",
    formulaShort: "cost_total = control_cost / baseline_cost"
  },
  carbon_emissions_total: {
    shortDescription: "Normalized carbon emissions against baseline. Lower than 1 means improvement.",
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
  legacy_normalized: "Legacy Normalized",
  extended_core: "Extended Core",
  ev_chargers: "EV / Chargers",
  pv: "PV",
  bess: "BESS",
  phases_service: "Phases & Service",
  community: "Community",
  equity: "Equity",
  comfort: "Comfort",
  other: "Other"
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function isExtendedCoreKey(key: string): boolean {
  return EXTENDED_CORE_PREFIXES.some((prefix) =>
    new RegExp(`^${prefix}_(control|baseline|delta)_`).test(key)
  );
}

function inferFamily(key: string): KpiFamily {
  if (CORE_NORMALIZED_KEYS.has(key)) return "legacy_normalized";
  if (isExtendedCoreKey(key)) return "extended_core";
  if (key.startsWith("ev_")) return "ev_chargers";
  if (key.startsWith("pv_")) return "pv";
  if (key.startsWith("bess_")) return "bess";
  if (key.startsWith("community_")) return "community";
  if (key.startsWith("equity_")) return "equity";
  if (key.startsWith("phase_") || key.startsWith("electrical_service_")) return "phases_service";
  if (key.startsWith("discomfort_") || key.includes("unserved_energy")) return "comfort";
  if (
    key.includes("violation") ||
    key.includes("imbalance") ||
    key.includes("phase_import_peak") ||
    key.includes("phase_export_peak")
  ) {
    return "phases_service";
  }
  return "other";
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

function inferDirection(key: string, family: KpiFamily): KpiDirection {
  if (CORE_NORMALIZED_KEYS.has(key)) return "lower_better";

  if (
    key.includes("savings") ||
    key.includes("success_rate") ||
    key.includes("self_consumption_ratio") ||
    key.includes("generation") ||
    key.includes("local_share") ||
    key.includes("equity_relative_benefit_percent") ||
    key.includes("equity_bpr") ||
    key.includes("v2g_export")
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
    key.includes("unserved") ||
    key.includes("import")
  ) {
    return "lower_better";
  }

  if (family === "extended_core") return "lower_better";
  return "unknown";
}

function buildGenericTooltip(meta: {
  family: KpiFamily;
  variant: KpiVariant;
  aggregation: KpiAggregation;
}): KpiTooltipInfo {
  const familyHint: Record<KpiFamily, string> = {
    legacy_normalized: "Legacy normalized KPI (control/baseline ratio).",
    extended_core: "Extended core KPI with control, baseline, and delta variants.",
    ev_chargers: "Electric vehicle and charger service KPI.",
    pv: "Photovoltaic production/export KPI.",
    bess: "Battery usage and aging KPI.",
    phases_service: "Electrical service, phase limits, and imbalance KPI.",
    community: "Community settlement and sharing KPI.",
    equity: "Benefit-distribution KPI across buildings.",
    comfort: "Comfort and unserved-energy KPI.",
    other: "KPI from exported_kpis.csv."
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
  const index = KPI_VARIANT_ORDER.indexOf(variant);
  return index === -1 ? KPI_VARIANT_ORDER.length : index;
}

export function sortKpiFamilies(families: KpiFamily[]): KpiFamily[] {
  return [...families].sort((a, b) => {
    const left = KPI_FAMILY_ORDER.indexOf(a);
    const right = KPI_FAMILY_ORDER.indexOf(b);
    if (left === right) return formatKpiFamilyLabel(a).localeCompare(formatKpiFamilyLabel(b));
    if (left === -1) return 1;
    if (right === -1) return -1;
    return left - right;
  });
}

export function sortKpiVariants(variants: KpiVariant[]): KpiVariant[] {
  return [...variants].sort((a, b) => {
    const left = KPI_VARIANT_ORDER.indexOf(a);
    const right = KPI_VARIANT_ORDER.indexOf(b);
    if (left === right) return a.localeCompare(b);
    return left - right;
  });
}

export function sortKpiAggregations(aggregations: KpiAggregation[]): KpiAggregation[] {
  return [...aggregations].sort((a, b) => {
    const left = KPI_AGGREGATION_ORDER.indexOf(a);
    const right = KPI_AGGREGATION_ORDER.indexOf(b);
    if (left === right) return a.localeCompare(b);
    return left - right;
  });
}

export function formatKpiFamilyLabel(family: KpiFamily): string {
  return FAMILY_LABELS[family];
}

export function buildKpiMeta(keyRaw: string): KpiMetricMeta {
  const key = normalizeKey(keyRaw);
  const family = inferFamily(key);
  const variant = inferVariant(key);
  const aggregation = inferAggregation(key);
  const direction = inferDirection(key, family);
  const tooltip = EXACT_TOOLTIPS[key] || buildGenericTooltip({ family, variant, aggregation });
  const canonicalGroupId = stripVariant(key);

  return {
    key,
    family,
    variant,
    aggregation,
    direction,
    tooltip,
    canonicalGroupId,
    comparisonKey: canonicalGroupId,
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
    const groupKey = meta.canonicalGroupId;
    const existing = grouped.get(groupKey);
    const nextLabelPriority = variantPriority(meta.variant);

    if (!existing) {
      grouped.set(groupKey, {
        canonicalGroupId: groupKey,
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
      target.family = meta.family;
      target.aggregation = meta.aggregation;
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
        item.delta !== null ? item.delta : item.control !== null && item.baseline !== null ? item.control - item.baseline : null;
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
    .sort((a, b) => {
      const familyOrderA = KPI_FAMILY_ORDER.indexOf(a.family);
      const familyOrderB = KPI_FAMILY_ORDER.indexOf(b.family);
      if (familyOrderA !== familyOrderB) return familyOrderA - familyOrderB;
      return a.label.localeCompare(b.label);
    });
}

export function scoreKpiDeltaTone(direction: KpiDirection, delta: number | null): KpiImprovementTone {
  if (delta === null || Number.isNaN(delta)) return "unknown";
  if (Math.abs(delta) < 1e-9) return "neutral";
  if (direction === "neutral") return "neutral";
  if (direction === "unknown") return "unknown";
  if (direction === "lower_better") return delta < 0 ? "better" : "worse";
  return delta > 0 ? "better" : "worse";
}

export function scoreKpiGroupTone(row: Pick<KpiMetricGroupRow, "direction" | "delta" | "normalized">): KpiImprovementTone {
  const deltaTone = scoreKpiDeltaTone(row.direction, row.delta);
  if (deltaTone !== "unknown") return deltaTone;

  if (row.normalized !== null) {
    if (Math.abs(row.normalized - 1) < 1e-9) return "neutral";
    if (row.direction === "lower_better") return row.normalized < 1 ? "better" : "worse";
    if (row.direction === "higher_better") return row.normalized > 1 ? "better" : "worse";
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

function parseCompareEntry(entry: Pick<KpiEntry, "key" | "source">): { metricKey: string; entity: string } {
  if (entry.source && entry.source.trim() !== "") {
    const [metricPart] = entry.key.split("::");
    return { metricKey: metricPart || entry.key, entity: entry.source };
  }

  const parts = entry.key.split("::");
  if (parts.length >= 2) {
    return { metricKey: parts[0] || entry.key, entity: parts.slice(1).join("::") || "global" };
  }

  return { metricKey: entry.key, entity: "global" };
}

function selectPrimaryForCompare(row: KpiMetricGroupRow | null): number | null {
  if (!row) return null;
  if (row.family === "extended_core") {
    return row.control ?? row.absolute ?? row.normalized ?? row.delta ?? row.baseline ?? null;
  }
  return row.absolute ?? row.normalized ?? row.control ?? row.delta ?? row.baseline ?? null;
}

function selectSecondaryForCompare(row: KpiMetricGroupRow | null): { baseline: number | null; delta: number | null } | null {
  if (!row || row.family !== "extended_core") return null;
  return {
    baseline: row.baseline,
    delta: row.delta
  };
}

function groupCompareSide(entries: KpiEntry[]): Map<string, Map<string, KpiMetricGroupRow>> {
  const byEntity = new Map<string, KpiMetricInputRow[]>();

  entries.forEach((entry) => {
    const parsed = parseCompareEntry(entry);
    const rows = byEntity.get(parsed.entity) || [];
    rows.push({
      key: parsed.metricKey,
      label: entry.label,
      unit: entry.unit,
      value: entry.value,
      breakdown: [{ entity: parsed.entity, value: entry.value }]
    });
    byEntity.set(parsed.entity, rows);
  });

  const grouped = new Map<string, Map<string, KpiMetricGroupRow>>();
  byEntity.forEach((rows, entity) => {
    const groupedRows = groupScopedKpis(rows);
    grouped.set(
      entity,
      new Map(groupedRows.map((row) => [row.canonicalGroupId, row]))
    );
  });

  return grouped;
}

export function buildGroupedKpiCompareRows(
  leftEntries: KpiEntry[],
  rightEntries: KpiEntry[],
  options?: { showAll?: boolean }
): KpiCompareGroupedRow[] {
  const showAll = options?.showAll ?? false;
  const leftGrouped = groupCompareSide(leftEntries);
  const rightGrouped = groupCompareSide(rightEntries);
  const entities = new Set([...leftGrouped.keys(), ...rightGrouped.keys()]);

  const rows: KpiCompareGroupedRow[] = [];

  entities.forEach((entity) => {
    const leftMap = leftGrouped.get(entity) || new Map<string, KpiMetricGroupRow>();
    const rightMap = rightGrouped.get(entity) || new Map<string, KpiMetricGroupRow>();
    const keys = new Set<string>();

    if (showAll) {
      leftMap.forEach((_, key) => keys.add(key));
      rightMap.forEach((_, key) => keys.add(key));
    } else {
      leftMap.forEach((_, key) => {
        if (rightMap.has(key)) keys.add(key);
      });
    }

    keys.forEach((canonicalGroupId) => {
      const left = leftMap.get(canonicalGroupId) || null;
      const right = rightMap.get(canonicalGroupId) || null;
      const reference = left || right;
      if (!reference) return;

      const leftPrimary = selectPrimaryForCompare(left);
      const rightPrimary = selectPrimaryForCompare(right);
      const deltaAbs = leftPrimary !== null && rightPrimary !== null ? rightPrimary - leftPrimary : null;
      const deltaPct =
        leftPrimary !== null && rightPrimary !== null && Math.abs(leftPrimary) > 1e-9
          ? ((rightPrimary - leftPrimary) / Math.abs(leftPrimary)) * 100
          : null;

      rows.push({
        key: `${canonicalGroupId}::${entity}`,
        canonicalGroupId,
        boardMetricKey: reference.boardMetricKey,
        label: reference.label,
        unit: reference.unit,
        family: reference.family,
        aggregation: reference.aggregation,
        direction: reference.direction,
        entity,
        leftPrimary,
        rightPrimary,
        leftSecondary: selectSecondaryForCompare(left),
        rightSecondary: selectSecondaryForCompare(right),
        deltaAbs,
        deltaPct,
        tone: scoreKpiDeltaTone(reference.direction, deltaAbs)
      });
    });
  });

  return rows.sort((a, b) => {
    const familyOrderA = KPI_FAMILY_ORDER.indexOf(a.family);
    const familyOrderB = KPI_FAMILY_ORDER.indexOf(b.family);
    if (familyOrderA !== familyOrderB) return familyOrderA - familyOrderB;
    const labelSort = a.label.localeCompare(b.label);
    if (labelSort !== 0) return labelSort;
    return a.entity.localeCompare(b.entity);
  });
}
