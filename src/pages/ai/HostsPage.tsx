import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cpu, RefreshCcw, Server } from "lucide-react";
import { listHosts, listJobs, listJobsInitialData } from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import type { HostInfo } from "../../types";
import { resolveHostCapacitySummary } from "../../utils/hostCapacity";
import { inferBudgetAccountKind } from "../../utils/hostBudget";
import { resolveHostComputeBadge } from "../../utils/hostCompute";
import { formatHostName } from "../../utils/hostDisplay";
import { formatDateTime } from "../../utils/time";

function isRecentHostUpdate(lastSeen: number | null): boolean {
  if (!lastSeen) return false;
  const epochMs = lastSeen > 9999999999 ? lastSeen : lastSeen * 1000;
  return Date.now() - epochMs <= 5 * 60 * 1000;
}

function renderBudgetLine(
  accounts:
    | Array<{ account: string; used_hours: number; limit_hours: number; used_percent: number }>
    | undefined
): JSX.Element | string {
  if (!accounts || accounts.length === 0) return "-";
  return (
    <div className="host-budget-inline-list">
      {accounts.map((item) => {
        const kind = inferBudgetAccountKind(item.account);
        return (
          <span key={item.account} className="host-budget-inline-item">
            <span className={`host-budget-kind is-${kind.toLowerCase()}`}>{kind}</span>
            <small className="host-budget-code">{item.account}</small>
            <small>{item.used_percent.toFixed(1)}%</small>
          </span>
        );
      })}
    </div>
  );
}

function renderCapacityLine(hostName: string, host: HostInfo): JSX.Element {
  const capacity = resolveHostCapacitySummary(hostName, host);
  return (
    <span className={`jobs-capacity-line${capacity.overCapacity ? " is-over-capacity" : ""}`}>
      {capacity.label}
    </span>
  );
}

export function HostsPage(): JSX.Element {
  const hostsQuery = useQuery({
    queryKey: ["hosts"],
    queryFn: listHosts,
    refetchInterval: 7000
  });
  const jobsQuery = useQuery({
    queryKey: ["jobs"],
    queryFn: listJobs,
    initialData: listJobsInitialData,
    refetchInterval: 7000
  });

  const rows = useMemo(() => {
    return Object.entries(hostsQuery.data?.hosts || {}).map(([name, data]) => ({ name, ...data }));
  }, [hostsQuery.data?.hosts]);
  const jobsById = useMemo(() => {
    return new Map((jobsQuery.data || []).map((job) => [job.job_id, job] as const));
  }, [jobsQuery.data]);

  function resolveJobName(jobId: string | null | undefined): string {
    if (!jobId) return "-";
    const candidate = jobsById.get(jobId);
    if (!candidate) return jobId;
    return candidate.job_info.job_name || candidate.job_info.run_name || jobId;
  }

  return (
    <div className="page">
      <PageHeader
        title="Hosts"
        subtitle="Worker availability, active jobs and compute capacity."
        actions={
          <Button variant="secondary" iconLeft={<RefreshCcw size={14} />} onClick={() => hostsQuery.refetch()}>
            Refresh
          </Button>
        }
      />

      {rows.length > 0 ? (
        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Host</th>
                <th>Status</th>
                <th>Slots</th>
                <th>Active Job</th>
                <th>Terminal State</th>
                <th>Budget</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const computeBadge = resolveHostComputeBadge(row.name, row);
                return (
                  <tr key={row.name}>
                    <td>
                      <div className="host-name">
                        <Server size={14} />
                        <strong>{formatHostName(row.name)}</strong>
                        <span
                          className={`host-compute-pill is-${computeBadge.kind}`}
                          title={computeBadge.title}
                          aria-label={computeBadge.title}
                        >
                          <Cpu size={11} />
                          {computeBadge.label}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`host-live-dot${isRecentHostUpdate(row.last_seen) ? " is-online" : ""}`} />
                      {isRecentHostUpdate(row.last_seen) ? " Live" : " Offline"}
                    </td>
                    <td>{renderCapacityLine(row.name, row)}</td>
                    <td>{resolveJobName(row.current_job_id || row.info.active_job_id || null)}</td>
                    <td>{row.current_job_status || row.info.active_job_status || row.info.last_terminal_status || "-"}</td>
                    <td>{renderBudgetLine(row.info.budget?.accounts)}</td>
                    <td>{formatDateTime(row.last_seen)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : (
        <EmptyState
          title="No host telemetry"
          message="Hosts will appear after worker heartbeat events."
          action={<Server size={18} />}
        />
      )}
    </div>
  );
}
