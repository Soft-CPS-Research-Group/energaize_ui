import React, { useState, useCallback } from "react";
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
  MapPin, Building2, Calendar, Activity, Plus, X, ChevronDown, ChevronUp, Info,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

const getLocalDateString = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];

const defaultEnd = new Date();
const defaultStart = new Date();
defaultStart.setDate(defaultStart.getDate() - 30);

// ── Pearson r badge ───────────────────────────────────────────────────────────

function RBadge({ r, interpretation }: { r: number | null; interpretation: string }) {
  if (r === null) return <span style={{ fontSize: "14px", color: "var(--text-soft)" }}>Insufficient data</span>;
  const isPositive = r >= 0;
  const absR = Math.abs(r);
  const strength = absR >= 0.7 ? "Strong" : absR >= 0.4 ? "Moderate" : "Weak";
  const color = absR >= 0.7 ? (isPositive ? "#16a34a" : "#dc2626") : absR >= 0.4 ? (isPositive ? "#65a30d" : "#ea580c") : "#6b7280";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "3rem", fontWeight: 700, color, lineHeight: 1 }}>
          {r > 0 ? "+" : ""}{r.toFixed(3)}
        </div>
        <div style={{ fontSize: "12px", color: "var(--text-soft)", marginTop: "4px" }}>Pearson r</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 12px", borderRadius: "9999px", fontSize: "13px", fontWeight: 600, color, border: `1px solid ${color}40`, background: `${color}12` }}>
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
    <div style={{ backgroundColor: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", color: "var(--text)", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}>
      {period_start && <p style={{ margin: "0 0 4px 0", color: "var(--text-soft)", fontSize: "11px" }}>{period_start}</p>}
      <p style={{ margin: "0 0 2px 0" }}><span style={{ fontWeight: 600 }}>{kpiA?.replace("KPI", "")}:</span> {typeof x === "number" ? x.toFixed(4) : x}</p>
      <p style={{ margin: 0 }}><span style={{ fontWeight: 600 }}>{kpiB?.replace("KPI", "")}:</span> {typeof y === "number" ? y.toFixed(4) : y}</p>
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
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  return [{ x: minX, trend: slope * minX + intercept }, { x: maxX, trend: slope * maxX + intercept }];
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnalysisSlot {
  id: number;
  kpiA: string;
  kpiB: string;
  startDate: string;
  endDate: string;
  scope: string;
  loading: boolean;
  error: string | null;
  result: CorrelationResponse | null;
  collapsed: boolean; // collapsed = form hidden, summary shown
}

let _nextId = 1;
const newSlot = (): AnalysisSlot => ({
  id: _nextId++,
  kpiA: "", kpiB: "",
  startDate: getLocalDateString(defaultStart),
  endDate: getLocalDateString(defaultEnd),
  scope: "",
  loading: false, error: null, result: null,
  collapsed: false,
});

// ── Single analysis panel ─────────────────────────────────────────────────────

interface AnalysisPanelProps {
  slot: AnalysisSlot;
  community: string;
  scheduledKpis: string[];
  scopeOptions: { value: string; label: string }[];
  kpiMeta: any[];
  inputStyle: React.CSSProperties;
  onUpdate: (id: number, patch: Partial<AnalysisSlot>) => void;
  onRun: (id: number) => void;
  onRemove: (id: number) => void;
  canRemove: boolean;
}

function AnalysisPanel({ slot, scheduledKpis, scopeOptions, kpiMeta, inputStyle, onUpdate, onRun, onRemove, canRemove }: AnalysisPanelProps) {
  const label = (k: string) => {
    const m = kpiMeta.find((x: any) => x.name === k);
    return (m?.display_name || k).replace("KPI", "").trim();
  };

  const summaryTitle = slot.kpiA && slot.kpiB
    ? `${label(slot.kpiA)} ↔ ${label(slot.kpiB)}`
    : "New analysis";

  const r = slot.result?.pearson_r ?? null;
  const absR = r !== null ? Math.abs(r) : null;
  const rColor = absR === null ? "var(--text-soft)" : absR >= 0.7 ? (r! > 0 ? "#16a34a" : "#dc2626") : absR >= 0.4 ? (r! > 0 ? "#65a30d" : "#ea580c") : "#6b7280";

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: "12px", overflow: "hidden", backgroundColor: "var(--bg-elev)", boxShadow: "var(--shadow)" }}>
      {/* ── Panel header / collapse bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderBottom: slot.collapsed ? "none" : "1px solid var(--line)", backgroundColor: "var(--bg-elev-2)", cursor: "pointer" }}
        onClick={() => onUpdate(slot.id, { collapsed: !slot.collapsed })}>
        <span style={{ flex: 1, fontWeight: 600, fontSize: "0.875rem" }}>{summaryTitle}</span>
        {slot.result && (
          <span style={{ fontSize: "0.85rem", fontWeight: 700, color: rColor }}>
            {r === null ? "r = N/A" : `r = ${r > 0 ? "+" : ""}${r.toFixed(3)}`}
          </span>
        )}
        {slot.loading && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
        {slot.collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        {canRemove && (
          <button
            onClick={e => { e.stopPropagation(); onRemove(slot.id); }}
            title="Remove"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-soft)", padding: "2px", borderRadius: "4px", display: "flex", alignItems: "center" }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── Expanded form + result ── */}
      {!slot.collapsed && (
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* KPI A ↔ KPI B */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-end" }}>
            <div style={{ flex: "2 1 0%", minWidth: "200px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Activity size={15} /> KPI A <span style={{ fontWeight: 400, color: "var(--text-soft)" }}>(x-axis)</span>
              </label>
              <select style={inputStyle} value={slot.kpiA} onChange={e => onUpdate(slot.id, { kpiA: e.target.value })}>
                <option value="">Select KPI A…</option>
                {scheduledKpis.map(k => <option key={k} value={k}>{k.replace("KPI", "")}</option>)}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", paddingBottom: "8px" }}>
              <ArrowRightLeft size={18} style={{ color: "var(--text-soft)" }} />
            </div>

            <div style={{ flex: "2 1 0%", minWidth: "200px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Activity size={15} /> KPI B <span style={{ fontWeight: 400, color: "var(--text-soft)" }}>(y-axis)</span>
              </label>
              <select style={inputStyle} value={slot.kpiB} onChange={e => onUpdate(slot.id, { kpiB: e.target.value })}>
                <option value="">Select KPI B…</option>
                {scheduledKpis.map(k => <option key={k} value={k}>{k.replace("KPI", "")}</option>)}
              </select>
            </div>
          </div>

          {/* Scope + dates + run */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-end", borderTop: "1px solid var(--line)", paddingTop: "16px" }}>
            <div style={{ flex: "1 1 160px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Building2 size={14} /> Scope
              </label>
              <select style={inputStyle} value={slot.scope} onChange={e => onUpdate(slot.id, { scope: e.target.value })}>
                <option value="">All scopes</option>
                {scopeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 130px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Calendar size={14} /> Start
              </label>
              <input type="date" value={slot.startDate} onChange={e => onUpdate(slot.id, { startDate: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ flex: "1 1 130px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Calendar size={14} /> End
              </label>
              <input type="date" value={slot.endDate} onChange={e => onUpdate(slot.id, { endDate: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ marginLeft: "auto" }}>
              <Button onClick={() => onRun(slot.id)} disabled={slot.loading} variant="primary">
                {slot.loading
                  ? <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Analysing…</span>
                  : <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><Search size={16} /> Analyse</span>}
              </Button>
            </div>
          </div>

          {/* Error */}
          {slot.error && (
            <div style={{ backgroundColor: "rgba(220,38,38,0.1)", color: "#ef4444", padding: "12px 16px", borderRadius: "8px", border: "1px solid rgba(220,38,38,0.2)", display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} /> {slot.error}
            </div>
          )}

          {/* Result */}
          {slot.result && !slot.loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Summary card */}
              <Card>
                <CardHeader>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
                    <div>
                      <CardTitle>{slot.result.kpi_a.replace("KPI", "")} ↔ {slot.result.kpi_b.replace("KPI", "")}</CardTitle>
                      <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--text-soft)" }}>
                        {slot.result.point_count} matched 1-hour windows
                        {slot.result.scope ? ` · Scope: ${slot.result.scope}` : ""}
                      </p>
                    </div>
                    <RBadge r={slot.result.pearson_r} interpretation={slot.result.interpretation} />
                  </div>
                </CardHeader>
              </Card>

              {/* Scatter + trend */}
              {slot.result.data_points.length >= 2 && (
                <Card>
                  <CardHeader>
                    <CardTitle style={{ fontSize: "14px" }}>
                      Scatter: {slot.result.kpi_a.replace("KPI", "")} (x) vs {slot.result.kpi_b.replace("KPI", "")} (y)
                    </CardTitle>
                    <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--text-soft)" }}>
                      Each dot = one 1-hour window · Dashed = OLS trend line
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div style={{ height: "320px" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={[
                            ...slot.result.data_points.map(p => ({ ...p, type: "scatter" })),
                            ...computeTrendLine(slot.result.data_points).map(p => ({ ...p, type: "trend" })),
                          ]}
                          margin={{ top: 10, right: 20, bottom: 20, left: 10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" dataKey="x" name={slot.result.kpi_a}
                            label={{ value: slot.result.kpi_a.replace("KPI", ""), position: "insideBottom", offset: -10, style: { fontSize: "12px", fill: "var(--text-soft)" } }}
                            style={{ fontSize: "11px" }} />
                          <YAxis type="number" dataKey="y" name={slot.result.kpi_b}
                            label={{ value: slot.result.kpi_b.replace("KPI", ""), angle: -90, position: "insideLeft", offset: 10, style: { fontSize: "12px", fill: "var(--text-soft)" } }}
                            style={{ fontSize: "11px" }} />
                          <Tooltip content={<ScatterTooltip kpiA={slot.result.kpi_a} kpiB={slot.result.kpi_b} />} />
                          <Scatter dataKey="y" data={slot.result.data_points} fill="var(--brand)" fillOpacity={0.6} />
                          <Line dataKey="trend" data={computeTrendLine(slot.result.data_points)} type="linear" dot={false} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 3" legendType="none" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CorrelationPage() {
  const { communities } = useCommunities();
  const { kpis: kpiMeta } = useKpiMetadata();

  const defaultCommunity = Object.keys(COMMUNITY_FALLBACK)[0];
  const [community, setCommunity] = useState(defaultCommunity);
  const [slots, setSlots] = useState<AnalysisSlot[]>([newSlot()]);

  const scheduledKpis = kpiMeta
    .filter((k: any) => k.status === "available" && k.registered)
    .map((k: any) => k.name as string);

  const currentBuildings: string[] = communities[community] ?? COMMUNITY_FALLBACK[community] ?? [];
  const scopeOptions = [
    { value: "community", label: "Community (aggregate)" },
    ...currentBuildings.map(b => ({ value: b, label: b })),
  ];

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px",
    border: "1px solid var(--line)", borderRadius: "8px",
    fontSize: "14px", outline: "none",
    backgroundColor: "var(--bg-elev)", color: "var(--text)",
  };

  const updateSlot = useCallback((id: number, patch: Partial<AnalysisSlot>) => {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }, []);

  const removeSlot = useCallback((id: number) => {
    setSlots(prev => prev.filter(s => s.id !== id));
  }, []);

  const runSlot = useCallback(async (id: number) => {
    const slot = slots.find(s => s.id === id);
    if (!slot) return;
    if (!slot.kpiA || !slot.kpiB) { updateSlot(id, { error: "Select both KPIs." }); return; }
    if (slot.kpiA === slot.kpiB) { updateSlot(id, { error: "Select two different KPIs." }); return; }
    updateSlot(id, { loading: true, error: null, result: null });
    try {
      const res = await fetchKpiCorrelation({
        community,
        kpiA: slot.kpiA,
        kpiB: slot.kpiB,
        startDate: new Date(slot.startDate).toISOString(),
        endDate: new Date(slot.endDate).toISOString(),
        scope: slot.scope || undefined,
      });
      updateSlot(id, { result: res, loading: false, collapsed: false });
    } catch (e: any) {
      updateSlot(id, { error: e?.response?.data?.detail || e?.message || "Analysis failed", loading: false });
    }
  }, [slots, community, updateSlot]);

  const addSlot = () => {
    // Collapse all existing slots that have results
    setSlots(prev => [
      ...prev.map(s => s.result ? { ...s, collapsed: true } : s),
      newSlot(),
    ]);
  };

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header className="jobs-hero">
        <div>
          <h1>KPI Correlations</h1>
          <p>Analyse how two KPIs move together across 1-hour windows — spot trade-offs and synergies</p>
        </div>
      </header>

      <div className="page-inner" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px", flex: 1, backgroundColor: "var(--bg)", paddingBottom: "6rem" }}>

        {/* ── Global filters ── */}
        <div style={{ backgroundColor: "var(--bg-elev)", padding: "16px 20px", borderRadius: "12px", border: "1px solid var(--line)", boxShadow: "var(--shadow)", display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 180px" }}>
            <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
              <MapPin size={15} /> Community
            </label>
            <select style={inputStyle} value={community} onChange={e => setCommunity(e.target.value)}>
              {Object.keys(communities).map(c => (
                <option key={c} value={c}>{c.replace(/_/g, " ").toUpperCase()}</option>
              ))}
            </select>
          </div>

          {/* Pearson explanation inline */}
          <div style={{ flex: "2 1 320px", fontSize: "12px", color: "var(--text-soft)", borderLeft: "1px solid var(--line)", paddingLeft: "16px", lineHeight: 1.6 }}>
            <p style={{ margin: "0 0 4px 0", fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: "4px" }}>
              <Info size={12} /> About Pearson r
            </p>
            <span><strong style={{ color: "#16a34a" }}>|r| ≥ 0.7</strong> Strong · </span>
            <span><strong style={{ color: "#65a30d" }}>0.4 ≤ |r| &lt; 0.7</strong> Moderate · </span>
            <span><strong style={{ color: "#6b7280" }}>|r| &lt; 0.4</strong> Weak</span>
            <br />
            <span>Positive r → both improve together. Negative r → trade-off.</span>
          </div>
        </div>

        {/* ── Analysis slots ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {slots.map(slot => (
            <AnalysisPanel
              key={slot.id}
              slot={slot}
              community={community}
              scheduledKpis={scheduledKpis}
              scopeOptions={scopeOptions}
              kpiMeta={kpiMeta}
              inputStyle={inputStyle}
              onUpdate={updateSlot}
              onRun={runSlot}
              onRemove={removeSlot}
              canRemove={slots.length > 1}
            />
          ))}
        </div>

        {/* ── Add analysis button ── */}
        <div>
          <button
            onClick={addSlot}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "8px 18px", borderRadius: "8px", cursor: "pointer",
              border: "1px dashed var(--line)", background: "transparent",
              color: "var(--text-soft)", fontSize: "14px", fontWeight: 500,
              transition: "all 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--brand)", e.currentTarget.style.color = "var(--brand)")}
            onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--line)", e.currentTarget.style.color = "var(--text-soft)")}
          >
            <Plus size={16} /> Add another analysis
          </button>
        </div>


      </div>
    </div>
  );
}
