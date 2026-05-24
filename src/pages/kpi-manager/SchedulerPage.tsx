import { useState, useEffect, useCallback } from "react";
import { Button } from "../../components/ui/Button";
import {
  Calendar, Play, RefreshCw, Clock, CheckCircle, XCircle,
  Loader2, AlertCircle, Plus, Trash2, Edit2, Lock, X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/KpiCard";
import { api as axios } from "../../api/kpiApi";
import { useCommunities } from "../../hooks/useCommunities";
import { useKpiMetadata } from "../../hooks/useKpiMetadata";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";

// ── Types ─────────────────────────────────────────────────────────────────────

interface JobStatus {
  id: string;
  kpis: string[];
  community: string;
  buildings: string[];
  cron: string;
  lookback: string;
  source: "yaml" | "ui";
  next_run_time: string | null;
  last_run_time: string | null;
  last_run_status: "success" | "error" | "running" | "never" | null;
  last_run_error?: string | null;
}

interface SchedulerStatus {
  running: boolean;
  jobs: JobStatus[];
}

const EMPTY_FORM = {
  id: "",
  community: "*",
  buildings: ["*"],
  kpis: [] as string[],
  cron: "5 * * * *",
  lookback: "1h",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (iso: string | null) => {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString("pt-PT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
};

const StatusBadge = ({ status }: { status: JobStatus["last_run_status"] }) => {
  const cfg: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    success: { icon: <CheckCircle size={13} />, label: "Success", color: "#16a34a" },
    error:   { icon: <XCircle size={13} />,     label: "Error",   color: "#dc2626" },
    running: { icon: <Loader2 size={13} className="animate-spin" />, label: "Running", color: "#6366f1" },
    never:   { icon: <Clock size={13} />,        label: "Never run", color: "var(--text-soft)" },
  };
  const c = cfg[status ?? "never"] ?? cfg.never;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.25rem",
      fontSize: "0.72rem", padding: "0.1rem 0.5rem", borderRadius: "9999px",
      border: `1px solid ${c.color}40`, color: c.color, fontWeight: 600,
      background: `${c.color}10`,
    }}>
      {c.icon} {c.label}
    </span>
  );
};

const SourceBadge = ({ source }: { source: "yaml" | "ui" }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: "0.2rem",
    fontSize: "0.68rem", padding: "0.1rem 0.45rem", borderRadius: "9999px",
    border: source === "yaml" ? "1px solid #d97706" : "1px solid var(--brand)",
    color: source === "yaml" ? "#d97706" : "var(--brand)",
    background: source === "yaml" ? "#d9770610" : "var(--brand)10",
    fontWeight: 600,
  }}>
    {source === "yaml" ? <><Lock size={10} /> YAML</> : "UI"}
  </span>
);

// ── Job form modal ─────────────────────────────────────────────────────────────

function JobFormModal({
  initial,
  onClose,
  onSave,
  isEdit,
}: {
  initial: typeof EMPTY_FORM;
  onClose: () => void;
  onSave: (data: typeof EMPTY_FORM) => Promise<void>;
  isEdit: boolean;
}) {
  const { communities } = useCommunities();
  const { kpis: kpiList } = useKpiMetadata();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cronMode, setCronMode] = useState<"preset" | "advanced">("preset");
  // Preset builder state
  const [schedFreq, setSchedFreq] = useState<"hourly" | "daily" | "weekly">("hourly");
  const [schedMinute, setSchedMinute] = useState(5);
  const [schedHour, setSchedHour] = useState(0);
  const [schedDay, setSchedDay] = useState(1); // 1=Mon

  // Sync preset → cron string whenever builder fields change
  const buildCron = (freq: typeof schedFreq, min: number, hr: number, day: number) => {
    if (freq === "hourly")  return `${min} * * * *`;
    if (freq === "daily")   return `${min} ${hr} * * *`;
    return `${min} ${hr} * * ${day}`; // weekly
  };
  const applyPreset = (freq: typeof schedFreq, min = schedMinute, hr = schedHour, day = schedDay) => {
    setSchedFreq(freq); setSchedMinute(min); setSchedHour(hr); setSchedDay(day);
    setForm(f => ({ ...f, cron: buildCron(freq, min, hr, day) }));
  };

  const PRESETS = [
    { label: "Every hour",   cron: "5 * * * *",   freq: "hourly"  as const, min: 5, hr: 0, day: 1 },
    { label: "Every 2 hours",cron: "5 */2 * * *", freq: "hourly"  as const, min: 5, hr: 0, day: 1 },
    { label: "Every 6 hours",cron: "5 */6 * * *", freq: "hourly"  as const, min: 5, hr: 0, day: 1 },
    { label: "Daily midnight",cron: "5 0 * * *",  freq: "daily"   as const, min: 5, hr: 0, day: 1 },
    { label: "Weekly Monday",cron: "5 0 * * 1",   freq: "weekly"  as const, min: 5, hr: 0, day: 1 },
  ];

  const availableKpis: string[] = (kpiList ?? [])
    .filter((k) => k.status === "available" && k.registered && k.type === "scheduled")
    .map((k) => k.name);

  const communityList = Object.keys(communities ?? COMMUNITY_FALLBACK);

  const toggleKpi = (name: string) => {
    setForm(f => ({
      ...f,
      kpis: f.kpis.includes(name) ? f.kpis.filter(k => k !== name) : [...f.kpis, name],
    }));
  };

  const handleSave = async () => {
    setErr(null);
    if (!form.id.trim()) { setErr("Job ID is required"); return; }
    if (form.kpis.length === 0) { setErr("Select at least one KPI"); return; }
    if (!form.lookback.trim()) { setErr("Lookback is required (e.g. 1h, 2d, 1w)"); return; }
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch (e: any) { setErr(e?.response?.data?.detail || e?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
    zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
  };
  const modal: React.CSSProperties = {
    background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "1rem",
    padding: "1.5rem", width: "min(640px, 95vw)", maxHeight: "90vh",
    overflowY: "auto", display: "flex", flexDirection: "column", gap: "1.25rem",
    boxShadow: "0 25px 60px rgba(0,0,0,0.4)",
  };
  const label: React.CSSProperties = {
    display: "block", fontSize: "0.78rem", fontWeight: 600,
    color: "var(--text-soft)", marginBottom: "0.35rem",
  };
  const input: React.CSSProperties = {
    width: "100%", padding: "0.5rem 0.75rem", borderRadius: "0.5rem",
    border: "1px solid var(--line)", background: "var(--bg)", color: "var(--text)",
    fontSize: "0.875rem", boxSizing: "border-box",
  };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
            {isEdit ? "Edit Job" : "New Scheduler Job"}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-soft)" }}>
            <X size={20} />
          </button>
        </div>

        {/* Job ID */}
        <div>
          <label style={label}>Job ID *</label>
          <input
            style={input} value={form.id} disabled={isEdit}
            onChange={e => setForm(f => ({ ...f, id: e.target.value.replace(/\s/g, "_") }))}
            placeholder="e.g. my_custom_job"
          />
          {isEdit && <p style={{ fontSize: "0.72rem", color: "var(--text-soft)", marginTop: "0.25rem" }}>ID cannot be changed after creation</p>}
        </div>

        {/* Community */}
        <div>
          <label style={label}>Community</label>
          <select style={input} value={form.community} onChange={e => setForm(f => ({ ...f, community: e.target.value }))}>
            <option value="*">* (All communities)</option>
            {communityList.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Schedule builder */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <label style={{ ...label, marginBottom: 0 }}>Schedule</label>
            <div style={{ display: "flex", gap: "0.25rem" }}>
              {(["preset", "advanced"] as const).map(m => (
                <button key={m} onClick={() => setCronMode(m)} style={{
                  padding: "0.15rem 0.6rem", borderRadius: "9999px", fontSize: "0.72rem",
                  cursor: "pointer", fontWeight: 600,
                  border: `1px solid ${cronMode === m ? "var(--brand)" : "var(--line)"}`,
                  background: cronMode === m ? "var(--brand)" : "transparent",
                  color: cronMode === m ? "#fff" : "var(--text-soft)",
                }}>{m === "preset" ? "🕐 Builder" : "⚙ Advanced"}</button>
              ))}
            </div>
          </div>

          {cronMode === "preset" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "0.875rem", border: "1px solid var(--line)", borderRadius: "0.5rem", background: "var(--bg)" }}>
              {/* Quick presets */}
              <div>
                <p style={{ fontSize: "0.72rem", color: "var(--text-soft)", margin: "0 0 0.375rem" }}>Quick presets</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                  {PRESETS.map(p => {
                    const active = form.cron === p.cron;
                    return (
                      <button key={p.label} onClick={() => { setForm(f => ({ ...f, cron: p.cron })); setSchedFreq(p.freq); setSchedMinute(p.min); setSchedHour(p.hr); setSchedDay(p.day); }} style={{
                        fontSize: "0.75rem", padding: "0.2rem 0.7rem", borderRadius: "9999px", cursor: "pointer",
                        border: `1px solid ${active ? "var(--brand)" : "var(--line)"}`,
                        background: active ? "var(--brand)" : "transparent",
                        color: active ? "#fff" : "var(--text)", fontWeight: active ? 600 : 400,
                      }}>{p.label}</button>
                    );
                  })}
                </div>
              </div>

              {/* Structured builder */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
                <div>
                  <p style={{ fontSize: "0.72rem", color: "var(--text-soft)", margin: "0 0 0.3rem" }}>Frequency</p>
                  <select value={schedFreq} onChange={e => applyPreset(e.target.value as any)} style={{ ...input, width: "auto" }}>
                    <option value="hourly">Every hour</option>
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week</option>
                  </select>
                </div>
                {schedFreq !== "hourly" && (
                  <div>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-soft)", margin: "0 0 0.3rem" }}>At hour (UTC)</p>
                    <select value={schedHour} onChange={e => applyPreset(schedFreq, schedMinute, +e.target.value, schedDay)} style={{ ...input, width: "auto" }}>
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                      ))}
                    </select>
                  </div>
                )}
                {schedFreq === "weekly" && (
                  <div>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-soft)", margin: "0 0 0.3rem" }}>Day</p>
                    <select value={schedDay} onChange={e => applyPreset(schedFreq, schedMinute, schedHour, +e.target.value)} style={{ ...input, width: "auto" }}>
                      {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((d, i) => (
                        <option key={i} value={i + 1}>{d}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <p style={{ fontSize: "0.71rem", color: "var(--text-soft)", margin: 0, fontFamily: "monospace" }}>
                Cron: <strong>{form.cron}</strong>
              </p>
            </div>
          ) : (
            <div>
              <input style={input} value={form.cron}
                onChange={e => setForm(f => ({ ...f, cron: e.target.value }))}
                placeholder="5 * * * *"
              />
              <p style={{ fontSize: "0.72rem", color: "var(--text-soft)", marginTop: "0.25rem" }}>
                Format: minute hour day month weekday (UTC) · e.g. "5 * * * *" = every hour at :05
              </p>
            </div>
          )}
        </div>

        {/* Lookback */}
        <div>
          <label style={label}>Lookback Period</label>
          <input
            style={input}
            value={form.lookback}
            onChange={e => setForm(f => ({ ...f, lookback: e.target.value }))}
            placeholder="e.g. 1h, 2h, 1d, 7d, 1w, 1mo"
          />
          <p style={{ fontSize: "0.72rem", color: "var(--text-soft)", marginTop: "0.25rem" }}>
            Format: <code>Nh</code> (hours) · <code>Nd</code> (days) · <code>Nw</code> (weeks) · <code>Nmo</code> (months)
          </p>
        </div>

        {/* KPIs */}
        <div>
          <label style={label}>KPIs *</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", maxHeight: "160px", overflowY: "auto", padding: "0.5rem", border: "1px solid var(--line)", borderRadius: "0.5rem", background: "var(--bg)" }}>
            {availableKpis.length === 0 && (
              <span style={{ fontSize: "0.78rem", color: "var(--text-soft)" }}>Loading KPIs…</span>
            )}
            {availableKpis.map(name => {
              const sel = form.kpis.includes(name);
              return (
                <button key={name} onClick={() => toggleKpi(name)} style={{
                  fontSize: "0.73rem", padding: "0.15rem 0.6rem", borderRadius: "9999px",
                  cursor: "pointer", fontWeight: 500,
                  border: `1px solid ${sel ? "var(--brand)" : "var(--line)"}`,
                  background: sel ? "var(--brand)" : "transparent",
                  color: sel ? "#fff" : "var(--text)",
                }}>{name.replace("KPI", "")}</button>
              );
            })}
          </div>
          <p style={{ fontSize: "0.72rem", color: "var(--text-soft)", marginTop: "0.25rem" }}>
            {form.kpis.length} selected
          </p>
        </div>

        {/* Error */}
        {err && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", background: "#dc262612", border: "1px solid #dc262630", fontSize: "0.8rem", color: "#dc2626" }}>
            <AlertCircle size={14} /> {err}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}
            iconLeft={saving ? <Loader2 size={14} className="animate-spin" /> : undefined}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Job"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SchedulerPage() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<Record<string, "ok" | "error">>({});
  const [deletingJob, setDeletingJob] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editJob, setEditJob] = useState<JobStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setError(null);
      const res = await axios.get<{ status: string; data: SchedulerStatus }>("api/v1/scheduler/status");
      if (res?.data?.data) setStatus(res.data.data);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch scheduler status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const triggerJob = async (jobId: string) => {
    setTriggeringJob(jobId);
    try {
      await axios.post(`/api/v1/scheduler/jobs/${jobId}/trigger`);
      setTriggerResult(p => ({ ...p, [jobId]: "ok" }));
      setTimeout(() => { setTriggerResult(p => { const n = { ...p }; delete n[jobId]; return n; }); fetchStatus(); }, 3000);
    } catch {
      setTriggerResult(p => ({ ...p, [jobId]: "error" }));
      setTimeout(() => setTriggerResult(p => { const n = { ...p }; delete n[jobId]; return n; }), 3000);
    } finally { setTriggeringJob(null); }
  };

  const deleteJob = async (jobId: string) => {
    if (!window.confirm(`Delete job "${jobId}"? This cannot be undone.`)) return;
    setDeletingJob(jobId);
    try {
      await axios.delete(`/api/v1/scheduler/jobs/${jobId}`);
      await fetchStatus();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Failed to delete job");
    } finally { setDeletingJob(null); }
  };

  const handleSaveJob = async (data: typeof EMPTY_FORM) => {
    // Backend expects lookback_hours / lookback_days as separate ints
    const lb = data.lookback.trim().toLowerCase();
    const num = parseInt(lb, 10);
    const isHours = lb.endsWith("h");
    const payload = {
      id:             data.id,
      community:      data.community,
      buildings:      data.buildings,
      kpis:           data.kpis,
      cron:           data.cron,
      lookback_hours: isHours ? num : 0,
      lookback_days:  isHours ? 0 : num,
    };
    if (editJob) {
      await axios.put(`/api/v1/scheduler/jobs/${data.id}`, payload);
    } else {
      await axios.post("/api/v1/scheduler/jobs", payload);
    }
    await fetchStatus();
  };


  const openCreate = () => { setEditJob(null); setModalOpen(true); };
  const openEdit = (job: JobStatus) => { setEditJob(job); setModalOpen(true); };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", paddingBottom: "2rem" }} className="page">
      {/* Modal */}
      {modalOpen && (
        <JobFormModal
          initial={editJob ? {
            id: editJob.id,
            community: editJob.community,
            buildings: editJob.buildings,
            kpis: editJob.kpis,
            cron: editJob.cron,
            lookback: editJob.lookback ?? "1h",
          } : EMPTY_FORM}
          isEdit={!!editJob}
          onClose={() => setModalOpen(false)}
          onSave={handleSaveJob}
        />
      )}

      {/* Header */}
      <header className="jobs-hero">
        <div>
          <h1>Scheduler</h1>
          <p>Monitor and manage scheduled KPI jobs — YAML jobs are read-only, UI jobs can be edited or deleted</p>
        </div>
        <div className="jobs-hero-meta" style={{ display: "flex", gap: "0.75rem" }}>
          <Button onClick={fetchStatus} disabled={loading} variant="secondary"
            iconLeft={<RefreshCw className={loading ? "animate-spin" : ""} size={16} />}>
            Refresh
          </Button>
          <Button onClick={openCreate} variant="primary" iconLeft={<Plus size={16} />}>
            Add Job
          </Button>
        </div>
      </header>

      <div className="page-content page-inner" style={{ display: "flex", flexDirection: "column", gap: "1.5rem", padding: "1.5rem", paddingBottom: "4rem" }}>
        {/* Scheduler status pill */}
        {status && (
          <div style={{
            display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem",
            fontWeight: 500, padding: "0.5rem 1rem", borderRadius: "0.5rem",
            width: "fit-content", border: "1px solid var(--line)", backgroundColor: "var(--bg-elev)",
          }}>
            <div style={{
              width: "0.5rem", height: "0.5rem", borderRadius: "9999px",
              backgroundColor: status.running ? "var(--primary)" : "var(--text-soft)",
            }} className={status.running ? "animate-pulse" : ""} />
            Scheduler {status.running ? "running" : "stopped"} · {status.jobs.length} job{status.jobs.length !== 1 ? "s" : ""}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", backgroundColor: "var(--bg-elev)", border: "1px solid var(--line)", padding: "1rem", borderRadius: "0.5rem" }}>
            <AlertCircle size={20} style={{ flexShrink: 0 }} />
            <p style={{ fontSize: "0.875rem", margin: 0 }}>{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && !error && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", color: "var(--text-soft)", padding: "2rem", justifyContent: "center" }}>
            <Loader2 className="animate-spin" size={24} />
            <span>Loading scheduler status…</span>
          </div>
        )}

        {/* Jobs grid */}
        {status && status.jobs.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: "1rem" }}>
            {status.jobs.map(job => (
              <Card key={job.id}>
                <CardHeader>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                        <CardTitle style={{ fontSize: "1rem" }}>{job.id}</CardTitle>
                        <SourceBadge source={job.source} />
                        <StatusBadge status={job.last_run_status} />
                        {triggerResult[job.id] === "ok" && <span style={{ fontSize: "0.75rem", color: "#16a34a", fontWeight: 600 }}>✓ Triggered</span>}
                        {triggerResult[job.id] === "error" && <span style={{ fontSize: "0.75rem", color: "#dc2626", fontWeight: 600 }}>✗ Failed</span>}
                      </div>
                      <p style={{ fontSize: "0.8rem", color: "var(--text-soft)", fontFamily: "monospace", margin: 0 }}>{job.cron}</p>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                      {job.source === "ui" && (
                        <>
                          <Button onClick={() => openEdit(job)} variant="secondary" size="sm"
                            iconLeft={<Edit2 size={13} />}>Edit</Button>
                          <Button
                            onClick={() => deleteJob(job.id)}
                            disabled={deletingJob === job.id}
                            variant="secondary" size="sm"
                            iconLeft={deletingJob === job.id
                              ? <Loader2 size={13} className="animate-spin" />
                              : <Trash2 size={13} style={{ color: "#dc2626" }} />}
                          >Delete</Button>
                        </>
                      )}
                      <Button onClick={() => triggerJob(job.id)} disabled={triggeringJob === job.id} variant="primary" size="sm"
                        iconLeft={triggeringJob === job.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}>
                        Run now
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px,1fr))", gap: "1rem", fontSize: "0.875rem" }}>
                    {[
                      { label: "Community", val: job.community },
                      { label: "Lookback",  val: job.lookback },
                      { label: "Next run",  val: fmt(job.next_run_time) },
                      { label: "Last run",  val: fmt(job.last_run_time) },
                    ].map(({ label, val }) => (
                      <div key={label}>
                        <p style={{ fontSize: "0.8rem", color: "var(--text-soft)", marginBottom: "0.125rem", marginTop: 0 }}>{label}</p>
                        <p style={{ fontWeight: 500, color: "var(--text)", fontSize: "0.8rem", margin: 0 }}>{val}</p>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: "1rem" }}>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-soft)", marginBottom: "0.5rem", marginTop: 0 }}>KPIs</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                      {job.kpis.map(kpi => (
                        <span key={kpi} style={{ fontSize: "0.72rem", backgroundColor: "var(--bg)", color: "var(--text)", padding: "0.125rem 0.5rem", borderRadius: "9999px", border: "1px solid var(--line)" }}>
                          {kpi}
                        </span>
                      ))}
                    </div>
                  </div>

                  {job.last_run_status === "error" && job.last_run_error && (
                    <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", backgroundColor: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "0.5rem", padding: "0.75rem", fontFamily: "monospace", color: "#dc2626" }}>
                      {job.last_run_error}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty state */}
        {status && status.jobs.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem", color: "var(--text-soft)", backgroundColor: "var(--bg-elev)", borderRadius: "0.75rem", border: "1px dashed var(--line)" }}>
            <Calendar size={48} style={{ marginBottom: "1rem", opacity: 0.3 }} />
            <p style={{ fontWeight: 600, margin: 0 }}>No scheduled jobs</p>
            <p style={{ fontSize: "0.875rem", marginTop: "0.25rem" }}>Add jobs via the YAML config or click "Add Job" above.</p>
          </div>
        )}
      </div>
    </div>
  );
}