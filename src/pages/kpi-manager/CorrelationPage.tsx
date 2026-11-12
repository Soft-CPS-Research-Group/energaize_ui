import { useState, useCallback, useId } from "react";
import { fetchKpiCorrelation } from "../../api/kpiApi";
import type { CorrelationResponse } from "../../api/kpiApi";
import { Button } from "../../components/ui/Button";
import { useCommunities } from "../../hooks/useCommunities";
import { kpiDisplayName, kpiSelectOptions, useKpiMetadata, type KpiMeta } from "../../hooks/useKpiMetadata";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";
import {
  Scatter, XAxis, YAxis, Line,
  CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart,
} from "recharts";
import { Search, Loader2, ArrowRightLeft, Building2, Activity, Plus, X, ChevronDown, ChevronUp, Info } from "lucide-react";
import { KpiPageHeader } from "../../components/kpi/KpiPageHeader";
import { CommunityField, DateRangeField, KpiField, KpiFilterBar, toLocalDateString } from "../../components/kpi/KpiFilters";
import { KpiError } from "../../components/kpi/KpiStates";

// ── Helpers ───────────────────────────────────────────────────────────────────

const defaultEnd = new Date();
const defaultStart = new Date();
defaultStart.setDate(defaultStart.getDate() - 30);

/** Colour by strength only: a negative correlation is a trade-off, not a bad result. */
function strengthTone(r: number | null): string {
  if (r === null) return "kpi-text-soft";
  const absR = Math.abs(r);
  return absR >= 0.7 ? "kpi-r-strong" : absR >= 0.4 ? "kpi-r-moderate" : "kpi-text-soft";
}

function formatR(r: number | null): string {
  return r === null ? "N/A" : `${r > 0 ? "+" : ""}${r.toFixed(3)}`;
}

// ── Pearson r badge ───────────────────────────────────────────────────────────

function RBadge({ r, interpretation }: { r: number | null; interpretation: string }) {
  if (r === null) return <span className="kpi-text-soft">Insufficient data</span>;
  const absR = Math.abs(r);
  const strength = absR >= 0.7 ? "Strong" : absR >= 0.4 ? "Moderate" : "Weak";
  return (
    <div className={`kpi-r-badge ${strengthTone(r)}`}>
      <div className="kpi-r-value">
        <strong>{formatR(r)}</strong>
        <span>Pearson r</span>
      </div>
      <div className="kpi-r-verdict">
        <span className="kpi-r-pill">{strength} {r >= 0 ? "positive" : "negative"} correlation</span>
        <span className="kpi-text-soft">{interpretation.replace(/_/g, " ")}</span>
      </div>
    </div>
  );
}

// ── Custom scatter tooltip ────────────────────────────────────────────────────

function ScatterTooltip({ active, payload, labelA, labelB }: any) {
  if (!active || !payload?.length) return null;
  const { x, y, period_start } = payload[0]?.payload ?? {};
  return (
    <div className="kpi-chart-tooltip">
      {period_start && <p className="kpi-chart-tooltip-title">{period_start}</p>}
      <p><strong>{labelA}:</strong> {typeof x === "number" ? x.toFixed(4) : x}</p>
      <p><strong>{labelB}:</strong> {typeof y === "number" ? y.toFixed(4) : y}</p>
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
  startDate: toLocalDateString(defaultStart),
  endDate: toLocalDateString(defaultEnd),
  scope: "",
  loading: false, error: null, result: null,
  collapsed: false,
});

// ── Single analysis panel ─────────────────────────────────────────────────────

interface AnalysisPanelProps {
  slot: AnalysisSlot;
  kpiOptions: Array<{ value: string; label: string }>;
  scopeOptions: { value: string; label: string }[];
  kpiMeta: KpiMeta[];
  onUpdate: (id: number, patch: Partial<AnalysisSlot>) => void;
  onRun: (id: number) => void;
  onRemove: (id: number) => void;
  canRemove: boolean;
}

function AnalysisPanel({ slot, kpiOptions, scopeOptions, kpiMeta, onUpdate, onRun, onRemove, canRemove }: AnalysisPanelProps) {
  const ids = useId();
  const label = (k: string) => kpiDisplayName(kpiMeta.find((m) => m.name === k), k);

  const summaryTitle = slot.kpiA && slot.kpiB
    ? `${label(slot.kpiA)} ↔ ${label(slot.kpiB)}`
    : "New analysis";
  const r = slot.result?.pearson_r ?? null;
  const bodyId = `${ids}-body`;

  return (
    <section className="kpi-analysis" aria-label={summaryTitle}>
      <div className="kpi-analysis-bar">
        <button
          type="button"
          className="kpi-analysis-toggle"
          aria-expanded={!slot.collapsed}
          aria-controls={bodyId}
          onClick={() => onUpdate(slot.id, { collapsed: !slot.collapsed })}
        >
          <span className="kpi-analysis-title">{summaryTitle}</span>
          {slot.result && <strong className={strengthTone(r)}>r = {formatR(r)}</strong>}
          {slot.loading && <Loader2 size={14} className="animate-spin" aria-label="Analysing" />}
          {slot.collapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
        </button>
        {canRemove && (
          <Button variant="ghost" size="sm" iconOnly iconLeft={<X size={14} />} onClick={() => onRemove(slot.id)} aria-label={`Remove ${summaryTitle}`}>
            Remove
          </Button>
        )}
      </div>

      {!slot.collapsed && (
        <div className="kpi-analysis-body" id={bodyId}>
          <div className="kpi-filterbar-fields">
            <KpiField label="KPI A" hint="x-axis" icon={<Activity size={14} />} htmlFor={`${ids}-a`}>
              <select id={`${ids}-a`} value={slot.kpiA} onChange={e => onUpdate(slot.id, { kpiA: e.target.value })}>
                <option value="">Select KPI A…</option>
                {kpiOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </KpiField>
            <ArrowRightLeft size={18} className="kpi-analysis-swap" aria-hidden="true" />
            <KpiField label="KPI B" hint="y-axis" icon={<Activity size={14} />} htmlFor={`${ids}-b`}>
              <select id={`${ids}-b`} value={slot.kpiB} onChange={e => onUpdate(slot.id, { kpiB: e.target.value })}>
                <option value="">Select KPI B…</option>
                {kpiOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </KpiField>
          </div>

          <div className="kpi-filterbar-fields kpi-analysis-row">
            <KpiField label="Scope" icon={<Building2 size={14} />} size="sm" htmlFor={`${ids}-scope`}>
              <select id={`${ids}-scope`} value={slot.scope} onChange={e => onUpdate(slot.id, { scope: e.target.value })}>
                <option value="">All scopes</option>
                {scopeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </KpiField>
            <DateRangeField
              start={slot.startDate}
              end={slot.endDate}
              presets={[{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }]}
              onChange={(startDate, endDate) => onUpdate(slot.id, { startDate, endDate })}
            />
            <div className="kpi-filterbar-actions">
              <Button
                onClick={() => onRun(slot.id)}
                disabled={slot.loading}
                variant="primary"
                iconLeft={slot.loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              >
                {slot.loading ? "Analyzing…" : "Analyze"}
              </Button>
            </div>
          </div>

          {slot.error && <KpiError message={slot.error} />}

          {slot.result && !slot.loading && (
            <>
              <div className="kpi-analysis-summary">
                <div>
                  <h3>{label(slot.result.kpi_a)} ↔ {label(slot.result.kpi_b)}</h3>
                  <p className="kpi-text-soft">
                    {slot.result.point_count} matched 1-hour windows
                    {slot.result.scope ? ` · Scope: ${slot.result.scope}` : ""}
                  </p>
                </div>
                <RBadge r={slot.result.pearson_r} interpretation={slot.result.interpretation} />
              </div>

              {slot.result.data_points.length >= 2 && (
                <div className="kpi-chart-card">
                  <header className="kpi-chart-card-head">
                    <h3>{label(slot.result.kpi_a)} (x) vs {label(slot.result.kpi_b)} (y)</h3>
                    <p>Each dot is one 1-hour window · dashed line is the least-squares trend</p>
                  </header>
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart
                      data={[
                        ...slot.result.data_points.map(p => ({ ...p, type: "scatter" })),
                        ...computeTrendLine(slot.result.data_points).map(p => ({ ...p, type: "trend" })),
                      ]}
                      margin={{ top: 10, right: 20, bottom: 20, left: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis type="number" dataKey="x" name={slot.result.kpi_a}
                        label={{ value: label(slot.result.kpi_a), position: "insideBottom", offset: -10, style: { fontSize: 12, fill: "var(--text-soft)" } }}
                        tick={{ fontSize: 11, fill: "var(--text-soft)" }} />
                      <YAxis type="number" dataKey="y" name={slot.result.kpi_b}
                        label={{ value: label(slot.result.kpi_b), angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 12, fill: "var(--text-soft)" } }}
                        tick={{ fontSize: 11, fill: "var(--text-soft)" }} />
                      <Tooltip content={<ScatterTooltip labelA={label(slot.result.kpi_a)} labelB={label(slot.result.kpi_b)} />} />
                      <Scatter dataKey="y" data={slot.result.data_points} fill="var(--brand)" fillOpacity={0.6} />
                      <Line dataKey="trend" data={computeTrendLine(slot.result.data_points)} type="linear" dot={false} stroke="var(--warn)" strokeWidth={1.5} strokeDasharray="5 3" legendType="none" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CorrelationPage() {
  const { communities } = useCommunities();
  const { kpis: kpiMeta } = useKpiMetadata();

  const defaultCommunity = Object.keys(COMMUNITY_FALLBACK)[0];
  const [community, setCommunity] = useState(defaultCommunity);
  const [slots, setSlots] = useState<AnalysisSlot[]>([newSlot()]);

  const currentBuildings: string[] = communities[community] ?? COMMUNITY_FALLBACK[community] ?? [];
  const scopeOptions = [
    { value: "community", label: "Community (aggregate)" },
    ...currentBuildings.map(b => ({ value: b, label: b })),
  ];

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
    <div className="page">
      <KpiPageHeader
        title="Correlations"
        description="How two KPIs move together across 1-hour windows: spot trade-offs and synergies"
      />

      <KpiFilterBar ariaLabel="Community">
        <CommunityField communities={Object.keys(communities)} value={community} onChange={setCommunity} />
        <aside className="kpi-r-legend" aria-label="About Pearson r">
          <p><Info size={12} aria-hidden="true" /> About Pearson r</p>
          <span><strong className="kpi-r-strong">|r| ≥ 0.7</strong> strong · </span>
          <span><strong className="kpi-r-moderate">0.4 ≤ |r| &lt; 0.7</strong> moderate · </span>
          <span><strong className="kpi-text-soft">|r| &lt; 0.4</strong> weak</span>
          <br />
          <span>Positive r: the KPIs rise together. Negative r: a trade-off.</span>
        </aside>
      </KpiFilterBar>

      <div className="kpi-results">
        {slots.map(slot => (
          <AnalysisPanel
            key={slot.id}
            slot={slot}
            kpiOptions={kpiSelectOptions(kpiMeta)}
            scopeOptions={scopeOptions}
            kpiMeta={kpiMeta}
            onUpdate={updateSlot}
            onRun={runSlot}
            onRemove={removeSlot}
            canRemove={slots.length > 1}
          />
        ))}
      </div>

      <div>
        <Button variant="secondary" iconLeft={<Plus size={16} />} onClick={addSlot}>Add another analysis</Button>
      </div>
    </div>
  );
}
