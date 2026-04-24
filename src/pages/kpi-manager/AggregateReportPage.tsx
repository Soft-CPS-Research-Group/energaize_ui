import { useState } from "react";
import { fetchKpiAggregate } from "../../api/kpiApi";
import type { AggregatePeriod, AggregateBucket, KpiAggStats } from "../../api/kpiApi";
import { Button } from "../../components/ui/Button";
import { useCommunities } from "../../hooks/useCommunities";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";
import {
  BarChart3, MapPin, Calendar,
  Search, Loader2, AlertCircle, TrendingUp, TrendingDown,
} from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

const getLocalDateString = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];

const defaultEnd = new Date();
const defaultStart = new Date();
defaultStart.setMonth(defaultStart.getMonth() - 3);

// KPIs for which sum is the meaningful aggregate (additive by nature)
const SUM_KPIS = new Set([
  "EnergyCostKPI",
  "EffectiveSavingsKPI",
  "NetEnergyBalanceKPI",
]);

function isSumKpi(name: string) {
  return SUM_KPIS.has(name);
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString("pt-PT", { maximumFractionDigits: 1 });
  if (Math.abs(v) < 0.001) return v.toExponential(2);
  return v.toLocaleString("pt-PT", { maximumFractionDigits: 4 });
}

function unit(kpiName: string): string {
  if (kpiName.includes("Cost") || kpiName.includes("Savings")) return " €";
  if (kpiName.includes("SelfSufficiency") || kpiName.includes("Rate") || kpiName.includes("Factor")
    || kpiName.includes("Gini") || kpiName.includes("Parity") || kpiName.includes("CR20")
    || kpiName.includes("NoHarm")) return " %";
  if (kpiName.includes("Balance") || kpiName.includes("Energy")) return " kWh";
  return "";
}

function displayValue(name: string, stats: KpiAggStats, mode: "sum" | "mean"): string {
  const v = mode === "sum" || isSumKpi(name) ? stats.sum : stats.mean;
  return fmt(v) + unit(name);
}

// ── Period selector ───────────────────────────────────────────────────────────

const PERIODS: { label: string; value: AggregatePeriod }[] = [
  { label: "Daily",   value: "daily" },
  { label: "Weekly",  value: "weekly" },
  { label: "Monthly", value: "monthly" },
];

// ── Pivot table ───────────────────────────────────────────────────────────────

interface PivotProps {
  buckets: AggregateBucket[];
  mode: "sum" | "mean";
}

function PivotTable({ buckets, mode }: PivotProps) {
  if (buckets.length === 0) return <p style={{ color: "var(--text-soft)" }}>No data in range.</p>;

  // Collect all unique (scope, kpiName) pairs
  const keys = new Set<string>();
  for (const b of buckets) {
    for (const scope of Object.keys(b.scopes)) {
      for (const kpi of Object.keys(b.scopes[scope])) {
        keys.add(`${scope}||${kpi}`);
      }
    }
  }
  const rows = Array.from(keys).sort().map(k => {
    const [scope, kpi] = k.split("||");
    return { scope, kpi };
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
        <thead>
          <tr>
            <th style={thStyle}>Scope</th>
            <th style={thStyle}>KPI</th>
            {buckets.map(b => (
              <th key={b.label} style={{ ...thStyle, textAlign: "right" }}>
                <span style={{ fontWeight: 700 }}>{b.label}</span>
                <br />
                <span style={{ fontWeight: 400, opacity: 0.65, fontSize: "0.7rem" }}>
                  {b.start} → {b.end}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ scope, kpi }, i) => {
            const rowVals = buckets.map(b => b.scopes[scope]?.[kpi] ?? null);
            const defined = rowVals.filter((v): v is KpiAggStats => v !== null);
            const allSums = defined.map(v => (mode === "sum" || isSumKpi(kpi)) ? v.sum : v.mean);
            const globalMax = defined.length ? Math.max(...allSums) : 0;
            const globalMin = defined.length ? Math.min(...allSums) : 0;

            return (
              <tr key={`${scope}||${kpi}`} style={{ borderTop: "1px solid var(--line)", background: i % 2 === 0 ? "transparent" : "rgba(0,0,0,0.025)" }}>
                <td style={{ ...tdStyle, color: "var(--text-soft)", maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={scope}>
                  {scope}
                </td>
                <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {kpi.replace("KPI", "")}
                </td>
                {rowVals.map((stats, bi) => {
                  if (!stats) {
                    return <td key={bi} style={{ ...tdStyle, textAlign: "right", color: "var(--text-soft)" }}>—</td>;
                  }
                  const val = (mode === "sum" || isSumKpi(kpi)) ? stats.sum : stats.mean;
                  const isMax = val === globalMax && defined.length > 1;
                  const isMin = val === globalMin && defined.length > 1;
                  return (
                    <td key={bi} style={{
                      ...tdStyle, textAlign: "right", fontWeight: isMax || isMin ? 700 : 400,
                      color: isMax ? "#16a34a" : isMin ? "#dc2626" : "var(--text)",
                      whiteSpace: "nowrap",
                    }}>
                      {isMax && <TrendingUp size={11} style={{ marginRight: "2px", display: "inline" }} />}
                      {isMin && <TrendingDown size={11} style={{ marginRight: "2px", display: "inline" }} />}
                      {displayValue(kpi, stats, mode)}
                      <br />
                      <span style={{ fontSize: "0.68rem", opacity: 0.55, fontWeight: 400 }}>
                        n={stats.count}
                      </span>
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

const thStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  background: "var(--bg)",
  color: "var(--text-soft)",
  fontWeight: 600,
  textAlign: "left",
  borderBottom: "1px solid var(--line)",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const tdStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  color: "var(--text)",
  verticalAlign: "middle",
};

// ── Summary totals bar ────────────────────────────────────────────────────────

function TotalsBar({ buckets }: { buckets: AggregateBucket[] }) {
  const totalWindows = buckets.reduce((acc, b) => {
    for (const scope of Object.values(b.scopes)) {
      for (const kpi of Object.values(scope)) {
        acc += kpi.count;
      }
    }
    return acc;
  }, 0);

  const kpiSet = new Set<string>();
  for (const b of buckets) for (const scope of Object.values(b.scopes)) for (const kpi of Object.keys(scope)) kpiSet.add(kpi);
  const scopeSet = new Set<string>();
  for (const b of buckets) for (const scope of Object.keys(b.scopes)) scopeSet.add(scope);

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: "1.25rem",
      background: "var(--bg-elev)", border: "1px solid var(--line)",
      borderRadius: "0.75rem", padding: "1rem 1.25rem",
    }}>
      {[
        { label: "Buckets",        value: buckets.length },
        { label: "KPIs",           value: kpiSet.size },
        { label: "Scopes",         value: scopeSet.size },
        { label: "Total Windows",  value: totalWindows.toLocaleString() },
      ].map(({ label, value }) => (
        <div key={label} style={{ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: "80px" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-soft)", fontWeight: 500 }}>{label}</span>
          <span style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text)" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function AggregateReportPage() {
  const { communities } = useCommunities();
  const defaultCommunity = Object.keys(COMMUNITY_FALLBACK)[0];

  const [community, setCommunity] = useState(defaultCommunity);
  const [period, setPeriod]       = useState<AggregatePeriod>("monthly");
  const [startDate, setStartDate] = useState(getLocalDateString(defaultStart));
  const [endDate, setEndDate]     = useState(getLocalDateString(defaultEnd));
  const [mode, setMode]           = useState<"sum" | "mean">("sum");

  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [buckets,  setBuckets]  = useState<AggregateBucket[] | null>(null);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    setBuckets(null);
    try {
      const res = await fetchKpiAggregate({
        community,
        period,
        startDate: new Date(startDate).toISOString(),
        endDate:   new Date(endDate).toISOString(),
      });
      setBuckets(res.buckets);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Aggregation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <header className="jobs-hero">
        <div>
          <h1>Aggregate Report (On going work)</h1>
          <p>Group KPI windows by day, week, or month to spot trends and cumulative totals</p>
        </div>
      </header>

      {/* ── Filters ── */}
      <div style={{ paddingBottom: "0.5rem" }}>
        <div className="panel" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end" }}>

            {/* Community */}
            <div style={{ flex: "1 1 160px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
                <MapPin size={15} /> Community
              </label>
              <select
                style={selectStyle}
                value={community}
                onChange={e => setCommunity(e.target.value)}
              >
                {Object.keys(communities).map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, " ").toUpperCase()}</option>
                ))}
              </select>
            </div>

            {/* Period */}
            <div style={{ flex: "1 1 160px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
                <BarChart3 size={15} /> Granularity
              </label>
              <div style={{ display: "flex", gap: "0.375rem" }}>
                {PERIODS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setPeriod(p.value)}
                    style={{
                      flex: 1, padding: "0.5rem 0.25rem", borderRadius: "0.5rem",
                      border: `1px solid ${period === p.value ? "var(--brand)" : "var(--line)"}`,
                      background: period === p.value ? "var(--brand)" : "var(--bg-elev)",
                      color: period === p.value ? "#fff" : "var(--text)",
                      fontWeight: 600, fontSize: "0.8rem", cursor: "pointer",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Start */}
            <div style={{ width: "145px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
                <Calendar size={15} /> Start
              </label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
            </div>

            {/* End */}
            <div style={{ width: "145px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
                <Calendar size={15} /> End
              </label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
            </div>

            {/* Run */}
            <div>
              <Button
                variant="primary"
                disabled={loading}
                onClick={handleFetch}
                iconLeft={loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
              >
                {loading ? "Computing…" : "Run Report"}
              </Button>
            </div>
          </div>

          {/* Mode toggle */}
          {buckets && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", borderTop: "1px solid var(--line)", paddingTop: "0.75rem" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-soft)" }}>Display:</span>
              {(["sum", "mean"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    padding: "0.25rem 0.875rem", borderRadius: "9999px", fontSize: "0.8rem", fontWeight: 600,
                    cursor: "pointer", border: `1px solid ${mode === m ? "var(--brand)" : "var(--line)"}`,
                    background: mode === m ? "var(--brand)" : "transparent",
                    color: mode === m ? "#fff" : "var(--text)",
                  }}
                >
                  {m === "sum" ? "Σ Total (additive)" : "⌀ Mean (ratios)"}
                </button>
              ))}
              <span style={{ fontSize: "0.75rem", color: "var(--text-soft)", marginLeft: "auto" }}>
                Cost/Savings/Balance always show totals regardless of mode
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Results ── */}
      <main className="page-content" style={{ flex: 1, padding: "0 0 2rem" }}>

        {error && (
          <div style={{
            display: "flex", alignItems: "center", gap: "0.75rem",
            background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)",
            color: "#dc2626", borderRadius: "0.75rem", padding: "1rem",
          }}>
            <AlertCircle size={18} /><span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="route-loading panel">
            <Loader2 className="ev-loader" />
            <p className="font-medium animate-pulse">Aggregating KPI windows…</p>
          </div>
        )}

        {!loading && buckets && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <TotalsBar buckets={buckets} />
            <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--line)", fontWeight: 600 }}>
                KPI Values by {period.charAt(0).toUpperCase() + period.slice(1)} Period
              </div>
              <div style={{ padding: "0.5rem" }}>
                <PivotTable buckets={buckets} mode={mode} />
              </div>
            </div>
          </div>
        )}

        {!loading && !buckets && !error && (
          <div className="panel empty-state">
            <BarChart3 size={48} style={{ opacity: 0.35, marginBottom: "1rem" }} />
            <p style={{ fontSize: "1.1rem", fontWeight: "bold" }}>No report yet</p>
            <p className="mt-1">Select a community, granularity, and date range, then click Run Report.</p>
          </div>
        )}
      </main>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%", padding: "0.5rem", borderRadius: "0.5rem",
  border: "1px solid var(--line)", backgroundColor: "var(--bg-elev)", color: "var(--text)",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.5rem", borderRadius: "0.5rem",
  border: "1px solid var(--line)", backgroundColor: "var(--bg-elev)", color: "var(--text)",
};
