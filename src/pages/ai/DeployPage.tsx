import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pause, Play, Upload, ArrowRightLeft, RefreshCcw, Trash2 } from "lucide-react";
import {
  deleteDeployBundle,
  getDeployInferenceHealth,
  listDeployBundleFiles,
  listDeployBundles,
  listDeployInferences,
  openDeployLogsStream,
  readDeployBundleFileContent,
  switchDeployInferenceBundle,
  uploadDeployBundleFolder,
  type DeployBundleRecord,
  type DeployInferenceHealth,
  type DeployInferenceTarget
} from "../../api/deployApi";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";
import { Modal } from "../../components/ui/Modal";
import { useApiFeedback } from "../../hooks/useApiFeedback";

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

function summarizeHealth(health: DeployInferenceHealth | null): { label: string; cssClass: string } {
  if (!health) {
    return { label: "loading", cssClass: "is-loading" };
  }
  if (!health.reachable) {
    return { label: "offline", cssClass: "is-unhealthy" };
  }
  if (!health.configured) {
    return { label: "unconfigured", cssClass: "is-unhealthy" };
  }
  return { label: health.healthy ? "healthy" : "unhealthy", cssClass: health.healthy ? "is-healthy" : "is-unhealthy" };
}

function bundleDisplayName(bundle: DeployBundleRecord | null | undefined): string {
  const candidate = bundle?.name?.trim();
  if (candidate) return candidate;
  return bundle?.bundle_id || "-";
}

function isBundlePreviewFile(path: string): boolean {
  const normalized = String(path || "").replace(/\\/g, "/").toLowerCase();
  const fileName = normalized.split("/").pop() || normalized;
  if (fileName === "artifact_manifest.json") return true;
  if (fileName === "aliases.json") return true;
  if (fileName.startsWith("policy_agent")) return true;
  return false;
}

function bundleStorageKey(bundle: DeployBundleRecord): string {
  const key = bundle.storage_dir_name?.trim();
  return key || bundle.bundle_id;
}

function findBundleByManifestKey(bundles: DeployBundleRecord[], key: string | null): DeployBundleRecord | null {
  if (!key) return null;
  return bundles.find((bundle) => bundle.bundle_id === key || bundleStorageKey(bundle) === key) || null;
}

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "-";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isHealthNoiseLogLine(line: string): boolean {
  const normalized = String(line || "").toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('"get /health http/1.1"')) return true;
  if (normalized.includes("| get /health |")) return true;
  return false;
}

function formatLogsForDisplay(
  raw: string,
  options: { hideHealthNoise: boolean; markInferenceCycles: boolean }
): string {
  if (!raw) return raw;
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    if (options.hideHealthNoise && isHealthNoiseLogLine(line)) {
      continue;
    }

    if (options.markInferenceCycles && line.includes("| POST /inference | rbc.summary")) {
      const requestIdMatch = line.match(/request_id=([^|]+)/);
      const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2} [^|]+)/);
      const requestId = requestIdMatch?.[1]?.trim() || "-";
      const timestamp = timeMatch?.[1]?.trim();
      out.push("");
      out.push(`========== Inference Cycle (${requestId}${timestamp ? ` @ ${timestamp}` : ""}) ==========` );
    }

    out.push(line);
  }

  return out.join("\n");
}

export function DeployPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { notifyError, notifyInfo, notifySuccess } = useApiFeedback();

  const [logsOpen, setLogsOpen] = useState(false);
  const [logsTarget, setLogsTarget] = useState<DeployInferenceTarget | null>(null);
  const [logsText, setLogsText] = useState("");
  const [logsStreaming, setLogsStreaming] = useState(false);
  const [logsPaused, setLogsPaused] = useState(false);
  const [logsAutoScroll, setLogsAutoScroll] = useState(true);
  const [logsHideHealthNoise, setLogsHideHealthNoise] = useState(true);
  const [logsMarkInferenceCycles, setLogsMarkInferenceCycles] = useState(true);
  const [refreshingVisual, setRefreshingVisual] = useState(false);

  const [switchTarget, setSwitchTarget] = useState<DeployInferenceTarget | null>(null);
  const [switchBundleId, setSwitchBundleId] = useState("");

  const [deleteTargetBundle, setDeleteTargetBundle] = useState<DeployBundleRecord | null>(null);
  const [bundleDetailsTarget, setBundleDetailsTarget] = useState<DeployBundleRecord | null>(null);
  const [selectedBundleFilePath, setSelectedBundleFilePath] = useState("");

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

  const bundleDetailsFilesQuery = useQuery({
    queryKey: ["deploy-bundle-files", bundleDetailsTarget?.bundle_id],
    queryFn: () => listDeployBundleFiles(bundleDetailsTarget!.bundle_id),
    enabled: Boolean(bundleDetailsTarget)
  });

  const bundleDetailsFileContentQuery = useQuery({
    queryKey: ["deploy-bundle-content", bundleDetailsTarget?.bundle_id, selectedBundleFilePath],
    queryFn: () => readDeployBundleFileContent(bundleDetailsTarget!.bundle_id, selectedBundleFilePath),
    enabled: Boolean(bundleDetailsTarget && selectedBundleFilePath)
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
      const bundles = bundlesQuery.data || [];
      const matchedBundle = bundles.find((item) => item.bundle_id === result.bundle_id);
      notifySuccess("Bundle switched", `${result.target_id} now running ${bundleDisplayName(matchedBundle)}.`);
      setSwitchTarget(null);
      setSwitchBundleId("");
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
        `${bundleDisplayName(payload.bundle)} is ready.`
      );
      queryClient.invalidateQueries({ queryKey: ["deploy-bundles"] });
    },
    onError: (error) => notifyError("Failed to upload folder", error)
  });

  const deleteMutation = useMutation({
    mutationFn: async (bundleId: string) => deleteDeployBundle(bundleId),
    onSuccess: (payload) => {
      notifyInfo("Bundle removed", `${payload.bundle_id} removed from catalog.`);
      setDeleteTargetBundle(null);
      if (bundleDetailsTarget?.bundle_id === payload.bundle_id) {
        setBundleDetailsTarget(null);
        setSelectedBundleFilePath("");
      }
      queryClient.invalidateQueries({ queryKey: ["deploy-bundles"] });
    },
    onError: (error) => notifyError("Failed to delete bundle", error)
  });

  const targets = targetsQuery.data || [];
  const bundles = bundlesQuery.data || [];
  const selectedSwitchBundle = bundles.find((bundle) => bundle.bundle_id === switchBundleId) || null;
  const visibleBundleFiles = useMemo(
    () => (bundleDetailsFilesQuery.data?.files || []).filter((file) => isBundlePreviewFile(file.path)),
    [bundleDetailsFilesQuery.data]
  );
  const renderedLogsText = useMemo(
    () =>
      formatLogsForDisplay(logsText, {
        hideHealthNoise: logsHideHealthNoise,
        markInferenceCycles: logsMarkInferenceCycles
      }),
    [logsText, logsHideHealthNoise, logsMarkInferenceCycles]
  );
  const logsStatusLabel = logsStreaming ? "Live" : logsPaused ? "Paused" : "Idle";
  const logsStatusClass = logsStreaming ? "is-live" : logsPaused ? "is-paused" : "is-idle";

  useEffect(() => {
    if (!fileInputRef.current) return;
    fileInputRef.current.setAttribute("webkitdirectory", "");
    fileInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (!logsOpen || !logsAutoScroll) return;
    const pre = logsPreRef.current;
    if (!pre) return;
    pre.scrollTop = pre.scrollHeight;
  }, [renderedLogsText, logsOpen, logsAutoScroll]);

  useEffect(() => {
    return () => {
      logsAbortRef.current?.abort();
      logsAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    setSelectedBundleFilePath("");
  }, [bundleDetailsTarget?.bundle_id]);

  useEffect(() => {
    const files = visibleBundleFiles;
    if (files.length === 0) {
      setSelectedBundleFilePath("");
      return;
    }
    if (!selectedBundleFilePath || !files.some((entry) => entry.path === selectedBundleFilePath)) {
      setSelectedBundleFilePath(files[0].path);
    }
  }, [visibleBundleFiles, selectedBundleFilePath]);

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

  function openBundleDetails(bundle: DeployBundleRecord): void {
    setBundleDetailsTarget(bundle);
  }

  function openBundleDetailsById(bundleId: string): void {
    const inCatalog = findBundleByManifestKey(bundles, bundleId);
    if (inCatalog) {
      openBundleDetails(inCatalog);
      return;
    }
    notifyInfo("Bundle not in catalog", `Active bundle ${bundleId} is not available in the catalog list.`);
    setBundleDetailsTarget({
      bundle_id: bundleId,
      name: bundleId,
      artifacts_dir_host: "",
      manifest_path_host: ""
    });
  }

  function closeBundleDetails(): void {
    setBundleDetailsTarget(null);
    setSelectedBundleFilePath("");
  }

  function openSwitchModal(target: DeployInferenceTarget, activeBundleId: string | null): void {
    if (bundles.length === 0) {
      notifyInfo("No bundles available", "Upload at least one bundle before switching.");
      return;
    }
    const activeBundle = findBundleByManifestKey(bundles, activeBundleId);
    const preferred = activeBundle?.bundle_id || bundles[0].bundle_id;
    setSwitchTarget(target);
    setSwitchBundleId(preferred);
  }

  function closeSwitchModal(): void {
    setSwitchTarget(null);
    setSwitchBundleId("");
  }

  function confirmSwitchBundle(): void {
    if (!switchTarget || !switchBundleId) return;
    switchMutation.mutate({
      targetId: switchTarget.id,
      bundleId: switchBundleId
    });
  }

  function onSelectFolderFiles(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    uploadMutation.mutate(files);
    event.target.value = "";
  }

  async function refreshWithPreview(): Promise<void> {
    if (refreshingVisual) return;
    setRefreshingVisual(true);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["deploy-targets"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["deploy-bundles"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["deploy-health"], type: "active" })
      ]);
    } finally {
      setRefreshingVisual(false);
    }
  }

  return (
    <div className="page jobs-page">
      <header className="jobs-hero">
        <div>
          <h1>Deploy</h1>
        </div>
        <div className="jobs-command-group">
          <Button
            variant="secondary"
            iconLeft={!refreshingVisual ? <RefreshCcw size={14} /> : undefined}
            onClick={refreshWithPreview}
            disabled={refreshingVisual}
          >
            {refreshingVisual ? <EVChargingLoader compact label="Refreshing..." /> : "Refresh"}
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
                    <th>Health</th>
                    <th>Active Bundle</th>
                    <th className="deploy-actions-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((target) => {
                    const health = healthByTargetId.get(target.id) || null;
                    const summary = summarizeHealth(health);
                    const activeBundleId = extractBundleIdFromManifestPath(health?.active_manifest_path);
                    const activeBundle = findBundleByManifestKey(bundles, activeBundleId);

                    return (
                      <tr key={target.id}>
                        <td>
                          <div className="deploy-target-name">
                            <strong>{target.name}</strong>
                          </div>
                        </td>
                        <td>
                          <span className={`deploy-health-pill ${summary.cssClass}`}>{summary.label}</span>
                        </td>
                        <td>
                          {activeBundleId ? (
                            <button
                              type="button"
                              className="btn-link deploy-active-bundle-link"
                              onClick={() => openBundleDetailsById(activeBundleId)}
                              title={`See bundle details: ${activeBundleId}`}
                            >
                              {bundleDisplayName(activeBundle || undefined)}
                            </button>
                          ) : (
                            <span>-</span>
                          )}
                        </td>
                        <td className="deploy-actions-cell">
                          <div className="table-actions deploy-manager-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              iconLeft={<ArrowRightLeft size={13} />}
                              onClick={() => openSwitchModal(target, activeBundleId)}
                              disabled={switchMutation.isPending || bundles.length === 0}
                            >
                              Switch
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              iconLeft={<Eye size={13} />}
                              onClick={() => openLogsForTarget(target)}
                            >
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
            <h2>Bundles</h2>
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
                    <th className="deploy-actions-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bundles.map((bundle) => (
                    <tr key={bundle.bundle_id}>
                      <td>
                        <div className="deploy-bundle-name">
                          <strong>{bundleDisplayName(bundle)}</strong>
                          <small>{bundle.bundle_id}</small>
                        </div>
                      </td>
                      <td className="deploy-actions-cell">
                        <div className="table-actions deploy-bundle-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`See more details for ${bundleDisplayName(bundle)}`}
                            title="See more"
                            onClick={() => openBundleDetails(bundle)}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn-danger"
                            aria-label={`Delete ${bundleDisplayName(bundle)}`}
                            title="Delete"
                            onClick={() => setDeleteTargetBundle(bundle)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
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
        title={`Switch Bundle: ${switchTarget?.name || "-"}`}
        open={Boolean(switchTarget)}
        onClose={() => {
          if (!switchMutation.isPending) closeSwitchModal();
        }}
        width="sm"
      >
        <section className="deploy-switch-modal">
          <p className="jobs-meta">
            Select the bundle to activate on <strong>{switchTarget?.name || "-"}</strong>.
          </p>
          <label className="deploy-switch-field">
            <span>Bundle</span>
            <select value={switchBundleId} onChange={(event) => setSwitchBundleId(event.target.value)}>
              {bundles.map((bundle) => (
                <option key={bundle.bundle_id} value={bundle.bundle_id}>
                  {bundleDisplayName(bundle)}
                </option>
              ))}
            </select>
          </label>
          <div className="deploy-switch-selected">
            <small>Selected bundle</small>
            <strong>{bundleDisplayName(selectedSwitchBundle)}</strong>
            <code>{selectedSwitchBundle?.bundle_id || "-"}</code>
          </div>
          <div className="inline-end deploy-switch-actions">
            <Button variant="secondary" onClick={closeSwitchModal} disabled={switchMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={confirmSwitchBundle}
              disabled={!switchBundleId || switchMutation.isPending}
            >
              {switchMutation.isPending ? "Switching..." : "Confirm Switch"}
            </Button>
          </div>
        </section>
      </Modal>

      <Modal
        title={`Bundle: ${bundleDisplayName(bundleDetailsTarget || undefined)}`}
        open={Boolean(bundleDetailsTarget)}
        onClose={closeBundleDetails}
        width="lg"
      >
        <section className="deploy-bundle-modal-content">
          <div className="deploy-bundle-meta">
            <div>
              <small>Name</small>
              <strong>{bundleDisplayName(bundleDetailsTarget || undefined)}</strong>
            </div>
            <div>
              <small>ID</small>
              <code>{bundleDetailsTarget?.bundle_id || "-"}</code>
            </div>
          </div>

          <div className="deploy-bundle-browser">
            <aside className="deploy-bundle-files-list">
              {bundleDetailsFilesQuery.isLoading ? <p className="jobs-meta">Loading files...</p> : null}
              {bundleDetailsFilesQuery.isError ? (
                <p className="error-text">Could not load bundle files.</p>
              ) : null}
              {!bundleDetailsFilesQuery.isLoading &&
              !bundleDetailsFilesQuery.isError &&
              visibleBundleFiles.length === 0 ? (
                <p className="jobs-meta">No supported files found for this bundle.</p>
              ) : null}
              <ul>
                {visibleBundleFiles.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={`deploy-bundle-file-btn${selectedBundleFilePath === file.path ? " is-active" : ""}`}
                      onClick={() => setSelectedBundleFilePath(file.path)}
                    >
                      <span>{file.path}</span>
                      <small>{formatBytes(file.size_bytes)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>

            <section className="deploy-bundle-file-preview">
              {!selectedBundleFilePath ? <p className="jobs-meta">Select a file to preview.</p> : null}
              {selectedBundleFilePath && bundleDetailsFileContentQuery.isLoading ? (
                <p className="jobs-meta">Loading file content...</p>
              ) : null}
              {selectedBundleFilePath && bundleDetailsFileContentQuery.isError ? (
                <p className="error-text">Could not load file content.</p>
              ) : null}
              {selectedBundleFilePath &&
              bundleDetailsFileContentQuery.data &&
              !bundleDetailsFileContentQuery.data.is_text ? (
                <p className="jobs-meta">Binary file preview is not available.</p>
              ) : null}
              {selectedBundleFilePath &&
              bundleDetailsFileContentQuery.data &&
              bundleDetailsFileContentQuery.data.is_text &&
              bundleDetailsFileContentQuery.data.content !== null ? (
                <>
                  <pre className="json-view deploy-bundle-file-content">
                    {bundleDetailsFileContentQuery.data.content}
                  </pre>
                  {bundleDetailsFileContentQuery.data.truncated ? (
                    <small className="jobs-meta">Preview truncated to 200 KB.</small>
                  ) : null}
                </>
              ) : null}
            </section>
          </div>
        </section>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTargetBundle)}
        title="Delete Bundle"
        message={
          deleteTargetBundle
            ? `Are you sure you want to delete "${bundleDisplayName(deleteTargetBundle)}"?`
            : "Are you sure you want to delete this bundle?"
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        pending={deleteMutation.isPending}
        onCancel={() => {
          if (!deleteMutation.isPending) setDeleteTargetBundle(null);
        }}
        onConfirm={() => {
          if (!deleteTargetBundle) return;
          deleteMutation.mutate(deleteTargetBundle.bundle_id);
        }}
      />

      <Modal
        title={`Inference Logs: ${logsTarget?.name || "-"}`}
        open={logsOpen}
        onClose={closeLogsModal}
        width="lg"
      >
        <section className="deploy-logs-modal-content">
          <div className="deploy-logs-toolbar">
            <div className="deploy-logs-toolbar-main">
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
              <div className={`deploy-logs-status ${logsStatusClass}`}>
                <span className="deploy-logs-status-dot" aria-hidden="true" />
                <span>{logsStatusLabel}</span>
              </div>
            </div>
            <div className="deploy-logs-toolbar-toggles">
              <label className="deploy-logs-toggle">
                <input
                  type="checkbox"
                  checked={logsAutoScroll}
                  onChange={(event) => setLogsAutoScroll(event.target.checked)}
                />
                Auto-scroll
              </label>
              <label className="deploy-logs-toggle">
                <input
                  type="checkbox"
                  checked={logsHideHealthNoise}
                  onChange={(event) => setLogsHideHealthNoise(event.target.checked)}
                />
                Hide health logs
              </label>
              <label className="deploy-logs-toggle">
                <input
                  type="checkbox"
                  checked={logsMarkInferenceCycles}
                  onChange={(event) => setLogsMarkInferenceCycles(event.target.checked)}
                />
                Mark inference cycles
              </label>
            </div>
          </div>

          <pre ref={logsPreRef} className="json-view deploy-logs-view" role="log" aria-live="polite">
            {renderedLogsText || "No logs received yet."}
          </pre>
        </section>
      </Modal>
    </div>
  );
}
