import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Building2, Factory, FolderTree } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getJobResult, getJobStatus } from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";
import { EmptyState } from "../../components/ui/EmptyState";
import { StatusPill } from "../../components/ui/StatusPill";
import {
  buildGroupedKpiCompareRows,
  formatKpiFamilyLabel,
  sortKpiFamilies,
  type KpiCompareGroupedRow,
  type KpiFamily
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
  if (value === null || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  return value.toFixed(4);
}

interface CompareScope {
  id: string;
  label: string;
  group: "community" | "building" | "other";
  entities: string[];
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

function useJobKpis(jobId: string, enabled: boolean): {
  entries: ReturnType<typeof extractKpis>;
  isLoading: boolean;
  isError: boolean;
} {
  const resultQuery = useQuery({
    queryKey: ["job-result", jobId],
    queryFn: () => getJobResult(jobId),
    enabled: Boolean(enabled && jobId)
  });

  const simulationDataDir = useMemo(
    () => findSimulationDataDir(resultQuery.data),
    [resultQuery.data]
  );
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
        return { entries: [] };
      }
      const content = await readSimulationDataFile(source, kpiFilePath);
      const parsed = extractKpisFromSimulationData(content);
      return { entries: parsed.entries };
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

  const scopedRows = useMemo(() => {
    if (!selectedScope) return rows;
    const entitySet = new Set(selectedScope.entities);
    return rows.filter((row) => entitySet.has(row.entity));
  }, [rows, selectedScope]);

  const familyOptions = useMemo(
    () => sortKpiFamilies(Array.from(new Set(scopedRows.map((row) => row.family)))),
    [scopedRows]
  );

  useEffect(() => {
    if (familyFilter !== "all" && !familyOptions.includes(familyFilter)) {
      setFamilyFilter("all");
    }
  }, [familyFilter, familyOptions]);

  const filteredRows = useMemo(
    () => (familyFilter === "all" ? scopedRows : scopedRows.filter((row) => row.family === familyFilter)),
    [familyFilter, scopedRows]
  );

  const rowsByFamily = useMemo(() => {
    const grouped = new Map<KpiFamily, KpiCompareGroupedRow[]>();
    filteredRows.forEach((row) => {
      const current = grouped.get(row.family) || [];
      current.push(row);
      grouped.set(row.family, current);
    });
    return sortKpiFamilies(Array.from(grouped.keys())).map((family) => ({
      family,
      rows: grouped.get(family) || []
    }));
  }, [filteredRows]);

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
            <small>Left job (baseline)</small>
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
            <span>Show all KPIs (with N/A)</span>
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
                <div className="kpi-filter-row">
                  <label className="kpi-filter">
                    <span>Family</span>
                    <select
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
                </div>
                <small>
                  {filteredRows.length} grouped KPI row(s) · scope: {selectedScope?.label || "-"}
                </small>
              </section>

              {filteredRows.length === 0 ? (
                <EmptyState
                  title="No KPIs in selected scope"
                  message="Try another entity scope, family filter, or enable Show all."
                />
              ) : (
                rowsByFamily.map((section) => (
                  <article key={section.family} className="panel job-compare-family-section">
                    <header className="kpi-section-header">
                      <h3>{formatKpiFamilyLabel(section.family)}</h3>
                      <small>{section.rows.length} KPI group(s)</small>
                    </header>
                    <div className="job-compare-table-wrap">
                      <table className="table job-compare-table">
                        <thead>
                          <tr>
                            <th>KPI</th>
                            <th>Aggregation</th>
                            <th>{leftId}</th>
                            <th>{rightId}</th>
                            <th>Delta (R-L)</th>
                            <th>Delta %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((row) => (
                            <tr key={row.key}>
                              <td>{row.label}</td>
                              <td>{row.aggregation.replaceAll("_", " ")}</td>
                              <td>
                                <strong>{formatNumeric(row.leftPrimary)}</strong>
                                {row.leftSecondary ? (
                                  <small className="job-compare-secondary">
                                    B: {formatNumeric(row.leftSecondary.baseline)} · Δ: {formatNumeric(row.leftSecondary.delta)}
                                  </small>
                                ) : null}
                              </td>
                              <td>
                                <strong>{formatNumeric(row.rightPrimary)}</strong>
                                {row.rightSecondary ? (
                                  <small className="job-compare-secondary">
                                    B: {formatNumeric(row.rightSecondary.baseline)} · Δ: {formatNumeric(row.rightSecondary.delta)}
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
                                {row.deltaPct === null ? "-" : `${row.deltaPct.toFixed(2)}%`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                ))
              )}
            </section>
          </div>
        )
      ) : null}
    </div>
  );
}
