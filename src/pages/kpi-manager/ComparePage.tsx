import { useState, useMemo } from "react";
import { Button } from "../../components/ui/Button";
import { fetchKpiComparison } from "../../api/kpiApi";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";
import { useCommunities } from "../../hooks/useCommunities";
import { useKpiMetadata } from "../../hooks/useKpiMetadata";
import { MultiSelect } from "../../components/ui/MultiSelect";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/KpiCard";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  Search, Loader2, AlertCircle, TrendingUp,
  TrendingDown, Minus, Calendar, MapPin, Building2, Activity,
} from "lucide-react";
import type { CompareResponse } from "../../api/kpiApi";

// KPIs that make conceptual sense for baseline vs real comparison —
// derived from live metadata after filtering streaming-only KPIs

const getLocalDateString = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];

const defaultEnd  = new Date();
const defaultStart = new Date();
defaultStart.setDate(defaultStart.getDate() - 4);

// Delta indicator component
function DeltaChip({ absolute, relative_pct, lowerIsBetter = false }: {
  absolute: number | null;
  relative_pct: number | null;
  lowerIsBetter?: boolean;
}) {
  if (absolute === null || absolute === undefined) {
    return <span style={{ color: "var(--text-soft)", fontSize: "14px" }}>—</span>;
  }

  const isPositive = absolute > 0;
  const isGood = lowerIsBetter ? !isPositive : isPositive;
  const colorHex = absolute === 0
    ? "#6b7280"
    : isGood ? "#16a34a" : "var(--error-text, #ef4444)";
  const Icon = absolute === 0 ? Minus : isGood ? TrendingUp : TrendingDown;

  return (
    <span style={{ display: "flex", alignItems: "center", gap: "4px", fontWeight: 500, fontSize: "14px", color: colorHex }}>
      <Icon size={14} />
      {absolute > 0 ? "+" : ""}{absolute.toFixed(3)}
      {relative_pct !== null && (
        <span style={{ opacity: 0.7 }}>
          ({relative_pct > 0 ? "+" : ""}{relative_pct.toFixed(1)}%)
        </span>
      )}
    </span>
  );
}

// KPIs where a lower value = better outcome (costs, emissions, losses)
const LOWER_IS_BETTER = new Set([
  "EnergyCostKPI", "AutoconsumoKPI", "IndicadorNaoPrejuizoKPI",
  "GiniBeneficiosKPI", "ConcentracaoBeneficiosCR20KPI",
  "DailyLoadFactorKPI", "RampingKPI",
]);

function getSummaryValue(summary: Record<string, number>): number | null {
  for (const key of ["total_value", "mean_value", "value"]) {
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
  const [buildings, setBuildings] = useState<string[]>(
    (Object.values(COMMUNITY_FALLBACK)[0] as string[]) ?? []
  );

  // KPIs appropriate for baseline vs real comparison (exclude per-building meter KPIs)
  const comparableKpis = kpiMeta
    .filter((k: any) => k.status === "available" && k.registered)
    .filter((k: any) => !["AverageImportedEnergyKPI", "AverageExportedEnergyKPI"].includes(k.name))
    .map((k: any) => k.name);

  const [selectedKpis, setSelectedKpis] = useState<string[]>([]); 

  const [baselineStart, setBaselineStart] = useState(getLocalDateString(defaultStart));
  const [baselineEnd,   setBaselineEnd]   = useState(getLocalDateString(defaultEnd));
  const [realStart,     setRealStart]     = useState(getLocalDateString(defaultStart));
  const [realEnd,       setRealEnd]       = useState(getLocalDateString(defaultEnd));

  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [response,  setResponse]  = useState<CompareResponse | null>(null);
  const [viewMode,  setViewMode]  = useState<"table" | "chart">("table");

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
      const rSeries = normaliseTimeseries(entry.real.timeseries, "Real");
      // Merge by hour offset
      const map: Record<number, any> = {};
      for (const pt of bSeries) map[pt.hour] = { ...map[pt.hour], hour: pt.hour, Baseline: pt.Baseline };
      for (const pt of rSeries) map[pt.hour] = { ...map[pt.hour], hour: pt.hour, Real: pt.Real };
      out[kpiName] = Object.values(map).sort((a, b) => a.hour - b.hour);
    }
    return out;
  }, [response]);

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <header className="jobs-hero">
        <div>
          <h1>Compare Periods</h1>
          <p>Compare KPI results between two measurement periods (e.g. AI-off vs AI-on)</p>
        </div>
      </header>

      <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "24px", flex: 1, backgroundColor: "var(--bg)" }}>
        {/* Filters panel */}
        <div style={{ backgroundColor: "var(--bg-elev)", padding: "20px", borderRadius: "12px", border: "1px solid var(--line)", boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Community + Buildings + KPIs */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 0%", minWidth: "200px" }}>
              <label style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <MapPin size={16} /> Community
              </label>
              <select
                style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "14px", outline: "none", backgroundColor: "var(--bg-elev)", color: "var(--text)" }}
                value={community}
                onChange={e => { setCommunity(e.target.value); setBuildings([]); }}
              >
                {Object.keys(communities).map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, " ").toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: "2 1 0%", minWidth: "280px" }}>
              <label style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Building2 size={16} /> Buildings
              </label>
              <MultiSelect
                options={currentBuildings.map((b: any) => ({ label: b, value: b }))}
                selected={buildings}
                onChange={setBuildings}
                placeholder="Select buildings..."
              />
            </div>
            <div style={{ flex: "2 1 0%", minWidth: "280px" }}>
              <label style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Activity size={16} /> KPIs
              </label>
              <MultiSelect
                options={comparableKpis.map((k: any) => ({ label: k, value: k }))}
                selected={selectedKpis}
                onChange={setSelectedKpis}
                placeholder="All scheduled KPIs..."
              />
            </div>
          </div>

          {/* Period selectors */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px", borderTop: "1px solid var(--line)", paddingTop: "16px" }}>
            {/* Baseline */}
            <div style={{ backgroundColor: "var(--bg)", borderRadius: "8px", padding: "16px", border: "1px solid var(--line)" }}>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.025em", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Calendar size={14} /> Baseline Period
                <span style={{ marginLeft: "4px", fontWeight: 400, textTransform: "none", color: "var(--text-soft)" }}>(AI off)</span>
              </p>
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "14px", color: "var(--text-soft)", display: "block", marginBottom: "4px" }}>Start</label>
                  <input
                    type="date"
                    value={baselineStart}
                    onChange={e => setBaselineStart(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "14px", outline: "none", backgroundColor: "var(--bg-elev)", color: "var(--text)" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "14px", color: "var(--text-soft)", display: "block", marginBottom: "4px" }}>End</label>
                  <input
                    type="date"
                    value={baselineEnd}
                    onChange={e => setBaselineEnd(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "14px", outline: "none", backgroundColor: "var(--bg-elev)", color: "var(--text)" }}
                  />
                </div>
              </div>
            </div>

            {/* Real */}
            <div style={{ backgroundColor: "var(--brand-muted, rgba(37, 99, 235, 0.1))", borderRadius: "8px", padding: "16px", border: "1px solid var(--brand-soft)" }}>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.025em", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Calendar size={14} /> Real Period
                <span style={{ marginLeft: "4px", fontWeight: 400, textTransform: "none", color: "var(--brand-soft)" }}>(AI on)</span>
              </p>
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "14px", color: "var(--brand)", display: "block", marginBottom: "4px" }}>Start</label>
                  <input
                    type="date"
                    value={realStart}
                    onChange={e => setRealStart(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "14px", outline: "none", backgroundColor: "var(--bg-elev)", color: "var(--text)" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "14px", color: "var(--brand)", display: "block", marginBottom: "4px" }}>End</label>
                  <input
                    type="date"
                    value={realEnd}
                    onChange={e => setRealEnd(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: "8px", fontSize: "14px", outline: "none", backgroundColor: "var(--bg-elev)", color: "var(--text)" }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", borderTop: "1px solid var(--line)", paddingTop: "16px" }}>
            <Button
              onClick={handleCompare}
              disabled={loading}
              variant="primary"
            >
              {loading
                ? <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><Loader2 size={16} className="animate-spin" /> Computing...</span>
                : <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><Search size={16} /> Compare</span>}
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ backgroundColor: "var(--error-bg, rgba(220, 38, 38, 0.1))", color: "var(--error-text, #ef4444)", padding: "16px", borderRadius: "8px", border: "1px solid var(--error-border, rgba(220, 38, 38, 0.2))", display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={20} style={{ flexShrink: 0 }} />
            <p style={{ margin: 0 }}>{error}</p>
          </div>
        )}

        {/* Results */}
        {response && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* View mode toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {(["table", "chart"] as const).map(mode => (
                <Button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  variant={viewMode === mode ? "primary" : "secondary"}
                  size="sm"
                >
                  {mode === "table" ? "Delta Table" : "Timeline Chart"}
                </Button>
              ))}
              <span style={{ fontSize: "14px", color: "var(--text-soft)", marginLeft: "8px" }}>
                {tableRows.length} KPI × scope result{tableRows.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Delta Table */}
            {viewMode === "table" && (
              <div style={{ backgroundColor: "var(--bg-elev)", borderRadius: "12px", border: "1px solid var(--line)", boxShadow: "var(--shadow)", overflow: "auto" }}>
                <table style={{ width: "100%", fontSize: "16px", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)", backgroundColor: "var(--bg)", fontSize: "14px", fontWeight: 600, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.025em" }}>
                      <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>KPI</th>
                      <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>Scope</th>
                      <th style={{ textAlign: "right", padding: "12px 16px", fontWeight: 600 }}>
                        <span style={{ color: "var(--text-soft)" }}>Baseline</span>
                      </th>
                      <th style={{ textAlign: "right", padding: "12px 16px", fontWeight: 600 }}>
                        <span style={{ color: "var(--brand)" }}>Real</span>
                      </th>
                      <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map(({ scope, kpiName, baselineVal, realVal, delta }, i) => (
                      <tr
                        key={`${scope}_${kpiName}`}
                        style={{ borderBottom: "1px solid var(--bg-elev-2)", backgroundColor: i % 2 === 0 ? "transparent" : "var(--bg)" }}
                      >
                        <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: "14px", color: "var(--text)" }}>{kpiName}</td>
                        <td style={{ padding: "12px 16px", color: "var(--text-soft)", fontSize: "14px" }}>{scope}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 500, color: "var(--text)" }}>
                          {baselineVal !== null ? baselineVal.toFixed(4) : "—"}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 500, color: "var(--brand)" }}>
                          {realVal !== null ? realVal.toFixed(4) : "—"}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          <DeltaChip
                            absolute={delta.absolute}
                            relative_pct={delta.relative_pct}
                            lowerIsBetter={LOWER_IS_BETTER.has(kpiName)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Timeline charts */}
            {viewMode === "chart" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px" }}>
                {Object.entries(chartDataByKpi).map(([kpiName, chartData]) => (
                  <Card key={kpiName}>
                    <CardHeader>
                      <CardTitle style={{ fontSize: "14px", fontFamily: "monospace" }}>{kpiName}</CardTitle>
                      <p style={{ fontSize: "14px", color: "var(--text-soft)", margin: 0 }}>
                        X-axis: hours elapsed from start of each period
                        (allows overlay of periods with different absolute dates)
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div style={{ height: "280px" }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis
                              dataKey="hour"
                              tickFormatter={h => `+${h}h`}
                              style={{ fontSize: "11px" }}
                            />
                            <YAxis style={{ fontSize: "11px" }} />
                            <Tooltip
                              labelFormatter={h => `Hour +${h}`}
                              contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                            />
                            <Legend />
                            <Line
                              type="monotone"
                              dataKey="Baseline"
                              stroke="#9ca3af"
                              strokeWidth={2}
                              strokeDasharray="5 5"
                              dot={false}
                              isAnimationActive={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="Real"
                              stroke="var(--brand)"
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!loading && !response && !error && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-soft)", padding: "48px", backgroundColor: "var(--bg-elev)", borderRadius: "12px", border: "1px dashed var(--line)" }}>
            <Search size={48} style={{ marginBottom: "16px", color: "var(--line)" }} />
            <p style={{ fontSize: "16px", fontWeight: 500, color: "var(--text-soft)", margin: "0 0 4px 0" }}>Select periods and click Compare</p>
            <p style={{ fontSize: "14px", margin: 0 }}>
              Set a baseline (AI off) and real (AI on) period, choose your KPIs, and compare.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
