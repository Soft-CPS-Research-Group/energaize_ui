/**
 * LiveDashboard
 * =============
 * Real-time telemetry panel shown in the "Live" tab of the Dashboard.
 *
 * Sections:
 *  1. Building Cards  – polls GET /api/v1/live/{community} every 30 s.
 *     Shows grid import/export, solar, battery, EV and per-payload quality badges.
 *
 *  2. Quality KPI Charts – one ComposedChart per building showing:
 *     - AuthenticityKPI (fraction of non-generated fields, 0–1) as an Area
 *     - ValidityKPI     (physical sensor validity, 0–1)          as a Step-Line
 *
 *     Data is built from two sources merged together:
 *       a. Historical backbone: GET /api/v1/kpis/{community}/history for today
 *          (AuthenticityKPI + ValidityKPI scheduled hourly results)
 *       b. Live tail: authenticity_ratio + is_physically_valid from each
 *          live snapshot, appended every poll cycle
 *
 *     A dashed "Live" ReferenceLine separates the two data sources on the chart.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { fetchKpiHistory, KPI_API_BASE_URL } from "../../api/kpiApi";
import type { LiveSnapshot } from "../../api/kpiApi";
import {
  Zap, Sun, Battery, Car, DollarSign,
  TrendingUp, TrendingDown, Minus, RefreshCw, Activity,
  ShieldCheck, ShieldAlert, AlertTriangle,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const QUALITY_KPIS = ["AuthenticityKPI", "ValidityKPI"] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single point on the quality chart for one building. */
interface QualityPoint {
  /** Full ISO timestamp — used as a stable sort/merge key. */
  time: string;
  /** HH:MM string rendered on the XAxis. */
  timeLabel: string;
  authenticity: number | null;
  validity: number | null;
  /** True when appended from a live snapshot, false/undefined for history. */
  isLive?: boolean;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

const fmt = (v: number | null | undefined, decimals = 3): string =>
  v == null || isNaN(Number(v)) ? "—" : Number(v).toFixed(decimals);

const fmtTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return iso; }
};

const toHHMM = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  } catch { return iso; }
};

/** Returns the ISO string for today at 00:00:00 local time. */
const todayStartISO = (): string => {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  const localISOTime = new Date(d.getTime() - offset).toISOString().slice(0, 10);
  return new Date(localISOTime).toISOString(); // YYYY-MM-DDT00:00:00.000Z
};

// ── MetricRow ─────────────────────────────────────────────────────────────────

function MetricRow({
  icon, label, value, unit, accent,
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

// ── BuildingCard ──────────────────────────────────────────────────────────────

function BuildingCard({ snap }: { snap: LiveSnapshot }) {
  const netColor =
    snap.net_grid_kwh > 0 ? "var(--brand)" :
      snap.net_grid_kwh < 0 ? "#22c55e" : "var(--text)";
  const NetIcon = snap.net_grid_kwh > 0 ? TrendingUp : snap.net_grid_kwh < 0 ? TrendingDown : Minus;

  const qualityOk = snap.is_physically_valid && snap.authenticity_ratio >= 0.9;
  const qualityWarn = !snap.is_physically_valid || snap.authenticity_ratio < 0.6;

  return (
    <div style={{
      background: "var(--bg-elev)", border: "1px solid var(--line)",
      borderRadius: "0.75rem", padding: "1rem",
      display: "flex", flexDirection: "column", gap: "0.1rem", minWidth: 0,
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

      {/* Net grid – prominent */}
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

// ── LiveQualityChart ──────────────────────────────────────────────────────────

function LiveQualityChart({
  building, points, liveFromTime,
}: {
  building: string;
  points: QualityPoint[];
  liveFromTime: string | null;
}) {
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    // label is the full ISO timestamp (dataKey="time")
    const pt = points.find(p => p.time === label);
    return (
      <div style={{
        background: "var(--bg-elev)", border: "1px solid var(--line)",
        borderRadius: 8, padding: "8px 12px", fontSize: "0.8rem",
      }}>
        <p style={{ margin: "0 0 6px", color: "var(--text-soft)", fontWeight: 500 }}>
          {pt ? toHHMM(pt.time) : label}
          {pt?.isLive && (
            <span style={{ marginLeft: 6, color: "#22c55e", fontWeight: 600, fontSize: "0.7rem" }}>
              ● Live
            </span>
          )}
        </p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ margin: "2px 0", color: p.color }}>
            {p.name}:{" "}
            <strong>
              {typeof p.value === "number" ? `${(p.value * 100).toFixed(1)}%` : "—"}
            </strong>
          </p>
        ))}
      </div>
    );
  };

  // The ReferenceLine x must match the dataKey ("time" = full ISO string)
  const liveFromKey = liveFromTime ?? null;
  // Human-readable label derived from the same timestamp
  const liveFromLabel = liveFromTime ? toHHMM(liveFromTime) : null;

  return (
    <div className="panel" style={{ padding: "1rem" }}>
      {/* Chart header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{building}</span>
        {liveFromLabel && (
          <span style={{
            fontSize: "0.7rem", padding: "0.15rem 0.45rem", borderRadius: "999px",
            background: "rgba(34,197,94,0.12)", color: "#22c55e", fontWeight: 600,
          }}>
            ● Live since {liveFromLabel}
          </span>
        )}
        {points.length === 0 && (
          <span style={{ fontSize: "0.75rem", color: "var(--text-soft)" }}>
            Awaiting first payload…
          </span>
        )}
      </div>

      {points.length > 0 ? (
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={points} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.12} vertical={false} />
            {/* Use the full ISO timestamp as dataKey so two points at the same
                minute but different seconds never collapse onto the same position.
                The tickFormatter converts it back to HH:MM for display. */}
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: "var(--text-soft)" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              height={18}
              tickFormatter={toHHMM}
            />
            <YAxis
              domain={[0, 1]}
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              tick={{ fontSize: 10, fill: "var(--text-soft)" }}
              tickLine={false}
              axisLine={false}
              width={42}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend verticalAlign="top" height={26} wrapperStyle={{ fontSize: "0.75rem" }} />

            {/* Authenticity: Area (blue, 0–1) */}
            <Area
              type="monotone"
              dataKey="authenticity"
              name="Authenticity"
              stroke="#3b82f6"
              fill="#3b82f6"
              fillOpacity={0.12}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />

            {/* Validity: Step line (green, binary 0/1) */}
            <Line
              type="stepAfter"
              dataKey="validity"
              name="Validity"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />

            {/* Dashed "Live" separator — x must match the full ISO timestamp dataKey */}
            {liveFromKey && (
              <ReferenceLine
                x={liveFromKey}
                stroke="var(--text-soft)"
                strokeDasharray="4 4"
                label={{
                  value: "Live",
                  fill: "var(--text-soft)",
                  fontSize: 10,
                  position: "insideTopRight",
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div style={{
          height: 60, display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-soft)", fontSize: "0.8rem",
        }}>
          No quality data yet for today
        </div>
      )}
    </div>
  );
}

// ── LiveDashboard (main) ──────────────────────────────────────────────────────

interface LiveDashboardProps {
  community: string;
  buildings: string[];
  isActive?: boolean;
}

export function LiveDashboard({ community, buildings, isActive = true }: LiveDashboardProps) {
  // ── Snapshot state ──────────────────────────────────────────────────────────
  const [snapshots, setSnapshots] = useState<LiveSnapshot[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Quality chart state ─────────────────────────────────────────────────────
  const [qualityData, setQualityData] = useState<Record<string, QualityPoint[]>>({});
  const [liveFromTime, setLiveFromTime] = useState<Record<string, string>>({});
  const [historyLoading, setHistoryLoading] = useState(false);

  // Stable ref so the poll callback can read liveFromTime without stale closure
  const liveFromRef = useRef<Record<string, string>>({});

  // ── Load historical quality backbone (today 00:00 → now) ───────────────────
  const loadHistory = useCallback(async () => {
    if (!community) return;
    setHistoryLoading(true);
    try {
      const res = await fetchKpiHistory({
        community,
        // Fetch for all buildings in community to avoid refetching on selection change
        startDate: todayStartISO(),
        kpis: [...QUALITY_KPIS],
        limit: 5000,
      });

      // Shape: { data: { [building]: { [kpiName]: [{ value, period_start, ... }] } } }
      const histData: Record<string, Record<string, any[]>> =
        (res as any).data ?? {};

      const initial: Record<string, QualityPoint[]> = {};

      for (const [building, kpis] of Object.entries(histData)) {
        const authSeries: any[] = kpis["AuthenticityKPI"] ?? [];
        const valSeries: any[] = kpis["ValidityKPI"] ?? [];

        // Merge both series by period_start into a single point list
        const mergedMap = new Map<string, QualityPoint>();

        for (const pt of authSeries) {
          const t = pt.period_start as string;
          mergedMap.set(t, {
            time: t, timeLabel: toHHMM(t),
            authenticity: typeof pt.value === "number" ? pt.value : null,
            validity: null,
          });
        }

        for (const pt of valSeries) {
          const t = pt.period_start as string;
          const validity = typeof pt.value === "number" ? pt.value : null;
          const existing = mergedMap.get(t);
          if (existing) {
            existing.validity = validity;
          } else {
            mergedMap.set(t, {
              time: t, timeLabel: toHHMM(t),
              authenticity: null, validity,
            });
          }
        }

        initial[building] = Array.from(mergedMap.values())
          .sort((a, b) => a.time.localeCompare(b.time));
      }

      setQualityData(initial);
      // Reset live markers so they re-anchor after a history reload
      liveFromRef.current = {};
      setLiveFromTime({});
    } catch (e: any) {
      // Non-fatal: chart shows "No data yet" without crashing
      console.warn("[LiveDashboard] Failed to load quality history:", e?.message);
    } finally {
      setHistoryLoading(false);
    }
  }, [community]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── Stream live snapshots & append to chart (SSE) ─────────────────────────
  useEffect(() => {
    if (!isActive || !community) return;

    setLoading(true);
    setError(null);

    // We subscribe to the whole community so the connection doesn't drop when selecting/unselecting buildings.
    const url = `${KPI_API_BASE_URL}/api/v1/live/${community}/stream`;

    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const snaps = JSON.parse(event.data) as LiveSnapshot[];
        if (!snaps || snaps.length === 0) return;

        setSnapshots(prev => {
          // Merge new snapshots into existing state by building
          const map = new Map(prev.map(s => [s.building, s]));
          for (const s of snaps) {
            map.set(s.building, s);
          }
          return Array.from(map.values());
        });
        setLastUpdated(new Date());
        setLoading(false);

        // Append live quality points for each building
        setQualityData(prev => {
          const next = { ...prev };
          const updatedLiveFrom = { ...liveFromRef.current };

          for (const snap of snaps) {
            const { building, timestamp } = snap;
            const existing = next[building] ?? [];

            // Skip if this snapshot timestamp is already the last point
            if (
              existing.length > 0 &&
              existing[existing.length - 1].time >= timestamp
            ) {
              continue;
            }

            const newPoint: QualityPoint = {
              time: timestamp,
              timeLabel: toHHMM(timestamp),
              authenticity: snap.authenticity_ratio ?? null,
              validity: snap.is_physically_valid ? 1.0 : 0.0,
              isLive: true,
            };

            // Record the first live-data timestamp for the ReferenceLine
            if (!updatedLiveFrom[building]) {
              updatedLiveFrom[building] = timestamp;
            }

            next[building] = [...existing, newPoint];
          }

          liveFromRef.current = updatedLiveFrom;
          return next;
        });

        setLiveFromTime({ ...liveFromRef.current });
      } catch (err) {
        console.error("Error parsing SSE data", err);
      }
    };

    es.onerror = (err) => {
      console.error("SSE Error", err);
      // Wait for it to reconnect automatically, but we can set an error state if needed
      // For now, let EventSource automatically reconnect.
    };

    return () => {
      es.close();
    };
  }, [community, isActive]);

  if (buildings.length === 0) {
    return (
      <div className="panel empty-state">
        <Activity size={48} style={{ opacity: 0.5, marginBottom: "1rem" }} />
        <p style={{ fontSize: "1.2rem", fontWeight: "bold" }}>No buildings selected</p>
        <p className="mt-1">Select at least one building to view live telemetry.</p>
      </div>
    );
  }

  // Filter snapshots and charts based on currently selected buildings
  const displaySnapshots = snapshots.filter(s => buildings.includes(s.building));
  const displayBuildings = buildings.filter(b => qualityData[b] || snapshots.some(s => s.building === b));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

      {/* ── Header panel ──────────────────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: 0 }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "center", flexWrap: "wrap", gap: "0.5rem",
          marginBottom: snapshots.length > 0 ? "1rem" : 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{
              display: "inline-block", width: 8, height: 8, borderRadius: "50%",
              background: error ? "#ef4444" : snapshots.length > 0 ? "#22c55e" : "#6b7280",
              boxShadow: snapshots.length > 0 && !error
                ? "0 0 0 3px rgba(34,197,94,0.25)" : "none",
              animation: snapshots.length > 0 && !error ? "pulse 2s infinite" : "none",
            }} />
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Live Telemetry</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {lastUpdated && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-soft)" }}>
                Updated {fmtTime(lastUpdated.toISOString())}
              </span>
            )}
            <div style={{
              display: "flex", alignItems: "center", gap: "0.3rem",
              padding: "0.25rem 0.6rem", borderRadius: "0.4rem", fontSize: "0.75rem",
              border: "1px solid var(--line)", background: "var(--bg-elev)",
              color: "var(--text)", opacity: loading ? 0.5 : 1,
            }}>
              <RefreshCw
                size={12}
                style={{ animation: loading ? "spin 1s linear infinite" : "none" }}
              />
              Live Connection
            </div>
          </div>
        </div>

        {error && (
          <p style={{ color: "#ef4444", fontSize: "0.8rem", margin: 0 }}>{error}</p>
        )}

        {!error && displaySnapshots.length === 0 && !loading && (
          <p style={{ color: "var(--text-soft)", fontSize: "0.82rem", margin: 0 }}>
            Waiting for first Percepta payload… Live data will appear here once the
            RabbitMQ consumer receives a message for the selected buildings.
          </p>
        )}

        {/* ── Building cards ───────────────────────────────────────────────── */}
        {displaySnapshots.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "0.75rem",
          }}>
            {displaySnapshots.map(snap => (
              <BuildingCard key={snap.building} snap={snap} />
            ))}
          </div>
        )}
      </div>

      {/* ── Quality KPI charts ────────────────────────────────────────────── */}
      {displayBuildings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Section header */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Activity size={16} />
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>
              Data Quality — Today
            </span>
            {historyLoading && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-soft)" }}>
                Loading history…
              </span>
            )}
            <span style={{ fontSize: "0.72rem", color: "var(--text-soft)", marginLeft: "auto" }}>
              Historical (hourly) + Live (30 s)
            </span>
          </div>

          {displayBuildings.map(building => (
            <LiveQualityChart
              key={building}
              building={building}
              points={qualityData[building] ?? []}
              liveFromTime={liveFromTime[building] ?? null}
            />
          ))}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(34,197,94,0.25); }
          50%       { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
