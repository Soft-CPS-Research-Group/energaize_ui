import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import { getArchiveSummary, pruneArchive, type PruneOptions } from "../../../api/analysisApi";
import { BACKEND_LABELS, LANE_LABELS, fmtTs } from "./analysisFormat";

const PREVIEW_ROWS = 50;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Parses an optional whole-number field: "" is "not set", anything invalid is NaN. */
export function optionalCount(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

/**
 * Delete old archived model versions. Archived versions are what training
 * replaced; the models in use are never touched. Always shows what would go
 * before anything is deleted.
 */
export function ArchiveCleanupModal({ open, houses, timezone, onClose }: {
  open: boolean;
  houses: string[];
  timezone: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { notifySuccess, notifyError } = useApiFeedback();
  const [keep, setKeep] = useState("2");
  const [olderThan, setOlderThan] = useState("30");
  const [house, setHouse] = useState("all");

  const keepN = optionalCount(keep);
  const days = optionalCount(olderThan);
  const valid = !Number.isNaN(keepN) && !Number.isNaN(days) && (keepN != null || days != null);
  const options: PruneOptions = { keep_latest: keepN, older_than_days: days, house_id: house === "all" ? null : house };

  const summary = useQuery({ queryKey: ["analysis", "archive"], queryFn: getArchiveSummary, enabled: open });
  const preview = useQuery({
    queryKey: ["analysis", "archive", "preview", options],
    queryFn: () => pruneArchive(options, true),
    enabled: open && valid,
  });

  const prune = useMutation({
    mutationFn: () => pruneArchive(options, false),
    onSuccess: (res) => {
      notifySuccess("Archive cleaned", `Deleted ${res.count} archived ${res.count === 1 ? "model" : "models"}, freeing ${formatBytes(res.freed_bytes)}.`);
      queryClient.invalidateQueries({ queryKey: ["analysis", "archive"] });
      queryClient.invalidateQueries({ queryKey: ["analysis", "models"] });
      onClose();
    },
    onError: (err) => notifyError("Archive not cleaned", err),
  });

  const selected = preview.data?.models ?? [];

  return (
    <Modal title="Clean up archived models" open={open} onClose={onClose} width="lg">
      <div className="predictor-wizard-step">
        <p className="is-muted archive-cleanup-summary">
          {summary.data
            ? `${summary.data.count} archived ${summary.data.count === 1 ? "version" : "versions"} use ${formatBytes(summary.data.size_bytes)}.`
            : "Archived versions are the models training replaced."}{" "}
          Models in use are never deleted.
        </p>
        <div className="archive-cleanup-fields">
          <label className="analysis-filter-field">
            <span>Keep newest per model</span>
            <input type="number" min={0} step={1} value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="Any" aria-invalid={Number.isNaN(keepN)} />
          </label>
          <label className="analysis-filter-field">
            <span>Archived more than (days)</span>
            <input type="number" min={0} step={1} value={olderThan} onChange={(e) => setOlderThan(e.target.value)} placeholder="Any" aria-invalid={Number.isNaN(days)} />
          </label>
          <label className="analysis-filter-field">
            <span>House</span>
            <select className="predictor-house-select" value={house} onChange={(e) => setHouse(e.target.value)}>
              <option value="all">All houses</option>
              {houses.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
        </div>
        <small className="is-muted">
          {keepN != null && days != null
            ? `A version is deleted when it is not among the newest ${keepN} of its model and was archived more than ${days} days ago.`
            : keepN != null
              ? `Keeps the newest ${keepN} archived versions of each model.`
              : days != null
                ? `Deletes every version archived more than ${days} days ago.`
                : "Set at least one rule."}
        </small>

        <section className="retrain-all-plan" aria-label="To be deleted">
          <h4>To be deleted</h4>
          {!valid ? null : preview.isLoading ? (
            <p className="is-muted">Checking the archive…</p>
          ) : preview.isError ? (
            <p className="predictor-wizard-warning" role="alert">
              The preview could not be loaded ({(preview.error as Error)?.message || "unknown error"}). The predictor may be an older version without archive clean-up.
            </p>
          ) : selected.length === 0 ? (
            <p className="is-muted">Nothing matches these rules.</p>
          ) : (
            <>
              <p className="is-muted">{selected.length} {selected.length === 1 ? "version" : "versions"}, {formatBytes(preview.data?.freed_bytes ?? 0)}.</p>
              <div className="retrain-all-table-scroll">
                <table className="table predictor-jobs-table">
                  <thead>
                    <tr><th>House</th><th>Lane</th><th>Type</th><th>Archived</th><th className="is-num">Size</th></tr>
                  </thead>
                  <tbody>
                    {selected.slice(0, PREVIEW_ROWS).map((m) => (
                      <tr key={m.model_key} title={m.model_key}>
                        <td>{m.house_id ?? "Generic"}</td>
                        <td>{m.lane ? LANE_LABELS[m.lane] ?? m.lane : "—"}</td>
                        <td>{BACKEND_LABELS[m.model_backend] ?? m.model_backend}</td>
                        <td className="is-muted">{fmtTs(m.archived_at, timezone)}</td>
                        <td className="is-num is-muted">{formatBytes(m.size_bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selected.length > PREVIEW_ROWS && <p className="is-muted retrain-all-more">and {selected.length - PREVIEW_ROWS} more</p>}
              </div>
            </>
          )}
        </section>

        <div className="train-modal-footer">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => prune.mutate()} disabled={!valid || prune.isPending || preview.isLoading || selected.length === 0}>
            {prune.isPending ? "Deleting…" : selected.length ? `Delete ${selected.length} ${selected.length === 1 ? "version" : "versions"}` : "Delete"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
