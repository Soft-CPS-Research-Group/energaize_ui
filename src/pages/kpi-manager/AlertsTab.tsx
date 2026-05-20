import { useState, useMemo } from "react";
import {
  AlertTriangle, ShieldAlert, Info, CheckCircle2,
  Wifi, WifiOff, Filter, Bell,
} from "lucide-react";
import type { KpiAlert } from "../../api/kpiApi";

// ── Severity helpers ─────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: {
    label: "Critical",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.10)",
    border: "rgba(239,68,68,0.30)",
    Icon: ShieldAlert,
  },
  warning: {
    label: "Warning",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.10)",
    border: "rgba(245,158,11,0.30)",
    Icon: AlertTriangle,
  },
  info: {
    label: "Info",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.10)",
    border: "rgba(59,130,246,0.30)",
    Icon: Info,
  },
} as const;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtValue(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(4);
}

const CONDITION_LABELS: Record<string, string> = {
  gt: ">", gte: "≥", lt: "<", lte: "≤",
};

// ── AlertCard ────────────────────────────────────────────────────────────────

function AlertCard({ alert }: { alert: KpiAlert }) {
  const cfg = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
  const { Icon } = cfg;

  return (
    <div style={{
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderLeft: `3px solid ${cfg.color}`,
      borderRadius: "0.6rem",
      padding: "0.75rem 1rem",
      display: "flex",
      gap: "0.75rem",
      alignItems: "flex-start",
    }}>
      <Icon size={16} color={cfg.color} style={{ marginTop: "0.15rem", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Top row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.25rem" }}>
          <span style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--text-primary)" }}>
            {alert.kpi}
          </span>
          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
            {fmtDate(alert.triggered_at)}
          </span>
        </div>
        {/* Scope + value */}
        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
          <span style={{ fontFamily: "monospace", background: "var(--bg-surface)", padding: "0.1rem 0.4rem", borderRadius: "0.25rem" }}>
            {alert.scope}
          </span>
          {" · "}
          value <strong style={{ color: cfg.color }}>{fmtValue(alert.value)}</strong>
          {" "}{CONDITION_LABELS[alert.condition] ?? alert.condition}{" "}
          threshold <strong>{fmtValue(alert.threshold)}</strong>
        </div>
        {/* Message */}
        {alert.message && (
          <p style={{ margin: "0.3rem 0 0", fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
            {alert.message}
          </p>
        )}
      </div>
      {/* Severity badge */}
      <span style={{
        fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em",
        textTransform: "uppercase", color: cfg.color,
        background: cfg.bg, border: `1px solid ${cfg.border}`,
        padding: "0.15rem 0.45rem", borderRadius: "0.3rem", flexShrink: 0,
      }}>
        {cfg.label}
      </span>
    </div>
  );
}

// ── AlertsTab ────────────────────────────────────────────────────────────────

interface AlertsTabProps {
  alerts: KpiAlert[];
  connected: boolean;
}

type SeverityFilter = "all" | "critical" | "warning" | "info";

export function AlertsTab({ alerts, connected }: AlertsTabProps) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");

  const filtered = useMemo(() => {
    if (severityFilter === "all") return alerts;
    return alerts.filter((a) => a.severity === severityFilter);
  }, [alerts, severityFilter]);

  const counts = useMemo(() => ({
    critical: alerts.filter((a) => a.severity === "critical").length,
    warning:  alerts.filter((a) => a.severity === "warning").length,
    info:     alerts.filter((a) => a.severity === "info").length,
  }), [alerts]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Bell size={16} color="var(--text-secondary)" />
          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            {alerts.length} alert{alerts.length !== 1 ? "s" : ""} total
          </span>
          {connected
            ? <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", color: "#22c55e" }}><Wifi size={12} /> Live</span>
            : <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", color: "var(--text-muted)" }}><WifiOff size={12} /> Offline</span>
          }
        </div>

        {/* Severity filter pills */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <Filter size={13} color="var(--text-muted)" />
          {(["all", "critical", "warning", "info"] as SeverityFilter[]).map((s) => {
            const cfg = s === "all" ? null : SEVERITY_CONFIG[s];
            const isActive = severityFilter === s;
            const count = s === "all" ? alerts.length : counts[s];
            return (
              <button
                key={s}
                onClick={() => setSeverityFilter(s)}
                style={{
                  fontSize: "0.72rem", fontWeight: 600, cursor: "pointer",
                  padding: "0.2rem 0.6rem", borderRadius: "999px",
                  border: isActive ? `1px solid ${cfg?.color ?? "var(--accent)"}` : "1px solid var(--border)",
                  background: isActive ? (cfg?.bg ?? "var(--accent-muted)") : "transparent",
                  color: isActive ? (cfg?.color ?? "var(--accent)") : "var(--text-secondary)",
                  transition: "all 0.15s",
                  textTransform: "capitalize",
                }}
              >
                {s} {count > 0 && `(${count})`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Alert list */}
      {filtered.length === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: "0.75rem", padding: "3rem 1rem", color: "var(--text-muted)",
        }}>
          <CheckCircle2 size={32} color="#22c55e" style={{ opacity: 0.6 }} />
          <p style={{ margin: 0, fontSize: "0.9rem" }}>No alerts {severityFilter !== "all" ? `with severity "${severityFilter}"` : "triggered yet"}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {filtered.map((alert, i) => (
            <AlertCard key={`${alert.kpi}-${alert.triggered_at}-${i}`} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}
