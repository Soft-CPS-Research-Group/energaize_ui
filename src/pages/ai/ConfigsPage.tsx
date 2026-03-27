import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus, RefreshCcw, Trash2 } from "lucide-react";
import {
  deleteExperimentConfig,
  getExperimentConfig,
  listExperimentConfigs,
  saveExperimentConfig
} from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { useApiFeedback } from "../../hooks/useApiFeedback";
import { useSearchParams } from "react-router-dom";

const DEFAULT_CONFIG = `{
  "metadata": {
    "experiment_name": "Solar Forecast",
    "run_name": "baseline_v1"
  },
  "algorithm": {
    "name": "MADDPG",
    "seed": 42
  }
}`;

type EditorMode = "create" | "edit";

export function ConfigsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { notifyError, notifySuccess, notifyInfo } = useApiFeedback();
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenHandledRef = useRef<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [editorLoading, setEditorLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [refreshingVisual, setRefreshingVisual] = useState(false);
  const [fileName, setFileName] = useState("demo.yaml");
  const [templateFile, setTemplateFile] = useState("");
  const [configText, setConfigText] = useState(DEFAULT_CONFIG);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const configsQuery = useQuery({
    queryKey: ["configs"],
    queryFn: listExperimentConfigs
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { file_name: string; config: Record<string, unknown> }) =>
      saveExperimentConfig(payload),
    onSuccess: (_, payload) => {
      notifySuccess(
        editorMode === "edit" ? "Experiment config updated" : "Experiment config saved",
        `${payload.file_name} stored in backend.`
      );
      setEditorOpen(false);
      queryClient.invalidateQueries({ queryKey: ["configs"] });
    },
    onError: (error) => notifyError("Failed to save experiment config", error)
  });

  const deleteMutation = useMutation({
    mutationFn: (target: string) => deleteExperimentConfig(target),
    onSuccess: () => {
      notifyInfo("Experiment config deleted", "Experiment config removed from backend.");
      queryClient.invalidateQueries({ queryKey: ["configs"] });
    },
    onError: (error) => notifyError("Failed to delete experiment config", error)
  });

  function openNewEditor(): void {
    setEditorMode("create");
    setFileName("demo.yaml");
    setTemplateFile("");
    setConfigText(DEFAULT_CONFIG);
    setEditorLoading(false);
    if (searchParams.get("file")) {
      const next = new URLSearchParams(searchParams);
      next.delete("file");
      setSearchParams(next, { replace: true });
    }
    setEditorOpen(true);
  }

  async function openExistingEditor(configFile: string): Promise<void> {
    setEditorMode("edit");
    setEditorLoading(true);
    setFileName(configFile);
    setTemplateFile("");
    setEditorOpen(true);
    try {
      const payload = await getExperimentConfig(configFile);
      setConfigText(JSON.stringify(payload.config || {}, null, 2));
    } catch (error) {
      notifyError("Failed to open experiment config", error);
      setEditorOpen(false);
    } finally {
      setEditorLoading(false);
    }
  }

  useEffect(() => {
    const requestedFile = searchParams.get("file");
    if (!requestedFile) {
      autoOpenHandledRef.current = null;
      return;
    }
    if (!requestedFile || !configsQuery.data || editorOpen || editorLoading) return;
    if (autoOpenHandledRef.current === requestedFile) return;

    const directMatch = configsQuery.data.find((item) => item === requestedFile);
    const fallbackByBasename = configsQuery.data.find((item) => {
      const normalized = requestedFile.split(/[\\/]/).filter(Boolean);
      const base = normalized[normalized.length - 1] || requestedFile;
      return item === base;
    });

    const target = directMatch || fallbackByBasename;
    if (!target) return;

    autoOpenHandledRef.current = requestedFile;
    void openExistingEditor(target);
  }, [configsQuery.data, editorLoading, editorOpen, searchParams]);

  async function applyTemplate(nextTemplate: string): Promise<void> {
    setTemplateFile(nextTemplate);
    if (!nextTemplate) {
      setConfigText(DEFAULT_CONFIG);
      return;
    }

    setTemplateLoading(true);
    try {
      const payload = await getExperimentConfig(nextTemplate);
      setConfigText(JSON.stringify(payload.config || {}, null, 2));
    } catch (error) {
      notifyError("Failed to load experiment config template", error);
    } finally {
      setTemplateLoading(false);
    }
  }

  async function refreshWithPreview(): Promise<void> {
    if (refreshingVisual) return;
    setRefreshingVisual(true);
    try {
      await Promise.all([
        configsQuery.refetch(),
        new Promise((resolve) => window.setTimeout(resolve, 1400))
      ]);
    } finally {
      setRefreshingVisual(false);
    }
  }

  return (
    <div className="page">
      <header className="jobs-hero">
        <div>
          <h1>Experiment Configs</h1>
        </div>
        <div className="jobs-command-group">
          <Button
            variant="secondary"
            iconLeft={!refreshingVisual ? <RefreshCcw size={14} /> : undefined}
            onClick={refreshWithPreview}
            disabled={refreshingVisual}
          >
            {refreshingVisual ? <EVChargingLoader compact /> : "Refresh"}
          </Button>
          <Button variant="primary" iconLeft={<Plus size={14} />} onClick={openNewEditor}>
            New Experiment Config
          </Button>
        </div>
      </header>

      <section className="jobs-main">
        {refreshingVisual ? (
          <section className="datasets-loader-preview">
            <EVChargingLoader label="Refreshing configs..." />
          </section>
        ) : null}

        {configsQuery.data && configsQuery.data.length > 0 ? (
          <section className="panel">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="configs-actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {configsQuery.data.map((config) => (
                  <tr key={config}>
                    <td>{config}</td>
                    <td className="configs-actions-col">
                      <div className="table-actions configs-table-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          iconLeft={<Eye size={13} />}
                          onClick={() => openExistingEditor(config)}
                        >
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          iconLeft={<Trash2 size={13} />}
                          onClick={() => setDeleteTarget(config)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <EmptyState
            title="No configs"
            message="Create your first experiment configuration."
            action={
              <Button variant="primary" onClick={openNewEditor}>
                New Experiment Config
              </Button>
            }
          />
        )}
      </section>

      <Modal
        title={editorMode === "edit" ? `Experiment Config: ${fileName}` : "Create new experiment config"}
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          if (searchParams.get("file")) {
            const next = new URLSearchParams(searchParams);
            next.delete("file");
            setSearchParams(next, { replace: true });
          }
        }}
        width="lg"
      >
        {editorLoading ? (
          <section className="datasets-loader-preview">
            <EVChargingLoader label="Loading experiment config..." />
          </section>
        ) : (
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const parsed = JSON.parse(configText) as Record<string, unknown>;
                saveMutation.mutate({ file_name: fileName.trim(), config: parsed });
              } catch {
                notifyError("Invalid JSON", new Error("Experiment config content must be valid JSON"));
              }
            }}
          >
            <label className="full-col">
              <span>File name</span>
              <input
                required
                value={fileName}
                disabled={editorMode === "edit"}
                onChange={(event) => setFileName(event.target.value)}
                placeholder="demo.yaml"
              />
              {editorMode === "edit" ? (
                <small className="jobs-meta">File name locked in edit mode (backend updates by file name).</small>
              ) : null}
            </label>

            {editorMode === "create" ? (
              <label className="full-col">
                <span>Template (optional)</span>
                <select
                  value={templateFile}
                  onChange={(event) => {
                    void applyTemplate(event.target.value);
                  }}
                >
                  <option value="">Blank starter</option>
                  {(configsQuery.data || []).map((config) => (
                    <option key={config} value={config}>
                      {config}
                    </option>
                  ))}
                </select>
                {templateLoading ? <small className="jobs-meta">Loading template...</small> : null}
              </label>
            ) : null}

            <label className="full-col">
              <span>Experiment config body (JSON)</span>
              <textarea rows={16} value={configText} onChange={(event) => setConfigText(event.target.value)} />
            </label>
            <div className="full-col inline-end">
              <Button type="submit" variant="primary" disabled={saveMutation.isPending}>
                {saveMutation.isPending
                  ? "Saving..."
                  : editorMode === "edit"
                    ? "Update Experiment Config"
                    : "Save Experiment Config"}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete experiment config"
        message={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget}"?`
            : "Are you sure you want to delete this experiment config?"
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        pending={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget, {
            onSettled: () => setDeleteTarget(null)
          });
        }}
      />
    </div>
  );
}
