import { useState, useRef, useEffect } from "react";
import { usePredictorLogs } from "../../../hooks/usePredictorLogs";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";

export function LogsView() {
  const [filter, setFilter] = useState("");
  const { logs, isConnected } = usePredictorLogs(filter, 500);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto scroll to bottom
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    // Disable auto scroll if user scrolls up manually
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
    setAutoScroll(isAtBottom);
  };

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 200px)", padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", borderBottom: "1px solid var(--border)", backgroundColor: "var(--bg-subtle)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Live Application Logs</h2>
          {isConnected ? (
            <Badge tone="success">Connected</Badge>
          ) : (
            <Badge tone="danger">Disconnected</Badge>
          )}
        </div>
        
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            className="input"
            style={{ width: "256px", fontSize: "0.875rem", padding: "8px 12px" }}
            placeholder="Filter logs by level or message..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Button
            size="sm"
            variant={autoScroll ? "primary" : "secondary"}
            onClick={() => setAutoScroll(!autoScroll)}
          >
            {autoScroll ? "Following" : "Follow"}
          </Button>
        </div>
      </div>

      <div 
        style={{ flex: 1, overflowY: "auto", backgroundColor: "#0d1117", padding: "16px", fontFamily: "monospace", fontSize: "0.875rem", lineHeight: 1.5 }}
        onScroll={handleScroll as any}
      >
        {logs.length === 0 ? (
          <div style={{ color: "#8b949e", fontStyle: "italic" }}>Waiting for log stream...</div>
        ) : (
           logs.map((log, idx) => (
             <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "4px", padding: "4px", borderRadius: "4px", transition: "background-color 0.2s" }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"} onMouseOut={(e) => e.currentTarget.style.backgroundColor = "transparent"}>
               <span style={{ color: "#8b949e", flexShrink: 0, minWidth: "112px" }}>
                 {log.time ? new Date(log.time).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit', fractionalSecondDigits: 3 }) : "Wait"}
               </span>
               <span style={{ flexShrink: 0, minWidth: "56px", fontWeight: "bold", color: log.level === "ERROR" ? "var(--danger)" : log.level === "WARN" ? "var(--warning)" : log.level === "INFO" ? "var(--info)" : "inherit" }}>
                 {log.level?.padEnd(5)}
               </span>
               {log.logger && (
                 <span style={{ color: "#79c0ff", flexShrink: 0 }}>[{log.logger}]</span>
               )}
               {log.job_id && (
                 <span style={{ color: "#d2a8ff", flexShrink: 0 }}>({log.job_id.slice(0,6)})</span>
               )}
               <span style={{ color: "#c9d1d9", flex: 1, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{log.message}</span>
             </div>
           ))
        )}
        <div ref={bottomRef} style={{ height: 0, width: 0 }} />
      </div>
    </div>
  );
}