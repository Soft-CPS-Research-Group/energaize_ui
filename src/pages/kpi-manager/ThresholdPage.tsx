import { useState, useEffect, useCallback, useId } from "react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import {
  Plus, Trash2, Edit2, Loader2, ShieldAlert, AlertTriangle, Info, RefreshCw,
  Bell, BellOff, CheckCircle, History, SlidersHorizontal,
} from "lucide-react";
import { api as axios } from "../../api/kpiApi";
import { useCommunities } from "../../hooks/useCommunities";
import { kpiDisplayName, kpiSelectOptions, useKpiMetadata } from "../../hooks/useKpiMetadata";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";
import { KpiPageHeader } from "../../components/kpi/KpiPageHeader";
import { KpiSegmented } from "../../components/kpi/KpiSegmented";
import { KpiError, KpiLoading } from "../../components/kpi/KpiStates";
import { CommunityField, KpiField, KpiFilterBar, KpiSwitch, communityLabel } from "../../components/kpi/KpiFilters";

// ── Types ─────────────────────────────────────────────────────────────────────

type Severity = "info" | "warning" | "critical";

interface Threshold {
  id?: string;          // MongoDB _id as string — present after first load
  community: string;
  kpi: string;
  scope: string;
  condition: "gt" | "gte" | "lt" | "lte";
  threshold: number;
  severity: Severity;
  message: string;
  enabled: boolean;
}

type ThresholdForm = Omit<Threshold, "community">;

const EMPTY_FORM: ThresholdForm = {
  kpi: "",
  scope: "*",
  condition: "gt",
  threshold: 0,
  severity: "warning",
  message: "",
  enabled: true,
};

const CONDITION_LABELS: Record<string, string> = {
  gt: "> greater than",
  gte: "≥ greater than or equal",
  lt: "< less than",
  lte: "≤ less than or equal",
};
const CONDITION_SYMBOL: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤" };

const SEVERITY = {
  critical: { badge: "danger",  text: "kpi-text-danger", Icon: ShieldAlert },
  warning:  { badge: "warning", text: "kpi-text-warn",   Icon: AlertTriangle },
  info:     { badge: "info",    text: "kpi-text-info",   Icon: Info },
} as const;

/**
 * Updates one rule. The by-id route only exists in newer KPI module versions; an older
 * module answers 405 there, and then the legacy KPI-wide route is the only option.
 */
async function updateThreshold(community: string, t: Threshold, update: Partial<ThresholdForm>): Promise<void> {
  if (t.id) {
    try {
      await axios.patch(`api/v1/thresholds/${community}/by-id/${t.id}`, update);
      return;
    } catch (e: any) {
      if (e?.response?.status !== 405) throw e;
    }
  }
  await axios.patch(`api/v1/thresholds/${community}/${t.kpi}`, { ...update, scope: t.scope });
}

// ── Threshold form ────────────────────────────────────────────────────────────

function ThresholdModal({ open, initial, kpiOptions, communitiesList, buildingsMap, onClose, onSave, isEdit }: {
  open: boolean;
  initial: ThresholdForm;
  kpiOptions: Array<{ value: string; label: string }>;
  communitiesList: string[];
  buildingsMap: Record<string, string[]>;
  onClose: () => void;
  onSave: (data: ThresholdForm) => Promise<void>;
  isEdit: boolean;
}) {
  const ids = useId();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scopeCommunity, setScopeCommunity] = useState<string>("*");

  useEffect(() => {
    if (open) { setForm(initial); setErr(null); setScopeCommunity("*"); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableBuildings = scopeCommunity === "*"
    ? Object.values(buildingsMap).flat()
    : (buildingsMap[scopeCommunity] ?? []);

  const handleSave = async () => {
    setErr(null);
    if (!form.kpi) { setErr("Select a KPI."); return; }
    if (isNaN(form.threshold)) { setErr("Threshold must be a number."); return; }
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch (e: any) { setErr(e?.response?.data?.detail || e?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const kpiLabel = kpiOptions.find(o => o.value === form.kpi)?.label;
  const sev = SEVERITY[form.severity];

  return (
    <Modal title={isEdit ? "Edit threshold" : "New alert threshold"} open={open} onClose={onClose} width="md">
      <div className="kpi-form">
        <KpiField label="KPI" htmlFor={`${ids}-kpi`} hint={isEdit ? "cannot be changed" : undefined}>
          <select id={`${ids}-kpi`} value={form.kpi} disabled={isEdit} onChange={e => setForm(f => ({ ...f, kpi: e.target.value }))}>
            <option value="">Select a KPI…</option>
            {kpiOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </KpiField>

        <div className="kpi-filterbar-fields">
          <KpiField label="Scope: community" htmlFor={`${ids}-scope-c`}>
            <select id={`${ids}-scope-c`} value={scopeCommunity} disabled={isEdit}
              onChange={e => { setScopeCommunity(e.target.value); setForm(f => ({ ...f, scope: "*" })); }}>
              <option value="*">All communities</option>
              {communitiesList.map(c => <option key={c} value={c}>{communityLabel(c)}</option>)}
            </select>
          </KpiField>
          <KpiField label="Scope: building" htmlFor={`${ids}-scope-b`}>
            <select id={`${ids}-scope-b`} value={form.scope} disabled={isEdit} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}>
              <option value="*">All buildings</option>
              {availableBuildings.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </KpiField>
        </div>

        <div className="kpi-filterbar-fields">
          <KpiField label="Condition" htmlFor={`${ids}-cond`}>
            <select id={`${ids}-cond`} value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value as Threshold["condition"] }))}>
              {Object.entries(CONDITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </KpiField>
          <KpiField label="Threshold value" htmlFor={`${ids}-value`}>
            <input id={`${ids}-value`} type="number" step="any" value={form.threshold}
              onChange={e => setForm(f => ({ ...f, threshold: parseFloat(e.target.value) }))} />
          </KpiField>
        </div>

        <KpiField label="Severity">
          <KpiSegmented<Severity>
            segments={(["info", "warning", "critical"] as const).map(s => {
              const { Icon } = SEVERITY[s];
              return { key: s, label: s.charAt(0).toUpperCase() + s.slice(1), icon: <Icon size={13} /> };
            })}
            value={form.severity}
            onChange={severity => setForm(f => ({ ...f, severity }))}
            ariaLabel="Severity"
          />
        </KpiField>

        <KpiField label="Alert message" hint="optional" htmlFor={`${ids}-msg`}>
          <input id={`${ids}-msg`} value={form.message} placeholder="e.g. Energy cost too high — check grid import"
            onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
        </KpiField>

        <KpiSwitch
          checked={form.enabled}
          onChange={enabled => setForm(f => ({ ...f, enabled }))}
          label={form.enabled ? "Enabled" : "Disabled: saved but not evaluated by the scheduler"}
        />

        <p className="kpi-threshold-preview">
          Raise a <strong className={sev.text}>{form.severity}</strong> alert when{" "}
          <strong>{kpiLabel || "…"}</strong> [{form.scope === "*" ? "any scope" : form.scope}] is{" "}
          <strong>{CONDITION_SYMBOL[form.condition]} {Number.isNaN(form.threshold) ? "…" : form.threshold}</strong>
        </p>

        {err && <KpiError message={err} />}

        <div className="kpi-form-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}
            iconLeft={saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}>
            {isEdit ? "Save changes" : "Create threshold"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Threshold card ────────────────────────────────────────────────────────────

function ThresholdCard({ t, kpiLabel, onEdit, onDelete, onToggle }: {
  t: Threshold;
  kpiLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const sev = SEVERITY[t.severity] ?? SEVERITY.info;
  return (
    <article className={`kpi-rule is-${t.severity}${t.enabled ? "" : " is-disabled"}`}>
      <sev.Icon size={16} className={t.enabled ? sev.text : "kpi-text-soft"} aria-hidden="true" />
      <div className="kpi-rule-body">
        <h3>
          {kpiLabel}
          <code>scope: {t.scope}</code>
          <Badge tone={sev.badge}>{t.severity}</Badge>
          {t.community === "*" && <Badge>all communities</Badge>}
          {!t.enabled && <Badge>disabled</Badge>}
        </h3>
        <p>
          Trigger when value <strong>{CONDITION_SYMBOL[t.condition] ?? t.condition}</strong>{" "}
          <strong className={sev.text}>{t.threshold}</strong>
          {t.message && <> — <em>{t.message}</em></>}
        </p>
      </div>
      <div className="kpi-rule-actions">
        <Button variant="ghost" size="sm" iconOnly onClick={onToggle}
          iconLeft={t.enabled ? <Bell size={14} /> : <BellOff size={14} />}
          aria-label={t.enabled ? `Disable ${kpiLabel} rule` : `Enable ${kpiLabel} rule`}
          aria-pressed={t.enabled}>
          {t.enabled ? "Disable" : "Enable"}
        </Button>
        <Button variant="ghost" size="sm" iconOnly onClick={onEdit} iconLeft={<Edit2 size={14} />} aria-label={`Edit ${kpiLabel} rule`}>
          Edit
        </Button>
        <Button variant="danger" size="sm" iconOnly onClick={onDelete} iconLeft={<Trash2 size={14} />} aria-label={`Delete ${kpiLabel} rule`}>
          Delete
        </Button>
      </div>
    </article>
  );
}

// ── Alert history ─────────────────────────────────────────────────────────────

interface AlertDoc {
  community: string;
  kpi: string;
  scope: string;
  value: number;
  threshold: number;
  condition: string;
  severity: Severity;
  message: string;
  triggered_at: string;
}

function AlertHistory({ community, kpiOptions }: { community: string; kpiOptions: Array<{ value: string; label: string }> }) {
  const ids = useId();
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

  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const label = (kpi: string) => kpiOptions.find(o => o.value === kpi)?.label ?? kpi;

  return (
    <section className="kpi-results" aria-label="Alert history">
      <div className="kpi-filterbar-fields">
        <KpiField label="Severity" size="sm" htmlFor={`${ids}-sev`}>
          <select id={`${ids}-sev`} value={filterSev} onChange={e => setFilterSev(e.target.value)}>
            <option value="all">All</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </KpiField>
        <KpiField label="KPI" htmlFor={`${ids}-kpi`}>
          <select id={`${ids}-kpi`} value={filterKpi} onChange={e => setFilterKpi(e.target.value)}>
            <option value="all">All KPIs</option>
            {kpiOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </KpiField>
        <KpiField label="Show" size="sm" htmlFor={`${ids}-limit`}>
          <select id={`${ids}-limit`} value={limit} onChange={e => setLimit(Number(e.target.value))}>
            {[25, 50, 100, 250, 500].map(n => <option key={n} value={n}>{n} records</option>)}
          </select>
        </KpiField>
        <Button variant="secondary" onClick={load} iconLeft={<RefreshCw size={14} />}>Refresh</Button>
      </div>

      {loading && <KpiLoading label="Loading alerts…" />}
      {error && <KpiError message={error} onRetry={load} />}

      {!loading && !error && alerts.length === 0 && (
        <EmptyState title="No alerts found" message="An alert is saved each time a scheduler job crosses a threshold." />
      )}

      {!loading && alerts.length > 0 && (
        <>
          <p className="kpi-text-soft">{alerts.length} alert{alerts.length !== 1 ? "s" : ""}</p>
          {alerts.map((a, i) => {
            const sev = SEVERITY[a.severity] ?? SEVERITY.info;
            return (
              <article key={i} className={`kpi-rule is-${a.severity}`}>
                <sev.Icon size={15} className={sev.text} aria-hidden="true" />
                <div className="kpi-rule-body">
                  <h3>
                    {label(a.kpi)}
                    <Badge tone={sev.badge}>{a.severity}</Badge>
                    <time dateTime={a.triggered_at} className="kpi-text-soft">{fmt(a.triggered_at)}</time>
                  </h3>
                  <p>
                    <code>{a.scope}</code> · value{" "}
                    <strong className={sev.text}>{typeof a.value === "number" ? a.value.toFixed(4) : a.value}</strong>{" "}
                    {CONDITION_SYMBOL[a.condition] ?? a.condition} threshold <strong>{a.threshold}</strong>
                  </p>
                  {a.message && <p className="kpi-text-soft">{a.message}</p>}
                </div>
              </article>
            );
          })}
        </>
      )}
    </section>
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
  const [filterSeverity, setFilterSeverity] = useState<"all" | Severity>("all");
  const [activeTab, setActiveTab] = useState<"rules" | "history">("rules");
  const [confirmDelete, setConfirmDelete] = useState<Threshold | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const kpiOptions = kpiSelectOptions(kpiList);
  const kpiLabel = (kpi: string) => kpiDisplayName(kpiList.find(k => k.name === kpi), kpi);

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

  const handleCreate = async (form: ThresholdForm) => {
    await axios.post(`api/v1/thresholds/${community}`, form);
    await load();
  };

  const handleEdit = async (form: ThresholdForm) => {
    if (!modal.editing) return;
    const { kpi: _kpi, scope: _scope, ...update } = form;
    await updateThreshold(community, modal.editing, update);
    await load();
  };

  const handleDelete = async (t: Threshold) => {
    setActionError(null);
    try {
      if (t.id) {
        // Precise delete by MongoDB _id — safe when duplicate kpi/scope rules exist
        await axios.delete(`api/v1/thresholds/${community}/by-id/${t.id}`);
      } else {
        await axios.delete(`api/v1/thresholds/${community}/${t.kpi}?scope=${t.scope}`);
      }
      setConfirmDelete(null);
      await load();
    } catch (e: any) {
      setActionError(e?.response?.data?.detail || e?.message || "Delete failed");
    }
  };

  const handleToggle = async (t: Threshold) => {
    setActionError(null);
    try {
      await updateThreshold(community, t, { enabled: !t.enabled });
      await load();
    } catch (e: any) {
      setActionError(e?.response?.data?.detail || e?.message || "Update failed");
    }
  };

  const filtered = filterSeverity === "all" ? thresholds : thresholds.filter(t => t.severity === filterSeverity);
  const count = (s: "all" | Severity) => (s === "all" ? thresholds : thresholds.filter(t => t.severity === s)).length;

  return (
    <div className="page">
      <KpiPageHeader
        title="Alerts"
        description={activeTab === "rules" ? "Threshold rules that raise an alert when a KPI crosses them" : "Alerts raised by the scheduler"}
        actions={
          <>
            <KpiSegmented
              segments={[
                { key: "rules", label: "Rules", icon: <SlidersHorizontal size={14} /> },
                { key: "history", label: "Alert history", icon: <History size={14} /> },
              ]}
              value={activeTab}
              onChange={setActiveTab}
              ariaLabel="Alert views"
            />
            {activeTab === "rules" && (
              <>
                <Button variant="secondary" onClick={load} iconLeft={<RefreshCw size={15} />}>Refresh</Button>
                <Button variant="primary" onClick={() => setModal({ open: true, editing: null })} iconLeft={<Plus size={15} />}>New threshold</Button>
              </>
            )}
          </>
        }
      />

      <KpiFilterBar ariaLabel="Community">
        <CommunityField communities={communityList} value={community} onChange={setCommunity} />
        {activeTab === "rules" && (
          <KpiField label="Severity" size="lg">
            <KpiSegmented<"all" | Severity>
              segments={(["all", "critical", "warning", "info"] as const).map(s => ({
                key: s, label: `${s.charAt(0).toUpperCase() + s.slice(1)} (${count(s)})`,
              }))}
              value={filterSeverity}
              onChange={setFilterSeverity}
              ariaLabel="Filter by severity"
            />
          </KpiField>
        )}
      </KpiFilterBar>

      {actionError && <KpiError message={actionError} />}

      <div hidden={activeTab !== "rules"} className="kpi-results">
        {loading && <KpiLoading label="Loading thresholds…" />}
        {error && <KpiError message={error} onRetry={load} />}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            title="No thresholds configured"
            message={filterSeverity !== "all" ? `No ${filterSeverity} thresholds.` : "Create a threshold rule to be alerted when a KPI crosses it."}
            action={filterSeverity === "all"
              ? <Button variant="primary" onClick={() => setModal({ open: true, editing: null })} iconLeft={<Plus size={15} />}>New threshold</Button>
              : undefined}
          />
        )}
        {!loading && filtered.map((t, i) => (
          <ThresholdCard
            key={t.id ?? `${t.kpi}-${t.scope}-${i}`}
            t={t}
            kpiLabel={kpiLabel(t.kpi)}
            onEdit={() => setModal({ open: true, editing: t })}
            onDelete={() => setConfirmDelete(t)}
            onToggle={() => handleToggle(t)}
          />
        ))}
      </div>

      {activeTab === "history" && <AlertHistory community={community} kpiOptions={kpiOptions} />}

      <ThresholdModal
        open={modal.open}
        isEdit={!!modal.editing}
        kpiOptions={kpiOptions}
        communitiesList={communityList}
        buildingsMap={communities ?? COMMUNITY_FALLBACK}
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

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete threshold"
        message={confirmDelete ? <>Delete the <strong>{kpiLabel(confirmDelete.kpi)}</strong> rule for <code>{confirmDelete.scope}</code>?</> : ""}
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
      />
    </div>
  );
}
