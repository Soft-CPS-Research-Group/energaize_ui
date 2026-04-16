import { useState, useEffect, useRef } from "react";
import { LogEntry, getLogs, PREDICTOR_API_URL } from "../api/predictorApi";

function parseLogString(line: string): LogEntry {
  const parts = line.split(" | ");
  if (parts.length >= 5) {
    return {
      raw: line,
      time: parts[0].replace(",", "."),
      level: parts[1].trim(),
      logger: parts[3].trim(),
      message: parts.slice(4).join(" | ").trim(),
    };
  }
  return { raw: line, time: new Date().toISOString(), level: "INFO", logger: "Sys", message: line };
}

export function usePredictorLogs(filter: string = "", limit: number = 300) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    // Load initial logs
    async function loadInitialLogs() {
      try {
        const res: any = await getLogs(filter, limit);
        if (mounted) {
          const lines = res.lines || [];
          const parsedLogs = lines.map(parseLogString);
          setLogs(parsedLogs);
        }
      } catch (err) {
        console.error("Failed to load initial predictor logs:", err);
      }
    }

    loadInitialLogs();

    function connect() {
      if (!mounted) return;

      let wsUrl = PREDICTOR_API_URL;
      if (wsUrl.startsWith("http://")) {
        wsUrl = wsUrl.replace("http://", "ws://");
      } else if (wsUrl.startsWith("https://")) {
        wsUrl = wsUrl.replace("https://", "wss://");
      }
      wsUrl = `${wsUrl}/ws/logs`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return ws.close();
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        if (!mounted) return;
        try {
          // If WS sends the same JSON object
          let entryObj: any;
          try {
            entryObj = JSON.parse(event.data);
            if (entryObj.lines) {
              // Sometimes it might send lines array
              const parsed = entryObj.lines.map(parseLogString);
              setLogs((prev) => {
                 let newLogs = [...prev, ...parsed];
                 if (newLogs.length > limit) newLogs = newLogs.slice(newLogs.length - limit);
                 return newLogs;
              });
              return;
            }
          } catch(e) {
             entryObj = parseLogString(event.data); // raw string
          }
          
          const entry = entryObj as LogEntry;
          if (filter && !entry.message.toLowerCase().includes(filter.toLowerCase()) && 
              entry.level.toLowerCase() !== filter.toLowerCase()) {
            return;
          }

          setLogs((prev) => {
            const prevArray = Array.isArray(prev) ? prev : [];
            const newLogs = [...prevArray, entry];
            if (newLogs.length > limit) {
              return newLogs.slice(newLogs.length - limit);
            }
            return newLogs;
          });
        } catch (e) {
          console.error("Failed to parse predictor log message:", e);
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        setIsConnected(false);
        wsRef.current = null;
        reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error("Predictor WebSocket error:", err);
        ws.close();
      };
    }

    connect();

    return () => {
      mounted = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [filter, limit]);

  return { logs, isConnected };
}