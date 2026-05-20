import { useEffect, useRef, useState, useCallback } from "react";
import { streamAlerts, type KpiAlert } from "../api/kpiApi";

export interface UseAlertsOptions {
  community: string;
  /** If false, the SSE connection is not opened (e.g. tab not visible). Default true. */
  enabled?: boolean;
  /** Called whenever a NEW alert arrives (not the history burst). */
  onNewAlert?: (alert: KpiAlert) => void;
}

export interface UseAlertsResult {
  alerts: KpiAlert[];
  unreadCount: number;
  markAllRead: () => void;
  connected: boolean;
}

/**
 * Subscribes to the alert SSE stream for a community.
 * - Loads alert history on connect.
 * - Prepends new alerts in real time.
 * - Tracks an "unread" count that resets when markAllRead() is called.
 */
export function useAlerts({
  community,
  enabled = true,
  onNewAlert,
}: UseAlertsOptions): UseAlertsResult {
  const [alerts, setAlerts] = useState<KpiAlert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const markAllRead = useCallback(() => setUnreadCount(0), []);

  useEffect(() => {
    if (!enabled || !community) return;

    const es = streamAlerts(
      community,
      (msg) => {
        if (msg.type === "history") {
          setAlerts(msg.alerts);
          setConnected(true);
        } else if (msg.type === "alert") {
          setAlerts((prev) => [msg.alert, ...prev]);
          setUnreadCount((n) => n + 1);
          onNewAlert?.(msg.alert);
        }
      },
      () => setConnected(false),
    );

    esRef.current = es;
    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [community, enabled]); // onNewAlert intentionally omitted — stable ref not needed

  return { alerts, unreadCount, markAllRead, connected };
}
