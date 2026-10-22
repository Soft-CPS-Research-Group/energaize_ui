import { useState, useMemo } from "react";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { fetchKpiComparison } from "../../api/kpiApi";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";
import { useCommunities } from "../../hooks/useCommunities";
import { kpiDisplayName, kpiSelectOptions, useKpiMetadata } from "../../hooks/useKpiMetadata";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Search, Loader2, Calendar } from "lucide-react";
import type { CompareResponse } from "../../api/kpiApi";
import { KpiPageHeader } from "../../components/kpi/KpiPageHeader";
import { KpiSegmented } from "../../components/kpi/KpiSegmented";
import { KpiInfo } from "../../components/kpi/KpiInfo";
import { KpiDelta } from "../../components/kpi/KpiDelta";
import { KpiError, KpiLoading } from "../../components/kpi/KpiStates";
import {
  BuildingsField, CommunityField, DateRangeField, KpiFilterBar, KpiSelectField, toLocalDateString,
} from "../../components/kpi/KpiFilters";

const defaultEnd  = new Date();
const defaultStart = new Date();
defaultStart.setDate(defaultStart.getDate() - 4);

// KPIs where a lower value = better outcome.
// Names must match the class names registered in kpi_factory.py._SCHEDULED_KPI_REGISTRY.
const LOWER_IS_BETTER = new Set([
  "EnergyCostKPI",             // lower cost = better
  "DailyLoadFactorKPI",        // lower inefficiency = better (0 = flat profile)
  "RampingKPI",                // lower ramping = smoother grid
  "NoHarmIndicatorKPI",        // 0% = no member is worse off
  "GiniBenefitsKPI",           // 0 = perfect equality
  "BenefitConcentrationCR20KPI", // ~0.2 = proportional distribution
]);

type ViewMode = "table" | "chart";

function getSummaryValue(summary: Record<string, number>): number | null {
  for (const key of ["value", "total_value", "mean_value"]) {
    if (key in summary && typeof summary[key] === "number") return summary[key];
  }
  const first = Object.values(summary).find(v => typeof v === "number");
  return first ?? null;
}

// Normalise timeseries to offset-hours from period start for overlay chart
function normaliseTimeseries(
  timeseries: Array<{ value: number; period_start: string }>,
  label: string
): Array<{ hour: number; [key: string]: any }> {
  if (!timeseries.length) return [];
  const t0 = new Date(timeseries[0].period_start).getTime();
  return timeseries.map(pt => ({
    hour: Math.round((new Date(pt.period_start).getTime() - t0) / 3_600_000),
    [label]: pt.value,
  }));
}

export function ComparePage() {
  const { communities } = useCommunities();
  const { kpis: kpiMeta } = useKpiMetadata();

  const defaultCommunity = Object.keys(COMMUNITY_FALLBACK)[0];
  const [community, setCommunity] = useState(defaultCommunity);
  const [buildings, setBuildings] = useState<string[]>([]);
  const [selectedKpis, setSelectedKpis] = useState<string[]>([]);

  const [baselineStart, setBaselineStart] = useState(toLocalDateString(defaultStart));
  const [baselineEnd,   setBaselineEnd]   = useState(toLocalDateString(defaultEnd));
  const [realStart,     setRealStart]     = useState(toLocalDateString(defaultStart));
  const [realEnd,       setRealEnd]       = useState(toLocalDateString(defaultEnd));

  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [response,  setResponse]  = useState<CompareResponse | null>(null);
  const [viewMode,  setViewMode]  = useState<ViewMode>("table");

  const currentBuildings =
    communities[community] ?? COMMUNITY_FALLBACK[community] ?? [];

  const handleCompare = async () => {
    if (!buildings.length) {
      setError("Please select at least one building.");
      return;
    }
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetchKpiComparison({
        community,
        buildings,
        baselineStart: new Date(baselineStart).toISOString(),
        baselineEnd:   new Date(baselineEnd).toISOString(),
        realStart:     new Date(realStart).toISOString(),
        realEnd:       new Date(realEnd).toISOString(),
        kpis:          selectedKpis.length ? selectedKpis : undefined,
      });
      setResponse(res);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Comparison failed");
    } finally {
      setLoading(false);
    }
  };

  // Flatten response into rows for the delta table
  const tableRows = useMemo(() => {
    if (!response?.data) return [];
    return Object.entries(response.data).flatMap(([scope, kpis]) =>
      Object.entries(kpis as Record<string, any>).map(([kpiName, entry]) => ({
        scope,
        kpiName,
        baselineVal: getSummaryValue(entry.baseline.summary),
        realVal:     getSummaryValue(entry.real.summary),
        delta:       entry.delta,
      }))
    );
  }, [response]);

  // Build per-KPI overlay chart data
  const chartDataByKpi = useMemo(() => {
    if (!response?.data) return {};
    const out: Record<string, any[]> = {};
    // Use community scope if available, otherwise first scope
    const scope = "community" in response.data
      ? "community"
      : Object.keys(response.data)[0];
    const kpis = response.data[scope] ?? {};
    for (const [kpiName, entry] of Object.entries(kpis as Record<string, any>)) {
      const bSeries = normaliseTimeseries(entry.baseline.timeseries, "Baseline");
      const rSeries = normaliseTimeseries(entry.real.timeseries, "Comparison");
      // Merge by hour offset
      const map: Record<number, any> = {};
      for (const pt of bSeries) map[pt.hour] = { ...map[pt.hour], hour: pt.hour, Baseline: pt.Baseline };
      for (const pt of rSeries) map[pt.hour] = { ...map[pt.hour], hour: pt.hour, Comparison: pt.Comparison };
      out[kpiName] = Object.values(map).sort((a, b) => a.hour - b.hour);
    }
    return out;
  }, [response]);

  return (
    <div className="page">
      <KpiPageHeader
        title="Compare periods"
        description="Compare KPI results between two measurement periods, e.g. AI off versus AI on"
      />

      <KpiFilterBar
        ariaLabel="Comparison options"
        footer={
          <div className="kpi-filterbar-actions">
            <Button
              onClick={handleCompare}
              disabled={loading}
              variant="primary"
              iconLeft={loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            >
              {loading ? "Computing…" : "Compare"}
            </Button>
          </div>
        }
      >
        <CommunityField
          communities={Object.keys(communities)}
          value={community}
          onChange={(c) => { setCommunity(c); setBuildings([]); }}
        />
        <BuildingsField buildings={currentBuildings} selected={buildings} onChange={setBuildings} />
        <KpiSelectField options={kpiSelectOptions(kpiMeta)} selected={selectedKpis} onChange={setSelectedKpis} />

        <div className="kpi-field-groups">
          <div className="kpi-field-group" role="group" aria-label="Baseline period">
            <p className="kpi-field-group-title"><Calendar size={14} /> Baseline period <small>e.g. AI off</small></p>
            <DateRangeField
              label="Baseline"
              start={baselineStart}
              end={baselineEnd}
              presets={[]}
              onChange={(start, end) => { setBaselineStart(start); setBaselineEnd(end); }}
            />
          </div>
          <div className="kpi-field-group is-accent" role="group" aria-label="Comparison period">
            <p className="kpi-field-group-title"><Calendar size={14} /> Comparison period <small>e.g. AI on</small></p>
            <DateRangeField
              label="Comparison"
              start={realStart}
              end={realEnd}
              presets={[]}
              onChange={(start, end) => { setRealStart(start); setRealEnd(end); }}
            />
          </div>
        </div>
      </KpiFilterBar>

      {error ? <KpiError message={error} onRetry={buildings.length ? handleCompare : undefined} /> : null}

      {loading ? <KpiLoading label="Computing both periods…" hint="Each period is recalculated from telemetry." /> : null}

      {response && !loading ? (
        <section className="kpi-results" aria-label="Comparison results">
          <div className="kpi-results-toolbar">
            <KpiSegmented<ViewMode>
              segments={[{ key: "table", label: "Delta table" }, { key: "chart", label: "Timeline" }]}
              value={viewMode}
              onChange={setViewMode}
              ariaLabel="Result view"
            />
            <span>{tableRows.length} KPI × scope result{tableRows.length !== 1 ? "s" : ""}</span>
          </div>

          {viewMode === "table" ? (
            <div className="kpi-table-wrap">
              <table className="kpi-table">
                <thead>
                  <tr>
                    <th>KPI</th>
                    <th>Scope</th>
                    <th className="num">Baseline</th>
                    <th className="num">Comparison</th>
                    <th className="num">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map(({ scope, kpiName, baselineVal, realVal, delta }) => {
                    const meta = kpiMeta.find((m) => m.name === kpiName);
                    const unit = meta?.unit ? ` ${meta.unit}` : "";
                    return (
                      <tr key={`${scope}_${kpiName}`}>
                        <td>{kpiDisplayName(meta, kpiName)} {meta ? <KpiInfo meta={meta} /> : null}</td>
                        <td className="kpi-text-soft">{scope}</td>
                        <td className="num">{baselineVal !== null ? `${baselineVal.toFixed(4)}${unit}` : "—"}</td>
                        <td className="num">{realVal !== null ? `${realVal.toFixed(4)}${unit}` : "—"}</td>
                        <td className="num">
                          <KpiDelta
                            absolute={delta.absolute}
                            relativePct={delta.relative_pct}
                            lowerIsBetter={LOWER_IS_BETTER.has(kpiName)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            Object.entries(chartDataByKpi).map(([kpiName, chartData]) => {
              const meta = kpiMeta.find((m) => m.name === kpiName);
              return (
                <section key={kpiName} className="panel kpi-chart-card" aria-label={kpiDisplayName(meta, kpiName)}>
                  <header className="kpi-chart-card-head">
                    <h3>{kpiDisplayName(meta, kpiName)} {meta ? <KpiInfo meta={meta} /> : null}</h3>
                    <p>Hours since the start of each period, so periods with different dates overlay.</p>
                  </header>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                      <XAxis
                        dataKey="hour"
                        tickFormatter={h => `+${h}h`}
                        tick={{ fontSize: 11, fill: "var(--text-soft)" }}
                      />
                      <YAxis
                        width={80}
                        tick={{ fontSize: 11, fill: "var(--text-soft)" }}
                        label={{ value: meta?.unit || "", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fill: "var(--text-soft)" }, offset: -10 }}
                      />
                      <Tooltip
                        formatter={(value: any) => {
                          if (typeof value === "number") {
                            return [meta?.unit ? `${value.toFixed(2)} ${meta.unit}` : value.toFixed(2)];
                          }
                          return [value];
                        }}
                        labelFormatter={h => `Hour +${h}`}
                        contentStyle={{ borderRadius: 10, fontSize: 12, backgroundColor: "var(--bg-elev)", borderColor: "var(--line)", color: "var(--text)" }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="Baseline"
                        stroke="var(--text-soft)"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="Comparison"
                        stroke="var(--brand)"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </section>
              );
            })
          )}
        </section>
      ) : null}

      {!loading && !response && !error ? (
        <EmptyState
          title="Choose two periods to compare"
          message="Set a baseline and a comparison period, choose KPIs, then select Compare."
        />
      ) : null}
    </div>
  );
}
