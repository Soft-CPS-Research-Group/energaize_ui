import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  BatteryCharging,
  Building2,
  Car,
  CircleDollarSign,
  Factory,
  FolderTree,
  Info,
  Leaf,
  Scale,
  Shield,
  Sun,
  type LucideIcon,
  Zap
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { JobInfo, KpiEntry, KpiImprovementTone } from "../../types";
import { getJobInfo, getJobResult, getJobStatus } from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";
import { EmptyState } from "../../components/ui/EmptyState";
import { StatusPill } from "../../components/ui/StatusPill";
import {
  buildGroupedKpiCompareRows,
  buildKpiMeta,
  formatKpiFamilyLabel,
  formatKpiReferenceLabel,
  groupRowsByFamilySubfamily,
  sortKpiFamilies,
  stripKpiLevel,
  type KpiCompareGroupedRow,
  type KpiFamily,
  type KpiLevel
} from "../../utils/kpiMetadata";
import {
  findSimulationDataDir,
  findSimulationDataSessionDefault,
  getSimulationDataIndex,
  readSimulationDataFile
} from "../../services/simulationDataService";
import { extractKpis } from "../../utils/jobResult";
import { extractKpisFromSimulationData } from "../../utils/simulationData";
import {
  formatKpiScorecardValue,
  KPI_DASHBOARD_FOCUS,
  KPI_IMPORTANT_SECTIONS,
  type KpiScorecardDefinition,
  type KpiScorecardScope,
  type KpiScorecardSignal
} from "../../utils/kpiScorecard";

function resolveBackTarget(fromParam: string | null): string {
  if (!fromParam) return "/app/ai/jobs";
  if (fromParam.startsWith("?")) return `/app/ai/jobs${fromParam}`;
  return `/app/ai/jobs?${fromParam}`;
}

function formatNumeric(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "N/A";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  return value.toFixed(4);
}

interface CompareScope {
  id: string;
  label: string;
  group: "community" | "building" | "other";
  entities: string[];
}

interface JobKpiData {
  jobId: string;
  entries: KpiEntry[];
  isLoading: boolean;
  isError: boolean;
}

interface SimulationKpiPayload {
  rows: Array<{ key: string; label: string; unit?: string; values: Record<string, number | null> }>;
  entries: KpiEntry[];
}

interface JobCompareSummary {
  jobId: string;
  name: string;
  meta: string;
}

interface ScorecardCompareSignal {
  definition: KpiScorecardDefinition;
  key: string;
  sourceLabel: string | null;
  unit?: string;
  left: number | null;
  right: number | null;
  delta: number | null;
  tone: KpiImprovementTone;
  hasComparable: boolean;
}

interface MultiJobKpiRow {
  key: string;
  sourceKey: string;
  canonicalGroupId: string;
  entity: string;
  level: KpiLevel;
  family: KpiFamily;
  subfamilyKey: string;
  subfamilyLabel: string;
  label: string;
  unit?: string;
  tooltip: KpiCompareGroupedRow["tooltip"];
  values: Record<string, number | null>;
  reportedCount: number;
}

interface MultiJobScorecardSignal {
  definition: KpiScorecardDefinition;
  key: string;
  sourceLabel: string | null;
  unit?: string;
  values: Record<string, number | null>;
  reportedCount: number;
}

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
  tone: KpiCompareGroupedRow["tone"],
  options?: { hideUnknown?: boolean }
): string | null {
  if (tone === "better") return "Better";
  if (tone === "worse") return "Worse";
  if (tone === "neutral") return "Neutral";
  return options?.hideUnknown ? null : "Unknown";
}

function parseBuildingId(entity: string): number | null {
  const match = entity.match(/building[_\s-]*(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCommunityEntity(entity: string): boolean {
  return /(community|overall|global|rec|microgrid|district)/i.test(entity);
}

function toTitle(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function readInfoString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function baseName(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || value;
}

function resolveJobSummary(jobId: string, info: JobInfo | undefined): JobCompareSummary {
  const name =
    readInfoString(info?.job_name) ||
    readInfoString(info?.run_name) ||
    readInfoString(info?.experiment_name) ||
    jobId;
  const config = readInfoString(info?.resolved_config_file) || readInfoString(info?.config_path);
  const submittedBy = readInfoString(info?.submitted_by);
  const metaParts = [config ? baseName(config) : null, submittedBy ? `by ${submittedBy}` : null].filter(Boolean);
  return {
    jobId,
    name,
    meta: metaParts.length > 0 ? metaParts.join(" · ") : jobId
  };
}

function buildEntriesFromMatrixRows(rows: Array<{ key: string; label: string; unit?: string; values: Record<string, number | null> }>): KpiEntry[] {
  const entries: KpiEntry[] = [];
  rows.forEach((row) => {
    Object.entries(row.values).forEach(([entity, value]) => {
      entries.push({
        key: `${row.key}::${entity}`,
        label: `${row.label} - ${toTitle(entity)}`,
        source: entity,
        unit: row.unit,
        value: value ?? Number.NaN
      });
    });
  });
  return entries;
}

function hasComparableSignal(
  row: Pick<KpiCompareGroupedRow, "leftPrimary" | "rightPrimary" | "deltaAbs">
): boolean {
  if (typeof row.deltaAbs === "number" && Number.isFinite(row.deltaAbs)) return true;
  return (
    typeof row.leftPrimary === "number" &&
    Number.isFinite(row.leftPrimary) &&
    typeof row.rightPrimary === "number" &&
    Number.isFinite(row.rightPrimary)
  );
}

function resolveScorecardCandidates(rows: KpiCompareGroupedRow[], candidateKey: string): KpiCompareGroupedRow[] {
  const targetMeta = buildKpiMeta(candidateKey);
  const targetCanonical = targetMeta.canonicalGroupId;
  const targetCanonicalNoLevel = stripKpiLevel(targetCanonical);

  return rows
    .map((row) => {
      if (row.canonicalGroupId === targetCanonical) return { row, rank: 0 };
      if (stripKpiLevel(row.canonicalGroupId) === targetCanonicalNoLevel) return { row, rank: 1 };
      return null;
    })
    .filter((item): item is { row: KpiCompareGroupedRow; rank: number } => Boolean(item))
    .sort((left, right) => left.rank - right.rank)
    .map((item) => item.row);
}

function resolveMultiScorecardCandidates(
  rows: MultiJobKpiRow[],
  candidateKey: string
): Array<{ row: MultiJobKpiRow; rank: number }> {
  const targetMeta = buildKpiMeta(candidateKey);
  const targetCanonical = targetMeta.canonicalGroupId;
  const targetCanonicalNoLevel = stripKpiLevel(targetCanonical);

  return rows
    .map((row) => {
      if (row.canonicalGroupId === targetCanonical) return { row, rank: 0 };
      if (stripKpiLevel(row.canonicalGroupId) === targetCanonicalNoLevel) return { row, rank: 1 };
      return null;
    })
    .filter((item): item is { row: MultiJobKpiRow; rank: number } => Boolean(item));
}

function hasFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function shouldFormatRawValueAsPercent(sourceKey: string, unit?: string): boolean {
  const normalizedUnit = (unit || "").trim().toLowerCase();
  const normalizedKey = sourceKey.toLowerCase();
  if (normalizedUnit === "%" || normalizedUnit === "percent" || normalizedUnit === "percentage") return true;
  if (normalizedKey.includes("ev_performance_departure") && normalizedKey.includes("ratio")) return true;
  if (normalizedKey.includes("self_consumption") && normalizedKey.includes("ratio")) return true;
  return normalizedKey.endsWith("_rate");
}

function formatRawKpiValue(value: number | null, sourceKey: string, unit?: string): string {
  if (!hasFiniteNumber(value)) return "N/A";
  if (shouldFormatRawValueAsPercent(sourceKey, unit)) {
    const percentage = Math.abs(value) <= 1.5 ? value * 100 : value;
    return `${percentage.toFixed(Math.abs(percentage) >= 10 ? 1 : 2)}%`;
  }
  const normalizedUnit = (unit || "").trim();
  if (normalizedUnit && normalizedUnit !== "ratio") {
    return `${formatNumeric(value)} ${normalizedUnit}`;
  }
  return formatNumeric(value);
}

function scorecardScopeFromLevel(level: KpiLevel | null): KpiScorecardScope | undefined {
  if (level === "district") return "community";
  if (level === "building") return "building";
  if (level === "other") return "other";
  return undefined;
}

function definitionAppliesToScope(definition: KpiScorecardDefinition, scope: KpiScorecardScope | undefined): boolean {
  if (!scope || !definition.scopes) return true;
  return definition.scopes.includes(scope);
}

function readScorecardCandidate(candidate: KpiScorecardDefinition["candidates"][number]): { key: string; transform?: "negate" } {
  if (typeof candidate === "string") return { key: candidate };
  return { key: candidate.key, transform: candidate.transform };
}

function applyScorecardCandidateTransform(value: number | null, transform?: "negate"): number | null {
  if (!hasFiniteNumber(value)) return null;
  return transform === "negate" ? -value : value;
}

function readCompareValue(
  row: KpiCompareGroupedRow,
  side: "left" | "right",
  candidate: { key: string; transform?: "negate" }
): number | null {
  const meta = buildKpiMeta(candidate.key);
  const secondary = side === "left" ? row.leftSecondary : row.rightSecondary;
  let value: number | null =
    meta.variant === "delta"
      ? secondary?.delta ?? null
      : meta.variant === "baseline"
        ? secondary?.baseline ?? null
        : side === "left"
          ? row.leftPrimary
          : row.rightPrimary;

  return applyScorecardCandidateTransform(value, candidate.transform);
}

function scoreScorecardComparison(
  definition: KpiScorecardDefinition,
  left: number | null,
  right: number | null
): KpiImprovementTone {
  if (!hasFiniteNumber(left) || !hasFiniteNumber(right)) return "unknown";
  const delta = right - left;
  if (Math.abs(delta) < 1e-9) return "neutral";

  if (
    definition.comparisonDirection === "lower-is-better" ||
    definition.toneRule === "zero-risk" ||
    definition.toneRule === "lower-ratio-better" ||
    definition.toneRule === "lower-is-better"
  ) {
    return delta < 0 ? "better" : "worse";
  }

  if (
    definition.comparisonDirection === "higher-is-better" ||
    definition.toneRule === "positive-saving" ||
    definition.toneRule === "service-rate" ||
    definition.toneRule === "higher-rate-better"
  ) {
    return delta > 0 ? "better" : "worse";
  }

  if (definition.comparisonDirection === "closer-to-zero") {
    return Math.abs(right) < Math.abs(left) ? "better" : "worse";
  }

  return "neutral";
}

function compareMultiScorecardValues(definition: KpiScorecardDefinition, left: number, right: number): number {
  if (Math.abs(left - right) < 1e-9) return 0;

  if (
    definition.comparisonDirection === "lower-is-better" ||
    definition.toneRule === "zero-risk" ||
    definition.toneRule === "lower-ratio-better" ||
    definition.toneRule === "lower-is-better"
  ) {
    return left - right;
  }

  if (
    definition.comparisonDirection === "higher-is-better" ||
    definition.toneRule === "positive-saving" ||
    definition.toneRule === "service-rate" ||
    definition.toneRule === "higher-rate-better"
  ) {
    return right - left;
  }

  if (definition.comparisonDirection === "closer-to-zero") {
    return Math.abs(left) - Math.abs(right);
  }

  return 0;
}

function resolveMultiBestJobIds(signal: MultiJobScorecardSignal, jobIds: string[]): string[] {
  const reported = jobIds
    .map((jobId) => ({ jobId, value: signal.values[jobId] ?? null }))
    .filter((item): item is { jobId: string; value: number } => hasFiniteNumber(item.value));
  if (reported.length === 0) return [];

  const hasDirectionalRanking = reported.some(
    (item) => compareMultiScorecardValues(signal.definition, reported[0]!.value, item.value) !== 0
  );
  if (!hasDirectionalRanking) {
    return reported.map((item) => item.jobId);
  }

  const best = reported.reduce((currentBest, item) => {
    const comparison = compareMultiScorecardValues(signal.definition, item.value, currentBest.value);
    return comparison < 0 ? item : currentBest;
  }, reported[0]!);

  return reported
    .filter((item) => Math.abs(compareMultiScorecardValues(signal.definition, item.value, best.value)) < 1e-9)
    .map((item) => item.jobId);
}

function resolveScorecardCompareSignals(
  rows: KpiCompareGroupedRow[],
  definitions: KpiScorecardDefinition[],
  scope: KpiScorecardScope | undefined
): ScorecardCompareSignal[] {
  return definitions
    .filter((definition) => definitionAppliesToScope(definition, scope))
    .map((definition) => {
      const rankedCandidates = definition.candidates.flatMap((rawCandidate, candidateIndex) => {
        const candidate = readScorecardCandidate(rawCandidate);
        return resolveScorecardCandidates(rows, candidate.key).map((row) => {
          const left = readCompareValue(row, "left", candidate);
          const right = readCompareValue(row, "right", candidate);
          return {
            candidate,
            candidateIndex,
            left,
            right,
            row
          };
        });
      });

      const best = rankedCandidates.sort((left, right) => {
        const leftComparable = Number(hasFiniteNumber(left.left) && hasFiniteNumber(left.right));
        const rightComparable = Number(hasFiniteNumber(right.left) && hasFiniteNumber(right.right));
        if (leftComparable !== rightComparable) return rightComparable - leftComparable;
        const leftUsed = Number(hasFiniteNumber(left.left) || hasFiniteNumber(left.right) || hasComparableSignal(left.row));
        const rightUsed = Number(hasFiniteNumber(right.left) || hasFiniteNumber(right.right) || hasComparableSignal(right.row));
        if (leftUsed !== rightUsed) return rightUsed - leftUsed;
        return left.candidateIndex - right.candidateIndex;
      })[0];

      const left = best?.left ?? null;
      const right = best?.right ?? null;
      const delta = hasFiniteNumber(left) && hasFiniteNumber(right) ? right - left : null;
      const hasComparable = hasFiniteNumber(left) && hasFiniteNumber(right);

      return {
        definition,
        key: best?.row.canonicalGroupId || definition.id,
        sourceLabel: best?.row.label || null,
        unit: definition.unit || best?.row.unit,
        left,
        right,
        delta,
        tone: hasComparable ? scoreScorecardComparison(definition, left, right) : "unknown",
        hasComparable
      };
    });
}

function resolveMultiJobScorecardSignals(
  rows: MultiJobKpiRow[],
  definitions: KpiScorecardDefinition[],
  jobIds: string[],
  scope: KpiScorecardScope | undefined
): MultiJobScorecardSignal[] {
  return definitions
    .filter((definition) => definitionAppliesToScope(definition, scope))
    .map((definition) => {
      const rankedCandidates = definition.candidates.flatMap((rawCandidate, candidateIndex) => {
        const candidate = readScorecardCandidate(rawCandidate);
        return resolveMultiScorecardCandidates(rows, candidate.key).map(({ row, rank }) => {
          const values = Object.fromEntries(
            jobIds.map((jobId) => [
              jobId,
              applyScorecardCandidateTransform(row.values[jobId] ?? null, candidate.transform)
            ])
          ) as Record<string, number | null>;
          const reportedCount = jobIds.filter((jobId) => hasFiniteNumber(values[jobId])).length;
          return {
            candidateIndex,
            rank,
            row,
            values,
            reportedCount
          };
        });
      });

      const best = rankedCandidates.sort((left, right) => {
        if (left.reportedCount !== right.reportedCount) return right.reportedCount - left.reportedCount;
        if (left.candidateIndex !== right.candidateIndex) return left.candidateIndex - right.candidateIndex;
        return left.rank - right.rank;
      })[0];

      return {
        definition,
        key: best?.row.canonicalGroupId || definition.id,
        sourceLabel: best?.row.label || null,
        unit: definition.unit || best?.row.unit,
        values:
          best?.values ||
          (Object.fromEntries(jobIds.map((jobId) => [jobId, null])) as Record<string, number | null>),
        reportedCount: best?.reportedCount || 0
      };
    });
}

function formatScorecardCompareValue(
  definition: KpiScorecardDefinition,
  value: number | null,
  unit?: string,
  tone: KpiImprovementTone = "neutral"
): string {
  const signal: KpiScorecardSignal = {
    definition,
    value,
    sourceKey: null,
    sourceLabel: null,
    unit: definition.unit || unit,
    tone
  };
  return formatKpiScorecardValue(signal);
}

function shouldShowCandidateAsPrimary(definition: KpiScorecardDefinition): boolean {
  return definition.referenceMode === "none" || definition.toneRule === "service-rate" || definition.toneRule === "zero-risk";
}

function getScorecardPrimaryValue(signal: ScorecardCompareSignal): number | null {
  return shouldShowCandidateAsPrimary(signal.definition) ? signal.right : signal.delta;
}

function getScorecardPrimaryLabel(signal: ScorecardCompareSignal): string {
  return shouldShowCandidateAsPrimary(signal.definition) ? "Candidate" : "Delta";
}

function formatCompareToneLabel(tone: KpiImprovementTone, delta: number | null): string | null {
  if (hasFiniteNumber(delta) && Math.abs(delta) < 1e-9) return "Equal";
  if (tone === "better") return "Better";
  if (tone === "worse") return "Worse";
  return null;
}

function formatBestJobLabel(bestJobIds: string[], jobSummaries: JobCompareSummary[]): string {
  if (bestJobIds.length === 0) return "No reported value";
  const names = bestJobIds
    .map((jobId) => jobSummaries.find((job) => job.jobId === jobId)?.name || jobId)
    .filter(Boolean);
  if (names.length === 1) return names[0]!;
  return `Tie: ${names.join(", ")}`;
}

function parseEntryTarget(entry: KpiEntry): { metricKey: string; entity: string } {
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

function cleanEntryLabel(entry: KpiEntry, entity: string, fallback: string): string {
  const suffix = ` - ${toTitle(entity)}`;
  if (entry.label.endsWith(suffix)) {
    return entry.label.slice(0, -suffix.length);
  }
  return entry.label || fallback;
}

function buildMultiJobRows(jobIds: string[], jobData: JobKpiData[]): MultiJobKpiRow[] {
  const rows = new Map<string, MultiJobKpiRow>();

  jobData.forEach((data) => {
    data.entries.forEach((entry) => {
      const { metricKey, entity } = parseEntryTarget(entry);
      const meta = buildKpiMeta(metricKey);
      const rowKey = `${metricKey}::${entity}`;
      const existing =
        rows.get(rowKey) ||
        ({
          key: rowKey,
          sourceKey: metricKey,
          canonicalGroupId: meta.canonicalGroupId,
          entity,
          level: meta.level,
          family: meta.family,
          subfamilyKey: meta.subfamilyKey,
          subfamilyLabel: meta.subfamilyLabel,
          label: cleanEntryLabel(entry, entity, meta.metricLabel),
          unit: entry.unit,
          tooltip: meta.tooltip,
          values: Object.fromEntries(jobIds.map((jobId) => [jobId, null])) as Record<string, number | null>,
          reportedCount: 0
        } satisfies MultiJobKpiRow);

      if (!existing.unit && entry.unit) {
        existing.unit = entry.unit;
      }
      existing.values[data.jobId] = Number.isFinite(entry.value) ? entry.value : null;
      rows.set(rowKey, existing);
    });
  });

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      reportedCount: jobIds.filter((jobId) => hasFiniteNumber(row.values[jobId])).length
    }))
    .sort((left, right) => {
      const familySort = sortKpiFamilies([left.family, right.family]);
      if (familySort[0] !== familySort[1]) {
        return familySort[0] === left.family ? -1 : 1;
      }
      const subfamilySort = left.subfamilyLabel.localeCompare(right.subfamilyLabel);
      if (subfamilySort !== 0) return subfamilySort;
      const labelSort = left.label.localeCompare(right.label);
      if (labelSort !== 0) return labelSort;
      return left.entity.localeCompare(right.entity);
    });
}

function useManyJobKpis(jobIds: string[], enabled: boolean): JobKpiData[] {
  const resultQueries = useQueries({
    queries: jobIds.map((jobId) => ({
      queryKey: ["job-result", jobId],
      queryFn: () => getJobResult(jobId),
      enabled: Boolean(enabled && jobId)
    }))
  });

  const simulationIndexQueries = useQueries({
    queries: jobIds.map((jobId, index) => {
      const resultPayload = resultQueries[index]?.data;
      const simulationDataDir = findSimulationDataDir(resultPayload);
      const simulationDataSessionDefault = findSimulationDataSessionDefault(resultPayload);
      return {
        queryKey: ["simulation-data-index", jobId, simulationDataDir, simulationDataSessionDefault],
        queryFn: () =>
          getSimulationDataIndex({
            jobId,
            simulationDataDir,
            simulationDataSessionDefault
          }),
        enabled: Boolean(enabled && jobId)
      };
    })
  });

  const kpiCsvQueries = useQueries({
    queries: jobIds.map((jobId, index) => {
      const source = simulationIndexQueries[index]?.data;
      const kpiFilePath = source?.files.find((item) => item.kind === "kpi")?.relativePath || null;
      return {
        queryKey: ["simulation-kpis", jobId, kpiFilePath || ""],
        queryFn: async (): Promise<SimulationKpiPayload> => {
          if (!source || !kpiFilePath) {
            return { rows: [], entries: [] };
          }
          const content = await readSimulationDataFile(source, kpiFilePath);
          const parsed = extractKpisFromSimulationData(content);
          return {
            rows: parsed.rows,
            entries: buildEntriesFromMatrixRows(parsed.rows)
          };
        },
        enabled: Boolean(enabled && jobId && source && kpiFilePath)
      };
    })
  });

  return jobIds.map((jobId, index) => {
    const csvEntries = kpiCsvQueries[index]?.data?.entries || [];
    const fallbackEntries = extractKpis(resultQueries[index]?.data);
    return {
      jobId,
      entries: csvEntries.length > 0 ? csvEntries : fallbackEntries,
      isLoading:
        Boolean(resultQueries[index]?.isLoading) ||
        Boolean(simulationIndexQueries[index]?.isLoading) ||
        Boolean(kpiCsvQueries[index]?.isLoading),
      isError:
        Boolean(resultQueries[index]?.isError) ||
        Boolean(simulationIndexQueries[index]?.isError) ||
        Boolean(kpiCsvQueries[index]?.isError)
    };
  });
}

export function JobKpiComparePage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAll, setShowAll] = useState(true);
  const [showNa, setShowNa] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedScopeId, setSelectedScopeId] = useState("community");
  const [familyFilter, setFamilyFilter] = useState<KpiFamily | "all">("all");
  const [pairDrilldownOpen, setPairDrilldownOpen] = useState(false);
  const [multiDrilldownOpen, setMultiDrilldownOpen] = useState(false);

  const jobsParam = searchParams.get("jobs") || "";
  const legacyLeftId = searchParams.get("left") || "";
  const legacyRightId = searchParams.get("right") || "";
  const jobIds = useMemo(() => {
    const fromJobs = jobsParam
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const fromLegacy = [legacyLeftId, legacyRightId].filter(Boolean);
    const source = fromJobs.length >= 2 ? fromJobs : fromLegacy;
    return Array.from(new Set(source));
  }, [jobsParam, legacyLeftId, legacyRightId]);
  const pairMode = jobIds.length === 2;
  const leftId = jobIds[0] || "";
  const rightId = jobIds[1] || "";
  const fromParam = searchParams.get("from");
  const backTarget = resolveBackTarget(fromParam);

  const statusQueries = useQueries({
    queries: jobIds.map((jobId) => ({
      queryKey: ["job-status", jobId],
      queryFn: () => getJobStatus(jobId),
      enabled: Boolean(jobId)
    }))
  });

  const infoQueries = useQueries({
    queries: jobIds.map((jobId) => ({
      queryKey: ["job-info", jobId],
      queryFn: () => getJobInfo(jobId),
      enabled: Boolean(jobId)
    }))
  });

  const jobSummaries = jobIds.map((jobId, index) => resolveJobSummary(jobId, infoQueries[index]?.data));

  const jobKpiData = useManyJobKpis(jobIds, jobIds.length >= 2);
  const leftData = jobKpiData[0];
  const rightData = jobKpiData[1];

  const rows = useMemo<KpiCompareGroupedRow[]>(
    () =>
      pairMode && leftData && rightData
        ? buildGroupedKpiCompareRows(leftData.entries, rightData.entries, {
            showAll
          })
        : [],
    [leftData, pairMode, rightData, showAll]
  );

  const multiRows = useMemo(
    () => (jobIds.length > 2 ? buildMultiJobRows(jobIds, jobKpiData) : []),
    [jobIds, jobKpiData]
  );

  const scopes = useMemo<CompareScope[]>(() => {
    const sourceRows = pairMode ? rows : multiRows;
    if (sourceRows.length === 0) return [];
    const entities = new Set(sourceRows.map((row) => row.entity).filter(Boolean));
    const community: string[] = [];
    const buildings = new Map<number, string[]>();
    const others: string[] = [];

    Array.from(entities)
      .sort((a, b) => a.localeCompare(b))
      .forEach((entity) => {
        if (isCommunityEntity(entity)) {
          community.push(entity);
          return;
        }
        const buildingId = parseBuildingId(entity);
        if (buildingId !== null) {
          const group = buildings.get(buildingId) || [];
          group.push(entity);
          buildings.set(buildingId, group);
          return;
        }
        others.push(entity);
      });

    const next: CompareScope[] = [];
    if (community.length > 0) {
      next.push({
        id: "community",
        label: "Community",
        group: "community",
        entities: community
      });
    }
    Array.from(buildings.entries())
      .sort((left, right) => left[0] - right[0])
      .forEach(([buildingId, entitiesInBuilding]) => {
        next.push({
          id: `building:${buildingId}`,
          label: `Building ${buildingId}`,
          group: "building",
          entities: entitiesInBuilding
        });
      });
    if (others.length > 0) {
      next.push({
        id: "other",
        label: "Other entities",
        group: "other",
        entities: others
      });
    }
    return next;
  }, [multiRows, pairMode, rows]);

  useEffect(() => {
    if (scopes.length === 0) return;
    if (!scopes.some((scope) => scope.id === selectedScopeId)) {
      setSelectedScopeId(scopes[0]!.id);
    }
  }, [scopes, selectedScopeId]);

  const selectedScope = useMemo(
    () => scopes.find((scope) => scope.id === selectedScopeId) || null,
    [scopes, selectedScopeId]
  );

  const selectedLevel = useMemo<KpiLevel | null>(() => {
    if (!selectedScope) return null;
    if (selectedScope.group === "community") return "district";
    if (selectedScope.group === "building") return "building";
    return null;
  }, [selectedScope]);

  const scopedRows = useMemo(() => {
    if (!selectedScope) return rows;
    const entitySet = new Set(selectedScope.entities);
    return rows.filter((row) => {
      if (!entitySet.has(row.entity)) return false;
      if (!selectedLevel) return true;
      return row.level === selectedLevel;
    });
  }, [rows, selectedLevel, selectedScope]);

  const scopedMultiRows = useMemo(() => {
    if (!selectedScope) return multiRows;
    const entitySet = new Set(selectedScope.entities);
    return multiRows.filter((row) => {
      if (!entitySet.has(row.entity)) return false;
      if (!selectedLevel) return true;
      return row.level === selectedLevel;
    });
  }, [multiRows, selectedLevel, selectedScope]);

  const familyOptions = useMemo(
    () =>
      sortKpiFamilies(
        Array.from(new Set((pairMode ? scopedRows : scopedMultiRows).map((row) => row.family)))
      ),
    [pairMode, scopedMultiRows, scopedRows]
  );

  useEffect(() => {
    if (familyFilter !== "all" && !familyOptions.includes(familyFilter)) {
      setFamilyFilter("all");
    }
  }, [familyFilter, familyOptions]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scopedRows.filter((row) => {
      if (familyFilter !== "all" && row.family !== familyFilter) return false;
      if (!query) return true;
      return `${row.label} ${row.canonicalGroupId} ${row.subfamilyLabel}`.toLowerCase().includes(query);
    });
  }, [familyFilter, scopedRows, search]);

  const visibleRows = useMemo(() => {
    if (showNa) return filteredRows;
    return filteredRows.filter((row) => row.leftHasValue || row.rightHasValue);
  }, [filteredRows, showNa]);

  const rowsByFamily = useMemo(() => groupRowsByFamilySubfamily(visibleRows), [visibleRows]);

  const filteredMultiRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scopedMultiRows.filter((row) => {
      if (familyFilter !== "all" && row.family !== familyFilter) return false;
      if (!query) return true;
      return `${row.label} ${row.sourceKey} ${row.canonicalGroupId} ${row.subfamilyLabel} ${row.entity}`
        .toLowerCase()
        .includes(query);
    });
  }, [familyFilter, scopedMultiRows, search]);

  const visibleMultiRows = useMemo(() => {
    return filteredMultiRows.filter((row) => {
      if (!showNa && row.reportedCount === 0) return false;
      if (!showAll && row.reportedCount < jobIds.length) return false;
      return true;
    });
  }, [filteredMultiRows, jobIds.length, showAll, showNa]);

  const scorecardScope = scorecardScopeFromLevel(selectedLevel);
  const compareFocusSignals = useMemo(
    () => resolveScorecardCompareSignals(scopedRows, KPI_DASHBOARD_FOCUS, scorecardScope),
    [scorecardScope, scopedRows]
  );
  const multiFocusSignals = useMemo(
    () => resolveMultiJobScorecardSignals(scopedMultiRows, KPI_DASHBOARD_FOCUS, jobIds, scorecardScope),
    [jobIds, scorecardScope, scopedMultiRows]
  );
  const compareScorecardSections = useMemo(
    () =>
      KPI_IMPORTANT_SECTIONS.map((section) => {
        const signals = resolveScorecardCompareSignals(scopedRows, section.definitions, scorecardScope);
        return {
          ...section,
          reportedCount: signals.filter((signal) => signal.hasComparable).length,
          signals
        };
      }).filter((section) => section.reportedCount > 0),
    [scorecardScope, scopedRows]
  );

  const missingSelection = jobIds.length < 2;
  const isLoading = jobKpiData.some((item) => item.isLoading) || statusQueries.some((query) => query.isLoading);
  const hasKpiError = jobKpiData.some((item) => item.isError);

  function swapJobs(): void {
    if (!pairMode) return;
    const params = new URLSearchParams(searchParams);
    params.set("jobs", [rightId, leftId].join(","));
    params.set("left", rightId);
    params.set("right", leftId);
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="page job-compare-page">
      <header className="jobs-hero">
        <div>
          <span className="section-kicker">KPI Comparison</span>
          <h1>Compare Jobs</h1>
        </div>
        <div className="jobs-command-group">
          <Button variant="ghost" iconLeft={<ArrowLeft size={14} />} onClick={() => navigate(backTarget)}>
            Back to Jobs
          </Button>
          <Button variant="secondary" onClick={swapJobs} disabled={missingSelection || !pairMode}>
            Swap
          </Button>
        </div>
      </header>

      {missingSelection ? (
        <EmptyState
          title="Select at least two jobs first"
          message="Go back to Jobs and select two or more completed jobs to compare KPIs."
          action={
            <Button variant="secondary" onClick={() => navigate(backTarget)}>
              Back to Jobs
            </Button>
          }
        />
      ) : null}

      {!missingSelection ? (
        <section className={`job-compare-header panel${pairMode ? " is-pair" : " is-multi"}`}>
          <div className="job-compare-jobs">
            {jobSummaries.map((job, index) => (
              <article key={job.jobId} className="job-compare-job-card">
                <div className="job-compare-job-topline">
                  <small>{pairMode ? (index === 0 ? "Reference" : "Candidate") : `Job ${index + 1}`}</small>
                  <StatusPill status={statusQueries[index]?.data?.status || "unknown"} />
                </div>
                <strong title={`${job.name}\n${job.jobId}`}>{job.name}</strong>
                <small className="job-compare-job-meta" title={job.meta}>{job.meta}</small>
                <code title={job.jobId}>{job.jobId}</code>
              </article>
            ))}
          </div>
          <div className="job-compare-options">
            <label className="checkbox-inline">
              <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
              <span>Show all KPIs (union)</span>
            </label>
            <small className="job-compare-note">
              {pairMode
                ? "Candidate is compared against reference. Selected KPIs show final values plus delta."
                : "Each selected job gets a table column. Uncheck union to keep only KPIs reported by every job."}
            </small>
          </div>
        </section>
      ) : null}

      {!missingSelection && isLoading ? (
        <section className="datasets-loader-preview">
          <EVChargingLoader label="Loading comparison data..." />
        </section>
      ) : null}

      {!missingSelection && !isLoading && hasKpiError ? (
        <EmptyState
          title="Could not load KPI payload"
          message="One of the selected jobs has no accessible KPI source right now."
        />
      ) : null}

      {!missingSelection && !isLoading && !hasKpiError ? (
        (pairMode ? rows.length === 0 : multiRows.length === 0) ? (
          <EmptyState
            title="No comparable KPIs"
            message="No numeric KPI keys were found for the selected jobs."
          />
        ) : (
          <div className="kpi-layout">
            <aside className="sim-tree-panel panel">
              <header className="sim-tree-head">
                <div className="sim-tree-headline">
                  <small>Compare scope</small>
                </div>
                <button
                  type="button"
                  className={`sim-tree-context-btn${selectedScopeId === "community" ? " is-active" : ""}`}
                  onClick={() => setSelectedScopeId("community")}
                >
                  <Factory size={14} />
                  Community
                </button>
              </header>
              <ul className="sim-tree-list">
                {scopes
                  .filter((scope) => scope.id !== "community")
                  .map((scope) => (
                    <li key={scope.id}>
                      <div className={`sim-tree-row ${selectedScopeId === scope.id ? "is-selected" : ""}`}>
                        <span className="sim-tree-toggle is-spacer" />
                        <button type="button" className="sim-tree-label" onClick={() => setSelectedScopeId(scope.id)}>
                          <span className="sim-tree-icon">
                            {scope.group === "building" ? <Building2 size={14} /> : <FolderTree size={14} />}
                          </span>
                          <span>{scope.label}</span>
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            </aside>

            <section className="kpi-main">
              {pairMode ? (
                <>
                  <section className="kpi-priority-board panel">
                    <header className="kpi-section-header">
                      <div>
                        <h3>Decision scorecard</h3>
                        <small>
                          {selectedScope?.label || "Selected scope"} · candidate compared against reference job
                        </small>
                      </div>
                    </header>
                    <div className="kpi-priority-grid">
                      {compareFocusSignals.map((signal) => {
                        const toneLabel = formatCompareToneLabel(signal.tone, signal.delta);
                        const primaryValue = getScorecardPrimaryValue(signal);
                        const primaryLabel = getScorecardPrimaryLabel(signal);
                        return (
                          <article
                            key={signal.definition.id}
                            className={`kpi-priority-tile tone-${signal.tone}${signal.hasComparable ? "" : " is-missing"}`}
                          >
                            <header>
                              <span className="kpi-title-with-help">
                                <small>{signal.definition.title}</small>
                                <button type="button" className="kpi-help" aria-label={`About ${signal.definition.title}`}>
                                  <Info size={12} />
                                  <span role="tooltip" className="kpi-help-tooltip">
                                    <strong>{signal.definition.title}</strong>
                                    <small>{signal.definition.description}</small>
                                    {signal.definition.tooltip ? <small>{signal.definition.tooltip}</small> : null}
                                  </span>
                                </button>
                              </span>
                              {toneLabel ? <span className={`kpi-tone kpi-tone-${signal.tone}`}>{toneLabel}</span> : null}
                            </header>
                            <div className="kpi-compare-primary">
                              <small>{primaryLabel}</small>
                              <strong>{formatScorecardCompareValue(signal.definition, primaryValue, signal.unit, signal.tone)}</strong>
                            </div>
                            <dl className="kpi-priority-context is-three">
                              <div className={!hasFiniteNumber(signal.left) ? "is-missing" : ""}>
                                <dt>Ref</dt>
                                <dd>{formatScorecardCompareValue(signal.definition, signal.left, signal.unit)}</dd>
                              </div>
                              <div className={!hasFiniteNumber(signal.right) ? "is-missing" : ""}>
                                <dt>Cand</dt>
                                <dd>{formatScorecardCompareValue(signal.definition, signal.right, signal.unit)}</dd>
                              </div>
                              <div className={!hasFiniteNumber(signal.delta) ? "is-missing" : ""}>
                                <dt>Delta</dt>
                                <dd>{formatScorecardCompareValue(signal.definition, signal.delta, signal.unit, signal.tone)}</dd>
                              </div>
                            </dl>
                            <p>{signal.definition.description}</p>
                          </article>
                        );
                      })}
                    </div>
                  </section>

                  {compareScorecardSections.map((section) => (
                    <section key={section.id} className="panel kpi-focus-section">
                      <header className="kpi-section-header">
                        <div>
                          <h3>{section.title}</h3>
                          <small>{section.subtitle}</small>
                        </div>
                        <span className="kpi-family-pill">{section.reportedCount}/{section.signals.length} comparable</span>
                      </header>
                      <div className="kpi-focus-list">
                        {section.signals.map((signal) => {
                          const toneLabel = formatCompareToneLabel(signal.tone, signal.delta);
                          return (
                            <article
                              key={signal.definition.id}
                              className={`kpi-focus-row tone-${signal.tone}${signal.hasComparable ? "" : " is-missing"}`}
                            >
                              <div className="kpi-focus-row-main">
                                <span className="kpi-focus-title">
                                  <strong>{signal.definition.title}</strong>
                                  <button type="button" className="kpi-help" aria-label={`About ${signal.definition.title}`}>
                                    <Info size={12} />
                                    <span role="tooltip" className="kpi-help-tooltip">
                                      <strong>{signal.definition.title}</strong>
                                      <small>{signal.definition.description}</small>
                                      {signal.definition.tooltip ? <small>{signal.definition.tooltip}</small> : null}
                                      {signal.sourceLabel ? <small>Source: {signal.sourceLabel}</small> : null}
                                    </span>
                                  </button>
                                </span>
                                <small>{signal.definition.description}</small>
                              </div>
                              <div className="kpi-compare-cell">
                                <small>Reference</small>
                                <strong>{formatScorecardCompareValue(signal.definition, signal.left, signal.unit)}</strong>
                              </div>
                              <div className="kpi-compare-cell">
                                <small>Candidate</small>
                                <strong>{formatScorecardCompareValue(signal.definition, signal.right, signal.unit)}</strong>
                              </div>
                              <div className="kpi-compare-cell">
                                <small>Delta</small>
                                <strong>{formatScorecardCompareValue(signal.definition, signal.delta, signal.unit, signal.tone)}</strong>
                              </div>
                              <span className={`kpi-tone kpi-tone-${signal.tone}`}>{toneLabel || "-"}</span>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))}

                  <section className={`panel kpi-drilldown-panel${pairDrilldownOpen ? " is-open" : ""}`}>
                    <button
                      type="button"
                      className="kpi-drilldown-summary"
                      aria-expanded={pairDrilldownOpen}
                      onClick={() => setPairDrilldownOpen((previous) => !previous)}
                    >
                      <span>
                        <strong>All KPI drill-down</strong>
                        <small>Complete pairwise KPI table for the selected scope.</small>
                      </span>
                      <span className="kpi-family-pill">{visibleRows.length} KPIs</span>
                    </button>
                    {pairDrilldownOpen ? (
                      <div className="kpi-drilldown-body">
                        <section className="kpi-toolbar kpi-drilldown-toolbar">
                          <div className="kpi-toolbar-main">
                            <label className="kpi-filter">
                              <select
                                aria-label="Filter KPI family"
                                value={familyFilter}
                                onChange={(event) => setFamilyFilter(event.target.value as KpiFamily | "all")}
                              >
                                <option value="all">All families</option>
                                {familyOptions.map((family) => (
                                  <option key={family} value={family}>
                                    {formatKpiFamilyLabel(family)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="checkbox-inline kpi-toggle-chip">
                              <input type="checkbox" checked={showNa} onChange={(event) => setShowNa(event.target.checked)} />
                              <span>Show N/A</span>
                            </label>
                          </div>
                          <div className="kpi-toolbar-main kpi-toolbar-main--stretch">
                            <label className="search-inline kpi-search">
                              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search KPI..." />
                            </label>
                          </div>
                        </section>

                        {visibleRows.length === 0 ? (
                          <EmptyState
                            title="No KPIs in selected scope"
                            message="Try another scope, family filter, search term, or enable Show N/A."
                          />
                        ) : (
                          rowsByFamily.map((familySection) => {
                            const FamilyIcon = resolveFamilyIcon(familySection.family);
                            return (
                              <details key={familySection.family} className="kpi-family-panel">
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
                                        <div className="job-compare-table-wrap">
                                          <table className="table job-compare-table">
                                            <thead>
                                              <tr>
                                                <th>KPI</th>
                                                <th>Reference</th>
                                                <th>Candidate</th>
                                                <th>Delta</th>
                                                <th>Delta %</th>
                                                <th>Tone</th>
                                                <th>Unit</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {subfamily.rows.map((row) => {
                                                const isNa = !row.leftHasValue && !row.rightHasValue;
                                                const toneLabel = formatToneLabel(row.tone, { hideUnknown: true });
                                                return (
                                                  <tr key={row.key} className={isNa ? "kpi-row-na" : ""}>
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
                                                    <td>
                                                      <strong>{formatRawKpiValue(row.leftPrimary, row.canonicalGroupId, row.unit)}</strong>
                                                      {row.leftSecondary ? (
                                                        <small className="job-compare-secondary">
                                                          {formatKpiReferenceLabel(row.leftSecondary.referenceSource)}:{" "}
                                                          {formatRawKpiValue(row.leftSecondary.baseline, row.canonicalGroupId, row.unit)} · Delta:{" "}
                                                          {formatRawKpiValue(row.leftSecondary.delta, row.canonicalGroupId, row.unit)}
                                                        </small>
                                                      ) : null}
                                                    </td>
                                                    <td>
                                                      <strong>{formatRawKpiValue(row.rightPrimary, row.canonicalGroupId, row.unit)}</strong>
                                                      {row.rightSecondary ? (
                                                        <small className="job-compare-secondary">
                                                          {formatKpiReferenceLabel(row.rightSecondary.referenceSource)}:{" "}
                                                          {formatRawKpiValue(row.rightSecondary.baseline, row.canonicalGroupId, row.unit)} · Delta:{" "}
                                                          {formatRawKpiValue(row.rightSecondary.delta, row.canonicalGroupId, row.unit)}
                                                        </small>
                                                      ) : null}
                                                    </td>
                                                    <td
                                                      className={
                                                        row.tone === "better"
                                                          ? "kpi-delta-better"
                                                          : row.tone === "worse"
                                                            ? "kpi-delta-worse"
                                                            : ""
                                                      }
                                                    >
                                                      {formatRawKpiValue(row.deltaAbs, row.canonicalGroupId, row.unit)}
                                                    </td>
                                                    <td
                                                      className={
                                                        row.tone === "better"
                                                          ? "kpi-delta-better"
                                                          : row.tone === "worse"
                                                            ? "kpi-delta-worse"
                                                            : ""
                                                      }
                                                    >
                                                      {row.deltaPct === null ? "N/A" : `${row.deltaPct.toFixed(2)}%`}
                                                    </td>
                                                    <td>
                                                      {toneLabel ? (
                                                        <span className={`kpi-tone kpi-tone-${row.tone}`}>{toneLabel}</span>
                                                      ) : (
                                                        <span className="kpi-tone-empty">-</span>
                                                      )}
                                                      {isNa ? <span className="kpi-na-pill">N/A</span> : null}
                                                    </td>
                                                    <td>{row.unit || "-"}</td>
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
                      </div>
                    ) : null}
                  </section>
                </>
              ) : (
                <>
                  <section className="kpi-priority-board panel">
                    <header className="kpi-section-header">
                      <div>
                        <h3>Decision scorecard</h3>
                        <small>
                          {selectedScope?.label || "Selected scope"} · main KPIs across selected jobs
                        </small>
                      </div>
                    </header>
                    <div className="kpi-priority-grid is-multi">
                      {multiFocusSignals.map((signal) => {
                        const bestJobIds = resolveMultiBestJobIds(signal, jobIds);
                        const bestValue = bestJobIds.length > 0 ? signal.values[bestJobIds[0]!] ?? null : null;
                        const bestLabel = formatBestJobLabel(bestJobIds, jobSummaries);
                        const tileTone: KpiImprovementTone = signal.reportedCount > 0 ? "neutral" : "unknown";

                        return (
                          <article
                            key={signal.definition.id}
                            className={`kpi-priority-tile kpi-priority-tile-multi tone-${tileTone}${signal.reportedCount > 0 ? "" : " is-missing"}`}
                          >
                            <header>
                              <span className="kpi-title-with-help">
                                <small>{signal.definition.title}</small>
                                <button type="button" className="kpi-help" aria-label={`About ${signal.definition.title}`}>
                                  <Info size={12} />
                                  <span role="tooltip" className="kpi-help-tooltip">
                                    <strong>{signal.definition.title}</strong>
                                    <small>{signal.definition.description}</small>
                                    {signal.definition.tooltip ? <small>{signal.definition.tooltip}</small> : null}
                                    {signal.sourceLabel ? <small>Source: {signal.sourceLabel}</small> : null}
                                  </span>
                                </button>
                              </span>
                              <span className="kpi-family-pill">{signal.reportedCount}/{jobIds.length}</span>
                            </header>
                            <div className="kpi-multi-best">
                              <small>{bestJobIds.length > 0 ? "Best" : "Values"}</small>
                              <strong>{formatScorecardCompareValue(signal.definition, bestValue, signal.unit)}</strong>
                              <span title={bestLabel}>{bestLabel}</span>
                            </div>
                            <div className="kpi-multi-value-grid">
                              {jobSummaries.map((job) => {
                                const value = signal.values[job.jobId] ?? null;
                                const isBest = bestJobIds.includes(job.jobId);
                                return (
                                  <div
                                    key={`${signal.definition.id}:${job.jobId}`}
                                    className={`kpi-multi-value${isBest ? " is-best" : ""}${hasFiniteNumber(value) ? "" : " is-missing"}`}
                                  >
                                    <small title={`${job.name}\n${job.jobId}`}>{job.name}</small>
                                    <strong>{formatScorecardCompareValue(signal.definition, value, signal.unit)}</strong>
                                  </div>
                                );
                              })}
                            </div>
                            <p>{signal.definition.description}</p>
                          </article>
                        );
                      })}
                    </div>
                  </section>

                  <section className={`panel kpi-drilldown-panel${multiDrilldownOpen ? " is-open" : ""}`}>
                    <button
                      type="button"
                      className="kpi-drilldown-summary"
                      aria-expanded={multiDrilldownOpen}
                      onClick={() => setMultiDrilldownOpen((previous) => !previous)}
                    >
                      <span>
                        <strong>All reported KPIs</strong>
                        <small>Complete multi-job KPI table for the selected scope.</small>
                      </span>
                      <span className="kpi-family-pill">{visibleMultiRows.length}/{multiRows.length} KPIs</span>
                    </button>
                    {multiDrilldownOpen ? (
                      <div className="kpi-drilldown-body">
                        <section className="kpi-toolbar kpi-drilldown-toolbar">
                          <div className="kpi-toolbar-main">
                            <label className="kpi-filter">
                              <select
                                aria-label="Filter KPI family"
                                value={familyFilter}
                                onChange={(event) => setFamilyFilter(event.target.value as KpiFamily | "all")}
                              >
                                <option value="all">All families</option>
                                {familyOptions.map((family) => (
                                  <option key={family} value={family}>
                                    {formatKpiFamilyLabel(family)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="checkbox-inline kpi-toggle-chip">
                              <input type="checkbox" checked={showNa} onChange={(event) => setShowNa(event.target.checked)} />
                              <span>Show N/A</span>
                            </label>
                          </div>
                          <div className="kpi-toolbar-main kpi-toolbar-main--stretch">
                            <label className="search-inline kpi-search">
                              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search KPI..." />
                            </label>
                          </div>
                        </section>

                        {visibleMultiRows.length === 0 ? (
                          <EmptyState
                            title="No KPIs in selected scope"
                            message="Try another scope, family filter, search term, enable Show N/A, or enable the union mode."
                          />
                        ) : (
                          <div className="job-compare-table-wrap">
                            <table className="table job-compare-table job-compare-table-wide">
                              <thead>
                                <tr>
                                  <th>KPI</th>
                                  {jobSummaries.map((job, index) => (
                                    <th key={job.jobId} title={`${job.name}\n${job.jobId}`}>
                                      <span className="job-compare-column-heading">
                                        <strong>{job.name}</strong>
                                        <small>Job {index + 1}</small>
                                      </span>
                                    </th>
                                  ))}
                                  <th>Reported</th>
                                  <th>Unit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {visibleMultiRows.map((row) => (
                                  <tr key={row.key}>
                                    <td>
                                      <div className="kpi-row-label">
                                        <span>
                                          {row.label}
                                          <small className="kpi-row-meta">{row.sourceKey}</small>
                                          <small className="job-compare-secondary">{row.entity}</small>
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
                                    {jobSummaries.map((job) => (
                                      <td key={`${row.key}:${job.jobId}`}>
                                        <strong>{formatRawKpiValue(row.values[job.jobId] ?? null, row.sourceKey, row.unit)}</strong>
                                      </td>
                                    ))}
                                    <td>{row.reportedCount}/{jobIds.length}</td>
                                    <td>{row.unit || "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </section>
                </>
              )}
            </section>
          </div>
        )
      ) : null}
    </div>
  );
}
