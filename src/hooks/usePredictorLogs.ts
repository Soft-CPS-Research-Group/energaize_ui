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

const RECONNECT_MIN_MS = 3000;
const RECONNECT_MAX_MS = 30000;

/** Resolve a predictor path to a ws(s):// URL; the base may be relative (/predictor-api). */
export function predictorWebSocketUrl(path: string, base: string = PREDICTOR_API_URL): string {
  const url = new URL(`${base}${path}`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function usePredictorLogs(filter: string = "", limit: number = 300) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_MIN_MS);

  useEffect(() => {
    let mounted = true;

    // Load initial logs
    async function loadInitialLogs() {
      try {
        const res = await getLogs(filter, limit);
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

      const ws = new WebSocket(predictorWebSocketUrl("/ws/logs"));
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return ws.close();
        reconnectDelayRef.current = RECONNECT_MIN_MS;
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
        reconnectTimeoutRef.current = window.setTimeout(connect, reconnectDelayRef.current);
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, RECONNECT_MAX_MS);
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