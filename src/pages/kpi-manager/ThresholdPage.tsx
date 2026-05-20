import { useState, useEffect, useCallback } from "react";
import { Button } from "../../components/ui/Button";
import {
  Plus, Trash2, Edit2, X, Loader2, AlertCircle,
  ShieldAlert, AlertTriangle, Info, RefreshCw,
  Bell, BellOff, CheckCircle, History, SlidersHorizontal,
} from "lucide-react";
import { api as axios } from "../../api/kpiApi";
import { useCommunities } from "../../hooks/useCommunities";
import { useKpiMetadata } from "../../hooks/useKpiMetadata";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Threshold {
  community: string;
  kpi: string;
  scope: string;
  condition: "gt" | "gte" | "lt" | "lte";
  threshold: number;
  severity: "info" | "warning" | "critical";
  message: string;
  enabled: boolean;
}

const EMPTY_FORM: Omit<Threshold, "community"> = {
  kpi: "",
  scope: "*",
  condition: "gt",
  threshold: 0,
  severity: "warning",
  message: "",
  enabled: true,
};

const CONDITION_LABELS: Record<string, string> = {
  gt: "> (greater than)",
  gte: "≥ (greater than or equal)",
  lt: "< (less than)",
  lte: "≤ (less than or equal)",
};

const SEVERITY_CONFIG = {
  critical: { color: "#ef4444", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.30)", Icon: ShieldAlert },
  warning:  { color: "#f59e0b", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.30)", Icon: AlertTriangle },
  info:     { color: "#3b82f6", bg: "rgba(59,130,246,0.10)",  border: "rgba(59,130,246,0.30)",  Icon: Info },
} as const;

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.5rem 0.75rem", borderRadius: "0.5rem",
  border: "1px solid var(--line)", background: "var(--bg)", color: "var(--text)",
  fontSize: "0.875rem", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.78rem", fontWeight: 600,
  color: "var(--text-soft)", marginBottom: "0.35rem",
};
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
  zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
};
const modalStyle: React.CSSProperties = {
  background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "1rem",
  padding: "1.5rem", width: "min(560px, 95vw)", maxHeight: "90vh",
  overflowY: "auto", display: "flex", flexDirection: "column", gap: "1.25rem",
  boxShadow: "0 25px 60px rgba(0,0,0,0.4)",
};

// ── Threshold Form Modal ───────────────────────────────────────────────────────

function ThresholdModal({
  initial,
  community: _community,
  availableKpis,
  onClose,
  onSave,
  isEdit,
}: {
  initial: Omit<Threshold, "community">;
  community: string;
  availableKpis: string[];
  onClose: () => void;
  onSave: (data: Omit<Threshold, "community">) => Promise<void>;
  isEdit: boolean;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setErr(null);
    if (!form.kpi) { setErr("Select a KPI"); return; }
    if (isNaN(form.threshold)) { setErr("Threshold must be a number"); return; }
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch (e: any) { setErr(e?.response?.data?.detail || e?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
            {isEdit ? "Edit Threshold" : "New Alert Threshold"}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-soft)" }}>
            <X size={20} />
          </button>
        </div>

        {/* KPI */}
        <div>
          <label style={labelStyle}>KPI *</label>
          <select
            style={inputStyle}
            value={form.kpi}
            disabled={isEdit}
            onChange={e => setForm(f => ({ ...f, kpi: e.target.value }))}
          >
            <option value="">— select a KPI —</option>
            {availableKpis.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          {isEdit && <p style={{ fontSize: "0.72rem", color: "var(--text-soft)", marginTop: "0.25rem" }}>KPI cannot be changed after creation</p>}
        </div>

        {/* Scope */}
        <div>
          <label style={labelStyle}>Scope</label>
          <input
            style={inputStyle}
            value={form.scope}
            placeholder="* (all scopes) or a specific building ID"
            onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}
          />
          <p style={{ fontSize: "0.72rem", color: "var(--text-soft)", marginTop: "0.25rem" }}>
            Use <code>*</code> to match any scope/building, or enter a specific building ID.
          </p>
        </div>

        {/* Condition + Threshold row */}
        <div style={{ display: "flex", gap: "1rem" }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Condition *</label>
            <select
              style={inputStyle}
              value={form.condition}
              onChange={e => setForm(f => ({ ...f, condition: e.target.value as any }))}
            >
              {Object.entries(CONDITION_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Threshold value *</label>
            <input
              type="number" step="any"
              style={inputStyle}
              value={form.threshold}
              onChange={e => setForm(f => ({ ...f, threshold: parseFloat(e.target.value) }))}
            />
          </div>
        </div>

        {/* Severity */}
        <div>
          <label style={labelStyle}>Severity *</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {(["info", "warning", "critical"] as const).map(s => {
              const cfg = SEVERITY_CONFIG[s];
              const active = form.severity === s;
              return (
                <button
                  key={s}
                  onClick={() => setForm(f => ({ ...f, severity: s }))}
                  style={{
                    flex: 1, padding: "0.45rem", borderRadius: "0.5rem", cursor: "pointer",
                    border: `1px solid ${active ? cfg.color : "var(--line)"}`,
                    background: active ? cfg.bg : "transparent",
                    color: active ? cfg.color : "var(--text-soft)",
                    fontWeight: active ? 700 : 400, fontSize: "0.82rem",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem",
                    transition: "all 0.15s",
                  }}
                >
                  <cfg.Icon size={13} />{s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Message */}
        <div>
          <label style={labelStyle}>Alert message (optional)</label>
          <input
            style={inputStyle}
            value={form.message}
            placeholder="e.g. Energy cost too high — check grid import"
            onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
          />
        </div>

        {/* Enabled toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
            style={{
              padding: "0.3rem 0.9rem", borderRadius: "9999px", cursor: "pointer",
              border: `1px solid ${form.enabled ? "#22c55e" : "var(--line)"}`,
              background: form.enabled ? "rgba(34,197,94,0.12)" : "transparent",
              color: form.enabled ? "#22c55e" : "var(--text-soft)",
              fontWeight: 600, fontSize: "0.8rem",
              display: "flex", alignItems: "center", gap: "0.35rem",
            }}
          >
            {form.enabled ? <><Bell size={12} /> Enabled</> : <><BellOff size={12} /> Disabled</>}
          </button>
          <span style={{ fontSize: "0.75rem", color: "var(--text-soft)" }}>
            Disabled thresholds are saved but not evaluated by the scheduler.
          </span>
        </div>

        {/* Preview */}
        <div style={{
          padding: "0.75rem 1rem", borderRadius: "0.5rem",
          background: "var(--bg)", border: "1px solid var(--line)",
          fontSize: "0.8rem", color: "var(--text-soft)",
        }}>
          <strong>Preview:</strong> Trigger alert when{" "}
          <code style={{ background: "var(--bg-elev)", padding: "0 0.3rem", borderRadius: "0.25rem" }}>{form.kpi || "..."}</code>{" "}
          [{form.scope}] is{" "}
          <strong>{form.condition}</strong> {form.threshold} →{" "}
          <span style={{ color: SEVERITY_CONFIG[form.severity]?.color }}>{form.severity}</span>
        </div>

        {err && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", color: "#ef4444", fontSize: "0.82rem" }}>
            <AlertCircle size={14} /> {err}
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
            {" "}{isEdit ? "Save changes" : "Create threshold"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Threshold Row Card ────────────────────────────────────────────────────────

function ThresholdCard({
  t,
  onEdit,
  onDelete,
  onToggle,
}: {
  t: Threshold;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const cfg = SEVERITY_CONFIG[t.severity] ?? SEVERITY_CONFIG.info;
  const { Icon } = cfg;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "1rem",
      padding: "0.875rem 1.1rem",
      background: "var(--bg-elev)", border: "1px solid var(--line)",
      borderLeft: `3px solid ${t.enabled ? cfg.color : "var(--line)"}`,
      borderRadius: "0.6rem",
      opacity: t.enabled ? 1 : 0.55,
      transition: "opacity 0.15s",
    }}>
      <Icon size={16} color={t.enabled ? cfg.color : "var(--text-muted)"} style={{ flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{t.kpi}</span>
          <span style={{ fontSize: "0.72rem", fontFamily: "monospace", background: "var(--bg)", padding: "0.1rem 0.4rem", borderRadius: "0.25rem" }}>
            scope: {t.scope}
          </span>
          <span style={{
            fontSize: "0.68rem", fontWeight: 700, padding: "0.1rem 0.45rem",
            borderRadius: "0.3rem", border: `1px solid ${cfg.border}`,
            background: cfg.bg, color: cfg.color, textTransform: "uppercase",
          }}>
            {t.severity}
          </span>
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
          Trigger when value{" "}
          <strong>{CONDITION_LABELS[t.condition]?.split(" ")[0] ?? t.condition}</strong>{" "}
          <strong style={{ color: cfg.color }}>{t.threshold}</strong>
          {t.message && <> — <em>{t.message}</em></>}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
        <button
          title={t.enabled ? "Disable" : "Enable"}
          onClick={onToggle}
          style={{
            background: "none", border: `1px solid var(--line)`, cursor: "pointer",
            borderRadius: "0.4rem", padding: "0.3rem 0.5rem",
            color: t.enabled ? "#22c55e" : "var(--text-muted)",
          }}
        >
          {t.enabled ? <Bell size={14} /> : <BellOff size={14} />}
        </button>
        <button
          title="Edit"
          onClick={onEdit}
          style={{ background: "none", border: "1px solid var(--line)", cursor: "pointer", borderRadius: "0.4rem", padding: "0.3rem 0.5rem", color: "var(--text-soft)" }}
        >
          <Edit2 size={14} />
        </button>
        <button
          title="Delete"
          onClick={onDelete}
          style={{ background: "none", border: "1px solid rgba(239,68,68,0.3)", cursor: "pointer", borderRadius: "0.4rem", padding: "0.3rem 0.5rem", color: "#ef4444" }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Alert History Tab ────────────────────────────────────────────────────────

interface AlertDoc {
  community: string;
  kpi: string;
  scope: string;
  value: number;
  threshold: number;
  condition: string;
  severity: "info" | "warning" | "critical";
  message: string;
  triggered_at: string;
}

function AlertHistoryTab({ community, availableKpis }: { community: string; availableKpis: string[] }) {
  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterSev, setFilterSev] = useState("all");
  const [filterKpi, setFilterKpi] = useState("all");
  const [limit, setLimit] = useState(50);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (filterSev !== "all") p.append("severity", filterSev);
      if (filterKpi !== "all") p.append("kpi", filterKpi);
      p.append("limit", String(limit));
      const res = await axios.get(`api/v1/alerts/${community}?${p}`);
      setAlerts(res.data?.data ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to load alerts");
    } finally { setLoading(false); }
  }, [community, filterSev, filterKpi, limit]);

  useEffect(() => { load(); }, [load]);

  const COND: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤" };
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Filters bar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
        <div>
          <label style={labelStyle}>Severity</label>
          <select style={{ ...inputStyle, width: "auto" }} value={filterSev} onChange={e => setFilterSev(e.target.value)}>
            <option value="all">All</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>KPI</label>
          <select style={{ ...inputStyle, width: "auto" }} value={filterKpi} onChange={e => setFilterKpi(e.target.value)}>
            <option value="all">All KPIs</option>
            {availableKpis.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Limit</label>
          <select style={{ ...inputStyle, width: "auto" }} value={limit} onChange={e => setLimit(Number(e.target.value))}>
            {[25, 50, 100, 250, 500].map(n => <option key={n} value={n}>{n} records</option>)}
          </select>
        </div>
        <Button variant="ghost" onClick={load} title="Refresh"><RefreshCw size={14} /></Button>
      </div>

      {loading && <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><Loader2 size={28} className="animate-spin" color="var(--brand)" /></div>}
      {error && <div style={{ display: "flex", gap: "0.5rem", color: "#ef4444" }}><AlertCircle size={16} />{error}</div>}

      {!loading && alerts.length === 0 && (
        <div className="panel" style={{ textAlign: "center", padding: "3rem", color: "var(--text-soft)" }}>
          <History size={36} style={{ opacity: 0.3, marginBottom: "1rem" }} />
          <p style={{ margin: 0, fontWeight: 600 }}>No alert history found</p>
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>Alerts are saved each time a scheduler job violates a threshold.</p>
        </div>
      )}

      {!loading && alerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <p style={{ fontSize: "0.78rem", color: "var(--text-soft)", margin: "0 0 0.25rem" }}>{alerts.length} alert{alerts.length !== 1 ? "s" : ""}</p>
          {alerts.map((a, i) => {
            const cfg = SEVERITY_CONFIG[a.severity] ?? SEVERITY_CONFIG.info;
            const { Icon } = cfg;
            return (
              <div key={i} style={{
                display: "flex", gap: "0.75rem", alignItems: "flex-start",
                padding: "0.75rem 1rem",
                background: cfg.bg, border: `1px solid ${cfg.border}`,
                borderLeft: `3px solid ${cfg.color}`, borderRadius: "0.6rem",
              }}>
                <Icon size={15} color={cfg.color} style={{ marginTop: "0.15rem", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.25rem" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.83rem" }}>{a.kpi}</span>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{fmt(a.triggered_at)}</span>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
                    <code style={{ background: "var(--bg)", padding: "0 0.3rem", borderRadius: "0.2rem" }}>{a.scope}</code>
                    {" · "}
                    value <strong style={{ color: cfg.color }}>{typeof a.value === "number" ? a.value.toFixed(4) : a.value}</strong>
                    {" "}{COND[a.condition] ?? a.condition}{" "}
                    threshold <strong>{a.threshold}</strong>
                  </div>
                  {a.message && <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--text-secondary)" }}>{a.message}</p>}
                </div>
                <span style={{
                  fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase",
                  color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
                  padding: "0.15rem 0.45rem", borderRadius: "0.3rem", flexShrink: 0,
                }}>{a.severity}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ThresholdPage() {
  const { communities } = useCommunities();
  const { kpis: kpiList } = useKpiMetadata();

  const communityList = Object.keys(communities ?? COMMUNITY_FALLBACK);
  const [community, setCommunity] = useState(communityList[0] ?? "living_lab");
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; editing: Threshold | null }>({ open: false, editing: null });
  const [filterSeverity, setFilterSeverity] = useState<"all" | "info" | "warning" | "critical">("all");

  const availableKpis: string[] = (kpiList ?? [])
    .filter(k => k.status === "available" && k.registered)
    .map(k => k.name);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await axios.get(`api/v1/thresholds/${community}`);
      setThresholds(res.data?.data ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to load thresholds");
    } finally { setLoading(false); }
  }, [community]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (form: Omit<Threshold, "community">) => {
    await axios.post(`api/v1/thresholds/${community}`, form);
    await load();
  };

  const handleEdit = async (form: Omit<Threshold, "community">) => {
    const { kpi, scope, ...update } = form;
    await axios.patch(`api/v1/thresholds/${community}/${kpi}`, { ...update, scope });
    await load();
  };

  const handleDelete = async (t: Threshold) => {
    if (!confirm(`Delete threshold for "${t.kpi}" [${t.scope}]?`)) return;
    await axios.delete(`api/v1/thresholds/${community}/${t.kpi}?scope=${t.scope}`);
    await load();
  };

  const handleToggle = async (t: Threshold) => {
    await axios.patch(`api/v1/thresholds/${community}/${t.kpi}`, { enabled: !t.enabled, scope: t.scope });
    await load();
  };

  const filtered = filterSeverity === "all" ? thresholds : thresholds.filter(t => t.severity === filterSeverity);

  const counts = {
    all: thresholds.length,
    critical: thresholds.filter(t => t.severity === "critical").length,
    warning:  thresholds.filter(t => t.severity === "warning").length,
    info:     thresholds.filter(t => t.severity === "info").length,
  };

  const [activeTab, setActiveTab] = useState<"rules" | "history">("rules");

  return (
    <div className="page">
      <header className="jobs-hero">
        <div>
          <h1>Alert Thresholds</h1>
          <p>{activeTab === "rules" ? "Configure KPI threshold rules that trigger alerts when violated" : "History of triggered alerts saved by the scheduler"}</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignSelf: "flex-end" }}>
          {/* Tab switcher */}
          <nav role="tablist" style={{ display: "flex", gap: "0.35rem" }}>
            {(["rules", "history"] as const).map(t => {
              const isActive = activeTab === t;
              return (
                <button key={t} role="tab" aria-selected={isActive}
                  onClick={() => setActiveTab(t)}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.4rem",
                    padding: "0.4rem 0.9rem", borderRadius: "0.6rem",
                    border: `1px solid ${isActive ? "var(--brand)" : "var(--line)"}`,
                    background: isActive ? "var(--brand)" : "var(--bg-elev)",
                    color: isActive ? "#fff" : "var(--text)",
                    fontWeight: isActive ? 700 : 500, fontSize: "0.83rem", cursor: "pointer",
                  }}>
                  {t === "rules" ? <SlidersHorizontal size={14} /> : <History size={14} />}
                  {t === "rules" ? "Rules" : "Alert History"}
                </button>
              );
            })}
          </nav>
          {activeTab === "rules" && (
            <>
              <Button variant="ghost" onClick={load} title="Refresh"><RefreshCw size={15} /></Button>
              <Button onClick={() => setModal({ open: true, editing: null })}><Plus size={15} /> New Threshold</Button>
            </>
          )}
        </div>
      </header>

      {/* Shared: community selector */}
      <div className="panel" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
        <div style={{ flex: "0 0 220px" }}>
          <label style={labelStyle}>Community</label>
          <select style={inputStyle} value={community} onChange={e => setCommunity(e.target.value)}>
            {communityList.map(c => <option key={c} value={c}>{c.replace(/_/g, " ").toUpperCase()}</option>)}
          </select>
        </div>

        {/* Rules tab: severity pills */}
        {activeTab === "rules" && (
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap", paddingTop: "1.3rem" }}>
            {(["all", "critical", "warning", "info"] as const).map(s => {
              const cfg = s === "all" ? null : SEVERITY_CONFIG[s];
              const active = filterSeverity === s;
              return (
                <button key={s} onClick={() => setFilterSeverity(s)} style={{
                  fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
                  padding: "0.25rem 0.75rem", borderRadius: "999px",
                  border: active ? `1px solid ${cfg?.color ?? "var(--brand)"}` : "1px solid var(--line)",
                  background: active ? (cfg?.bg ?? "var(--brand-muted)") : "transparent",
                  color: active ? (cfg?.color ?? "var(--brand)") : "var(--text-soft)",
                  transition: "all 0.15s", textTransform: "capitalize",
                }}>
                  {s} ({counts[s]})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Rules tab ── */}
      <div hidden={activeTab !== "rules"} style={{ paddingBottom: "2rem" }}>
        {loading && <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><Loader2 size={28} className="animate-spin" color="var(--brand)" /></div>}
        {error && <div className="panel" style={{ display: "flex", gap: "0.75rem", alignItems: "center", color: "#ef4444" }}><AlertCircle size={18} />{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="panel" style={{ textAlign: "center", padding: "3rem", color: "var(--text-soft)" }}>
            <Bell size={36} style={{ opacity: 0.3, marginBottom: "1rem" }} />
            <p style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>No thresholds configured</p>
            <p style={{ margin: "0.5rem 0 1.5rem", fontSize: "0.85rem" }}>{filterSeverity !== "all" ? `No ${filterSeverity} thresholds` : "Create your first threshold rule to receive KPI alerts"}</p>
            {filterSeverity === "all" && <Button onClick={() => setModal({ open: true, editing: null })}><Plus size={15} /> New Threshold</Button>}
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {filtered.map((t, i) => (
              <ThresholdCard key={`${t.kpi}-${t.scope}-${i}`} t={t}
                onEdit={() => setModal({ open: true, editing: t })}
                onDelete={() => handleDelete(t)}
                onToggle={() => handleToggle(t)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── History tab ── */}
      <div hidden={activeTab !== "history"} style={{ paddingBottom: "2rem" }}>
        {activeTab === "history" && <AlertHistoryTab community={community} availableKpis={availableKpis} />}
      </div>

      {/* Modal */}
      {modal.open && (
        <ThresholdModal
          isEdit={!!modal.editing}
          community={community}
          availableKpis={availableKpis}
          initial={modal.editing ? {
            kpi: modal.editing.kpi,
            scope: modal.editing.scope,
            condition: modal.editing.condition,
            threshold: modal.editing.threshold,
            severity: modal.editing.severity,
            message: modal.editing.message,
            enabled: modal.editing.enabled,
          } : EMPTY_FORM}
          onClose={() => setModal({ open: false, editing: null })}
          onSave={modal.editing ? handleEdit : handleCreate}
        />
      )}
    </div>
  );
}
