import { useState, useRef, useEffect } from "react";
import { usePredictorLogs } from "../../../hooks/usePredictorLogs";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";

function levelClass(level: string): string {
  if (level === "ERROR") return "log-level log-level-error";
  if (level === "WARN" || level === "WARNING") return "log-level log-level-warn";
  if (level === "INFO") return "log-level log-level-info";
  return "log-level log-level-debug";
}

export function LogsView() {
  const [filter, setFilter] = useState("");
  const { logs, isConnected } = usePredictorLogs(filter, 500);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const t = e.currentTarget;
    setAutoScroll(t.scrollHeight - t.scrollTop <= t.clientHeight + 50);
  };

  return (
    <div className="panel predictor-logs-panel">
      <div className="predictor-logs-header">
        <div className="predictor-logs-header-left">
          <h2>Live Application Logs</h2>
          <Badge tone={isConnected ? "success" : "danger"}>
            {isConnected ? "Live" : "Disconnected"}
          </Badge>
        </div>

        <div className="predictor-logs-header-right">
          <label className="search-inline" style={{ minWidth: 220 }}>
            <input
              type="text"
              placeholder="Filter by level or message…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant={autoScroll ? "primary" : "secondary"}
            onClick={() => setAutoScroll((v) => !v)}
          >
            {autoScroll ? "Following" : "Follow"}
          </Button>
        </div>
      </div>

      <div className="log-terminal" onScroll={handleScroll}>
        {logs.length === 0 ? (
          <div className="log-terminal-empty">Waiting for log stream…</div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="log-line">
              <span className="log-time">
                {log.time
                  ? new Date(log.time).toLocaleTimeString([], {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  : "—"}
              </span>
              <span className={levelClass(log.level)}>{log.level?.slice(0, 5).padEnd(5)}</span>
              {log.logger && <span className="log-logger">[{log.logger}]</span>}
              {log.job_id && <span className="log-job-id">({log.job_id.slice(0, 6)})</span>}
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}