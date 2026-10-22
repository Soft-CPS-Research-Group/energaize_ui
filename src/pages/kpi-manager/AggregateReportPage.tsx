import { useState } from "react";
import { fetchKpiAggregate, fetchKpis } from "../../api/kpiApi";
import type { AggregatePeriod, AggregateBucket } from "../../api/kpiApi";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { useCommunities } from "../../hooks/useCommunities";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { BarChart3, Search, Loader2, TrendingUp, TrendingDown, Download } from "lucide-react";
import { KpiPageHeader } from "../../components/kpi/KpiPageHeader";
import { KpiSegmented } from "../../components/kpi/KpiSegmented";
import { KpiError, KpiLoading } from "../../components/kpi/KpiStates";
import {
  BuildingsField, CommunityField, DateRangeField, KpiField, KpiFilterBar, KpiSwitch, toLocalDateString,
} from "../../components/kpi/KpiFilters";
import {
  downloadReportCsv, downloadReportPdf, formatNumber, formatStat, reportRows, rowExtremes, statUnit, statValue,
  type ReportMode, type ReportRow,
} from "./reportModel";

const defaultEnd = new Date();
const defaultStart = new Date();
defaultStart.setMonth(defaultStart.getMonth() - 3);

const PERIODS: { label: string; key: AggregatePeriod }[] = [
  { label: "Daily", key: "daily" },
  { label: "Weekly", key: "weekly" },
  { label: "Monthly", key: "monthly" },
];

const MODES: { label: string; key: ReportMode }[] = [
  { label: "Per KPI", key: "auto" },
  { label: "Σ Total", key: "sum" },
  { label: "⌀ Mean", key: "mean" },
];

// ── Pivot table ───────────────────────────────────────────────────────────────

function PivotTable({ buckets, mode, onOpenChart }: {
  buckets: AggregateBucket[];
  mode: ReportMode;
  onOpenChart: (row: ReportRow) => void;
}) {
  if (buckets.length === 0) return <p className="kpi-text-soft">No data in range.</p>;

  return (
    <div className="kpi-table-wrap">
      <table className="kpi-table">
        <thead>
          <tr>
            <th>Scope</th>
            <th>KPI</th>
            {buckets.map(b => (
              <th key={b.label} className="num">
                {b.label}
                <br />
                <span className="kpi-text-soft">{b.start} → {b.end}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reportRows(buckets).map((row) => {
            const extremes = rowExtremes(buckets, row, mode);
            return (
              <tr key={`${row.scope}||${row.kpi}`}>
                <td className="kpi-text-soft kpi-cell-truncate" title={row.scope}>{row.scope}</td>
                <td className="kpi-cell-kpi">
                  {row.kpi.replace("KPI", "")}
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    iconLeft={<BarChart3 size={12} />}
                    onClick={() => onOpenChart(row)}
                    aria-label={`Trend of ${row.kpi.replace("KPI", "")} for ${row.scope}`}
                  >
                    Trend
                  </Button>
                </td>
                {buckets.map((b, bi) => {
                  const stats = b.scopes[row.scope]?.[row.kpi];
                  if (!stats) return <td key={bi} className="num kpi-text-soft">—</td>;
                  const val = statValue(row.kpi, stats, mode);
                  const isMax = extremes !== null && val === extremes.max;
                  const isMin = extremes !== null && val === extremes.min;
                  return (
                    <td
                      key={bi}
                      title={`${stats.count} windows aggregated${isMax ? " · highest" : isMin ? " · lowest" : ""}`}
                      className={`num${isMax || isMin ? " kpi-cell-extreme" : ""}`}
                    >
                      {isMax && <TrendingUp size={11} aria-label="highest" />}
                      {isMin && <TrendingDown size={11} aria-label="lowest" />}
                      {formatStat(row.kpi, stats, mode)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Summary strip ─────────────────────────────────────────────────────────────

function TotalsStrip({ buckets }: { buckets: AggregateBucket[] }) {
  let totalWindows = 0;
  const kpis = new Set<string>();
  const scopes = new Set<string>();
  for (const b of buckets) {
    for (const [scope, byKpi] of Object.entries(b.scopes)) {
      scopes.add(scope);
      for (const [kpi, stats] of Object.entries(byKpi)) {
        kpis.add(kpi);
        totalWindows += stats.count;
      }
    }
  }
  return (
    <dl className="kpi-summary-strip">
      {[
        { label: "Buckets", value: buckets.length },
        { label: "KPIs", value: kpis.size },
        { label: "Scopes", value: scopes.size },
        { label: "Windows", value: totalWindows.toLocaleString() },
      ].map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function AggregateReportPage() {
  const { communities } = useCommunities();
  const defaultCommunity = Object.keys(COMMUNITY_FALLBACK)[0];

  const [community, setCommunity] = useState(defaultCommunity);
  const [period, setPeriod] = useState<AggregatePeriod>("monthly");
  const [startDate, setStartDate] = useState(toLocalDateString(defaultStart));
  const [endDate, setEndDate] = useState(toLocalDateString(defaultEnd));
  const [mode, setMode] = useState<ReportMode>("auto");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<AggregateBucket[] | null>(null);

  const [activeChart, setActiveChart] = useState<ReportRow | null>(null);
  const [recompute, setRecompute] = useState(false);
  const [recomputeLoading, setRecomputeLoading] = useState(false);
  const [selectedBuildings, setSelectedBuildings] = useState<string[]>([]);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    setBuckets(null);
    try {
      if (recompute) {
        setRecomputeLoading(true);
        const bldgs = selectedBuildings.length > 0 ? selectedBuildings : (communities[community] && communities[community].length > 0 ? [communities[community][0]] : []);
        if (bldgs.length === 0) {
          throw new Error("Select at least one building, or choose a community that has buildings.");
        }
        await fetchKpis({
          community,
          buildings: bldgs,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          computeAggregated: true,
          computeScheduled: true
        });
        setRecomputeLoading(false);
      }

      const res = await fetchKpiAggregate({
        community,
        period,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
      });
      setBuckets(res.buckets);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Aggregation failed");
      setRecomputeLoading(false);
    } finally {
      setLoading(false);
    }
  };

  const busy = loading || recomputeLoading;
  const fileBase = `kpi_report_${community}_${period}_${startDate}_${endDate}`;
  const chartData = activeChart && buckets
    ? buckets
        .map((b) => {
          const stats = b.scopes[activeChart.scope]?.[activeChart.kpi];
          return { label: b.label, value: stats ? statValue(activeChart.kpi, stats, mode) : null };
        })
        .filter((p) => p.value != null)
    : [];
  const chartUnit = activeChart ? statUnit(activeChart.kpi, buckets?.map((b) => b.scopes[activeChart.scope]?.[activeChart.kpi]).find(Boolean)) : "";

  return (
    <div className="page">
      <KpiPageHeader
        title="Reports"
        description="Group KPI windows by day, week or month to spot trends and cumulative totals"
      />

      <KpiFilterBar
        ariaLabel="Report options"
        footer={
          <>
            <div className="kpi-filterbar-options">
              <KpiSwitch
                checked={recompute}
                onChange={setRecompute}
                label="Recalculate first"
                hint="Compute from raw telemetry before aggregating, instead of using the stored results"
              />
            </div>
            <div className="kpi-filterbar-actions">
              <Button
                variant="primary"
                disabled={busy}
                onClick={handleFetch}
                iconLeft={busy ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
              >
                {recomputeLoading ? "Recalculating…" : loading ? "Aggregating…" : "Run report"}
              </Button>
            </div>
          </>
        }
      >
        <CommunityField communities={Object.keys(communities)} value={community} onChange={setCommunity} />
        <KpiField label="Granularity" icon={<BarChart3 size={14} />}>
          <KpiSegmented<AggregatePeriod> segments={PERIODS} value={period} onChange={setPeriod} ariaLabel="Granularity" />
        </KpiField>
        <DateRangeField
          start={startDate}
          end={endDate}
          presets={[{ label: "30 days", days: 30 }, { label: "90 days", days: 90 }, { label: "1 year", days: 365 }]}
          onChange={(start, end) => { setStartDate(start); setEndDate(end); }}
        />
        {recompute && (
          <BuildingsField buildings={communities[community] || []} selected={selectedBuildings} onChange={setSelectedBuildings} />
        )}
      </KpiFilterBar>

      {error && <KpiError message={error} onRetry={handleFetch} />}

      {loading && <KpiLoading label={recomputeLoading ? "Recalculating from telemetry…" : "Aggregating KPI windows…"} />}

      {!loading && buckets && (
        <section className="kpi-results" aria-label="Report">
          <TotalsStrip buckets={buckets} />
          <div className="kpi-results-toolbar">
            <KpiSegmented<ReportMode> segments={MODES} value={mode} onChange={setMode} ariaLabel="Values shown" />
            <span>
              {mode === "auto" ? "Totals for kWh and €, means for % and ratios" : mode === "sum" ? "Sum of every window" : "Mean of every window"}
            </span>
            <div className="kpi-filterbar-actions">
              <Button variant="secondary" size="sm" iconLeft={<Download size={14} />} onClick={() => downloadReportCsv(buckets, mode, `${fileBase}.csv`)}>
                CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Download size={14} />}
                onClick={() => downloadReportPdf(buckets, mode, `KPI report · ${community} · ${period} · ${startDate} → ${endDate}`, `${fileBase}.pdf`)}
              >
                PDF
              </Button>
            </div>
          </div>
          <PivotTable buckets={buckets} mode={mode} onOpenChart={setActiveChart} />
        </section>
      )}

      {!loading && !buckets && !error && (
        <EmptyState
          title="No report yet"
          message="Choose a community, granularity and period, then select Run report."
        />
      )}

      <Modal
        title={activeChart ? `${activeChart.kpi.replace("KPI", "")} trend · ${activeChart.scope}` : ""}
        open={activeChart !== null}
        onClose={() => setActiveChart(null)}
        width="sm"
      >
        {chartData.length < 2 ? (
          <p className="kpi-text-soft">Not enough data points to show a trend.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
              <XAxis dataKey="label" fontSize={10} tickMargin={8} stroke="var(--text-soft)" />
              <YAxis
                fontSize={10}
                tickMargin={5}
                stroke="var(--text-soft)"
                width={60}
                tickFormatter={(val) => {
                  if (Math.abs(val) >= 1000) return (val / 1000).toFixed(1) + "k";
                  if (Math.abs(val) < 0.01 && val !== 0) return val.toExponential(1);
                  return val.toString();
                }}
              />
              <Tooltip
                contentStyle={{ borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-elev)", fontSize: 12, color: "var(--text)" }}
                itemStyle={{ color: "var(--brand)", fontWeight: 600 }}
                labelStyle={{ color: "var(--text-soft)", marginBottom: 4 }}
                formatter={(value: any) => [`${formatNumber(Number(value))}${chartUnit ? ` ${chartUnit}` : ""}`, activeChart?.kpi.replace("KPI", "")]}
              />
              <Line type="monotone" dataKey="value" stroke="var(--brand)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Modal>
    </div>
  );
}
