import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pause, Play, RefreshCcw, Trash2, Upload } from "lucide-react";
import {
  deleteDeployBundle,
  getDeployInferenceHealth,
  listDeployBundles,
  listDeployInferences,
  openDeployLogsStream,
  switchDeployInferenceBundle,
  uploadDeployBundleFolder,
  type DeployBundleRecord,
  type DeployInferenceHealth,
  type DeployInferenceTarget
} from "../../api/deployApi";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { useApiFeedback } from "../../hooks/useApiFeedback";
import { formatDateTime } from "../../utils/time";

const HEALTH_POLL_MS = 5000;
const TARGETS_POLL_MS = 15000;
const BUNDLES_POLL_MS = 10000;
const DEFAULT_LOG_TAIL = 200;
const LOG_BUFFER_MAX_CHARS = 200000;

function extractBundleIdFromManifestPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\/g, "/");
  const match = normalized.match(/\/([^/]+)\/artifact_manifest\.json$/);
  return match ? match[1] : null;
}

function summarizeHealth(health: DeployInferenceHealth | null): {
  reachability: string;
  health: string;
  cssReachability: string;
  cssHealth: string;
} {
  if (!health) {
    return {
      reachability: "loading",
      health: "loading",
      cssReachability: "is-loading",
      cssHealth: "is-loading"
    };
  }
  if (!health.reachable) {
    return {
      reachability: "offline",
      health: "unreachable",
      cssReachability: "is-offline",
      cssHealth: "is-offline"
    };
  }

  return {
    reachability: "online",
    health: health.healthy ? "healthy" : "unhealthy",
    cssReachability: "is-online",
    cssHealth: health.healthy ? "is-healthy" : "is-unhealthy"
  };
}

export function DeployPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { notifyError, notifyInfo, notifySuccess } = useApiFeedback();

  const [selectedBundleByTarget, setSelectedBundleByTarget] = useState<Record<string, string>>({});
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsTarget, setLogsTarget] = useState<DeployInferenceTarget | null>(null);
  const [logsText, setLogsText] = useState("");
  const [logsStreaming, setLogsStreaming] = useState(false);
  const [logsPaused, setLogsPaused] = useState(false);
  const [logsAutoScroll, setLogsAutoScroll] = useState(true);

  const logsAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logsPreRef = useRef<HTMLPreElement | null>(null);

  const targetsQuery = useQuery({
    queryKey: ["deploy-targets"],
    queryFn: listDeployInferences,
    refetchInterval: TARGETS_POLL_MS
  });

  const bundlesQuery = useQuery({
    queryKey: ["deploy-bundles"],
    queryFn: listDeployBundles,
    refetchInterval: BUNDLES_POLL_MS
  });

  const healthQueries = useQueries({
    queries: (targetsQuery.data || []).map((target) => ({
      queryKey: ["deploy-health", target.id],
      queryFn: () => getDeployInferenceHealth(target.id),
      enabled: Boolean(targetsQuery.data),
      refetchInterval: HEALTH_POLL_MS
    }))
  });

  const healthByTargetId = useMemo(() => {
    const next = new Map<string, DeployInferenceHealth | null>();
    (targetsQuery.data || []).forEach((target, index) => {
      next.set(target.id, (healthQueries[index]?.data as DeployInferenceHealth | undefined) || null);
    });
    return next;
  }, [targetsQuery.data, healthQueries]);

  const switchMutation = useMutation({
    mutationFn: async (payload: { targetId: string; bundleId: string }) =>
      switchDeployInferenceBundle(payload.targetId, payload.bundleId),
    onSuccess: (result) => {
      notifySuccess("Bundle switched", `${result.target_id} now running ${result.bundle_id}.`);
      queryClient.invalidateQueries({ queryKey: ["deploy-health", result.target_id] });
      queryClient.invalidateQueries({ queryKey: ["deploy-targets"] });
    },
    onError: (error) => notifyError("Failed to switch bundle", error)
  });

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => uploadDeployBundleFolder(files),
    onSuccess: (payload) => {
      notifySuccess(
        payload.created ? "Bundle uploaded" : "Bundle already available",
        `Bundle ${payload.bundle.bundle_id} is ready.`
      );
      queryClient.invalidateQueries({ queryKey: ["deploy-bundles"] });
    },
    onError: (error) => notifyError("Failed to upload folder", error)
  });

  const deleteMutation = useMutation({
    mutationFn: async (bundleId: string) => deleteDeployBundle(bundleId),
    onSuccess: (payload) => {
      notifyInfo("Bundle removed", `${payload.bundle_id} removed from catalog.`);
      queryClient.invalidateQueries({ queryKey: ["deploy-bundles"] });
    },
    onError: (error) => notifyError("Failed to delete bundle", error)
  });

  useEffect(() => {
    if (!fileInputRef.current) return;
    fileInputRef.current.setAttribute("webkitdirectory", "");
    fileInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    const bundles = bundlesQuery.data || [];
    if (bundles.length === 0 || !targetsQuery.data) return;

    setSelectedBundleByTarget((previous) => {
      const next = { ...previous };
      targetsQuery.data?.forEach((target) => {
        if (next[target.id]) return;
        const health = healthByTargetId.get(target.id);
        const activeBundleId = extractBundleIdFromManifestPath(health?.active_manifest_path);
        const fallback = bundles[0]?.bundle_id || "";
        next[target.id] =
          (activeBundleId && bundles.some((bundle) => bundle.bundle_id === activeBundleId) && activeBundleId) ||
          fallback;
      });
      return next;
    });
  }, [bundlesQuery.data, healthByTargetId, targetsQuery.data]);

  useEffect(() => {
    if (!logsOpen || !logsAutoScroll) return;
    const pre = logsPreRef.current;
    if (!pre) return;
    pre.scrollTop = pre.scrollHeight;
  }, [logsText, logsOpen, logsAutoScroll]);

  useEffect(() => {
    return () => {
      logsAbortRef.current?.abort();
      logsAbortRef.current = null;
    };
  }, []);

  async function startLogsStream(target: DeployInferenceTarget): Promise<void> {
    logsAbortRef.current?.abort();
    const controller = new AbortController();
    logsAbortRef.current = controller;

    setLogsStreaming(true);
    try {
      const response = await openDeployLogsStream(target.id, DEFAULT_LOG_TAIL, controller.signal);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No log stream available from backend.");

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        setLogsText((previous) => {
          const next = `${previous}${chunk}`;
          if (next.length <= LOG_BUFFER_MAX_CHARS) return next;
          return next.slice(next.length - LOG_BUFFER_MAX_CHARS);
        });
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      notifyError("Could not stream inference logs", error);
    } finally {
      setLogsStreaming(false);
    }
  }

  function closeLogsModal(): void {
    logsAbortRef.current?.abort();
    logsAbortRef.current = null;
    setLogsOpen(false);
    setLogsTarget(null);
    setLogsStreaming(false);
    setLogsPaused(false);
  }

  function openLogsForTarget(target: DeployInferenceTarget): void {
    setLogsTarget(target);
    setLogsText("");
    setLogsPaused(false);
    setLogsOpen(true);
    void startLogsStream(target);
  }

  function toggleLogsPauseResume(): void {
    if (!logsTarget) return;

    if (logsPaused) {
      setLogsPaused(false);
      void startLogsStream(logsTarget);
      return;
    }

    logsAbortRef.current?.abort();
    logsAbortRef.current = null;
    setLogsPaused(true);
    setLogsStreaming(false);
  }

  function onSelectFolderFiles(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    uploadMutation.mutate(files);
    event.target.value = "";
  }

  function onDeleteBundle(bundle: DeployBundleRecord): void {
    const ok = window.confirm(`Remove bundle ${bundle.bundle_id} from catalog?`);
    if (!ok) return;
    deleteMutation.mutate(bundle.bundle_id);
  }

  const targets = targetsQuery.data || [];
  const bundles = bundlesQuery.data || [];

  return (
    <div className="page jobs-page">
      <header className="jobs-hero">
        <div>
          <h1>Deploy</h1>
        </div>
        <div className="jobs-command-group">
          <Button
            variant="secondary"
            iconLeft={<RefreshCcw size={14} />}
            onClick={() => {
              targetsQuery.refetch();
              bundlesQuery.refetch();
              queryClient.invalidateQueries({ queryKey: ["deploy-health"] });
            }}
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            iconLeft={<Upload size={14} />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            {uploadMutation.isPending ? "Uploading..." : "Add bundle folder"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={onSelectFolderFiles}
            style={{ display: "none" }}
          />
        </div>
      </header>

      <section className="deploy-manager-layout">
        <article className="panel deploy-manager-main">
          <header className="deploy-manager-panel-head">
            <h2>Running Inferences</h2>
            <small>{targets.length} configured targets</small>
          </header>

          {targets.length === 0 ? (
            <EmptyState title="No inference targets" message="Configure DEPLOY_INFERENCE_TARGETS in backend settings." />
          ) : (
            <div className="deploy-manager-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Reachability</th>
                    <th>Health</th>
                    <th>Active Bundle</th>
                    <th>Switch To</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((target) => {
                    const health = healthByTargetId.get(target.id) || null;
                    const summary = summarizeHealth(health);
                    const activeBundleId = extractBundleIdFromManifestPath(health?.active_manifest_path);
                    const selectedBundle = selectedBundleByTarget[target.id] || "";

                    return (
                      <tr key={target.id}>
                        <td>
                          <div className="deploy-target-name">
                            <strong>{target.name}</strong>
                            <small>{target.id}</small>
                          </div>
                        </td>
                        <td>
                          <span className={`deploy-health-pill ${summary.cssReachability}`}>{summary.reachability}</span>
                        </td>
                        <td>
                          <span className={`deploy-health-pill ${summary.cssHealth}`}>{summary.health}</span>
                        </td>
                        <td>
                          <code>{activeBundleId || "-"}</code>
                        </td>
                        <td>
                          <select
                            value={selectedBundle}
                            onChange={(event) =>
                              setSelectedBundleByTarget((previous) => ({
                                ...previous,
                                [target.id]: event.target.value
                              }))
                            }
                          >
                            {bundles.length === 0 ? <option value="">No bundles</option> : null}
                            {bundles.map((bundle) => (
                              <option key={bundle.bundle_id} value={bundle.bundle_id}>
                                {bundle.bundle_id}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div className="table-actions deploy-manager-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => queryClient.invalidateQueries({ queryKey: ["deploy-health", target.id] })}
                            >
                              Refresh
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                switchMutation.mutate({
                                  targetId: target.id,
                                  bundleId: selectedBundle
                                })
                              }
                              disabled={!selectedBundle || switchMutation.isPending}
                            >
                              Switch
                            </Button>
                            <Button size="sm" variant="ghost" iconLeft={<Eye size={13} />} onClick={() => openLogsForTarget(target)}>
                              Logs
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <aside className="panel deploy-manager-side">
          <header className="deploy-manager-panel-head">
            <h2>Bundles in Memory</h2>
            <small>{bundles.length} bundles</small>
          </header>

          {bundles.length === 0 ? (
            <p className="jobs-meta">No bundles uploaded yet.</p>
          ) : (
            <div className="deploy-manager-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Bundle</th>
                    <th>Files</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bundles.map((bundle) => (
                    <tr key={bundle.bundle_id}>
                      <td>
                        <div className="deploy-bundle-name">
                          <strong>{bundle.bundle_id}</strong>
                          <small>{bundle.name || "bundle"}</small>
                        </div>
                      </td>
                      <td>{bundle.file_count ?? "-"}</td>
                      <td>{formatDateTime(bundle.created_at || null)}</td>
                      <td>
                        <Button
                          size="sm"
                          variant="danger"
                          iconLeft={<Trash2 size={13} />}
                          onClick={() => onDeleteBundle(bundle)}
                          disabled={deleteMutation.isPending}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </aside>
      </section>

      <Modal
        title={`Inference Logs: ${logsTarget?.name || "-"}`}
        open={logsOpen}
        onClose={closeLogsModal}
        width="lg"
      >
        <section className="deploy-logs-modal-content">
          <div className="deploy-logs-toolbar">
            <div className="deploy-logs-actions">
              <Button
                size="sm"
                variant="secondary"
                iconLeft={logsPaused ? <Play size={13} /> : <Pause size={13} />}
                onClick={toggleLogsPauseResume}
                disabled={!logsTarget}
              >
                {logsPaused ? "Resume" : "Pause"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLogsText("")}>
                Clear
              </Button>
            </div>

            <label className="deploy-logs-toggle">
              <input
                type="checkbox"
                checked={logsAutoScroll}
                onChange={(event) => setLogsAutoScroll(event.target.checked)}
              />
              Auto-scroll
            </label>

            <small className="jobs-meta">{logsStreaming ? "Streaming..." : logsPaused ? "Paused" : "Idle"}</small>
          </div>

          <pre ref={logsPreRef} className="json-view compact deploy-logs-view" role="log" aria-live="polite">
            {logsText || "No logs received yet."}
          </pre>
        </section>
      </Modal>
    </div>
  );
}
