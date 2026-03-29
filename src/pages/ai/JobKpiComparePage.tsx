import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getJobResult, getJobStatus } from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { StatusPill } from "../../components/ui/StatusPill";
import {
  findSimulationDataDir,
  findSimulationDataSessionDefault,
  getSimulationDataIndex,
  readSimulationDataFile
} from "../../services/simulationDataService";
import { extractKpis } from "../../utils/jobResult";
import { buildComparedKpis, extractKpisFromSimulationData } from "../../utils/simulationData";

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

  const rows = useMemo(
    () => buildComparedKpis(leftData.entries, rightData.entries, showAll),
    [leftData.entries, rightData.entries, showAll]
  );

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

      {!missingSelection && isLoading ? <p className="jobs-meta">Loading comparison data...</p> : null}

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
          <section className="panel job-compare-table-wrap">
            <table className="table job-compare-table">
              <thead>
                <tr>
                  <th>KPI</th>
                  <th>{leftId}</th>
                  <th>{rightId}</th>
                  <th>Delta (R-L)</th>
                  <th>Delta %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{formatNumeric(row.left)}</td>
                    <td>{formatNumeric(row.right)}</td>
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
          </section>
        )
      ) : null}
    </div>
  );
}
