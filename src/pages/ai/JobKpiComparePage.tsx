import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import type { KpiEntry } from "../../types";
import { getJobResult, getJobStatus } from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";
import { EmptyState } from "../../components/ui/EmptyState";
import { StatusPill } from "../../components/ui/StatusPill";
import {
  buildGroupedKpiCompareRows,
  buildKpiMeta,
  formatKpiFamilyLabel,
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

function formatHighlightNumeric(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "N/A";
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(2);
  return value.toFixed(3);
}

interface CompareScope {
  id: string;
  label: string;
  group: "community" | "building" | "other";
  entities: string[];
}

interface HighlightConfig {
  title: string;
  candidates: string[];
}

interface HighlightRow {
  key: string;
  title: string;
  metricLabel: string;
  description: string;
  formula: string;
  unit?: string;
  left: number | null;
  right: number | null;
  delta: number | null;
  tone: KpiCompareGroupedRow["tone"];
  hasComparable: boolean;
}

const DISTRICT_HIGHLIGHTS: HighlightConfig[] = [
  {
    title: "Community Cost",
    candidates: [
      "district_community_settled_cost_total_eur",
      "district_cost_total_control_eur",
      "district_cost_ratio_to_business_as_usual_total_ratio"
    ]
  },
  {
    title: "EV Min SOC",
    candidates: [
      "district_ev_performance_departure_min_acceptable_feasible_ratio",
      "district_ev_performance_departure_min_acceptable_ratio"
    ]
  },
  {
    title: "EV Target Band",
    candidates: [
      "district_ev_performance_departure_within_tolerance_feasible_ratio",
      "district_ev_performance_departure_within_tolerance_ratio"
    ]
  },
  {
    title: "Grid Violations",
    candidates: [
      "district_electrical_service_phase_violations_energy_total_kwh",
      "district_electrical_service_phase_violations_event_count"
    ]
  },
  {
    title: "Peak",
    candidates: [
      "district_energy_grid_shape_quality_peak_daily_average_to_business_as_usual_ratio",
      "district_energy_grid_shape_quality_peak_all_time_average_to_business_as_usual_ratio",
      "district_energy_grid_shape_quality_peak_daily_average_control_kw"
    ]
  },
  {
    title: "Battery Throughput",
    candidates: [
      "district_battery_total_throughput_kwh",
      "district_battery_ratio_to_business_as_usual_throughput_ratio",
      "district_battery_health_equivalent_full_cycles_count"
    ]
  },
  {
    title: "Net Exchange",
    candidates: [
      "district_energy_grid_total_net_exchange_control_kwh",
      "district_energy_grid_ratio_to_business_as_usual_net_exchange_total_ratio",
      "district_energy_grid_total_import_control_kwh"
    ]
  },
  {
    title: "V2G Export",
    candidates: ["district_ev_total_v2g_export_kwh", "district_ev_ratio_to_business_as_usual_v2g_export_total_ratio"]
  }
];

const BUILDING_HIGHLIGHTS: HighlightConfig[] = [
  {
    title: "Cost",
    candidates: [
      "building_cost_total_control_eur",
      "building_cost_ratio_to_business_as_usual_total_ratio",
      "building_cost_daily_average_control_eur"
    ]
  },
  {
    title: "EV Min SOC",
    candidates: [
      "building_ev_performance_departure_min_acceptable_feasible_ratio",
      "building_ev_performance_departure_min_acceptable_ratio"
    ]
  },
  {
    title: "EV Target Band",
    candidates: [
      "building_ev_performance_departure_within_tolerance_feasible_ratio",
      "building_ev_performance_departure_within_tolerance_ratio"
    ]
  },
  {
    title: "Grid Violations",
    candidates: [
      "building_electrical_service_phase_violations_energy_total_kwh",
      "building_electrical_service_phase_violations_event_count"
    ]
  },
  {
    title: "Grid Import",
    candidates: [
      "building_energy_grid_total_import_control_kwh",
      "building_energy_grid_ratio_to_business_as_usual_import_total_ratio"
    ]
  },
  {
    title: "Battery Throughput",
    candidates: [
      "building_battery_total_throughput_kwh",
      "building_battery_ratio_to_business_as_usual_throughput_ratio",
      "building_battery_health_equivalent_full_cycles_count"
    ]
  },
  {
    title: "Deferrable Service",
    candidates: [
      "building_deferrable_appliance_service_service_level_ratio",
      "building_deferrable_appliance_service_unserved_energy_total_kwh",
      "building_deferrable_appliance_ratio_to_business_as_usual_service_level_ratio"
    ]
  },
  {
    title: "V2G Export",
    candidates: ["building_ev_total_v2g_export_kwh", "building_ev_ratio_to_business_as_usual_v2g_export_total_ratio"]
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

function resolveHighlightCandidates(rows: KpiCompareGroupedRow[], candidateKey: string): KpiCompareGroupedRow[] {
  const targetMeta = buildKpiMeta(candidateKey);
  const targetCanonical = targetMeta.canonicalGroupId;
  const targetCanonicalNoLevel = stripKpiLevel(targetCanonical);

  return rows.filter((row) => {
    if (row.canonicalGroupId === targetCanonical) return true;
    if (stripKpiLevel(row.canonicalGroupId) === targetCanonicalNoLevel) return true;
    return row.label.toLowerCase() === targetMeta.metricLabel.toLowerCase() && row.family === targetMeta.family;
  });
}

function resolveHighlightRows(rows: KpiCompareGroupedRow[], level: KpiLevel | null): HighlightRow[] {
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
        const leftUsed = Number(left.row.leftHasValue || left.row.rightHasValue);
        const rightUsed = Number(right.row.leftHasValue || right.row.rightHasValue);
        if (leftUsed !== rightUsed) return rightUsed - leftUsed;
        return left.candidateIndex - right.candidateIndex;
      })
      .map((item) => item.row)[0];

    const primaryMeta = buildKpiMeta(item.candidates[0] || "legacy_kpi");
    const hasComparable = best ? hasComparableSignal(best) : false;

    return {
      key: best?.canonicalGroupId || primaryMeta.canonicalGroupId,
      title: item.title,
      metricLabel: best?.label || primaryMeta.metricLabel,
      description: best?.tooltip.shortDescription || primaryMeta.tooltip.shortDescription,
      formula: best?.tooltip.formulaShort || primaryMeta.tooltip.formulaShort,
      unit: best?.unit,
      left: best?.leftPrimary ?? null,
      right: best?.rightPrimary ?? null,
      delta: best?.deltaAbs ?? null,
      tone: hasComparable ? best?.tone ?? "unknown" : "unknown",
      hasComparable
    };
  });
}

function useJobKpis(jobId: string, enabled: boolean): {
  entries: KpiEntry[];
  isLoading: boolean;
  isError: boolean;
} {
  const resultQuery = useQuery({
    queryKey: ["job-result", jobId],
    queryFn: () => getJobResult(jobId),
    enabled: Boolean(enabled && jobId)
  });

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
    enabled: Boolean(enabled && jobId)
  });

  const kpiFilePath = useMemo(() => {
    const file = simulationIndexQuery.data?.files.find((item) => item.kind === "kpi");
    return file?.relativePath || null;
  }, [simulationIndexQuery.data?.files]);

  const kpiCsvQuery = useQuery({
    queryKey: ["simulation-kpis", jobId, kpiFilePath || ""],
    queryFn: async () => {
      const source = simulationIndexQuery.data;
      if (!source || !kpiFilePath) {
        return { rows: [] as Array<{ key: string; label: string; unit?: string; values: Record<string, number | null> }>, entries: [] as KpiEntry[] };
      }
      const content = await readSimulationDataFile(source, kpiFilePath);
      const parsed = extractKpisFromSimulationData(content);
      return {
        rows: parsed.rows,
        entries: buildEntriesFromMatrixRows(parsed.rows)
      };
    },
    enabled: Boolean(enabled && jobId && simulationIndexQuery.data && kpiFilePath)
  });

  const fallbackKpis = useMemo(() => extractKpis(resultQuery.data), [resultQuery.data]);

  const entries = useMemo(() => {
    if (kpiCsvQuery.data?.entries && kpiCsvQuery.data.entries.length > 0) {
      return kpiCsvQuery.data.entries;
    }
    return fallbackKpis;
  }, [fallbackKpis, kpiCsvQuery.data?.entries]);

  const isLoading = resultQuery.isLoading || simulationIndexQuery.isLoading || kpiCsvQuery.isLoading;
  const isError = resultQuery.isError || simulationIndexQuery.isError || kpiCsvQuery.isError;

  return {
    entries,
    isLoading,
    isError
  };
}

export function JobKpiComparePage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAll, setShowAll] = useState(false);
  const [showNa, setShowNa] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedScopeId, setSelectedScopeId] = useState("community");
  const [familyFilter, setFamilyFilter] = useState<KpiFamily | "all">("all");

  const leftId = searchParams.get("left") || "";
  const rightId = searchParams.get("right") || "";
  const fromParam = searchParams.get("from");
  const backTarget = resolveBackTarget(fromParam);

  const leftStatusQuery = useQuery({
    queryKey: ["job-status", leftId],
    queryFn: () => getJobStatus(leftId),
    enabled: Boolean(leftId)
  });

  const rightStatusQuery = useQuery({
    queryKey: ["job-status", rightId],
    queryFn: () => getJobStatus(rightId),
    enabled: Boolean(rightId)
  });

  const leftData = useJobKpis(leftId, Boolean(leftId));
  const rightData = useJobKpis(rightId, Boolean(rightId));

  const rows = useMemo<KpiCompareGroupedRow[]>(
    () =>
      buildGroupedKpiCompareRows(leftData.entries, rightData.entries, {
        showAll
      }),
    [leftData.entries, rightData.entries, showAll]
  );

  const scopes = useMemo<CompareScope[]>(() => {
    if (rows.length === 0) return [];
    const entities = new Set(rows.map((row) => row.entity).filter(Boolean));
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
  }, [rows]);

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

  const familyOptions = useMemo(
    () => sortKpiFamilies(Array.from(new Set(scopedRows.map((row) => row.family)))),
    [scopedRows]
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

  const highlightRows = useMemo(() => resolveHighlightRows(scopedRows, selectedLevel), [scopedRows, selectedLevel]);

  const missingSelection = !leftId || !rightId;
  const isLoading =
    leftData.isLoading ||
    rightData.isLoading ||
    leftStatusQuery.isLoading ||
    rightStatusQuery.isLoading;

  function swapJobs(): void {
    const params = new URLSearchParams(searchParams);
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
          <Button variant="secondary" onClick={swapJobs} disabled={missingSelection}>
            Swap
          </Button>
        </div>
      </header>

      {missingSelection ? (
        <EmptyState
          title="Select two jobs first"
          message="Go back to Jobs and select exactly two completed jobs to compare KPIs."
          action={
            <Button variant="secondary" onClick={() => navigate(backTarget)}>
              Back to Jobs
            </Button>
          }
        />
      ) : null}

      {!missingSelection ? (
        <section className="job-compare-header panel">
          <article>
            <small>Left job (reference)</small>
            <strong>{leftId}</strong>
            <StatusPill status={leftStatusQuery.data?.status || "unknown"} />
          </article>
          <article>
            <small>Right job (candidate)</small>
            <strong>{rightId}</strong>
            <StatusPill status={rightStatusQuery.data?.status || "unknown"} />
          </article>
          <label className="checkbox-inline">
            <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
            <span>Show all KPIs (union)</span>
          </label>
        </section>
      ) : null}

      {!missingSelection && isLoading ? (
        <section className="datasets-loader-preview">
          <EVChargingLoader label="Loading comparison data..." />
        </section>
      ) : null}

      {!missingSelection && !isLoading && (leftData.isError || rightData.isError) ? (
        <EmptyState
          title="Could not load KPI payload"
          message="One of the selected jobs has no accessible KPI source right now."
        />
      ) : null}

      {!missingSelection && !isLoading && !leftData.isError && !rightData.isError ? (
        rows.length === 0 ? (
          <EmptyState
            title="No comparable KPIs"
            message="No common numeric KPI keys were found in the two selected jobs."
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
              <section className="kpi-toolbar panel">
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

              {highlightRows.length > 0 ? (
                <section className="kpi-highlights-strip panel">
                  <header className="kpi-section-header">
                    <h3>Curated Highlights</h3>
                    <small>Fixed KPI bar for quick checks in this scope.</small>
                  </header>
                  <div className="kpi-highlight-grid">
                    {highlightRows.map((item) => (
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
                        <div className="kpi-compare-highlight-values">
                          <strong>{formatHighlightNumeric(item.left)}</strong>
                          <small>L</small>
                          <strong>{formatHighlightNumeric(item.right)}</strong>
                          <small>R</small>
                        </div>
                        <footer>
                          <small>{item.hasComparable ? `Δ ${formatHighlightNumeric(item.delta)}` : "No pair to compare"}</small>
                          <small>{item.unit || "-"}</small>
                        </footer>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {visibleRows.length === 0 ? (
                <EmptyState
                  title="No KPIs in selected scope"
                  message="Try another scope, family filter, search term, or enable Show N/A."
                />
              ) : (
                rowsByFamily.map((familySection) => {
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
                            <div className="job-compare-table-wrap">
                              <table className="table job-compare-table">
                                <thead>
                                  <tr>
                                    <th>KPI</th>
                                    <th>{leftId}</th>
                                    <th>{rightId}</th>
                                    <th>Delta (R-L)</th>
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
                                          <strong>{formatNumeric(row.leftPrimary)}</strong>
                                          {row.leftSecondary ? (
                                            <small className="job-compare-secondary">
                                              BAU: {formatNumeric(row.leftSecondary.baseline)} · Δ: {formatNumeric(row.leftSecondary.delta)}
                                            </small>
                                          ) : null}
                                        </td>
                                        <td>
                                          <strong>{formatNumeric(row.rightPrimary)}</strong>
                                          {row.rightSecondary ? (
                                            <small className="job-compare-secondary">
                                              BAU: {formatNumeric(row.rightSecondary.baseline)} · Δ: {formatNumeric(row.rightSecondary.delta)}
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
                                          {formatNumeric(row.deltaAbs)}
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
            </section>
          </div>
        )
      ) : null}
    </div>
  );
}
