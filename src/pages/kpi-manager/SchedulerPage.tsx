import { useState, useEffect, useCallback, useId } from "react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { Play, RefreshCw, Clock, CheckCircle, XCircle, Loader2, Plus, Trash2, Edit2, Lock } from "lucide-react";
import { api as axios } from "../../api/kpiApi";
import { useCommunities } from "../../hooks/useCommunities";
import { kpiDisplayName, useKpiMetadata } from "../../hooks/useKpiMetadata";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";
import { KpiPageHeader } from "../../components/kpi/KpiPageHeader";
import { KpiSegmented } from "../../components/kpi/KpiSegmented";
import { KpiError, KpiLoading } from "../../components/kpi/KpiStates";
import { KpiField, KpiSelectField, communityLabel } from "../../components/kpi/KpiFilters";
import {
  CRON_PRESETS, EMPTY_JOB_FORM, buildCron, isValidLookback, jobPayload, type Frequency, type JobForm,
} from "./schedulerModel";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (iso: string | null) => {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
};

const STATUS_BADGE = {
  success: { tone: "success", icon: <CheckCircle size={12} />, label: "Success" },
  error:   { tone: "danger",  icon: <XCircle size={12} />,     label: "Error" },
  running: { tone: "info",    icon: <Loader2 size={12} className="animate-spin" />, label: "Running" },
  never:   { tone: "neutral", icon: <Clock size={12} />,       label: "Never run" },
} as const;

function StatusBadge({ status }: { status: JobStatus["last_run_status"] }) {
  const c = STATUS_BADGE[status ?? "never"] ?? STATUS_BADGE.never;
  return <Badge tone={c.tone}>{c.icon} {c.label}</Badge>;
}

function SourceBadge({ source }: { source: "yaml" | "ui" }) {
  return source === "yaml"
    ? <Badge tone="warning"><Lock size={10} /> YAML</Badge>
    : <Badge tone="info">UI</Badge>;
}

// ── Job form ──────────────────────────────────────────────────────────────────

function JobFormModal({ open, initial, onClose, onSave, isEdit }: {
  open: boolean;
  initial: JobForm;
  onClose: () => void;
  onSave: (data: JobForm) => Promise<void>;
  isEdit: boolean;
}) {
  const ids = useId();
  const { communities } = useCommunities();
  const { kpis: kpiList } = useKpiMetadata();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cronMode, setCronMode] = useState<"preset" | "advanced">("preset");
  const [schedFreq, setSchedFreq] = useState<Frequency>("hourly");
  const [schedMinute, setSchedMinute] = useState(5);
  const [schedHour, setSchedHour] = useState(0);
  const [schedDay, setSchedDay] = useState(1); // 1 = Monday

  // Reset only when the modal opens: the page re-renders on its 30 s status poll,
  // and resetting on every new `initial` object would wipe what the user is typing.
  useEffect(() => {
    if (open) { setForm(initial); setErr(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyBuilder = (freq: Frequency, min = schedMinute, hr = schedHour, day = schedDay) => {
    setSchedFreq(freq); setSchedMinute(min); setSchedHour(hr); setSchedDay(day);
    setForm(f => ({ ...f, cron: buildCron(freq, min, hr, day) }));
  };

  const kpiOptions = kpiList
    .filter((k) => k.status === "available" && k.registered && k.type === "scheduled")
    .map((k) => ({ value: k.name, label: kpiDisplayName(k, k.name) }));

  const communityList = Object.keys(communities ?? COMMUNITY_FALLBACK);

  const handleSave = async () => {
    setErr(null);
    if (!form.id.trim()) { setErr("Job ID is required."); return; }
    if (form.kpis.length === 0) { setErr("Select at least one KPI."); return; }
    if (!isValidLookback(form.lookback)) { setErr("Lookback must look like 15m, 1h, 2d, 1w, 1mo or 1y."); return; }
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch (e: any) { setErr(e?.response?.data?.detail || e?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={isEdit ? "Edit job" : "New scheduler job"} open={open} onClose={onClose} width="md">
      <div className="kpi-form">
        <KpiField label="Job ID" htmlFor={`${ids}-id`} hint={isEdit ? "cannot be changed" : undefined}>
          <input
            id={`${ids}-id`}
            value={form.id}
            disabled={isEdit}
            onChange={e => setForm(f => ({ ...f, id: e.target.value.replace(/\s/g, "_") }))}
            placeholder="e.g. hourly_costs"
          />
        </KpiField>

        <KpiField label="Community" htmlFor={`${ids}-community`}>
          <select id={`${ids}-community`} value={form.community} onChange={e => setForm(f => ({ ...f, community: e.target.value }))}>
            <option value="*">All communities</option>
            {communityList.map(c => <option key={c} value={c}>{communityLabel(c)}</option>)}
          </select>
        </KpiField>

        <div className="kpi-form-section">
          <div className="kpi-form-section-head">
            <span className="kpi-field-label">Schedule (UTC)</span>
            <KpiSegmented
              segments={[{ key: "preset", label: "Builder" }, { key: "advanced", label: "Cron" }]}
              value={cronMode}
              onChange={setCronMode}
              ariaLabel="Schedule editor"
            />
          </div>

          {cronMode === "preset" ? (
            <div className="kpi-field-group">
              <div className="kpi-presets" role="group" aria-label="Quick presets">
                {CRON_PRESETS.map(p => (
                  <Button
                    key={p.label}
                    size="sm"
                    variant={form.cron === p.cron ? "primary" : "secondary"}
                    aria-pressed={form.cron === p.cron}
                    onClick={() => {
                      setForm(f => ({ ...f, cron: p.cron }));
                      setSchedFreq(p.freq); setSchedMinute(p.min); setSchedHour(p.hr); setSchedDay(p.day);
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="kpi-filterbar-fields">
                <KpiField label="Frequency" size="sm" htmlFor={`${ids}-freq`}>
                  <select id={`${ids}-freq`} value={schedFreq} onChange={e => applyBuilder(e.target.value as Frequency)}>
                    <option value="hourly">Every hour</option>
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week</option>
                  </select>
                </KpiField>
                {schedFreq !== "hourly" && (
                  <KpiField label="At hour" size="sm" htmlFor={`${ids}-hour`}>
                    <select id={`${ids}-hour`} value={schedHour} onChange={e => applyBuilder(schedFreq, schedMinute, +e.target.value, schedDay)}>
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                      ))}
                    </select>
                  </KpiField>
                )}
                {schedFreq === "weekly" && (
                  <KpiField label="Day" size="sm" htmlFor={`${ids}-day`}>
                    <select id={`${ids}-day`} value={schedDay} onChange={e => applyBuilder(schedFreq, schedMinute, schedHour, +e.target.value)}>
                      {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => (
                        <option key={d} value={i + 1}>{d}</option>
                      ))}
                    </select>
                  </KpiField>
                )}
              </div>
              <p className="kpi-text-soft kpi-mono">Cron: <strong>{form.cron}</strong></p>
            </div>
          ) : (
            <KpiField label="Cron expression" hint="minute hour day month weekday" htmlFor={`${ids}-cron`}>
              <input id={`${ids}-cron`} className="kpi-mono" value={form.cron} onChange={e => setForm(f => ({ ...f, cron: e.target.value }))} placeholder="5 * * * *" />
            </KpiField>
          )}
        </div>

        <KpiField label="Lookback" hint="15m · 1h · 2d · 1w · 1mo · 1y" htmlFor={`${ids}-lookback`}>
          <input id={`${ids}-lookback`} value={form.lookback} onChange={e => setForm(f => ({ ...f, lookback: e.target.value }))} placeholder="1h" />
        </KpiField>

        <KpiSelectField
          options={kpiOptions}
          selected={form.kpis}
          onChange={(kpis) => setForm(f => ({ ...f, kpis }))}
        />

        {err && <KpiError message={err} />}

        <div className="kpi-form-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving}
            iconLeft={saving ? <Loader2 size={14} className="animate-spin" /> : undefined}
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create job"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Job card ─────────────────────────────────────────────────────────────────

function JobCard({ job, triggering, triggerResult, deleting, onEdit, onDelete, onTrigger }: {
  job: JobStatus;
  triggering: boolean;
  triggerResult?: "ok" | "error";
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTrigger: () => void;
}) {
  const { kpis: kpiMeta } = useKpiMetadata();
  return (
    <article className="kpi-job">
      <header className="kpi-job-head">
        <div>
          <h3>{job.id} <SourceBadge source={job.source} /> <StatusBadge status={job.last_run_status} /></h3>
          <code className="kpi-text-soft">{job.cron}</code>
          {triggerResult === "ok" && <span className="kpi-text-ok" role="status"> · Triggered</span>}
          {triggerResult === "error" && <span className="kpi-text-danger" role="status"> · Trigger failed</span>}
        </div>
        <div className="kpi-job-actions">
          {job.source === "ui" && (
            <>
              <Button onClick={onEdit} variant="secondary" size="sm" iconLeft={<Edit2 size={13} />}>Edit</Button>
              <Button
                onClick={onDelete}
                disabled={deleting}
                variant="danger"
                size="sm"
                iconLeft={deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              >
                Delete
              </Button>
            </>
          )}
          <Button
            onClick={onTrigger}
            disabled={triggering}
            variant="primary"
            size="sm"
            iconLeft={triggering ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          >
            Run now
          </Button>
        </div>
      </header>

      <dl className="kpi-job-facts">
        <div><dt>Community</dt><dd>{job.community === "*" ? "All" : communityLabel(job.community)}</dd></div>
        <div><dt>Lookback</dt><dd>{job.lookback}</dd></div>
        <div><dt>Next run</dt><dd>{fmt(job.next_run_time)}</dd></div>
        <div><dt>Last run</dt><dd>{fmt(job.last_run_time)}</dd></div>
      </dl>

      <ul className="kpi-job-kpis" aria-label="KPIs">
        {job.kpis.map(kpi => (
          <li key={kpi}>{kpiDisplayName(kpiMeta.find((m) => m.name === kpi), kpi)}</li>
        ))}
      </ul>

      {job.last_run_status === "error" && job.last_run_error && (
        <pre className="kpi-job-error">{job.last_run_error}</pre>
      )}
    </article>
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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const clearTriggerResult = (jobId: string) =>
    setTriggerResult(p => { const n = { ...p }; delete n[jobId]; return n; });

  const triggerJob = async (jobId: string) => {
    setTriggeringJob(jobId);
    try {
      await axios.post(`api/v1/scheduler/jobs/${jobId}/trigger`);
      setTriggerResult(p => ({ ...p, [jobId]: "ok" }));
      setTimeout(() => { clearTriggerResult(jobId); fetchStatus(); }, 3000);
    } catch {
      setTriggerResult(p => ({ ...p, [jobId]: "error" }));
      setTimeout(() => clearTriggerResult(jobId), 3000);
    } finally { setTriggeringJob(null); }
  };

  const deleteJob = async (jobId: string) => {
    setDeletingJob(jobId);
    setDeleteError(null);
    try {
      await axios.delete(`api/v1/scheduler/jobs/${jobId}`);
      setConfirmDelete(null);
      await fetchStatus();
    } catch (e: any) {
      setDeleteError(e?.response?.data?.detail || "Failed to delete job");
    } finally { setDeletingJob(null); }
  };

  const handleSaveJob = async (data: JobForm) => {
    const payload = jobPayload(data);
    if (editJob) {
      await axios.put(`api/v1/scheduler/jobs/${data.id}`, payload);
    } else {
      await axios.post("api/v1/scheduler/jobs", payload);
    }
    await fetchStatus();
  };

  const openCreate = () => { setEditJob(null); setModalOpen(true); };
  const openEdit = (job: JobStatus) => { setEditJob(job); setModalOpen(true); };

  return (
    <div className="page">
      <KpiPageHeader
        title="Scheduler"
        description="Scheduled KPI jobs. Jobs from the YAML file are read-only; jobs created here can be edited or deleted."
        actions={
          <>
            <Button onClick={fetchStatus} disabled={loading} variant="secondary"
              iconLeft={<RefreshCw className={loading ? "animate-spin" : ""} size={16} />}>
              Refresh
            </Button>
            <Button onClick={openCreate} variant="primary" iconLeft={<Plus size={16} />}>
              Add job
            </Button>
          </>
        }
      />

      {status && (
        <p className="kpi-scheduler-state" role="status">
          <span className={`kpi-live-dot${status.running ? " is-streaming" : ""}`} aria-hidden="true" />
          Scheduler {status.running ? "running" : "stopped"} · {status.jobs.length} job{status.jobs.length !== 1 ? "s" : ""}
        </p>
      )}

      {error && <KpiError message={error} onRetry={fetchStatus} />}
      {loading && !error && <KpiLoading label="Loading scheduler status…" />}

      {status && status.jobs.length > 0 && (
        <div className="kpi-results">
          {status.jobs.map(job => (
            <JobCard
              key={job.id}
              job={job}
              triggering={triggeringJob === job.id}
              triggerResult={triggerResult[job.id]}
              deleting={deletingJob === job.id}
              onEdit={() => openEdit(job)}
              onDelete={() => { setDeleteError(null); setConfirmDelete(job.id); }}
              onTrigger={() => triggerJob(job.id)}
            />
          ))}
        </div>
      )}

      {status && status.jobs.length === 0 && (
        <EmptyState
          title="No scheduled jobs"
          message="Add jobs in the YAML configuration, or select Add job above."
        />
      )}

      <JobFormModal
        open={modalOpen}
        initial={editJob ? {
          id: editJob.id,
          community: editJob.community,
          buildings: editJob.buildings,
          kpis: editJob.kpis,
          cron: editJob.cron,
          lookback: editJob.lookback ?? "1h",
        } : EMPTY_JOB_FORM}
        isEdit={!!editJob}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveJob}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete job"
        message={
          <>
            Delete <strong>{confirmDelete}</strong>? This cannot be undone.
            {deleteError ? <KpiError message={deleteError} /> : null}
          </>
        }
        confirmLabel="Delete"
        pending={deletingJob !== null}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteJob(confirmDelete)}
      />
    </div>
  );
}
