/**
 * LiveDashboard
 * =============
 * Polls GET /api/v1/live/{community} every 30 s and renders a real-time
 * state panel per building. Appears above the analytics form on Dashboard.tsx.
 *
 * Each building card shows the most recent LiveSnapshotKPI values:
 * - Grid import / export and net flow
 * - Solar generation
 * - Battery SoC
 * - EV charging power and active sessions
 * - Current energy price
 * - Per-payload data quality signals (authenticity, validity)
 *
 * The panel only renders when there is at least one live document in the DB
 * (i.e. after the first Percepta payload arrives). Until then it shows a
 * subtle "waiting for first payload" hint so it doesn't alarm the user.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchLiveState } from "../../api/kpiApi";
import type { LiveSnapshot } from "../../api/kpiApi";
import {
  Zap, Sun, Battery, Car, DollarSign,
  TrendingUp, TrendingDown, Minus, RefreshCw,
  ShieldCheck, ShieldAlert, AlertTriangle,
} from "lucide-react";

const POLL_INTERVAL_MS = 30_000;

const fmt = (v: number | null | undefined, decimals = 3) =>
  v == null || isNaN(Number(v)) ? "—" : Number(v).toFixed(decimals);

const fmtTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
};

// ── Tiny metric row ───────────────────────────────────────────────────────────
function MetricRow({
  icon,
  label,
  value,
  unit,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  accent?: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0.35rem 0", borderBottom: "1px solid var(--line)",
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--text-soft)" }}>
        {icon}{label}
      </span>
      <span style={{ fontWeight: 700, fontSize: "0.88rem", color: accent ?? "var(--text)" }}>
        {value} <span style={{ fontWeight: 400, fontSize: "0.75rem", opacity: 0.7 }}>{unit}</span>
      </span>
    </div>
  );
}

// ── Single building card ──────────────────────────────────────────────────────
function BuildingCard({ snap }: { snap: LiveSnapshot }) {
  const netColor =
    snap.net_grid_kwh > 0 ? "var(--brand)" :
    snap.net_grid_kwh < 0 ? "#22c55e" : "var(--text)";
  const NetIcon = snap.net_grid_kwh > 0 ? TrendingUp : snap.net_grid_kwh < 0 ? TrendingDown : Minus;

  const qualityOk = snap.is_physically_valid && snap.authenticity_ratio >= 0.9;
  const qualityWarn = !snap.is_physically_valid || snap.authenticity_ratio < 0.7;

  return (
    <div style={{
      background: "var(--bg-elev)",
      border: "1px solid var(--line)",
      borderRadius: "0.75rem",
      padding: "1rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.1rem",
      minWidth: 0,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px" }}>
            {snap.building}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-soft)" }}>
            {fmtTime(snap.timestamp)}
          </div>
        </div>
        {/* Quality badge */}
        <div style={{
          display: "flex", alignItems: "center", gap: "0.25rem",
          padding: "0.2rem 0.5rem", borderRadius: "999px", fontSize: "0.7rem", fontWeight: 600,
          background: qualityWarn ? "rgba(239,68,68,0.12)" : qualityOk ? "rgba(34,197,94,0.12)" : "rgba(234,179,8,0.12)",
          color: qualityWarn ? "#ef4444" : qualityOk ? "#22c55e" : "#eab308",
        }}>
          {qualityWarn ? <ShieldAlert size={11} /> : qualityOk ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
          {qualityWarn ? "Degraded" : qualityOk ? "Good" : "Warning"}
        </div>
      </div>

      {/* Net grid — prominent */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: "0.5rem", padding: "0.6rem 0", marginBottom: "0.35rem",
        background: "var(--bg)", borderRadius: "0.5rem",
      }}>
        <NetIcon size={18} color={netColor} />
        <span style={{ fontSize: "1.4rem", fontWeight: 800, color: netColor }}>
          {fmt(snap.net_grid_kwh, 2)}
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-soft)" }}>kWh net</span>
      </div>

      {/* Metric rows */}
      <MetricRow icon={<Zap size={12} />} label="Grid import" value={fmt(snap.grid_import_kwh)} unit="kWh" />
      <MetricRow icon={<Zap size={12} />} label="Grid export" value={fmt(snap.grid_export_kwh)} unit="kWh" accent="#22c55e" />
      <MetricRow icon={<Sun size={12} />} label="Solar" value={fmt(snap.solar_kwh)} unit="kWh" accent="#f59e0b" />
      <MetricRow icon={<Battery size={12} />} label="Battery SoC" value={snap.battery_soc_avg != null ? `${(snap.battery_soc_avg * 100).toFixed(1)}` : "—"} unit="%" />
      <MetricRow icon={<Car size={12} />} label="EV charging" value={fmt(snap.ev_charging_kw)} unit={`kW · ${snap.active_ev_sessions} sess`} />
      {snap.energy_price_eur_kwh != null && (
        <MetricRow icon={<DollarSign size={12} />} label="Price" value={fmt(snap.energy_price_eur_kwh, 4)} unit="€/kWh" />
      )}

      {/* Quality footer */}
      <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.68rem", padding: "0.15rem 0.4rem", borderRadius: "999px", background: "var(--bg)", color: "var(--text-soft)" }}>
          Auth: {(snap.authenticity_ratio * 100).toFixed(0)}%
        </span>
        {snap.has_generated_data && (
          <span style={{ fontSize: "0.68rem", padding: "0.15rem 0.4rem", borderRadius: "999px", background: "rgba(234,179,8,0.15)", color: "#eab308" }}>
            ⚠ generated data
          </span>
        )}
        {!snap.is_physically_valid && (
          <span style={{ fontSize: "0.68rem", padding: "0.15rem 0.4rem", borderRadius: "999px", background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
            ✕ invalid sensor
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface LiveDashboardProps {
  community: string;
  buildings: string[];
}

export function LiveDashboard({ community, buildings }: LiveDashboardProps) {
  const [snapshots, setSnapshots] = useState<LiveSnapshot[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!community) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetchLiveState(community, buildings.length > 0 ? buildings : undefined);
      setSnapshots(res.data ?? []);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message ?? "Failed to fetch live state");
    } finally {
      setLoading(false);
    }
  }, [community, buildings]);

  // Poll on mount and whenever community/buildings change
  useEffect(() => {
    poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [poll]);

  const countdown = POLL_INTERVAL_MS / 1000;

  return (
    <div className="panel" style={{ marginBottom: "1rem" }}>
      {/* Panel header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: snapshots.length > 0 ? "1rem" : "0",
        flexWrap: "wrap", gap: "0.5rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {/* Live pulse dot */}
          <span style={{
            display: "inline-block", width: 8, height: 8, borderRadius: "50%",
            background: error ? "#ef4444" : snapshots.length > 0 ? "#22c55e" : "#6b7280",
            boxShadow: snapshots.length > 0 && !error ? "0 0 0 3px rgba(34,197,94,0.25)" : "none",
            animation: snapshots.length > 0 && !error ? "pulse 2s infinite" : "none",
          }} />
          <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Live Telemetry</span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-soft)" }}>
            · refreshes every {countdown}s
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {lastUpdated && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-soft)" }}>
              Updated {fmtTime(lastUpdated.toISOString())}
            </span>
          )}
          <button
            onClick={poll}
            disabled={loading}
            title="Refresh now"
            style={{
              display: "flex", alignItems: "center", gap: "0.3rem",
              padding: "0.25rem 0.6rem", borderRadius: "0.4rem", fontSize: "0.75rem",
              border: "1px solid var(--line)", background: "var(--bg-elev)",
              color: "var(--text)", cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.5 : 1,
            }}
          >
            <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: "#ef4444", fontSize: "0.8rem", padding: "0.5rem 0" }}>
          {error}
        </div>
      )}

      {/* No data yet */}
      {!error && snapshots.length === 0 && !loading && (
        <div style={{ color: "var(--text-soft)", fontSize: "0.82rem", padding: "0.5rem 0" }}>
          Waiting for first Percepta payload… Live data will appear here once the RabbitMQ consumer receives a message.
        </div>
      )}

      {/* Building cards */}
      {snapshots.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: "0.75rem",
        }}>
          {snapshots.map(snap => (
            <BuildingCard key={snap.building} snap={snap} />
          ))}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(34,197,94,0.25); }
          50% { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
