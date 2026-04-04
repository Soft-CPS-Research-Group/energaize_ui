import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
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
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getExperimentConfig,
  getJobFileLogs,
  getJobInfo,
  getJobLogs,
  getJobProgress,
  getJobResolvedConfig,
  getJobResult,
  getJobStatus,
  listExperimentConfigs
} from "../../api/trainingApi";
import { LOGS_POLL_MS } from "../../constants";
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
  SimulationTreeNode
} from "../../types";
import { extractKpis } from "../../utils/jobResult";
import { isCompletedForResults } from "../../utils/jobStatus";
import {
  buildKpiMeta,
  formatKpiFamilyLabel,
  groupScopedKpis,
  isKpiGroupUsed,
  scoreKpiGroupTone,
  type KpiAggregation,
  type KpiFamily,
  type KpiMetricGroupRow,
  type KpiVariant
} from "../../utils/kpiMetadata";
import { resolveMlflowRunUrl } from "../../utils/mlflow";
import {
  buildSimulationTree,
  extractKpisFromSimulationData,
  filterFileRefsByEpisode,
  flattenTreeNodes,
  latestEpisode,
  listEpisodes,
  loadSimulationCsv
} from "../../utils/simulationData";
import { formatDateTime, formatDurationSeconds } from "../../utils/time";
import { DayPicker } from "react-day-picker";

const DETAIL_TABS = ["overview", "timeseries", "kpis", "deploy"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

type TimePreset = "all" | "1h" | "6h" | "24h" | "7d" | "30d";
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
}

interface ChartRow {
  x: string;
  epochMs: number | null;
  [key: string]: number | string | null;
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
  value: number;
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

const CORE_CITYLEARN_KEYS = [
  "cost_total",
  "carbon_emissions_total",
  "electricity_consumption_total",
  "daily_peak_average",
  "ramping_average",
  "daily_one_minus_load_factor_average"
] as const;

const KPI_VARIANT_LABELS: Record<KpiVariant, string> = {
  normalized: "Normalized",
  control: "Control",
  baseline: "Baseline",
  delta: "Delta",
  absolute: "Absolute"
};

const KPI_AGGREGATION_LABELS: Record<KpiAggregation, string> = {
  total: "Total",
  daily_average: "Daily Average",
  instant: "Instant",
  ratio: "Ratio / Percent"
};

const CORE_HIGHLIGHT_LABELS: Record<(typeof CORE_CITYLEARN_KEYS)[number], string> = {
  cost_total: "Cost",
  carbon_emissions_total: "Carbon Emissions",
  electricity_consumption_total: "Grid Electricity",
  daily_peak_average: "Daily Peak",
  ramping_average: "Ramping",
  daily_one_minus_load_factor_average: "Load Factor Penalty"
};

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

function buildChartRows(
  series: SimulationSeries[],
  visibleSeriesIds: string[],
  rangeStart: number | null,
  rangeEnd: number | null
): ChartRow[] {
  const map = new Map<string, ChartRow>();
  const visibleSet = new Set(visibleSeriesIds);

  series.forEach((entry) => {
    if (!visibleSet.has(entry.id)) return;

    entry.points.forEach((point) => {
      const epoch = point.epochMs;
      if (epoch === null) return;
      if (rangeStart !== null && epoch !== null && epoch < rangeStart) return;
      if (rangeEnd !== null && epoch !== null && epoch > rangeEnd) return;

      const rowKey = String(epoch);
      const existing = map.get(rowKey) || {
        x: point.timestamp,
        epochMs: epoch
      };
      existing[entry.id] = point.value;
      map.set(rowKey, existing);
    });
  });

  return Array.from(map.values()).sort((a, b) => {
    const left = typeof a.epochMs === "number" ? a.epochMs : 0;
    const right = typeof b.epochMs === "number" ? b.epochMs : 0;
    return left - right;
  });
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

function resolveTickStepMs(preset: TimePreset, rangeStart: number | null, rangeEnd: number | null): number {
  if (preset === "7d" || preset === "30d") return DAY_MS;
  if (preset === "24h" || preset === "6h" || preset === "1h") return HOUR_MS;
  if (rangeStart === null || rangeEnd === null) return HOUR_MS;
  const span = rangeEnd - rangeStart;
  if (span <= 2 * DAY_MS) return HOUR_MS;
  if (span <= 7 * DAY_MS) return 6 * HOUR_MS;
  return DAY_MS;
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
          <span>{communityLabel}</span>
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
  visibleSeriesIds,
  onToggleSeries,
  rangeStart,
  rangeEnd,
  xTicks,
  xTickStepMs,
  onZoomCommit,
  onZoomReset,
  isPrimary,
  isWide
}: {
  title: string;
  series: SimulationSeries[];
  visibleSeriesIds: string[];
  onToggleSeries: (seriesId: string) => void;
  rangeStart: number | null;
  rangeEnd: number | null;
  xTicks: number[];
  xTickStepMs: number;
  onZoomCommit: (fromEpoch: number, toEpoch: number) => void;
  onZoomReset: () => void;
  isPrimary?: boolean;
  isWide?: boolean;
}): JSX.Element {
  const rows = useMemo(
    () => buildChartRows(series, visibleSeriesIds, rangeStart, rangeEnd),
    [rangeEnd, rangeStart, series, visibleSeriesIds]
  );
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
      series.map((entry, index) => [entry.id, CHART_COLORS[index % CHART_COLORS.length]])
    );
  }, [series]);

  const visibleSeries = series.filter((entry) => visibleSeriesIds.includes(entry.id));
  const unitOrder = useMemo(() => {
    return Array.from(new Set(series.map((entry) => entry.unit || "value")));
  }, [series]);
  const primaryUnit = unitOrder[0] || "value";
  const secondaryUnit = unitOrder[1] || null;

  const axisIdForSeries = (entry: SimulationSeries): "left" | "right" => {
    const unit = entry.unit || "value";
    if (secondaryUnit && unit === secondaryUnit) return "right";
    return "left";
  };

  const computeDomain = (axisSeries: SimulationSeries[]): [number, number] | null => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    axisSeries.forEach((entry) => {
      entry.points.forEach((point) => {
        if (!Number.isFinite(point.value)) return;
        min = Math.min(min, point.value);
        max = Math.max(max, point.value);
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
        series.filter(
          (entry) => visibleSeriesIds.includes(entry.id) && axisIdForSeries(entry) === "left"
        )
      ),
    [rangeEnd, rangeStart, secondaryUnit, series, visibleSeriesIds]
  );
  const rightDomain = useMemo(
    () =>
      secondaryUnit
        ? computeDomain(
            series.filter(
              (entry) => visibleSeriesIds.includes(entry.id) && axisIdForSeries(entry) === "right"
            )
          )
        : null,
    [rangeEnd, rangeStart, secondaryUnit, series, visibleSeriesIds]
  );
  const leftTicks = useMemo(() => buildYAxisTicks(leftDomain), [leftDomain]);
  const rightTicks = useMemo(() => buildYAxisTicks(rightDomain), [rightDomain]);
  const xDomainPaddingMs = Math.max(5 * 60_000, Math.min(60 * 60_000, Math.round(xTickStepMs * 0.12)));
  const xDomain =
    rangeStart !== null && rangeEnd !== null
      ? [rangeStart - xDomainPaddingMs, rangeEnd + xDomainPaddingMs]
      : (["dataMin", "dataMax"] as const);
  const firstTickEpoch = xTicks.length > 0 ? xTicks[0] : undefined;
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
        {series.map((entry, index) => {
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

      {rows.length === 0 || visibleSeries.length === 0 ? (
        <EmptyState title="No chart data" message="Adjust time window or selected metrics." />
      ) : (
        <div className="sim-chart-canvas" ref={canvasRef}>
          {zoomOverlayStyle ? <div className="sim-zoom-overlay" style={zoomOverlayStyle} /> : null}
          <ResponsiveContainer width="100%" height={TIMESERIES_CHART_HEIGHT}>
            <ComposedChart
              data={rows}
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
                domain={leftDomain || ["auto", "auto"]}
                ticks={leftTicks}
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
                domain={secondaryUnit ? rightDomain || ["auto", "auto"] : [0, 1]}
                ticks={secondaryUnit ? rightTicks : []}
              />
              <Tooltip
                labelFormatter={(label: unknown) =>
                  typeof label === "number"
                    ? new Date(label).toLocaleString([], {
                        year: "numeric",
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false
                      })
                    : String(label ?? "")
                }
                formatter={(value: unknown, name: unknown) => {
                  const key = typeof name === "string" ? name : String(name || "");
                  const matched = visibleSeries.find((item) => item.id === key);
                  const numeric = typeof value === "number" ? value : Number(value);
                  return [formatNumber(Number.isFinite(numeric) ? numeric : null), matched?.metric || key];
                }}
                contentStyle={{
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  background: "var(--bg-elev)",
                  fontSize: 12
                }}
              />
              {visibleSeries.map((entry, index) => (
                isPriceSeries(entry) ? (
                  <Line
                    key={entry.id}
                    type="monotone"
                    dataKey={entry.id}
                    yAxisId={axisIdForSeries(entry)}
                    stroke={colorBySeriesId.get(entry.id) || CHART_COLORS[index % CHART_COLORS.length]}
                    strokeWidth={2.2}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                ) : (
                  <Bar
                    key={entry.id}
                    dataKey={entry.id}
                    yAxisId={axisIdForSeries(entry)}
                    barSize={10}
                    stroke={colorBySeriesId.get(entry.id) || CHART_COLORS[index % CHART_COLORS.length]}
                    strokeWidth={0.5}
                    fill={colorBySeriesId.get(entry.id) || CHART_COLORS[index % CHART_COLORS.length]}
                    fillOpacity={0.75}
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                )
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
  const [kpiVariantFilter, setKpiVariantFilter] = useState<KpiVariant | "all">("all");
  const [kpiAggregationFilter, setKpiAggregationFilter] = useState<KpiAggregation | "all">("all");
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

  const overviewLogsQuery = useQuery({
    queryKey: ["job-detail-overview-logs", jobId],
    queryFn: async () => {
      try {
        return await getJobFileLogs(jobId);
      } catch {
        return getJobLogs(jobId).catch(() => "");
      }
    },
    enabled: Boolean(overviewLogsOpen && jobId),
    refetchInterval: overviewLogsOpen ? LOGS_POLL_MS : false
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
          const isCommunityCsv = /exported_data_community_ep\d+\.csv$/i.test(fileRef);
          const series = isCommunityCsv ? parsed.slice(0, 8) : parsed.slice(0, 6);
          return {
            fileRef,
            title: resolveFileTitle(fileRef),
            series
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

    const buildingOrder = new Map<number, number>();
    treeNodes.forEach((node, index) => {
      if (node.kind !== "building") return;
      const match = node.label.match(/(\d+)/);
      const buildingId = match ? Number(match[1]) : Number.NaN;
      if (Number.isFinite(buildingId) && !buildingOrder.has(buildingId)) {
        buildingOrder.set(buildingId, index);
      }
    });

    const communityEntities: string[] = [];
    const buildingEntities = new Map<number, string[]>();
    const otherEntities: string[] = [];

    Array.from(entities)
      .sort((a, b) => a.localeCompare(b))
      .forEach((entity) => {
        if (isCommunityEntity(entity)) {
          communityEntities.push(entity);
          return;
        }
        const buildingId = parseBuildingEntityId(entity);
        if (buildingId !== null) {
          const group = buildingEntities.get(buildingId) || [];
          group.push(entity);
          buildingEntities.set(buildingId, group);
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

    Array.from(buildingEntities.entries())
      .sort((left, right) => {
        const leftOrder = buildingOrder.get(left[0]) ?? left[0];
        const rightOrder = buildingOrder.get(right[0]) ?? right[0];
        return leftOrder - rightOrder;
      })
      .forEach(([buildingId, entityKeys]) => {
        scopes.push({
          id: `building:${buildingId}`,
          label: `Building ${buildingId}`,
          group: "building",
          entityKeys
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

        if (breakdown.length === 0) return acc;

        const representative =
          breakdown.length === 1
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
  const usedKpiGroupRows = useMemo(
    () => groupedKpiRows.filter((row) => isKpiGroupUsed(row)),
    [groupedKpiRows]
  );

  const kpiFamilyOptions = useMemo(
    () =>
      Array.from(new Set(usedKpiGroupRows.map((row) => row.family))).sort((a, b) =>
        formatKpiFamilyLabel(a).localeCompare(formatKpiFamilyLabel(b))
      ),
    [usedKpiGroupRows]
  );

  const kpiVariantOptions = useMemo(
    () =>
      (["normalized", "control", "baseline", "delta", "absolute"] as KpiVariant[]).filter((variant) =>
        usedKpiGroupRows.some((row) => row[variant] !== null)
      ),
    [usedKpiGroupRows]
  );

  const kpiAggregationOptions = useMemo(
    () =>
      (["ratio", "daily_average", "total", "instant"] as KpiAggregation[]).filter((aggregation) =>
        usedKpiGroupRows.some((row) => row.aggregation === aggregation)
      ),
    [usedKpiGroupRows]
  );

  useEffect(() => {
    if (kpiFamilyFilter !== "all" && !kpiFamilyOptions.includes(kpiFamilyFilter)) {
      setKpiFamilyFilter("all");
    }
  }, [kpiFamilyFilter, kpiFamilyOptions]);

  useEffect(() => {
    if (kpiVariantFilter !== "all" && !kpiVariantOptions.includes(kpiVariantFilter)) {
      setKpiVariantFilter("all");
    }
  }, [kpiVariantFilter, kpiVariantOptions]);

  useEffect(() => {
    if (kpiAggregationFilter !== "all" && !kpiAggregationOptions.includes(kpiAggregationFilter)) {
      setKpiAggregationFilter("all");
    }
  }, [kpiAggregationFilter, kpiAggregationOptions]);

  const filteredKpiGroupRows = useMemo(() => {
    const query = kpiSearch.trim().toLowerCase();
    return usedKpiGroupRows.filter((row) => {
      if (kpiFamilyFilter !== "all" && row.family !== kpiFamilyFilter) return false;
      if (kpiAggregationFilter !== "all" && row.aggregation !== kpiAggregationFilter) return false;
      if (kpiVariantFilter !== "all" && row[kpiVariantFilter] === null) return false;
      if (!query) return true;
      return `${row.label} ${row.comparisonKey} ${row.sourceKeys.join(" ")}`.toLowerCase().includes(query);
    });
  }, [usedKpiGroupRows, kpiSearch, kpiFamilyFilter, kpiAggregationFilter, kpiVariantFilter]);

  const coreHighlightRows = useMemo(() => {
    return CORE_CITYLEARN_KEYS.map((key) => {
      const row = usedKpiGroupRows.find(
        (candidate) => candidate.sourceKeys.includes(key) || candidate.comparisonKey === key
      );
      const fallbackMeta = buildKpiMeta(key);
      return {
        key,
        title: CORE_HIGHLIGHT_LABELS[key],
        comparisonKey: row?.comparisonKey || null,
        value:
          row?.normalized ??
          row?.absolute ??
          row?.control ??
          row?.baseline ??
          null,
        tone: row ? scoreKpiGroupTone(row) : "unknown",
        tooltip: row?.tooltip || fallbackMeta.tooltip
      };
    });
  }, [usedKpiGroupRows]);

  const deltaBoardRows = useMemo<KpiMetricGroupRow[]>(() => {
    const query = kpiSearch.trim().toLowerCase();
    const candidates = usedKpiGroupRows.filter((row) => {
      if (row.delta === null) return false;
      if (kpiFamilyFilter !== "all" && row.family !== kpiFamilyFilter) return false;
      if (kpiAggregationFilter !== "all" && row.aggregation !== kpiAggregationFilter) return false;
      if (!query) return true;
      return `${row.label} ${row.comparisonKey}`.toLowerCase().includes(query);
    });

    const byMetric = new Map<string, KpiMetricGroupRow>();
    const scoreAggregation = (value: KpiAggregation): number => {
      if (value === "daily_average") return 2;
      if (value === "total") return 1;
      return 0;
    };

    candidates.forEach((row) => {
      const existing = byMetric.get(row.boardMetricKey);
      if (!existing) {
        byMetric.set(row.boardMetricKey, row);
        return;
      }
      if (scoreAggregation(row.aggregation) > scoreAggregation(existing.aggregation)) {
        byMetric.set(row.boardMetricKey, row);
      }
    });

    return Array.from(byMetric.values()).sort(
      (left, right) => Math.abs(right.delta || 0) - Math.abs(left.delta || 0)
    );
  }, [usedKpiGroupRows, kpiSearch, kpiFamilyFilter, kpiAggregationFilter]);

  const deltaBoardMaxAbs = useMemo(() => {
    if (deltaBoardRows.length === 0) return 1;
    const maxValue = Math.max(...deltaBoardRows.map((row) => Math.abs(row.delta || 0)));
    return maxValue > 0 ? maxValue : 1;
  }, [deltaBoardRows]);

  const detailedTableRows = useMemo(() => {
    const highlightedComparisonKeys = new Set(
      coreHighlightRows
        .map((row) => row.comparisonKey)
        .filter((value): value is string => Boolean(value))
    );
    const highlightedSourceKeys = new Set<string>(CORE_CITYLEARN_KEYS);
    const inDeltaBoardComparisonKeys = new Set(deltaBoardRows.map((row) => row.comparisonKey));
    const inDeltaBoardMetricKeys = new Set(deltaBoardRows.map((row) => row.boardMetricKey));
    return filteredKpiGroupRows.filter((row) => {
      const isCoreHighlight =
        highlightedComparisonKeys.has(row.comparisonKey) ||
        row.sourceKeys.some((key) => highlightedSourceKeys.has(key));
      const isCoveredByDeltaBoard =
        inDeltaBoardComparisonKeys.has(row.comparisonKey) ||
        inDeltaBoardMetricKeys.has(row.boardMetricKey);
      return !isCoreHighlight && !isCoveredByDeltaBoard;
    });
  }, [coreHighlightRows, deltaBoardRows, filteredKpiGroupRows]);

  const filteredKpis = useMemo(() => {
    const query = kpiSearch.trim().toLowerCase();
    if (!query) return displayKpis;
    return displayKpis.filter((kpi) => {
      const source = kpi.source || "";
      return `${kpi.label} ${source}`.toLowerCase().includes(query);
    });
  }, [displayKpis, kpiSearch]);

  const timeseriesBundles = useMemo(() => timeseriesQuery.data || [], [timeseriesQuery.data]);

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
  const axisTickStepMs = resolveTickStepMs(timePreset, chartRangeStart, chartRangeEnd);
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

  const hasOverviewLogs = (overviewLogsQuery.data || "").trim().length > 0;

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
                              if (maxEpoch !== null && minEpoch !== null) {
                                const duration = preset === "all" ? null : TIME_PRESET_MS[preset];
                                const baseStart =
                                  customRangeStart ?? presetRangeStart ?? alignPresetWindowStart(minEpoch, timePreset);
                                if (duration === null) {
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
                                  setWindowStartMs(nextStart);
                                  setCustomFrom(toDateTimeLocal(nextStart));
                                  setCustomTo(toDateTimeLocal(nextEnd));
                                }
                              }
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
                              visibleSeriesIds={visibleSeries[bundle.fileRef] || []}
                              onToggleSeries={(seriesId) => toggleChartSeries(bundle.fileRef, seriesId)}
                              rangeStart={chartRangeStart}
                              rangeEnd={chartRangeEnd}
                              xTicks={axisTicks}
                              xTickStepMs={axisTickStepMs}
                              onZoomCommit={handleZoomCommit}
                              onZoomReset={resetZoomRange}
                              isPrimary={isCommunityMode && index === 0}
                              isWide={
                                !isBuildingCompareMode &&
                                (isCommunityMode
                                  ? index === 1
                                  : /exported_data_(building_\d+|electric_vehicle_\d+)_ep\d+\.csv$/i.test(
                                      bundle.fileRef
                                    ))
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
                    <section className="kpi-toolbar">
                      <div className="kpi-filter-row">
                        <label className="kpi-filter">
                          <span>Family</span>
                          <select
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
                        <label className="kpi-filter">
                          <span>Variant</span>
                          <select
                            value={kpiVariantFilter}
                            onChange={(event) => setKpiVariantFilter(event.target.value as KpiVariant | "all")}
                          >
                            <option value="all">All variants</option>
                            {kpiVariantOptions.map((option) => (
                              <option key={option} value={option}>
                                {KPI_VARIANT_LABELS[option]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="kpi-filter">
                          <span>Aggregation</span>
                          <select
                            value={kpiAggregationFilter}
                            onChange={(event) =>
                              setKpiAggregationFilter(event.target.value as KpiAggregation | "all")
                            }
                          >
                            <option value="all">All aggregations</option>
                            {kpiAggregationOptions.map((option) => (
                              <option key={option} value={option}>
                                {KPI_AGGREGATION_LABELS[option]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label className="search-inline kpi-search">
                        <input
                          value={kpiSearch}
                          onChange={(event) => setKpiSearch(event.target.value)}
                          placeholder="Search KPI..."
                        />
                      </label>
                      <small>
                        {usedKpiGroupRows.length} used KPI group(s) · {detailedTableRows.length} in detail table · scope:{" "}
                        {selectedKpiScope?.label || "-"}
                      </small>
                    </section>

                    <section className="kpi-core-highlights panel">
                      <header className="kpi-section-header">
                        <h3>Core CityLearn Highlights</h3>
                        <small>District-first quick read. 1.0 is baseline parity for normalized KPIs.</small>
                      </header>
                      <div className="kpi-highlight-grid">
                        {coreHighlightRows.map((item) => (
                          <article key={item.key} className={`kpi-highlight-card tone-${item.tone}`}>
                            <header>
                              <small>{item.title}</small>
                              <button type="button" className="kpi-help" aria-label={`${item.title} details`}>
                                <Info size={13} />
                                <span role="tooltip" className="kpi-help-tooltip">
                                  <strong>{item.tooltip.shortDescription}</strong>
                                  <small>{item.tooltip.formulaShort}</small>
                                </span>
                              </button>
                            </header>
                            <strong>{formatNumber(item.value)}</strong>
                            <span className={`kpi-tone kpi-tone-${item.tone}`}>
                              {item.tone === "better"
                                ? "Better"
                                : item.tone === "worse"
                                  ? "Worse"
                                  : item.tone === "neutral"
                                    ? "Neutral"
                                    : "Unknown"}
                            </span>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="kpi-delta-board panel">
                      <header className="kpi-section-header">
                        <h3>Family Delta Board</h3>
                        <small>Primary view: Δ = control - baseline (daily preferred, total fallback).</small>
                      </header>
                      {deltaBoardRows.length === 0 ? (
                        <EmptyState
                          title="No delta KPIs in this filter"
                          message="Adjust family/aggregation filters or choose another scope."
                        />
                      ) : (
                        <div className="kpi-delta-list">
                          {deltaBoardRows.map((row) => {
                            const tone = scoreKpiGroupTone(row);
                            const magnitude = Math.max(
                              4,
                              Math.min(100, (Math.abs(row.delta || 0) / deltaBoardMaxAbs) * 100)
                            );
                            return (
                              <article key={`delta:${row.comparisonKey}`} className="kpi-delta-row">
                                <header>
                                  <div className="kpi-delta-title">
                                    <strong>{row.label}</strong>
                                    <button type="button" className="kpi-help" aria-label={`${row.label} details`}>
                                      <Info size={13} />
                                      <span role="tooltip" className="kpi-help-tooltip">
                                        <strong>{row.tooltip.shortDescription}</strong>
                                        <small>{row.tooltip.formulaShort}</small>
                                      </span>
                                    </button>
                                  </div>
                                  <span className={`kpi-tone kpi-tone-${tone}`}>
                                    {row.delta === null ? "-" : formatNumber(row.delta)}
                                    {row.deltaPct === null ? "" : ` (${row.deltaPct.toFixed(2)}%)`}
                                  </span>
                                </header>
                                <div className="kpi-delta-track">
                                  <span className="kpi-delta-midline" />
                                  <span
                                    className={`kpi-delta-fill ${
                                      (row.delta || 0) >= 0 ? "is-positive" : "is-negative"
                                    }`}
                                    style={{ width: `${magnitude}%` }}
                                  />
                                </div>
                                <footer>
                                  <small>Baseline: {formatNumber(row.baseline)}</small>
                                  <small>Control: {formatNumber(row.control)}</small>
                                  <small>{row.unit || "-"}</small>
                                </footer>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    {detailedTableRows.length === 0 ? (
                      <EmptyState
                        title="No extra KPIs to detail"
                        message="All active KPI groups in this filter are already shown in highlights/delta board."
                      />
                    ) : (
                      <div className="job-kpi-table-wrap kpi-list-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>KPI</th>
                              <th>Delta</th>
                              <th>Delta %</th>
                              <th>Control</th>
                              <th>Baseline</th>
                              <th>Unit</th>
                              <th>Entity breakdown</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailedTableRows.map((row) => {
                              const tone = scoreKpiGroupTone(row);
                              const breakdown =
                                row.breakdown.delta.length > 0
                                  ? row.breakdown.delta
                                  : row.breakdown.control.length > 0
                                    ? row.breakdown.control
                                    : row.breakdown.baseline.length > 0
                                      ? row.breakdown.baseline
                                      : row.breakdown.normalized.length > 0
                                        ? row.breakdown.normalized
                                        : row.breakdown.absolute;
                              return (
                                <tr key={`row:${row.comparisonKey}`}>
                                  <td>
                                    <div className="kpi-row-label">
                                      <span>{row.label}</span>
                                      <button type="button" className="kpi-help" aria-label={`${row.label} details`}>
                                        <Info size={12} />
                                        <span role="tooltip" className="kpi-help-tooltip">
                                          <strong>{row.tooltip.shortDescription}</strong>
                                          <small>{row.tooltip.formulaShort}</small>
                                        </span>
                                      </button>
                                    </div>
                                  </td>
                                  <td className={tone === "better" ? "kpi-delta-better" : tone === "worse" ? "kpi-delta-worse" : ""}>
                                    {formatNumber(row.delta)}
                                  </td>
                                  <td className={tone === "better" ? "kpi-delta-better" : tone === "worse" ? "kpi-delta-worse" : ""}>
                                    {row.deltaPct === null ? "-" : `${row.deltaPct.toFixed(2)}%`}
                                  </td>
                                  <td>{formatNumber(row.control)}</td>
                                  <td>{formatNumber(row.baseline)}</td>
                                  <td>{row.unit || "-"}</td>
                                  <td>
                                    <div className="kpi-breakdown-inline">
                                      {breakdown.map((entry) => (
                                        <span key={`${row.comparisonKey}:${entry.entity}`}>
                                          {entry.entity}: {formatNumber(entry.value)}
                                        </span>
                                      ))}
                                      {breakdown.length === 0 ? <span>-</span> : null}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
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
          {(overviewLogsQuery.isLoading || (overviewLogsQuery.isFetching && !hasOverviewLogs)) ? (
            <section className="datasets-loader-preview">
              <EVChargingLoader label="Loading logs..." />
            </section>
          ) : null}
          {overviewLogsQuery.isError ? <p className="error-text">Could not load logs for this job.</p> : null}
          {!overviewLogsQuery.isLoading && !overviewLogsQuery.isError ? (
            hasOverviewLogs ? (
              <pre className="json-view compact">{overviewLogsQuery.data}</pre>
            ) : (
              <p className="jobs-meta">No logs available yet for this job.</p>
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
