import type { KpiEntry, KpiImprovementTone } from "../types";

export type KpiLevel = "building" | "district" | "other";

export type KpiFamily =
  | "cost"
  | "energy_grid"
  | "emissions"
  | "solar_self_consumption"
  | "ev"
  | "battery"
  | "electrical_service_phase"
  | "equity"
  | "comfort_resilience"
  | "other";

export type KpiVariant = "control" | "baseline" | "delta" | "normalized" | "absolute";

export type KpiAggregation = "total" | "daily_average" | "instant" | "ratio";

export type KpiDirection = "lower_better" | "higher_better" | "neutral" | "unknown";

interface KpiFamilyDef {
  family: KpiFamily;
  label: string;
  tokens: string[];
  description: string;
}

const KPI_FAMILY_DEFS: KpiFamilyDef[] = [
  {
    family: "electrical_service_phase",
    label: "Electrical Service Phase",
    tokens: ["electrical", "service", "phase"],
    description: "Phase limits, violations, and electrical balance quality."
  },
  {
    family: "solar_self_consumption",
    label: "Solar Self Consumption",
    tokens: ["solar", "self", "consumption"],
    description: "Solar generation, export, and local self-consumption behavior."
  },
  {
    family: "comfort_resilience",
    label: "Comfort Resilience",
    tokens: ["comfort", "resilience"],
    description: "Comfort/discomfort indicators and outage resilience indicators."
  },
  {
    family: "energy_grid",
    label: "Energy Grid",
    tokens: ["energy", "grid"],
    description: "Grid import/export/net exchange and shape quality indicators."
  },
  {
    family: "cost",
    label: "Cost",
    tokens: ["cost"],
    description: "Cost KPIs in control, baseline, and delta forms."
  },
  {
    family: "emissions",
    label: "Emissions",
    tokens: ["emissions"],
    description: "Emissions KPIs in control, baseline, and delta forms."
  },
  {
    family: "ev",
    label: "EV",
    tokens: ["ev"],
    description: "Electric vehicle events, service quality, and charging behavior."
  },
  {
    family: "battery",
    label: "Battery",
    tokens: ["battery"],
    description: "Battery throughput and health indicators."
  },
  {
    family: "equity",
    label: "Equity",
    tokens: ["equity"],
    description: "Benefit distribution and fairness indicators."
  }
].sort((left, right) => right.tokens.length - left.tokens.length);

const SUBFAMILY_TOKENS: string[][] = [
  ["ratio", "to", "baseline"],
  ["daily", "average"],
  ["shape", "quality"],
  ["community", "market"],
  ["phase", "peaks"],
  ["performance"],
  ["events"],
  ["health"],
  ["violations"],
  ["imbalance"],
  ["distribution"],
  ["benefit"],
  ["discomfort"],
  ["resilience"],
  ["total"]
].sort((left, right) => right.length - left.length);

const UNIT_TOKENS = new Set(["eur", "kwh", "kgco2", "kw", "count", "percent", "ratio", "c"]);
const VARIANT_TOKENS = new Set<KpiVariant>(["control", "baseline", "delta", "normalized"]);

export const KPI_FAMILY_ORDER: KpiFamily[] = [
  "cost",
  "energy_grid",
  "emissions",
  "solar_self_consumption",
  "ev",
  "battery",
  "electrical_service_phase",
  "equity",
  "comfort_resilience",
  "other"
];

export const KPI_VARIANT_ORDER: KpiVariant[] = ["control", "baseline", "delta", "absolute", "normalized"];

export const KPI_AGGREGATION_ORDER: KpiAggregation[] = ["ratio", "daily_average", "total", "instant"];

export interface KpiTooltipInfo {
  shortDescription: string;
  formulaShort: string;
}

export interface KpiMetricMeta {
  key: string;
  level: KpiLevel;
  family: KpiFamily;
  subfamilyKey: string;
  subfamilyLabel: string;
  metricKey: string;
  metricLabel: string;
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
  value: number | null;
  breakdown: Array<{ entity: string; value: number }>;
}

export interface KpiMetricGroupRow {
  canonicalGroupId: string;
  comparisonKey: string;
  boardMetricKey: string;
  level: KpiLevel;
  family: KpiFamily;
  subfamilyKey: string;
  subfamilyLabel: string;
  metricKey: string;
  metricLabel: string;
  label: string;
  unit?: string;
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
  hasAnyNumeric: boolean;
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
  level: KpiLevel;
  family: KpiFamily;
  subfamilyKey: string;
  subfamilyLabel: string;
  metricKey: string;
  metricLabel: string;
  label: string;
  unit?: string;
  aggregation: KpiAggregation;
  direction: KpiDirection;
  tooltip: KpiTooltipInfo;
  entity: string;
  leftPrimary: number | null;
  rightPrimary: number | null;
  leftSecondary: { baseline: number | null; delta: number | null } | null;
  rightSecondary: { baseline: number | null; delta: number | null } | null;
  leftHasValue: boolean;
  rightHasValue: boolean;
  deltaAbs: number | null;
  deltaPct: number | null;
  tone: KpiImprovementTone;
}

export interface KpiSubfamilySection<T> {
  subfamilyKey: string;
  subfamilyLabel: string;
  rows: T[];
}

export interface KpiFamilySection<T> {
  family: KpiFamily;
  familyLabel: string;
  subfamilies: KpiSubfamilySection<T>[];
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function toTitle(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function startsWithTokens(tokens: string[], prefix: string[]): boolean {
  if (prefix.length > tokens.length) return false;
  return prefix.every((token, index) => token === tokens[index]);
}

function stripLevelPrefix(value: string): string {
  return value.replace(/^(building|district)_/, "");
}

function hasFiniteValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inferAggregation(meta: {
  key: string;
  subfamilyKey: string;
  metricKey: string;
  unitToken: string | null;
}): KpiAggregation {
  const key = meta.key;
  if (meta.subfamilyKey === "daily_average" || meta.metricKey.includes("daily_average") || key.includes("_daily_average_")) {
    return "daily_average";
  }
  if (
    meta.subfamilyKey === "total" ||
    meta.metricKey.startsWith("total") ||
    key.includes("_total_") ||
    key.endsWith("_total") ||
    key.includes("_count")
  ) {
    return "total";
  }
  if (
    meta.unitToken === "ratio" ||
    meta.unitToken === "percent" ||
    meta.subfamilyKey.includes("ratio") ||
    meta.metricKey.includes("ratio") ||
    meta.metricKey.includes("percent")
  ) {
    return "ratio";
  }
  return "instant";
}

function inferDirection(key: string): KpiDirection {
  if (
    key.includes("cost") ||
    key.includes("emission") ||
    key.includes("import") ||
    key.includes("net_exchange") ||
    key.includes("violation") ||
    key.includes("imbalance") ||
    key.includes("peak") ||
    key.includes("ramping") ||
    key.includes("penalty") ||
    key.includes("discomfort") ||
    key.includes("unserved_energy") ||
    key.includes("deficit") ||
    key.includes("capacity_fade") ||
    key.includes("losers_percent") ||
    key.includes("gini")
  ) {
    return "lower_better";
  }

  if (
    key.includes("self_consumption") ||
    key.includes("generation") ||
    key.includes("local_traded") ||
    key.includes("success_ratio") ||
    key.includes("within_tolerance_ratio") ||
    key.includes("departure_met_count") ||
    key.includes("v2g_export") ||
    key.includes("benefit_relative_percent") ||
    key.includes("top20_benefit") ||
    key.includes("bpr_asset_poor_over_rich")
  ) {
    return "higher_better";
  }

  return "unknown";
}

function buildGenericTooltip(meta: {
  family: KpiFamily;
  variant: KpiVariant;
  aggregation: KpiAggregation;
  metricLabel: string;
}): KpiTooltipInfo {
  const familyDef = KPI_FAMILY_DEFS.find((item) => item.family === meta.family);
  const familyHint = familyDef ? familyDef.description : "KPI from exported_kpis.csv.";

  let formula = `${meta.metricLabel} = exported_kpis[KPI]`;
  if (meta.variant === "delta") formula = "delta = control - baseline";
  if (meta.variant === "normalized") formula = "normalized = control / baseline";
  if (meta.variant === "control") formula = "control = scenario value";
  if (meta.variant === "baseline") formula = "baseline = reference value";
  if (meta.aggregation === "daily_average") formula = `${formula}; daily_average = total / simulated_days`;

  return {
    shortDescription: familyHint,
    formulaShort: formula
  };
}

function variantPriority(variant: KpiVariant): number {
  const index = KPI_VARIANT_ORDER.indexOf(variant);
  return index === -1 ? KPI_VARIANT_ORDER.length : index;
}

export function sortKpiFamilies(families: KpiFamily[]): KpiFamily[] {
  return [...families].sort((left, right) => {
    const leftIndex = KPI_FAMILY_ORDER.indexOf(left);
    const rightIndex = KPI_FAMILY_ORDER.indexOf(right);
    if (leftIndex === rightIndex) return formatKpiFamilyLabel(left).localeCompare(formatKpiFamilyLabel(right));
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

export function sortKpiVariants(variants: KpiVariant[]): KpiVariant[] {
  return [...variants].sort((left, right) => {
    const leftIndex = KPI_VARIANT_ORDER.indexOf(left);
    const rightIndex = KPI_VARIANT_ORDER.indexOf(right);
    if (leftIndex === rightIndex) return left.localeCompare(right);
    return leftIndex - rightIndex;
  });
}

export function sortKpiAggregations(aggregations: KpiAggregation[]): KpiAggregation[] {
  return [...aggregations].sort((left, right) => {
    const leftIndex = KPI_AGGREGATION_ORDER.indexOf(left);
    const rightIndex = KPI_AGGREGATION_ORDER.indexOf(right);
    if (leftIndex === rightIndex) return left.localeCompare(right);
    return leftIndex - rightIndex;
  });
}

export function formatKpiFamilyLabel(family: KpiFamily): string {
  const definition = KPI_FAMILY_DEFS.find((item) => item.family === family);
  return definition ? definition.label : "Other";
}

export function buildKpiMeta(keyRaw: string): KpiMetricMeta {
  const key = normalizeKey(keyRaw);
  const rawTokens = key.split("_").filter(Boolean);
  const tokens = [...rawTokens];

  let level: KpiLevel = "other";
  if (tokens[0] === "building" || tokens[0] === "district") {
    level = tokens[0] as KpiLevel;
    tokens.shift();
  }

  const familyDefinition = KPI_FAMILY_DEFS.find((item) => startsWithTokens(tokens, item.tokens)) || null;
  const family = familyDefinition?.family || "other";
  const familyTokens = familyDefinition?.tokens || [];

  const semanticTokens = [...tokens];
  if (familyTokens.length > 0) {
    semanticTokens.splice(0, familyTokens.length);
  }

  let unitToken: string | null = null;
  if (semanticTokens.length > 0 && UNIT_TOKENS.has(semanticTokens[semanticTokens.length - 1]!)) {
    unitToken = semanticTokens.pop() || null;
  }

  let variant: KpiVariant = "absolute";
  if (semanticTokens.length > 0) {
    const candidate = semanticTokens[semanticTokens.length - 1] as KpiVariant;
    const previousToken = semanticTokens.length > 1 ? semanticTokens[semanticTokens.length - 2] : null;
    if (VARIANT_TOKENS.has(candidate) && previousToken !== "to") {
      variant = candidate;
      semanticTokens.pop();
    }
  }

  let subfamilyTokens: string[] = [];
  const subfamilyMatch = SUBFAMILY_TOKENS.find((candidate) => startsWithTokens(semanticTokens, candidate));
  if (subfamilyMatch) {
    subfamilyTokens = [...subfamilyMatch];
    semanticTokens.splice(0, subfamilyMatch.length);
  } else if (semanticTokens.length > 0) {
    subfamilyTokens = [semanticTokens.shift()!];
  } else {
    subfamilyTokens = ["general"];
  }

  const metricTokens = semanticTokens.length > 0 ? semanticTokens : ["value"];

  const subfamilyKey = subfamilyTokens.join("_");
  const subfamilyLabel = toTitle(subfamilyKey);
  const metricKey = metricTokens.join("_");
  const metricLabel = metricKey === "value" ? "Value" : toTitle(metricKey);

  let canonicalGroupId: string;
  let boardMetricKey: string;

  if (family === "other") {
    const baseTokens = [...rawTokens];
    if (variant !== "absolute") baseTokens.pop();
    canonicalGroupId = baseTokens.join("_") || key;
    boardMetricKey = canonicalGroupId;
  } else {
    const canonicalTokens: string[] = [];
    if (level !== "other") canonicalTokens.push(level);
    canonicalTokens.push(...familyTokens, ...subfamilyTokens);
    if (metricKey !== "value") canonicalTokens.push(...metricTokens);
    if (unitToken) canonicalTokens.push(unitToken);
    canonicalGroupId = canonicalTokens.join("_");
    boardMetricKey = canonicalGroupId;
  }

  const aggregation = inferAggregation({
    key,
    subfamilyKey,
    metricKey,
    unitToken
  });
  const direction = inferDirection(key);
  const tooltip = buildGenericTooltip({
    family,
    variant,
    aggregation,
    metricLabel
  });

  return {
    key,
    level,
    family,
    subfamilyKey,
    subfamilyLabel,
    metricKey,
    metricLabel,
    variant,
    aggregation,
    direction,
    tooltip,
    canonicalGroupId,
    comparisonKey: canonicalGroupId,
    boardMetricKey
  };
}

export function pickPrimaryValueForGroup(row: Pick<KpiMetricGroupRow, "control" | "absolute" | "normalized" | "baseline" | "delta">): number | null {
  if (hasFiniteValue(row.control)) return row.control;
  if (hasFiniteValue(row.absolute)) return row.absolute;
  if (hasFiniteValue(row.normalized)) return row.normalized;
  if (hasFiniteValue(row.baseline)) return row.baseline;
  if (hasFiniteValue(row.delta)) return row.delta;
  return null;
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
    const numericValue = hasFiniteValue(row.value) ? row.value : null;

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        canonicalGroupId: groupKey,
        comparisonKey: groupKey,
        boardMetricKey: meta.boardMetricKey,
        level: meta.level,
        family: meta.family,
        subfamilyKey: meta.subfamilyKey,
        subfamilyLabel: meta.subfamilyLabel,
        metricKey: meta.metricKey,
        metricLabel: meta.metricLabel,
        label: meta.metricLabel,
        unit: row.unit,
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
        hasAnyNumeric: false,
        breakdown: {
          control: [],
          baseline: [],
          delta: [],
          normalized: [],
          absolute: []
        },
        bestLabelPriority: variantPriority(meta.variant)
      });
    }

    const target = grouped.get(groupKey)!;

    if (!target.sourceKeys.includes(meta.key)) {
      target.sourceKeys.push(meta.key);
    }

    const nextLabelPriority = variantPriority(meta.variant);
    if (nextLabelPriority < target.bestLabelPriority) {
      target.bestLabelPriority = nextLabelPriority;
      target.label = meta.metricLabel;
      target.metricLabel = meta.metricLabel;
      target.tooltip = meta.tooltip;
      target.aggregation = meta.aggregation;
      target.direction = meta.direction;
    }

    if (!target.unit && row.unit) {
      target.unit = row.unit;
    }

    const breakdown = row.breakdown.filter((item) => Number.isFinite(item.value));

    if (meta.variant === "control") {
      target.control = numericValue;
      target.breakdown.control = breakdown;
    } else if (meta.variant === "baseline") {
      target.baseline = numericValue;
      target.breakdown.baseline = breakdown;
    } else if (meta.variant === "delta") {
      target.delta = numericValue;
      target.breakdown.delta = breakdown;
    } else if (meta.variant === "normalized") {
      target.normalized = numericValue;
      target.breakdown.normalized = breakdown;
    } else {
      target.absolute = numericValue;
      target.breakdown.absolute = breakdown;
    }
  });

  return Array.from(grouped.values())
    .map((item) => {
      const hasAnyNumeric =
        hasFiniteValue(item.control) ||
        hasFiniteValue(item.baseline) ||
        hasFiniteValue(item.delta) ||
        hasFiniteValue(item.normalized) ||
        hasFiniteValue(item.absolute);

      const deltaFromPair = hasFiniteValue(item.delta)
        ? item.delta
        : hasFiniteValue(item.control) && hasFiniteValue(item.baseline)
          ? item.control - item.baseline
          : null;

      const deltaPct =
        hasFiniteValue(deltaFromPair) && hasFiniteValue(item.baseline) && Math.abs(item.baseline) > 1e-9
          ? (deltaFromPair / Math.abs(item.baseline)) * 100
          : null;

      return {
        ...item,
        hasAnyNumeric,
        delta: deltaFromPair,
        deltaPct
      };
    })
    .sort((left, right) => {
      const familyOrderA = KPI_FAMILY_ORDER.indexOf(left.family);
      const familyOrderB = KPI_FAMILY_ORDER.indexOf(right.family);
      if (familyOrderA !== familyOrderB) return familyOrderA - familyOrderB;
      const subfamilySort = left.subfamilyLabel.localeCompare(right.subfamilyLabel);
      if (subfamilySort !== 0) return subfamilySort;
      return left.metricLabel.localeCompare(right.metricLabel);
    });
}

export function scoreKpiDeltaTone(direction: KpiDirection, delta: number | null): KpiImprovementTone {
  if (!hasFiniteValue(delta)) return "unknown";
  if (Math.abs(delta) < 1e-9) return "neutral";
  if (direction === "neutral") return "neutral";
  if (direction === "unknown") return "unknown";
  if (direction === "lower_better") return delta < 0 ? "better" : "worse";
  return delta > 0 ? "better" : "worse";
}

export function scoreKpiGroupTone(
  row: Pick<KpiMetricGroupRow, "direction" | "delta" | "normalized" | "control" | "baseline">
): KpiImprovementTone {
  const directDelta = hasFiniteValue(row.delta)
    ? row.delta
    : hasFiniteValue(row.control) && hasFiniteValue(row.baseline)
      ? row.control - row.baseline
      : null;

  const deltaTone = scoreKpiDeltaTone(row.direction, directDelta);
  if (deltaTone !== "unknown") return deltaTone;

  if (hasFiniteValue(row.normalized)) {
    if (Math.abs(row.normalized - 1) < 1e-9) return "neutral";
    if (row.direction === "lower_better") return row.normalized < 1 ? "better" : "worse";
    if (row.direction === "higher_better") return row.normalized > 1 ? "better" : "worse";
  }

  return "unknown";
}

export function isKpiGroupUsed(row: KpiMetricGroupRow): boolean {
  if (row.hasAnyNumeric) return true;
  return Object.values(row.breakdown).some((entries) => entries.some((entry) => Number.isFinite(entry.value)));
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

function selectSecondaryForCompare(row: KpiMetricGroupRow | null): { baseline: number | null; delta: number | null } | null {
  if (!row) return null;
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
    const numeric = Number.isFinite(entry.value) ? entry.value : null;
    rows.push({
      key: parsed.metricKey,
      label: entry.label,
      unit: entry.unit,
      value: numeric,
      breakdown: hasFiniteValue(numeric) ? [{ entity: parsed.entity, value: numeric }] : []
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

      const leftPrimary = left ? pickPrimaryValueForGroup(left) : null;
      const rightPrimary = right ? pickPrimaryValueForGroup(right) : null;
      const deltaAbs = hasFiniteValue(leftPrimary) && hasFiniteValue(rightPrimary) ? rightPrimary - leftPrimary : null;
      const deltaPct =
        hasFiniteValue(leftPrimary) && hasFiniteValue(rightPrimary) && Math.abs(leftPrimary) > 1e-9
          ? ((rightPrimary - leftPrimary) / Math.abs(leftPrimary)) * 100
          : null;

      rows.push({
        key: `${canonicalGroupId}::${entity}`,
        canonicalGroupId,
        boardMetricKey: reference.boardMetricKey,
        level: reference.level,
        family: reference.family,
        subfamilyKey: reference.subfamilyKey,
        subfamilyLabel: reference.subfamilyLabel,
        metricKey: reference.metricKey,
        metricLabel: reference.metricLabel,
        label: reference.label,
        unit: reference.unit,
        aggregation: reference.aggregation,
        direction: reference.direction,
        tooltip: reference.tooltip,
        entity,
        leftPrimary,
        rightPrimary,
        leftSecondary: selectSecondaryForCompare(left),
        rightSecondary: selectSecondaryForCompare(right),
        leftHasValue: left ? isKpiGroupUsed(left) : false,
        rightHasValue: right ? isKpiGroupUsed(right) : false,
        deltaAbs,
        deltaPct,
        tone: scoreKpiDeltaTone(reference.direction, deltaAbs)
      });
    });
  });

  return rows.sort((left, right) => {
    const familyOrderA = KPI_FAMILY_ORDER.indexOf(left.family);
    const familyOrderB = KPI_FAMILY_ORDER.indexOf(right.family);
    if (familyOrderA !== familyOrderB) return familyOrderA - familyOrderB;
    const subfamilySort = left.subfamilyLabel.localeCompare(right.subfamilyLabel);
    if (subfamilySort !== 0) return subfamilySort;
    const labelSort = left.label.localeCompare(right.label);
    if (labelSort !== 0) return labelSort;
    return left.entity.localeCompare(right.entity);
  });
}

export function groupRowsByFamilySubfamily<
  T extends { family: KpiFamily; subfamilyKey: string; subfamilyLabel: string }
>(rows: T[]): KpiFamilySection<T>[] {
  const grouped = new Map<KpiFamily, Map<string, KpiSubfamilySection<T>>>();

  rows.forEach((row) => {
    const familyBucket = grouped.get(row.family) || new Map<string, KpiSubfamilySection<T>>();
    const existing = familyBucket.get(row.subfamilyKey);
    if (!existing) {
      familyBucket.set(row.subfamilyKey, {
        subfamilyKey: row.subfamilyKey,
        subfamilyLabel: row.subfamilyLabel,
        rows: [row]
      });
    } else {
      existing.rows.push(row);
    }
    grouped.set(row.family, familyBucket);
  });

  return sortKpiFamilies(Array.from(grouped.keys())).map((family) => {
    const subfamilySections = Array.from(grouped.get(family)?.values() || []).sort((left, right) =>
      left.subfamilyLabel.localeCompare(right.subfamilyLabel)
    );
    return {
      family,
      familyLabel: formatKpiFamilyLabel(family),
      subfamilies: subfamilySections
    };
  });
}

export function stripKpiLevel(value: string): string {
  return stripLevelPrefix(value);
}
