import { useState, useMemo, useEffect, useRef } from "react";
import { fetchKpis, fetchKpiHistory } from "../../api/kpiApi";
import type { KpiDataPayload } from "../../types/kpi";
import { KpiStats } from "../../components/kpi/KpiStats";
import { KpiChart } from "../../components/kpi/KpiChart";
import { Button } from "../../components/ui/Button";
import { Activity, Calendar, MapPin, Building2, Search, Loader2, BarChart2, Radio } from "lucide-react";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";
import { useCommunities } from "../../hooks/useCommunities";
import { useKpiMetadata } from "../../hooks/useKpiMetadata";
import { MultiSelect } from "../../components/ui/MultiSelect";
import type { ProcessResponse } from "../../workers/dataProcessor.worker";
import { LiveDashboard } from "./LiveDashboard";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";


// ── Chart data types produced by the data-processor worker ─────────────────

interface StreamingChartState {
  series: Array<Record<string, number | string>>;
  categories: string[];
  buildings: string[];
}

interface ScheduledStatItem {
  scope: string;
  kpiName: string;
  summary: Record<string, number> | null;
  timeseries: Array<{ value: number; period_start: string; period_end: string;[key: string]: any }>;
  isStreaming?: boolean;
}

interface ScheduledChartState {
  seriesByKpi: Record<string, Array<Record<string, number | string>>>;
  categories: string[];
  scopes: string[];
  stats: ScheduledStatItem[];
}

const QUICK_PRESETS = [
  { label: "Today", days: 0 },
  { label: "Last 7 Days", days: 7 },
  { label: "Last 30 Days", days: 30 },
];

const getLocalDateString = (d: Date) => {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];
};

const defaultEnd = new Date();
const defaultStart = new Date();
defaultStart.setDate(defaultStart.getDate() - 7);

// ── Tab type ─────────────────────────────────────────────────────────────────
type DashboardTab = "analytics" | "live";

const TAB_LABELS: Record<DashboardTab, { label: string; icon: React.ReactNode }> = {
  analytics: { label: "Analytics", icon: <BarChart2 size={15} /> },
  live:      { label: "Live",      icon: <Radio size={15} /> },
};

export interface DashboardProps {
  preselectedKpi?: string;
  onPreselectedConsumed?: () => void;
}

export function Dashboard({ preselectedKpi, onPreselectedConsumed }: DashboardProps) {
  const { communities } = useCommunities();
  const { kpis: kpiMeta } = useKpiMetadata();

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<DashboardTab>("analytics");

  const defaultCommunity = Object.keys(COMMUNITY_FALLBACK)[0];
  const [community, setCommunity] = useState(defaultCommunity);
  const defaultBuildingsForCommunity = (COMMUNITY_FALLBACK[community] ?? [])[0];
  const [buildings, setBuildings] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(getLocalDateString(defaultStart));
  const [endDate, setEndDate] = useState(getLocalDateString(defaultEnd));
  const [selectedKpis, setSelectedKpis] = useState<string[]>([]);
  const [windowOverrides, setWindowOverrides] = useState("");
  const [computeAggregated, setComputeAggregated] = useState(false);
  const [recompute, setRecompute] = useState(false);

  // Apply preselected KPI from KPI Explorer "Open in Dashboard"
  useEffect(() => {
    if (preselectedKpi) {
      setSelectedKpis([preselectedKpi]);
      onPreselectedConsumed?.();
    }
  }, [preselectedKpi]); // eslint-disable-line react-hooks/exhaustive-deps

  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [data, setData] = useState<KpiDataPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [chartData, setChartData] = useState<StreamingChartState>({ series: [], categories: [], buildings: [] });
  const [scheduledChartData, setScheduledChartData] = useState<ScheduledChartState>({ seriesByKpi: {}, categories: [], scopes: [], stats: [] });
  const [selectedScopeTab, setSelectedScopeTab] = useState<string>("All Scopes");

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    workerRef.current = new Worker(new URL("../../workers/dataProcessor.worker.ts", import.meta.url), {
      type: "module",
    });

    workerRef.current.onmessage = (event: MessageEvent<ProcessResponse>) => {
      const { streamingChartData: streamChartData, scheduledChartData: schedChartData } = event.data as any;
      setChartData(streamChartData ?? { series: [], categories: [], buildings: [] });
      setScheduledChartData(schedChartData ?? { seriesByKpi: {}, categories: [], scopes: [], stats: [] });
      setProcessing(false);
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    if (!data) return;
    setProcessing(true);
    workerRef.current?.postMessage({
      streaming: data.streaming,
      scheduled: data.scheduled,
      maxPoints: window.innerWidth > 1000 ? 500 : 250,
    });
  }, [data]);

  const applyPreset = (daysBack: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - daysBack);
    setEndDate(getLocalDateString(end));
    setStartDate(getLocalDateString(start));
  };

  const handleFetch = async () => {
    if (buildings.length === 0) {
      setError("Please select at least one building.");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setData(null);
      setChartData({ series: [], categories: [], buildings: [] });
      setScheduledChartData({ seriesByKpi: {}, categories: [], scopes: [], stats: [] });
      const woArray = windowOverrides.split(",").map((wo) => wo.trim()).filter(Boolean);

      const kpiFilter = selectedKpis.length > 0 ? selectedKpis : undefined;

      if (recompute) {
        // ── Recompute: compute everything fresh from raw telemetry ──
        const response = await fetchKpis({
          community,
          buildings,
          startDate: startDate ? new Date(startDate).toISOString() : undefined,
          endDate: endDate ? new Date(endDate).toISOString() : undefined,
          kpis: kpiFilter,
          windowOverride: woArray.length > 0 ? woArray : undefined,
          computeAggregated,
          computeScheduled: true,
        });
        setData(response.data);
      } else {
        // ── History mode: read everything from the DB ──
        // A single history request now returns both streaming (old format)
        // and scheduled (new flat) docs — no live computation needed.
        const historyResponse = await fetchKpiHistory({
          community,
          buildings,
          startDate: startDate ? new Date(startDate).toISOString() : undefined,
          endDate: endDate ? new Date(endDate).toISOString() : undefined,
          kpis: kpiFilter,
          limit: 10000,
        });

        const histData = (historyResponse as any).data || {};
        const backendSummaries: any[] = (historyResponse as any).summaries || [];

        // Build summaryMap: { scope_kpiName: summary }
        const summaryMap: Record<string, any> = {};
        for (const s of backendSummaries) {
          summaryMap[`${s.scope}_${s.kpi}`] = s.summary;
        }

        const simulatedScheduled: Record<string, Record<string, any>> = {};

        Object.entries(histData).forEach(([scope, kpis]: [string, any]) => {
          Object.entries(kpis).forEach(([kpiName, items]: [string, any]) => {
            simulatedScheduled[scope] ??= {};
            const arr: any[] = Array.isArray(items) ? items : [];
            const backendSummary = summaryMap[`${scope}_${kpiName}`];
            if (!simulatedScheduled[scope][kpiName]) {
              simulatedScheduled[scope][kpiName] = {
                timeseries: arr,
                summary: backendSummary ?? null,
              };
            } else {
              simulatedScheduled[scope][kpiName].timeseries.push(...arr);
              if (!simulatedScheduled[scope][kpiName].summary && backendSummary) {
                simulatedScheduled[scope][kpiName].summary = backendSummary;
              }
            }
          });
        });

        // Derive summary from accumulated timeseries
        Object.values(simulatedScheduled).forEach((kpis: any) => {
          Object.values(kpis).forEach((entry: any) => {
            if (entry.summary) return;  // already have a backend summary
            const pts: any[] = entry.timeseries;
            if (!pts || pts.length === 0) return;
            const numeric = pts.map((p: any) => Number(p.value)).filter((v: number) => !isNaN(v));
            if (numeric.length === 0) return;
            const total = numeric.reduce((a: number, b: number) => a + b, 0);
            // Fall back: derive both, let the display logic pick
            entry.summary = {
              mean_value: total / numeric.length,
              total_value: total,
              count: numeric.length,
              _derived_client_side: true,  // flag for debugging
            };
          });
        });

        if (!computeAggregated) {
          delete simulatedScheduled["community"];
        }

        setData({ streaming: {}, scheduled: simulatedScheduled });
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || "Failed to fetch KPIs");
    } finally {
      setLoading(false);
    }
  };


  const streamingCharts = useMemo(() => {
    if (!chartData || !chartData.series || chartData.series.length === 0) return null;

    // Sort categories so order is consistent
    const sortedCategories = [...chartData.categories].sort((a: string, b: string) => a.localeCompare(b));

    return (
      <div className="kpi-grid" >
        {sortedCategories.map((kpiName: any) => {
          const lines = chartData.buildings.map((b: string) => `${b}_${kpiName}`);
          const meta = kpiMeta.find((m: any) => m.name === kpiName);
          const titleName = meta?.display_name || meta?.canonical_name || meta?.name || kpiName;
          return (
            <KpiChart
              key={`streaming_${kpiName}`}
              title={`${titleName} (Streaming)`}
              kpiName={kpiName}
              data={chartData.series}
              lines={lines}
            />
          );
        })}
      </div>
    );
  }, [chartData, kpiMeta]);

  const scheduledCharts = useMemo(() => {
    if (!scheduledChartData?.seriesByKpi) return null;
    const entries = Object.entries(scheduledChartData.seriesByKpi);
    if (entries.length === 0) return null;

    // Sort entries so order is consistent
    entries.sort(([kpiA], [kpiB]) => kpiA.localeCompare(kpiB));

    return (
      <div className="kpi-grid" >
        {entries.map(([kpiName, series]) => {
          const lines = scheduledChartData.scopes.map((s: string) => `${s}_${kpiName}`);
          const meta = kpiMeta.find((m: any) => m.name === kpiName);
          const titleName = meta?.display_name || meta?.canonical_name || meta?.name || kpiName;
          return (
            <KpiChart
              key={`scheduled_${kpiName}`}
              title={`${titleName} (Scheduled Temporal Series)`}
              kpiName={kpiName}
              data={series as any[]}
              lines={lines}
            />
          );
        })}
      </div>
    );
  }, [scheduledChartData, kpiMeta]);

  // Derive available KPI names from metadata
  const availableKpis = kpiMeta
    .filter((k: any) => k.status === "available" && k.registered)
    .map((k: any) => k.name);

  const currentBuildings = communities[community] ?? COMMUNITY_FALLBACK[community] ?? [];

  return (
    <div className="page">
      <header className="jobs-hero">
        <div>
          <h1>Dashboard</h1>
          <p>{activeTab === "analytics" ? "Analyze KPI data across communities and buildings" : activeTab === "live" ? "Real-time telemetry and data quality signals" : "KPI threshold alerts and notifications"}</p>
        </div>

        {/* ── Tab switcher ── */}
        <nav
          role="tablist"
          aria-label="Dashboard sections"
          style={{ display: "flex", gap: "0.375rem", alignSelf: "flex-end" }}
        >
          {(Object.entries(TAB_LABELS) as [DashboardTab, { label: string; icon: React.ReactNode }][]).map(([key, { label, icon }]) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tabpanel-${key}`}
                id={`tab-${key}`}
                onClick={() => setActiveTab(key)}
                style={{
                  display: "flex", alignItems: "center", gap: "0.4rem",
                  padding: "0.45rem 1rem", borderRadius: "0.6rem",
                  border: `1px solid ${isActive ? "var(--brand)" : "var(--line)"}`,
                  background: isActive ? "var(--brand)" : "var(--bg-elev)",
                  color: isActive ? "#fff" : "var(--text)",
                  fontWeight: isActive ? 700 : 500,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {icon}{label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* ── Shared building selector (used by both tabs) ───────────────────── */}
      <div style={{ paddingBottom: "0.5rem" }}>
        <div className="panel" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
              <MapPin size={16} /> Community
            </label>
            <select
              style={{ width: "100%", padding: "0.5rem", borderRadius: "0.5rem", border: "1px solid var(--line)", backgroundColor: "var(--bg-elev)", color: "var(--text)" }}
              value={community}
              onChange={(e) => {
                setCommunity(e.target.value);
                setBuildings([]);
              }}
            >
              {Object.keys(communities).map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ").toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: "2 1 300px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
              <Building2 size={16} /> Buildings
            </label>
            <MultiSelect
              options={currentBuildings.map((b: string) => ({ label: b, value: b }))}
              selected={buildings}
              onChange={setBuildings}
              placeholder="Select buildings..."
            />
          </div>
        </div>
      </div>

      {/* ── Analytics tab panel ─────────────────────────────────────────────── */}
      <div
        id="tabpanel-analytics"
        role="tabpanel"
        aria-labelledby="tab-analytics"
        hidden={activeTab !== "analytics"}
      >
        {/* Analytics-specific filters */}
        <div style={{ paddingBottom: "0.5rem" }}>
          <div className="panel" style={{ display: "flex", flexDirection: "column", gap: "1rem", width: "100%" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-start" }}>
              <div style={{ flex: "1 1 300px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
                  <Activity size={16} /> KPIs
                </label>
                <MultiSelect
                  options={availableKpis.map((k: string) => {
                    const meta = kpiMeta.find(m => m.name === k);
                    const label = meta?.display_name || meta?.canonical_name || meta?.name || k;
                    return { label: label, value: k };
                  })}
                  selected={selectedKpis}
                  onChange={setSelectedKpis}
                  placeholder="Select KPIs..."
                />
              </div>
              <div style={{ flex: "1 1 200px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
                  <Activity size={16} /> Granularity Override <span style={{ opacity: 0.6, fontWeight: "normal", marginLeft: "0.25rem" }}>(comma-sep)</span>
                </label>
                <input
                  type="text"
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "0.5rem", border: "1px solid var(--line)", backgroundColor: "var(--bg-elev)", color: "var(--text)" }}
                  value={windowOverrides}
                  onChange={(e) => setWindowOverrides(e.target.value)}
                  placeholder="e.g. EnergyCostKPI:1h:1h"
                />
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end", justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: "1rem", marginTop: "0.5rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "1rem" }}>
                <div style={{ width: "150px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
                    <Calendar size={16} /> Start Date
                  </label>
                  <input
                    type="date"
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "0.5rem", border: "1px solid var(--line)", backgroundColor: "var(--bg-elev)", color: "var(--text)" }}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div style={{ width: "150px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
                    <Calendar size={16} /> End Date
                  </label>
                  <input
                    type="date"
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "0.5rem", border: "1px solid var(--line)", backgroundColor: "var(--bg-elev)", color: "var(--text)" }}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: "0.5rem", paddingBottom: "5px" }}>
                  {QUICK_PRESETS.map((p) => (
                    <Button
                      key={p.label}
                      onClick={() => applyPreset(p.days)}
                      variant="secondary"
                      size="sm"
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingBottom: "9px", paddingLeft: "0.5rem" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={computeAggregated}
                      onChange={(e) => setComputeAggregated(e.target.checked)}
                      style={{ width: "1rem", height: "1rem" }}
                    />
                    Compute Aggregated Community Level
                  </label>
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <label style={{ display: "flex", alignItems: "center", cursor: "pointer", marginRight: "1rem" }} title="Check this to force recomputation from raw telemetry instead of using scheduled pre-calculated results">
                  <div style={{ position: "relative" }}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={recompute}
                      onChange={(e) => setRecompute(e.target.checked)}
                      style={{ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", borderWidth: 0 }}
                    />
                    <div style={{ width: "2.5rem", height: "1.5rem", borderRadius: "999px", background: recompute ? "var(--brand)" : "var(--line)", transition: "all 0.2s" }}></div>
                    <div style={{ position: "absolute", left: "0.25rem", top: "0.25rem", width: "1rem", height: "1rem", background: "var(--bg-elev)", borderRadius: "50%", transition: "all 0.2s", transform: recompute ? "translateX(1rem)" : "none" }}></div>
                  </div>
                  <div style={{ marginLeft: "0.75rem", fontSize: "0.85rem", fontWeight: "bold" }}>
                    Re-calculation
                  </div>
                </label>
                <Button
                  onClick={handleFetch}
                  disabled={loading || processing}
                  variant="primary"
                  iconLeft={
                    loading ? <Loader2 className="animate-spin" size={16} /> :
                      processing ? <Loader2 className="animate-spin" size={16} /> :
                        <Search size={16} />
                  }
                >
                  {loading ? 'Fetching...' : processing ? 'Processing Data...' : 'Analyze Data'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <main className="page-content panel" style={{ padding: "1.5rem", flex: 1 }}>
          {error && (
            <div className="panel form-grid">
              <Activity size={20} />
              <p>{error}</p>
            </div>
          )}

          {(loading || processing) && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem", gap: "1rem" }}>
              <EVChargingLoader label={loading ? "Downloading data from MongoDB…" : "Running LTTB Downsampling Algorithm…"} />
              <p style={{ fontSize: "0.8rem", color: "var(--text-soft)", margin: 0 }}>This may take a moment for large timeframes.</p>
            </div>
          )}

          {/* SCHEDULED KPIs (Aggregates) */}
          {!loading && !processing && scheduledChartData && scheduledChartData.stats && scheduledChartData.stats.length > 0 && (
            <div style={{ marginBottom: "2rem" }}>
              {/* Scope Tabs */}
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem", borderBottom: "1px solid var(--line)", paddingBottom: "1rem" }}>
                {["All Scopes", ...Array.from(new Set(scheduledChartData.stats.map(s => s.scope)))].map((scopeName) => (
                  <button
                    key={scopeName}
                    onClick={() => setSelectedScopeTab(scopeName)}
                    style={{
                      padding: "0.5rem 1rem", borderRadius: "999px", fontSize: "0.85rem",
                      fontWeight: selectedScopeTab === scopeName ? 600 : 400, cursor: "pointer",
                      border: `1px solid ${selectedScopeTab === scopeName ? "var(--brand)" : "var(--line)"}`,
                      background: selectedScopeTab === scopeName ? "var(--brand)" : "var(--bg-elev)",
                      color: selectedScopeTab === scopeName ? "#fff" : "var(--text)", transition: "all 0.2s",
                    }}
                  >
                    {scopeName}
                  </button>
                ))}
              </div>

              {/* KPI Cards Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px", alignItems: "stretch" }}>
                {[...scheduledChartData.stats]
                  .sort((a, b) => a.kpiName.localeCompare(b.kpiName))
                  .filter(statItem => selectedScopeTab === "All Scopes" || statItem.scope === selectedScopeTab)
                  .map((statItem: any, idx: number) => {
                    const { scope, kpiName, summary, timeseries, isStreaming } = statItem;
                    let val: any = "N/A";
                    let desc = isStreaming ? "Streaming (live)" : "Scheduled";
                    const formatSafeDate = (dStr: any) => {
                      if (!dStr || typeof dStr !== "string") return "";
                      const parsed = new Date(dStr.replace(" ", "T"));
                      return isNaN(parsed.getTime()) ? dStr : parsed.toLocaleDateString();
                    };
                    if (summary) {
                      if (isStreaming) val = summary.mean_value ?? summary.total_value ?? summary.value;
                      else if ("total_value" in summary) val = summary.total_value;
                      else if ("mean_value" in summary) val = summary.mean_value;
                      else if ("value" in summary) val = summary.value;
                    }
                    if (timeseries && Array.isArray(timeseries) && timeseries.length > 0) {
                      const start = timeseries[0].period_start;
                      const end = timeseries[timeseries.length - 1].period_end;
                      desc = `${isStreaming ? "Avg · " : ""}${formatSafeDate(start)} - ${formatSafeDate(end)}`;
                    }
                    if (summary?.coverage_pct !== undefined && summary?.coverage_pct !== null) {
                      desc += ` · Coverage: ${summary.coverage_pct}%`;
                    }
                    const isAllScopes = selectedScopeTab === "All Scopes";
                    const meta = kpiMeta.find((m: any) => m.name === kpiName);
                    const titleName = meta?.display_name || meta?.canonical_name || meta?.name || kpiName;
                    return (
                      <div key={`${scope}_${kpiName}_${idx}`} style={{ display: "flex", flexDirection: "column" }}>
                        <KpiStats
                          title={titleName}
                          subtitle={isAllScopes ? scope : undefined}
                          value={val != null && !isNaN(Number(val)) ? Number(val).toFixed(2) : "N/A"}
                          unit={meta?.unit || ""}
                          kpiName={kpiName}
                          description={desc}
                        />
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {!loading && !processing && streamingCharts}
          {!loading && !processing && scheduledCharts}

          {/* Empty State */}
          {!loading && !processing && !error && !data?.scheduled && !data?.streaming && (
            <div className="panel empty-state">
              <Search size={48} style={{ opacity: 0.5, marginBottom: "1rem" }} />
              <p style={{ fontSize: "1.2rem", fontWeight: "bold" }}>No results to display</p>
              <p className="mt-1">Adjust your filters and click Analyze Data to view KPIs.</p>
            </div>
          )}
        </main>
      </div>

      {/* ── Live tab panel ──────────────────────────────────────────────────── */}
      <div
        id="tabpanel-live"
        role="tabpanel"
        aria-labelledby="tab-live"
        hidden={activeTab !== "live"}
      >
        <LiveDashboard key={community} community={community} buildings={buildings} isActive={activeTab === "live"} />
      </div>
    </div>
  );
}
