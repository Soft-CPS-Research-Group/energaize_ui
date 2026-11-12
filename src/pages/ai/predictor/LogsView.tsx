import { useState, useRef, useEffect, useMemo } from "react";
import { Search } from "lucide-react";
import { usePredictorLogs, type LogStreamStatus } from "../../../hooks/usePredictorLogs";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { InfoTip } from "../../../components/ui/InfoTip";
import { lineMatches } from "./logLines";
import { logLineFilter } from "./workspaceScope";
import { usePredictorScope } from "../../../contexts/PredictorWorkspaceContext";

const LOG_LIMIT = 500;
/** The server re-reads the whole log file for every filter, so wait for typing to settle. */
const FILTER_DEBOUNCE_MS = 400;

const STREAM_BADGE: Record<LogStreamStatus, { label: string; tone: "success" | "neutral" | "warning" }> = {
  live: { label: "Live", tone: "success" },
  connecting: { label: "Connecting…", tone: "neutral" },
  reconnecting: { label: "Reconnecting…", tone: "warning" },
};

function levelClass(level: string): string {
  const upper = level.toUpperCase();
  if (upper === "ERROR" || upper === "CRITICAL") return "log-level is-error";
  if (upper === "WARN" || upper === "WARNING") return "log-level is-warn";
  if (upper === "INFO") return "log-level is-info";
  return "log-level";
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function LogsView({ timezone }: { timezone: string }) {
  const [filter, setFilter] = useState("");
  const serverFilter = useDebounced(filter.trim(), FILTER_DEBOUNCE_MS);
  const { logs, status, loadFailed } = usePredictorLogs(serverFilter, LOG_LIMIT);
  // A community workspace hides lines about other communities' houses; service-wide lines stay.
  const { allHouses, scope, community } = usePredictorScope();
  const inScope = useMemo(() => logLineFilter(allHouses, scope), [allHouses, scope]);
  // Narrow what is already loaded right away; the server fetch catches up after the debounce.
  const visible = useMemo(() => logs.filter((entry) => inScope(entry.raw) && lineMatches(entry, filter)), [logs, filter, inScope]);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const formatters = useMemo(() => {
    const options = { timeZone: timezone, hour12: false } as const;
    return {
      time: new Intl.DateTimeFormat("en-GB", { ...options, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      day: new Intl.DateTimeFormat("en-GB", { ...options, day: "numeric", month: "short" }),
    };
  }, [timezone]);
  const today = formatters.day.format(new Date());

  function formatTime(iso: string): { time: string; day: string | null } | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const day = formatters.day.format(date);
    return { time: formatters.time.format(date), day: day === today ? null : day };
  }

  useEffect(() => {
    // Scroll only the log box; scrollIntoView would also scroll the page and hide the header.
    const box = terminalRef.current;
    if (autoScroll && box) box.scrollTop = box.scrollHeight;
  }, [visible, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const t = e.currentTarget;
    setAutoScroll(t.scrollHeight - t.scrollTop <= t.clientHeight + 50);
  };

  const badge = STREAM_BADGE[status];
  let empty: string | null = null;
  if (visible.length === 0) {
    if (loadFailed) empty = "Could not load the log file. New lines still appear here while the live stream is connected.";
    else if (filter.trim()) empty = `No lines match "${filter.trim()}".`;
    else empty = status === "live" ? "Waiting for the next log line…" : "Connecting to the log stream…";
  }

  return (
    <div className="panel predictor-logs-panel">
      <div className="predictor-logs-header">
        <div className="predictor-logs-header-left">
          <h2>Service logs</h2>
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {community && (
            <InfoTip tip={`Lines about houses outside ${community.name} are hidden. Lines about the service as a whole stay.`} />
          )}
        </div>

        <div className="predictor-logs-header-right">
          <label className="search-inline predictor-logs-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              placeholder="Filter logs (house, level, text)"
              aria-label="Filter log lines"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant={autoScroll ? "primary" : "secondary"}
            aria-pressed={autoScroll}
            onClick={() => setAutoScroll((v) => !v)}
          >
            {autoScroll ? "Following" : "Follow"}
          </Button>
        </div>
      </div>

      {loadFailed && visible.length > 0 && (
        <p className="predictor-logs-warning" role="status">
          Could not load earlier lines from the log file; showing live lines only.
        </p>
      )}

      <div ref={terminalRef} className="log-terminal" role="log" aria-live="off" onScroll={handleScroll}>
        {empty ? (
          <div className="log-terminal-empty">{empty}</div>
        ) : (
          visible.map((log, idx) => {
            const when = formatTime(log.time);
            return (
              <div key={idx} className="log-line">
                <span className="log-time" title={log.time || undefined}>
                  {when ? (
                    <>
                      {when.day && <span className="log-day">{when.day} </span>}
                      {when.time}
                    </>
                  ) : "—"}
                </span>
                <span className={levelClass(log.level)}>{log.level || "—"}</span>
                <span className="log-message">
                  {log.logger && <span className="log-logger">{log.logger}</span>}
                  {log.job_id && <span className="log-job-id">job {log.job_id.slice(0, 6)}</span>}
                  {log.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
