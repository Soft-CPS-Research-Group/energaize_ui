import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getJobResult, getJobStatus } from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { StatusPill } from "../../components/ui/StatusPill";
import { buildKpiComparisonRows, extractKpis } from "../../utils/jobResult";

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

  const leftResultQuery = useQuery({
    queryKey: ["job-result", leftId],
    queryFn: () => getJobResult(leftId),
    enabled: Boolean(leftId)
  });

  const rightResultQuery = useQuery({
    queryKey: ["job-result", rightId],
    queryFn: () => getJobResult(rightId),
    enabled: Boolean(rightId)
  });

  const leftKpis = useMemo(() => extractKpis(leftResultQuery.data), [leftResultQuery.data]);
  const rightKpis = useMemo(() => extractKpis(rightResultQuery.data), [rightResultQuery.data]);
  const rows = useMemo(
    () => buildKpiComparisonRows(leftKpis, rightKpis, showAll),
    [leftKpis, rightKpis, showAll]
  );

  const missingSelection = !leftId || !rightId;
  const isLoading =
    leftResultQuery.isLoading ||
    rightResultQuery.isLoading ||
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
          <p>Side-by-side KPI analysis for two completed simulations.</p>
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
            <small>Left job</small>
            <strong>{leftId}</strong>
            <StatusPill status={leftStatusQuery.data?.status || "unknown"} />
          </article>
          <article>
            <small>Right job</small>
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

      {!missingSelection && !isLoading && (leftResultQuery.isError || rightResultQuery.isError) ? (
        <EmptyState
          title="Could not load KPI payload"
          message="One of the selected jobs has no accessible result endpoint right now."
        />
      ) : null}

      {!missingSelection && !isLoading && !leftResultQuery.isError && !rightResultQuery.isError ? (
        rows.length === 0 ? (
          <EmptyState
            title="No comparable KPIs"
            message="No common numeric KPI keys were found in the two result payloads."
          />
        ) : (
          <section className="panel job-compare-table-wrap">
            <table className="table job-compare-table">
              <thead>
                <tr>
                  <th>KPI</th>
                  <th>{leftId}</th>
                  <th>{rightId}</th>
                  <th>Delta</th>
                  <th>Delta %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{formatNumeric(row.left)}</td>
                    <td>{formatNumeric(row.right)}</td>
                    <td className={row.deltaAbs !== null && row.deltaAbs > 0 ? "kpi-delta-positive" : row.deltaAbs !== null && row.deltaAbs < 0 ? "kpi-delta-negative" : ""}>
                      {formatNumeric(row.deltaAbs)}
                    </td>
                    <td className={row.deltaPct !== null && row.deltaPct > 0 ? "kpi-delta-positive" : row.deltaPct !== null && row.deltaPct < 0 ? "kpi-delta-negative" : ""}>
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
