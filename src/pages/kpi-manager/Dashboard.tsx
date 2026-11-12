import { useId, useState, useMemo, useEffect, useRef } from "react";
import { fetchKpis, fetchKpiHistory } from "../../api/kpiApi";
import type { KpiDataPayload } from "../../types/kpi";
import { KpiStats } from "../../components/kpi/KpiStats";
import { KpiChart } from "../../components/kpi/KpiChart";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Search, Loader2, BarChart2, Radio } from "lucide-react";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";
import { useCommunities } from "../../hooks/useCommunities";
import { kpiDisplayName, kpiSelectOptions, useKpiMetadata } from "../../hooks/useKpiMetadata";
import type { ProcessResponse } from "../../workers/dataProcessor.worker";
import { LiveDashboard } from "./LiveDashboard";
import { KpiPageHeader } from "../../components/kpi/KpiPageHeader";
import { KpiSegmented } from "../../components/kpi/KpiSegmented";
import {
  BuildingsField, CommunityField, DateRangeField, KpiField, KpiFilterBar, KpiSelectField, KpiSwitch, toLocalDateString,
} from "../../components/kpi/KpiFilters";
import { KpiError, KpiLoading } from "../../components/kpi/KpiStates";


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
  const [buildings, setBuildings] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(toLocalDateString(defaultStart));
  const [endDate, setEndDate] = useState(toLocalDateString(defaultEnd));
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

    // Data-quality KPIs go last; everything else sorts alphabetically
    const DATA_QUALITY_KPIS = new Set(["AuthenticityKPI", "ValidityKPI", "CoverageKPI", "DataQualityKPI"]);
    const sortedCategories = [...chartData.categories].sort((a: string, b: string) => {
      const aIsQuality = DATA_QUALITY_KPIS.has(a) ? 1 : 0;
      const bIsQuality = DATA_QUALITY_KPIS.has(b) ? 1 : 0;
      if (aIsQuality !== bIsQuality) return aIsQuality - bIsQuality;
      return a.localeCompare(b);
    });

    return (
      <div className="kpi-grid" >
        {sortedCategories.map((kpiName: any) => {
          const lines = chartData.buildings.map((b: string) => `${b}_${kpiName}`);
          const titleName = kpiDisplayName(kpiMeta.find((m) => m.name === kpiName), kpiName);
          return (
            <KpiChart
              key={`streaming_${kpiName}`}
              title={titleName}
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

    // Data-quality KPIs go last; everything else sorts alphabetically
    const DATA_QUALITY_KPIS = new Set(["AuthenticityKPI", "ValidityKPI", "CoverageKPI", "DataQualityKPI"]);
    entries.sort(([kpiA], [kpiB]) => {
      const aIsQuality = DATA_QUALITY_KPIS.has(kpiA) ? 1 : 0;
      const bIsQuality = DATA_QUALITY_KPIS.has(kpiB) ? 1 : 0;
      if (aIsQuality !== bIsQuality) return aIsQuality - bIsQuality;
      return kpiA.localeCompare(kpiB);
    });

    return (
      <div className="kpi-grid" >
        {entries.map(([kpiName, series]) => {
          const lines = scheduledChartData.scopes.map((s: string) => `${s}_${kpiName}`);
          const titleName = kpiDisplayName(kpiMeta.find((m) => m.name === kpiName), kpiName);
          return (
            <KpiChart
              key={`scheduled_${kpiName}`}
              title={titleName}
              kpiName={kpiName}
              data={series as any[]}
              lines={lines}
            />
          );
        })}
      </div>
    );
  }, [scheduledChartData, kpiMeta]);

  const overrideId = useId();
  const currentBuildings = communities[community] ?? COMMUNITY_FALLBACK[community] ?? [];
  const busy = loading || processing;
  const scopes = Array.from(new Set(scheduledChartData.stats.map((stat) => stat.scope)));

  return (
    <div className="page">
      <KpiPageHeader
        title="Overview"
        description={activeTab === "analytics" ? "Analyze KPI data across communities and buildings" : "Real-time telemetry and data quality signals"}
        actions={
          <KpiSegmented
            segments={(Object.entries(TAB_LABELS) as [DashboardTab, { label: string; icon: React.ReactNode }][]).map(([key, { label, icon }]) => ({ key, label, icon }))}
            value={activeTab}
            onChange={setActiveTab}
            ariaLabel="Overview views"
            idPrefix="overview"
          />
        }
      />

      {/* Community and buildings are shared by both views */}
      <KpiFilterBar ariaLabel="Community and buildings">
        <CommunityField
          communities={Object.keys(communities)}
          value={community}
          onChange={(c) => { setCommunity(c); setBuildings([]); }}
        />
        <BuildingsField buildings={currentBuildings} selected={buildings} onChange={setBuildings} />
      </KpiFilterBar>

      <div
        id="overview-panel-analytics"
        role="tabpanel"
        aria-labelledby="overview-tab-analytics"
        hidden={activeTab !== "analytics"}
        className="kpi-results"
      >
        <KpiFilterBar
          ariaLabel="Analysis options"
          footer={
            <>
              <div className="kpi-filterbar-options">
                <KpiSwitch checked={computeAggregated} onChange={setComputeAggregated} label="Include community total" />
                <KpiSwitch
                  checked={recompute}
                  onChange={setRecompute}
                  label="Recalculate from telemetry"
                  hint="Compute from raw telemetry instead of reading the stored results"
                />
              </div>
              <div className="kpi-filterbar-actions">
                <Button
                  onClick={handleFetch}
                  disabled={busy}
                  variant="primary"
                  iconLeft={busy ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
                >
                  {loading ? "Fetching…" : processing ? "Processing…" : "Analyze"}
                </Button>
              </div>
            </>
          }
        >
          <KpiSelectField options={kpiSelectOptions(kpiMeta)} selected={selectedKpis} onChange={setSelectedKpis} />
          <KpiField label="Window override" hint="KPI:window:step, comma-separated" htmlFor={overrideId}>
            <input
              id={overrideId}
              type="text"
              value={windowOverrides}
              onChange={(e) => setWindowOverrides(e.target.value)}
              placeholder="e.g. EnergyCostKPI:2h:2h"
            />
          </KpiField>
          <DateRangeField start={startDate} end={endDate} onChange={(start, end) => { setStartDate(start); setEndDate(end); }} />
        </KpiFilterBar>

        <section className="panel kpi-results" aria-label="Results" aria-busy={busy}>
          {error ? <KpiError message={error} onRetry={buildings.length > 0 ? handleFetch : undefined} /> : null}

          {busy ? (
            <KpiLoading
              label={loading ? "Loading KPI results…" : "Preparing charts…"}
              hint="Long periods can take a moment."
            />
          ) : null}

          {!busy && scheduledChartData.stats.length > 0 ? (
            <>
              <KpiSegmented
                segments={["All Scopes", ...scopes].map((scope) => ({ key: scope, label: scope === "All Scopes" ? "All scopes" : scope }))}
                value={selectedScopeTab}
                onChange={setSelectedScopeTab}
                ariaLabel="Scope"
              />
              <div className="kpi-stat-grid">
                {[...scheduledChartData.stats]
                  .sort((a, b) => a.kpiName.localeCompare(b.kpiName))
                  .filter((stat) => selectedScopeTab === "All Scopes" || stat.scope === selectedScopeTab)
                  .map((stat, idx) => {
                    const { scope, kpiName, summary, timeseries, isStreaming } = stat;
                    const meta = kpiMeta.find((m) => m.name === kpiName);
                    return (
                      <KpiStats
                        key={`${scope}_${kpiName}_${idx}`}
                        title={kpiDisplayName(meta, kpiName)}
                        subtitle={selectedScopeTab === "All Scopes" ? scope : undefined}
                        value={formatStatValue(summary, isStreaming)}
                        unit={meta?.unit || ""}
                        meta={meta}
                        description={describeStat(summary, timeseries, isStreaming)}
                      />
                    );
                  })}
              </div>
            </>
          ) : null}

          {!busy && streamingCharts}
          {!busy && scheduledCharts}

          {!busy && !error && !data?.scheduled && !data?.streaming ? (
            <EmptyState title="No results yet" message="Choose buildings and a period, then select Analyze." />
          ) : null}
        </section>
      </div>

      <div
        id="overview-panel-live"
        role="tabpanel"
        aria-labelledby="overview-tab-live"
        hidden={activeTab !== "live"}
      >
        <LiveDashboard key={community} community={community} buildings={buildings} isActive={activeTab === "live"} />
      </div>
    </div>
  );
}

/** Headline value of a summary card: totals for scheduled KPIs, the mean for streaming ones. */
function formatStatValue(summary: Record<string, number> | null, isStreaming?: boolean): string {
  if (!summary) return "N/A";
  const value = isStreaming
    ? summary.mean_value ?? summary.total_value ?? summary.value
    : summary.total_value ?? summary.mean_value ?? summary.value;
  return value != null && !isNaN(Number(value)) ? Number(value).toFixed(2) : "N/A";
}

function formatDay(value: unknown): string {
  if (!value || typeof value !== "string") return "";
  const parsed = new Date(value.replace(" ", "T"));
  return isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function describeStat(
  summary: Record<string, number> | null,
  timeseries: ScheduledStatItem["timeseries"],
  isStreaming?: boolean,
): string {
  let desc = isStreaming ? "Streaming (live)" : "Scheduled";
  if (timeseries.length > 0) {
    desc = `${isStreaming ? "Avg · " : ""}${formatDay(timeseries[0].period_start)} – ${formatDay(timeseries[timeseries.length - 1].period_end)}`;
  }
  if (summary?.coverage_pct != null) desc += ` · Coverage ${summary.coverage_pct}%`;
  return desc;
}
