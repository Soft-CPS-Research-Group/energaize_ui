import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus, RefreshCcw, Trash2 } from "lucide-react";
import YAML from "yaml";
import {
  deleteExperimentConfig,
  getExperimentConfig,
  listExperimentConfigs,
  saveExperimentConfig,
  updateExperimentConfig
} from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { useApiFeedback } from "../../hooks/useApiFeedback";
import { useSearchParams } from "react-router-dom";

const DEFAULT_CONFIG = `metadata:
  experiment_name: Solar Forecast
  run_name: baseline_v1
algorithm:
  name: MADDPG
  seed: 42
`;

type EditorMode = "create" | "edit";
type ConfigEditorView = "visual" | "yaml";
type ConfigModel = Record<string, unknown>;

function parseConfigModel(text: string): { value: ConfigModel | null; error: string | null } {
  try {
    const parsed = YAML.parse(text || "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: {}, error: null };
    }
    return { value: parsed as ConfigModel, error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : "Invalid YAML format." };
  }
}

function cloneConfigModel(model: ConfigModel): ConfigModel {
  return JSON.parse(JSON.stringify(model)) as ConfigModel;
}

function getNestedValue(model: ConfigModel, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, model);
}

function setNestedValue(model: ConfigModel, path: string, value: unknown): ConfigModel {
  const keys = path.split(".");
  const next = cloneConfigModel(model);
  let cursor: Record<string, unknown> = next;

  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index]!;
    const current = cursor[key];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[keys[keys.length - 1]!] = value;
  return next;
}

function valueAsString(model: ConfigModel | null, path: string): string {
  if (!model) return "";
  const value = getNestedValue(model, path);
  if (value === null || value === undefined) return "";
  return String(value);
}

function valueAsBoolean(model: ConfigModel | null, path: string): boolean {
  if (!model) return false;
  const value = getNestedValue(model, path);
  return Boolean(value);
}

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
  const [editorView, setEditorView] = useState<ConfigEditorView>("visual");
  const [parsedModel, setParsedModel] = useState<ConfigModel | null>(null);
  const [visualError, setVisualError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("demo.yaml");
  const [templateFile, setTemplateFile] = useState("");
  const [configText, setConfigText] = useState(DEFAULT_CONFIG);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const configsQuery = useQuery({
    queryKey: ["configs"],
    queryFn: listExperimentConfigs
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { file_name: string; yaml_content: string; mode: EditorMode }) =>
      payload.mode === "edit"
        ? updateExperimentConfig({ file_name: payload.file_name, yaml_content: payload.yaml_content })
        : saveExperimentConfig({ file_name: payload.file_name, yaml_content: payload.yaml_content }),
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
    setEditorView("visual");
    setVisualError(null);
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
    setEditorView("visual");
    setVisualError(null);
    setEditorOpen(true);
    try {
      const payload = await getExperimentConfig(configFile);
      setConfigText(payload.yaml_content || "");
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
      setConfigText(payload.yaml_content || "");
      setEditorView("visual");
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
      await queryClient.invalidateQueries({ queryKey: ["configs"], refetchType: "active" });
      await Promise.all([
        configsQuery.refetch(),
        new Promise((resolve) => window.setTimeout(resolve, 1400))
      ]);
    } finally {
      setRefreshingVisual(false);
    }
  }

  useEffect(() => {
    if (!editorOpen) return;
    const parsed = parseConfigModel(configText);
    setParsedModel(parsed.value);
    setVisualError(parsed.error);
  }, [configText, editorOpen]);

  function updateVisualField(path: string, value: unknown): void {
    if (!parsedModel) return;
    const updated = setNestedValue(parsedModel, path, value);
    setConfigText(YAML.stringify(updated));
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
              const trimmedName = fileName.trim();
              if (!trimmedName) {
                notifyError("Missing file name", new Error("Experiment config file name is required."));
                return;
              }
              if (!/\.ya?ml$/i.test(trimmedName)) {
                notifyError("Invalid file name", new Error("Experiment config file must end with .yaml or .yml."));
                return;
              }
              saveMutation.mutate({
                file_name: trimmedName,
                yaml_content: configText,
                mode: editorMode
              });
            }}
          >
            <section className="full-col config-editor-switch">
              <Button
                type="button"
                size="sm"
                variant={editorView === "visual" ? "secondary" : "ghost"}
                className={editorView === "visual" ? "config-editor-switch-btn is-active" : "config-editor-switch-btn"}
                onClick={() => setEditorView("visual")}
              >
                Visual editor
              </Button>
              <Button
                type="button"
                size="sm"
                variant={editorView === "yaml" ? "secondary" : "ghost"}
                className={editorView === "yaml" ? "config-editor-switch-btn is-active" : "config-editor-switch-btn"}
                onClick={() => setEditorView("yaml")}
              >
                YAML editor
              </Button>
            </section>

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

            {editorView === "visual" ? (
              <section className="full-col config-visual-editor">
                {visualError ? (
                  <div className="config-visual-error">
                    <strong>Visual editor unavailable</strong>
                    <p>{visualError}</p>
                    <small>Switch to YAML editor to fix formatting.</small>
                  </div>
                ) : (
                  <>
                    <section className="config-visual-group">
                      <h3>Metadata</h3>
                      <div className="config-visual-grid">
                        <label>
                          <span>Experiment name</span>
                          <input
                            value={valueAsString(parsedModel, "metadata.experiment_name")}
                            onChange={(event) => updateVisualField("metadata.experiment_name", event.target.value)}
                          />
                        </label>
                        <label>
                          <span>Run name</span>
                          <input
                            value={valueAsString(parsedModel, "metadata.run_name")}
                            onChange={(event) => updateVisualField("metadata.run_name", event.target.value)}
                          />
                        </label>
                        <label>
                          <span>Community name</span>
                          <input
                            value={valueAsString(parsedModel, "metadata.community_name")}
                            onChange={(event) => updateVisualField("metadata.community_name", event.target.value)}
                          />
                        </label>
                        <label className="full-col">
                          <span>Description</span>
                          <textarea
                            rows={3}
                            value={valueAsString(parsedModel, "metadata.description")}
                            onChange={(event) => updateVisualField("metadata.description", event.target.value)}
                          />
                        </label>
                      </div>
                    </section>

                    <section className="config-visual-group">
                      <h3>Simulator</h3>
                      <div className="config-visual-grid">
                        <label>
                          <span>Dataset name</span>
                          <input
                            value={valueAsString(parsedModel, "simulator.dataset_name")}
                            onChange={(event) => updateVisualField("simulator.dataset_name", event.target.value)}
                          />
                        </label>
                        <label>
                          <span>Dataset path</span>
                          <input
                            value={valueAsString(parsedModel, "simulator.dataset_path")}
                            onChange={(event) => updateVisualField("simulator.dataset_path", event.target.value)}
                          />
                        </label>
                        <label>
                          <span>Episodes</span>
                          <input
                            type="number"
                            value={valueAsString(parsedModel, "simulator.episodes")}
                            onChange={(event) =>
                              updateVisualField("simulator.episodes", Number(event.target.value || 0))
                            }
                          />
                        </label>
                        <label>
                          <span>Episode timesteps</span>
                          <input
                            type="number"
                            value={valueAsString(parsedModel, "simulator.episode_time_steps")}
                            onChange={(event) =>
                              updateVisualField(
                                "simulator.episode_time_steps",
                                event.target.value === "" ? null : Number(event.target.value)
                              )
                            }
                          />
                        </label>
                        <label>
                          <span>Start timestep</span>
                          <input
                            type="number"
                            value={valueAsString(parsedModel, "simulator.simulation_start_time_step")}
                            onChange={(event) =>
                              updateVisualField(
                                "simulator.simulation_start_time_step",
                                event.target.value === "" ? null : Number(event.target.value)
                              )
                            }
                          />
                        </label>
                        <label>
                          <span>End timestep</span>
                          <input
                            type="number"
                            value={valueAsString(parsedModel, "simulator.simulation_end_time_step")}
                            onChange={(event) =>
                              updateVisualField(
                                "simulator.simulation_end_time_step",
                                event.target.value === "" ? null : Number(event.target.value)
                              )
                            }
                          />
                        </label>
                      </div>
                    </section>

                    <section className="config-visual-group">
                      <h3>Algorithm & Tracking</h3>
                      <div className="config-visual-grid">
                        <label>
                          <span>Algorithm</span>
                          <input
                            value={valueAsString(parsedModel, "algorithm.name")}
                            onChange={(event) => updateVisualField("algorithm.name", event.target.value)}
                          />
                        </label>
                        <label>
                          <span>Seed</span>
                          <input
                            type="number"
                            value={valueAsString(parsedModel, "training.seed")}
                            onChange={(event) => updateVisualField("training.seed", Number(event.target.value || 0))}
                          />
                        </label>
                        <label>
                          <span>Log level</span>
                          <input
                            value={valueAsString(parsedModel, "tracking.log_level")}
                            onChange={(event) => updateVisualField("tracking.log_level", event.target.value)}
                          />
                        </label>
                        <label>
                          <span>Log frequency</span>
                          <input
                            type="number"
                            value={valueAsString(parsedModel, "tracking.log_frequency")}
                            onChange={(event) =>
                              updateVisualField("tracking.log_frequency", Number(event.target.value || 0))
                            }
                          />
                        </label>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={valueAsBoolean(parsedModel, "tracking.mlflow_enabled")}
                            onChange={(event) =>
                              updateVisualField("tracking.mlflow_enabled", event.target.checked)
                            }
                          />
                          <span>MLflow enabled</span>
                        </label>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={valueAsBoolean(parsedModel, "simulator.central_agent")}
                            onChange={(event) => updateVisualField("simulator.central_agent", event.target.checked)}
                          />
                          <span>Central agent</span>
                        </label>
                      </div>
                    </section>
                  </>
                )}
              </section>
            ) : (
              <label className="full-col">
                <span>Experiment config body (YAML)</span>
                <textarea rows={16} value={configText} onChange={(event) => setConfigText(event.target.value)} />
              </label>
            )}
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
