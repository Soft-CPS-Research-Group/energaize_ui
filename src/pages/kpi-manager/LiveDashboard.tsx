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
import { Area, Line, XAxis, YAxis, Tooltip, Legend, ReferenceLine } from "recharts";
import { TimeseriesPlot } from "../../components/charts/TimeseriesPlot";
import { fetchKpiHistory, KPI_API_BASE_URL } from "../../api/kpiApi";
import type { LiveSnapshot } from "../../api/kpiApi";
import {
  Zap, Sun, Battery, Car, Euro,
  TrendingUp, TrendingDown, Minus, RefreshCw, Activity,
  ShieldCheck, ShieldAlert, AlertTriangle, Wifi, WifiOff,
} from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { KpiError } from "../../components/kpi/KpiStates";

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

/** Returns true if the given ISO timestamp is from today (local date). */
const isToday = (isoTs: string): boolean => {
  try {
    const d = new Date(isoTs);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth()    === now.getMonth()    &&
      d.getDate()     === now.getDate()
    );
  } catch { return false; }
};

// ── MetricRow ─────────────────────────────────────────────────────────────────

function MetricRow({
  icon, label, value, unit, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="kpi-live-metric">
      <dt>{icon}{label}</dt>
      <dd className={tone ? `kpi-text-${tone}` : undefined}>
        {value} <small>{unit}</small>
      </dd>
    </div>
  );
}

// ── BuildingCard ──────────────────────────────────────────────────────────────

function BuildingCard({ snap }: { snap: LiveSnapshot }) {
  // Importing from the grid is the normal state; exporting is highlighted as good
  const netTone = snap.net_grid_kwh < 0 ? "kpi-text-ok" : "";
  const NetIcon = snap.net_grid_kwh > 0 ? TrendingUp : snap.net_grid_kwh < 0 ? TrendingDown : Minus;

  const qualityOk = snap.is_physically_valid && snap.authenticity_ratio >= 0.9;
  const qualityWarn = !snap.is_physically_valid || snap.authenticity_ratio < 0.6;

  return (
    <article className="kpi-live-card">
      <header className="kpi-live-card-head">
        <div>
          <h3 title={snap.building}>{snap.building}</h3>
          <time dateTime={snap.timestamp}>{fmtTime(snap.timestamp)}</time>
        </div>
        <Badge tone={qualityWarn ? "danger" : qualityOk ? "success" : "warning"}>
          {qualityWarn ? <ShieldAlert size={11} /> : qualityOk ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
          {" "}{qualityWarn ? "Degraded" : qualityOk ? "Good" : "Warning"}
        </Badge>
      </header>

      <div className={`kpi-live-net ${netTone}`}>
        <NetIcon size={18} aria-hidden="true" />
        <strong>{fmt(snap.net_grid_kwh, 2)}</strong>
        <span>kWh net</span>
      </div>

      <dl className="kpi-live-metrics">
        <MetricRow icon={<Zap size={12} />} label="Grid import" value={fmt(snap.grid_import_kwh)} unit="kWh" />
        <MetricRow icon={<Zap size={12} />} label="Grid export" value={fmt(snap.grid_export_kwh)} unit="kWh" tone="ok" />
        <MetricRow icon={<Sun size={12} />} label="Solar" value={fmt(snap.solar_kwh)} unit="kWh" tone="warn" />
        <MetricRow icon={<Battery size={12} />} label="Battery SoC" value={snap.battery_soc_avg != null ? `${(snap.battery_soc_avg * 100).toFixed(1)}` : "—"} unit="%" />
        <MetricRow icon={<Car size={12} />} label="EV charging" value={fmt(snap.ev_charging_kw)} unit={`kW · ${snap.active_ev_sessions} sess`} />
        {snap.energy_price_eur_kwh != null && (
          <MetricRow icon={<Euro size={12} />} label="Price" value={fmt(snap.energy_price_eur_kwh, 4)} unit="€/kWh" />
        )}
      </dl>

      <footer className="kpi-live-card-foot">
        <Badge>Authenticity {(snap.authenticity_ratio * 100).toFixed(0)}%</Badge>
        {snap.has_generated_data && <Badge tone="warning">Generated data</Badge>}
        {!snap.is_physically_valid && <Badge tone="danger">Invalid sensor</Badge>}
      </footer>
    </article>
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
      <div className="kpi-chart-tooltip">
        <p className="kpi-chart-tooltip-title">
          {pt ? toHHMM(pt.time) : label}
          {pt?.isLive && <span className="kpi-text-ok"> · Live</span>}
        </p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.color }}>
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
    <section className="panel kpi-live-chart" aria-label={`Data quality for ${building}`}>
      <header className="kpi-live-chart-head">
        <h3>{building}</h3>
        {liveFromLabel && <Badge tone="success">Live since {liveFromLabel}</Badge>}
        {points.length === 0 && <span className="kpi-text-soft">Awaiting first payload…</span>}
      </header>

      {points.length > 0 ? (
        <TimeseriesPlot data={points} height={200} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
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

          {/* Authenticity: area, 0–1 */}
          <Area
            type="monotone"
            dataKey="authenticity"
            name="Authenticity"
            stroke="var(--info)"
            fill="var(--info)"
            fillOpacity={0.12}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />

          {/* Validity: step line, binary 0/1 */}
          <Line
            type="stepAfter"
            dataKey="validity"
            name="Validity"
            stroke="var(--ok)"
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
        </TimeseriesPlot>
      ) : (
        <p className="kpi-text-soft">No quality data yet for today</p>
      )}
    </section>
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
  const [sseStatus, setSseStatus] = useState<"connecting" | "connected" | "error">("connecting");

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
    setSseStatus("connecting");

    // We subscribe to the whole community so the connection doesn't drop when selecting/unselecting buildings.
    const url = `${KPI_API_BASE_URL}/api/v1/live/${community}/stream`;

    const es = new EventSource(url);

    es.onopen = () => {
      setSseStatus("connected");
    };

    es.onmessage = (event) => {
      try {
        const snaps = JSON.parse(event.data) as LiveSnapshot[];
        if (!snaps || snaps.length === 0) return;

        setSseStatus("connected");
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

            // Skip stale snapshots from previous days — only append today's live data
            if (!isToday(timestamp)) continue;

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
      setSseStatus("error");
      // EventSource will auto-reconnect; reset to connecting after a short delay
      setTimeout(() => setSseStatus(s => s === "error" ? "connecting" : s), 3000);
    };

    return () => {
      es.close();
      setSseStatus("connecting");
    };
  }, [community, isActive]);

  if (buildings.length === 0) {
    return (
      <EmptyState
        title="No buildings selected"
        message="Select at least one building to view live telemetry."
      />
    );
  }

  // Filter snapshots and charts based on currently selected buildings
  // Only show cards for snapshots that arrived today — stale cached state from
  // previous days is excluded to avoid showing outdated readings as "live".
  const displaySnapshots = snapshots.filter(
    s => buildings.includes(s.building) && isToday(s.timestamp)
  );
  // Only show quality chart section for buildings that actually have data points
  const displayBuildings = buildings.filter(b => (qualityData[b]?.length ?? 0) > 0);
  const streaming = displaySnapshots.length > 0 && !error;

  return (
    <div className="kpi-results">
      <section className="panel kpi-live" aria-label="Live telemetry">
        <header className="kpi-live-head">
          <h2>
            <span className={`kpi-live-dot${streaming ? " is-streaming" : error ? " is-error" : ""}`} aria-hidden="true" />
            Live telemetry
          </h2>
          <div className="kpi-live-status">
            {lastUpdated && <span className="kpi-text-soft">Updated {fmtTime(lastUpdated.toISOString())}</span>}
            <Badge tone={sseStatus === "error" ? "danger" : sseStatus === "connected" ? "success" : "neutral"}>
              {sseStatus === "connected" ? <Wifi size={12} /> : sseStatus === "error" ? <WifiOff size={12} /> : <RefreshCw size={12} className="animate-spin" />}
              {" "}{sseStatus === "connected" ? "Connected" : sseStatus === "error" ? "Connection error" : "Connecting…"}
            </Badge>
          </div>
        </header>

        {error && <KpiError message={error} />}

        {!error && displaySnapshots.length === 0 && !loading && (
          <p className="kpi-text-soft">
            Waiting for the first Percepta payload. Live data appears here once a message
            arrives for the selected buildings.
          </p>
        )}

        {displaySnapshots.length > 0 && (
          <div className="kpi-live-grid">
            {displaySnapshots.map(snap => (
              <BuildingCard key={snap.building} snap={snap} />
            ))}
          </div>
        )}
      </section>

      {displayBuildings.length > 0 && (
        <section className="kpi-results" aria-label="Data quality today">
          <header className="kpi-live-section-head">
            <h2><Activity size={16} aria-hidden="true" /> Data quality today</h2>
            {historyLoading && <span className="kpi-text-soft">Loading history…</span>}
            <span className="kpi-text-soft">Hourly history + live payloads</span>
          </header>

          {displayBuildings.map(building => (
            <LiveQualityChart
              key={building}
              building={building}
              points={qualityData[building] ?? []}
              liveFromTime={liveFromTime[building] ?? null}
            />
          ))}
        </section>
      )}
    </div>
  );
}
