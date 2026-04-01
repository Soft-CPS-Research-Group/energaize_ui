import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Eye, Plus, RefreshCcw, Trash2 } from "lucide-react";
import YAML from "yaml";
import {
  deleteExperimentConfig,
  getExperimentConfig,
  listDatasets,
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

type EditorMode = "create" | "edit";
type ConfigEditorView = "visual" | "yaml";
type ConfigModel = Record<string, unknown>;

const VISUAL_WIZARD_STEPS = [
  { id: "setup", label: "Setup" },
  { id: "metadata", label: "Metadata" },
  { id: "simulator", label: "Simulator" },
  { id: "algorithm", label: "Algorithm" },
  { id: "tracking", label: "Tracking" },
  { id: "bundle", label: "Bundle" }
] as const;

const TRACKING_LOG_LEVEL_OPTIONS = ["TRACE", "DEBUG", "INFO", "SUCCESS", "WARNING", "ERROR"];
const SIMULATOR_EXPORT_MODES = ["none", "during", "end"];
const REWARD_FUNCTION_OPTIONS = ["RewardFunction", "CostHardConstraintReward"];

const ALGORITHM_PRESETS: Record<string, Record<string, unknown>> = {
  MADDPG: {
    name: "MADDPG",
    hyperparameters: {
      gamma: 0.995
    },
    networks: {
      actor: {
        class: "Actor",
        layers: [1024, 512, 256],
        lr: 5.0e-5
      },
      critic: {
        class: "Critic",
        layers: [1024, 512, 256],
        lr: 5.0e-4
      }
    },
    replay_buffer: {
      class: "MultiAgentReplayBuffer",
      capacity: 200000,
      batch_size: 256
    },
    exploration: {
      strategy: "GaussianNoise",
      params: {
        bias: 0.1,
        sigma: 0.15,
        decay: 0.99,
        noise_clip: 0.3,
        gamma: 0.99,
        tau: 0.001,
        end_initial_exploration_time_step: 96,
        random_exploration_steps: 96
      }
    }
  },
  RuleBasedPolicy: {
    name: "RuleBasedPolicy",
    hyperparameters: {
      pv_charge_threshold: 2.0,
      flexibility_hours: 3.0,
      emergency_hours: 1.0,
      pv_preferred_charge_rate: 0.7,
      flex_trickle_charge: 0.0,
      min_charge_rate: 0.0,
      emergency_charge_rate: 1.0,
      default_capacity_kwh: 60.0,
      non_flexible_chargers: []
    },
    networks: null,
    replay_buffer: null,
    exploration: null
  },
  SingleAgentRL: {
    name: "SingleAgentRL",
    hyperparameters: {
      gamma: 0.99
    },
    policy: "DQN",
    replay_buffer: {
      class: "MultiAgentReplayBuffer",
      capacity: 50000,
      batch_size: 64
    },
    exploration: {
      strategy: "EpsilonGreedy",
      params: {
        epsilon_start: 1.0,
        epsilon_final: 0.05,
        epsilon_decay: 0.995,
        end_initial_exploration_time_step: 64
      }
    }
  }
};

const DEFAULT_VISUAL_MODEL: ConfigModel = {
  metadata: {
    experiment_name: "new_experiment",
    run_name: "New Experiment Run",
    community_name: "default_community",
    description: "Experiment created in visual config creator"
  },
  runtime: {
    log_dir: null,
    job_dir: null,
    mlflow_uri: null,
    job_id: null,
    run_id: null,
    run_name: null,
    tracking_uri: null,
    experiment_id: null,
    mlflow_run_url: null
  },
  tracking: {
    mlflow_enabled: true,
    log_level: "INFO",
    log_frequency: 1,
    mlflow_step_sample_interval: 10,
    mlflow_artifacts_profile: "minimal",
    progress_updates_enabled: true,
    progress_update_interval: 5,
    system_metrics_enabled: false,
    system_metrics_interval: 10
  },
  checkpointing: {
    resume_training: false,
    checkpoint_run_id: null,
    checkpoint_artifact: "latest_checkpoint.pth",
    use_best_checkpoint_artifact: false,
    reset_replay_buffer: false,
    freeze_pretrained_layers: false,
    fine_tune: false,
    checkpoint_interval: 5000
  },
  bundle: {
    bundle_version: null,
    description: "Bundle exported from visual creator",
    alias_mapping_path: null,
    require_observations_envelope: false,
    artifact_config: {},
    per_agent_artifact_config: {}
  },
  simulator: {
    dataset_name: "citylearn_challenge_2022_phase_all_plus_evs",
    dataset_path: "./datasets/citylearn_challenge_2022_phase_all_plus_evs/schema.json",
    central_agent: false,
    reward_function: "RewardFunction",
    reward_function_kwargs: {},
    episodes: 1,
    simulation_start_time_step: null,
    simulation_end_time_step: null,
    episode_time_steps: null,
    export: {
      mode: "end",
      export_kpis_on_episode_end: true,
      session_name: null
    },
    wrapper_reward: {
      enabled: false,
      profile: "cost_limits_v1",
      clip_enabled: true,
      clip_min: -10.0,
      clip_max: 10.0,
      squash: "none"
    }
  },
  training: {
    seed: 123,
    steps_between_training_updates: 4,
    target_update_interval: 2
  },
  topology: {
    num_agents: null,
    observation_dimensions: null,
    action_dimensions: null,
    action_space: null
  },
  algorithm: ALGORITHM_PRESETS.MADDPG,
  execution: null
};

const DEFAULT_CONFIG = YAML.stringify(DEFAULT_VISUAL_MODEL);

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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
  return cloneValue(model);
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

function mergeWithDefaults(defaultValue: unknown, currentValue: unknown): unknown {
  if (currentValue === undefined) {
    return cloneValue(defaultValue);
  }

  if (
    defaultValue &&
    typeof defaultValue === "object" &&
    !Array.isArray(defaultValue) &&
    currentValue &&
    typeof currentValue === "object" &&
    !Array.isArray(currentValue)
  ) {
    const defaultsRecord = defaultValue as Record<string, unknown>;
    const currentRecord = currentValue as Record<string, unknown>;
    const merged: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(defaultsRecord), ...Object.keys(currentRecord)]);
    keys.forEach((key) => {
      merged[key] = mergeWithDefaults(defaultsRecord[key], currentRecord[key]);
    });
    return merged;
  }

  return currentValue;
}

function normalizeVisualModel(model: ConfigModel | null): ConfigModel {
  if (!model) return cloneConfigModel(DEFAULT_VISUAL_MODEL);
  return mergeWithDefaults(DEFAULT_VISUAL_MODEL, model) as ConfigModel;
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

function valueAsArrayString(model: ConfigModel | null, path: string): string {
  if (!model) return "";
  const raw = getNestedValue(model, path);
  if (!Array.isArray(raw)) return "";
  return raw.map((item) => String(item)).join(", ");
}

function parseNumberOrFallback(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumberArray(value: string, fallback: number[]): number[] {
  const parsed = value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
  return parsed.length > 0 ? parsed : fallback;
}

function datasetSchemaPath(datasetName: string): string {
  return `./datasets/${datasetName}/schema.json`;
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
  const [visualStep, setVisualStep] = useState(1);
  const [showSimulatorAdvanced, setShowSimulatorAdvanced] = useState(false);
  const [showAlgorithmAdvanced, setShowAlgorithmAdvanced] = useState(false);
  const [showTrackingAdvanced, setShowTrackingAdvanced] = useState(false);
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

  const datasetsQuery = useQuery({
    queryKey: ["datasets"],
    queryFn: listDatasets
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

  const datasetNames = useMemo(
    () => (datasetsQuery.data || []).map((dataset) => dataset.name).sort((left, right) => left.localeCompare(right)),
    [datasetsQuery.data]
  );

  const visualTotalSteps = VISUAL_WIZARD_STEPS.length;
  const wizardProgressPercent =
    visualTotalSteps > 1 ? ((Math.max(1, visualStep) - 1) / (visualTotalSteps - 1)) * 100 : 0;
  const currentStepLabel = VISUAL_WIZARD_STEPS[visualStep - 1]?.label || "Step";

  const selectedAlgorithmName = valueAsString(parsedModel, "algorithm.name") || "MADDPG";

  const availableRewardFunctions = useMemo(() => {
    const current = valueAsString(parsedModel, "simulator.reward_function");
    if (!current || REWARD_FUNCTION_OPTIONS.includes(current)) return REWARD_FUNCTION_OPTIONS;
    return [...REWARD_FUNCTION_OPTIONS, current];
  }, [parsedModel]);

  const selectedDatasetName = valueAsString(parsedModel, "simulator.dataset_name");
  const datasetExists = selectedDatasetName ? datasetNames.includes(selectedDatasetName) : false;

  const visualStepValid = useMemo(() => {
    if (!parsedModel) return false;

    if (visualStep === 1) {
      const trimmedName = fileName.trim();
      return Boolean(trimmedName) && /\.ya?ml$/i.test(trimmedName);
    }

    if (visualStep === 2) {
      return Boolean(valueAsString(parsedModel, "metadata.experiment_name").trim()) &&
        Boolean(valueAsString(parsedModel, "metadata.run_name").trim());
    }

    if (visualStep === 3) {
      return Boolean(valueAsString(parsedModel, "simulator.dataset_name").trim()) &&
        Boolean(valueAsString(parsedModel, "simulator.dataset_path").trim()) &&
        Boolean(valueAsString(parsedModel, "simulator.reward_function").trim());
    }

    if (visualStep === 4) {
      return Boolean(valueAsString(parsedModel, "algorithm.name").trim());
    }

    if (visualStep === 5) {
      const logFrequency = Number(valueAsString(parsedModel, "tracking.log_frequency") || "0");
      return Boolean(valueAsString(parsedModel, "tracking.log_level").trim()) && Number.isFinite(logFrequency) && logFrequency >= 1;
    }

    return true;
  }, [fileName, parsedModel, visualStep]);

  function resetVisualWizardState(): void {
    setVisualStep(1);
    setShowSimulatorAdvanced(false);
    setShowAlgorithmAdvanced(false);
    setShowTrackingAdvanced(false);
  }

  function openNewEditor(): void {
    setEditorMode("create");
    setFileName("demo.yaml");
    setTemplateFile("");
    setConfigText(DEFAULT_CONFIG);
    setEditorView("visual");
    setVisualError(null);
    setEditorLoading(false);
    resetVisualWizardState();
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
    resetVisualWizardState();
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
      resetVisualWizardState();
      return;
    }

    setTemplateLoading(true);
    try {
      const payload = await getExperimentConfig(nextTemplate);
      setConfigText(payload.yaml_content || "");
      setEditorView("visual");
      resetVisualWizardState();
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
      await Promise.all([configsQuery.refetch(), new Promise((resolve) => window.setTimeout(resolve, 1400))]);
    } finally {
      setRefreshingVisual(false);
    }
  }

  useEffect(() => {
    if (!editorOpen) return;
    const parsed = parseConfigModel(configText);
    if (parsed.error) {
      setParsedModel(parsed.value);
      setVisualError(parsed.error);
      return;
    }

    const normalized = normalizeVisualModel(parsed.value);
    setParsedModel(normalized);
    setVisualError(null);
  }, [configText, editorOpen]);

  function updateVisualModel(mutator: (model: ConfigModel) => ConfigModel): void {
    if (!parsedModel) return;
    const updated = mutator(parsedModel);
    setConfigText(YAML.stringify(updated));
  }

  function updateVisualField(path: string, value: unknown): void {
    updateVisualModel((model) => setNestedValue(model, path, value));
  }

  function updateDatasetSelection(datasetName: string): void {
    updateVisualModel((model) => {
      const withName = setNestedValue(model, "simulator.dataset_name", datasetName);
      return setNestedValue(withName, "simulator.dataset_path", datasetSchemaPath(datasetName));
    });
  }

  function updateAlgorithmPreset(algorithmName: string): void {
    const preset = ALGORITHM_PRESETS[algorithmName] || ALGORITHM_PRESETS.MADDPG;
    updateVisualField("algorithm", cloneValue(preset));
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

              if (editorView === "visual" && !visualError && visualStep < visualTotalSteps) {
                if (!visualStepValid) {
                  notifyError(
                    "Complete required fields",
                    new Error("Please complete required fields before moving to the next step.")
                  );
                  return;
                }
                setVisualStep((previous) => Math.min(visualTotalSteps, previous + 1));
                return;
              }

              if (editorView === "visual" && visualError) {
                notifyError("Visual editor unavailable", new Error("Switch to YAML editor to fix parsing issues."));
                return;
              }

              if (editorView === "visual" && !visualStepValid) {
                notifyError(
                  "Incomplete step",
                  new Error("Please complete required fields in the current step before saving.")
                );
                return;
              }

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

            {editorView === "yaml" ? (
              <>
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
              </>
            ) : null}

            {editorView === "visual" ? (
              <section className="full-col config-visual-editor config-wizard">
                <header className="config-wizard-header">
                  <small className="jobs-meta">
                    Step {visualStep} / {visualTotalSteps} · {currentStepLabel}
                  </small>
                  <div className="config-progress-track" role="tablist" aria-label="Visual config steps">
                    <div className="config-progress-line" aria-hidden="true">
                      <div className="config-progress-line-fill" style={{ width: `${wizardProgressPercent}%` }} />
                    </div>
                    <div className="config-progress-points">
                      {VISUAL_WIZARD_STEPS.map((step, index) => {
                        const stepNumber = index + 1;
                        const stateClass =
                          stepNumber < visualStep
                            ? "is-done"
                            : stepNumber === visualStep
                              ? "is-active"
                              : "is-pending";
                        return (
                          <button
                            key={step.id}
                            type="button"
                            className={`config-progress-point ${stateClass}`}
                            onClick={() => {
                              if (stepNumber <= visualStep) setVisualStep(stepNumber);
                            }}
                            disabled={stepNumber > visualStep}
                            title={step.label}
                            aria-label={`Go to ${step.label}`}
                          >
                            <span>{stepNumber}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </header>

                {visualError ? (
                  <div className="config-visual-error">
                    <strong>Visual editor unavailable</strong>
                    <p>{visualError}</p>
                    <small>Switch to YAML editor to fix formatting.</small>
                  </div>
                ) : (
                  <>
                    {visualStep === 1 ? (
                      <section className="config-visual-group">
                        <h3>Setup</h3>
                        <p className="config-section-hint">
                          Escolhe o nome do ficheiro e, se quiseres, começa com um starter.
                        </p>
                        <div className="config-visual-grid">
                          <label>
                            <span>File name</span>
                            <input
                              required
                              value={fileName}
                              disabled={editorMode === "edit"}
                              onChange={(event) => setFileName(event.target.value)}
                              placeholder="demo.yaml"
                            />
                            {editorMode === "edit" ? (
                              <small className="jobs-meta">File name locked in edit mode.</small>
                            ) : null}
                          </label>
                          {editorMode === "create" ? (
                            <label>
                              <span>Starter template</span>
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
                          ) : (
                            <label>
                              <span>Starter template</span>
                              <input value="Current config (edit mode)" disabled />
                            </label>
                          )}
                        </div>
                      </section>
                    ) : null}

                    {visualStep === 2 ? (
                      <section className="config-visual-group">
                        <h3>Metadata</h3>
                        <div className="config-visual-grid">
                          <label>
                            <span>Experiment name</span>
                            <input
                              value={valueAsString(parsedModel, "metadata.experiment_name")}
                              onChange={(event) => updateVisualField("metadata.experiment_name", event.target.value)}
                              placeholder="my_experiment"
                            />
                          </label>
                          <label>
                            <span>Run name</span>
                            <input
                              value={valueAsString(parsedModel, "metadata.run_name")}
                              onChange={(event) => updateVisualField("metadata.run_name", event.target.value)}
                              placeholder="baseline_v1"
                            />
                          </label>
                          <label>
                            <span>Community name</span>
                            <input
                              value={valueAsString(parsedModel, "metadata.community_name")}
                              onChange={(event) => updateVisualField("metadata.community_name", event.target.value)}
                              placeholder="default_community"
                            />
                          </label>
                          <label className="full-col">
                            <span>Description</span>
                            <textarea
                              rows={3}
                              value={valueAsString(parsedModel, "metadata.description")}
                              onChange={(event) => updateVisualField("metadata.description", event.target.value)}
                              placeholder="What this experiment is for"
                            />
                          </label>
                        </div>
                      </section>
                    ) : null}

                    {visualStep === 3 ? (
                      <section className="config-visual-group">
                        <h3>Simulator</h3>
                        <div className="config-visual-grid">
                          <label>
                            <span>Dataset (from backend machine)</span>
                            <select
                              value={selectedDatasetName}
                              onChange={(event) => updateDatasetSelection(event.target.value)}
                            >
                              {selectedDatasetName && !datasetExists ? (
                                <option value={selectedDatasetName}>{selectedDatasetName} (custom)</option>
                              ) : null}
                              {datasetNames.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                            {datasetsQuery.isFetching ? <small className="jobs-meta">Refreshing datasets...</small> : null}
                          </label>

                          <label>
                            <span>Dataset path</span>
                            <input
                              value={valueAsString(parsedModel, "simulator.dataset_path")}
                              onChange={(event) => updateVisualField("simulator.dataset_path", event.target.value)}
                              placeholder="./datasets/<name>/schema.json"
                            />
                          </label>

                          <label>
                            <span>Reward function</span>
                            <select
                              value={valueAsString(parsedModel, "simulator.reward_function")}
                              onChange={(event) => updateVisualField("simulator.reward_function", event.target.value)}
                            >
                              {availableRewardFunctions.map((rewardFn) => (
                                <option key={rewardFn} value={rewardFn}>
                                  {rewardFn}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span>Export mode</span>
                            <select
                              value={valueAsString(parsedModel, "simulator.export.mode") || "end"}
                              onChange={(event) => updateVisualField("simulator.export.mode", event.target.value)}
                            >
                              {SIMULATOR_EXPORT_MODES.map((mode) => (
                                <option key={mode} value={mode}>
                                  {mode}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="config-checkbox-row">
                            <input
                              type="checkbox"
                              checked={valueAsBoolean(parsedModel, "simulator.export.export_kpis_on_episode_end")}
                              onChange={(event) =>
                                updateVisualField("simulator.export.export_kpis_on_episode_end", event.target.checked)
                              }
                            />
                            <span>Export KPIs at episode end</span>
                          </label>

                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setShowSimulatorAdvanced((state) => !state)}
                        >
                          {showSimulatorAdvanced ? "Hide extra simulator options" : "Show extra simulator options"}
                        </Button>

                        {showSimulatorAdvanced ? (
                          <div className="config-visual-grid config-visual-advanced">
                            <label>
                              <span>Export session name</span>
                              <input
                                value={valueAsString(parsedModel, "simulator.export.session_name")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "simulator.export.session_name",
                                    event.target.value === "" ? null : event.target.value
                                  )
                                }
                                placeholder="optional session label"
                              />
                            </label>
                            <label>
                              <span>Episodes</span>
                              <input
                                type="number"
                                min={1}
                                value={valueAsString(parsedModel, "simulator.episodes")}
                                onChange={(event) =>
                                  updateVisualField("simulator.episodes", parseNumberOrFallback(event.target.value, 1))
                                }
                              />
                            </label>
                            <label>
                              <span>Episode timesteps</span>
                              <input
                                type="number"
                                min={1}
                                value={valueAsString(parsedModel, "simulator.episode_time_steps")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "simulator.episode_time_steps",
                                    parseOptionalNumber(event.target.value)
                                  )
                                }
                                placeholder="null uses dataset default"
                              />
                            </label>
                            <label>
                              <span>Simulation start timestep</span>
                              <input
                                type="number"
                                min={0}
                                value={valueAsString(parsedModel, "simulator.simulation_start_time_step")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "simulator.simulation_start_time_step",
                                    parseOptionalNumber(event.target.value)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Simulation end timestep</span>
                              <input
                                type="number"
                                min={0}
                                value={valueAsString(parsedModel, "simulator.simulation_end_time_step")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "simulator.simulation_end_time_step",
                                    parseOptionalNumber(event.target.value)
                                  )
                                }
                              />
                            </label>
                            <label className="config-checkbox-row">
                              <input
                                type="checkbox"
                                checked={valueAsBoolean(parsedModel, "simulator.central_agent")}
                                onChange={(event) => updateVisualField("simulator.central_agent", event.target.checked)}
                              />
                              <span>Central agent</span>
                            </label>
                          </div>
                        ) : null}
                      </section>
                    ) : null}

                    {visualStep === 4 ? (
                      <section className="config-visual-group">
                        <h3>Algorithm</h3>
                        <div className="config-visual-grid">
                          <label>
                            <span>Algorithm family</span>
                            <select value={selectedAlgorithmName} onChange={(event) => updateAlgorithmPreset(event.target.value)}>
                              <option value="MADDPG">MADDPG</option>
                              <option value="RuleBasedPolicy">RuleBasedPolicy</option>
                              <option value="SingleAgentRL">SingleAgentRL</option>
                            </select>
                          </label>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setShowAlgorithmAdvanced((state) => !state)}
                        >
                          {showAlgorithmAdvanced ? "Hide extra algorithm configs" : "Show extra algorithm configs"}
                        </Button>

                        {showAlgorithmAdvanced && selectedAlgorithmName === "MADDPG" ? (
                          <div className="config-visual-grid config-visual-advanced">
                            <label>
                              <span>Gamma</span>
                              <input
                                type="number"
                                step="0.0001"
                                value={valueAsString(parsedModel, "algorithm.hyperparameters.gamma")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.hyperparameters.gamma",
                                    parseNumberOrFallback(event.target.value, 0.995)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Actor layers (comma separated)</span>
                              <input
                                value={valueAsArrayString(parsedModel, "algorithm.networks.actor.layers")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.networks.actor.layers",
                                    parseNumberArray(event.target.value, [1024, 512, 256])
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Actor LR</span>
                              <input
                                type="number"
                                step="0.00001"
                                value={valueAsString(parsedModel, "algorithm.networks.actor.lr")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.networks.actor.lr",
                                    parseNumberOrFallback(event.target.value, 5.0e-5)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Critic layers (comma separated)</span>
                              <input
                                value={valueAsArrayString(parsedModel, "algorithm.networks.critic.layers")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.networks.critic.layers",
                                    parseNumberArray(event.target.value, [1024, 512, 256])
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Critic LR</span>
                              <input
                                type="number"
                                step="0.00001"
                                value={valueAsString(parsedModel, "algorithm.networks.critic.lr")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.networks.critic.lr",
                                    parseNumberOrFallback(event.target.value, 5.0e-4)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Replay capacity</span>
                              <input
                                type="number"
                                value={valueAsString(parsedModel, "algorithm.replay_buffer.capacity")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.replay_buffer.capacity",
                                    parseNumberOrFallback(event.target.value, 200000)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Replay batch size</span>
                              <input
                                type="number"
                                value={valueAsString(parsedModel, "algorithm.replay_buffer.batch_size")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.replay_buffer.batch_size",
                                    parseNumberOrFallback(event.target.value, 256)
                                  )
                                }
                              />
                            </label>
                          </div>
                        ) : null}

                        {showAlgorithmAdvanced && selectedAlgorithmName === "RuleBasedPolicy" ? (
                          <div className="config-visual-grid config-visual-advanced">
                            <label>
                              <span>PV charge threshold</span>
                              <input
                                type="number"
                                step="0.01"
                                value={valueAsString(parsedModel, "algorithm.hyperparameters.pv_charge_threshold")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.hyperparameters.pv_charge_threshold",
                                    parseNumberOrFallback(event.target.value, 2.0)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Flexibility hours</span>
                              <input
                                type="number"
                                step="0.1"
                                value={valueAsString(parsedModel, "algorithm.hyperparameters.flexibility_hours")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.hyperparameters.flexibility_hours",
                                    parseNumberOrFallback(event.target.value, 3.0)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Emergency hours</span>
                              <input
                                type="number"
                                step="0.1"
                                value={valueAsString(parsedModel, "algorithm.hyperparameters.emergency_hours")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.hyperparameters.emergency_hours",
                                    parseNumberOrFallback(event.target.value, 1.0)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Preferred charge rate</span>
                              <input
                                type="number"
                                step="0.01"
                                value={valueAsString(parsedModel, "algorithm.hyperparameters.pv_preferred_charge_rate")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.hyperparameters.pv_preferred_charge_rate",
                                    parseNumberOrFallback(event.target.value, 0.7)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Default EV capacity (kWh)</span>
                              <input
                                type="number"
                                step="0.1"
                                value={valueAsString(parsedModel, "algorithm.hyperparameters.default_capacity_kwh")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.hyperparameters.default_capacity_kwh",
                                    parseNumberOrFallback(event.target.value, 60.0)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Non-flexible chargers (comma separated)</span>
                              <input
                                value={valueAsArrayString(parsedModel, "algorithm.hyperparameters.non_flexible_chargers")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.hyperparameters.non_flexible_chargers",
                                    event.target.value
                                      .split(",")
                                      .map((item) => item.trim())
                                      .filter(Boolean)
                                  )
                                }
                              />
                            </label>
                          </div>
                        ) : null}

                        {showAlgorithmAdvanced && selectedAlgorithmName === "SingleAgentRL" ? (
                          <div className="config-visual-grid config-visual-advanced">
                            <label>
                              <span>Policy</span>
                              <input
                                value={valueAsString(parsedModel, "algorithm.policy")}
                                onChange={(event) => updateVisualField("algorithm.policy", event.target.value)}
                              />
                            </label>
                            <label>
                              <span>Gamma</span>
                              <input
                                type="number"
                                step="0.0001"
                                value={valueAsString(parsedModel, "algorithm.hyperparameters.gamma")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.hyperparameters.gamma",
                                    parseNumberOrFallback(event.target.value, 0.99)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Replay capacity</span>
                              <input
                                type="number"
                                value={valueAsString(parsedModel, "algorithm.replay_buffer.capacity")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.replay_buffer.capacity",
                                    parseNumberOrFallback(event.target.value, 50000)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Replay batch size</span>
                              <input
                                type="number"
                                value={valueAsString(parsedModel, "algorithm.replay_buffer.batch_size")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "algorithm.replay_buffer.batch_size",
                                    parseNumberOrFallback(event.target.value, 64)
                                  )
                                }
                              />
                            </label>
                          </div>
                        ) : null}

                      </section>
                    ) : null}

                    {visualStep === 5 ? (
                      <section className="config-visual-group">
                        <h3>Tracking</h3>
                        <div className="config-visual-grid">
                          <label className="config-checkbox-row">
                            <input
                              type="checkbox"
                              checked={valueAsBoolean(parsedModel, "tracking.mlflow_enabled")}
                              onChange={(event) => updateVisualField("tracking.mlflow_enabled", event.target.checked)}
                            />
                            <span>MLflow enabled</span>
                          </label>

                          <label>
                            <span>Log level</span>
                            <select
                              value={valueAsString(parsedModel, "tracking.log_level") || "INFO"}
                              onChange={(event) => updateVisualField("tracking.log_level", event.target.value)}
                            >
                              {TRACKING_LOG_LEVEL_OPTIONS.map((logLevel) => (
                                <option key={logLevel} value={logLevel}>
                                  {logLevel}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span>Log frequency</span>
                            <input
                              type="number"
                              min={1}
                              value={valueAsString(parsedModel, "tracking.log_frequency")}
                              onChange={(event) =>
                                updateVisualField("tracking.log_frequency", parseNumberOrFallback(event.target.value, 1))
                              }
                            />
                          </label>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setShowTrackingAdvanced((state) => !state)}
                        >
                          {showTrackingAdvanced ? "Hide advanced tracking" : "Show advanced tracking"}
                        </Button>

                        {showTrackingAdvanced ? (
                          <div className="config-visual-grid config-visual-advanced">
                            <label>
                              <span>MLflow step sample interval</span>
                              <input
                                type="number"
                                min={1}
                                value={valueAsString(parsedModel, "tracking.mlflow_step_sample_interval")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "tracking.mlflow_step_sample_interval",
                                    parseNumberOrFallback(event.target.value, 10)
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>MLflow artifact profile</span>
                              <select
                                value={valueAsString(parsedModel, "tracking.mlflow_artifacts_profile") || "minimal"}
                                onChange={(event) =>
                                  updateVisualField("tracking.mlflow_artifacts_profile", event.target.value)
                                }
                              >
                                <option value="minimal">minimal</option>
                                <option value="curated">curated</option>
                              </select>
                            </label>
                            <label className="config-checkbox-row">
                              <input
                                type="checkbox"
                                checked={valueAsBoolean(parsedModel, "tracking.progress_updates_enabled")}
                                onChange={(event) =>
                                  updateVisualField("tracking.progress_updates_enabled", event.target.checked)
                                }
                              />
                              <span>Progress updates enabled</span>
                            </label>
                            <label>
                              <span>Progress update interval</span>
                              <input
                                type="number"
                                min={1}
                                value={valueAsString(parsedModel, "tracking.progress_update_interval")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "tracking.progress_update_interval",
                                    parseNumberOrFallback(event.target.value, 5)
                                  )
                                }
                              />
                            </label>
                            <label className="config-checkbox-row">
                              <input
                                type="checkbox"
                                checked={valueAsBoolean(parsedModel, "tracking.system_metrics_enabled")}
                                onChange={(event) =>
                                  updateVisualField("tracking.system_metrics_enabled", event.target.checked)
                                }
                              />
                              <span>System metrics enabled</span>
                            </label>
                            <label>
                              <span>System metrics interval</span>
                              <input
                                type="number"
                                min={1}
                                value={valueAsString(parsedModel, "tracking.system_metrics_interval")}
                                onChange={(event) =>
                                  updateVisualField(
                                    "tracking.system_metrics_interval",
                                    parseNumberOrFallback(event.target.value, 10)
                                  )
                                }
                              />
                            </label>
                          </div>
                        ) : null}
                      </section>
                    ) : null}

                    {visualStep === 6 ? (
                      <section className="config-visual-group">
                        <h3>Bundle</h3>
                        <div className="config-visual-grid">
                          <label>
                            <span>Bundle version</span>
                            <input
                              value={valueAsString(parsedModel, "bundle.bundle_version")}
                              onChange={(event) =>
                                updateVisualField(
                                  "bundle.bundle_version",
                                  event.target.value === "" ? null : event.target.value
                                )
                              }
                              placeholder="v1.0.0"
                            />
                          </label>
                          <label>
                            <span>Alias mapping path</span>
                            <input
                              value={valueAsString(parsedModel, "bundle.alias_mapping_path")}
                              onChange={(event) =>
                                updateVisualField(
                                  "bundle.alias_mapping_path",
                                  event.target.value === "" ? null : event.target.value
                                )
                              }
                              placeholder="config/alias_map.json"
                            />
                          </label>
                          <label className="full-col">
                            <span>Bundle description</span>
                            <textarea
                              rows={3}
                              value={valueAsString(parsedModel, "bundle.description")}
                              onChange={(event) =>
                                updateVisualField(
                                  "bundle.description",
                                  event.target.value === "" ? null : event.target.value
                                )
                              }
                            />
                          </label>
                          <label className="config-checkbox-row">
                            <input
                              type="checkbox"
                              checked={valueAsBoolean(parsedModel, "bundle.require_observations_envelope")}
                              onChange={(event) =>
                                updateVisualField("bundle.require_observations_envelope", event.target.checked)
                              }
                            />
                            <span>Require observations envelope</span>
                          </label>
                        </div>
                      </section>
                    ) : null}
                  </>
                )}
              </section>
            ) : (
              <label className="full-col">
                <span>Experiment config body (YAML)</span>
                <textarea rows={16} value={configText} onChange={(event) => setConfigText(event.target.value)} />
              </label>
            )}

            <div className="full-col inline-end config-modal-actions">
              {editorView === "visual" && !visualError && visualStep > 1 ? (
                <Button
                  type="button"
                  variant="secondary"
                  iconLeft={<ChevronLeft size={14} />}
                  onClick={() => setVisualStep((previous) => Math.max(1, previous - 1))}
                >
                  Back
                </Button>
              ) : null}

              <Button
                type="submit"
                variant="primary"
                iconRight={editorView === "visual" && visualStep < visualTotalSteps ? <ChevronRight size={14} /> : undefined}
                disabled={saveMutation.isPending || (editorView === "visual" && !visualError && !visualStepValid)}
              >
                {saveMutation.isPending
                  ? "Saving..."
                  : editorView === "visual" && !visualError && visualStep < visualTotalSteps
                    ? "Next"
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
