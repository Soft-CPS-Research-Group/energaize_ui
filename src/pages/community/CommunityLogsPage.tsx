import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../contexts/AuthContext";
import { useUI } from "../../contexts/UIContext";
import { getEnergyEntity, getEnergyLogs } from "../../data/energyCommunity";
import type { LogEntry } from "../../types";
import { formatDateTime } from "../../utils/time";

type LogLevelFilter = "all" | LogEntry["level"];

function levelTone(level: LogEntry["level"]): "neutral" | "success" | "warning" | "danger" | "info" {
  if (level === "error") return "danger";
  if (level === "warning") return "warning";
  if (level === "info") return "info";
  return "neutral";
}

export function CommunityLogsPage(): JSX.Element {
  const { session } = useAuth();
  const { activeCommunity, selectedEntityId } = useUI();
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LogLevelFilter>("all");
  const logs = useMemo(() => getEnergyLogs(session?.role), [session?.role]);
  const selectedEntity = getEnergyEntity(activeCommunity, session?.role, selectedEntityId);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return logs.filter((item) => {
      if (level !== "all" && item.level !== level) return false;
      if (selectedEntity.id !== "community" && item.entity !== selectedEntity.label) return false;
      if (!normalized) return true;
      return [item.source, item.level, item.message, item.entity || ""].join(" ").toLowerCase().includes(normalized);
    });
  }, [level, logs, query, selectedEntity.id, selectedEntity.label]);

  return (
    <div className="page energy-console-page">
      <header className="energy-page-head">
        <div>
          <span className="section-kicker">{session?.role === "prosumer" ? "Personal events" : "System trace"}</span>
          <h1>Logs</h1>
          <p>{activeCommunity.name} technical events and operational trace.</p>
        </div>
        <Button variant="secondary" iconLeft={<Download size={15} />}>Export</Button>
      </header>

      <section className="energy-log-toolbar">
        <label className="search-inline">
          <Search size={14} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search logs, source or entity"
          />
        </label>
        <select value={level} onChange={(event) => setLevel(event.target.value as LogLevelFilter)}>
          <option value="all">All levels</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
          {session?.role !== "prosumer" ? <option value="debug">Debug</option> : null}
        </select>
      </section>

      <section className="energy-logs-panel panel">
        <table className="table energy-log-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Level</th>
              <th>Source</th>
              <th>Entity</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.timestamp)}</td>
                <td><Badge tone={levelTone(item.level)}>{item.level}</Badge></td>
                <td>{item.source}</td>
                <td>{item.entity || "-"}</td>
                <td>{item.message}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 ? (
          <div className="energy-log-empty">
            <strong>No logs match the current filters.</strong>
            <span>Try a wider level or search query.</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
