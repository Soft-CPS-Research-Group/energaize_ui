import { useEffect, useState } from "react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { PlusCircle, RotateCcw } from "lucide-react";
import {
  usePredictorTrainingProgress,
  usePredictorCommand,
  useCancelTrainingJob,
  usePredictorJob,
} from "../../../hooks/usePredictor";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Modal } from "../../../components/ui/Modal";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import { normalizeTs } from "../../../utils/predictorTransforms";
import type { TrainingJob, SystemInfo } from "../../../api/predictorApi";
import { TrainWizard } from "./TrainWizard";

interface TrainViewProps {
  selectedHouseId: string | null;
  timezone: string;
}

const ACTIVE_STATUSES = ["PENDING", "FETCHING", "RUNNING"];
const HISTORY_PAGE_SIZE = 10;

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

/** One-word registry statuses. Rejected is the normal "new model was not better" outcome, so it is neutral, not red. */
const STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Queued", tone: "neutral" },
  FETCHING: { label: "Loading", tone: "info" },
  RUNNING: { label: "Training", tone: "info" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  REJECTED: { label: "Rejected", tone: "neutral" },
  CANCELED: { label: "Stopped", tone: "neutral" },
  FAILED: { label: "Failed", tone: "danger" },
};

const MODEL_LABELS: Record<string, string> = { xgboost: "XGBoost", lgbm: "LightGBM", lstm: "LSTM" };

function JobStatus({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

function jobPercent(job: TrainingJob): number {
  return job.percent ?? (job.progress_total > 0 ? (job.progress_current / job.progress_total) * 100 : 0);
}

function fmtElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m} min ${s} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Job times come without a zone and are UTC (the predictor container clock). */
export function formatJobTime(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  const date = new Date(normalizeTs(iso));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", { timeZone: timezone, dateStyle: "short", timeStyle: "short" });
}

function fmtMae(value: number | null): string {
  return value == null ? "—" : value.toFixed(4);
}

function JobDetailModal({ initial, timezone, onClose }: {
  initial: TrainingJob;
  timezone: string;
  onClose: () => void;
}) {
  const { notifySuccess, notifyError } = useApiFeedback();
  const cancelMutation = useCancelTrainingJob();
  // Live data: progress keeps moving and Stop disappears once the job ends.
  const { data } = usePredictorJob(initial.job_id, initial);
  const job = data ?? initial;
  const isActive = ACTIVE_STATUSES.includes(job.status);
  const pct = jobPercent(job);
  const improved = job.new_mae != null && job.prev_mae != null && job.new_mae < job.prev_mae;

  const stop = () =>
    cancelMutation.mutate(job.job_id, {
      onSuccess: () => notifySuccess("Stopping job", "The job will stop shortly."),
      onError: (err) => notifyError("Could not stop the job", err),
    });

  return (
    <Modal title="Job details" open onClose={onClose} width="sm">
      <div className="train-detail">
        <div className="train-detail-section">
          <div className="train-detail-row"><span className="train-detail-label">House</span><span>{job.house_id}</span></div>
          <div className="train-detail-row"><span className="train-detail-label">Lane</span><span className="is-capitalized">{job.lane}</span></div>
          <div className="train-detail-row"><span className="train-detail-label">Model</span><span>{MODEL_LABELS[job.model_type ?? ""] ?? job.model_type ?? "—"}</span></div>
          <div className="train-detail-row"><span className="train-detail-label">Status</span><JobStatus status={job.status} /></div>
          <div className="train-detail-row"><span className="train-detail-label">Job ID</span><code className="train-detail-id">{job.job_id}</code></div>
        </div>

        <div className="train-detail-section">
          <div className="train-detail-row">
            <span className="train-detail-label">Progress</span>
            <span>{job.progress_current} / {job.progress_total} ({pct.toFixed(1)} %)</span>
          </div>
          <div className="predictor-progress-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="predictor-progress-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          {isActive && <div className="train-detail-row"><span className="train-detail-label">Time left</span><span>{job.eta ?? "—"}</span></div>}
          <div className="train-detail-row"><span className="train-detail-label">Elapsed</span><span>{fmtElapsed(job.elapsed_seconds ?? 0)}</span></div>
        </div>

        <div className="train-detail-section">
          <div className="train-detail-row"><span className="train-detail-label">Submitted</span><span className="is-muted">{formatJobTime(job.submitted_at, timezone)}</span></div>
          <div className="train-detail-row"><span className="train-detail-label">Started</span><span className="is-muted">{formatJobTime(job.started_at, timezone)}</span></div>
          <div className="train-detail-row"><span className="train-detail-label">Finished</span><span className="is-muted">{formatJobTime(job.finished_at, timezone)}</span></div>
        </div>

        <div className="train-detail-section">
          {job.result_message && (
            <div className="train-detail-row"><span className="train-detail-label">Result</span><span>{job.result_message}</span></div>
          )}
          <div className="train-detail-row">
            <span className="train-detail-label">Error (MAE)</span>
            <span>
              {fmtMae(job.prev_mae)} → <strong className={improved ? "is-improved" : undefined}>{fmtMae(job.new_mae)}</strong>
            </span>
          </div>
          <small className="is-muted">Current model → new model. Lower is better; the new model is used only if it is lower.</small>
        </div>

        {isActive && (
          <div className="train-detail-actions">
            <Button variant="danger" size="sm" onClick={stop} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? "Stopping…" : "Stop job"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── System resource meters ──────────────────────────────────────────────────

const METER_HISTORY_MAX = 40;

type MeterEntry = { cpu: number; ram_gb: number };

function MeterCard({ label, value, sub, tone, data, dataKey, domain, unit }: {
  label: string;
  value: string;
  sub: string;
  tone: "normal" | "warning" | "danger";
  data: MeterEntry[];
  dataKey: keyof MeterEntry;
  domain: [number, number];
  unit: string;
}) {
  const color = tone === "danger" ? "var(--danger)" : tone === "warning" ? "var(--warn)" : "var(--brand)";
  return (
    <div className={`sys-meter is-${tone}`}>
      <div className="sys-meter-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <YAxis domain={domain} hide />
            <Tooltip
              contentStyle={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: 8, fontSize: "0.7rem" }}
              formatter={(v) => [`${(+(v ?? 0)).toFixed(1)}${unit}`, label]}
              labelFormatter={() => ""}
            />
            <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#grad-${dataKey})`} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="sys-meter-content">
        <div className="sys-meter-label">{label}</div>
        <div className="sys-meter-value">{value}</div>
        <div className="sys-meter-sub">{sub}</div>
      </div>
    </div>
  );
}

function SystemMeters({ system, updatedAt }: { system: SystemInfo; updatedAt: number }) {
  const cpuPct = Math.min(system.cpu_percent / system.cpu_count, 100);
  const ramPct = system.ram_percent;
  // One point per poll, kept per mount; re-renders (opening a modal) add nothing.
  const [history, setHistory] = useState<MeterEntry[]>([]);
  useEffect(() => {
    setHistory((h) => [...h, { cpu: cpuPct, ram_gb: system.ram_used_gb }].slice(-METER_HISTORY_MAX));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt]);

  return (
    <div className="sys-meters-row" aria-label="Predictor container">
      <MeterCard
        label="CPU"
        value={`${cpuPct.toFixed(1)} %`}
        sub={`${system.cpu_count} cores · ${system.cpu_percent.toFixed(0)} % aggregate`}
        tone={cpuPct > 80 ? "danger" : cpuPct > 60 ? "warning" : "normal"}
        data={history}
        dataKey="cpu"
        domain={[0, 100]}
        unit=" %"
      />
      <MeterCard
        label="RAM"
        value={`${ramPct.toFixed(1)} %`}
        sub={`${system.ram_used_gb.toFixed(1)} / ${system.ram_total_gb.toFixed(0)} GB`}
        tone={ramPct > 85 ? "danger" : ramPct > 65 ? "warning" : "normal"}
        data={history}
        dataKey="ram_gb"
        domain={[0, system.ram_total_gb]}
        unit=" GB"
      />
    </div>
  );
}

export function TrainView({ selectedHouseId, timezone }: TrainViewProps) {
  const { notifySuccess, notifyError } = useApiFeedback();
  const { data: jobsData, dataUpdatedAt } = usePredictorTrainingProgress();
  const commandMutation = usePredictorCommand();

  const [showTrainDialog, setShowTrainDialog] = useState(false);
  const [showColdTrainDialog, setShowColdTrainDialog] = useState(false);
  const [detailJob, setDetailJob] = useState<TrainingJob | null>(null);
  const [historyScope, setHistoryScope] = useState<"all" | "house">("all");
  const [historyPage, setHistoryPage] = useState(0);

  const jobs = jobsData?.jobs;
  const systemInfo = jobsData?.system ?? null;
  const activeJobs = jobs?.filter((j) => ACTIVE_STATUSES.includes(j.status)) ?? [];
  const completedJobs = jobs?.filter((j) => !ACTIVE_STATUSES.includes(j.status)) ?? [];
  const lstmBusy = activeJobs.some((j) => j.model_type === "lstm");

  const scopedHistory = historyScope === "house" && selectedHouseId
    ? completedJobs.filter((j) => j.house_id === selectedHouseId)
    : completedJobs;
  const pageCount = Math.max(1, Math.ceil(scopedHistory.length / HISTORY_PAGE_SIZE));
  const page = Math.min(historyPage, pageCount - 1);
  const pageJobs = scopedHistory.slice(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE);

  const handleColdTrain = () => {
    commandMutation.mutate(
      { command: "train-cold", lane: "both" },
      {
        onSuccess: (res) => { notifySuccess("Cold-start training queued", res.message); setShowColdTrainDialog(false); },
        onError: (err) => notifyError("Training not started", err),
      }
    );
  };

  return (
    <div className="predictor-train-view">
      <div className="predictor-train-actions">
        <Button
          variant="primary"
          iconLeft={<PlusCircle size={15} />}
          onClick={() => setShowTrainDialog(true)}
          disabled={!selectedHouseId || commandMutation.isPending}
        >
          Train Selected House
        </Button>
        <Button
          variant="secondary"
          iconLeft={<RotateCcw size={15} />}
          onClick={() => setShowColdTrainDialog(true)}
          disabled={commandMutation.isPending}
        >
          Retrain Cold-Start Models
        </Button>
        <small className="predictor-train-note">Cold-start runs are not listed below yet; follow them in Logs.</small>
      </div>

      {systemInfo && <SystemMeters system={systemInfo} updatedAt={dataUpdatedAt} />}

      <div className="predictor-train-grid">
        <section className="panel predictor-jobs-panel">
          <div className="predictor-panel-header">
            <h2>Active Training Jobs</h2>
            {activeJobs.length > 0 && <Badge tone="info">{activeJobs.length} active</Badge>}
          </div>
          <div className="predictor-panel-body">
            {activeJobs.length === 0 ? (
              <EmptyState title="No active jobs" message="Start a training job above to see its progress here." />
            ) : (
              <table className="table predictor-jobs-table">
                <thead>
                  <tr>
                    <th>House</th>
                    <th>Lane</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th className="predictor-progress-col">Progress</th>
                    <th>Time left</th>
                  </tr>
                </thead>
                <tbody>
                  {activeJobs.map((job) => {
                    const pct = jobPercent(job);
                    return (
                      <tr key={job.job_id} className="is-clickable" tabIndex={0} onClick={() => setDetailJob(job)}
                        onKeyDown={(e) => { if (e.key === "Enter") setDetailJob(job); }}>
                        <td>{job.house_id}</td>
                        <td className="is-capitalized">{job.lane}</td>
                        <td>{MODEL_LABELS[job.model_type ?? ""] ?? job.model_type ?? "—"}</td>
                        <td><JobStatus status={job.status} /></td>
                        <td>
                          <div className="predictor-progress-cell">
                            <div className="predictor-progress-bar">
                              <div className="predictor-progress-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                            <span className="is-muted">{pct.toFixed(0)} %</span>
                          </div>
                        </td>
                        <td className="is-muted">{job.eta ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="panel predictor-jobs-panel">
          <div className="predictor-panel-header">
            <h2>Completed History</h2>
            <div className="predictor-lane-toggle" role="group" aria-label="Show jobs for">
              <button type="button" className={`predictor-lane-btn${historyScope === "all" ? " is-active" : ""}`}
                aria-pressed={historyScope === "all"} onClick={() => { setHistoryScope("all"); setHistoryPage(0); }}>
                All houses
              </button>
              <button type="button" className={`predictor-lane-btn${historyScope === "house" ? " is-active" : ""}`}
                aria-pressed={historyScope === "house"} disabled={!selectedHouseId}
                onClick={() => { setHistoryScope("house"); setHistoryPage(0); }}>
                {selectedHouseId ?? "This house"}
              </button>
            </div>
          </div>
          <div className="predictor-panel-body">
            {scopedHistory.length === 0 ? (
              <EmptyState title="No completed jobs" message="Finished training runs will appear here." />
            ) : (
              <table className="table predictor-jobs-table">
                <thead>
                  <tr>
                    <th>House</th>
                    <th>Lane</th>
                    <th>Model</th>
                    <th>Result</th>
                    <th>Error (MAE)</th>
                    <th>Finished</th>
                  </tr>
                </thead>
                <tbody>
                  {pageJobs.map((job) => {
                    const improved = job.new_mae != null && job.prev_mae != null && job.new_mae < job.prev_mae;
                    return (
                      <tr key={job.job_id} className="is-clickable" tabIndex={0} onClick={() => setDetailJob(job)}
                        onKeyDown={(e) => { if (e.key === "Enter") setDetailJob(job); }}>
                        <td>{job.house_id}</td>
                        <td className="is-capitalized">{job.lane}</td>
                        <td>{MODEL_LABELS[job.model_type ?? ""] ?? job.model_type ?? "—"}</td>
                        <td><JobStatus status={job.status} /></td>
                        <td className="predictor-mae-cell">
                          <span className="is-muted">{fmtMae(job.prev_mae)}</span> → <strong className={improved ? "is-improved" : undefined}>{fmtMae(job.new_mae)}</strong>
                        </td>
                        <td className="is-muted">{formatJobTime(job.finished_at, timezone)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {scopedHistory.length > HISTORY_PAGE_SIZE && (
            <div className="predictor-pager">
              <span className="is-muted">
                {page * HISTORY_PAGE_SIZE + 1}–{Math.min((page + 1) * HISTORY_PAGE_SIZE, scopedHistory.length)} of {scopedHistory.length}
              </span>
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setHistoryPage(page - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= pageCount - 1} onClick={() => setHistoryPage(page + 1)}>Next</Button>
            </div>
          )}
        </section>
      </div>

      {detailJob && <JobDetailModal initial={detailJob} timezone={timezone} onClose={() => setDetailJob(null)} />}

      <ConfirmDialog
        open={showColdTrainDialog}
        title="Retrain cold-start models"
        message="Retrains the shared cold-start models from every house's data, for both lanes. They are used when a house has no recent data or no model of its own. These runs do not appear in the job lists yet; follow them in Logs."
        confirmLabel="Start cold-start training"
        confirmVariant="primary"
        pending={commandMutation.isPending}
        onConfirm={handleColdTrain}
        onCancel={() => setShowColdTrainDialog(false)}
      />

      <TrainWizard
        open={showTrainDialog}
        houseId={selectedHouseId}
        lstmBusy={lstmBusy}
        onClose={() => setShowTrainDialog(false)}
      />
    </div>
  );
}
