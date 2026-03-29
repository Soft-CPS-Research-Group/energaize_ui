import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCcw, Server } from "lucide-react";
import { listHosts } from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatDateTime } from "../../utils/time";

function isRecentHostUpdate(lastSeen: number | null): boolean {
  if (!lastSeen) return false;
  const epochMs = lastSeen > 9999999999 ? lastSeen : lastSeen * 1000;
  return Date.now() - epochMs <= 5 * 60 * 1000;
}

function formatBudgetLine(
  accounts:
    | Array<{ account: string; used_hours: number; limit_hours: number; used_percent: number }>
    | undefined
): string {
  if (!accounts || accounts.length === 0) return "-";
  return accounts
    .map((item) => `${item.account}: ${item.used_percent.toFixed(1)}% (${item.used_hours}/${item.limit_hours}h)`)
    .join(" | ");
}

export function HostsPage(): JSX.Element {
  const hostsQuery = useQuery({
    queryKey: ["hosts"],
    queryFn: listHosts,
    refetchInterval: 7000
  });

  const rows = useMemo(() => {
    return Object.entries(hostsQuery.data?.hosts || {}).map(([name, data]) => ({ name, ...data }));
  }, [hostsQuery.data?.hosts]);

  return (
    <div className="page">
      <PageHeader
        title="Hosts"
        subtitle="Worker availability, active jobs and Deucalion budget snapshot."
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
                <th>Active Job</th>
                <th>Terminal State</th>
                <th>Budget</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>
                    <div className="host-name">
                      <Server size={14} />
                      <strong>{row.name}</strong>
                    </div>
                  </td>
                  <td>
                    <span className={`host-live-dot${isRecentHostUpdate(row.last_seen) ? " is-online" : ""}`} />
                    {isRecentHostUpdate(row.last_seen) ? " Live" : " Offline"}
                  </td>
                  <td>{row.current_job_id || row.info.active_job_id || "-"}</td>
                  <td>{row.current_job_status || row.info.active_job_status || row.info.last_terminal_status || "-"}</td>
                  <td>{formatBudgetLine(row.info.budget?.accounts)}</td>
                  <td>{formatDateTime(row.last_seen)}</td>
                </tr>
              ))}
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
