import { useState, useEffect, useRef } from "react";
import { LogEntry, getLogs, PREDICTOR_API_URL } from "../api/predictorApi";
import { lineMatches, parseLogLine } from "../pages/ai/predictor/logLines";

const RECONNECT_MIN_MS = 3000;
const RECONNECT_MAX_MS = 30000;

export type LogStreamStatus = "connecting" | "live" | "reconnecting";

/** Resolve a predictor path to a ws(s):// URL; the base may be relative (/predictor-api). */
export function predictorWebSocketUrl(path: string, base: string = PREDICTOR_API_URL): string {
  const url = new URL(`${base}${path}`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * Recent lines matching `filter` from the log file, followed by matching live lines.
 * Changing the filter re-reads the file but keeps the live connection open; callers
 * should debounce it, since the server scans the whole file on every request.
 */
export function usePredictorLogs(filter: string = "", limit: number = 300) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<LogStreamStatus>("connecting");
  const [loadFailed, setLoadFailed] = useState(false);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    let cancelled = false;
    getLogs(filter, limit)
      .then((res) => {
        if (cancelled) return;
        setLoadFailed(false);
        setLogs((res.lines || []).map((line) => parseLogLine(line)));
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, [filter, limit]);

  useEffect(() => {
    let mounted = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let delay = RECONNECT_MIN_MS;

    function connect() {
      if (!mounted) return;
      socket = new WebSocket(predictorWebSocketUrl("/ws/logs"));
      socket.onopen = () => {
        delay = RECONNECT_MIN_MS;
        setStatus("live");
      };
      socket.onmessage = (event) => {
        const lines: string[] = typeof event.data === "string" ? event.data.split("\n").filter(Boolean) : [];
        const entries = lines.map((line) => parseLogLine(line)).filter((entry) => lineMatches(entry, filterRef.current));
        if (entries.length === 0) return;
        setLogs((prev) => [...prev, ...entries].slice(-limit));
      };
      socket.onclose = () => {
        if (!mounted) return;
        setStatus("reconnecting");
        reconnectTimer = window.setTimeout(connect, delay);
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
      };
      socket.onerror = () => socket?.close();
    }

    connect();
    return () => {
      mounted = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [limit]);

  return { logs, status, isConnected: status === "live", loadFailed };
}
