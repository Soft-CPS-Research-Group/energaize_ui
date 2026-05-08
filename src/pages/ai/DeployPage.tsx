import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  Pause,
  Play,
  Upload,
  ArrowRightLeft,
  RefreshCcw,
  Trash2,
  CalendarDays,
  ChevronDown,
  BarChart3,
  Info,
  AlertTriangle
} from "lucide-react";
import { DayPicker } from "react-day-picker";
import { useNavigate } from "react-router-dom";
import {
  deleteDeployBundle,
  getDeployLogsHistoryChunk,
  getDeployInferenceHealth,
  listDeployBundleFiles,
  listDeployBundles,
  listDeployInferences,
  openDeployLogsStream,
  readDeployBundleFileContent,
  switchDeployInferenceBundle,
  uploadDeployBundleFolder,
  type DeployBundleRecord,
  type DeployLogsHistoryChunkResponse,
  type DeployLogsHistoryLine,
  type DeployInferenceHealth,
  type DeployInferenceTarget
} from "../../api/deployApi";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";
import { Modal } from "../../components/ui/Modal";
import { useApiFeedback } from "../../hooks/useApiFeedback";
import {
  buildRolling24hWindow,
  computeDeployInvestorKpis,
  type DeployInvestorSummary,
  type DeployInvestorTargetInput,
  type DeployInvestorTargetSnapshot
} from "../../utils/deployInvestorKpis";
import { parseDeployLogSamples } from "../../utils/deployLogCharts";

const HEALTH_POLL_MS = 5000;
const TARGETS_POLL_MS = 15000;
const BUNDLES_POLL_MS = 10000;
const DEFAULT_LOG_TAIL = 200;
const LOG_BUFFER_MAX_CHARS = 200000;
const HISTORY_LIMIT_LINES = 500;
const HISTORY_DEFAULT_HOURS = 6;
const INVESTOR_REFETCH_MS = 300_000;
const INVESTOR_HISTORY_LIMIT_LINES = 2000;
const INVESTOR_HISTORY_MAX_PAGES = 8;
const INVESTOR_HISTORY_SEARCH_TERMS = ["Inputs:", "Prices", "Community:", "Dispatch:", "Battery:"] as const;
const INVESTOR_HISTORY_FALLBACK_LIMIT_LINES = 2000;
const INVESTOR_CLOCK_TICK_MS = 300_000;
const INVESTOR_KPI_INIT_DELAY_MS = 250;

type DeployLogsMode = "live" | "history";
type DeployHistoryQuickRange = "1h" | "6h" | "24h" | "custom";
type DeployHistoryDateField = "since" | "until";

function extractBundleIdFromManifestPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\/g, "/");
  const match = normalized.match(/\/([^/]+)\/artifact_manifest\.json$/);
  return match ? match[1] : null;
}

function summarizeHealth(health: DeployInferenceHealth | null): { label: string; cssClass: string } {
  if (!health) {
    return { label: "loading", cssClass: "is-loading" };
  }
  if (!health.reachable) {
    return { label: "offline", cssClass: "is-unhealthy" };
  }
  if (!health.configured) {
    return { label: "unconfigured", cssClass: "is-unhealthy" };
  }
  return { label: health.healthy ? "healthy" : "unhealthy", cssClass: health.healthy ? "is-healthy" : "is-unhealthy" };
}

function bundleDisplayName(bundle: DeployBundleRecord | null | undefined): string {
  const candidate = bundle?.name?.trim();
  if (candidate) return candidate;
  return bundle?.bundle_id || "-";
}

function isBundlePreviewFile(path: string): boolean {
  const normalized = String(path || "").replace(/\\/g, "/").toLowerCase();
  const fileName = normalized.split("/").pop() || normalized;
  if (fileName === "artifact_manifest.json") return true;
  if (fileName === "aliases.json") return true;
  if (fileName.startsWith("policy_agent")) return true;
  return false;
}

function bundleStorageKey(bundle: DeployBundleRecord): string {
  const key = bundle.storage_dir_name?.trim();
  return key || bundle.bundle_id;
}

function findBundleByManifestKey(bundles: DeployBundleRecord[], key: string | null): DeployBundleRecord | null {
  if (!key) return null;
  return bundles.find((bundle) => bundle.bundle_id === key || bundleStorageKey(bundle) === key) || null;
}

function normalizeSearchText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function resolveTargetBundleKeywords(target: DeployInferenceTarget | null): string[] {
  if (!target) return [];
  const probe = normalizeSearchText(`${target.id} ${target.name}`).replace(/[^a-z0-9]+/g, " ");
  const keywords: string[] = [];

  if (/\b(hq|boavista)\b/.test(probe)) {
    keywords.push("boavista", "hq");
  }

  if (/(sao[\s_-]*mamede|saomamede)\b/.test(probe)) {
    keywords.push("sao mamede", "sao_mamede", "sao-mamede", "saomamede");
  }

  const rhMatch = probe.match(/\br[\s_-]*h[\s_-]*0*(\d{1,2})\b|\brh0*(\d{1,2})\b/);
  const rhRaw = rhMatch?.[1] || rhMatch?.[2];
  if (rhRaw) {
    const rhCompact = String(Number(rhRaw));
    const rhPadded = rhRaw.padStart(2, "0");
    keywords.push(
      `rh${rhCompact}`,
      `r-h-${rhCompact}`,
      `r_h_${rhCompact}`,
      `r h ${rhCompact}`,
      `rh${rhPadded}`,
      `r-h-${rhPadded}`,
      `r_h_${rhPadded}`,
      `r h ${rhPadded}`
    );
  }

  if (keywords.length === 0) {
    const fallback = normalizeSearchText(target.id).replace(/[^a-z0-9]+/g, " ").trim();
    if (fallback) keywords.push(fallback);
  }

  return Array.from(new Set(keywords));
}

function bundleSearchText(bundle: DeployBundleRecord): string {
  return normalizeSearchText(
    [bundleDisplayName(bundle), bundle.bundle_id, bundle.storage_dir_name || ""].join(" | ")
  );
}

function filterBundlesForTarget(
  bundles: DeployBundleRecord[],
  target: DeployInferenceTarget | null
): DeployBundleRecord[] {
  const keywords = resolveTargetBundleKeywords(target);
  if (!target || keywords.length === 0) return bundles;

  return bundles.filter((bundle) => {
    const blob = bundleSearchText(bundle);
    return keywords.some((keyword) => blob.includes(normalizeSearchText(keyword)));
  });
}

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "-";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isHealthNoiseLogLine(line: string): boolean {
  const normalized = String(line || "").toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('"get /health http/1.1"')) return true;
  if (normalized.includes("| get /health |")) return true;
  return false;
}

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

function historyWindowLabelFromRange(
  range: DeployHistoryQuickRange,
  sinceInput: string,
  untilInput: string
): string {
  if (range === "1h") return "Window: Last 1h";
  if (range === "6h") return "Window: Last 6h";
  if (range === "24h") return "Window: Last 24h";
  return `Window: ${sinceInput || "-"} → ${untilInput || "-"}`;
}

function formatHistoryLineTs(value: string | null): string {
  if (!value) return "No timestamp";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatHistoryRangeSummary(sinceInput: string, untilInput: string): string {
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

function parseIsoEpoch(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function inferHistoryOrder(lines: DeployLogsHistoryLine[]): "asc" | "desc" {
  let firstEpoch: number | null = null;
  let lastEpoch: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const epoch = parseIsoEpoch(lines[index].ts);
    if (epoch !== null) {
      firstEpoch = epoch;
      break;
    }
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const epoch = parseIsoEpoch(lines[index].ts);
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

function isSameHistoryLine(left: DeployLogsHistoryLine, right: DeployLogsHistoryLine): boolean {
  return left.ts === right.ts && left.source === right.source && left.text === right.text;
}

function mergeHistoryLines(
  base: DeployLogsHistoryLine[],
  incoming: DeployLogsHistoryLine[]
): DeployLogsHistoryLine[] {
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

function sortHistoryLines(lines: DeployLogsHistoryLine[]): DeployLogsHistoryLine[] {
  return [...lines].sort((left, right) => {
    const leftEpoch = parseIsoEpoch(left.ts);
    const rightEpoch = parseIsoEpoch(right.ts);
    if (leftEpoch !== null && rightEpoch !== null && leftEpoch !== rightEpoch) {
      return leftEpoch - rightEpoch;
    }
    if (leftEpoch !== null && rightEpoch === null) return -1;
    if (leftEpoch === null && rightEpoch !== null) return 1;
    const leftKey = `${left.ts || ""}|${left.source}|${left.text}`;
    const rightKey = `${right.ts || ""}|${right.source}|${right.text}`;
    return leftKey.localeCompare(rightKey);
  });
}

function uniqHistoryLines(lines: DeployLogsHistoryLine[]): DeployLogsHistoryLine[] {
  const seen = new Set<string>();
  const result: DeployLogsHistoryLine[] = [];
  lines.forEach((line) => {
    const key = `${line.ts || ""}|${line.source}|${line.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(line);
  });
  return result;
}

function joinDistinctMessages(messages: Array<string | null | undefined>): string | null {
  const merged = Array.from(
    new Set(
      messages
        .map((message) => String(message || "").trim())
        .filter(Boolean)
    )
  );
  if (merged.length === 0) return null;

  const noMatchMessages = merged.filter((message) => /no log lines matched/i.test(message));
  const otherMessages = merged.filter((message) => !/no log lines matched/i.test(message));

  if (otherMessages.length === 0) {
    return null;
  }

  if (noMatchMessages.length > 0) {
    return `${otherMessages.join(" ")} Some KPI fields are unavailable in this window.`;
  }

  return otherMessages.join(" ");
}

function hasInvestorKpiSamples(lines: DeployLogsHistoryLine[]): boolean {
  if (!lines.length) return false;
  const parsed = parseDeployLogSamples(lines);
  return parsed.some((sample) =>
    sample.metricKey.startsWith("price_") ||
    sample.metricKey === "meter_in" ||
    sample.metricKey === "meter_out" ||
    sample.metricKey === "grid_meter_in" ||
    sample.metricKey === "grid_meter_out" ||
    sample.metricKey === "community_in" ||
    sample.metricKey === "community_out" ||
    sample.metricKey === "community_net" ||
    sample.metricKey === "action_kw" ||
    sample.metricKey === "connected_total" ||
    sample.metricKey === "solar"
  );
}

function needsInvestorDemandBackfill(lines: DeployLogsHistoryLine[]): boolean {
  if (!lines.length) return false;
  const parsed = parseDeployLogSamples(lines);
  const hasAnyKpiSignal = parsed.some((sample) => {
    if (sample.metricKey.startsWith("price_")) return true;
    return (
      sample.metricKey === "meter_in" ||
      sample.metricKey === "grid_meter_in" ||
      sample.metricKey === "meter_out" ||
      sample.metricKey === "grid_meter_out" ||
      sample.metricKey === "community_in" ||
      sample.metricKey === "community_out" ||
      sample.metricKey === "community_net" ||
      sample.metricKey === "solar" ||
      sample.metricKey === "battery_dispatch"
    );
  });
  const hasDemand = parsed.some(
    (sample) =>
      sample.metricKey === "meter_in" ||
      sample.metricKey === "grid_meter_in" ||
      sample.metricKey === "action_kw" ||
      sample.metricKey === "connected_total"
  );
  return hasAnyKpiSignal && !hasDemand;
}

async function loadHistorySegmentForTarget(params: {
  targetId: string;
  sinceTs: string;
  untilTs: string;
  search?: string;
  limitLines?: number;
}): Promise<DeployLogsHistoryChunkResponse> {
  const initial = await getDeployLogsHistoryChunk(params.targetId, {
    sinceTs: params.sinceTs,
    untilTs: params.untilTs,
    search: params.search,
    limitLines: params.limitLines ?? INVESTOR_HISTORY_LIMIT_LINES
  });

  let mergedChunk: DeployLogsHistoryChunkResponse = {
    ...initial,
    lines: initial.lines || []
  };

  const order = inferHistoryOrder(mergedChunk.lines);
  const visitedCursors = new Set<string>();
  let pages = 0;
  let nextCursor = initial.next_cursor;
  let prevCursor = initial.prev_cursor;

  while (nextCursor && pages < INVESTOR_HISTORY_MAX_PAGES && !visitedCursors.has(`next:${nextCursor}`)) {
    visitedCursors.add(`next:${nextCursor}`);
    const older = await getDeployLogsHistoryChunk(params.targetId, {
      sinceTs: params.sinceTs,
      untilTs: params.untilTs,
      search: params.search,
      cursor: nextCursor,
      limitLines: params.limitLines ?? INVESTOR_HISTORY_LIMIT_LINES
    });

    pages += 1;
    const olderLines = older.lines || [];
    const nextLines =
      order === "asc"
        ? mergeHistoryLines(olderLines, mergedChunk.lines || [])
        : mergeHistoryLines(mergedChunk.lines || [], olderLines);
    mergedChunk = {
      ...mergedChunk,
      lines: nextLines,
      next_cursor: older.next_cursor,
      has_more_before: older.has_more_before
    };
    nextCursor = older.next_cursor;
  }

  while (prevCursor && pages < INVESTOR_HISTORY_MAX_PAGES && !visitedCursors.has(`prev:${prevCursor}`)) {
    visitedCursors.add(`prev:${prevCursor}`);
    const newer = await getDeployLogsHistoryChunk(params.targetId, {
      sinceTs: params.sinceTs,
      untilTs: params.untilTs,
      search: params.search,
      cursor: prevCursor,
      limitLines: params.limitLines ?? INVESTOR_HISTORY_LIMIT_LINES
    });

    pages += 1;
    const newerLines = newer.lines || [];
    const nextLines =
      order === "asc"
        ? mergeHistoryLines(mergedChunk.lines || [], newerLines)
        : mergeHistoryLines(newerLines, mergedChunk.lines || []);
    mergedChunk = {
      ...mergedChunk,
      lines: nextLines,
      prev_cursor: newer.prev_cursor,
      has_more_after: newer.has_more_after
    };
    prevCursor = newer.prev_cursor;
  }

  if ((nextCursor || prevCursor) && !mergedChunk.message) {
    mergedChunk = {
      ...mergedChunk,
      message: "Partial window loaded. Narrow the range for complete detail."
    };
  }

  return mergedChunk;
}

async function loadFullHistoryWindowForTarget(params: {
  targetId: string;
  sinceTs: string;
  untilTs: string;
}): Promise<DeployLogsHistoryChunkResponse> {
  const segments: DeployLogsHistoryChunkResponse[] = [];
  for (const search of INVESTOR_HISTORY_SEARCH_TERMS) {
    // Run segments sequentially to avoid bursting many concurrent history requests per page load.
    // This keeps the Deploy page more responsive while KPI snapshots are being prepared.
    // eslint-disable-next-line no-await-in-loop
    const segment = await loadHistorySegmentForTarget({
      targetId: params.targetId,
      sinceTs: params.sinceTs,
      untilTs: params.untilTs,
      search
    });
    segments.push(segment);
  }

  let combinedLines = sortHistoryLines(
    uniqHistoryLines(segments.flatMap((segment) => segment.lines || []))
  );

  let fallbackSegment: DeployLogsHistoryChunkResponse | null = null;
  if (combinedLines.length === 0 || !hasInvestorKpiSamples(combinedLines) || needsInvestorDemandBackfill(combinedLines)) {
    fallbackSegment = await loadHistorySegmentForTarget({
      targetId: params.targetId,
      sinceTs: params.sinceTs,
      untilTs: params.untilTs,
      limitLines: INVESTOR_HISTORY_FALLBACK_LIMIT_LINES
    });
    combinedLines = sortHistoryLines(uniqHistoryLines(fallbackSegment.lines || []));
  }

  const available =
    segments.some((segment) => segment.available !== false) ||
    (fallbackSegment ? fallbackSegment.available !== false : false);

  const message = joinDistinctMessages([
    ...segments.map((segment) => segment.message),
    fallbackSegment?.message
  ]);

  const hasMoreBefore = segments.some((segment) => segment.has_more_before) || Boolean(fallbackSegment?.has_more_before);
  const hasMoreAfter = segments.some((segment) => segment.has_more_after) || Boolean(fallbackSegment?.has_more_after);

  return {
    target_id: params.targetId,
    since_ts: params.sinceTs,
    until_ts: params.untilTs,
    lines: combinedLines,
    next_cursor: null,
    prev_cursor: null,
    has_more_before: hasMoreBefore,
    has_more_after: hasMoreAfter,
    available,
    message: message || (combinedLines.length === 0 ? "No KPI logs found in this window." : null)
  };
}

function formatInvestorCurrency(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  if (Math.abs(value) > 0 && Math.abs(value) < 0.01) {
    return value > 0 ? "<€0.01" : ">-€0.01";
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2
  }).format(value);
}

function formatInvestorPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function formatInvestorSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatInvestorSavedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return formatInvestorSignedPercent(value);
}

function formatInvestorCoverage(snapshot: {
  coveragePct: number;
  coverageSlotsPresent: number;
  coverageSlotsExpected: number;
}): string {
  if (!Number.isFinite(snapshot.coveragePct)) return "0% data";
  const pct = `${snapshot.coveragePct.toFixed(1)}% data`;
  if (!snapshot.coverageSlotsExpected) return pct;
  return `${pct} (${snapshot.coverageSlotsPresent}/${snapshot.coverageSlotsExpected})`;
}

function investorCoverageClass(coveragePct: number): string {
  if (coveragePct >= 80) return "is-good";
  if (coveragePct >= 55) return "is-warn";
  return "is-bad";
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

function formatLogsForDisplay(
  raw: string,
  options: { hideHealthNoise: boolean; markInferenceCycles: boolean }
): string {
  if (!raw) return raw;
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    if (options.hideHealthNoise && isHealthNoiseLogLine(line)) {
      continue;
    }

    if (options.markInferenceCycles && line.includes("| POST /inference | rbc.summary")) {
      const requestIdMatch = line.match(/request_id=([^|]+)/);
      const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2} [^|]+)/);
      const requestId = requestIdMatch?.[1]?.trim() || "-";
      const timestamp = timeMatch?.[1]?.trim();
      out.push("");
      out.push(`========== Inference Cycle (${requestId}${timestamp ? ` @ ${timestamp}` : ""}) ==========` );
    }

    out.push(line);
  }

  return out.join("\n");
}

export function DeployPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { notifyError, notifyInfo, notifySuccess } = useApiFeedback();

  const [logsOpen, setLogsOpen] = useState(false);
  const [logsTarget, setLogsTarget] = useState<DeployInferenceTarget | null>(null);
  const [logsMode, setLogsMode] = useState<DeployLogsMode>("live");
  const [logsText, setLogsText] = useState("");
  const [logsStreaming, setLogsStreaming] = useState(false);
  const [logsPaused, setLogsPaused] = useState(false);
  const [logsAutoScroll, setLogsAutoScroll] = useState(true);
  const [logsHideHealthNoise, setLogsHideHealthNoise] = useState(true);
  const [logsMarkInferenceCycles, setLogsMarkInferenceCycles] = useState(true);
  const [logsHistoryQuickRange, setLogsHistoryQuickRange] = useState<DeployHistoryQuickRange>("6h");
  const [logsHistorySinceInput, setLogsHistorySinceInput] = useState(() =>
    toDateTimeLocalInput(new Date(Date.now() - HISTORY_DEFAULT_HOURS * 60 * 60 * 1000))
  );
  const [logsHistoryUntilInput, setLogsHistoryUntilInput] = useState(() => toDateTimeLocalInput(new Date()));
  const [logsHistoryRangePopoverOpen, setLogsHistoryRangePopoverOpen] = useState(false);
  const [logsHistoryActiveDateField, setLogsHistoryActiveDateField] = useState<DeployHistoryDateField | null>(null);
  const [logsHistoryCalendarMonth, setLogsHistoryCalendarMonth] = useState<Date | undefined>(undefined);
  const [logsHistoryDraftSinceInput, setLogsHistoryDraftSinceInput] = useState(() =>
    toDateTimeLocalInput(new Date(Date.now() - HISTORY_DEFAULT_HOURS * 60 * 60 * 1000))
  );
  const [logsHistoryDraftUntilInput, setLogsHistoryDraftUntilInput] = useState(() => toDateTimeLocalInput(new Date()));
  const [logsHistorySearch, setLogsHistorySearch] = useState("");
  const [logsHistoryLoading, setLogsHistoryLoading] = useState(false);
  const [logsHistoryChunk, setLogsHistoryChunk] = useState<DeployLogsHistoryChunkResponse | null>(null);
  const [logsHistoryAppliedQuery, setLogsHistoryAppliedQuery] = useState<{
    sinceTs: string;
    untilTs: string;
    search: string;
  } | null>(null);
  const [logsHistoryAppliedWindowLabel, setLogsHistoryAppliedWindowLabel] = useState("Window: Last 6h");
  const [refreshingVisual, setRefreshingVisual] = useState(false);
  const [investorClock, setInvestorClock] = useState(() => Date.now());
  const [investorKpisEnabled, setInvestorKpisEnabled] = useState(false);

  const [switchTarget, setSwitchTarget] = useState<DeployInferenceTarget | null>(null);
  const [switchBundleId, setSwitchBundleId] = useState("");

  const [deleteTargetBundle, setDeleteTargetBundle] = useState<DeployBundleRecord | null>(null);
  const [bundleDetailsTarget, setBundleDetailsTarget] = useState<DeployBundleRecord | null>(null);
  const [selectedBundleFilePath, setSelectedBundleFilePath] = useState("");

  const logsAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logsPreRef = useRef<HTMLPreElement | null>(null);

  const targetsQuery = useQuery({
    queryKey: ["deploy-targets"],
    queryFn: listDeployInferences,
    refetchInterval: TARGETS_POLL_MS
  });

  const bundlesQuery = useQuery({
    queryKey: ["deploy-bundles"],
    queryFn: listDeployBundles,
    refetchInterval: BUNDLES_POLL_MS
  });
  const targets = targetsQuery.data || [];
  const bundles = bundlesQuery.data || [];

  const healthQueries = useQueries({
    queries: targets.map((target) => ({
      queryKey: ["deploy-health", target.id],
      queryFn: () => getDeployInferenceHealth(target.id),
      enabled: Boolean(targetsQuery.data),
      refetchInterval: HEALTH_POLL_MS
    }))
  });

  const investorDayWindow = useMemo(
    () => buildRolling24hWindow(new Date(investorClock)),
    [investorClock]
  );

  const investorLogsQueries = useQueries({
    queries: targets.map((target) => ({
      queryKey: ["deploy-investor-logs", target.id, "rolling-24h"],
      queryFn: () =>
        loadFullHistoryWindowForTarget({
          targetId: target.id,
          sinceTs: investorDayWindow.sinceTs,
          untilTs: investorDayWindow.untilTs
        }),
      enabled: investorKpisEnabled && Boolean(targetsQuery.data),
      staleTime: Math.max(15_000, Math.floor(INVESTOR_REFETCH_MS / 2)),
      refetchInterval: INVESTOR_REFETCH_MS,
      refetchIntervalInBackground: true,
      placeholderData: (previousData: DeployLogsHistoryChunkResponse | undefined) => previousData
    }))
  });

  const bundleDetailsFilesQuery = useQuery({
    queryKey: ["deploy-bundle-files", bundleDetailsTarget?.bundle_id],
    queryFn: () => listDeployBundleFiles(bundleDetailsTarget!.bundle_id),
    enabled: Boolean(bundleDetailsTarget)
  });

  const bundleDetailsFileContentQuery = useQuery({
    queryKey: ["deploy-bundle-content", bundleDetailsTarget?.bundle_id, selectedBundleFilePath],
    queryFn: () => readDeployBundleFileContent(bundleDetailsTarget!.bundle_id, selectedBundleFilePath),
    enabled: Boolean(bundleDetailsTarget && selectedBundleFilePath)
  });

  const healthByTargetId = useMemo(() => {
    const next = new Map<string, DeployInferenceHealth | null>();
    targets.forEach((target, index) => {
      next.set(target.id, (healthQueries[index]?.data as DeployInferenceHealth | undefined) || null);
    });
    return next;
  }, [targets, healthQueries]);

  const investorDataVersion = useMemo(
    () =>
      investorLogsQueries
        .map((query) => {
          const chunk = query.data as DeployLogsHistoryChunkResponse | undefined;
          return `${query.dataUpdatedAt || 0}:${chunk?.lines?.length || 0}:${query.status}`;
        })
        .join("|"),
    [investorLogsQueries]
  );

  const investorInputs = useMemo<DeployInvestorTargetInput[]>(
    () =>
      targets.map((target, index) => {
        const query = investorLogsQueries[index];
        const chunk = query?.data as DeployLogsHistoryChunkResponse | undefined;
        return {
          targetId: target.id,
          targetName: target.name,
          lines: chunk?.lines || [],
          available: chunk?.available,
          message: chunk?.message
        };
      }),
    [targets, investorDataVersion]
  );

  const investorSummary = useMemo<DeployInvestorSummary>(
    () =>
      computeDeployInvestorKpis(investorInputs, {
        windowStartEpochMs: investorDayWindow.sinceEpochMs,
        windowEndEpochMs: investorDayWindow.untilEpochMs
      }),
    [investorInputs, investorDayWindow.sinceEpochMs, investorDayWindow.untilEpochMs]
  );

  const investorByTargetId = useMemo(() => {
    const next = new Map<string, DeployInvestorTargetSnapshot>();
    investorSummary.targets.forEach((entry) => {
      next.set(entry.targetId, entry);
    });
    return next;
  }, [investorSummary.targets]);

  const investorIsLoading = investorLogsQueries.some(
    (query) => (query.isLoading || query.isFetching) && !query.data
  );
  const investorHasLoadedData = investorLogsQueries.some((query) => Boolean(query.data));

  const investorHasErrors = investorLogsQueries.some((query) => query.isError);
  const investorIsRefreshing = investorLogsQueries.some((query) => query.isFetching);
  const investorWindowLabel = useMemo(() => {
    const since = new Date(investorDayWindow.sinceTs);
    const until = new Date(investorDayWindow.untilTs);
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
  }, [investorDayWindow.sinceTs, investorDayWindow.untilTs]);

  const switchMutation = useMutation({
    mutationFn: async (payload: { targetId: string; bundleId: string }) =>
      switchDeployInferenceBundle(payload.targetId, payload.bundleId),
    onSuccess: (result) => {
      const bundles = bundlesQuery.data || [];
      const matchedBundle = bundles.find((item) => item.bundle_id === result.bundle_id);
      notifySuccess("Bundle switched", `${result.target_id} now running ${bundleDisplayName(matchedBundle)}.`);
      setSwitchTarget(null);
      setSwitchBundleId("");
      queryClient.invalidateQueries({ queryKey: ["deploy-health", result.target_id] });
      queryClient.invalidateQueries({ queryKey: ["deploy-targets"] });
    },
    onError: (error) => notifyError("Failed to switch bundle", error)
  });

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => uploadDeployBundleFolder(files),
    onSuccess: (payload) => {
      notifySuccess(
        payload.created ? "Bundle uploaded" : "Bundle already available",
        `${bundleDisplayName(payload.bundle)} is ready.`
      );
      queryClient.invalidateQueries({ queryKey: ["deploy-bundles"] });
    },
    onError: (error) => notifyError("Failed to upload folder", error)
  });

  const deleteMutation = useMutation({
    mutationFn: async (bundleId: string) => deleteDeployBundle(bundleId),
    onSuccess: (payload) => {
      notifyInfo("Bundle removed", `${payload.bundle_id} removed from catalog.`);
      setDeleteTargetBundle(null);
      if (bundleDetailsTarget?.bundle_id === payload.bundle_id) {
        setBundleDetailsTarget(null);
        setSelectedBundleFilePath("");
      }
      queryClient.invalidateQueries({ queryKey: ["deploy-bundles"] });
    },
    onError: (error) => notifyError("Failed to delete bundle", error)
  });

  const switchTargetBundles = useMemo(
    () => filterBundlesForTarget(bundles, switchTarget),
    [bundles, switchTarget]
  );
  const selectedSwitchBundle = switchTargetBundles.find((bundle) => bundle.bundle_id === switchBundleId) || null;
  const visibleBundleFiles = useMemo(
    () => (bundleDetailsFilesQuery.data?.files || []).filter((file) => isBundlePreviewFile(file.path)),
    [bundleDetailsFilesQuery.data]
  );
  const renderedLogsText = useMemo(
    () =>
      formatLogsForDisplay(logsText, {
        hideHealthNoise: logsHideHealthNoise,
        markInferenceCycles: logsMarkInferenceCycles
      }),
    [logsText, logsHideHealthNoise, logsMarkInferenceCycles]
  );
  const renderedLogsHistoryText = useMemo(() => {
    if (!logsHistoryChunk) return "";
    return logsHistoryChunk.lines
      .map((line) => `[${formatHistoryLineTs(line.ts)}] (${line.source}) ${line.text}`)
      .join("\n");
  }, [logsHistoryChunk]);
  const logsStatusLabel = logsStreaming ? "Live" : logsPaused ? "Paused" : "Idle";
  const logsStatusClass = logsStreaming ? "is-live" : logsPaused ? "is-paused" : "is-idle";
  const historyHasPaging = Boolean(logsHistoryChunk?.has_more_before || logsHistoryChunk?.has_more_after);
  const logsHistoryCurrentWindowLabel = useMemo(
    () => historyWindowLabelFromRange(logsHistoryQuickRange, logsHistorySinceInput, logsHistoryUntilInput),
    [logsHistoryQuickRange, logsHistorySinceInput, logsHistoryUntilInput]
  );
  const logsHistoryHasPendingChanges = useMemo(() => {
    if (!logsHistoryAppliedQuery) return false;
    return (
      logsHistoryAppliedWindowLabel !== logsHistoryCurrentWindowLabel ||
      logsHistoryAppliedQuery.search !== logsHistorySearch
    );
  }, [
    logsHistoryAppliedQuery,
    logsHistoryAppliedWindowLabel,
    logsHistoryCurrentWindowLabel,
    logsHistorySearch
  ]);
  const logsHistoryRangeSummary = useMemo(
    () => formatHistoryRangeSummary(logsHistorySinceInput, logsHistoryUntilInput),
    [logsHistorySinceInput, logsHistoryUntilInput]
  );
  const logsHistoryDraftSinceDate = useMemo(
    () => parseDateTimeLocalInput(logsHistoryDraftSinceInput),
    [logsHistoryDraftSinceInput]
  );
  const logsHistoryDraftUntilDate = useMemo(
    () => parseDateTimeLocalInput(logsHistoryDraftUntilInput),
    [logsHistoryDraftUntilInput]
  );

  useEffect(() => {
    if (!fileInputRef.current) return;
    fileInputRef.current.setAttribute("webkitdirectory", "");
    fileInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setInvestorKpisEnabled(true);
    }, INVESTOR_KPI_INIT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!investorKpisEnabled) return;
    const timer = window.setInterval(() => {
      setInvestorClock(Date.now());
    }, INVESTOR_CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [investorKpisEnabled]);

  useEffect(() => {
    if (!logsOpen || logsMode !== "live" || !logsAutoScroll) return;
    const pre = logsPreRef.current;
    if (!pre) return;
    pre.scrollTop = pre.scrollHeight;
  }, [renderedLogsText, logsOpen, logsAutoScroll, logsMode]);

  useEffect(() => {
    return () => {
      logsAbortRef.current?.abort();
      logsAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    setSelectedBundleFilePath("");
  }, [bundleDetailsTarget?.bundle_id]);

  useEffect(() => {
    const files = visibleBundleFiles;
    if (files.length === 0) {
      setSelectedBundleFilePath("");
      return;
    }
    if (!selectedBundleFilePath || !files.some((entry) => entry.path === selectedBundleFilePath)) {
      setSelectedBundleFilePath(files[0].path);
    }
  }, [visibleBundleFiles, selectedBundleFilePath]);

  useEffect(() => {
    if (!switchTarget) return;
    if (switchTargetBundles.length === 0) {
      setSwitchBundleId("");
      return;
    }
    if (!switchTargetBundles.some((bundle) => bundle.bundle_id === switchBundleId)) {
      setSwitchBundleId(switchTargetBundles[0].bundle_id);
    }
  }, [switchBundleId, switchTarget, switchTargetBundles]);

  async function startLogsStream(target: DeployInferenceTarget): Promise<void> {
    logsAbortRef.current?.abort();
    const controller = new AbortController();
    logsAbortRef.current = controller;

    setLogsStreaming(true);
    try {
      const response = await openDeployLogsStream(target.id, DEFAULT_LOG_TAIL, controller.signal);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No log stream available from backend.");

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        setLogsText((previous) => {
          const next = `${previous}${chunk}`;
          if (next.length <= LOG_BUFFER_MAX_CHARS) return next;
          return next.slice(next.length - LOG_BUFFER_MAX_CHARS);
        });
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      notifyError("Could not stream inference logs", error);
    } finally {
      setLogsStreaming(false);
    }
  }

  function resetLogsHistoryDraft(hours: number): void {
    const now = new Date();
    const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
    const sinceInput = toDateTimeLocalInput(since);
    const untilInput = toDateTimeLocalInput(now);
    setLogsHistorySinceInput(sinceInput);
    setLogsHistoryUntilInput(untilInput);
    setLogsHistoryDraftSinceInput(sinceInput);
    setLogsHistoryDraftUntilInput(untilInput);
  }

  function onSelectHistoryQuickRange(range: DeployHistoryQuickRange): void {
    setLogsHistoryQuickRange(range);
    setLogsHistoryRangePopoverOpen(false);
    setLogsHistoryActiveDateField(null);
    if (range === "1h") resetLogsHistoryDraft(1);
    if (range === "6h") resetLogsHistoryDraft(6);
    if (range === "24h") resetLogsHistoryDraft(24);
  }

  function toggleLogsHistoryRangePopover(): void {
    setLogsHistoryRangePopoverOpen((previous) => {
      const next = !previous;
      if (next) {
        setLogsHistoryDraftSinceInput(logsHistorySinceInput);
        setLogsHistoryDraftUntilInput(logsHistoryUntilInput);
        const sinceDate = parseDateTimeLocalInput(logsHistorySinceInput);
        if (sinceDate) {
          setLogsHistoryCalendarMonth(new Date(sinceDate.getFullYear(), sinceDate.getMonth(), 1));
        }
        if (logsHistoryActiveDateField === null) {
          setLogsHistoryActiveDateField("since");
        }
      } else {
        setLogsHistoryActiveDateField(null);
      }
      return next;
    });
  }

  function setLogsHistoryDraftDate(field: DeployHistoryDateField, date: Date | undefined): void {
    if (!date) return;
    if (field === "since") {
      const nextSince = applyDateAndTime(startOfDay(date), extractTimePart(logsHistoryDraftSinceInput, "00:00"));
      setLogsHistoryDraftSinceInput(nextSince);
      const untilDate = parseDateTimeLocalInput(logsHistoryDraftUntilInput);
      const sinceDate = parseDateTimeLocalInput(nextSince);
      if (!untilDate || (sinceDate && untilDate.getTime() < sinceDate.getTime())) {
        setLogsHistoryDraftUntilInput(nextSince);
      }
      setLogsHistoryActiveDateField("until");
      setLogsHistoryCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      return;
    }

    const nextUntil = applyDateAndTime(startOfDay(date), extractTimePart(logsHistoryDraftUntilInput, "00:00"));
    setLogsHistoryDraftUntilInput(nextUntil);
    setLogsHistoryCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  function applyLogsHistoryDraftRange(): void {
    const sinceDate = parseDateTimeLocalInput(logsHistoryDraftSinceInput);
    const untilDate = parseDateTimeLocalInput(logsHistoryDraftUntilInput);
    if (!sinceDate || !untilDate || sinceDate.getTime() > untilDate.getTime()) {
      notifyError("Invalid history time window", new Error("Start time must be before end time."));
      return;
    }
    setLogsHistorySinceInput(logsHistoryDraftSinceInput);
    setLogsHistoryUntilInput(logsHistoryDraftUntilInput);
    setLogsHistoryQuickRange("custom");
    setLogsHistoryRangePopoverOpen(false);
    setLogsHistoryActiveDateField(null);
  }

  function switchLogsMode(mode: DeployLogsMode): void {
    if (mode === logsMode) return;
    setLogsMode(mode);

    if (mode === "history") {
      logsAbortRef.current?.abort();
      logsAbortRef.current = null;
      setLogsStreaming(false);
      setLogsPaused(false);
      if (logsTarget) {
        setLogsHistoryChunk(null);
        void loadLogsHistoryChunk();
      }
      return;
    }

    if (logsTarget) {
      setLogsHistoryRangePopoverOpen(false);
      setLogsHistoryActiveDateField(null);
      setLogsPaused(false);
      void startLogsStream(logsTarget);
    }
  }

  async function loadLogsHistoryChunk(cursor?: string, useAppliedQuery = false): Promise<void> {
    if (!logsTarget) return;

    let sinceTs: string;
    let untilTs: string;
    let searchValue: string;

    if (useAppliedQuery && logsHistoryAppliedQuery) {
      sinceTs = logsHistoryAppliedQuery.sinceTs;
      untilTs = logsHistoryAppliedQuery.untilTs;
      searchValue = logsHistoryAppliedQuery.search;
    } else {
      const sinceDate = parseDateTimeLocalInput(logsHistorySinceInput);
      const untilDate = parseDateTimeLocalInput(logsHistoryUntilInput);

      if (!sinceDate || !untilDate) {
        notifyError("Invalid history time window", new Error("Please provide valid start and end timestamps."));
        return;
      }
      if (sinceDate.getTime() > untilDate.getTime()) {
        notifyError("Invalid history time window", new Error("Start time must be before end time."));
        return;
      }

      sinceTs = sinceDate.toISOString();
      untilTs = untilDate.toISOString();
      searchValue = logsHistorySearch;
      setLogsHistoryAppliedQuery({
        sinceTs,
        untilTs,
        search: searchValue
      });
      setLogsHistoryAppliedWindowLabel(
        historyWindowLabelFromRange(logsHistoryQuickRange, logsHistorySinceInput, logsHistoryUntilInput)
      );
    }

    setLogsHistoryLoading(true);
    try {
      const payload = await getDeployLogsHistoryChunk(logsTarget.id, {
        sinceTs,
        untilTs,
        cursor,
        limitLines: HISTORY_LIMIT_LINES,
        search: searchValue
      });
      setLogsHistoryChunk(payload);
    } catch (error) {
      notifyError("Could not load log history", error);
    } finally {
      setLogsHistoryLoading(false);
    }
  }

  function applyLogsHistoryFilters(): void {
    setLogsHistoryRangePopoverOpen(false);
    setLogsHistoryActiveDateField(null);
    void loadLogsHistoryChunk();
  }

  function loadOlderLogsHistory(): void {
    const cursor = logsHistoryChunk?.next_cursor;
    if (!cursor || logsHistoryLoading) return;
    void loadLogsHistoryChunk(cursor, true);
  }

  function loadNewerLogsHistory(): void {
    const cursor = logsHistoryChunk?.prev_cursor;
    if (!cursor || logsHistoryLoading) return;
    void loadLogsHistoryChunk(cursor, true);
  }

  function closeLogsModal(): void {
    logsAbortRef.current?.abort();
    logsAbortRef.current = null;
    setLogsOpen(false);
    setLogsTarget(null);
    setLogsMode("live");
    setLogsStreaming(false);
    setLogsPaused(false);
    setLogsHistoryChunk(null);
    setLogsHistoryAppliedQuery(null);
    setLogsHistorySearch("");
    setLogsHistoryRangePopoverOpen(false);
    setLogsHistoryActiveDateField(null);
    setLogsHistoryCalendarMonth(undefined);
    setLogsHistoryQuickRange("6h");
    resetLogsHistoryDraft(HISTORY_DEFAULT_HOURS);
    setLogsHistoryAppliedWindowLabel("Window: Last 6h");
  }

  function openLogsForTarget(target: DeployInferenceTarget): void {
    setLogsTarget(target);
    setLogsMode("live");
    setLogsText("");
    setLogsPaused(false);
    setLogsHistoryChunk(null);
    setLogsHistoryAppliedQuery(null);
    setLogsHistorySearch("");
    setLogsHistoryRangePopoverOpen(false);
    setLogsHistoryActiveDateField(null);
    setLogsHistoryCalendarMonth(undefined);
    setLogsHistoryQuickRange("6h");
    resetLogsHistoryDraft(HISTORY_DEFAULT_HOURS);
    setLogsHistoryAppliedWindowLabel("Window: Last 6h");
    setLogsOpen(true);
    void startLogsStream(target);
  }

  function toggleLogsPauseResume(): void {
    if (!logsTarget) return;

    if (logsPaused) {
      setLogsPaused(false);
      void startLogsStream(logsTarget);
      return;
    }

    logsAbortRef.current?.abort();
    logsAbortRef.current = null;
    setLogsPaused(true);
    setLogsStreaming(false);
  }

  function openBundleDetails(bundle: DeployBundleRecord): void {
    setBundleDetailsTarget(bundle);
  }

  function openBundleDetailsById(bundleId: string): void {
    const inCatalog = findBundleByManifestKey(bundles, bundleId);
    if (inCatalog) {
      openBundleDetails(inCatalog);
      return;
    }
    notifyInfo("Bundle not in catalog", `Active bundle ${bundleId} is not available in the catalog list.`);
    setBundleDetailsTarget({
      bundle_id: bundleId,
      name: bundleId,
      artifacts_dir_host: "",
      manifest_path_host: ""
    });
  }

  function closeBundleDetails(): void {
    setBundleDetailsTarget(null);
    setSelectedBundleFilePath("");
  }

  function openSwitchModal(target: DeployInferenceTarget, activeBundleId: string | null): void {
    if (bundles.length === 0) {
      notifyInfo("No bundles available", "Upload at least one bundle before switching.");
      return;
    }
    const filtered = filterBundlesForTarget(bundles, target);
    if (filtered.length === 0) {
      notifyInfo("No matching bundles", `No bundle names matched ${target.name}.`);
      return;
    }
    const activeBundle = findBundleByManifestKey(filtered, activeBundleId);
    const preferred = activeBundle?.bundle_id || filtered[0].bundle_id;
    setSwitchTarget(target);
    setSwitchBundleId(preferred);
  }

  function closeSwitchModal(): void {
    setSwitchTarget(null);
    setSwitchBundleId("");
  }

  function confirmSwitchBundle(): void {
    if (!switchTarget || !switchBundleId) return;
    switchMutation.mutate({
      targetId: switchTarget.id,
      bundleId: switchBundleId
    });
  }

  function onSelectFolderFiles(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    uploadMutation.mutate(files);
    event.target.value = "";
  }

  async function refreshWithPreview(): Promise<void> {
    if (refreshingVisual) return;
    setRefreshingVisual(true);
    setInvestorClock(Date.now());
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["deploy-targets"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["deploy-bundles"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["deploy-health"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["deploy-investor-logs"], type: "active" })
      ]);
    } finally {
      setRefreshingVisual(false);
    }
  }

  return (
    <div className="page jobs-page">
      <header className="jobs-hero">
        <div>
          <h1>Deploy</h1>
        </div>
        <div className="jobs-command-group">
          <Button
            variant="secondary"
            iconLeft={!refreshingVisual ? <RefreshCcw size={14} /> : undefined}
            onClick={refreshWithPreview}
            disabled={refreshingVisual}
          >
            {refreshingVisual ? <EVChargingLoader compact label="Refreshing..." /> : "Refresh"}
          </Button>
          <Button
            variant="primary"
            iconLeft={<Upload size={14} />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            {uploadMutation.isPending ? "Uploading..." : "Add bundle folder"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={onSelectFolderFiles}
            style={{ display: "none" }}
          />
        </div>
      </header>

      <section className="panel deploy-investor-strip">
        <header className="deploy-investor-head">
          <div>
            <h2>KPIs (Last 24h)</h2>
            <small>
              Rolling 24h window: {investorWindowLabel}
              {investorSummary.global.sourceTargetName
                ? ` · Global source: ${investorSummary.global.sourceTargetName}`
                : ""}
            </small>
          </div>
          {investorIsLoading || investorIsRefreshing ? (
            <div className="deploy-investor-loading" role="status" aria-live="polite">
              <EVChargingLoader compact label={investorIsLoading ? "Loading KPIs..." : "Updating KPIs..."} />
            </div>
          ) : null}
        </header>

        <div className="deploy-investor-global-grid">
          <article className="deploy-investor-global-card">
            <header>
              <span>Saved (24h)</span>
              <span className="deploy-investor-help" tabIndex={0}>
                <Info size={13} />
                <span className="deploy-investor-help-tooltip">
                  Estimated from logs using RH01 tariff snapshots. Community imports are charged at 70% of price and
                  exports are credited at 70% of price.
                </span>
              </span>
            </header>
            <strong>{formatInvestorCurrency(investorSummary.global.savedEur)}</strong>
            <small className="deploy-investor-card-meta">
              {investorSummary.global.savedPct !== null
                ? `${formatInvestorSavedPercent(investorSummary.global.savedPct)} vs grid baseline`
                : "No baseline"}
            </small>
          </article>

          <article className="deploy-investor-global-card">
            <header>
              <span>Community Energy Share</span>
              <span className="deploy-investor-help" tabIndex={0}>
                <Info size={13} />
                <span className="deploy-investor-help-tooltip">
                  Share of demand covered by community sources, excluding this target's own solar.
                </span>
              </span>
            </header>
            <strong>{formatInvestorPercent(investorSummary.global.communitySharePct)}</strong>
          </article>

          <article className="deploy-investor-global-card">
            <header>
              <span>Solar Self-Consumption</span>
              <span className="deploy-investor-help" tabIndex={0}>
                <Info size={13} />
                <span className="deploy-investor-help-tooltip">
                  Average of target-level rates for own solar consumed locally (local demand including EV and battery
                  charging).
                </span>
              </span>
            </header>
            <strong>{formatInvestorPercent(investorSummary.global.solarSelfConsumptionPct)}</strong>
          </article>
        </div>

        <div className="deploy-investor-footnote">
          {!investorKpisEnabled ? "Preparing KPI snapshot..." : null}
          {investorIsLoading && !investorHasLoadedData ? "Loading investor KPIs..." : null}
          {!investorIsLoading && investorIsRefreshing ? "Updating in background..." : null}
          {!investorIsLoading && !investorIsRefreshing && investorHasErrors
            ? "Some targets could not be loaded. Values may be partial."
            : null}
          {!investorIsLoading && !investorIsRefreshing && !investorHasErrors && investorSummary.global.message
            ? investorSummary.global.message
            : null}
        </div>
      </section>

      <section className="deploy-manager-layout">
        <article className="panel deploy-manager-main">
          <header className="deploy-manager-panel-head">
            <h2>Running Inferences</h2>
            <small>{targets.length} configured targets</small>
          </header>

          {targets.length === 0 ? (
            <EmptyState title="No inference targets" message="Configure DEPLOY_INFERENCE_TARGETS in backend settings." />
          ) : (
            <div className="deploy-manager-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Health</th>
                    <th className="deploy-active-bundle-header">Active Bundle</th>
                    <th>24h Snapshot</th>
                    <th className="deploy-data-header">Data</th>
                    <th className="deploy-actions-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((target, index) => {
                    const health = healthByTargetId.get(target.id) || null;
                    const summary = summarizeHealth(health);
                    const activeBundleId = extractBundleIdFromManifestPath(health?.active_manifest_path);
                    const activeBundle = findBundleByManifestKey(bundles, activeBundleId);
                    const activeBundleLabel = bundleDisplayName(activeBundle || undefined);
                    const investorQuery = investorLogsQueries[index];
                    const investorSnapshot = investorByTargetId.get(target.id) || null;
                    const hasInvestorData = Boolean(investorQuery?.data);

                    return (
                      <tr key={target.id}>
                        <td>
                          <div className="deploy-target-name">
                            <strong>{target.name}</strong>
                          </div>
                        </td>
                        <td>
                          <span className={`deploy-health-pill ${summary.cssClass}`}>{summary.label}</span>
                        </td>
                        <td className="deploy-active-bundle-col">
                          {activeBundleId ? (
                            <button
                              type="button"
                              className="btn-link deploy-active-bundle-link"
                              onClick={() => openBundleDetailsById(activeBundleId)}
                              title={`See bundle details: ${activeBundleLabel}${
                                activeBundleId !== activeBundleLabel ? ` (${activeBundleId})` : ""
                              }`}
                            >
                              {activeBundleLabel}
                            </button>
                          ) : (
                            <span>-</span>
                          )}
                        </td>
                        <td className="deploy-investor-target-cell">
                          {investorSnapshot && hasInvestorData ? (
                            <div className="deploy-investor-target-grid">
                              <article className="deploy-investor-mini-card" title="Saved in this rolling 24h window">
                                <small>Saved</small>
                                <strong className="deploy-investor-mini-value">
                                  {formatInvestorCurrency(investorSnapshot.savedEur)}
                                </strong>
                                <span className="deploy-investor-mini-meta">
                                  {investorSnapshot.savedPct !== null
                                    ? formatInvestorSavedPercent(investorSnapshot.savedPct)
                                    : "N/A"}
                                </span>
                              </article>
                              <article className="deploy-investor-mini-card" title="Community energy share">
                                <small>Community</small>
                                <strong className="deploy-investor-mini-value">
                                  {formatInvestorPercent(investorSnapshot.communitySharePct)}
                                </strong>
                                <span className="deploy-investor-mini-meta is-placeholder">-</span>
                              </article>
                              <article className="deploy-investor-mini-card" title="Own solar self-consumption">
                                <small>Solar</small>
                                <strong className="deploy-investor-mini-value">
                                  {formatInvestorPercent(investorSnapshot.solarSelfConsumptionPct)}
                                </strong>
                                <span className="deploy-investor-mini-meta is-placeholder">-</span>
                              </article>
                            </div>
                          ) : (
                            <div className="deploy-investor-target-grid is-loading">
                              <article className="deploy-investor-mini-card is-skeleton">
                                <small>Saved</small>
                                <strong className="deploy-investor-mini-value">--</strong>
                                <span className="deploy-investor-mini-meta is-placeholder">-</span>
                              </article>
                              <article className="deploy-investor-mini-card is-skeleton">
                                <small>Community</small>
                                <strong className="deploy-investor-mini-value">--</strong>
                                <span className="deploy-investor-mini-meta is-placeholder">-</span>
                              </article>
                              <article className="deploy-investor-mini-card is-skeleton">
                                <small>Solar</small>
                                <strong className="deploy-investor-mini-value">--</strong>
                                <span className="deploy-investor-mini-meta is-placeholder">-</span>
                              </article>
                            </div>
                          )}
                        </td>
                        <td className="deploy-data-cell">
                          {investorSnapshot && hasInvestorData ? (
                            <div className="deploy-data-cell-content">
                              {investorSnapshot.message ? (
                                <span className="deploy-data-warning" title={investorSnapshot.message} aria-label="Data warning">
                                  <AlertTriangle size={12} />
                                </span>
                              ) : null}
                              <span
                                className={`deploy-investor-coverage-badge ${investorCoverageClass(
                                  investorSnapshot.coveragePct
                                )}`}
                              >
                                {formatInvestorCoverage(investorSnapshot)}
                              </span>
                            </div>
                          ) : (
                            <span className="deploy-data-placeholder">--</span>
                          )}
                        </td>
                        <td className="deploy-actions-cell">
                          <div className="table-actions deploy-manager-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              iconLeft={<ArrowRightLeft size={13} />}
                              iconOnly
                              title="Switch bundle"
                              aria-label="Switch bundle"
                              onClick={() => openSwitchModal(target, activeBundleId)}
                              disabled={switchMutation.isPending || bundles.length === 0}
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              iconLeft={<Eye size={13} />}
                              iconOnly
                              title="Open logs"
                              aria-label="Open logs"
                              onClick={() => openLogsForTarget(target)}
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              iconLeft={<BarChart3 size={13} />}
                              iconOnly
                              title="Open charts"
                              aria-label="Open charts"
                              onClick={() => navigate(`/app/ai/deploy/${encodeURIComponent(target.id)}/charts`)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <aside className="panel deploy-manager-side">
          <header className="deploy-manager-panel-head">
            <h2>Bundles</h2>
            <small>{bundles.length} bundles</small>
          </header>

          {bundles.length === 0 ? (
            <p className="jobs-meta">No bundles uploaded yet.</p>
          ) : (
            <div className="deploy-manager-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Bundle</th>
                    <th className="deploy-actions-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bundles.map((bundle) => (
                    <tr key={bundle.bundle_id}>
                      <td>
                        <div className="deploy-bundle-name">
                          <strong>{bundleDisplayName(bundle)}</strong>
                          <small>{bundle.bundle_id}</small>
                        </div>
                      </td>
                      <td className="deploy-actions-cell">
                        <div className="table-actions deploy-bundle-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`See more details for ${bundleDisplayName(bundle)}`}
                            title="See more"
                            onClick={() => openBundleDetails(bundle)}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn-danger"
                            aria-label={`Delete ${bundleDisplayName(bundle)}`}
                            title="Delete"
                            onClick={() => setDeleteTargetBundle(bundle)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </aside>
      </section>

      <Modal
        title={`Switch Bundle: ${switchTarget?.name || "-"}`}
        open={Boolean(switchTarget)}
        onClose={() => {
          if (!switchMutation.isPending) closeSwitchModal();
        }}
        width="sm"
      >
        <section className="deploy-switch-modal">
          <p className="jobs-meta">
            Select the bundle to activate on <strong>{switchTarget?.name || "-"}</strong>.
          </p>
          <label className="deploy-switch-field">
            <span>Bundle</span>
            <select value={switchBundleId} onChange={(event) => setSwitchBundleId(event.target.value)}>
              {switchTargetBundles.map((bundle) => (
                <option key={bundle.bundle_id} value={bundle.bundle_id}>
                  {bundleDisplayName(bundle)}
                </option>
              ))}
            </select>
          </label>
          <div className="deploy-switch-selected">
            <small>Selected bundle</small>
            <strong>{bundleDisplayName(selectedSwitchBundle)}</strong>
            <code>{selectedSwitchBundle?.bundle_id || "-"}</code>
          </div>
          <div className="inline-end deploy-switch-actions">
            <Button variant="secondary" onClick={closeSwitchModal} disabled={switchMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={confirmSwitchBundle}
              disabled={!switchBundleId || switchMutation.isPending || switchTargetBundles.length === 0}
            >
              {switchMutation.isPending ? "Switching..." : "Confirm Switch"}
            </Button>
          </div>
        </section>
      </Modal>

      <Modal
        title={`Bundle: ${bundleDisplayName(bundleDetailsTarget || undefined)}`}
        open={Boolean(bundleDetailsTarget)}
        onClose={closeBundleDetails}
        width="lg"
      >
        <section className="deploy-bundle-modal-content">
          <div className="deploy-bundle-meta">
            <div>
              <small>Name</small>
              <strong>{bundleDisplayName(bundleDetailsTarget || undefined)}</strong>
            </div>
            <div>
              <small>ID</small>
              <code>{bundleDetailsTarget?.bundle_id || "-"}</code>
            </div>
          </div>

          <div className="deploy-bundle-browser">
            <aside className="deploy-bundle-files-list">
              {bundleDetailsFilesQuery.isLoading ? <p className="jobs-meta">Loading files...</p> : null}
              {bundleDetailsFilesQuery.isError ? (
                <p className="error-text">Could not load bundle files.</p>
              ) : null}
              {!bundleDetailsFilesQuery.isLoading &&
              !bundleDetailsFilesQuery.isError &&
              visibleBundleFiles.length === 0 ? (
                <p className="jobs-meta">No supported files found for this bundle.</p>
              ) : null}
              <ul>
                {visibleBundleFiles.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={`deploy-bundle-file-btn${selectedBundleFilePath === file.path ? " is-active" : ""}`}
                      onClick={() => setSelectedBundleFilePath(file.path)}
                    >
                      <span>{file.path}</span>
                      <small>{formatBytes(file.size_bytes)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>

            <section className="deploy-bundle-file-preview">
              {!selectedBundleFilePath ? <p className="jobs-meta">Select a file to preview.</p> : null}
              {selectedBundleFilePath && bundleDetailsFileContentQuery.isLoading ? (
                <p className="jobs-meta">Loading file content...</p>
              ) : null}
              {selectedBundleFilePath && bundleDetailsFileContentQuery.isError ? (
                <p className="error-text">Could not load file content.</p>
              ) : null}
              {selectedBundleFilePath &&
              bundleDetailsFileContentQuery.data &&
              !bundleDetailsFileContentQuery.data.is_text ? (
                <p className="jobs-meta">Binary file preview is not available.</p>
              ) : null}
              {selectedBundleFilePath &&
              bundleDetailsFileContentQuery.data &&
              bundleDetailsFileContentQuery.data.is_text &&
              bundleDetailsFileContentQuery.data.content !== null ? (
                <>
                  <pre className="json-view deploy-bundle-file-content">
                    {bundleDetailsFileContentQuery.data.content}
                  </pre>
                  {bundleDetailsFileContentQuery.data.truncated ? (
                    <small className="jobs-meta">Preview truncated to 200 KB.</small>
                  ) : null}
                </>
              ) : null}
            </section>
          </div>
        </section>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTargetBundle)}
        title="Delete Bundle"
        message={
          deleteTargetBundle
            ? `Are you sure you want to delete "${bundleDisplayName(deleteTargetBundle)}"?`
            : "Are you sure you want to delete this bundle?"
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        pending={deleteMutation.isPending}
        onCancel={() => {
          if (!deleteMutation.isPending) setDeleteTargetBundle(null);
        }}
        onConfirm={() => {
          if (!deleteTargetBundle) return;
          deleteMutation.mutate(deleteTargetBundle.bundle_id);
        }}
      />

      <Modal
        title={`Inference Logs: ${logsTarget?.name || "-"}`}
        open={logsOpen}
        onClose={closeLogsModal}
        width="lg"
      >
        <section className="deploy-logs-modal-content">
          <div className="deploy-logs-mode-switch" role="tablist" aria-label="Log mode">
            <button
              type="button"
              className={`deploy-logs-mode-btn${logsMode === "live" ? " is-active" : ""}`}
              onClick={() => switchLogsMode("live")}
              aria-pressed={logsMode === "live"}
            >
              Live
            </button>
            <button
              type="button"
              className={`deploy-logs-mode-btn${logsMode === "history" ? " is-active" : ""}`}
              onClick={() => switchLogsMode("history")}
              aria-pressed={logsMode === "history"}
            >
              History
            </button>
          </div>

          {logsMode === "live" ? (
            <>
              <div className="deploy-logs-toolbar">
                <div className="deploy-logs-toolbar-main">
                  <div className="deploy-logs-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      iconLeft={logsPaused ? <Play size={13} /> : <Pause size={13} />}
                      onClick={toggleLogsPauseResume}
                      disabled={!logsTarget}
                    >
                      {logsPaused ? "Resume" : "Pause"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setLogsText("")}>
                      Clear
                    </Button>
                  </div>
                  <div className={`deploy-logs-status ${logsStatusClass}`}>
                    <span className="deploy-logs-status-dot" aria-hidden="true" />
                    <span>{logsStatusLabel}</span>
                  </div>
                </div>
                <div className="deploy-logs-toolbar-toggles">
                  <label className="deploy-logs-toggle">
                    <input
                      type="checkbox"
                      checked={logsAutoScroll}
                      onChange={(event) => setLogsAutoScroll(event.target.checked)}
                    />
                    Auto-scroll
                  </label>
                  <label className="deploy-logs-toggle">
                    <input
                      type="checkbox"
                      checked={logsHideHealthNoise}
                      onChange={(event) => setLogsHideHealthNoise(event.target.checked)}
                    />
                    Hide health logs
                  </label>
                  <label className="deploy-logs-toggle">
                    <input
                      type="checkbox"
                      checked={logsMarkInferenceCycles}
                      onChange={(event) => setLogsMarkInferenceCycles(event.target.checked)}
                    />
                    Mark inference cycles
                  </label>
                </div>
              </div>

              <pre ref={logsPreRef} className="json-view deploy-logs-view" role="log" aria-live="polite">
                {renderedLogsText || "No logs received yet."}
              </pre>
            </>
          ) : (
            <>
              <div className="deploy-logs-history-toolbar timeseries-toolbar">
                <div className="timeseries-toolbar-left">
                  <div className="segmented-row" role="group" aria-label="History quick range">
                    <button
                      type="button"
                      className={`segment-btn${logsHistoryQuickRange === "1h" ? " is-active" : ""}`}
                      onClick={() => onSelectHistoryQuickRange("1h")}
                    >
                      Last 1h
                    </button>
                    <button
                      type="button"
                      className={`segment-btn${logsHistoryQuickRange === "6h" ? " is-active" : ""}`}
                      onClick={() => onSelectHistoryQuickRange("6h")}
                    >
                      Last 6h
                    </button>
                    <button
                      type="button"
                      className={`segment-btn${logsHistoryQuickRange === "24h" ? " is-active" : ""}`}
                      onClick={() => onSelectHistoryQuickRange("24h")}
                    >
                      Last 24h
                    </button>
                    <button
                      type="button"
                      className={`segment-btn${logsHistoryQuickRange === "custom" ? " is-active" : ""}`}
                      onClick={() => onSelectHistoryQuickRange("custom")}
                    >
                      Custom
                    </button>
                  </div>
                  <label className="timeseries-time-field deploy-logs-history-search">
                    <span>Search</span>
                    <input
                      type="search"
                      placeholder="Substring search..."
                      value={logsHistorySearch}
                      onChange={(event) => setLogsHistorySearch(event.target.value)}
                    />
                  </label>
                </div>
                <div className="timeseries-toolbar-right deploy-logs-history-right">
                  <button
                    type="button"
                    className={`timeseries-range-trigger${logsHistoryRangePopoverOpen ? " is-open" : ""}`}
                    onClick={toggleLogsHistoryRangePopover}
                    title="Adjust history range"
                  >
                    <CalendarDays size={15} />
                    <span className="timeseries-range-trigger-copy">
                      <small>History range</small>
                      <strong>{logsHistoryRangeSummary}</strong>
                    </span>
                    <ChevronDown size={14} />
                  </button>

                  {logsHistoryRangePopoverOpen ? (
                    <div className="timeseries-range-popover panel">
                      <div className="timeseries-range-head">
                        <div>
                          <strong>Select history window</strong>
                          <small>Choose start/end date and time in local timezone.</small>
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
                            className={`timeseries-date-trigger${logsHistoryActiveDateField === "since" ? " is-active" : ""}`}
                            onClick={() =>
                              setLogsHistoryActiveDateField((previous) => (previous === "since" ? null : "since"))
                            }
                          >
                            {logsHistoryDraftSinceDate ? formatPickerDay(logsHistoryDraftSinceDate) : "Select date"}
                          </button>
                          <TimeInput24
                            value={extractTimePart(logsHistoryDraftSinceInput)}
                            ariaLabel="Since time"
                            onChange={(nextTime) => {
                              const base = logsHistoryDraftSinceDate ?? new Date();
                              setLogsHistoryDraftSinceInput(applyDateAndTime(base, nextTime));
                            }}
                          />
                        </div>
                        <div className="timeseries-date-field">
                          <span>Until</span>
                          <button
                            type="button"
                            className={`timeseries-date-trigger${logsHistoryActiveDateField === "until" ? " is-active" : ""}`}
                            onClick={() =>
                              setLogsHistoryActiveDateField((previous) => (previous === "until" ? null : "until"))
                            }
                          >
                            {logsHistoryDraftUntilDate ? formatPickerDay(logsHistoryDraftUntilDate) : "Select date"}
                          </button>
                          <TimeInput24
                            value={extractTimePart(logsHistoryDraftUntilInput)}
                            ariaLabel="Until time"
                            onChange={(nextTime) => {
                              const base = logsHistoryDraftUntilDate ?? logsHistoryDraftSinceDate ?? new Date();
                              setLogsHistoryDraftUntilInput(applyDateAndTime(base, nextTime));
                            }}
                          />
                        </div>
                      </div>
                      {logsHistoryActiveDateField ? (
                        <div className="timeseries-mini-calendar">
                          <DayPicker
                            className="timeseries-daypicker"
                            mode="single"
                            numberOfMonths={1}
                            showOutsideDays
                            month={logsHistoryCalendarMonth}
                            onMonthChange={setLogsHistoryCalendarMonth}
                            selected={
                              logsHistoryActiveDateField === "since" ? logsHistoryDraftSinceDate || undefined : logsHistoryDraftUntilDate || undefined
                            }
                            onSelect={(date) => setLogsHistoryDraftDate(logsHistoryActiveDateField, date)}
                          />
                        </div>
                      ) : null}
                      <div className="timeseries-range-actions">
                        <button
                          type="button"
                          className="segment-btn"
                          onClick={() => {
                            setLogsHistoryRangePopoverOpen(false);
                            setLogsHistoryActiveDateField(null);
                            setLogsHistoryDraftSinceInput(logsHistorySinceInput);
                            setLogsHistoryDraftUntilInput(logsHistoryUntilInput);
                          }}
                        >
                          Cancel
                        </button>
                        <button type="button" className="segment-btn is-primary" onClick={applyLogsHistoryDraftRange}>
                          Apply
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="segment-btn is-primary"
                    onClick={applyLogsHistoryFilters}
                    disabled={logsHistoryLoading}
                  >
                    {logsHistoryLoading ? "Loading..." : "Apply"}
                  </button>
                </div>
              </div>

              <div className="deploy-logs-history-meta">
                <span className="deploy-logs-chip">
                  {logsHistoryAppliedQuery ? `Applied: ${logsHistoryAppliedWindowLabel}` : logsHistoryCurrentWindowLabel}
                </span>
                {logsHistoryHasPendingChanges ? <span className="deploy-logs-chip">Pending changes</span> : null}
                {historyHasPaging ? <span className="deploy-logs-chip is-accent">Paged history</span> : null}
                {logsHistoryChunk && !logsHistoryChunk.available ? (
                  <span className="deploy-logs-chip is-warning">Unavailable</span>
                ) : null}
              </div>

              <div className="deploy-logs-history-nav">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={loadOlderLogsHistory}
                  disabled={!logsHistoryChunk?.next_cursor || logsHistoryLoading || logsHistoryHasPendingChanges}
                >
                  Older
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={loadNewerLogsHistory}
                  disabled={!logsHistoryChunk?.prev_cursor || logsHistoryLoading || logsHistoryHasPendingChanges}
                >
                  Newer
                </Button>
              </div>

              <pre className="json-view deploy-logs-view" role="log" aria-live="polite">
                {logsHistoryLoading && !logsHistoryChunk
                  ? "Loading history..."
                  : renderedLogsHistoryText ||
                    logsHistoryChunk?.message ||
                    "Select a time window and press Apply to load historical logs."}
              </pre>
            </>
          )}
        </section>
      </Modal>
    </div>
  );
}
