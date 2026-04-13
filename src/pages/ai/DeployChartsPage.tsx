import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BatteryCharging,
  CalendarDays,
  Car,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FolderTree,
  Gauge,
  Home,
  Info,
  Leaf,
  RefreshCcw,
  Zap
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { DayPicker } from "react-day-picker";
import { useNavigate, useParams } from "react-router-dom";
import {
  getDeployLogsHistoryChunk,
  listDeployInferences,
  type DeployLogsHistoryChunkResponse,
  type DeployLogsHistoryLine
} from "../../api/deployApi";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";
import { useApiFeedback } from "../../hooks/useApiFeedback";
import type { SimulationSeries } from "../../types";
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
import {
  buildDeployAssetTree,
  buildDeployChartSeries,
  computeAvailabilityPercent,
  computeNoDataIntervals,
  parseDeployLogSamples,
  resolveDeploySiteLabel,
  resolveDeploySiteProfile,
  type AvailabilityInterval,
  type DeployAssetKind,
  type DeployAssetTreeNode,
  type DeployChartSeries
} from "../../utils/deployLogCharts";

const TARGETS_POLL_MS = 15000;
const LIVE_POLL_MS = 15000;
const LIVE_WINDOW_MS = 10 * 60 * 1000;
const LIVE_LIMIT_LINES = 2000;
const HISTORY_LIMIT_LINES = 2000;
const HISTORY_LAZY_MAX_PAGES = 160;
const HISTORY_SLICE_MAX_REQUESTS = 260;
const HISTORY_DEFAULT_HOURS = 6;
const CHART_HEIGHT = 300;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CHART_COLORS = ["#1db97f", "#4f8cff", "#f4a340", "#ea5a5a", "#9e7bff", "#00bcd4", "#f87171"];
const ISO_WITHOUT_TZ_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?$/;
const ISO_HAS_TZ_RE = /(Z|[+\-]\d{2}:?\d{2})$/i;

type DeployChartsMode = "live" | "history";
type DeployHistoryQuickRange = "30m" | "1h" | "6h" | "24h" | "custom";
type DeployHistoryDateField = "since" | "until";

type AppliedChartsFilter = {
  quickRange: DeployHistoryQuickRange;
  sinceInput: string;
  untilInput: string;
  sinceTs: string;
  untilTs: string;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateTimeLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function parseDateTimeLocalInput(value: string): Date | null {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
}

function parseDateTimeLocal(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  let normalized = String(value).trim().replace(" ", "T");
  normalized = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d+)/, "$1.$2");
  if (!ISO_HAS_TZ_RE.test(normalized) && ISO_WITHOUT_TZ_RE.test(normalized)) {
    normalized = `${normalized}Z`;
  }
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatRangeSummary(sinceInput: string, untilInput: string): string {
  const since = parseDateTimeLocalInput(sinceInput);
  const until = parseDateTimeLocalInput(untilInput);
  if (!since || !until) return "Select window";

  const start = since.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const end = until.toLocaleString([], {
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
  if (!value) return null;

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
  if (!compactMatch) return null;
  const digits = compactMatch[1].padStart(4, "0");
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4));
  if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
    return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  }
  return null;
}

function offsetTimeValue(time: string, minutesDelta: number): string {
  const parsed = parseTimeInput(time) || "00:00";
  const [hoursPart, minutesPart] = parsed.split(":");
  const initialMinutes = Number(hoursPart) * 60 + Number(minutesPart);
  const next = ((initialMinutes + minutesDelta) % (24 * 60) + 24 * 60) % (24 * 60);
  const hours = Math.floor(next / 60);
  const minutes = next % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function extractTimePart(local: string, fallback = "00:00"): string {
  const parsed = parseDateTimeLocalInput(local);
  if (!parsed) return fallback;
  return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function applyDateAndTime(date: Date, time: string): string {
  const [hoursPart, minutesPart] = time.split(":");
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  const next = new Date(date);
  next.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return toDateTimeLocalInput(next);
}

function formatPickerDay(date: Date): string {
  return date.toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 10) return value.toFixed(2);
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

function formatAxisTick(epoch: number, stepMs: number, firstTickEpoch?: number): string {
  const date = new Date(epoch);
  if (stepMs >= DAY_MS) {
    return date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  }

  const withSeconds = stepMs < 60 * 1000;
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false
  });
  const isDayStart = date.getHours() === 0 && date.getMinutes() === 0 && (!withSeconds || date.getSeconds() === 0);
  const isFirstTick = typeof firstTickEpoch === "number" && epoch === firstTickEpoch;
  if (isDayStart || isFirstTick) {
    const day = date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
    return `${day} ${time}`;
  }
  return time;
}

function alignToBoundary(epochMs: number, stepMs: number): number {
  if (stepMs < 60 * 1000) {
    return Math.floor(epochMs / stepMs) * stepMs;
  }

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

function buildAxisTicks(startEpoch: number | null, endEpoch: number | null, stepMs: number): number[] {
  if (startEpoch === null || endEpoch === null || endEpoch <= startEpoch) return [];
  const ticks: number[] = [];
  let cursor = alignToBoundary(startEpoch, stepMs);
  if (cursor < startEpoch) cursor += stepMs;

  while (cursor <= endEpoch) {
    ticks.push(cursor);
    cursor += stepMs;
  }

  const edgeThreshold = Math.max(1, Math.floor(stepMs * 0.55));
  if (ticks.length === 0 || Math.abs(ticks[0] - startEpoch) > edgeThreshold) {
    ticks.unshift(startEpoch);
  }

  const lastTick = ticks[ticks.length - 1] ?? null;
  if (lastTick === null || Math.abs(endEpoch - lastTick) > edgeThreshold) {
    ticks.push(endEpoch);
  }

  return ticks;
}

function applyLineGaps(rows: TimeseriesChartRow[], lineSeriesIds: string[]): TimeseriesChartRow[] {
  if (rows.length === 0 || lineSeriesIds.length === 0) return rows;

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

function isSameHistoryLine(left: DeployLogsHistoryLine, right: DeployLogsHistoryLine): boolean {
  return left.ts === right.ts && left.source === right.source && left.text === right.text;
}

function mergeHistoryLines(base: DeployLogsHistoryLine[], incoming: DeployLogsHistoryLine[]): DeployLogsHistoryLine[] {
  if (base.length === 0) return [...incoming];
  if (incoming.length === 0) return [...base];

  const result = [...base];
  let incomingStart = 0;
  const baseLast = result[result.length - 1];

  while (incomingStart < incoming.length && isSameHistoryLine(baseLast, incoming[incomingStart])) {
    incomingStart += 1;
  }

  return [...result, ...incoming.slice(incomingStart)];
}

function parseLineEpoch(line: DeployLogsHistoryLine): number | null {
  return parseIso(line.ts);
}

function resolveHistorySliceMs(spanMs: number): number {
  if (spanMs <= 1 * HOUR_MS) return 5 * 60 * 1000;
  if (spanMs <= 6 * HOUR_MS) return 10 * 60 * 1000;
  return 30 * 60 * 1000;
}

function inferLogOrder(lines: DeployLogsHistoryLine[]): "asc" | "desc" {
  let firstEpoch: number | null = null;
  let lastEpoch: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const epoch = parseLineEpoch(lines[index]);
    if (epoch !== null) {
      firstEpoch = epoch;
      break;
    }
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const epoch = parseLineEpoch(lines[index]);
    if (epoch !== null) {
      lastEpoch = epoch;
      break;
    }
  }

  if (firstEpoch !== null && lastEpoch !== null) {
    return firstEpoch <= lastEpoch ? "asc" : "desc";
  }

  return "desc";
}

function resolvePresetForGranularity(range: DeployHistoryQuickRange): TimeseriesPreset {
  if (range === "30m") return "1h";
  if (range === "1h") return "1h";
  if (range === "6h") return "6h";
  if (range === "24h") return "24h";
  return "6h";
}

function resolveAssetIcon(kind: DeployAssetKind): JSX.Element {
  if (kind === "charger") return <Gauge size={14} />;
  if (kind === "solar") return <Leaf size={14} />;
  if (kind === "battery") return <BatteryCharging size={14} />;
  if (kind === "ev") return <Car size={14} />;
  if (kind === "grid") return <Zap size={14} />;
  if (kind === "pricing") return <CircleDollarSign size={14} />;
  if (kind === "community") return <Home size={14} />;
  return <FolderTree size={14} />;
}

function formatIntervalDuration(startEpochMs: number, endEpochMs: number): string {
  const durationMs = Math.max(0, endEpochMs - startEpochMs);
  const minutes = Math.round(durationMs / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours}h`;
  return `${hours}h ${rem}m`;
}

function availabilityToneClass(coveragePercent: number): string {
  if (coveragePercent >= 85) return "is-good";
  if (coveragePercent >= 60) return "is-warn";
  return "is-bad";
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
      >
        +15m
      </button>
    </div>
  );
}

interface DeployTreeProps {
  profileLabel: string;
  assets: DeployAssetTreeNode[];
  expandedAssets: Set<string>;
  selectedAssetId: string;
  selectedMetricSeriesId: string | null;
  onToggleAsset: (assetId: string) => void;
  onSelectAsset: (assetId: string) => void;
  onSelectMetric: (assetId: string, seriesId: string) => void;
}

function DeployChartsTree({
  profileLabel,
  assets,
  expandedAssets,
  selectedAssetId,
  selectedMetricSeriesId,
  onToggleAsset,
  onSelectAsset,
  onSelectMetric
}: DeployTreeProps): JSX.Element {
  return (
    <aside className="sim-tree-panel panel deploy-charts-tree">
      <header className="sim-tree-head">
        <div className="sim-tree-headline">
          <small>Installation</small>
          <button type="button" className="sim-tree-help" aria-label="Charts tree help">
            <Info size={14} />
            <span role="tooltip" className="sim-tree-help-tooltip">
              Select an asset family to compare all metrics, or select a single metric for focused view.
            </span>
          </button>
        </div>
        <button type="button" className="sim-tree-context-btn is-active" title={profileLabel}>
          <Home size={14} />
          <span className="sim-tree-context-label">{profileLabel}</span>
        </button>
      </header>

      <ul className="sim-tree-list">
        {assets.map((asset) => {
          const isExpanded = expandedAssets.has(asset.id);
          const isAssetSelected = selectedAssetId === asset.id && !selectedMetricSeriesId;

          return (
            <li key={asset.id}>
              <div className={`sim-tree-row is-group ${isAssetSelected ? "is-selected" : ""}`}>
                <button
                  type="button"
                  className="sim-tree-toggle"
                  onClick={() => onToggleAsset(asset.id)}
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <button
                  type="button"
                  className="sim-tree-label"
                  onClick={() => onSelectAsset(asset.id)}
                  title={asset.label}
                >
                  <span className="sim-tree-icon">{resolveAssetIcon(asset.kind)}</span>
                  <span>{asset.label}</span>
                  <small className={`deploy-tree-count${asset.hasData ? "" : " is-muted"}`}>
                    {asset.metrics.length} metric{asset.metrics.length === 1 ? "" : "s"}
                  </small>
                </button>
              </div>

              {isExpanded ? (
                <ul className="sim-tree-list">
                  {asset.metrics.length === 0 ? (
                    <li>
                      <div className="sim-tree-row">
                        <span className="sim-tree-toggle is-spacer" />
                        <div className="sim-tree-label deploy-tree-empty">No data in this window</div>
                      </div>
                    </li>
                  ) : (
                    asset.metrics.map((metric) => {
                      const isMetricSelected = selectedMetricSeriesId === metric.seriesId;
                      return (
                        <li key={metric.seriesId}>
                          <div className={`sim-tree-row ${isMetricSelected ? "is-selected" : ""}`}>
                            <span className="sim-tree-toggle is-spacer" />
                            <button
                              type="button"
                              className="sim-tree-label"
                              onClick={() => onSelectMetric(asset.id, metric.seriesId)}
                              title={metric.label}
                            >
                              <span>{metric.label}</span>
                              {metric.unit ? <small className="deploy-tree-unit">{metric.unit}</small> : null}
                            </button>
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

interface AvailabilityTimelineProps {
  intervals: AvailabilityInterval[];
  rangeStart: number | null;
  rangeEnd: number | null;
  coveragePercent: number;
}

function AvailabilityTimeline({ intervals, rangeStart, rangeEnd, coveragePercent }: AvailabilityTimelineProps): JSX.Element {
  if (rangeStart === null || rangeEnd === null || rangeEnd <= rangeStart) {
    return (
      <section className="panel deploy-availability-card">
        <header>
          <h3>Availability Timeline</h3>
        </header>
        <p className="jobs-meta">Select a valid window to compute data availability.</p>
      </section>
    );
  }

  const span = rangeEnd - rangeStart;
  const preview = intervals.slice(0, 4);
  const toneClass = availabilityToneClass(coveragePercent);

  return (
    <section className="panel deploy-availability-card">
      <header>
        <h3>Availability Timeline</h3>
        <span className={`deploy-availability-badge ${toneClass}`}>{coveragePercent.toFixed(1)}% coverage</span>
      </header>

      <div className="deploy-availability-track" role="img" aria-label="No-data periods timeline">
        {intervals.map((interval) => {
          const left = ((interval.startEpochMs - rangeStart) / span) * 100;
          const width = ((interval.endEpochMs - interval.startEpochMs) / span) * 100;
          return (
            <span
              key={`${interval.startEpochMs}-${interval.endEpochMs}`}
              className="deploy-availability-gap"
              style={{ left: `${Math.max(0, left)}%`, width: `${Math.min(100, Math.max(0, width))}%` }}
              title={`${new Date(interval.startEpochMs).toLocaleString()} → ${new Date(interval.endEpochMs).toLocaleString()}`}
            />
          );
        })}
      </div>

      {preview.length > 0 ? (
        <ul className="deploy-availability-list">
          {preview.map((interval) => (
            <li key={`${interval.startEpochMs}-${interval.endEpochMs}`}>
              <strong>{formatIntervalDuration(interval.startEpochMs, interval.endEpochMs)}</strong>
              <span>
                {new Date(interval.startEpochMs).toLocaleString([], {
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false
                })}
                {" → "}
                {new Date(interval.endEpochMs).toLocaleString([], {
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false
                })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="jobs-meta">No downtime intervals detected for this window.</p>
      )}
    </section>
  );
}

function resolveModeWindow(filter: AppliedChartsFilter, mode: DeployChartsMode, nowEpochMs: number): { sinceTs: string; untilTs: string } {
  if (mode === "history") {
    return {
      sinceTs: filter.sinceTs,
      untilTs: filter.untilTs
    };
  }

  return {
    sinceTs: new Date(nowEpochMs - LIVE_WINDOW_MS).toISOString(),
    untilTs: new Date(nowEpochMs).toISOString()
  };
}

function parseChunkWindow(
  chunk: DeployLogsHistoryChunkResponse | null,
  fallbackFilter: AppliedChartsFilter,
  mode: DeployChartsMode
): { start: number | null; end: number | null } {
  const now = Date.now();
  const fallback = resolveModeWindow(fallbackFilter, mode, now);
  const sinceCandidate = chunk?.since_ts || fallback.sinceTs;
  const untilCandidate = chunk?.until_ts || fallback.untilTs;

  return {
    start: parseIso(sinceCandidate),
    end: parseIso(untilCandidate)
  };
}

function buildAppliedFilter(input: {
  quickRange: DeployHistoryQuickRange;
  sinceInput: string;
  untilInput: string;
}): AppliedChartsFilter {
  const sinceDate = parseDateTimeLocalInput(input.sinceInput) || new Date(Date.now() - HISTORY_DEFAULT_HOURS * HOUR_MS);
  const untilDate = parseDateTimeLocalInput(input.untilInput) || new Date();
  const sinceTs = sinceDate.toISOString();
  const untilTs = untilDate.toISOString();

  return {
    quickRange: input.quickRange,
    sinceInput: toDateTimeLocalInput(sinceDate),
    untilInput: toDateTimeLocalInput(untilDate),
    sinceTs,
    untilTs
  };
}

export function DeployChartsPage(): JSX.Element {
  const navigate = useNavigate();
  const { targetId = "" } = useParams();
  const { notifyError } = useApiFeedback();
  const notifyErrorRef = useRef(notifyError);
  const liveChunkRef = useRef<DeployLogsHistoryChunkResponse | null>(null);

  useEffect(() => {
    notifyErrorRef.current = notifyError;
  }, [notifyError]);

  const targetsQuery = useQuery({
    queryKey: ["deploy-targets"],
    queryFn: listDeployInferences,
    refetchInterval: TARGETS_POLL_MS,
    staleTime: TARGETS_POLL_MS
  });

  const target = useMemo(
    () => (targetsQuery.data || []).find((item) => item.id === targetId) || null,
    [targetId, targetsQuery.data]
  );

  const siteLabel = useMemo(() => resolveDeploySiteLabel(targetId, target?.name), [target?.name, targetId]);
  const siteProfile = useMemo(() => resolveDeploySiteProfile(targetId, target?.name), [target?.name, targetId]);

  const [mode, setMode] = useState<DeployChartsMode>("live");
  const [quickRange, setQuickRange] = useState<DeployHistoryQuickRange>("6h");
  const [sinceInput, setSinceInput] = useState(() => toDateTimeLocalInput(new Date(Date.now() - HISTORY_DEFAULT_HOURS * HOUR_MS)));
  const [untilInput, setUntilInput] = useState(() => toDateTimeLocalInput(new Date()));
  const [rangePopoverOpen, setRangePopoverOpen] = useState(false);
  const [activeDateField, setActiveDateField] = useState<DeployHistoryDateField | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date | undefined>(undefined);

  const [appliedFilter, setAppliedFilter] = useState<AppliedChartsFilter>(() =>
    buildAppliedFilter({
      quickRange: "6h",
      sinceInput: toDateTimeLocalInput(new Date(Date.now() - HISTORY_DEFAULT_HOURS * HOUR_MS)),
      untilInput: toDateTimeLocalInput(new Date())
    })
  );

  const [historyChunk, setHistoryChunk] = useState<DeployLogsHistoryChunkResponse | null>(null);
  const [liveChunk, setLiveChunk] = useState<DeployLogsHistoryChunkResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);

  useEffect(() => {
    liveChunkRef.current = liveChunk;
  }, [liveChunk]);

  const liveRequestCounter = useRef(0);
  const historyRequestCounter = useRef(0);

  const sinceDate = parseDateTimeLocalInput(sinceInput);
  const untilDate = parseDateTimeLocalInput(untilInput);
  const toolbarRangeSummary = formatRangeSummary(sinceInput, untilInput);

  const activeChunk = mode === "live" ? liveChunk : historyChunk;
  const activeLoading = mode === "live" ? liveLoading : historyLoading;

  const parsedSamples = useMemo(
    () => parseDeployLogSamples(activeChunk?.lines || []),
    [activeChunk?.lines]
  );
  const parsedSeries = useMemo<DeployChartSeries[]>(() => buildDeployChartSeries(parsedSamples), [parsedSamples]);
  const assetsTree = useMemo(
    () => buildDeployAssetTree(siteProfile, parsedSeries),
    [parsedSeries, siteProfile]
  );

  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedMetricSeriesId, setSelectedMetricSeriesId] = useState<string | null>(null);
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set());
  const [hiddenSeriesIds, setHiddenSeriesIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!assetsTree.length) {
      setSelectedAssetId("");
      setSelectedMetricSeriesId(null);
      return;
    }

    setSelectedAssetId((previous) => {
      if (previous && assetsTree.some((asset) => asset.id === previous)) return previous;
      return assetsTree.find((asset) => asset.hasData)?.id || assetsTree[0].id;
    });

    setExpandedAssets((previous) => {
      const next = new Set(previous);
      assetsTree.forEach((asset) => {
        if (asset.hasData && !next.has(asset.id) && next.size === 0) {
          next.add(asset.id);
        }
      });
      return next;
    });
  }, [assetsTree]);

  useEffect(() => {
    if (!selectedMetricSeriesId) return;
    const exists = assetsTree.some((asset) =>
      asset.metrics.some((metric) => metric.seriesId === selectedMetricSeriesId)
    );
    if (!exists) {
      setSelectedMetricSeriesId(null);
    }
  }, [assetsTree, selectedMetricSeriesId]);

  const selectedAsset = useMemo(
    () => assetsTree.find((asset) => asset.id === selectedAssetId) || null,
    [assetsTree, selectedAssetId]
  );

  const baseSeriesIds = useMemo(() => {
    if (!selectedAsset) return [] as string[];
    if (selectedMetricSeriesId) return [selectedMetricSeriesId];
    if (selectedAsset.id === "chargers") return [] as string[];
    return selectedAsset.seriesIds;
  }, [selectedAsset, selectedMetricSeriesId]);

  useEffect(() => {
    setHiddenSeriesIds(new Set());
  }, [baseSeriesIds.join("|")]);

  const visibleSeriesIds = useMemo(
    () => baseSeriesIds.filter((seriesId) => !hiddenSeriesIds.has(seriesId)),
    [baseSeriesIds, hiddenSeriesIds]
  );

  const selectedSeries = useMemo(
    () => parsedSeries.filter((entry) => baseSeriesIds.includes(entry.id)),
    [baseSeriesIds, parsedSeries]
  );
  const visibleSeries = useMemo(
    () => parsedSeries.filter((entry) => visibleSeriesIds.includes(entry.id)),
    [parsedSeries, visibleSeriesIds]
  );

  const { start: rangeStart, end: rangeEnd } = useMemo(
    () => parseChunkWindow(activeChunk, appliedFilter, mode),
    [activeChunk, appliedFilter, mode]
  );

  const liveSeriesBounds = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    selectedSeries.forEach((entry) => {
      entry.points.forEach((point) => {
        if (typeof point.epochMs !== "number" || !Number.isFinite(point.epochMs)) return;
        min = Math.min(min, point.epochMs);
        max = Math.max(max, point.epochMs);
      });
    });

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { start: null as number | null, end: null as number | null };
    }

    return { start: min, end: max };
  }, [selectedSeries]);

  const chartRange = useMemo(() => {
    if (mode !== "live") {
      return { start: rangeStart, end: rangeEnd };
    }

    if (liveSeriesBounds.start !== null && liveSeriesBounds.end !== null) {
      const minSpanEnd = Math.max(liveSeriesBounds.end, liveSeriesBounds.start + 15 * 1000);
      const liveStart = Math.max(liveSeriesBounds.start, liveSeriesBounds.end - LIVE_WINDOW_MS);
      return {
        start: liveStart,
        end: minSpanEnd
      };
    }

    return { start: rangeStart, end: rangeEnd };
  }, [liveSeriesBounds.end, liveSeriesBounds.start, mode, rangeEnd, rangeStart]);

  const chartRangeStart = chartRange.start;
  const chartRangeEnd = chartRange.end;

  const sourceResolutionMs = useMemo(() => inferSeriesResolutionMs(selectedSeries as SimulationSeries[]), [selectedSeries]);
  const minimumGranularityMs = useMemo(
    () =>
      resolveMinimumGranularityMs({
        timePreset: mode === "live" ? "1h" : resolvePresetForGranularity(appliedFilter.quickRange),
        useCustomRange: mode === "live" ? true : appliedFilter.quickRange === "custom",
        rangeStart: chartRangeStart,
        rangeEnd: chartRangeEnd,
        sourceResolutionMs
      }),
    [appliedFilter.quickRange, chartRangeEnd, chartRangeStart, mode, sourceResolutionMs]
  );

  const [selectedGranularityMs, setSelectedGranularityMs] = useState<GranularityMs>(15 * 1000);

  useEffect(() => {
    setSelectedGranularityMs((previous) => (previous < minimumGranularityMs ? minimumGranularityMs : previous));
  }, [minimumGranularityMs]);

  const granularityOptions = useMemo(
    () => {
      const options = resolveAvailableGranularityOptions(minimumGranularityMs);
      if (mode !== "live") return options;
      const liveOnly = options.filter((option) => option.ms === 15 * 1000 || option.ms === 60 * 1000);
      return liveOnly.length > 0 ? liveOnly : options;
    },
    [minimumGranularityMs, mode]
  );

  useEffect(() => {
    if (mode !== "live") return;
    const allowed = granularityOptions.filter((entry) => entry.enabled);
    if (allowed.some((entry) => entry.ms === selectedGranularityMs)) return;
    const fallback = allowed.find((entry) => entry.ms === 15 * 1000) || allowed[0];
    if (fallback) {
      setSelectedGranularityMs(fallback.ms);
    }
  }, [granularityOptions, mode, selectedGranularityMs]);

  const rows = useMemo(
    () =>
      buildChartRowsWithGranularity(
        selectedSeries as SimulationSeries[],
        visibleSeriesIds,
        chartRangeStart,
        chartRangeEnd,
        selectedGranularityMs
      ),
    [chartRangeEnd, chartRangeStart, selectedGranularityMs, selectedSeries, visibleSeriesIds]
  );

  const chartRows = useMemo(() => applyLineGaps(rows, visibleSeriesIds), [rows, visibleSeriesIds]);

  const xTickStepMs = useMemo(
    () => resolveAxisTickStepMs(chartRangeStart, chartRangeEnd, selectedGranularityMs),
    [chartRangeEnd, chartRangeStart, selectedGranularityMs]
  );
  const xTicks = useMemo(
    () => buildAxisTicks(chartRangeStart, chartRangeEnd, xTickStepMs),
    [chartRangeEnd, chartRangeStart, xTickStepMs]
  );
  const firstTickEpoch = xTicks.length > 0 ? xTicks[0] : undefined;

  const noDataIntervals = useMemo(
    () => computeNoDataIntervals(chartRows, visibleSeriesIds, chartRangeStart, chartRangeEnd, selectedGranularityMs),
    [chartRangeEnd, chartRangeStart, chartRows, selectedGranularityMs, visibleSeriesIds]
  );

  const coveragePercent = useMemo(
    () => computeAvailabilityPercent(chartRows, visibleSeriesIds, chartRangeStart, chartRangeEnd, selectedGranularityMs),
    [chartRangeEnd, chartRangeStart, chartRows, selectedGranularityMs, visibleSeriesIds]
  );

  const unitOrder = useMemo(() => Array.from(new Set(visibleSeries.map((entry) => entry.unit || "value"))), [visibleSeries]);
  const primaryUnit = unitOrder[0] || "value";
  const secondaryUnit = unitOrder[1] || null;

  const colorBySeriesId = useMemo(() => {
    return new Map(selectedSeries.map((entry, index) => [entry.id, CHART_COLORS[index % CHART_COLORS.length]]));
  }, [selectedSeries]);

  const axisIdForSeries = useCallback(
    (entry: DeployChartSeries): "left" | "right" => {
      const unit = entry.unit || "value";
      if (secondaryUnit && unit === secondaryUnit) return "right";
      return "left";
    },
    [secondaryUnit]
  );

  const computeDomain = useCallback((ids: string[]): [number, number] | null => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    chartRows.forEach((row) => {
      ids.forEach((seriesId) => {
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
  }, [chartRows]);

  const leftDomain = useMemo(
    () =>
      computeDomain(
        visibleSeries.filter((entry) => axisIdForSeries(entry) === "left").map((entry) => entry.id)
      ),
    [axisIdForSeries, computeDomain, visibleSeries]
  );

  const rightDomain = useMemo(
    () =>
      secondaryUnit
        ? computeDomain(
            visibleSeries.filter((entry) => axisIdForSeries(entry) === "right").map((entry) => entry.id)
          )
        : null,
    [axisIdForSeries, computeDomain, secondaryUnit, visibleSeries]
  );

  const loadHistoryChunk = useCallback(
    async (filter: AppliedChartsFilter): Promise<void> => {
      if (!targetId) return;
      const effective = filter;
      const requestId = historyRequestCounter.current + 1;
      historyRequestCounter.current = requestId;
      setHistoryLoading(true);

      try {
        const payload = await getDeployLogsHistoryChunk(targetId, {
          sinceTs: effective.sinceTs,
          untilTs: effective.untilTs,
          limitLines: HISTORY_LIMIT_LINES
        });

        if (historyRequestCounter.current !== requestId) return;

        let mergedChunk: DeployLogsHistoryChunkResponse = {
          ...payload,
          lines: payload.lines || []
        };
        setHistoryChunk(mergedChunk);
        setHistoryLoading(false);
        const order = inferLogOrder(mergedChunk.lines);
        const visitedCursors = new Set<string>();
        let pageCount = 0;
        let nextCursor = payload.next_cursor;
        let prevCursor = payload.prev_cursor;

        while (
          nextCursor &&
          pageCount < HISTORY_LAZY_MAX_PAGES &&
          historyRequestCounter.current === requestId &&
          !visitedCursors.has(nextCursor)
        ) {
          visitedCursors.add(nextCursor);
          const olderPayload = await getDeployLogsHistoryChunk(targetId, {
            sinceTs: effective.sinceTs,
            untilTs: effective.untilTs,
            cursor: nextCursor,
            limitLines: HISTORY_LIMIT_LINES
          });
          if (historyRequestCounter.current !== requestId) return;

          pageCount += 1;
          const olderLines = olderPayload.lines || [];
          const nextLines =
            order === "asc"
              ? mergeHistoryLines(olderLines, mergedChunk.lines || [])
              : mergeHistoryLines(mergedChunk.lines || [], olderLines);
          mergedChunk = {
            ...mergedChunk,
            lines: nextLines,
            next_cursor: olderPayload.next_cursor,
            has_more_before: olderPayload.has_more_before
          };
          setHistoryChunk(mergedChunk);
          nextCursor = olderPayload.next_cursor;
        }

        while (
          prevCursor &&
          pageCount < HISTORY_LAZY_MAX_PAGES &&
          historyRequestCounter.current === requestId &&
          !visitedCursors.has(prevCursor)
        ) {
          visitedCursors.add(prevCursor);
          const newerPayload = await getDeployLogsHistoryChunk(targetId, {
            sinceTs: effective.sinceTs,
            untilTs: effective.untilTs,
            cursor: prevCursor,
            limitLines: HISTORY_LIMIT_LINES
          });
          if (historyRequestCounter.current !== requestId) return;

          pageCount += 1;
          const newerLines = newerPayload.lines || [];
          const nextLines =
            order === "asc"
              ? mergeHistoryLines(mergedChunk.lines || [], newerLines)
              : mergeHistoryLines(newerLines, mergedChunk.lines || []);
          mergedChunk = {
            ...mergedChunk,
            lines: nextLines,
            prev_cursor: newerPayload.prev_cursor,
            has_more_after: newerPayload.has_more_after
          };
          setHistoryChunk(mergedChunk);
          prevCursor = newerPayload.prev_cursor;
        }

        if ((nextCursor || prevCursor) && historyRequestCounter.current === requestId) {
          setHistoryChunk((previous) => {
            if (!previous) return previous;
            const suffix = `Showing recent ${previous.lines.length.toLocaleString()} lines. Narrow the window for full detail.`;
            return {
              ...previous,
              message: previous.message ? `${previous.message} ${suffix}` : suffix
            };
          });
        }

        const sinceEpoch = parseIso(effective.sinceTs);
        const untilEpoch = parseIso(effective.untilTs);

        const shouldBackfillBySlices =
          historyRequestCounter.current === requestId &&
          sinceEpoch !== null &&
          untilEpoch !== null &&
          untilEpoch > sinceEpoch;

        if (shouldBackfillBySlices) {
          const spanMs = untilEpoch - sinceEpoch;
          const sliceMs = resolveHistorySliceMs(spanMs);
          let requests = 0;
          let cursorEpoch = sinceEpoch;
          let backfilledLines: DeployLogsHistoryLine[] = [];
          let hitRequestLimit = false;

          while (cursorEpoch < untilEpoch && requests < HISTORY_SLICE_MAX_REQUESTS) {
            const chunkUntilEpoch = Math.min(untilEpoch, cursorEpoch + sliceMs);
            const chunkSinceTs = new Date(cursorEpoch).toISOString();
            const chunkUntilTs = new Date(chunkUntilEpoch).toISOString();

            const chunkPayload = await getDeployLogsHistoryChunk(targetId, {
              sinceTs: chunkSinceTs,
              untilTs: chunkUntilTs,
              limitLines: HISTORY_LIMIT_LINES
            });
            if (historyRequestCounter.current !== requestId) return;
            requests += 1;

            let chunkLines = chunkPayload.lines || [];
            const chunkOrder = inferLogOrder(chunkLines);
            let chunkCursor = chunkPayload.next_cursor;
            let chunkPageCount = 0;

            while (
              chunkCursor &&
              chunkPageCount < HISTORY_LAZY_MAX_PAGES &&
              requests < HISTORY_SLICE_MAX_REQUESTS &&
              historyRequestCounter.current === requestId
            ) {
              const olderChunkPayload = await getDeployLogsHistoryChunk(targetId, {
                sinceTs: chunkSinceTs,
                untilTs: chunkUntilTs,
                cursor: chunkCursor,
                limitLines: HISTORY_LIMIT_LINES
              });
              if (historyRequestCounter.current !== requestId) return;
              requests += 1;
              chunkPageCount += 1;
              chunkCursor = olderChunkPayload.next_cursor;
              const olderChunkLines = olderChunkPayload.lines || [];
              chunkLines =
                chunkOrder === "asc"
                  ? mergeHistoryLines(olderChunkLines, chunkLines)
                  : mergeHistoryLines(chunkLines, olderChunkLines);
            }

            if (chunkCursor && requests >= HISTORY_SLICE_MAX_REQUESTS) {
              hitRequestLimit = true;
            }

            backfilledLines =
              inferLogOrder(backfilledLines) === "asc"
                ? mergeHistoryLines(backfilledLines, chunkLines)
                : mergeHistoryLines(chunkLines, backfilledLines);

            cursorEpoch = chunkUntilEpoch;
          }

          if (cursorEpoch < untilEpoch && requests >= HISTORY_SLICE_MAX_REQUESTS) {
            hitRequestLimit = true;
          }

          if (historyRequestCounter.current === requestId && backfilledLines.length > 0) {
            mergedChunk = {
              ...mergedChunk,
              lines: backfilledLines,
              message: hitRequestLimit
                ? "Partial history loaded for this window. Narrow the range for complete detail."
                : null
            };
            setHistoryChunk(mergedChunk);
          } else if (historyRequestCounter.current === requestId && hitRequestLimit) {
            setHistoryChunk((previous) => {
              if (!previous) return previous;
              return {
                ...previous,
                message: "Partial history loaded for this window. Narrow the range for complete detail."
              };
            });
          }
        }
      } catch (error) {
        notifyErrorRef.current("Could not load historical logs for charts", error);
      } finally {
        if (historyRequestCounter.current === requestId) {
          setHistoryLoading(false);
        }
      }
    },
    [targetId]
  );

  const loadLiveChunk = useCallback(
    async (filter: AppliedChartsFilter, options?: { silent?: boolean }): Promise<void> => {
      if (!targetId) return;

      const requestId = liveRequestCounter.current + 1;
      liveRequestCounter.current = requestId;
      const markLoading = !options?.silent || !liveChunkRef.current;
      if (markLoading) {
        setLiveLoading(true);
      }

      const nowEpoch = Date.now();
      const windowRange = resolveModeWindow(filter, "live", nowEpoch);

      try {
        const payload = await getDeployLogsHistoryChunk(targetId, {
          sinceTs: windowRange.sinceTs,
          untilTs: windowRange.untilTs,
          limitLines: LIVE_LIMIT_LINES
        });

        if (liveRequestCounter.current === requestId) {
          setLiveChunk(payload);
        }
      } catch (error) {
        notifyErrorRef.current("Could not refresh live chart logs", error);
      } finally {
        if (markLoading && liveRequestCounter.current === requestId) {
          setLiveLoading(false);
        }
      }
    },
    [targetId]
  );

  useEffect(() => {
    if (!targetId) return;
    if (mode !== "live") return;

    void loadLiveChunk(appliedFilter, { silent: true });
    const interval = window.setInterval(() => {
      void loadLiveChunk(appliedFilter, { silent: true });
    }, LIVE_POLL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [appliedFilter, loadLiveChunk, mode, targetId]);

  useEffect(() => {
    if (!targetId) return;
    if (mode !== "history") return;
    void loadHistoryChunk(appliedFilter);
  }, [appliedFilter, loadHistoryChunk, mode, targetId]);

  useEffect(() => {
    if (mode !== "live") return;
    setRangePopoverOpen(false);
    setActiveDateField(null);
  }, [mode]);

  useEffect(() => {
    const since = parseDateTimeLocalInput(sinceInput);
    const until = parseDateTimeLocalInput(untilInput);
    if (!since || !until || since.getTime() >= until.getTime()) return;

    const nextApplied = buildAppliedFilter({
      quickRange,
      sinceInput,
      untilInput
    });

    setAppliedFilter((previous) => {
      if (
        previous.quickRange === nextApplied.quickRange &&
        previous.sinceInput === nextApplied.sinceInput &&
        previous.untilInput === nextApplied.untilInput
      ) {
        return previous;
      }
      return nextApplied;
    });
  }, [quickRange, sinceInput, untilInput]);

  function setRangeFromMinutes(totalMinutes: number): void {
    const until = new Date();
    const since = new Date(until.getTime() - totalMinutes * 60 * 1000);
    setSinceInput(toDateTimeLocalInput(since));
    setUntilInput(toDateTimeLocalInput(until));
  }

  function onSelectQuickRange(next: DeployHistoryQuickRange): void {
    setQuickRange(next);
    setRangePopoverOpen(false);
    setActiveDateField(null);
    if (next === "30m") setRangeFromMinutes(30);
    if (next === "1h") setRangeFromMinutes(60);
    if (next === "6h") setRangeFromMinutes(6 * 60);
    if (next === "24h") setRangeFromMinutes(24 * 60);
  }

  function shiftHistoryWindow(direction: -1 | 1): void {
    const since = parseDateTimeLocalInput(sinceInput);
    const until = parseDateTimeLocalInput(untilInput);
    if (!since || !until) return;

    const span = until.getTime() - since.getTime();
    if (!Number.isFinite(span) || span <= 0) return;

    const shiftedSince = new Date(since.getTime() + direction * span);
    const shiftedUntil = new Date(until.getTime() + direction * span);
    setQuickRange("custom");
    setSinceInput(toDateTimeLocalInput(shiftedSince));
    setUntilInput(toDateTimeLocalInput(shiftedUntil));
  }

  function toggleRangePopover(): void {
    setRangePopoverOpen((previous) => {
      const next = !previous;
      if (next) {
        const since = parseDateTimeLocalInput(sinceInput);
        if (since) {
          setCalendarMonth(new Date(since.getFullYear(), since.getMonth(), 1));
        }
        setActiveDateField("since");
      } else {
        setActiveDateField(null);
      }
      return next;
    });
  }

  function setDraftDate(field: DeployHistoryDateField, date: Date | undefined): void {
    if (!date) return;
    setQuickRange("custom");

    if (field === "since") {
      const time = extractTimePart(sinceInput);
      const nextSince = applyDateAndTime(date, time);
      setSinceInput(nextSince);

      const nextSinceEpoch = parseDateTimeLocal(nextSince);
      const currentUntilEpoch = parseDateTimeLocal(untilInput);
      if (nextSinceEpoch !== null && currentUntilEpoch !== null && currentUntilEpoch < nextSinceEpoch) {
        setUntilInput(nextSince);
      }
      setActiveDateField("until");
      setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      return;
    }

    const time = extractTimePart(untilInput);
    const nextUntil = applyDateAndTime(date, time);
    setUntilInput(nextUntil);
    setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  function toggleMetric(seriesId: string): void {
    setHiddenSeriesIds((previous) => {
      const next = new Set(previous);
      if (next.has(seriesId)) {
        next.delete(seriesId);
      } else {
        next.add(seriesId);
      }
      return next;
    });
  }

  function refreshCurrentMode(): void {
    if (mode === "history") {
      void loadHistoryChunk(appliedFilter);
      return;
    }
    void loadLiveChunk(appliedFilter);
  }

  if (targetsQuery.isLoading) {
    return (
      <div className="page jobs-page">
        <EVChargingLoader label="Loading deploy targets..." />
      </div>
    );
  }

  if (targetsQuery.isError) {
    return (
      <div className="page jobs-page">
        <EmptyState title="Could not load deploy targets" message="Try refreshing the Deploy page." />
      </div>
    );
  }

  if (!target) {
    return (
      <div className="page jobs-page">
        <header className="jobs-hero deploy-charts-hero">
          <div className="deploy-charts-title">
            <h1>Deploy Charts</h1>
          </div>
          <div className="jobs-command-group">
            <Button variant="secondary" iconLeft={<ChevronLeft size={14} />} onClick={() => navigate("/app/ai/deploy")}>
              Back
            </Button>
          </div>
        </header>
        <EmptyState title="Target not found" message="Select a valid deploy target from the Deploy table." />
      </div>
    );
  }

  const hasChartData = visibleSeries.length > 0 && chartRows.length > 0;

  return (
    <div className="page jobs-page deploy-charts-page">
      <header className="jobs-hero deploy-charts-hero">
        <div className="deploy-charts-title">
          <h1>{siteLabel} Charts</h1>
        </div>
        <div className="jobs-command-group">
          <Button variant="secondary" size="sm" iconLeft={<ChevronLeft size={13} />} onClick={() => navigate("/app/ai/deploy")}>
            Back
          </Button>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<RefreshCcw size={13} />}
            onClick={refreshCurrentMode}
            disabled={activeLoading}
          >
            Refresh
          </Button>
        </div>
      </header>

      <section className="timeseries-workspace">
        <section className="timeseries-toolbar deploy-charts-toolbar panel">
          <div className="timeseries-toolbar-left deploy-charts-toolbar-left">
            <div className="deploy-logs-mode-switch" role="tablist" aria-label="Chart mode">
              <button
                type="button"
                className={`deploy-logs-mode-btn${mode === "live" ? " is-active" : ""}`}
                onClick={() => setMode("live")}
              >
                Live
              </button>
              <button
                type="button"
                className={`deploy-logs-mode-btn${mode === "history" ? " is-active" : ""}`}
                onClick={() => setMode("history")}
              >
                History
              </button>
            </div>

            {mode === "history" ? (
              <div className="segmented-row" role="group" aria-label="Quick range">
                <button
                  type="button"
                  className={`segment-btn${quickRange === "30m" ? " is-active" : ""}`}
                  onClick={() => onSelectQuickRange("30m")}
                >
                  Last 30m
                </button>
                <button
                  type="button"
                  className={`segment-btn${quickRange === "1h" ? " is-active" : ""}`}
                  onClick={() => onSelectQuickRange("1h")}
                >
                  Last 1h
                </button>
                <button
                  type="button"
                  className={`segment-btn${quickRange === "6h" ? " is-active" : ""}`}
                  onClick={() => onSelectQuickRange("6h")}
                >
                  Last 6h
                </button>
                <button
                  type="button"
                  className={`segment-btn${quickRange === "24h" ? " is-active" : ""}`}
                  onClick={() => onSelectQuickRange("24h")}
                >
                  Last 24h
                </button>
                <button
                  type="button"
                  className={`segment-btn${quickRange === "custom" ? " is-active" : ""}`}
                  onClick={() => onSelectQuickRange("custom")}
                >
                  Custom
                </button>
              </div>
            ) : null}
          </div>

          <div className="timeseries-toolbar-right deploy-charts-toolbar-right">
            <div className="segmented-row timeseries-granularity-row" role="group" aria-label="Granularity">
              <span className="timeseries-granularity-label">Granularity</span>
              {granularityOptions.map((option) => (
                <button
                  key={option.ms}
                  type="button"
                  className={`segment-btn${selectedGranularityMs === option.ms ? " is-active" : ""}`}
                  onClick={() => setSelectedGranularityMs(option.ms)}
                  disabled={!option.enabled}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {mode === "history" ? (
              <>
                <div className="segmented-row" role="group" aria-label="Move selected window">
                  <button
                    type="button"
                    className="segment-btn segment-icon-btn"
                    onClick={() => shiftHistoryWindow(-1)}
                    title="Previous window"
                    aria-label="Previous window"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className="segment-btn segment-icon-btn"
                    onClick={() => shiftHistoryWindow(1)}
                    title="Next window"
                    aria-label="Next window"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  className={`timeseries-range-trigger${rangePopoverOpen ? " is-open" : ""}`}
                  onClick={toggleRangePopover}
                  title="Adjust time window"
                >
                  <CalendarDays size={15} />
                  <span className="timeseries-range-trigger-copy">
                    <small>Range</small>
                    <strong>{toolbarRangeSummary}</strong>
                  </span>
                  <ChevronDown size={14} />
                </button>
              </>
            ) : null}

            {mode === "history" && rangePopoverOpen ? (
              <div className="timeseries-range-popover panel">
                <div className="timeseries-range-head">
                  <div>
                    <strong>Select chart window</strong>
                    <small>Pick local start/end, requests are sent in UTC.</small>
                  </div>
                  <span className="timeseries-range-hint">
                    <span className="timeseries-range-hint-dot" />
                    Local time
                  </span>
                </div>

                <div className="timeseries-date-row">
                  <div className="timeseries-date-field">
                    <span>Since</span>
                    <button
                      type="button"
                      className={`timeseries-date-trigger${activeDateField === "since" ? " is-active" : ""}`}
                      onClick={() => setActiveDateField((previous) => (previous === "since" ? null : "since"))}
                    >
                      {sinceDate ? formatPickerDay(sinceDate) : "Select date"}
                    </button>
                    <TimeInput24
                      value={extractTimePart(sinceInput)}
                      ariaLabel="Since time"
                      onChange={(nextTime) => {
                        const base = sinceDate ?? new Date();
                        setQuickRange("custom");
                        setSinceInput(applyDateAndTime(base, nextTime));
                      }}
                    />
                  </div>

                  <div className="timeseries-date-field">
                    <span>Until</span>
                    <button
                      type="button"
                      className={`timeseries-date-trigger${activeDateField === "until" ? " is-active" : ""}`}
                      onClick={() => setActiveDateField((previous) => (previous === "until" ? null : "until"))}
                    >
                      {untilDate ? formatPickerDay(untilDate) : "Select date"}
                    </button>
                    <TimeInput24
                      value={extractTimePart(untilInput)}
                      ariaLabel="Until time"
                      onChange={(nextTime) => {
                        const base = untilDate ?? sinceDate ?? new Date();
                        setQuickRange("custom");
                        setUntilInput(applyDateAndTime(base, nextTime));
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
                      selected={activeDateField === "since" ? sinceDate || undefined : untilDate || undefined}
                      onSelect={(date) => setDraftDate(activeDateField, date)}
                    />
                  </div>
                ) : null}

                <div className="timeseries-range-actions">
                  <button
                    type="button"
                    className="segment-btn"
                    onClick={() => {
                      setRangePopoverOpen(false);
                      setActiveDateField(null);
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <div className="timeseries-layout deploy-charts-layout">
          <DeployChartsTree
            profileLabel={siteLabel}
            assets={assetsTree}
            expandedAssets={expandedAssets}
            selectedAssetId={selectedAssetId}
            selectedMetricSeriesId={selectedMetricSeriesId}
            onToggleAsset={(assetId) => {
              setExpandedAssets((previous) => {
                const next = new Set(previous);
                if (next.has(assetId)) next.delete(assetId);
                else next.add(assetId);
                return next;
              });
            }}
            onSelectAsset={(assetId) => {
              setSelectedAssetId(assetId);
              setSelectedMetricSeriesId(null);
            }}
            onSelectMetric={(assetId, seriesId) => {
              setSelectedAssetId(assetId);
              setSelectedMetricSeriesId(seriesId);
            }}
          />

          <section className="timeseries-main deploy-charts-main">
            <article className="panel sim-chart deploy-chart-card">
              <header>
                <h4>
                  <BarChart3 size={15} />
                  <span>{selectedAsset?.label || "Charts"}</span>
                </h4>
                <small>{toolbarRangeSummary} · Local time</small>
              </header>

              <div className="sim-chart-legend">
                {selectedSeries.map((entry) => {
                  const isActive = visibleSeriesIds.includes(entry.id);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`sim-legend-item${isActive ? " is-active" : ""}`}
                      onClick={() => toggleMetric(entry.id)}
                    >
                      <span className="metric-color" style={{ background: colorBySeriesId.get(entry.id) || "#a4b0ad" }} />
                      <span>{entry.metric}</span>
                      {entry.unit ? <small className="deploy-tree-unit">{entry.unit}</small> : null}
                    </button>
                  );
                })}
              </div>

              {!hasChartData ? (
                <EmptyState
                  title={activeLoading ? "Loading chart data" : "No chart data"}
                  message={
                    activeLoading
                      ? "Loading parsed metrics from logs..."
                      : selectedAsset?.id === "chargers" && !selectedMetricSeriesId
                        ? "Select one charger in the tree to view its chart."
                        : activeChunk?.message || "No parsed metric lines in this window. Try another time range."
                  }
                />
              ) : (
                <div className="sim-chart-canvas deploy-chart-canvas">
                  <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                    <ComposedChart data={chartRows} margin={{ top: 16, right: 24, left: 24, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis
                        type="number"
                        dataKey="epochMs"
                        scale="time"
                        domain={
                          chartRangeStart !== null && chartRangeEnd !== null
                            ? [chartRangeStart, chartRangeEnd]
                            : ["dataMin", "dataMax"]
                        }
                        allowDataOverflow
                        ticks={xTicks}
                        interval="preserveStartEnd"
                        minTickGap={44}
                        tickFormatter={(value) => formatAxisTick(Number(value), xTickStepMs, firstTickEpoch)}
                        tick={{ fontSize: 11 }}
                        tickMargin={8}
                        stroke="var(--text-soft)"
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 11 }}
                        tickFormatter={formatYAxisTick}
                        stroke="var(--text-soft)"
                        width={76}
                        tickMargin={6}
                        unit={primaryUnit !== "value" ? primaryUnit : ""}
                        domain={leftDomain || ["auto", "auto"]}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={secondaryUnit ? { fontSize: 11 } : false}
                        tickLine={Boolean(secondaryUnit)}
                        axisLine={Boolean(secondaryUnit)}
                        tickFormatter={formatYAxisTick}
                        stroke="var(--text-soft)"
                        width={76}
                        tickMargin={6}
                        unit={secondaryUnit && secondaryUnit !== "value" ? secondaryUnit : ""}
                        domain={secondaryUnit ? rightDomain || ["auto", "auto"] : [0, 1]}
                      />

                      {noDataIntervals.map((interval) => (
                        <ReferenceArea
                          key={`downtime-${interval.startEpochMs}-${interval.endEpochMs}`}
                          xAxisId={0}
                          yAxisId="left"
                          x1={interval.startEpochMs}
                          x2={interval.endEpochMs}
                          ifOverflow="extendDomain"
                          fill="#ea5a5a"
                          fillOpacity={0.14}
                          strokeOpacity={0}
                        />
                      ))}

                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const epoch = typeof label === "number" ? label : Number(label);
                          const labelText = Number.isFinite(epoch)
                            ? new Date(epoch).toLocaleString([], {
                                year: "numeric",
                                month: "short",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false
                              })
                            : String(label || "");

                          const rowsPayload: Array<{
                            key: string;
                            label: string;
                            unit?: string;
                            color: string;
                            value: number;
                          }> = [];
                          const seenKeys = new Set<string>();

                          payload.forEach((entry) => {
                            const dataKey = String(entry.dataKey || "");
                            if (!dataKey || seenKeys.has(dataKey)) return;
                            seenKeys.add(dataKey);
                            const matched = visibleSeries.find((item) => item.id === dataKey);
                            const numeric = typeof entry.value === "number" ? entry.value : Number(entry.value);
                            if (!Number.isFinite(numeric)) return;
                            rowsPayload.push({
                              key: dataKey,
                              label: matched?.metric || dataKey,
                              unit: matched?.unit,
                              color: entry.color || "var(--text-soft)",
                              value: numeric
                            });
                          });

                          return (
                            <div className="deploy-chart-tooltip">
                              <div className="deploy-chart-tooltip-head">{labelText}</div>
                              {rowsPayload.map((entry) => (
                                <div key={entry.key} className="deploy-chart-tooltip-row">
                                  <span className="deploy-chart-tooltip-label">
                                    <span className="metric-color" style={{ background: entry.color }} />
                                    {entry.label}
                                  </span>
                                  <strong>
                                    {formatNumber(entry.value)}
                                    {entry.unit ? ` ${entry.unit}` : ""}
                                  </strong>
                                </div>
                              ))}
                            </div>
                          );
                        }}
                      />

                      {visibleSeries.map((entry) => {
                        const color = colorBySeriesId.get(entry.id) || "#4f8cff";
                        return (
                          <Fragment key={entry.id}>
                            <Area
                              type="monotone"
                              dataKey={entry.id}
                              yAxisId={axisIdForSeries(entry)}
                              stroke="none"
                              fill={color}
                              fillOpacity={0.12}
                              tooltipType="none"
                              connectNulls={false}
                              isAnimationActive={false}
                            />
                            <Line
                              type="monotone"
                              dataKey={entry.id}
                              yAxisId={axisIdForSeries(entry)}
                              stroke={color}
                              strokeWidth={2.1}
                              connectNulls={false}
                              dot={false}
                              activeDot={false}
                              isAnimationActive={false}
                            />
                          </Fragment>
                        );
                      })}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>

            <AvailabilityTimeline
              intervals={noDataIntervals}
              rangeStart={chartRangeStart}
              rangeEnd={chartRangeEnd}
              coveragePercent={coveragePercent}
            />
          </section>
        </div>
      </section>
    </div>
  );
}
