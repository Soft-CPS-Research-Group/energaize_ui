import React, { useState } from "react";
import { fetchKpiCorrelation } from "../../api/kpiApi";
import type { CorrelationResponse } from "../../api/kpiApi";
import { Button } from "../../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/KpiCard";
import { useCommunities } from "../../hooks/useCommunities";
import { useKpiMetadata } from "../../hooks/useKpiMetadata";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";
import {
  Scatter, XAxis, YAxis, Line,
  CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart,
} from "recharts";
import {
  Search, Loader2, AlertCircle, ArrowRightLeft,
  MapPin, Building2, Calendar, Activity, Info,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

const getLocalDateString = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];

const defaultEnd = new Date();
const defaultStart = new Date();
defaultStart.setDate(defaultStart.getDate() - 30);

// ── Pearson r badge ───────────────────────────────────────────────────────────

function RBadge({ r, interpretation }: { r: number | null; interpretation: string }) {
  if (r === null) {
    return (
      <span style={{ fontSize: "14px", color: "var(--text-soft)" }}>
        Insufficient data
      </span>
    );
  }

  const isPositive = r >= 0;
  const absR = Math.abs(r);
  const strength = absR >= 0.7 ? "Strong" : absR >= 0.4 ? "Moderate" : "Weak";
  const color =
    absR >= 0.7
      ? isPositive ? "#16a34a" : "#dc2626"
      : absR >= 0.4
      ? isPositive ? "#65a30d" : "#ea580c"
      : "#6b7280";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "3rem", fontWeight: 700, color, lineHeight: 1 }}>
          {r > 0 ? "+" : ""}{r.toFixed(3)}
        </div>
        <div style={{ fontSize: "12px", color: "var(--text-soft)", marginTop: "4px" }}>
          Pearson r
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: "6px",
          padding: "4px 12px", borderRadius: "9999px", fontSize: "13px", fontWeight: 600,
          color, border: `1px solid ${color}40`, background: `${color}12`,
        }}>
          {strength} {isPositive ? "positive" : "negative"} correlation
        </span>
        <span style={{ fontSize: "12px", color: "var(--text-soft)", paddingLeft: "12px" }}>
          {interpretation.replace(/_/g, " ")}
        </span>
      </div>
    </div>
  );
}

// ── Custom scatter tooltip ────────────────────────────────────────────────────

function ScatterTooltip({ active, payload, kpiA, kpiB }: any) {
  if (!active || !payload?.length) return null;
  const { x, y, period_start } = payload[0]?.payload ?? {};
  return (
    <div style={{
      backgroundColor: "var(--bg-elev)", border: "1px solid var(--line)",
      borderRadius: "8px", padding: "8px 12px", fontSize: "12px",
      color: "var(--text)", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
    }}>
      {period_start && (
        <p style={{ margin: "0 0 4px 0", color: "var(--text-soft)", fontSize: "11px" }}>
          {period_start}
        </p>
      )}
      <p style={{ margin: "0 0 2px 0" }}>
        <span style={{ fontWeight: 600 }}>{kpiA?.replace("KPI", "")}:</span>{" "}
        {typeof x === "number" ? x.toFixed(4) : x}
      </p>
      <p style={{ margin: 0 }}>
        <span style={{ fontWeight: 600 }}>{kpiB?.replace("KPI", "")}:</span>{" "}
        {typeof y === "number" ? y.toFixed(4) : y}
      </p>
    </div>
  );
}

// ── Linear regression trend line ─────────────────────────────────────────────

function computeTrendLine(points: Array<{ x: number; y: number }>) {
  const n = points.length;
  if (n < 2) return [];
  const sumX  = points.reduce((a, p) => a + p.x, 0);
  const sumY  = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumX2 = points.reduce((a, p) => a + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return [];
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const xs = points.map(p => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return [
    { x: minX, trend: slope * minX + intercept },
    { x: maxX, trend: slope * maxX + intercept },
  ];
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CorrelationPage() {
  const { communities } = useCommunities();
  const { kpis: kpiMeta } = useKpiMetadata();

  const defaultCommunity = Object.keys(COMMUNITY_FALLBACK)[0];
  const [community, setCommunity] = useState(defaultCommunity);
  const [kpiA, setKpiA] = useState("");
  const [kpiB, setKpiB] = useState("");
  const [startDate, setStartDate] = useState(getLocalDateString(defaultStart));
  const [endDate, setEndDate]     = useState(getLocalDateString(defaultEnd));
  const [scope, setScope]         = useState<string>("");

  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [result,   setResult]   = useState<CorrelationResponse | null>(null);

  const scheduledKpis = kpiMeta
    .filter((k: any) => k.status === "available" && k.registered)
    .map((k: any) => k.name as string);

  const currentBuildings: string[] = communities[community] ?? COMMUNITY_FALLBACK[community] ?? [];
  const scopeOptions = [
    { value: "community", label: "Community (aggregate scope)" },
    ...currentBuildings.map(b => ({ value: b, label: b })),
  ];

  const handleAnalyse = async () => {
    if (!kpiA || !kpiB) { setError("Select both KPIs."); return; }
    if (kpiA === kpiB)  { setError("Select two different KPIs."); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetchKpiCorrelation({
        community,
        kpiA,
        kpiB,
        startDate: new Date(startDate).toISOString(),
        endDate:   new Date(endDate).toISOString(),
        scope:     scope || undefined,
      });
      setResult(res);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Correlation analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px",
    border: "1px solid var(--line)", borderRadius: "8px",
    fontSize: "14px", outline: "none",
    backgroundColor: "var(--bg-elev)", color: "var(--text)",
  };

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <header className="jobs-hero">
        <div>
          <h1>KPI Correlations</h1>
          <p>Analyse how two KPIs move together across 1-hour windows, spot trade-offs and synergies</p>
        </div>
      </header>

      <div className="page-inner" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "24px", flex: 1, backgroundColor: "var(--bg)", paddingBottom: "3rem" }}>


        {/* ── Filter panel ── */}
        <div style={{ backgroundColor: "var(--bg-elev)", padding: "20px", borderRadius: "12px", border: "1px solid var(--line)", boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Row 1: community + scope */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 0%", minWidth: "180px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <MapPin size={15} /> Community
              </label>
              <select style={inputStyle} value={community} onChange={e => { setCommunity(e.target.value); setScope(""); }}>
                {Object.keys(communities).map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, " ").toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: "1 1 0%", minWidth: "180px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Building2 size={15} /> Scope
              </label>
              <select style={inputStyle} value={scope} onChange={e => setScope(e.target.value)}>
                <option value="">All scopes</option>
                {scopeOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: KPI A ↔ KPI B */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-end" }}>
            <div style={{ flex: "2 1 0%", minWidth: "200px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Activity size={15} /> KPI A  <span style={{ fontWeight: 400, color: "var(--text-soft)" }}>(x-axis)</span>
              </label>
              <select style={inputStyle} value={kpiA} onChange={e => setKpiA(e.target.value)}>
                <option value="">Select KPI A…</option>
                {scheduledKpis.map((k: string) => (
                  <option key={k} value={k}>{k.replace("KPI", "")}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", paddingBottom: "8px" }}>
              <ArrowRightLeft size={18} style={{ color: "var(--text-soft)" }} />
            </div>

            <div style={{ flex: "2 1 0%", minWidth: "200px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Activity size={15} /> KPI B  <span style={{ fontWeight: 400, color: "var(--text-soft)" }}>(y-axis)</span>
              </label>
              <select style={inputStyle} value={kpiB} onChange={e => setKpiB(e.target.value)}>
                <option value="">Select KPI B…</option>
                {scheduledKpis.map((k: string) => (
                  <option key={k} value={k}>{k.replace("KPI", "")}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 3: dates + run */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-end", borderTop: "1px solid var(--line)", paddingTop: "16px" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Calendar size={14} /> Start
              </label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Calendar size={14} /> End
              </label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginLeft: "auto" }}>
              <Button
                onClick={handleAnalyse}
                disabled={loading}
                variant="primary"
              >
                {loading
                  ? <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><Loader2 size={16} className="animate-spin" /> Analysing…</span>
                  : <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><Search size={16} /> Analyse</span>}
              </Button>
            </div>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div style={{ backgroundColor: "var(--error-bg, rgba(220,38,38,0.1))", color: "var(--error-text, #ef4444)", padding: "16px", borderRadius: "8px", border: "1px solid var(--error-border, rgba(220,38,38,0.2))", display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={20} style={{ flexShrink: 0 }} />
            <p style={{ margin: 0 }}>{error}</p>
          </div>
        )}

        {/* ── Results ── */}
        {result && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

            {/* Summary card */}
            <Card>
              <CardHeader>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
                  <div>
                    <CardTitle>
                      {result.kpi_a.replace("KPI", "")}
                      {" "}↔{" "}
                      {result.kpi_b.replace("KPI", "")}
                    </CardTitle>
                    <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--text-soft)" }}>
                      {result.point_count} matched windows
                      {result.scope ? ` · Scope: ${result.scope}` : ""}
                    </p>
                  </div>
                  <RBadge r={result.pearson_r} interpretation={result.interpretation} />
                </div>
              </CardHeader>
            </Card>

            {/* Scatter plot with trend line */}
            {result.data_points.length >= 2 && (
              <Card style={{ gridColumn: "1 / -1" }}>
                <CardHeader>
                  <CardTitle style={{ fontSize: "14px" }}>
                    Scatter: {result.kpi_a.replace("KPI", "")} (x) vs {result.kpi_b.replace("KPI", "")} (y)
                  </CardTitle>
                  <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--text-soft)" }}>
                    Each dot = one 1-hour computation window · Dashed line = linear trend. Hover for details.
                  </p>
                </CardHeader>
                <CardContent>
                  <div style={{ height: "360px" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={[
                          ...result.data_points.map(p => ({ ...p, type: "scatter" })),
                          ...computeTrendLine(result.data_points).map(p => ({ ...p, type: "trend" })),
                        ]}
                        margin={{ top: 10, right: 20, bottom: 20, left: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          type="number"
                          dataKey="x"
                          name={result.kpi_a}
                          label={{ value: result.kpi_a.replace("KPI", ""), position: "insideBottom", offset: -10, style: { fontSize: "12px", fill: "var(--text-soft)" } }}
                          style={{ fontSize: "11px" }}
                        />
                        <YAxis
                          type="number"
                          dataKey="y"
                          name={result.kpi_b}
                          label={{ value: result.kpi_b.replace("KPI", ""), angle: -90, position: "insideLeft", offset: 10, style: { fontSize: "12px", fill: "var(--text-soft)" } }}
                          style={{ fontSize: "11px" }}
                        />
                        <Tooltip
                          content={
                            <ScatterTooltip kpiA={result.kpi_a} kpiB={result.kpi_b} />
                          }
                        />
                        <Scatter
                          dataKey="y"
                          data={result.data_points}
                          fill="var(--brand)"
                          fillOpacity={0.6}
                        />
                        <Line
                          dataKey="trend"
                          data={computeTrendLine(result.data_points)}
                          type="linear"
                          dot={false}
                          stroke="#ef4444"
                          strokeWidth={1.5}
                          strokeDasharray="5 3"
                          legendType="none"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Interpretation guide */}
            <div style={{ backgroundColor: "var(--bg-elev)", borderRadius: "12px", border: "1px solid var(--line)", padding: "16px", fontSize: "13px", color: "var(--text-soft)" }}>
              <p style={{ margin: "0 0 8px 0", fontWeight: 600, color: "var(--text)" }}>Reading the chart</p>
              <ul style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <li><strong>r ≥ +0.7</strong> — Strong positive: both KPIs improve together</li>
                <li><strong>r ≤ −0.7</strong> — Strong negative (trade-off): improving one tends to worsen the other</li>
                <li><strong>|r| &lt; 0.4</strong> — Weak: the two KPIs are largely independent</li>
              </ul>
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !result && !error && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-soft)", padding: "48px", backgroundColor: "var(--bg-elev)", borderRadius: "12px", border: "1px dashed var(--line)" }}>
            <ArrowRightLeft size={48} style={{ marginBottom: "16px", color: "var(--line)" }} />
            <p style={{ fontSize: "16px", fontWeight: 500, color: "var(--text-soft)", margin: "0 0 4px 0" }}>Select two KPIs and click Analyse</p>
            <p style={{ fontSize: "14px", margin: 0 }}>
              Correlations are computed on stored 1-hour windows — no recomputation needed.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
