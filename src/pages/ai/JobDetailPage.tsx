import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  BatteryCharging,
  Building2,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Download,
  Eye,
  ExternalLink,
  Factory,
  FileText,
  FolderTree,
  Gauge,
  Home,
  Info,
  Leaf,
  Scale,
  Shield,
  Sun,
  type LucideIcon,
  Zap
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getExperimentConfig,
  getJobInfo,
  getJobProgress,
  getJobResolvedConfig,
  getJobResult,
  getJobStatus,
  listExperimentConfigs
} from "../../api/trainingApi";
import { LOGS_POLL_MS } from "../../constants";
import { useJobLogsPolling } from "../../hooks/useJobLogsPolling";
import { Button } from "../../components/ui/Button";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { StatusPill } from "../../components/ui/StatusPill";
import {
  findSimulationDataDir,
  findSimulationDataSessionDefault,
  getSimulationDataIndex,
  readSimulationDataFile,
  type SimulationDataSource
} from "../../services/simulationDataService";
import {
  readBackendBundleFileAsBlob,
  readBackendBundleManifest,
  readExampleBundleManifest,
  resolveExampleOnnxAssetUrl
} from "../../services/deployBundleService";
import type {
  KpiEntry,
  KpiMatrixRow,
  SimulationSeries,
  SimulationSeriesPoint,
  SimulationTreeNode
} from "../../types";
import { extractKpis } from "../../utils/jobResult";
import { isCompletedForResults } from "../../utils/jobStatus";
import {
  buildKpiMeta,
  formatKpiFamilyLabel,
  groupRowsByFamilySubfamily,
  groupScopedKpis,
  isKpiGroupUsed,
  sortKpiFamilies,
  pickPrimaryValueForGroup,
  scoreKpiGroupTone,
  type KpiFamily,
  type KpiLevel,
  type KpiMetricGroupRow,
  stripKpiLevel
} from "../../utils/kpiMetadata";
import { resolveMlflowRunUrl } from "../../utils/mlflow";
import {
  buildSimulationTree,
  extractKpisFromSimulationData,
  extractChargerStateSamples,
  filterFileRefsByEpisode,
  flattenTreeNodes,
  latestEpisode,
  listEpisodes,
  loadSimulationCsv
} from "../../utils/simulationData";
import {
  deriveChargerActivityOverlay,
  type ChargerStateSample,
  type ChargerTransitionEvent
} from "../../utils/chargerActivity";
import {
  buildChartRowsWithGranularity,
  inferSeriesResolutionMs,
  resolveAvailableGranularityOptions,
  resolveAxisTickStepMs,
  resolveMinimumGranularityMs,
  type GranularityMs,
  type TimeseriesChartRow,
  type TimeseriesPreset
} from "../../utils/timeseriesGranularity";
import { formatDateTime, formatDurationSeconds } from "../../utils/time";
import { DayPicker } from "react-day-picker";

const DETAIL_TABS = ["overview", "timeseries", "kpis", "deploy"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];
type TimePreset = TimeseriesPreset;
type CustomRangeSource = "zoom" | "picker" | null;

interface ZoomHistoryEntry {
  useCustomRange: boolean;
  customRangeSource: CustomRangeSource;
  customFrom: string;
  customTo: string;
  timePreset: TimePreset;
  windowStartMs: number | null;
}

interface TimeseriesBundle {
  fileRef: string;
  title: string;
  series: SimulationSeries[];
  chargerActivity?: {
    samples: ChargerStateSample[];
  };
}

interface ChartMouseState {
  activeLabel?: unknown;
  activePayload?: Array<{ payload?: { epochMs?: unknown } }>;
  xValue?: unknown;
  chartX?: unknown;
  offset?: { left?: unknown; width?: unknown };
  activeCoordinate?: { x?: unknown };
  xAxisMap?: Record<
    string,
    {
      domain?: unknown;
      range?: unknown;
      scale?: { invert?: (value: number) => number };
    }
  >;
}

interface ScopedKpiRow {
  key: string;
  label: string;
  unit?: string;
  value: number | null;
  breakdown: Array<{ entity: string; value: number }>;
}

interface DeployManifestData {
  content: string;
  relativePath: string;
  source: "mock" | "backend";
  backendBasePrefix: string;
  manifest: Record<string, unknown> | null;
}

interface DeployArtifactRow {
  agentIndex: number | null;
  buildingId: number | null;
  format: string | null;
  path: string;
  onnxUrl: string | null;
}

interface KpiHighlightConfig {
  title: string;
  candidates: string[];
}

interface KpiHighlightRow {
  key: string;
  title: string;
  metricLabel: string;
  description: string;
  formula: string;
  unit?: string;
  value: number | null;
  control: number | null;
  baseline: number | null;
  delta: number | null;
  tone: "better" | "worse" | "neutral" | "unknown";
  hasComparable: boolean;
}

const DISTRICT_HIGHLIGHTS: KpiHighlightConfig[] = [
  {
    title: "Cost",
    candidates: ["district_cost_ratio_to_baseline_total_ratio", "district_cost_total_control_eur"]
  },
  {
    title: "Emissions",
    candidates: ["district_emissions_ratio_to_baseline_total_ratio", "district_emissions_total_control_kgco2"]
  },
  {
    title: "Grid Import",
    candidates: [
      "district_energy_grid_ratio_to_baseline_import_total_ratio",
      "district_energy_grid_total_import_control_kwh"
    ]
  },
  {
    title: "Peak Quality",
    candidates: [
      "district_energy_grid_shape_quality_peak_daily_average_to_baseline_ratio",
      "district_energy_grid_shape_quality_peak_all_time_average_to_baseline_ratio"
    ]
  },
  {
    title: "Solar Self-Consumption",
    candidates: [
      "district_solar_self_consumption_ratio_self_consumption_ratio",
      "district_solar_self_consumption_community_market_import_share_ratio"
    ]
  },
  {
    title: "EV Departure Success",
    candidates: [
      "district_ev_performance_departure_success_ratio",
      "district_ev_performance_departure_within_tolerance_ratio"
    ]
  },
  {
    title: "Battery Capacity Fade",
    candidates: [
      "district_battery_health_capacity_fade_ratio",
      "district_battery_health_equivalent_full_cycles_count"
    ]
  },
  {
    title: "Equity Gini",
    candidates: [
      "district_equity_distribution_gini_benefit_ratio",
      "district_equity_distribution_top20_benefit_ratio"
    ]
  }
];

const BUILDING_HIGHLIGHTS: KpiHighlightConfig[] = [
  {
    title: "Cost",
    candidates: ["building_cost_ratio_to_baseline_total_ratio", "building_cost_total_control_eur"]
  },
  {
    title: "Emissions",
    candidates: ["building_emissions_ratio_to_baseline_total_ratio", "building_emissions_total_control_kgco2"]
  },
  {
    title: "Grid Import",
    candidates: [
      "building_energy_grid_ratio_to_baseline_import_total_ratio",
      "building_energy_grid_total_import_control_kwh"
    ]
  },
  {
    title: "Solar Self-Consumption",
    candidates: ["building_solar_self_consumption_ratio_self_consumption_ratio", "building_solar_self_consumption_total_generation_kwh"]
  },
  {
    title: "EV Departure Success",
    candidates: ["building_ev_performance_departure_success_ratio", "building_ev_performance_departure_within_tolerance_ratio"]
  },
  {
    title: "Battery Capacity Fade",
    candidates: ["building_battery_health_capacity_fade_ratio", "building_battery_health_equivalent_full_cycles_count"]
  },
  {
    title: "Equity Benefit",
    candidates: ["building_equity_benefit_relative_percent", "building_equity_distribution_top20_benefit_ratio"]
  },
  {
    title: "Discomfort",
    candidates: [
      "building_comfort_resilience_discomfort_overall_ratio",
      "building_comfort_resilience_resilience_one_minus_thermal_ratio"
    ]
  }
];

const KPI_FAMILY_ICONS: Record<KpiFamily, LucideIcon> = {
  cost: CircleDollarSign,
  energy_grid: Zap,
  emissions: Leaf,
  solar_self_consumption: Sun,
  ev: Car,
  battery: BatteryCharging,
  electrical_service_phase: Activity,
  equity: Scale,
  comfort_resilience: Shield,
  other: FolderTree
};

function resolveFamilyIcon(family: KpiFamily): LucideIcon {
  return KPI_FAMILY_ICONS[family] || FolderTree;
}

function formatToneLabel(
  tone: "better" | "worse" | "neutral" | "unknown",
  options?: { hideUnknown?: boolean }
): string | null {
  if (tone === "better") return "Better";
  if (tone === "worse") return "Worse";
  if (tone === "neutral") return "Neutral";
  return options?.hideUnknown ? null : "Unknown";
}

const CHART_COLORS = ["#1db97f", "#4f8cff", "#f4a340", "#ea5a5a", "#9e7bff", "#00bcd4"];
const TIMESERIES_CHART_HEIGHT = 258;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TIME_PRESET_MS: Record<Exclude<TimePreset, "all">, number> = {
  "1h": HOUR_MS,
  "6h": 6 * HOUR_MS,
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS
};

function isValidTab(value: string | null): value is DetailTab {
  return Boolean(value) && DETAIL_TABS.includes(value as DetailTab);
}

function resolveBackTarget(fromParam: string | null): string {
  if (!fromParam) return "/app/ai/jobs";
  if (fromParam.startsWith("?")) return `/app/ai/jobs${fromParam}`;
  return `/app/ai/jobs?${fromParam}`;
}

function pickUpdatedAt(
  progress: Record<string, unknown> | undefined,
  info: Record<string, unknown> | undefined
): string | number | null {
  if (progress) {
    const fromProgress = progress.updated_at || progress.timestamp || progress.last_update;
    if (typeof fromProgress === "string" || typeof fromProgress === "number") {
      return fromProgress;
    }
  }

  if (info) {
    const fromInfo = info.updated_at || info.last_update || info.finished_at || info.created_at;
    if (typeof fromInfo === "string" || typeof fromInfo === "number") {
      return fromInfo;
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function readStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readStringFrom(source: Record<string, unknown> | null, keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = readStringValue(source[key]);
    if (value) return value;
  }
  return null;
}

function readNumberFrom(source: Record<string, unknown> | null, keys: string[]): number | null {
  if (!source) return null;
  for (const key of keys) {
    const value = readNumberValue(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function readDateLikeFrom(source: Record<string, unknown> | null, keys: string[]): string | number | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

function resolveConfigLabel(configPath: string | null | undefined): string {
  if (!configPath) return "-";
  const normalized = configPath.split(/[\\/]/).filter(Boolean);
  return normalized[normalized.length - 1] || configPath;
}

function isGpuLikePartition(partition: string | null | undefined): boolean {
  if (!partition) return false;
  const key = partition.toLowerCase();
  return key.includes("gpu") || key.includes("a100") || key.includes("h100");
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  return value.toFixed(4);
}

function formatHighlightNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(2);
  return value.toFixed(3);
}

function formatYAxisTick(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) < 1e-9) return "0";
  const abs = Math.abs(value);
  if (abs >= 100) return Math.round(value).toLocaleString();
  if (abs >= 10) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(1).replace(/\.0$/, "");
  if (abs >= 0.1) return value.toFixed(2);
  return value.toFixed(3);
}

function parseDateTimeLocal(input: string): number | null {
  if (!input) return null;
  const parsed = Date.parse(input);
  return Number.isNaN(parsed) ? null : parsed;
}

function toDateTimeLocal(epochMs: number | null): string {
  if (!epochMs) return "";
  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatIsoDay(date: Date): string {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    .toISOString()
    .slice(0, 10);
}

function extractTimePart(local: string, fallback = "00:00"): string {
  const epoch = parseDateTimeLocal(local);
  if (epoch === null) return fallback;
  const date = new Date(epoch);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function applyDateAndTime(date: Date, time: string): string {
  const [hoursPart, minutesPart] = time.split(":");
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  const next = new Date(date);
  next.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return toDateTimeLocal(next.getTime());
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function formatPickerDay(date: Date): string {
  return date.toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function resolveFileTitle(relativePath: string): string {
  const fileName = relativePath.split("/").pop() || relativePath;
  const base = fileName
    .replace(/\.csv$/i, "")
    .replace(/^exported_data_/i, "")
    .replace(/_ep\d+$/i, "")
    .replaceAll("_", " ");
  return base.replace(/\b\w/g, (chunk) => chunk.toUpperCase());
}

function rankMetric(metric: string): number {
  const key = metric.toLowerCase();
  if (key.includes("net electricity consumption")) return 0;
  if (key.includes("self consumption")) return 1;
  if (
    key.includes("non_shiftable") ||
    key.includes("non-shiftable") ||
    key.includes("non shiftable") ||
    key.includes("nonshiftable")
  ) {
    return 2;
  }
  if (key.includes("production")) return 3;
  if (key.includes("import")) return 4;
  if (key.includes("export")) return 5;
  if (key.includes("price") || key.includes("cost")) return 6;
  if (key.includes("soc")) return 7;
  if (key.includes("charge")) return 8;
  return 20;
}

function isPriceSeries(entry: SimulationSeries): boolean {
  const probe = `${entry.metric} ${entry.unit || ""}`.toLowerCase();
  return (
    probe.includes("price") ||
    probe.includes("tariff") ||
    probe.includes("cost") ||
    probe.includes("eur") ||
    probe.includes("€/") ||
    probe.includes("$")
  );
}

function isSocSeries(entry: Pick<SimulationSeries, "id" | "metric" | "unit">): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return (
    probe.includes("soc") ||
    probe.includes("state_of_charge") ||
    probe.includes("state of charge") ||
    probe.includes("estimated_soc") ||
    probe.includes("required_soc")
  );
}

function shouldRenderAsLine(entry: SimulationSeries): boolean {
  return isPriceSeries(entry) || isSocSeries(entry);
}

function isChargerFileRef(fileRef: string): boolean {
  return /exported_data_[^/]+_charger_[^/]+_ep\d+\.csv$/i.test(fileRef);
}

function isElectricVehicleFileRef(fileRef: string): boolean {
  return /exported_data_(electric_vehicle_\d+|ev_[^/]+|vehicle_[^/]+)_ep\d+\.csv$/i.test(fileRef);
}

function isChargerConsumptionSeries(entry: Pick<SimulationSeries, "id" | "metric">): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return probe.includes("charger") && probe.includes("consumption") && !probe.includes("net");
}

function isChargerProductionSeries(entry: Pick<SimulationSeries, "id" | "metric">): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return probe.includes("charger") && probe.includes("production") && !probe.includes("net");
}

function isChargerNetSeries(entry: Pick<SimulationSeries, "id" | "metric">): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return probe.includes("charger_net");
}

function isChargerStateSeries(entry: Pick<SimulationSeries, "id" | "metric">): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return (
    probe.includes("ev charger state") ||
    (probe.includes("charger") && probe.includes("state"))
  );
}

function buildChargerSamplesFromStateSeries(
  stateSeries: SimulationSeries | undefined
): ChargerStateSample[] {
  if (!stateSeries) return [];
  return stateSeries.points
    .filter((point) => Number.isFinite(point.value) && typeof point.epochMs === "number")
    .map((point) => {
      let chargerState: 0 | 1 | 2 = 0;
      const rounded = Math.round(point.value);
      if (rounded === 1 || rounded === 2) chargerState = rounded;
      return {
        timestamp: point.timestamp,
        epochMs: point.epochMs as number,
        chargerState,
        incomingEvName: null,
        evName: null
      } satisfies ChargerStateSample;
    });
}

function isChargingActionSeries(entry: Pick<SimulationSeries, "id" | "metric">): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return probe.includes("charging action") || probe.includes("charging_action");
}

function isBatteryCapacitySeries(entry: Pick<SimulationSeries, "id" | "metric">): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return probe.includes("battery capacity") || probe.includes("battery_capacity");
}

function mergeChargerNetSeries(fileRef: string, series: SimulationSeries[]): SimulationSeries[] {
  if (!isChargerFileRef(fileRef) || series.length < 2) return series;

  const consumption = series.find((entry) => isChargerConsumptionSeries(entry));
  const production = series.find((entry) => isChargerProductionSeries(entry));
  if (!consumption || !production) return series;

  type ChargerNetAccumulator = {
    timestamp: string;
    epochMs: number | null;
    consumption: number;
    production: number;
  };

  const pointsMap = new Map<string, ChargerNetAccumulator>();
  const pointKey = (point: SimulationSeriesPoint): string =>
    typeof point.epochMs === "number" ? `e:${point.epochMs}` : `t:${point.timestamp}`;
  const ensureAcc = (point: SimulationSeriesPoint): ChargerNetAccumulator => {
    const key = pointKey(point);
    const existing = pointsMap.get(key);
    if (existing) return existing;
    const created: ChargerNetAccumulator = {
      timestamp: point.timestamp,
      epochMs: point.epochMs,
      consumption: 0,
      production: 0
    };
    pointsMap.set(key, created);
    return created;
  };

  consumption.points.forEach((point) => {
    if (!Number.isFinite(point.value)) return;
    const acc = ensureAcc(point);
    // Requirement: treat -1 in charger consumption as 0 before net calculation.
    acc.consumption = Math.abs(point.value + 1) < 1e-9 ? 0 : point.value;
  });
  production.points.forEach((point) => {
    if (!Number.isFinite(point.value)) return;
    const acc = ensureAcc(point);
    // Requirement: treat -1 in charger production as 0 before net calculation.
    acc.production = Math.abs(point.value + 1) < 1e-9 ? 0 : point.value;
  });

  const mergedPoints = Array.from(pointsMap.values())
    .map((item) => ({
      timestamp: item.timestamp,
      epochMs: item.epochMs,
      value: item.consumption - item.production
    }))
    .sort((left, right) => {
      const leftEpoch = typeof left.epochMs === "number" ? left.epochMs : Number.POSITIVE_INFINITY;
      const rightEpoch = typeof right.epochMs === "number" ? right.epochMs : Number.POSITIVE_INFINITY;
      if (leftEpoch !== rightEpoch) return leftEpoch - rightEpoch;
      return left.timestamp.localeCompare(right.timestamp);
    });

  if (mergedPoints.length < 2) return series;

  const netSeries: SimulationSeries = {
    id: `${fileRef}::charger_net`,
    fileRef,
    metric: "charger_net",
    unit: consumption.unit || production.unit,
    points: mergedPoints
  };

  const filtered = series.filter((entry) => entry.id !== consumption.id && entry.id !== production.id);
  return [...filtered, netSeries];
}

function breakLineGaps(
  rows: TimeseriesChartRow[],
  lineSeriesIds: string[],
  _granularityMs: number
): TimeseriesChartRow[] {
  if (rows.length === 0 || lineSeriesIds.length === 0) return rows;

  // Ensure line-series holes are explicit nulls without creating synthetic timestamps
  // that could alter unrelated series.
  return rows.map((row) => {
    let changed = false;
    const next: TimeseriesChartRow = { ...row };
    lineSeriesIds.forEach((seriesId) => {
      if (next[seriesId] === undefined) {
        next[seriesId] = null;
        changed = true;
      }
    });
    return changed ? next : row;
  });
}

function isPredictedPriceSeries(entry: SimulationSeries): boolean {
  if (!isPriceSeries(entry)) return false;
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return (
    probe.includes("predict") ||
    probe.includes("forecast") ||
    probe.includes("future") ||
    probe.includes("expected")
  );
}

function isConsumptionSeries(entry: SimulationSeries): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return probe.includes("consumption");
}

function isNetElectricityConsumptionSeries(entry: SimulationSeries): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return probe.includes("net electricity consumption");
}

function isSelfConsumptionSeries(entry: SimulationSeries): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return probe.includes("self consumption");
}

function isNonShiftableSeries(entry: SimulationSeries): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return (
    probe.includes("non_shiftable") ||
    probe.includes("non-shiftable") ||
    probe.includes("non shiftable") ||
    probe.includes("nonshiftable")
  );
}

function isCommunityFileRef(fileRef: string): boolean {
  return /exported_data_community_ep\d+\.csv$/i.test(fileRef);
}

function isPrimaryEntityFileRef(fileRef: string): boolean {
  const fileName = fileRef.split("/").pop() || fileRef;
  if (!/^exported_data_.+_ep\d+\.csv$/i.test(fileName)) return false;
  if (/^exported_data_(community|pricing)_ep\d+\.csv$/i.test(fileName)) return false;
  if (/_battery_/i.test(fileName)) return false;
  if (/_charger_/i.test(fileName)) return false;
  return true;
}

function isEvSocSeries(entry: Pick<SimulationSeries, "id" | "metric">): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return (
    isSocSeries(entry) &&
    (probe.includes("ev") || probe.includes("electric_vehicle") || probe.includes("vehicle"))
  );
}

function isMainEvSocSeries(entry: Pick<SimulationSeries, "id" | "metric">): boolean {
  return isEvSocSeries(entry) && !isRequiredSocSeries(entry) && !isEstimatedSocSeries(entry);
}

function isPercentLikeSocSeries(entry: Pick<SimulationSeries, "metric" | "unit">): boolean {
  const metricKey = entry.metric.toLowerCase();
  const unitKey = (entry.unit || "").toLowerCase();
  return (
    unitKey.includes("%") ||
    unitKey.includes("percent") ||
    metricKey.includes("%") ||
    metricKey.includes("pct") ||
    metricKey.includes("percent")
  );
}

function keepPreferredEvSocSeries(series: SimulationSeries[]): SimulationSeries[] {
  const mainEvSoc = series.filter((entry) => isMainEvSocSeries(entry));
  if (mainEvSoc.length <= 1) return series;

  const preferred =
    mainEvSoc.find((entry) => isPercentLikeSocSeries(entry)) ||
    mainEvSoc.find((entry) => !entry.metric.toLowerCase().includes("kwh")) ||
    mainEvSoc[0];

  return series.filter((entry) => !isMainEvSocSeries(entry) || entry.id === preferred.id);
}

function isRequiredSocSeries(entry: Pick<SimulationSeries, "id" | "metric">): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return isSocSeries(entry) && probe.includes("required");
}

function isEstimatedSocSeries(entry: Pick<SimulationSeries, "id" | "metric">): boolean {
  const probe = `${entry.metric} ${entry.id}`.toLowerCase();
  return isSocSeries(entry) && probe.includes("estimated");
}

function sanitizeSeriesForChart(series: SimulationSeries[]): SimulationSeries[] {
  return series.map((entry) => {
    let points = entry.points;
    let changed = false;

    if (isRequiredSocSeries(entry) || isEstimatedSocSeries(entry)) {
      const filteredPoints = points.filter((point) => Number.isFinite(point.value) && point.value > 0);
      if (filteredPoints.length !== points.length) {
        points = filteredPoints;
        changed = true;
      }
    }

    if (isSocSeries(entry)) {
      const finiteValues = points
        .map((point) => point.value)
        .filter((value) => Number.isFinite(value));
      if (finiteValues.length > 0) {
        const maxValue = Math.max(...finiteValues);
        const minValue = Math.min(...finiteValues);
        // Normalize fractional SoC (0..1) to percentage scale (0..100).
        if (maxValue <= 1.000001 && minValue >= 0) {
          points = points.map((point) => ({ ...point, value: point.value * 100 }));
          changed = true;
        }
      }
    }

    if (!changed) return entry;
    return {
      ...entry,
      points
    };
  });
}

function buildYAxisTicks(domain: [number, number] | null): number[] | undefined {
  if (!domain) return undefined;
  let [rawMin, rawMax] = domain;
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return undefined;
  let min = Math.min(rawMin, rawMax, 0);
  let max = Math.max(rawMin, rawMax, 0);
  if (Math.abs(max - min) < 1e-9) {
    min -= 1;
    max += 1;
  }

  const span = Math.max(max - min, 1e-9);
  const targetTickCount = 7;
  const roughStep = span / (targetTickCount - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;
  const candidates = [1, 2, 2.5, 5, 10];
  let best = candidates[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(normalized - candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  let step = best * magnitude;
  if (!Number.isFinite(step) || step <= 0) step = 1;
  // Keep a readable number of Y ticks.
  while (span / step > 8) step *= 2;

  const ticks = new Set<number>();
  ticks.add(Number(min.toFixed(8)));
  ticks.add(Number(max.toFixed(8)));
  if (min <= 0 && max >= 0) ticks.add(0);

  if (min < 0) {
    for (let value = -step; value >= min; value -= step) {
      ticks.add(Number(value.toFixed(8)));
      if (ticks.size > 20) break;
    }
  }

  if (max > 0) {
    for (let value = 0; value <= max; value += step) {
      ticks.add(Number(value.toFixed(8)));
      if (ticks.size > 20) break;
    }
  }

  return Array.from(ticks).sort((a, b) => a - b);
}

function resolveActiveEpoch(state: ChartMouseState | undefined): number | null {
  if (!state) return null;
  if (typeof state.activeLabel === "number") return state.activeLabel;
  if (typeof state.xValue === "number") return state.xValue;
  const fromPayload = state.activePayload?.[0]?.payload?.epochMs;
  if (typeof fromPayload === "number") return fromPayload;

  if (typeof state.chartX === "number" && state.xAxisMap) {
    const firstAxis = Object.values(state.xAxisMap)[0];
    if (firstAxis) {
      if (firstAxis.scale?.invert) {
        const inverted = firstAxis.scale.invert(state.chartX);
        if (Number.isFinite(inverted)) return inverted;
      }

      if (Array.isArray(firstAxis.range) && Array.isArray(firstAxis.domain)) {
        const [rangeStart, rangeEnd] = firstAxis.range;
        const [domainStart, domainEnd] = firstAxis.domain;
        if (
          typeof rangeStart === "number" &&
          typeof rangeEnd === "number" &&
          typeof domainStart === "number" &&
          typeof domainEnd === "number" &&
          rangeEnd !== rangeStart
        ) {
          const clampedX = Math.min(Math.max(state.chartX, rangeStart), rangeEnd);
          const ratio = (clampedX - rangeStart) / (rangeEnd - rangeStart);
          return domainStart + ratio * (domainEnd - domainStart);
        }
      }
    }
  }

  return null;
}

function alignToBoundary(epochMs: number, stepMs: number): number {
  const date = new Date(epochMs);
  if (stepMs >= DAY_MS) {
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  if (stepMs % HOUR_MS === 0) {
    const hoursStep = Math.max(1, Math.round(stepMs / HOUR_MS));
    const hour = date.getHours();
    const alignedHour = hour - (hour % hoursStep);
    date.setHours(alignedHour, 0, 0, 0);
    return date.getTime();
  }

  const minutesStep = Math.max(1, Math.round(stepMs / (60 * 1000)));
  const minutes = date.getMinutes();
  const alignedMinutes = minutes - (minutes % minutesStep);
  date.setSeconds(0, 0);
  date.setMinutes(alignedMinutes);
  return date.getTime();
}

function alignPresetWindowStart(epochMs: number, preset: TimePreset): number {
  if (preset === "all") return epochMs;
  const date = new Date(epochMs);

  if (preset === "24h" || preset === "7d" || preset === "30d") {
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  if (preset === "6h") {
    date.setMinutes(0, 0, 0);
    const currentHour = date.getHours();
    const alignedHour = currentHour - (currentHour % 6);
    date.setHours(alignedHour, 0, 0, 0);
    return date.getTime();
  }

  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function buildAxisTicks(
  startEpoch: number | null,
  endEpoch: number | null,
  stepMs: number
): number[] {
  if (startEpoch === null || endEpoch === null || endEpoch <= startEpoch) return [];
  const ticks: number[] = [];
  let cursor = alignToBoundary(startEpoch, stepMs);
  if (cursor < startEpoch) cursor += stepMs;

  while (cursor <= endEpoch) {
    ticks.push(cursor);
    cursor += stepMs;
  }

  if (ticks.length === 0 || ticks[0] !== startEpoch) ticks.unshift(startEpoch);
  if (ticks[ticks.length - 1] !== endEpoch) ticks.push(endEpoch);
  return ticks;
}

function formatAxisTick(epoch: number, stepMs: number, firstTickEpoch?: number): string {
  const date = new Date(epoch);
  if (stepMs >= DAY_MS) {
    return date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  }

  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const isDayStart = date.getHours() === 0 && date.getMinutes() === 0;
  const isFirstTick = typeof firstTickEpoch === "number" && epoch === firstTickEpoch;
  if (isDayStart || isFirstTick) {
    const day = date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
    return `${day} ${time}`;
  }
  return time;
}

function formatRangeSummary(startEpoch: number | null, endEpoch: number | null): string {
  if (startEpoch === null || endEpoch === null) return "Full range";
  const start = new Date(startEpoch).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const end = new Date(endEpoch).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return `${start} → ${end}`;
}

function parseTimeInput(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;

  const colonMatch = value.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (colonMatch) {
    const hours = Number(colonMatch[1]);
    const minutes = Number(colonMatch[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
    return null;
  }

  const compactMatch = value.match(/^(\d{3,4})$/);
  if (compactMatch) {
    const digits = compactMatch[1].padStart(4, "0");
    const hours = Number(digits.slice(0, 2));
    const minutes = Number(digits.slice(2, 4));
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
    }
  }

  return null;
}

function offsetTimeValue(time: string, minutesDelta: number): string {
  const parsed = parseTimeInput(time);
  const baseline = parsed || "00:00";
  const [hoursPart, minutesPart] = baseline.split(":");
  const initialMinutes = Number(hoursPart) * 60 + Number(minutesPart);
  const next = ((initialMinutes + minutesDelta) % (24 * 60) + 24 * 60) % (24 * 60);
  const hours = Math.floor(next / 60);
  const minutes = next % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function resolveInclusiveCustomEnd(startEpoch: number | null, endEpoch: number | null): number | null {
  if (startEpoch === null || endEpoch === null) return endEpoch;
  if (endEpoch <= startEpoch) return endEpoch;
  const endDate = new Date(endEpoch);
  const isMidnight = endDate.getHours() === 0 && endDate.getMinutes() === 0;
  if (!isMidnight) return endEpoch;
  return endEpoch + DAY_MS;
}

function listNodeChildren(node: SimulationTreeNode): SimulationTreeNode[] {
  if (!node.children || node.children.length === 0) return [];
  return node.children;
}

interface KpiEntityScope {
  id: string;
  label: string;
  group: "community" | "building" | "other";
  entityKeys: string[];
}

function parseBuildingEntityId(entity: string): number | null {
  const match = entity.match(/building[_\s-]*(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEntityToken(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function canonicalSiteKey(raw: string): string | null {
  const normalized = normalizeEntityToken(raw);
  if (!normalized || normalized === "building") return null;

  if (normalized === "hq" || normalized === "boavista") return "hq";
  if (["sm", "sao_mamede", "sao_mamed", "saomamede", "sao_mamede_inference"].includes(normalized)) {
    return "sao_mamede";
  }

  const compact = normalized.replaceAll("_", "");
  if (/^rh\d+$/.test(compact)) {
    const digits = compact.replace(/^rh/, "");
    return `r_h_${digits.padStart(2, "0")}`;
  }

  if (/^\d+$/.test(normalized)) {
    return String(Number(normalized));
  }

  return normalized;
}

function parseKpiEntityBuildingKey(entity: string): string | null {
  const normalized = normalizeEntityToken(entity);
  if (!normalized) return null;

  if (normalized.startsWith("building_")) {
    return canonicalSiteKey(normalized.replace(/^building_+/, ""));
  }

  if (/^\d+$/.test(normalized)) {
    return canonicalSiteKey(normalized);
  }

  if (
    normalized === "hq" ||
    normalized === "boavista" ||
    ["sm", "sao_mamede", "sao_mamed", "saomamede", "sao_mamede_inference"].includes(normalized) ||
    /^r?_?h_?\d+$/i.test(normalized)
  ) {
    return canonicalSiteKey(normalized);
  }

  return null;
}

function parseTreeNodeBuildingKey(node: SimulationTreeNode): string | null {
  if (node.kind !== "building") return null;
  const matchFromId = node.id.match(/^building:(.+)$/i);
  if (matchFromId) {
    const fromId = canonicalSiteKey(matchFromId[1]);
    if (fromId) return fromId;
  }
  return canonicalSiteKey(node.label);
}

function formatKpiBuildingScopeLabel(siteKey: string): string {
  if (/^\d+$/.test(siteKey)) {
    return `Building ${Number(siteKey)}`;
  }
  if (siteKey === "hq") return "Boavista (HQ)";
  if (siteKey === "sao_mamede") return "Sao Mamede";

  const rhMatch = siteKey.match(/^r_h_(\d+)$/);
  if (rhMatch) {
    return `R-H-${rhMatch[1]!.padStart(2, "0")}`;
  }

  return siteKey
    .split("_")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function parseBuildingNodeNumber(node: SimulationTreeNode): number | null {
  const matchFromId = node.id.match(/building:(\d+)/i);
  if (matchFromId) {
    const parsed = Number(matchFromId[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return parseBuildingEntityId(node.label);
}

function readAgentIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return null;
}

function inferBuildingFromAgentConfig(config: Record<string, unknown> | null): number | null {
  if (!config) return null;
  const chargerRecord = asRecord(config.chargers);
  if (chargerRecord) {
    for (const chargerName of Object.keys(chargerRecord)) {
      const match = chargerName.match(/charger_(\d+)_/i);
      if (match) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }

  const actionOrder = Array.isArray(config.action_order) ? config.action_order : [];
  for (const item of actionOrder) {
    if (typeof item !== "string") continue;
    const match = item.match(/charger_(\d+)_/i);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

function isCommunityEntity(entity: string): boolean {
  return /(community|overall|global|rec|microgrid|district)/i.test(entity);
}

function hasComparableSignal(
  row: Pick<KpiMetricGroupRow, "control" | "baseline" | "delta" | "normalized">
): boolean {
  if (typeof row.delta === "number" && Number.isFinite(row.delta)) return true;
  if (
    typeof row.control === "number" &&
    Number.isFinite(row.control) &&
    typeof row.baseline === "number" &&
    Number.isFinite(row.baseline)
  ) {
    return true;
  }
  return typeof row.normalized === "number" && Number.isFinite(row.normalized);
}

function resolveHighlightCandidates(rows: KpiMetricGroupRow[], candidateKey: string): KpiMetricGroupRow[] {
  const targetMeta = buildKpiMeta(candidateKey);
  const targetCanonical = targetMeta.canonicalGroupId;
  const targetCanonicalNoLevel = stripKpiLevel(targetCanonical);

  return rows.filter((row) => {
    if (row.canonicalGroupId === targetCanonical) return true;
    if (stripKpiLevel(row.canonicalGroupId) === targetCanonicalNoLevel) return true;
    return row.metricLabel.toLowerCase() === targetMeta.metricLabel.toLowerCase() && row.family === targetMeta.family;
  });
}

function resolveScopeHighlights(rows: KpiMetricGroupRow[], level: KpiLevel | null): KpiHighlightRow[] {
  const source = level === "district" ? DISTRICT_HIGHLIGHTS : level === "building" ? BUILDING_HIGHLIGHTS : [];
  return source.map((item) => {
    const rankedCandidates = item.candidates.flatMap((candidateKey, candidateIndex) =>
      resolveHighlightCandidates(rows, candidateKey).map((row) => ({
        row,
        candidateIndex
      }))
    );

    const best = rankedCandidates
      .sort((left, right) => {
        const leftComparable = Number(hasComparableSignal(left.row));
        const rightComparable = Number(hasComparableSignal(right.row));
        if (leftComparable !== rightComparable) return rightComparable - leftComparable;
        const leftUsed = Number(isKpiGroupUsed(left.row));
        const rightUsed = Number(isKpiGroupUsed(right.row));
        if (leftUsed !== rightUsed) return rightUsed - leftUsed;
        return left.candidateIndex - right.candidateIndex;
      })
      .map((item) => item.row)[0];

    const primaryMeta = buildKpiMeta(item.candidates[0] || "legacy_kpi");
    const hasComparable = best ? hasComparableSignal(best) : false;
    const tone = best && hasComparable ? scoreKpiGroupTone(best) : "unknown";

    return {
      key: best?.canonicalGroupId || primaryMeta.canonicalGroupId,
      title: item.title,
      metricLabel: best?.label || primaryMeta.metricLabel,
      description: best?.tooltip.shortDescription || primaryMeta.tooltip.shortDescription,
      formula: best?.tooltip.formulaShort || primaryMeta.tooltip.formulaShort,
      unit: best?.unit,
      value: best ? pickPrimaryValueForGroup(best) : null,
      control: best?.control ?? null,
      baseline: best?.baseline ?? null,
      delta: best?.delta ?? null,
      tone,
      hasComparable
    };
  });
}

function nodeIcon(kind: SimulationTreeNode["kind"]): JSX.Element {
  if (kind === "community") return <Factory size={14} />;
  if (kind === "building") return <Building2 size={14} />;
  if (kind === "battery") return <BatteryCharging size={14} />;
  if (kind === "charger") return <Gauge size={14} />;
  if (kind === "electric_vehicle") return <Car size={14} />;
  if (kind === "pricing") return <CircleDollarSign size={14} />;
  if (kind === "group") return <FolderTree size={14} />;
  return <ChevronRight size={14} />;
}

function TimeseriesTreeNode({
  node,
  communityLabel,
  depth,
  selectedId,
  selectedBuildingIds,
  selectedAssetIds,
  expanded,
  onSelect,
  onToggle
}: {
  node: SimulationTreeNode;
  communityLabel: string;
  depth: number;
  selectedId: string;
  selectedBuildingIds: Set<string>;
  selectedAssetIds: Set<string>;
  expanded: Set<string>;
  onSelect: (id: string, additive: boolean) => void;
  onToggle: (id: string) => void;
}): JSX.Element {
  const children = listNodeChildren(node);
  const hasChildren = children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isOverlay = selectedAssetIds.has(node.id);
  const isComparedBuilding = node.kind === "building" && selectedBuildingIds.has(node.id);
  const isSelected = selectedId === node.id || isOverlay;
  const displayLabel = node.kind === "community" ? communityLabel : node.label;
  const rowClass = [
    "sim-tree-row",
    isSelected ? "is-selected" : "",
    isComparedBuilding ? "is-compared" : "",
    isOverlay ? "is-overlay" : "",
    hasChildren ? "is-group" : "",
    depth === 0 ? "is-root-level" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li>
      <div className={rowClass} style={{ paddingLeft: `${depth * 14}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className="sim-tree-toggle"
            onClick={() => onToggle(node.id)}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="sim-tree-toggle is-spacer" />
        )}
        <button
          type="button"
          className="sim-tree-label"
          onClick={(event) => onSelect(node.id, event.ctrlKey || event.metaKey || event.shiftKey)}
          title={displayLabel}
        >
          <span className="sim-tree-icon">{nodeIcon(node.kind)}</span>
          <span>{displayLabel}</span>
        </button>
      </div>

      {hasChildren && isExpanded ? (
        <ul className="sim-tree-list">
          {children.map((child) => (
            <TimeseriesTreeNode
              key={child.id}
              node={child}
              communityLabel={communityLabel}
              depth={depth + 1}
              selectedId={selectedId}
              selectedBuildingIds={selectedBuildingIds}
              selectedAssetIds={selectedAssetIds}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function TimeseriesTree({
  root,
  communityLabel,
  helpText,
  isCommunityActive,
  selectedId,
  selectedBuildingIds,
  selectedAssetIds,
  expanded,
  onSelectCommunity,
  onSelect,
  onToggle
}: {
  root: SimulationTreeNode;
  communityLabel: string;
  helpText: string;
  isCommunityActive: boolean;
  selectedId: string;
  selectedBuildingIds: Set<string>;
  selectedAssetIds: Set<string>;
  expanded: Set<string>;
  onSelectCommunity: () => void;
  onSelect: (id: string, additive: boolean) => void;
  onToggle: (id: string) => void;
}): JSX.Element {
  return (
    <aside className="sim-tree-panel panel">
      <header className="sim-tree-head">
        <div className="sim-tree-headline">
          <small>Community</small>
          <button
            type="button"
            className="sim-tree-help"
            aria-label="Community tree help"
          >
            <Info size={14} />
            <span role="tooltip" className="sim-tree-help-tooltip">
              {helpText}
            </span>
          </button>
        </div>
        <button
          type="button"
          className={`sim-tree-context-btn${isCommunityActive ? " is-active" : ""}`}
          onClick={onSelectCommunity}
          title="Show community charts"
        >
          <Home size={14} />
          <span className="sim-tree-context-label">{communityLabel}</span>
        </button>
      </header>
      <ul className="sim-tree-list">
        {listNodeChildren(root).map((child) => (
          <TimeseriesTreeNode
            key={child.id}
            node={child}
            communityLabel={communityLabel}
            depth={0}
            selectedId={selectedId}
            selectedBuildingIds={selectedBuildingIds}
            selectedAssetIds={selectedAssetIds}
            expanded={expanded}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </aside>
  );
}

function TimeInput24({
  value,
  onChange,
  ariaLabel
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}): JSX.Element {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit(nextRaw: string): void {
    const normalized = parseTimeInput(nextRaw) || parseTimeInput(value) || "00:00";
    setDraft(normalized);
    onChange(normalized);
  }

  return (
    <div className="timeseries-time-picker" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className="timeseries-time-step"
        onClick={() => {
          const next = offsetTimeValue(draft || value || "00:00", -15);
          setDraft(next);
          onChange(next);
        }}
        title="Minus 15 minutes"
      >
        -15m
      </button>
      <input
        type="text"
        inputMode="numeric"
        className="timeseries-time-text"
        value={draft}
        placeholder="HH:mm"
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(draft);
          }
        }}
      />
      <button
        type="button"
        className="timeseries-time-step"
        onClick={() => {
          const next = offsetTimeValue(draft || value || "00:00", 15);
          setDraft(next);
          onChange(next);
        }}
        title="Plus 15 minutes"
      >
        +15m
      </button>
    </div>
  );
}

function TimeseriesChart({
  title,
  series,
  chargerActivitySamples,
  visibleSeriesIds,
  onToggleSeries,
  rangeStart,
  rangeEnd,
  granularityMs,
  xTicks,
  xTickStepMs,
  onZoomCommit,
  onZoomReset,
  isPrimary,
  isWide
}: {
  title: string;
  series: SimulationSeries[];
  chargerActivitySamples?: ChargerStateSample[];
  visibleSeriesIds: string[];
  onToggleSeries: (seriesId: string) => void;
  rangeStart: number | null;
  rangeEnd: number | null;
  granularityMs: GranularityMs;
  xTicks: number[];
  xTickStepMs: number;
  onZoomCommit: (fromEpoch: number, toEpoch: number) => void;
  onZoomReset: () => void;
  isPrimary?: boolean;
  isWide?: boolean;
}): JSX.Element {
  const chartSeries = useMemo(() => sanitizeSeriesForChart(series), [series]);
  const isChargerChart = useMemo(
    () => chartSeries.some((entry) => isChargerFileRef(entry.fileRef)),
    [chartSeries]
  );
  const rows = useMemo<TimeseriesChartRow[]>(
    () =>
      buildChartRowsWithGranularity(
        chartSeries,
        visibleSeriesIds,
        rangeStart,
        rangeEnd,
        granularityMs
      ),
    [chartSeries, granularityMs, rangeEnd, rangeStart, visibleSeriesIds]
  );
  const lineSeriesIds = useMemo(
    () =>
      chartSeries
        .filter((entry) => visibleSeriesIds.includes(entry.id) && shouldRenderAsLine(entry))
        .map((entry) => entry.id),
    [chartSeries, visibleSeriesIds]
  );
  const chartRows = useMemo(
    () => breakLineGaps(rows, lineSeriesIds, granularityMs),
    [granularityMs, lineSeriesIds, rows]
  );
  const chargerOverlay = useMemo(() => {
    if (!isChargerChart || !chargerActivitySamples || chargerActivitySamples.length === 0) {
      return {
        buckets: [],
        events: [],
        intervals: []
      };
    }

    return deriveChargerActivityOverlay({
      samples: chargerActivitySamples,
      granularityMs,
      rangeStart,
      rangeEnd
    });
  }, [chargerActivitySamples, granularityMs, isChargerChart, rangeEnd, rangeStart]);
  const chargerEventsByEpoch = useMemo(() => {
    const grouped = new Map<number, ChargerTransitionEvent[]>();
    chargerOverlay.events.forEach((event) => {
      const existing = grouped.get(event.epochMs) || [];
      existing.push(event);
      grouped.set(event.epochMs, existing);
    });
    return grouped;
  }, [chargerOverlay.events]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [zoomDragEpoch, setZoomDragEpoch] = useState<{ start: number; end: number } | null>(null);
  const [zoomOverlayPx, setZoomOverlayPx] = useState<{
    start: number;
    end: number;
    plotLeft: number;
    plotRight: number;
  } | null>(null);

  const colorBySeriesId = useMemo(() => {
    return new Map(
      chartSeries.map((entry, index) => [entry.id, CHART_COLORS[index % CHART_COLORS.length]])
    );
  }, [chartSeries]);

  const visibleSeries = chartSeries.filter((entry) => visibleSeriesIds.includes(entry.id));
  type ChartTooltipPayloadRow = {
    dataKey?: unknown;
    color?: string;
    value?: unknown;
    name?: unknown;
  };
  const unitOrder = useMemo(() => {
    return Array.from(new Set(chartSeries.map((entry) => entry.unit || "value")));
  }, [chartSeries]);
  const primaryUnit = unitOrder[0] || "value";
  const secondaryUnit = unitOrder[1] || null;

  const axisIdForSeries = (entry: SimulationSeries): "left" | "right" => {
    const unit = entry.unit || "value";
    if (secondaryUnit && unit === secondaryUnit) return "right";
    return "left";
  };

  const shouldRenderAsBar = (entry: SimulationSeries): boolean => {
    if (shouldRenderAsLine(entry)) return false;
    if (isChargerChart) return isChargerNetSeries(entry) || isChargingActionSeries(entry);
    return true;
  };

  const computeDomain = (axisSeriesIds: string[]): [number, number] | null => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    chartRows.forEach((row) => {
      axisSeriesIds.forEach((seriesId) => {
        const value = row[seriesId];
        if (typeof value !== "number" || !Number.isFinite(value)) return;
        min = Math.min(min, value);
        max = Math.max(max, value);
      });
    });

    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    if (min > 0) min = 0;
    if (max < 0) max = 0;
    if (min === max) {
      const delta = Math.abs(min) * 0.05 || 1;
      return [min - delta, max + delta];
    }
    return [min, max];
  };

  const leftDomain = useMemo(
    () =>
      computeDomain(
        chartSeries.filter(
          (entry) => visibleSeriesIds.includes(entry.id) && axisIdForSeries(entry) === "left"
        ).map((entry) => entry.id)
      ),
    [chartRows, chartSeries, secondaryUnit, visibleSeriesIds]
  );
  const rightDomain = useMemo(
    () =>
      secondaryUnit
        ? computeDomain(
            chartSeries.filter(
              (entry) => visibleSeriesIds.includes(entry.id) && axisIdForSeries(entry) === "right"
            ).map((entry) => entry.id)
          )
        : null,
    [chartRows, chartSeries, secondaryUnit, visibleSeriesIds]
  );
  const leftAxisSeries = useMemo(
    () =>
      chartSeries.filter(
        (entry) => visibleSeriesIds.includes(entry.id) && axisIdForSeries(entry) === "left"
      ),
    [chartSeries, secondaryUnit, visibleSeriesIds]
  );
  const rightAxisSeries = useMemo(
    () =>
      chartSeries.filter(
        (entry) => visibleSeriesIds.includes(entry.id) && axisIdForSeries(entry) === "right"
      ),
    [chartSeries, secondaryUnit, visibleSeriesIds]
  );
  const leftSocAxis = leftAxisSeries.length > 0 && leftAxisSeries.every((entry) => isSocSeries(entry));
  const rightSocAxis = rightAxisSeries.length > 0 && rightAxisSeries.every((entry) => isSocSeries(entry));
  const socTicks = [0, 20, 40, 60, 80, 100];
  const leftTicks = useMemo(() => buildYAxisTicks(leftDomain), [leftDomain]);
  const rightTicks = useMemo(() => buildYAxisTicks(rightDomain), [rightDomain]);
  const xDomainPaddingMs = Math.max(5 * 60_000, Math.min(60 * 60_000, Math.round(xTickStepMs * 0.12)));
  const xDomain =
    rangeStart !== null && rangeEnd !== null
      ? [rangeStart - xDomainPaddingMs, rangeEnd + xDomainPaddingMs]
      : (["dataMin", "dataMax"] as const);
  const firstTickEpoch = xTicks.length > 0 ? xTicks[0] : undefined;
  const renderTooltipContent = (state: {
    active?: boolean;
    payload?: ChartTooltipPayloadRow[];
    label?: unknown;
  }): JSX.Element | null => {
    if (!state.active || !state.payload || state.payload.length === 0) return null;

    const labelEpoch =
      typeof state.label === "number" && Number.isFinite(state.label)
        ? state.label
        : Number(state.label);
    const labelText = Number.isFinite(labelEpoch)
      ? new Date(labelEpoch).toLocaleString([], {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        })
      : String(state.label ?? "");
    const eventsAtLabel = Number.isFinite(labelEpoch)
      ? chargerEventsByEpoch.get(labelEpoch as number) || []
      : [];

    return (
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 10,
          background: "var(--bg-elev)",
          fontSize: 12,
          padding: "8px 10px",
          minWidth: 170
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{labelText}</div>
        {eventsAtLabel.map((event, index) => (
          <div
            key={`${event.type}-${event.epochMs}-${index}`}
            style={{
              marginBottom: 6,
              fontWeight: 600,
              color: event.type === "connect" ? "#1db97f" : "#ea5a5a"
            }}
          >
            {event.type === "connect"
              ? `Connected: ${event.evName || "-"}`
              : `Disconnected: ${event.evName || "-"}`}
          </div>
        ))}
        {state.payload
          .filter((entry) => {
            const numeric =
              typeof entry.value === "number" ? entry.value : Number(entry.value);
            return Number.isFinite(numeric);
          })
          .map((entry, index) => {
            const key = typeof entry.dataKey === "string" ? entry.dataKey : String(entry.dataKey || "");
            const matched = visibleSeries.find((item) => item.id === key);
            const numeric =
              typeof entry.value === "number" ? entry.value : Number(entry.value);
            return (
              <div
                key={`${key}-${index}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 2
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: entry.color || "var(--text-soft)"
                    }}
                  />
                  <span>{matched?.metric || key}</span>
                </span>
                <strong>{formatNumber(Number.isFinite(numeric) ? numeric : null)}</strong>
              </div>
            );
          })}
      </div>
    );
  };
  const zoomOverlayStyle = useMemo(() => {
    if (!zoomOverlayPx) return null;
    const from = Math.min(zoomOverlayPx.start, zoomOverlayPx.end);
    const to = Math.max(zoomOverlayPx.start, zoomOverlayPx.end);
    const clampedFrom = Math.max(zoomOverlayPx.plotLeft, from);
    const clampedTo = Math.min(zoomOverlayPx.plotRight, to);
    const width = clampedTo - clampedFrom;
    if (width <= 0) return null;
    return {
      left: `${clampedFrom}px`,
      width: `${width}px`
    };
  }, [zoomOverlayPx]);

  const resolveChartX = (state: ChartMouseState | undefined): number | null => {
    if (!state) return null;
    if (typeof state.chartX === "number") return state.chartX;
    if (typeof state.activeCoordinate?.x === "number") return state.activeCoordinate.x;
    return null;
  };

  const resolvePlotBounds = (
    state: ChartMouseState | undefined
  ): { left: number; right: number } | null => {
    if (!state) return null;
    const firstAxis = state.xAxisMap ? Object.values(state.xAxisMap)[0] : null;
    if (firstAxis && Array.isArray(firstAxis.range)) {
      const [rawStart, rawEnd] = firstAxis.range;
      if (typeof rawStart === "number" && typeof rawEnd === "number" && rawStart !== rawEnd) {
        const left = Math.min(rawStart, rawEnd);
        const right = Math.max(rawStart, rawEnd);
        return { left, right };
      }
    }

    const left = typeof state.offset?.left === "number" ? state.offset.left : 0;
    const width =
      typeof state.offset?.width === "number" && state.offset.width > 0
        ? state.offset.width
        : canvasRef.current?.getBoundingClientRect().width || 0;
    if (width <= 0) return null;
    return { left, right: left + width };
  };

  const resolveZoomEpoch = (
    state: ChartMouseState | undefined,
    chartX: number | null
  ): number | null => {
    if (!state) return null;
    const firstAxis = state.xAxisMap ? Object.values(state.xAxisMap)[0] : null;
    if (firstAxis && typeof chartX === "number") {
      if (firstAxis.scale?.invert) {
        const inverted = firstAxis.scale.invert(chartX);
        if (Number.isFinite(inverted)) return inverted;
      }
      if (Array.isArray(firstAxis.range) && Array.isArray(firstAxis.domain)) {
        const [rangeStart, rangeEnd] = firstAxis.range;
        const [domainStart, domainEnd] = firstAxis.domain;
        if (
          typeof rangeStart === "number" &&
          typeof rangeEnd === "number" &&
          typeof domainStart === "number" &&
          typeof domainEnd === "number" &&
          rangeEnd !== rangeStart
        ) {
          const clampedX = Math.min(Math.max(chartX, Math.min(rangeStart, rangeEnd)), Math.max(rangeStart, rangeEnd));
          const ratio = (clampedX - rangeStart) / (rangeEnd - rangeStart);
          return domainStart + ratio * (domainEnd - domainStart);
        }
      }
    }

    return resolveActiveEpoch(state);
  };

  const clearLocalZoomDrag = (): void => {
    setZoomDragEpoch(null);
    setZoomOverlayPx(null);
  };

  const handleChartMouseDown = (state: ChartMouseState | undefined): void => {
    if (!state) return;
    const chartX = resolveChartX(state);
    const plotBounds = resolvePlotBounds(state);
    if (chartX === null || !plotBounds) return;
    const epoch = resolveZoomEpoch(state, chartX);
    if (epoch === null) return;
    const clampedX = Math.min(Math.max(chartX, plotBounds.left), plotBounds.right);

    setZoomDragEpoch({ start: epoch, end: epoch });
    setZoomOverlayPx({
      start: clampedX,
      end: clampedX,
      plotLeft: plotBounds.left,
      plotRight: plotBounds.right
    });
  };

  const handleChartMouseMove = (state: ChartMouseState | undefined): void => {
    if (!zoomDragEpoch || !zoomOverlayPx || !state) return;

    const chartX = resolveChartX(state);
    if (chartX === null) return;

    const epoch = resolveZoomEpoch(state, chartX);
    if (epoch !== null) {
      setZoomDragEpoch((previous) => (previous ? { ...previous, end: epoch } : previous));
    }

    setZoomOverlayPx((previous) => {
      if (!previous) return previous;
      const clampedX = Math.min(Math.max(chartX, previous.plotLeft), previous.plotRight);
      return { ...previous, end: clampedX };
    });
  };

  const handleChartMouseUp = (state: ChartMouseState | undefined): void => {
    if (!zoomDragEpoch) {
      clearLocalZoomDrag();
      return;
    }

    const chartX = resolveChartX(state);
    const epoch = resolveZoomEpoch(state, chartX);
    const start = zoomDragEpoch.start;
    const end = epoch ?? zoomDragEpoch.end;
    const dragWidthPx = zoomOverlayPx ? Math.abs(zoomOverlayPx.end - zoomOverlayPx.start) : 0;

    clearLocalZoomDrag();
    if (dragWidthPx < 6) return;

    const from = Math.min(start, end);
    const to = Math.max(start, end);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < 1000) return;
    onZoomCommit(from, to);
  };

  return (
    <article className={`sim-chart panel${isPrimary ? " is-primary" : ""}${isWide ? " is-wide" : ""}`}>
      <header>
        <h4>{title}</h4>
      </header>

      <div className="sim-chart-legend">
        {chartSeries.map((entry, index) => {
          const active = visibleSeriesIds.includes(entry.id);
          return (
            <button
              key={entry.id}
              type="button"
              className={`sim-legend-item${active ? " is-active" : ""}`}
              onClick={() => onToggleSeries(entry.id)}
            >
              <span
                className="metric-color"
                style={{ background: colorBySeriesId.get(entry.id) || CHART_COLORS[index % CHART_COLORS.length] }}
              />
              <span>{entry.metric}</span>
            </button>
          );
        })}
      </div>

      {chartRows.length === 0 || visibleSeries.length === 0 ? (
        <EmptyState title="No chart data" message="Adjust time window or selected metrics." />
      ) : (
        <div className="sim-chart-canvas" ref={canvasRef}>
          {zoomOverlayStyle ? <div className="sim-zoom-overlay" style={zoomOverlayStyle} /> : null}
          <ResponsiveContainer width="100%" height={TIMESERIES_CHART_HEIGHT}>
            <ComposedChart
              data={chartRows}
              margin={{ top: 16, right: 12, left: 8, bottom: 10 }}
              barCategoryGap="24%"
              barGap={2}
              onMouseDown={(state) => handleChartMouseDown(state as ChartMouseState)}
              onMouseMove={(state) => handleChartMouseMove(state as ChartMouseState)}
              onMouseUp={(state) => handleChartMouseUp(state as ChartMouseState)}
              onMouseLeave={() => handleChartMouseUp(undefined)}
              onDoubleClick={() => {
                clearLocalZoomDrag();
                onZoomReset();
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis
                type="number"
                dataKey="epochMs"
                scale="time"
                domain={xDomain}
                allowDataOverflow
                padding={{ left: 6, right: 6 }}
                ticks={xTicks}
                interval={0}
                tickFormatter={(value) => formatAxisTick(Number(value), xTickStepMs, firstTickEpoch)}
                minTickGap={26}
                tick={{ fontSize: 11 }}
                tickMargin={8}
                stroke="var(--text-soft)"
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11 }}
                tickFormatter={formatYAxisTick}
                stroke="var(--text-soft)"
                width={54}
                tickMargin={6}
                unit={primaryUnit !== "value" ? primaryUnit : ""}
                domain={leftSocAxis ? [0, 100] : leftDomain || ["auto", "auto"]}
                ticks={leftSocAxis ? socTicks : leftTicks}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={secondaryUnit ? { fontSize: 11 } : false}
                tickLine={Boolean(secondaryUnit)}
                axisLine={Boolean(secondaryUnit)}
                tickFormatter={formatYAxisTick}
                stroke="var(--text-soft)"
                width={56}
                tickMargin={6}
                unit={secondaryUnit && secondaryUnit !== "value" ? secondaryUnit : ""}
                domain={
                  secondaryUnit
                    ? rightSocAxis
                      ? [0, 100]
                      : rightDomain || ["auto", "auto"]
                    : [0, 1]
                }
                ticks={secondaryUnit ? (rightSocAxis ? socTicks : rightTicks) : []}
              />
              {chargerOverlay.intervals.map((interval, index) => (
                <ReferenceArea
                  key={`charger-interval-${index}-${interval.startEpochMs}-${interval.endEpochMs}`}
                  xAxisId={0}
                  yAxisId="left"
                  x1={interval.startEpochMs}
                  x2={interval.endEpochMs}
                  ifOverflow="extendDomain"
                  fill="#1db97f"
                  fillOpacity={0.14}
                  strokeOpacity={0}
                />
              ))}
              <Tooltip
                content={(state) =>
                  renderTooltipContent(
                    state as unknown as { active?: boolean; payload?: ChartTooltipPayloadRow[]; label?: unknown }
                  )
                }
              />
              {visibleSeries.map((entry, index) => (
                !shouldRenderAsBar(entry) ? (
                  <Line
                    key={entry.id}
                    type="monotone"
                    dataKey={entry.id}
                    yAxisId={axisIdForSeries(entry)}
                    stroke={colorBySeriesId.get(entry.id) || CHART_COLORS[index % CHART_COLORS.length]}
                    strokeWidth={2.2}
                    connectNulls={false}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                ) : (
                  <Bar
                    key={entry.id}
                    dataKey={entry.id}
                    yAxisId={axisIdForSeries(entry)}
                    barSize={8}
                    stroke={colorBySeriesId.get(entry.id) || CHART_COLORS[index % CHART_COLORS.length]}
                    strokeWidth={0.5}
                    fill={colorBySeriesId.get(entry.id) || CHART_COLORS[index % CHART_COLORS.length]}
                    fillOpacity={0.75}
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                )
              ))}
              {chargerOverlay.events.map((event, index) => (
                <ReferenceLine
                  key={`charger-event-${index}-${event.type}-${event.epochMs}`}
                  xAxisId={0}
                  yAxisId="left"
                  x={event.epochMs}
                  ifOverflow="extendDomain"
                  stroke={event.type === "connect" ? "#1db97f" : "#ea5a5a"}
                  strokeDasharray="5 4"
                  strokeWidth={2.1}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </article>
  );
}

export function JobDetailPage(): JSX.Element {
  const navigate = useNavigate();
  const { jobId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get("tab");
  const activeTab: DetailTab = isValidTab(tabParam) ? tabParam : "overview";
  const fromParam = searchParams.get("from");
  const backTarget = resolveBackTarget(fromParam);

  const [selectedNodeId, setSelectedNodeId] = useState("__community__");
  const [selectedBuildingNodeIds, setSelectedBuildingNodeIds] = useState<string[]>([]);
  const [selectedAssetNodeIds, setSelectedAssetNodeIds] = useState<string[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedEpisode, setSelectedEpisode] = useState<string | null>(null);
  const [timePreset, setTimePreset] = useState<TimePreset>("7d");
  const [selectedGranularityMs, setSelectedGranularityMs] = useState<GranularityMs>(1 * HOUR_MS);
  const [windowStartMs, setWindowStartMs] = useState<number | null>(null);
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [customRangeSource, setCustomRangeSource] = useState<CustomRangeSource>(null);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangePopoverOpen, setRangePopoverOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [activeDateField, setActiveDateField] = useState<"from" | "to" | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date | undefined>(undefined);
  const [visibleSeries, setVisibleSeries] = useState<Record<string, string[]>>({});
  const [zoomHistory, setZoomHistory] = useState<ZoomHistoryEntry[]>([]);
  const [kpiSearch, setKpiSearch] = useState("");
  const [selectedKpiScopeId, setSelectedKpiScopeId] = useState("community");
  const [kpiFamilyFilter, setKpiFamilyFilter] = useState<KpiFamily | "all">("all");
  const [showKpiNa, setShowKpiNa] = useState(false);
  const [selectedDeployScopeId, setSelectedDeployScopeId] = useState("community");
  const [deployManifestPreviewOpen, setDeployManifestPreviewOpen] = useState(false);
  const [deployActionError, setDeployActionError] = useState<string | null>(null);
  const [deployDownloadBusyKey, setDeployDownloadBusyKey] = useState<string | null>(null);
  const [overviewLogsOpen, setOverviewLogsOpen] = useState(false);
  const [configPreviewOpen, setConfigPreviewOpen] = useState(false);
  const [configPreviewTarget, setConfigPreviewTarget] = useState("");
  const [configPreviewLabel, setConfigPreviewLabel] = useState("");
  const [configPreviewMode, setConfigPreviewMode] = useState<"base" | "resolved">("base");
  const [configPreviewJobId, setConfigPreviewJobId] = useState("");

  const statusQuery = useQuery({
    queryKey: ["job-status", jobId],
    queryFn: () => getJobStatus(jobId),
    enabled: Boolean(jobId)
  });

  const infoQuery = useQuery({
    queryKey: ["job-info", jobId],
    queryFn: () => getJobInfo(jobId),
    enabled: Boolean(jobId)
  });

  const progressQuery = useQuery({
    queryKey: ["job-progress", jobId],
    queryFn: () => getJobProgress(jobId),
    enabled: Boolean(jobId)
  });

  const resultQuery = useQuery({
    queryKey: ["job-result", jobId],
    queryFn: () => getJobResult(jobId),
    enabled: Boolean(jobId)
  });

  const configsQuery = useQuery({
    queryKey: ["configs"],
    queryFn: listExperimentConfigs
  });

  const overviewLogs = useJobLogsPolling(jobId, {
    enabled: Boolean(overviewLogsOpen && jobId),
    pollMs: LOGS_POLL_MS,
    tailLines: 300
  });

  const configPreviewQuery = useQuery({
    queryKey: ["job-config-preview", configPreviewMode, configPreviewTarget, configPreviewJobId],
    queryFn: async () => {
      if (configPreviewMode === "resolved") {
        const payload = await getJobResolvedConfig(configPreviewJobId);
        return payload.yaml_content;
      }

      const payload = await getExperimentConfig(configPreviewTarget);
      return payload.yaml_content;
    },
    enabled: Boolean(
      configPreviewOpen &&
        ((configPreviewMode === "base" && configPreviewTarget) ||
          (configPreviewMode === "resolved" && configPreviewJobId))
    )
  });

  const isLoading =
    statusQuery.isLoading || infoQuery.isLoading || progressQuery.isLoading || resultQuery.isLoading;

  useEffect(() => {
    if (activeTab === "overview") return;
    setOverviewLogsOpen(false);
    setConfigPreviewOpen(false);
    setConfigPreviewTarget("");
    setConfigPreviewLabel("");
    setConfigPreviewMode("base");
    setConfigPreviewJobId("");
    if (activeTab !== "deploy") {
      setDeployManifestPreviewOpen(false);
      setDeployActionError(null);
      setDeployDownloadBusyKey(null);
    }
  }, [activeTab]);

  const status = statusQuery.data?.status || "unknown";
  const isCompleted = isCompletedForResults(status);
  const simulationDataDir = useMemo(() => findSimulationDataDir(resultQuery.data), [resultQuery.data]);
  const simulationDataSessionDefault = useMemo(
    () => findSimulationDataSessionDefault(resultQuery.data),
    [resultQuery.data]
  );

  const simulationIndexQuery = useQuery({
    queryKey: ["simulation-data-index", jobId, simulationDataDir, simulationDataSessionDefault],
    queryFn: () =>
      getSimulationDataIndex({
        jobId,
        simulationDataDir,
        simulationDataSessionDefault
      }),
    enabled: Boolean(jobId && isCompleted)
  });

  const simulationTree = useMemo(() => {
    if (!simulationIndexQuery.data?.files || simulationIndexQuery.data.files.length === 0) return null;
    return buildSimulationTree(simulationIndexQuery.data.files);
  }, [simulationIndexQuery.data?.files]);

  const treeNodes = useMemo(
    () => (simulationTree ? flattenTreeNodes(simulationTree) : []),
    [simulationTree]
  );
  const treeNodeMap = useMemo(() => new Map(treeNodes.map((node) => [node.id, node])), [treeNodes]);
  const treeOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    treeNodes.forEach((node, index) => {
      map.set(node.id, index);
    });
    return map;
  }, [treeNodes]);
  const parentNodeMap = useMemo(() => {
    const map = new Map<string, string>();
    function walk(node: SimulationTreeNode): void {
      node.children.forEach((child) => {
        map.set(child.id, node.id);
        walk(child);
      });
    }
    if (simulationTree) walk(simulationTree);
    return map;
  }, [simulationTree]);

  const episodes = useMemo(
    () => listEpisodes(simulationIndexQuery.data?.files || []),
    [simulationIndexQuery.data?.files]
  );

  useEffect(() => {
    if (!simulationTree) return;
    if (selectedNodeId !== "__community__" && !treeNodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId("__community__");
      setSelectedBuildingNodeIds([]);
      setSelectedAssetNodeIds([]);
    }

    setExpandedNodes((previous) => {
      if (previous.size > 0) return previous;
      return new Set<string>();
    });
  }, [selectedNodeId, simulationTree, treeNodes]);

  useEffect(() => {
    setSelectedAssetNodeIds((previous) => previous.filter((nodeId) => treeNodeMap.has(nodeId)));
    setSelectedBuildingNodeIds((previous) => previous.filter((nodeId) => treeNodeMap.has(nodeId)));
  }, [treeNodeMap]);

  useEffect(() => {
    if (episodes.length === 0) {
      setSelectedEpisode(null);
      return;
    }
    if (!selectedEpisode || !episodes.includes(selectedEpisode)) {
      setSelectedEpisode(latestEpisode(simulationIndexQuery.data?.files || []));
    }
  }, [episodes, selectedEpisode, simulationIndexQuery.data?.files]);

  const selectedNode = useMemo(() => {
    if (selectedNodeId === "__community__") return null;
    return treeNodeMap.get(selectedNodeId) || null;
  }, [selectedNodeId, treeNodeMap]);

  const communityFileRefs = useMemo(() => {
    const files = simulationIndexQuery.data?.files || [];
    return files.filter((file) => file.kind === "community").map((file) => file.relativePath);
  }, [simulationIndexQuery.data?.files]);
  const pricingFileRefs = useMemo(() => {
    const files = simulationIndexQuery.data?.files || [];
    return files.filter((file) => file.kind === "pricing").map((file) => file.relativePath);
  }, [simulationIndexQuery.data?.files]);

  const selectedFileRefs = useMemo(() => {
    if (!simulationIndexQuery.data?.files) return [];
    const files = simulationIndexQuery.data.files;

    const baseRefs =
      selectedNodeId === "__community__"
        ? [communityFileRefs[0], pricingFileRefs[0]].filter((item): item is string => Boolean(item))
        : selectedBuildingNodeIds.length > 0
          ? selectedBuildingNodeIds.flatMap((nodeId) => treeNodeMap.get(nodeId)?.fileRefs || [])
          : selectedNode
            ? selectedNode.fileRefs
            : [];

    const overlayRefs = selectedAssetNodeIds.flatMap((nodeId) => {
      const node = treeNodeMap.get(nodeId);
      return node ? node.fileRefs : [];
    });

    const refsByEpisode = filterFileRefsByEpisode(
      Array.from(new Set([...baseRefs, ...overlayRefs])),
      files,
      selectedEpisode
    );
    return refsByEpisode;
  }, [
    communityFileRefs,
    pricingFileRefs,
    selectedBuildingNodeIds,
    selectedAssetNodeIds,
    selectedEpisode,
    selectedNode,
    selectedNodeId,
    simulationIndexQuery.data?.files,
    treeNodeMap
  ]);

  const timeseriesQuery = useQuery({
    queryKey: [
      "simulation-timeseries",
      jobId,
      selectedNodeId,
      selectedBuildingNodeIds.join("|"),
      selectedEpisode || "all",
      selectedFileRefs.join("|")
    ],
    queryFn: async (): Promise<TimeseriesBundle[]> => {
      const source = simulationIndexQuery.data as SimulationDataSource;
      const bundles = await Promise.all(
        selectedFileRefs.map(async (fileRef) => {
          const content = await readSimulationDataFile(source, fileRef);
          const parsed = loadSimulationCsv(content, fileRef).sort(
            (a, b) => rankMetric(a.metric) - rankMetric(b.metric)
          );
          const stateSeries = parsed.find((entry) => isChargerStateSeries(entry));
          const chargerSamples = isChargerFileRef(fileRef)
            ? (() => {
                const extracted = extractChargerStateSamples(content);
                if (extracted.length > 0) return extracted;
                return buildChargerSamplesFromStateSeries(stateSeries);
              })()
            : [];
          const withoutChargerState = parsed.filter((entry) => !isChargerStateSeries(entry));
          const withChargerNet = mergeChargerNetSeries(fileRef, withoutChargerState);
          const mergedSeries = isChargerFileRef(fileRef)
            ? keepPreferredEvSocSeries(withChargerNet)
            : withChargerNet;
          const evSeriesFiltered = isElectricVehicleFileRef(fileRef)
            ? mergedSeries.filter((entry) => !isBatteryCapacitySeries(entry))
            : mergedSeries;
          const isCommunityCsv = isCommunityFileRef(fileRef);
          let series: SimulationSeries[] = isCommunityCsv
            ? evSeriesFiltered.slice(0, 8)
            : evSeriesFiltered.slice(0, 6);
          if (isChargerFileRef(fileRef)) {
            const preferred = [
              evSeriesFiltered.find((entry) => entry.metric.toLowerCase().includes("charger_net")),
              evSeriesFiltered.find((entry) => isEvSocSeries(entry)),
              evSeriesFiltered.find((entry) => isRequiredSocSeries(entry)),
              evSeriesFiltered.find((entry) => isEstimatedSocSeries(entry))
            ].filter((entry): entry is SimulationSeries => Boolean(entry));
            const preferredIds = new Set(preferred.map((entry) => entry.id));
            const remaining = evSeriesFiltered.filter((entry) => !preferredIds.has(entry.id));
            series = [...preferred, ...remaining].slice(0, 6);
          }
          return {
            fileRef,
            title: resolveFileTitle(fileRef),
            series,
            chargerActivity: chargerSamples.length > 0 ? { samples: chargerSamples } : undefined
          };
        })
      );

      return bundles.filter((bundle) => bundle.series.length > 0);
    },
    enabled:
      Boolean(activeTab === "timeseries" && isCompleted && simulationIndexQuery.data) &&
      selectedFileRefs.length > 0
  });

  const kpiFilePath = useMemo(() => {
    const files = simulationIndexQuery.data?.files || [];
    const direct = files.find((file) => file.kind === "kpi");
    return direct?.relativePath || null;
  }, [simulationIndexQuery.data?.files]);

  const kpiCsvQuery = useQuery({
    queryKey: ["simulation-kpis", jobId, kpiFilePath || ""],
    queryFn: async (): Promise<{ rows: KpiMatrixRow[]; entries: KpiEntry[] }> => {
      const source = simulationIndexQuery.data as SimulationDataSource;
      if (!kpiFilePath) return { rows: [], entries: [] };
      const content = await readSimulationDataFile(source, kpiFilePath);
      const parsed = extractKpisFromSimulationData(content);
      return {
        rows: parsed.rows,
        entries: parsed.entries
      };
    },
    enabled: Boolean(activeTab === "kpis" && isCompleted && simulationIndexQuery.data && kpiFilePath)
  });

  const kpiRows = useMemo(() => kpiCsvQuery.data?.rows || [], [kpiCsvQuery.data?.rows]);

  const fallbackKpis = useMemo(() => extractKpis(resultQuery.data), [resultQuery.data]);
  const displayKpis = useMemo(() => {
    if (kpiCsvQuery.data?.entries && kpiCsvQuery.data.entries.length > 0) {
      return kpiCsvQuery.data.entries;
    }
    return fallbackKpis;
  }, [fallbackKpis, kpiCsvQuery.data?.entries]);

  const deployManifestQuery = useQuery({
    queryKey: [
      "deploy-bundle-manifest",
      jobId,
      simulationIndexQuery.data?.provider || "none",
      simulationIndexQuery.data?.session || "none"
    ],
    queryFn: async (): Promise<DeployManifestData | null> => {
      const localManifest = await readExampleBundleManifest(jobId);
      if (localManifest) {
        return {
          content: localManifest.content,
          relativePath: localManifest.relativePath,
          source: "mock",
          backendBasePrefix: "",
          manifest: parseJsonRecord(localManifest.content)
        };
      }

      const source = simulationIndexQuery.data as SimulationDataSource | undefined;
      if (!source || source.provider !== "backend") return null;

      const backendManifest = await readBackendBundleManifest(source.jobId, source.session);
      if (!backendManifest) return null;

      return {
        content: backendManifest.content,
        relativePath: backendManifest.relativePath,
        source: "backend",
        backendBasePrefix: backendManifest.basePrefix,
        manifest: parseJsonRecord(backendManifest.content)
      };
    },
    enabled: Boolean(activeTab === "deploy" && isCompleted && jobId)
  });

  const kpiCommunityLabel =
    typeof infoQuery.data?.community_name === "string" && infoQuery.data.community_name.trim() !== ""
      ? infoQuery.data.community_name.trim()
      : typeof infoQuery.data?.energy_community === "string" && infoQuery.data.energy_community.trim() !== ""
        ? infoQuery.data.energy_community.trim()
        : "Solar Community";

  const deployBuildingScopes = useMemo(() => {
    return treeNodes
      .filter((node) => node.kind === "building")
      .map((node, order) => {
        const buildingId = parseBuildingNodeNumber(node);
        return {
          id: node.id,
          label: node.label,
          buildingId,
          order
        };
      })
      .sort((left, right) => left.order - right.order);
  }, [treeNodes]);

  const deployTreeRoot = useMemo<SimulationTreeNode>(
    () => ({
      id: "deploy-root",
      label: "Deploy",
      kind: "root",
      selectable: false,
      fileRefs: [],
      children: deployBuildingScopes.map((scope) => ({
        id: scope.id,
        label: scope.label,
        kind: "building",
        selectable: true,
        fileRefs: [],
        children: []
      }))
    }),
    [deployBuildingScopes]
  );

  useEffect(() => {
    if (selectedDeployScopeId === "community") return;
    if (!deployBuildingScopes.some((scope) => scope.id === selectedDeployScopeId)) {
      setSelectedDeployScopeId("community");
    }
  }, [deployBuildingScopes, selectedDeployScopeId]);

  const selectedDeployBuildingScope = useMemo(
    () => deployBuildingScopes.find((scope) => scope.id === selectedDeployScopeId) || null,
    [deployBuildingScopes, selectedDeployScopeId]
  );

  const deployAgentArtifacts = useMemo<DeployArtifactRow[]>(() => {
    const manifest = deployManifestQuery.data?.manifest;
    const agentRecord = asRecord(manifest?.agent);
    const artifacts = Array.isArray(agentRecord?.artifacts) ? agentRecord.artifacts : [];
    return artifacts
      .map((item) => {
        const record = asRecord(item);
        if (!record) return null;
        const path = readStringValue(record.path);
        if (!path) return null;
        const normalizedPath = path.replace(/^\.?\//, "");
        const format = readStringValue(record.format);
        const isOnnx = normalizedPath.toLowerCase().endsWith(".onnx") || (format || "").toLowerCase() === "onnx";
        if (!isOnnx) return null;

        const agentIndex = readAgentIndex(record.agent_index);
        const config = asRecord(record.config);
        const buildingFromConfig = inferBuildingFromAgentConfig(config);
        const buildingId = buildingFromConfig ?? (agentIndex !== null ? agentIndex + 1 : null);

        return {
          agentIndex,
          buildingId,
          format,
          path: normalizedPath,
          onnxUrl: resolveExampleOnnxAssetUrl(jobId, normalizedPath)
        };
      })
      .filter((artifact): artifact is DeployArtifactRow => Boolean(artifact));
  }, [deployManifestQuery.data?.manifest, jobId]);

  const deployOnnxByBuilding = useMemo(() => {
    const map = new Map<number, DeployArtifactRow>();
    deployAgentArtifacts.forEach((artifact) => {
      if (artifact.buildingId === null) return;
      if (map.has(artifact.buildingId)) return;
      map.set(artifact.buildingId, artifact);
    });
    return map;
  }, [deployAgentArtifacts]);

  const selectedDeployOnnx = useMemo(() => {
    if (!selectedDeployBuildingScope || selectedDeployBuildingScope.buildingId === null) return null;
    return deployOnnxByBuilding.get(selectedDeployBuildingScope.buildingId) || null;
  }, [deployOnnxByBuilding, selectedDeployBuildingScope]);

  const deployManifestSummary = useMemo(() => {
    const manifest = deployManifestQuery.data?.manifest;
    const metadata = asRecord(manifest?.metadata);
    const algorithm = asRecord(manifest?.algorithm);
    const agent = asRecord(manifest?.agent);
    const generatedAt = readStringValue(manifest?.generated_at) || "-";
    const algorithmName = readStringValue(algorithm?.name) || "-";
    const agentFormat = readStringValue(agent?.format) || "-";
    const runName = readStringValue(metadata?.run_name) || "-";
    return {
      generatedAt,
      algorithmName,
      agentFormat,
      runName,
      modelCount: deployAgentArtifacts.length
    };
  }, [deployAgentArtifacts.length, deployManifestQuery.data?.manifest]);

  const kpiScopes = useMemo<KpiEntityScope[]>(() => {
    if (kpiRows.length === 0) return [];

    const entities = new Set<string>();
    kpiRows.forEach((row) => {
      Object.keys(row.values).forEach((entity) => {
        if (entity.trim()) entities.add(entity);
      });
    });

    if (entities.size === 0) return [];

    const buildingMetaByKey = new Map<string, { id: string; label: string; order: number }>();
    treeNodes.forEach((node, index) => {
      if (node.kind !== "building") return;
      const key = parseTreeNodeBuildingKey(node);
      if (!key || buildingMetaByKey.has(key)) return;
      buildingMetaByKey.set(key, {
        id: node.id,
        label: node.label,
        order: index
      });
    });

    const preferredBuildingLabels = new Map<string, string>();
    kpiRows.forEach((row) => {
      Object.keys(row.values).forEach((entity) => {
        const key = parseKpiEntityBuildingKey(entity);
        if (!key || preferredBuildingLabels.has(key)) return;
        preferredBuildingLabels.set(key, formatKpiBuildingScopeLabel(key));
      });
    });

    const communityEntities: string[] = [];
    const buildingScopes = new Map<
      string,
      {
        id: string;
        label: string;
        order: number;
        entityKeys: string[];
      }
    >();
    const otherEntities: string[] = [];

    Array.from(entities)
      .sort((a, b) => a.localeCompare(b))
      .forEach((entity) => {
        if (isCommunityEntity(entity)) {
          communityEntities.push(entity);
          return;
        }
        const buildingKey = parseKpiEntityBuildingKey(entity);
        if (buildingKey !== null) {
          const fromTree = buildingMetaByKey.get(buildingKey);
          const scopeId = fromTree?.id || `building:${buildingKey}`;
          const existing = buildingScopes.get(scopeId);
          if (existing) {
            existing.entityKeys.push(entity);
            buildingScopes.set(scopeId, existing);
            return;
          }

          buildingScopes.set(scopeId, {
            id: scopeId,
            label: fromTree?.label || preferredBuildingLabels.get(buildingKey) || formatKpiBuildingScopeLabel(buildingKey),
            order: fromTree?.order ?? Number.MAX_SAFE_INTEGER,
            entityKeys: [entity]
          });
          return;
        }
        otherEntities.push(entity);
      });

    const scopes: KpiEntityScope[] = [];
    if (communityEntities.length > 0) {
      scopes.push({
        id: "community",
        label: kpiCommunityLabel,
        group: "community",
        entityKeys: communityEntities
      });
    }

    Array.from(buildingScopes.values())
      .sort((left, right) => {
        const leftOrder = left.order;
        const rightOrder = right.order;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return left.label.localeCompare(right.label);
      })
      .forEach((scope) => {
        scopes.push({
          id: scope.id,
          label: scope.label,
          group: "building",
          entityKeys: scope.entityKeys
        });
      });

    if (otherEntities.length > 0) {
      scopes.push({
        id: "other",
        label: "Other entities",
        group: "other",
        entityKeys: otherEntities
      });
    }

    return scopes;
  }, [kpiCommunityLabel, kpiRows, treeNodes]);

  useEffect(() => {
    if (kpiScopes.length === 0) return;
    if (!kpiScopes.some((scope) => scope.id === selectedKpiScopeId)) {
      setSelectedKpiScopeId(kpiScopes[0]!.id);
    }
  }, [kpiScopes, selectedKpiScopeId]);

  const selectedKpiScope = useMemo(
    () => kpiScopes.find((scope) => scope.id === selectedKpiScopeId) || null,
    [kpiScopes, selectedKpiScopeId]
  );
  const kpiTreeRoot = useMemo<SimulationTreeNode>(() => {
    return {
      id: "kpi-root",
      label: "KPI root",
      kind: "root",
      selectable: false,
      fileRefs: [],
      children: kpiScopes
        .filter((scope) => scope.id !== "community")
        .map((scope) => ({
          id: scope.id,
          label: scope.label,
          kind: scope.group === "building" ? "building" : "group",
          selectable: true,
          fileRefs: [],
          children: []
        }))
    };
  }, [kpiScopes]);

  const scopedKpiRows = useMemo<ScopedKpiRow[]>(() => {
    if (kpiRows.length === 0 || !selectedKpiScope) return [];

    const collected = kpiRows.reduce<ScopedKpiRow[]>((acc, row) => {
      const breakdown = selectedKpiScope.entityKeys
        .map((entity) => ({ entity, value: row.values[entity] }))
        .filter((entry): entry is { entity: string; value: number } => typeof entry.value === "number");

      const representative =
        breakdown.length === 0
          ? null
          : breakdown.length === 1
            ? breakdown[0]!.value
            : breakdown.reduce((sum, entry) => sum + entry.value, 0) / breakdown.length;

      acc.push({
        key: row.key,
        label: row.label,
        unit: row.unit,
        value: representative,
        breakdown
      });
      return acc;
    }, []);

    return collected.sort((a, b) => a.label.localeCompare(b.label));
  }, [kpiRows, selectedKpiScope]);

  const groupedKpiRows = useMemo(() => groupScopedKpis(scopedKpiRows), [scopedKpiRows]);
  const selectedKpiLevel = useMemo<KpiLevel | null>(() => {
    if (!selectedKpiScope) return null;
    if (selectedKpiScope.group === "community") return "district";
    if (selectedKpiScope.group === "building") return "building";
    return null;
  }, [selectedKpiScope]);

  const kpiFamilyOptions = useMemo(
    () => sortKpiFamilies(Array.from(new Set(groupedKpiRows.map((row) => row.family)))),
    [groupedKpiRows]
  );

  useEffect(() => {
    if (kpiFamilyFilter !== "all" && !kpiFamilyOptions.includes(kpiFamilyFilter)) {
      setKpiFamilyFilter("all");
    }
  }, [kpiFamilyFilter, kpiFamilyOptions]);

  const filteredKpiGroupRows = useMemo(() => {
    const query = kpiSearch.trim().toLowerCase();
    return groupedKpiRows.filter((row) => {
      if (selectedKpiLevel && row.level !== selectedKpiLevel) return false;
      if (kpiFamilyFilter !== "all" && row.family !== kpiFamilyFilter) return false;
      if (!query) return true;
      return `${row.label} ${row.comparisonKey} ${row.sourceKeys.join(" ")} ${row.subfamilyLabel}`
        .toLowerCase()
        .includes(query);
    });
  }, [groupedKpiRows, kpiSearch, kpiFamilyFilter, selectedKpiLevel]);

  const visibleKpiGroupRows = useMemo(() => {
    if (showKpiNa) return filteredKpiGroupRows;
    return filteredKpiGroupRows.filter((row) => isKpiGroupUsed(row));
  }, [filteredKpiGroupRows, showKpiNa]);

  const kpiSemanticSections = useMemo(
    () => groupRowsByFamilySubfamily(visibleKpiGroupRows),
    [visibleKpiGroupRows]
  );

  const kpiHighlightRows = useMemo(
    () => resolveScopeHighlights(filteredKpiGroupRows, selectedKpiLevel),
    [filteredKpiGroupRows, selectedKpiLevel]
  );

  const filteredKpis = useMemo(() => {
    const query = kpiSearch.trim().toLowerCase();
    if (!query) return displayKpis;
    return displayKpis.filter((kpi) => {
      const source = kpi.source || "";
      return `${kpi.label} ${source}`.toLowerCase().includes(query);
    });
  }, [displayKpis, kpiSearch]);

  const timeseriesBundles = useMemo(() => timeseriesQuery.data || [], [timeseriesQuery.data]);
  const sourceResolutionMs = useMemo(
    () => inferSeriesResolutionMs(timeseriesBundles.flatMap((bundle) => bundle.series)),
    [timeseriesBundles]
  );

  useEffect(() => {
    if (timeseriesBundles.length === 0) {
      setVisibleSeries({});
      return;
    }

    setVisibleSeries((previous) => {
      const next = { ...previous };
      timeseriesBundles.forEach((bundle) => {
        const currentSelection = next[bundle.fileRef] || [];
        const isCommunityBundle = isCommunityFileRef(bundle.fileRef);
        const isLegacyCommunityPriceOnly =
          isCommunityBundle &&
          currentSelection.length > 0 &&
          currentSelection.every((id) => {
            const selected = bundle.series.find((entry) => entry.id === id);
            return Boolean(selected && isPriceSeries(selected));
          });

        if (currentSelection.length === 0 || isLegacyCommunityPriceOnly) {
          if (isCommunityBundle) {
            const firstChoices = [
              bundle.series.find((entry) => isNetElectricityConsumptionSeries(entry)),
              bundle.series.find((entry) => isSelfConsumptionSeries(entry)),
              bundle.series.find((entry) => isNonShiftableSeries(entry)),
              bundle.series.find((entry) => isConsumptionSeries(entry))
            ].filter((entry): entry is SimulationSeries => Boolean(entry));

            const uniquePreferred = Array.from(new Set(firstChoices.map((entry) => entry.id)));
            if (uniquePreferred.length > 0) {
              next[bundle.fileRef] = uniquePreferred.slice(0, 2);
            } else {
              const fallback = bundle.series
                .filter((entry) => !isPriceSeries(entry))
                .slice(0, 2)
                .map((entry) => entry.id);
              next[bundle.fileRef] =
                fallback.length > 0 ? fallback : bundle.series.slice(0, 2).map((entry) => entry.id);
            }
          } else {
            if (isChargerFileRef(bundle.fileRef)) {
              const preferred = [
                bundle.series.find((entry) => entry.metric.toLowerCase().includes("charger_net")),
                bundle.series.find((entry) => isEvSocSeries(entry)),
                bundle.series.find((entry) => isRequiredSocSeries(entry)),
                bundle.series.find((entry) => isEstimatedSocSeries(entry))
              ].filter((entry): entry is SimulationSeries => Boolean(entry));
              const preferredIds = Array.from(new Set(preferred.map((entry) => entry.id)));
              if (preferredIds.length > 0) {
                next[bundle.fileRef] = preferredIds.slice(0, 4);
                return;
              }
            }

            const pricingSeries = bundle.series.filter((entry) => isPriceSeries(entry));
            if (pricingSeries.length > 0) {
              const nonPredicted = pricingSeries.filter((entry) => !isPredictedPriceSeries(entry));
              const defaults = (nonPredicted.length > 0 ? nonPredicted : pricingSeries).slice(0, 1);
              next[bundle.fileRef] = defaults.map((entry) => entry.id);
              return;
            }

            next[bundle.fileRef] = bundle.series.slice(0, 4).map((entry) => entry.id);
          }
        }
      });
      return next;
    });
  }, [timeseriesBundles]);

  const timeline = useMemo(() => {
    const values = new Set<number>();
    timeseriesBundles.forEach((bundle) => {
      bundle.series.forEach((series) => {
        series.points.forEach((point) => {
          if (typeof point.epochMs === "number") {
            values.add(point.epochMs);
          }
        });
      });
    });
    return Array.from(values).sort((a, b) => a - b);
  }, [timeseriesBundles]);

  const minEpoch = timeline.length > 0 ? timeline[0] : null;
  const maxEpoch = timeline.length > 0 ? timeline[timeline.length - 1] : null;
  const presetDurationMs = timePreset === "all" ? null : TIME_PRESET_MS[timePreset];

  const customRangeStart = parseDateTimeLocal(customFrom);
  const customRangeEnd = parseDateTimeLocal(customTo);
  const presetMaxStart =
    minEpoch !== null && maxEpoch !== null && presetDurationMs !== null
      ? Math.max(minEpoch, maxEpoch - presetDurationMs)
      : null;

  useEffect(() => {
    if (minEpoch === null || maxEpoch === null) {
      setWindowStartMs(null);
      return;
    }

    if (timePreset === "all") {
      setWindowStartMs(minEpoch);
      return;
    }

    if (presetDurationMs === null) return;

    setWindowStartMs((previous) => {
      const defaultStart = alignPresetWindowStart(minEpoch, timePreset);
      if (previous === null) return defaultStart;
      const aligned = alignPresetWindowStart(previous, timePreset);
      const maxStart = presetMaxStart ?? aligned;
      return Math.min(maxStart, Math.max(minEpoch, aligned));
    });
  }, [maxEpoch, minEpoch, presetDurationMs, presetMaxStart, timePreset]);

  const presetRangeStart = useMemo(() => {
    if (timePreset === "all") return minEpoch;
    if (presetDurationMs === null || minEpoch === null || maxEpoch === null) return null;
    const hinted = windowStartMs ?? alignPresetWindowStart(minEpoch, timePreset);
    const maxStart = Math.max(minEpoch, maxEpoch - presetDurationMs);
    return Math.min(maxStart, Math.max(minEpoch, hinted));
  }, [maxEpoch, minEpoch, presetDurationMs, timePreset, windowStartMs]);

  const presetRangeEnd = useMemo(() => {
    if (timePreset === "all") return maxEpoch;
    if (presetRangeStart === null || presetDurationMs === null || maxEpoch === null) return null;
    return Math.min(maxEpoch, presetRangeStart + presetDurationMs);
  }, [maxEpoch, presetDurationMs, presetRangeStart, timePreset]);

  const effectiveDisplayRangeStart = useCustomRange ? customRangeStart : presetRangeStart;
  const effectiveDisplayRangeEnd = useCustomRange ? customRangeEnd : presetRangeEnd;
  const customRangeEndForCharts = resolveInclusiveCustomEnd(customRangeStart, customRangeEnd);
  const effectiveRangeStart = useCustomRange ? customRangeStart : presetRangeStart;
  const effectiveRangeEnd = useCustomRange ? customRangeEndForCharts : presetRangeEnd;
  const chartRangeStart = effectiveRangeStart;
  const chartRangeEnd = effectiveRangeEnd;
  const minimumGranularityMs = useMemo(
    () =>
      resolveMinimumGranularityMs({
        timePreset,
        useCustomRange,
        rangeStart: chartRangeStart,
        rangeEnd: chartRangeEnd,
        sourceResolutionMs
      }),
    [chartRangeEnd, chartRangeStart, sourceResolutionMs, timePreset, useCustomRange]
  );
  const granularityOptions = useMemo(
    () => resolveAvailableGranularityOptions(minimumGranularityMs),
    [minimumGranularityMs]
  );

  useEffect(() => {
    setSelectedGranularityMs((previous) =>
      previous < minimumGranularityMs ? minimumGranularityMs : previous
    );
  }, [minimumGranularityMs]);

  const axisTickStepMs = resolveAxisTickStepMs(
    chartRangeStart,
    chartRangeEnd,
    selectedGranularityMs
  );
  const axisTicks = useMemo(
    () => buildAxisTicks(chartRangeStart, chartRangeEnd, axisTickStepMs),
    [axisTickStepMs, chartRangeEnd, chartRangeStart]
  );
  const canMoveBackward =
    presetDurationMs !== null &&
    minEpoch !== null &&
    (presetRangeStart ?? minEpoch) > minEpoch;
  const canMoveForward =
    presetDurationMs !== null &&
    maxEpoch !== null &&
    (presetRangeEnd ?? maxEpoch) < maxEpoch;

  useEffect(() => {
    if (!rangePopoverOpen) return;
    setDraftFrom(toDateTimeLocal(effectiveDisplayRangeStart));
    setDraftTo(toDateTimeLocal(effectiveDisplayRangeEnd));
  }, [effectiveDisplayRangeEnd, effectiveDisplayRangeStart, rangePopoverOpen]);

  useEffect(() => {
    if (!rangePopoverOpen) return;
    const fromEpoch = parseDateTimeLocal(draftFrom);
    const toEpoch = parseDateTimeLocal(draftTo);
    const anchorEpoch =
      activeDateField === "to"
        ? toEpoch ?? fromEpoch ?? effectiveRangeEnd ?? effectiveRangeStart
        : fromEpoch ?? toEpoch ?? effectiveRangeStart ?? effectiveRangeEnd;
    setCalendarMonth(anchorEpoch === null ? undefined : new Date(anchorEpoch));
  }, [activeDateField, draftFrom, draftTo, effectiveRangeEnd, effectiveRangeStart, rangePopoverOpen]);

  useEffect(() => {
    if (rangePopoverOpen) return;
    setActiveDateField(null);
  }, [rangePopoverOpen]);

  const daysWithData = useMemo(() => {
    const keys = new Set<string>();
    timeline.forEach((epoch) => {
      const day = new Date(epoch);
      keys.add(formatIsoDay(day));
    });
    return keys;
  }, [timeline]);

  const draftFromDate = useMemo(() => {
    const epoch = parseDateTimeLocal(draftFrom);
    return epoch === null ? undefined : new Date(epoch);
  }, [draftFrom]);

  const draftToDate = useMemo(() => {
    const epoch = parseDateTimeLocal(draftTo);
    return epoch === null ? undefined : new Date(epoch);
  }, [draftTo]);

  const infoRecord = asRecord(infoQuery.data);
  const detailsRecord = asRecord(infoRecord?.details);
  const deucalionOptionsRecord =
    asRecord(infoRecord?.deucalion_options) ||
    asRecord(detailsRecord?.deucalion_options) ||
    null;

  const overviewJobName =
    readStringValue(infoQuery.data?.job_name) ||
    readStringValue(infoQuery.data?.run_name) ||
    readStringValue(infoQuery.data?.experiment_name) ||
    jobId;
  const experimentName =
    readStringValue(infoQuery.data?.experiment_name) ||
    readStringFrom(detailsRecord, ["experiment_name", "experiment"]) ||
    "-";
  const runName =
    readStringValue(infoQuery.data?.run_name) ||
    readStringFrom(detailsRecord, ["run_name", "run"]) ||
    "-";
  const submittedBy =
    readStringValue(infoQuery.data?.submitted_by) ||
    readStringFrom(detailsRecord, ["submitted_by", "submitter", "owner", "user"]) ||
    "-";
  const targetHost =
    readStringValue(infoQuery.data?.target_host) ||
    readStringFrom(detailsRecord, ["target_host", "host", "executor"]) ||
    "auto";

  const baseConfigPath =
    readStringValue(infoQuery.data?.config_path) ||
    readStringFrom(detailsRecord, ["config_path", "config"]) ||
    null;
  const resolvedConfigFile =
    readStringValue(infoQuery.data?.resolved_config_file) ||
    readStringFrom(detailsRecord, ["resolved_config_file", "resolved_config"]) ||
    null;
  const resolvedConfigAvailable =
    Boolean(infoQuery.data?.resolved_config_available) ||
    Boolean(resolvedConfigFile) ||
    isCompleted;
  const baseConfigLabel = resolveConfigLabel(baseConfigPath);
  const resolvedConfigLabel = resolvedConfigFile || "config.resolved.yaml";

  const updatedAt = pickUpdatedAt(progressQuery.data, infoQuery.data);
  const runDurationSeconds =
    typeof infoQuery.data?.run_duration_seconds === "number"
      ? infoQuery.data.run_duration_seconds
      : readNumberFrom(detailsRecord, ["run_duration_seconds", "run_seconds"]);
  const queueWaitSeconds =
    typeof infoQuery.data?.queue_wait_seconds === "number"
      ? infoQuery.data.queue_wait_seconds
      : readNumberFrom(detailsRecord, ["queue_wait_seconds", "queue_seconds", "wait_seconds"]);
  const totalDurationSeconds =
    typeof infoQuery.data?.total_duration_seconds === "number"
      ? infoQuery.data.total_duration_seconds
      : readNumberFrom(detailsRecord, ["total_duration_seconds", "total_seconds"]);
  const submittedAt = infoQuery.data?.submitted_at ?? readDateLikeFrom(detailsRecord, ["submitted_at", "created_at"]);
  const startedAt = infoQuery.data?.started_at ?? readDateLikeFrom(detailsRecord, ["started_at", "slurm_start_time"]);
  const finishedAt = infoQuery.data?.finished_at ?? readDateLikeFrom(detailsRecord, ["finished_at", "ended_at"]);
  const queuedAt = infoQuery.data?.queued_at ?? readDateLikeFrom(detailsRecord, ["queued_at", "slurm_submit_time"]);
  const progressPercent = useMemo(() => {
    const payload = progressQuery.data as Record<string, unknown> | undefined;
    if (!payload) return null;
    const candidates = [
      payload.progress_pct,
      payload.percent,
      payload.progress,
      payload.progress_percent,
      payload.completion
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        const value = candidate <= 1 ? candidate * 100 : candidate;
        return Math.max(0, Math.min(100, value));
      }
      if (typeof candidate === "string" && candidate.trim() !== "") {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed)) {
          const value = parsed <= 1 ? parsed * 100 : parsed;
          return Math.max(0, Math.min(100, value));
        }
      }
    }
    return null;
  }, [progressQuery.data]);

  const imageName =
    readStringValue(infoQuery.data?.image) ||
    readStringFrom(infoRecord, ["runtime_image", "container_image", "docker_image", "image_name"]) ||
    readStringFrom(detailsRecord, ["image", "runtime_image", "container_image", "docker_image"]);
  const imageTag =
    readStringFrom(infoRecord, ["image_tag", "tag", "runtime_tag"]) ||
    readStringFrom(detailsRecord, ["image_tag", "tag"]);
  const runtimeImage =
    imageName && imageTag
      ? `${imageName}:${imageTag}`
      : imageName || imageTag || "-";
  const deucalionAccount =
    readStringFrom(deucalionOptionsRecord, ["account"]) ||
    readStringFrom(detailsRecord, ["slurm_account", "account"]);
  const deucalionPartition =
    readStringFrom(deucalionOptionsRecord, ["partition"]) ||
    readStringFrom(detailsRecord, ["slurm_partition", "partition"]);
  const deucalionCommandMode =
    readStringFrom(deucalionOptionsRecord, ["command_mode", "commandMode"]) ||
    readStringFrom(detailsRecord, ["command_mode"]);
  const cpusPerTask =
    readNumberFrom(deucalionOptionsRecord, ["cpus_per_task", "cpusPerTask"]) ||
    readNumberFrom(detailsRecord, ["slurm_cpus", "cpus_per_task", "cpus"]);
  const memPerTaskGb =
    readNumberFrom(deucalionOptionsRecord, ["mem_gb", "memGb"]) ||
    readNumberFrom(detailsRecord, ["mem_gb", "memory_gb", "slurm_mem_gb"]);
  const gpusPerTask =
    readNumberFrom(deucalionOptionsRecord, ["gpus", "gpu_count", "gpus_per_task"]) ||
    readNumberFrom(detailsRecord, ["slurm_gpus", "gpus"]);
  const computeProfile =
    gpusPerTask && gpusPerTask > 0
      ? "GPU"
      : isGpuLikePartition(deucalionPartition)
        ? "GPU"
        : targetHost.toLowerCase() === "deucalion"
          ? "CPU"
          : null;

  const cpusPerTaskLabel = cpusPerTask !== null ? `${Math.max(0, Math.round(cpusPerTask))}` : "-";
  const memPerTaskLabel = memPerTaskGb !== null ? `${Math.max(0, memPerTaskGb)} GB` : "-";
  const gpusPerTaskLabel =
    gpusPerTask !== null
      ? `${Math.max(0, Math.round(gpusPerTask))}`
      : computeProfile === "CPU"
        ? "0"
        : "-";
  const canOpenResolvedConfig = Boolean(jobId && resolvedConfigAvailable);
  const availableConfigs = configsQuery.data || [];

  const hasOverviewLogs = overviewLogs.text.trim().length > 0;

  const mlflowUrl = resolveMlflowRunUrl(infoQuery.data);
  const jobDescription =
    typeof infoQuery.data?.description === "string" && infoQuery.data.description.trim() !== ""
      ? infoQuery.data.description.trim()
      : typeof infoQuery.data?.job_description === "string" && infoQuery.data.job_description.trim() !== ""
        ? infoQuery.data.job_description.trim()
        : null;
  const communityLabel = kpiCommunityLabel;
  const isCommunityMode = selectedNodeId === "__community__";
  const isBuildingCompareMode = selectedBuildingNodeIds.length === 2;

  function setTab(nextTab: DetailTab): void {
    const params = new URLSearchParams(searchParams);
    params.set("tab", nextTab);
    setSearchParams(params, { replace: true });
  }

  function openBaseConfigPreview(configPath: string): void {
    const normalized = configPath.split(/[\\/]/).filter(Boolean);
    const baseName = normalized[normalized.length - 1] || configPath;
    const resolvedName = availableConfigs.find((item) => item === configPath || item === baseName) || baseName;
    setConfigPreviewLabel(resolveConfigLabel(configPath));
    setConfigPreviewTarget(resolvedName);
    setConfigPreviewMode("base");
    setConfigPreviewJobId("");
    setConfigPreviewOpen(true);
  }

  function openResolvedConfigPreview(): void {
    setConfigPreviewLabel(`Resolved config · ${overviewJobName}`);
    setConfigPreviewTarget("");
    setConfigPreviewMode("resolved");
    setConfigPreviewJobId(jobId);
    setConfigPreviewOpen(true);
  }

  async function downloadDeployManifest(): Promise<void> {
    const manifestData = deployManifestQuery.data;
    if (!manifestData?.content) return;
    setDeployActionError(null);
    setDeployDownloadBusyKey("manifest");
    try {
      const blob = new Blob([manifestData.content], { type: "application/json;charset=utf-8" });
      triggerBlobDownload(blob, "artifact_manifest.json");
    } catch (error) {
      setDeployActionError(error instanceof Error ? error.message : "Could not download manifest.");
    } finally {
      setDeployDownloadBusyKey(null);
    }
  }

  async function downloadDeployModel(artifact: DeployArtifactRow): Promise<void> {
    if (!artifact.path) return;
    setDeployActionError(null);
    setDeployDownloadBusyKey(`model:${artifact.path}`);
    try {
      let blob: Blob | null = null;
      if (artifact.onnxUrl) {
        const response = await fetch(artifact.onnxUrl);
        if (!response.ok) {
          throw new Error(`Download failed (${response.status}).`);
        }
        blob = await response.blob();
      } else {
        const source = simulationIndexQuery.data as SimulationDataSource | undefined;
        if (source?.provider === "backend") {
          const downloaded = await readBackendBundleFileAsBlob(
            source.jobId,
            source.session,
            artifact.path,
            deployManifestQuery.data?.backendBasePrefix || ""
          );
          blob = downloaded?.blob || null;
        }
      }

      if (!blob) {
        throw new Error("ONNX file is not available for download in the current source.");
      }

      const fileName = artifact.path.split("/").filter(Boolean).pop() || `agent_${artifact.agentIndex ?? "model"}.onnx`;
      triggerBlobDownload(blob, fileName);
    } catch (error) {
      setDeployActionError(error instanceof Error ? error.message : "Could not download ONNX model.");
    } finally {
      setDeployDownloadBusyKey(null);
    }
  }

  function isOverlayAssetKind(kind: SimulationTreeNode["kind"]): boolean {
    return kind === "battery" || kind === "charger";
  }

  function sortBuildingSelection(ids: string[]): string[] {
    return [...ids].sort((left, right) => {
      const leftOrder = treeOrderMap.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = treeOrderMap.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
  }

  function selectCommunityContext(): void {
    setSelectedNodeId("__community__");
    setSelectedBuildingNodeIds([]);
    setSelectedAssetNodeIds([]);
  }

  function handleTreeSelect(nodeId: string, additive: boolean): void {
    const node = treeNodeMap.get(nodeId);
    if (!node) return;

    if (node.kind === "group") {
      toggleExpand(nodeId);
      return;
    }

    if (node.kind === "building") {
      setSelectedNodeId(nodeId);
      setSelectedAssetNodeIds([]);
      setSelectedBuildingNodeIds((previous) => {
        if (!additive) return [nodeId];
        if (previous.includes(nodeId)) {
          const next = previous.filter((id) => id !== nodeId);
          return sortBuildingSelection(next.length > 0 ? next : [nodeId]);
        }
        if (previous.length === 0) return [nodeId];
        if (previous.length === 1) return sortBuildingSelection([...previous, nodeId]);
        return sortBuildingSelection([previous[1], nodeId]);
      });
      return;
    }

    if (node.kind === "electric_vehicle") {
      setSelectedNodeId(nodeId);
      setSelectedBuildingNodeIds([]);
      setSelectedAssetNodeIds([]);
      return;
    }

    if (isOverlayAssetKind(node.kind)) {
      const parentId = parentNodeMap.get(nodeId);
      const parentNode = parentId ? treeNodeMap.get(parentId) : null;
      const parentIsBuilding = Boolean(parentNode && parentNode.kind === "building");
      const baseContextId = parentIsBuilding && parentId ? parentId : "__community__";

      setSelectedNodeId(baseContextId);
      setSelectedBuildingNodeIds(parentIsBuilding && parentId ? [parentId] : []);
      setSelectedAssetNodeIds((previous) => {
        if (selectedNodeId !== baseContextId) {
          return [nodeId];
        }

        if (previous.includes(nodeId)) {
          return previous.filter((id) => id !== nodeId);
        }

        return Array.from(new Set([...previous, nodeId]));
      });

      if (parentIsBuilding && parentId) {
        setExpandedNodes((previous) => {
          const next = new Set(previous);
          next.add(parentId);
          return next;
        });
      }
      return;
    }

    setSelectedNodeId(nodeId);
    setSelectedBuildingNodeIds([]);
    setSelectedAssetNodeIds([]);
  }

  function shiftPresetWindow(direction: -1 | 1): void {
    if (presetDurationMs === null || maxEpoch === null || minEpoch === null) return;
    const currentStart = presetRangeStart ?? minEpoch;
    const rawNextStart = currentStart + direction * presetDurationMs;
    const maxStart = Math.max(minEpoch, maxEpoch - presetDurationMs);
    const nextStart = Math.min(maxStart, Math.max(minEpoch, rawNextStart));
    const nextEnd = Math.min(maxEpoch, nextStart + presetDurationMs);
    setWindowStartMs(nextStart);
    setUseCustomRange(false);
    setCustomRangeSource(null);
    setCustomFrom(toDateTimeLocal(nextStart));
    setCustomTo(toDateTimeLocal(nextEnd));
  }

  function handleZoomCommit(from: number, to: number): void {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < 1000) return;
    const currentFrom = toDateTimeLocal(effectiveDisplayRangeStart);
    const currentTo = toDateTimeLocal(effectiveDisplayRangeEnd);
    setZoomHistory((previous) => [
      ...previous.slice(-9),
      {
        useCustomRange,
        customRangeSource,
        customFrom: useCustomRange ? customFrom : currentFrom,
        customTo: useCustomRange ? customTo : currentTo,
        timePreset,
        windowStartMs
      }
    ]);

    setUseCustomRange(true);
    setCustomRangeSource("zoom");
    setCustomFrom(toDateTimeLocal(from));
    setCustomTo(toDateTimeLocal(to));
    setWindowStartMs(from);
  }

  function resetZoomRange(): void {
    if (zoomHistory.length === 0) {
      setUseCustomRange(false);
      setCustomRangeSource(null);
      return;
    }

    const previous = zoomHistory[zoomHistory.length - 1];
    setZoomHistory((entries) => entries.slice(0, -1));
    setTimePreset(previous.timePreset);
    setWindowStartMs(previous.windowStartMs);
    setCustomFrom(previous.customFrom);
    setCustomTo(previous.customTo);
    setUseCustomRange(previous.useCustomRange);
    setCustomRangeSource(previous.customRangeSource);
  }

  function setDraftDate(field: "from" | "to", date: Date | undefined): void {
    if (!date) return;
    if (field === "from") {
      const fromStart = startOfDay(date);
      const fromEpoch = fromStart.getTime();
      setDraftFrom(toDateTimeLocal(fromEpoch));
      const currentTo = parseDateTimeLocal(draftTo);
      if (currentTo === null || currentTo <= fromEpoch) {
        setDraftTo(toDateTimeLocal(fromEpoch));
      }
      setActiveDateField("to");
      setCalendarMonth(new Date(fromEpoch));
      return;
    }
    const toEpoch = startOfDay(date).getTime();
    setDraftTo(toDateTimeLocal(toEpoch));
    setActiveDateField(null);
    setCalendarMonth(new Date(toEpoch));
  }

  function toggleExpand(nodeId: string): void {
    setExpandedNodes((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  function toggleChartSeries(fileRef: string, seriesId: string): void {
    setVisibleSeries((previous) => {
      const current = previous[fileRef] || [];
      const exists = current.includes(seriesId);
      if (exists) {
        return {
          ...previous,
          [fileRef]: current.filter((item) => item !== seriesId)
        };
      }
      return {
        ...previous,
        [fileRef]: [...current, seriesId]
      };
    });
  }

  return (
    <div className="page job-detail-page">
      <h1 className="sr-only">{jobId}</h1>

      <div className="job-subnav-row">
        <nav className="job-subnav" aria-label="Job detail navigation">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`job-subtab${activeTab === tab ? " is-active" : ""}`}
              onClick={() => setTab(tab)}
            >
              {tab === "kpis" ? "KPIs" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
        <div className="job-subnav-actions">
          <Button variant="ghost" iconLeft={<ArrowLeft size={14} />} onClick={() => navigate(backTarget)}>
            Back to Jobs
          </Button>
        </div>
      </div>

      {isLoading ? (
        <section className="datasets-loader-preview">
          <EVChargingLoader label="Loading job details..." />
        </section>
      ) : null}
      {!isLoading && (statusQuery.isError || infoQuery.isError || resultQuery.isError) ? (
        <EmptyState
          title="Could not load job details"
          message="Please retry from the Jobs page or check backend connectivity."
          action={
            <Button variant="secondary" onClick={() => navigate(backTarget)}>
              Back to Jobs
            </Button>
          }
        />
      ) : null}

      {!isLoading && !statusQuery.isError && !infoQuery.isError && !resultQuery.isError ? (
        <section className="job-detail-body">
          {activeTab === "overview" ? (
            <section className="panel job-overview-shell">
              <header className="job-overview-hero">
                <div className="job-overview-title-block">
                  <small className="job-overview-kicker">Training job</small>
                  <h2>{overviewJobName}</h2>
                  <small className="job-overview-jobid">{jobId}</small>
                </div>
                <div className="job-overview-hero-status">
                  <StatusPill status={status} />
                  <small className="jobs-meta">Last update: {formatDateTime(updatedAt)}</small>
                  <div className="job-overview-hero-actions">
                    <Button
                      variant="secondary"
                      iconLeft={<FileText size={14} />}
                      onClick={() => setOverviewLogsOpen(true)}
                    >
                      Open Logs
                    </Button>
                    {mlflowUrl ? (
                      <a className="btn btn-ghost btn-md" href={mlflowUrl} target="_blank" rel="noreferrer">
                        <span className="btn-icon">
                          <ExternalLink size={14} />
                        </span>
                        <span>MLflow</span>
                      </a>
                    ) : null}
                  </div>
                </div>
              </header>

              <section className="job-overview-metrics">
                <article className="job-overview-metric">
                  <small>Submitted by</small>
                  <strong>{submittedBy}</strong>
                </article>
                <article className="job-overview-metric">
                  <small>Target host</small>
                  <strong>{targetHost}</strong>
                </article>
                <article className="job-overview-metric">
                  <small>Run duration</small>
                  <strong>{formatDurationSeconds(runDurationSeconds)}</strong>
                </article>
                <article className="job-overview-metric">
                  <small>Queue wait</small>
                  <strong>{formatDurationSeconds(queueWaitSeconds)}</strong>
                </article>
                <article className="job-overview-metric is-progress">
                  <div className="job-overview-progress-head">
                    <small>Progress</small>
                    <strong>{progressPercent === null ? "-" : `${Math.round(progressPercent)}%`}</strong>
                  </div>
                  <div className="progress-track is-thin">
                    <div className="progress-fill" style={{ width: `${progressPercent ?? 0}%` }} />
                  </div>
                </article>
              </section>

              <section className="job-overview-columns">
                <div className="job-overview-column">
                  <article className="job-overview-section">
                    <header>
                      <h3>Identification</h3>
                    </header>
                    <dl className="job-overview-list">
                      <div>
                        <dt>Experiment name</dt>
                        <dd>{experimentName}</dd>
                      </div>
                      <div>
                        <dt>Run name</dt>
                        <dd>{runName}</dd>
                      </div>
                      <div>
                        <dt>Job ID</dt>
                        <dd>{jobId}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{status}</dd>
                      </div>
                    </dl>
                  </article>

                  <article className="job-overview-section">
                    <header>
                      <h3>Runtime & Compute</h3>
                    </header>
                    <dl className="job-overview-list">
                      <div>
                        <dt>Image</dt>
                        <dd>{runtimeImage}</dd>
                      </div>
                      <div>
                        <dt>Host</dt>
                        <dd>{targetHost}</dd>
                      </div>
                      <div>
                        <dt>Profile</dt>
                        <dd>{computeProfile || "-"}</dd>
                      </div>
                      <div>
                        <dt>Partition</dt>
                        <dd>{deucalionPartition || "-"}</dd>
                      </div>
                      <div>
                        <dt>Account</dt>
                        <dd>{deucalionAccount || "-"}</dd>
                      </div>
                      <div>
                        <dt>Command mode</dt>
                        <dd>{deucalionCommandMode || "-"}</dd>
                      </div>
                      <div>
                        <dt>CPUs / task</dt>
                        <dd>{cpusPerTaskLabel}</dd>
                      </div>
                      <div>
                        <dt>Memory / task</dt>
                        <dd>{memPerTaskLabel}</dd>
                      </div>
                      <div>
                        <dt>GPUs / task</dt>
                        <dd>{gpusPerTaskLabel}</dd>
                      </div>
                    </dl>
                  </article>
                </div>

                <div className="job-overview-column">
                  <article className="job-overview-section">
                    <header>
                      <h3>Timeline & Durations</h3>
                    </header>
                    <dl className="job-overview-list">
                      <div>
                        <dt>Submitted at</dt>
                        <dd>{formatDateTime(submittedAt)}</dd>
                      </div>
                      <div>
                        <dt>Queued at</dt>
                        <dd>{formatDateTime(queuedAt)}</dd>
                      </div>
                      <div>
                        <dt>Started at</dt>
                        <dd>{formatDateTime(startedAt)}</dd>
                      </div>
                      <div>
                        <dt>Finished at</dt>
                        <dd>{formatDateTime(finishedAt)}</dd>
                      </div>
                      <div>
                        <dt>Queue wait</dt>
                        <dd>{formatDurationSeconds(queueWaitSeconds)}</dd>
                      </div>
                      <div>
                        <dt>Total elapsed</dt>
                        <dd>{formatDurationSeconds(totalDurationSeconds)}</dd>
                      </div>
                    </dl>
                  </article>

                  <article className="job-overview-section">
                    <header>
                      <h3>Configurations</h3>
                    </header>
                    <div className="jobs-config-cell job-overview-config-links">
                      {canOpenResolvedConfig ? (
                        <strong>
                          <button
                            type="button"
                            className="btn-link jobs-config-link"
                            onClick={() => openResolvedConfigPreview()}
                            title="Preview resolved config"
                          >
                            {resolvedConfigLabel}
                          </button>
                        </strong>
                      ) : null}
                      {baseConfigPath ? (
                        <small>
                          {canOpenResolvedConfig ? "Based on " : ""}
                          <button
                            type="button"
                            className="btn-link jobs-config-link"
                            onClick={() => openBaseConfigPreview(baseConfigPath)}
                            title="Preview experiment config"
                          >
                            {baseConfigLabel}
                          </button>
                        </small>
                      ) : null}
                      {!canOpenResolvedConfig && !baseConfigPath ? <small className="jobs-meta">-</small> : null}
                    </div>
                  </article>
                </div>
              </section>

              {jobDescription ? (
                <article className="job-overview-description">
                  <h4>Description</h4>
                  <p>{jobDescription}</p>
                </article>
              ) : null}

              <details className="job-overview-raw">
                <summary>Raw metadata</summary>
                <pre className="json-view compact">{JSON.stringify(infoQuery.data || {}, null, 2)}</pre>
              </details>
            </section>
          ) : null}

          {activeTab === "timeseries" ? (
            <section className="panel timeseries-workspace">
              {!isCompleted ? (
                <EmptyState
                  title="Timeseries available after completion"
                  message="This job is not completed yet, so final result series are not available."
                />
              ) : simulationIndexQuery.isLoading ? (
                <section className="datasets-loader-preview">
                  <EVChargingLoader label="Loading simulation index..." />
                </section>
              ) : simulationIndexQuery.isError ? (
                <EmptyState
                  title="Could not load simulation files"
                  message="Failed to load simulation-data index from backend bridge."
                />
              ) : !simulationTree ? (
                <EmptyState
                  title="No simulation data files"
                  message="No CSV files were found in the selected simulation-data session."
                />
              ) : (
                <>
                  <section className="timeseries-toolbar panel">
                    <div className="timeseries-toolbar-left">
                      <div className="segmented-row">
                        {(["1h", "6h", "24h", "7d", "30d", "all"] as TimePreset[]).map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            className={`segment-btn${timePreset === preset ? " is-active" : ""}`}
                            onClick={() => {
                              setTimePreset(preset);
                              setUseCustomRange(false);
                              setCustomRangeSource(null);
                              let nextRangeStart: number | null = null;
                              let nextRangeEnd: number | null = null;
                              if (maxEpoch !== null && minEpoch !== null) {
                                const duration = preset === "all" ? null : TIME_PRESET_MS[preset];
                                const baseStart =
                                  customRangeStart ?? presetRangeStart ?? alignPresetWindowStart(minEpoch, timePreset);
                                if (duration === null) {
                                  nextRangeStart = minEpoch;
                                  nextRangeEnd = maxEpoch;
                                  setWindowStartMs(minEpoch);
                                  setCustomFrom(toDateTimeLocal(minEpoch));
                                  setCustomTo(toDateTimeLocal(maxEpoch));
                                } else {
                                  const maxStart = Math.max(minEpoch, maxEpoch - duration);
                                  const nextStart = Math.min(
                                    maxStart,
                                    Math.max(minEpoch, alignPresetWindowStart(baseStart, preset))
                                  );
                                  const nextEnd = Math.min(maxEpoch, nextStart + duration);
                                  nextRangeStart = nextStart;
                                  nextRangeEnd = nextEnd;
                                  setWindowStartMs(nextStart);
                                  setCustomFrom(toDateTimeLocal(nextStart));
                                  setCustomTo(toDateTimeLocal(nextEnd));
                                }
                              }
                              const nextMinGranularity = resolveMinimumGranularityMs({
                                timePreset: preset,
                                useCustomRange: false,
                                rangeStart: nextRangeStart,
                                rangeEnd: nextRangeEnd,
                                sourceResolutionMs
                              });
                              setSelectedGranularityMs(nextMinGranularity);
                            }}
                          >
                            {preset === "all" ? "All" : preset}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="segment-btn segment-icon-btn"
                          onClick={() => shiftPresetWindow(-1)}
                          disabled={!canMoveBackward}
                          title="Previous window"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          className="segment-btn segment-icon-btn"
                          onClick={() => shiftPresetWindow(1)}
                          disabled={!canMoveForward}
                          title="Next window"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="timeseries-toolbar-right">
                      {useCustomRange && customRangeSource === "zoom" ? (
                        <button
                          type="button"
                          className="segment-btn"
                          onClick={() => {
                            setUseCustomRange(false);
                            setCustomRangeSource(null);
                          }}
                          title="Reset zoom to current preset window"
                        >
                          Reset Zoom
                        </button>
                      ) : null}
                      <div className="segmented-row timeseries-granularity-row" role="group" aria-label="Granularity">
                        <span className="timeseries-granularity-label">Granularity</span>
                        {granularityOptions.map((option) => (
                          <button
                            key={option.label}
                            type="button"
                            className={`segment-btn${selectedGranularityMs === option.ms ? " is-active" : ""}`}
                            disabled={!option.enabled}
                            onClick={() => setSelectedGranularityMs(option.ms)}
                            title={
                              option.enabled
                                ? `Show data with ${option.label} buckets`
                                : `Unavailable for current range/data resolution`
                            }
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={`timeseries-range-trigger${rangePopoverOpen ? " is-open" : ""}`}
                        onClick={() =>
                          setRangePopoverOpen((previous) => {
                            const next = !previous;
                            if (next && activeDateField === null) setActiveDateField("from");
                            if (!next) setActiveDateField(null);
                            return next;
                          })
                        }
                        title="Adjust custom range"
                      >
                        <CalendarDays size={15} />
                        <span className="timeseries-range-trigger-copy">
                          <small>Custom range</small>
                          <strong>{formatRangeSummary(effectiveDisplayRangeStart, effectiveDisplayRangeEnd)}</strong>
                        </span>
                        <ChevronDown size={14} />
                      </button>

                      {rangePopoverOpen ? (
                        <div className="timeseries-range-popover panel">
                          <div className="timeseries-range-head">
                            <div>
                              <strong>Select date range</strong>
                              <small>Choose a start and end date/time for the visible window.</small>
                            </div>
                            <span className="timeseries-range-hint">
                              <span className="timeseries-range-hint-dot" />
                              Days with data
                            </span>
                          </div>
                          <div className="timeseries-date-row">
                            <div className="timeseries-date-field">
                              <span>From</span>
                              <button
                                type="button"
                                className={`timeseries-date-trigger${activeDateField === "from" ? " is-active" : ""}`}
                                onClick={() =>
                                  setActiveDateField((previous) => (previous === "from" ? null : "from"))
                                }
                              >
                                {draftFromDate ? formatPickerDay(draftFromDate) : "Select date"}
                              </button>
                              <TimeInput24
                                value={extractTimePart(draftFrom)}
                                ariaLabel="From time"
                                onChange={(nextTime) => {
                                  const base = draftFromDate ?? new Date();
                                  setDraftFrom(applyDateAndTime(base, nextTime));
                                }}
                              />
                            </div>

                            <div className="timeseries-date-field">
                              <span>To</span>
                              <button
                                type="button"
                                className={`timeseries-date-trigger${activeDateField === "to" ? " is-active" : ""}`}
                                onClick={() => setActiveDateField((previous) => (previous === "to" ? null : "to"))}
                              >
                                {draftToDate ? formatPickerDay(draftToDate) : "Select date"}
                              </button>
                              <TimeInput24
                                value={extractTimePart(draftTo, "00:00")}
                                ariaLabel="To time"
                                onChange={(nextTime) => {
                                  const base = draftToDate ?? draftFromDate ?? new Date();
                                  setDraftTo(applyDateAndTime(base, nextTime));
                                }}
                              />
                            </div>
                          </div>
                          {activeDateField ? (
                            <div className="timeseries-mini-calendar">
                              <DayPicker
                                className="timeseries-daypicker"
                                mode="single"
                                numberOfMonths={1}
                                showOutsideDays
                                month={calendarMonth}
                                onMonthChange={setCalendarMonth}
                                selected={activeDateField === "from" ? draftFromDate : draftToDate}
                                onSelect={(date) => {
                                  setDraftDate(activeDateField, date);
                                }}
                                disabled={(date) => !daysWithData.has(formatIsoDay(date))}
                                modifiers={{
                                  hasData: (date) => daysWithData.has(formatIsoDay(date))
                                }}
                                modifiersClassNames={{
                                  hasData: "rdp-day_has-data"
                                }}
                              />
                            </div>
                          ) : null}
                          <div className="timeseries-range-actions">
                            <button
                              type="button"
                              className="segment-btn"
                              onClick={() => {
                                setActiveDateField(null);
                                setRangePopoverOpen(false);
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="segment-btn is-primary"
                              onClick={() => {
                                const nextStart = parseDateTimeLocal(draftFrom);
                                const nextEndRaw = parseDateTimeLocal(draftTo);
                                const nextEnd = resolveInclusiveCustomEnd(nextStart, nextEndRaw);
                                if (nextStart === null || nextEnd === null || nextEnd <= nextStart) return;
                                setCustomFrom(draftFrom);
                                setCustomTo(draftTo);
                                setUseCustomRange(true);
                                setCustomRangeSource("picker");
                                setWindowStartMs(nextStart);
                                setActiveDateField(null);
                                setRangePopoverOpen(false);
                              }}
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <div className="timeseries-layout">
                    <TimeseriesTree
                      root={simulationTree}
                      communityLabel={communityLabel}
                      helpText="Tip: Ctrl/Cmd (or Shift) + click on two buildings to compare side by side."
                      isCommunityActive={selectedNodeId === "__community__"}
                      selectedId={selectedNodeId}
                      selectedBuildingIds={new Set(selectedBuildingNodeIds)}
                      selectedAssetIds={new Set(selectedAssetNodeIds)}
                      expanded={expandedNodes}
                      onSelectCommunity={selectCommunityContext}
                      onSelect={handleTreeSelect}
                      onToggle={toggleExpand}
                    />

                    <section className="timeseries-main">
                      {timeseriesQuery.isLoading ? (
                        <section className="datasets-loader-preview">
                          <EVChargingLoader label="Loading timeseries CSV files..." />
                        </section>
                      ) : timeseriesBundles.length === 0 ? (
                        <EmptyState
                          title="No timeseries data"
                          message="The selected entity has no usable series for the current range."
                        />
                      ) : (
                        <div
                          className={`sim-chart-grid${isCommunityMode ? " is-community" : ""}${
                            isBuildingCompareMode ? " is-compare" : ""
                          }`}
                        >
                          {timeseriesBundles.map((bundle, index) => (
                            <TimeseriesChart
                              key={bundle.fileRef}
                              title={bundle.title}
                              series={bundle.series}
                              chargerActivitySamples={bundle.chargerActivity?.samples}
                              visibleSeriesIds={visibleSeries[bundle.fileRef] || []}
                              onToggleSeries={(seriesId) => toggleChartSeries(bundle.fileRef, seriesId)}
                              rangeStart={chartRangeStart}
                              rangeEnd={chartRangeEnd}
                              granularityMs={selectedGranularityMs}
                              xTicks={axisTicks}
                              xTickStepMs={axisTickStepMs}
                              onZoomCommit={handleZoomCommit}
                              onZoomReset={resetZoomRange}
                              isPrimary={isCommunityMode && index === 0}
                              isWide={
                                !isBuildingCompareMode &&
                                (isCommunityMode
                                  ? index === 1
                                  : isPrimaryEntityFileRef(bundle.fileRef))
                              }
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
            </section>
          ) : null}

          {activeTab === "kpis" ? (
            <section className="panel">
              <h2>KPIs</h2>
              {!isCompleted ? (
                <EmptyState
                  title="KPIs available after completion"
                  message="This job is still running or queued."
                />
              ) : simulationIndexQuery.isLoading ? (
                <section className="datasets-loader-preview">
                  <EVChargingLoader label="Loading KPI index..." />
                </section>
              ) : kpiCsvQuery.isLoading && kpiFilePath ? (
                <section className="datasets-loader-preview">
                  <EVChargingLoader label="Loading KPI file..." />
                </section>
              ) : kpiRows.length > 0 && kpiScopes.length > 0 ? (
                <div className="kpi-layout">
                  <TimeseriesTree
                    root={kpiTreeRoot}
                    communityLabel={kpiCommunityLabel}
                    helpText="Select a KPI scope. Buildings are single-level entries with no nested entities."
                    isCommunityActive={selectedKpiScopeId === "community"}
                    selectedId={selectedKpiScopeId === "community" ? "__community__" : selectedKpiScopeId}
                    selectedBuildingIds={new Set()}
                    selectedAssetIds={new Set()}
                    expanded={new Set()}
                    onSelectCommunity={() => setSelectedKpiScopeId("community")}
                    onSelect={(id) => setSelectedKpiScopeId(id)}
                    onToggle={() => {}}
                  />

                  <section className="kpi-main">
                    <section className="kpi-toolbar panel">
                      <div className="kpi-toolbar-main">
                        <label className="kpi-filter">
                          <select
                            aria-label="Filter KPI family"
                            value={kpiFamilyFilter}
                            onChange={(event) => setKpiFamilyFilter(event.target.value as KpiFamily | "all")}
                          >
                            <option value="all">All families</option>
                            {kpiFamilyOptions.map((option) => (
                              <option key={option} value={option}>
                                {formatKpiFamilyLabel(option)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="checkbox-inline kpi-toggle-chip">
                          <input
                            type="checkbox"
                            checked={showKpiNa}
                            onChange={(event) => setShowKpiNa(event.target.checked)}
                          />
                          <span>Show N/A</span>
                        </label>
                      </div>
                      <div className="kpi-toolbar-main kpi-toolbar-main--stretch">
                        <label className="search-inline kpi-search">
                          <input
                            value={kpiSearch}
                            onChange={(event) => setKpiSearch(event.target.value)}
                            placeholder="Search KPI..."
                          />
                        </label>
                      </div>
                    </section>

                    {kpiHighlightRows.length > 0 ? (
                      <section className="kpi-highlights-strip panel">
                        <header className="kpi-section-header">
                          <h3>Curated Highlights</h3>
                          <small>Fixed KPI bar for quick checks in this scope.</small>
                        </header>
                        <div className="kpi-highlight-grid">
                          {kpiHighlightRows.map((item) => (
                            <article key={item.key} className={`kpi-highlight-card tone-${item.tone} ${item.hasComparable ? "" : "is-static"}`}>
                              <header>
                                <div className="kpi-highlight-title">
                                  <small>{item.title}</small>
                                  <button type="button" className="kpi-help" aria-label={`About ${item.metricLabel}`}>
                                    <Info size={12} />
                                    <span role="tooltip" className="kpi-help-tooltip">
                                      <strong>{item.metricLabel}</strong>
                                      <small>{item.description}</small>
                                      <small>{item.formula}</small>
                                    </span>
                                  </button>
                                </div>
                                {formatToneLabel(item.tone, { hideUnknown: true }) ? (
                                  <span className={`kpi-tone kpi-tone-${item.tone}`}>
                                    {formatToneLabel(item.tone, { hideUnknown: true })}
                                  </span>
                                ) : null}
                              </header>
                              <strong>{formatHighlightNumber(item.value)}</strong>
                              <footer>
                                <small>{item.hasComparable ? `Δ ${formatHighlightNumber(item.delta)}` : "No baseline comparison"}</small>
                                <small>{item.unit || "-"}</small>
                              </footer>
                            </article>
                          ))}
                        </div>
                      </section>
                    ) : null}

                    {visibleKpiGroupRows.length === 0 ? (
                      <EmptyState
                        title="No KPIs in selected scope"
                        message="Try another scope, family filter, search term, or enable Show N/A."
                      />
                    ) : (
                      kpiSemanticSections.map((familySection) => {
                        const FamilyIcon = resolveFamilyIcon(familySection.family);
                        return (
                        <details key={familySection.family} className="panel kpi-family-panel">
                          <summary className="kpi-family-summary">
                            <span className="kpi-family-heading">
                              <span className={`kpi-family-icon family-${familySection.family}`}>
                                <FamilyIcon size={14} />
                              </span>
                              <span>
                                <strong>{familySection.familyLabel}</strong>
                                <small>{familySection.subfamilies.length} subfamily group(s)</small>
                              </span>
                            </span>
                            <span className="kpi-family-pill">{familySection.subfamilies.length} groups</span>
                          </summary>

                          <div className="kpi-family-body">
                            <div className="kpi-subfamily-stack">
                              {familySection.subfamilies.map((subfamily) => (
                                <details key={`${familySection.family}:${subfamily.subfamilyKey}`} className="kpi-subfamily-accordion">
                                  <summary>
                                    <strong>{subfamily.subfamilyLabel}</strong>
                                    <small>{subfamily.rows.length} KPI(s)</small>
                                  </summary>
                                  <div className="job-kpi-table-wrap kpi-list-wrap">
                                    <table className="table">
                                      <thead>
                                        <tr>
                                          <th>KPI</th>
                                          <th>Control</th>
                                          <th>Baseline</th>
                                          <th>Delta</th>
                                          <th>Delta %</th>
                                          <th>Primary</th>
                                          <th>Tone</th>
                                          <th>Unit</th>
                                          <th>Entity breakdown</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {subfamily.rows.map((row) => {
                                          const tone = scoreKpiGroupTone(row);
                                          const toneLabel = formatToneLabel(tone, { hideUnknown: true });
                                          const primary = pickPrimaryValueForGroup(row);
                                          const isNa = !isKpiGroupUsed(row);
                                          const breakdown =
                                            row.breakdown.control.length > 0
                                              ? row.breakdown.control
                                              : row.breakdown.absolute.length > 0
                                                ? row.breakdown.absolute
                                                : row.breakdown.baseline.length > 0
                                                  ? row.breakdown.baseline
                                                  : row.breakdown.delta.length > 0
                                                    ? row.breakdown.delta
                                                    : row.breakdown.normalized;
                                          return (
                                            <tr key={`row:${row.comparisonKey}`} className={isNa ? "kpi-row-na" : ""}>
                                              <td>
                                                <div className="kpi-row-label">
                                                  <span>
                                                    {row.label}
                                                    <small className="kpi-row-meta">{row.canonicalGroupId}</small>
                                                  </span>
                                                  <button type="button" className="kpi-help" aria-label={`About ${row.label}`}>
                                                    <Info size={12} />
                                                    <span role="tooltip" className="kpi-help-tooltip">
                                                      <strong>{row.label}</strong>
                                                      <small>{row.tooltip.shortDescription}</small>
                                                      <small>{row.tooltip.formulaShort}</small>
                                                    </span>
                                                  </button>
                                                </div>
                                              </td>
                                              <td>{formatNumber(row.control)}</td>
                                              <td>{formatNumber(row.baseline)}</td>
                                              <td className={tone === "better" ? "kpi-delta-better" : tone === "worse" ? "kpi-delta-worse" : ""}>
                                                {formatNumber(row.delta)}
                                              </td>
                                              <td className={tone === "better" ? "kpi-delta-better" : tone === "worse" ? "kpi-delta-worse" : ""}>
                                                {row.deltaPct === null ? "N/A" : `${row.deltaPct.toFixed(2)}%`}
                                              </td>
                                              <td>{formatNumber(primary)}</td>
                                              <td>
                                                {toneLabel ? (
                                                  <span className={`kpi-tone kpi-tone-${tone}`}>{toneLabel}</span>
                                                ) : (
                                                  <span className="kpi-tone-empty">-</span>
                                                )}
                                                {isNa ? <span className="kpi-na-pill">N/A</span> : null}
                                              </td>
                                              <td>{row.unit || "-"}</td>
                                              <td>
                                                <div className="kpi-breakdown-inline">
                                                  {breakdown.map((entry) => (
                                                    <span key={`${row.comparisonKey}:${entry.entity}`}>
                                                      {entry.entity}: {formatNumber(entry.value)}
                                                    </span>
                                                  ))}
                                                  {breakdown.length === 0 ? <span>N/A</span> : null}
                                                </div>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </details>
                              ))}
                            </div>
                          </div>
                        </details>
                        );
                      })
                    )}
                  </section>
                </div>
              ) : (
                <>
                  <section className="kpi-toolbar">
                    <label className="search-inline kpi-search">
                      <input
                        value={kpiSearch}
                        onChange={(event) => setKpiSearch(event.target.value)}
                        placeholder="Search KPI or entity..."
                      />
                    </label>
                    <small>
                      {filteredKpis.length} entries
                      {kpiRows.length > 0 ? ` · ${kpiRows.length} KPI rows from exported_kpis.csv` : ""}
                    </small>
                  </section>

                  {filteredKpis.length === 0 ? (
                    <EmptyState
                      title="No KPIs found"
                      message="No KPI entries match the current search."
                    />
                  ) : (
                    <div className="job-kpi-table-wrap kpi-list-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>KPI</th>
                            <th>Entity</th>
                            <th>Value</th>
                            <th>Unit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredKpis.map((kpi) => (
                            <tr key={kpi.key}>
                              <td>{kpi.label}</td>
                              <td>{kpi.source || "-"}</td>
                              <td>{formatNumber(kpi.value)}</td>
                              <td>{kpi.unit || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          ) : null}

          {activeTab === "deploy" ? (
            <section className="panel">
              <h2>Deploy</h2>
              <p className="jobs-meta">
                Deployment bundle view: manifest on community scope and ONNX model per building scope.
              </p>

              {!isCompleted ? (
                <EmptyState
                  title="Deploy artifacts available after completion"
                  message="This job is still running or queued."
                />
              ) : simulationIndexQuery.isLoading || deployManifestQuery.isLoading ? (
                <section className="datasets-loader-preview">
                  <EVChargingLoader label="Loading deployment bundle..." />
                </section>
              ) : deployBuildingScopes.length > 0 || Boolean(deployManifestQuery.data) ? (
                <div className="deploy-layout">
                  <TimeseriesTree
                    root={deployTreeRoot}
                    communityLabel={communityLabel}
                    helpText="Select Community to inspect manifest. Select a Building to access its ONNX model."
                    isCommunityActive={selectedDeployScopeId === "community"}
                    selectedId={selectedDeployScopeId === "community" ? "__community__" : selectedDeployScopeId}
                    selectedBuildingIds={
                      selectedDeployScopeId === "community" ? new Set<string>() : new Set<string>([selectedDeployScopeId])
                    }
                    selectedAssetIds={new Set()}
                    expanded={new Set()}
                    onSelectCommunity={() => setSelectedDeployScopeId("community")}
                    onSelect={(id) => setSelectedDeployScopeId(id)}
                    onToggle={() => {}}
                  />

                  <section className="deploy-main">
                    {deployActionError ? <p className="error-text">{deployActionError}</p> : null}

                    {selectedDeployScopeId === "community" ? (
                      deployManifestQuery.data ? (
                        <article className="deploy-manifest-card panel">
                          <header className="deploy-card-header">
                            <div>
                              <h3>Artifact Manifest</h3>
                              <small>{deployManifestQuery.data.relativePath}</small>
                            </div>
                            <div className="deploy-card-actions">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setDeployManifestPreviewOpen(true)}
                                iconLeft={<Eye size={14} />}
                              >
                                View
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  void downloadDeployManifest();
                                }}
                                disabled={deployDownloadBusyKey === "manifest"}
                                iconLeft={<Download size={14} />}
                              >
                                {deployDownloadBusyKey === "manifest" ? "Downloading..." : "Download"}
                              </Button>
                            </div>
                          </header>

                          <div className="deploy-summary-grid">
                            <article className="deploy-summary-item">
                              <small>Generated at</small>
                              <strong>{deployManifestSummary.generatedAt}</strong>
                            </article>
                            <article className="deploy-summary-item">
                              <small>Run name</small>
                              <strong>{deployManifestSummary.runName}</strong>
                            </article>
                            <article className="deploy-summary-item">
                              <small>Algorithm</small>
                              <strong>{deployManifestSummary.algorithmName}</strong>
                            </article>
                            <article className="deploy-summary-item">
                              <small>Agent format</small>
                              <strong>{deployManifestSummary.agentFormat}</strong>
                            </article>
                            <article className="deploy-summary-item">
                              <small>ONNX models</small>
                              <strong>{deployManifestSummary.modelCount}</strong>
                            </article>
                            <article className="deploy-summary-item">
                              <small>Source</small>
                              <strong>{deployManifestQuery.data.source}</strong>
                            </article>
                          </div>
                        </article>
                      ) : (
                        <EmptyState
                          title="Manifest not found"
                          message="No artifact_manifest.json could be resolved for this job."
                        />
                      )
                    ) : selectedDeployBuildingScope ? (
                      selectedDeployOnnx ? (
                        <article className="deploy-model-card panel">
                          <header className="deploy-card-header">
                            <div>
                              <h3>{selectedDeployBuildingScope.label}</h3>
                              <small>ONNX model assigned to this building</small>
                            </div>
                          </header>

                          <dl className="deploy-model-list">
                            <div>
                              <dt>File</dt>
                              <dd>{selectedDeployOnnx.path.split("/").filter(Boolean).pop() || selectedDeployOnnx.path}</dd>
                            </div>
                            <div>
                              <dt>Bundle path</dt>
                              <dd>
                                <code>{selectedDeployOnnx.path}</code>
                              </dd>
                            </div>
                            <div>
                              <dt>Agent index</dt>
                              <dd>{selectedDeployOnnx.agentIndex !== null ? selectedDeployOnnx.agentIndex : "-"}</dd>
                            </div>
                            <div>
                              <dt>Format</dt>
                              <dd>{selectedDeployOnnx.format || "onnx"}</dd>
                            </div>
                          </dl>

                          <div className="deploy-card-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                void downloadDeployModel(selectedDeployOnnx);
                              }}
                              disabled={deployDownloadBusyKey === `model:${selectedDeployOnnx.path}`}
                              iconLeft={<Download size={14} />}
                            >
                              {deployDownloadBusyKey === `model:${selectedDeployOnnx.path}`
                                ? "Downloading..."
                                : "Download ONNX"}
                            </Button>
                          </div>
                        </article>
                      ) : (
                        <EmptyState
                          title="No ONNX model for this building"
                          message="The bundle manifest did not expose an ONNX artifact for the selected building."
                        />
                      )
                    ) : (
                      <EmptyState
                        title="No building selected"
                        message="Select a building on the left to inspect its ONNX model."
                      />
                    )}
                  </section>
                </div>
              ) : (
                <EmptyState
                  title="No deploy bundle detected"
                  message="No manifest or building-scoped model artifacts were found for this job."
                />
              )}
            </section>
          ) : null}
        </section>
      ) : null}

      <Modal
        title={`Artifact Manifest · ${jobId || "-"}`}
        open={deployManifestPreviewOpen}
        onClose={() => setDeployManifestPreviewOpen(false)}
        width="lg"
      >
        {deployManifestQuery.isLoading ? (
          <section className="datasets-loader-preview">
            <EVChargingLoader label="Loading manifest..." />
          </section>
        ) : deployManifestQuery.data?.content ? (
          <pre className="json-view compact">{deployManifestQuery.data.content}</pre>
        ) : (
          <p className="jobs-meta">No manifest available for this job.</p>
        )}
      </Modal>

      <Modal
        title={`Logs: ${jobId || "-"}`}
        open={overviewLogsOpen}
        onClose={() => setOverviewLogsOpen(false)}
        width="lg"
      >
        <section className="job-logs-modal-content">
          {(overviewLogs.loading || (overviewLogs.fetching && !hasOverviewLogs)) ? (
            <section className="datasets-loader-preview">
              <EVChargingLoader label="Loading logs..." />
            </section>
          ) : null}
          {overviewLogs.error ? <p className="error-text">Could not load logs for this job.</p> : null}
          {!overviewLogs.loading && !overviewLogs.error ? (
            hasOverviewLogs ? (
              <pre className="json-view compact">{overviewLogs.text}</pre>
            ) : (
              <p className="jobs-meta">{overviewLogs.message || "No logs available yet for this job."}</p>
            )
          ) : null}
        </section>
      </Modal>

      <Modal
        title={`${configPreviewMode === "resolved" ? "Resolved Config" : "Experiment Config"} preview: ${configPreviewLabel || "-"}`}
        open={configPreviewOpen}
        onClose={() => {
          setConfigPreviewOpen(false);
          setConfigPreviewTarget("");
          setConfigPreviewLabel("");
          setConfigPreviewMode("base");
          setConfigPreviewJobId("");
        }}
        width="lg"
      >
        {configPreviewQuery.isLoading ? (
          <p className="jobs-meta">
            Loading {configPreviewMode === "resolved" ? "resolved config" : "experiment config"}...
          </p>
        ) : null}
        {configPreviewQuery.isError ? (
          <p className="error-text">
            Could not load this {configPreviewMode === "resolved" ? "resolved config" : "experiment config"} preview.
          </p>
        ) : null}
        {configPreviewQuery.data ? (
          <section className="job-config-preview-modal">
            <pre className="json-view">{configPreviewQuery.data}</pre>
          </section>
        ) : null}
        {!configPreviewQuery.isLoading && !configPreviewQuery.data ? (
          <p className="jobs-meta">
            No {configPreviewMode === "resolved" ? "resolved config" : "experiment config"} data available.
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
