import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Eye,
  GitBranch,
  Layers3,
  Plus,
  RefreshCcw,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Zap
} from "lucide-react";
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
import {
  NetworkArchitectureGraph,
  type NetworkArchitectureRow,
  type NetworkArchitectureStat
} from "../../components/ai/NetworkArchitectureGraph";
import { useApiFeedback } from "../../hooks/useApiFeedback";
import { getDatasetFormat, getDatasetFormatLabel } from "../../utils/datasetFormat";
import { datasetSchemaPath } from "../../utils/datasetPath";
import { useSearchParams } from "react-router-dom";

type EditorMode = "create" | "edit";
type ConfigEditorView = "visual" | "yaml";
type ConfigModel = Record<string, unknown>;
type NetworkKind = "actor" | "critic";
type AlgorithmSupport = "runtime" | "placeholder";

const VISUAL_WIZARD_STEPS = [
  { id: "setup", label: "Setup" },
  { id: "metadata", label: "Metadata" },
  { id: "simulator", label: "Dataset" },
  { id: "algorithm", label: "Algorithm" },
  { id: "tracking", label: "Tracking" }
] as const;

const TRACKING_LOG_LEVEL_OPTIONS = ["TRACE", "DEBUG", "INFO", "SUCCESS", "WARNING", "ERROR"];
const SIMULATOR_EXPORT_MODES = ["none", "during", "end"];
const REWARD_FUNCTION_OPTIONS = ["RewardFunction", "V2GPenaltyReward", "CostMinimizationReward", "CostHardConstraintReward"];
const ENTITY_ENCODING_PROFILE_OPTIONS = ["minmax_space", "maddpg_v1", "maddpg_v2_compact"];

const COST_REWARD_DEFAULTS: Record<string, unknown> = {
  export_credit_ratio: 0.0,
  grid_violation_penalty: 60.0,
  power_outage_penalty: 120.0,
  ev_departure_window_hours: 1.0,
  ev_departure_service_tolerance: 0.05,
  ev_connected_deficit_penalty: 30.0,
  ev_schedule_deficit_penalty: 120.0,
  ev_departure_deficit_penalty: 120.0,
  ev_departure_missed_penalty: 250.0,
  battery_soc_min: 0.0,
  battery_soc_max: 1.0,
  use_observed_storage_soc_limits: true,
  battery_soc_violation_penalty: 30.0,
  battery_throughput_penalty: 0.2,
  deferrable_deadline_missed_penalty: 100.0,
  deferrable_urgency_penalty: 10.0,
  community_import_penalty: 0.01,
  community_peak_import_penalty: 0.001,
  community_export_penalty: 0.0,
  community_penalty_divide_by_agents: true,
  scale_state_penalties_by_time_step: true,
  state_penalty_reference_seconds: 3600.0
};

const RULE_BASED_ALGORITHMS = [
  "RuleBasedPolicy",
  "RBCBasicPolicy",
  "RBCSmartPolicy",
  "RandomPolicy",
  "NormalPolicy",
  "NormalNoBatteryPolicy"
];

const RULE_BASED_HYPERPARAMETER_DEFAULTS: Record<string, unknown> = {
  pv_charge_threshold: 2.0,
  flexibility_hours: 3.0,
  emergency_hours: 1.0,
  pv_preferred_charge_rate: 0.7,
  flex_trickle_charge: 0.0,
  min_charge_rate: 0.0,
  emergency_charge_rate: 1.0,
  energy_epsilon: 0.001,
  default_capacity_kwh: 60.0,
  non_flexible_chargers: [],
  control_storage: true,
  control_evs: true,
  control_deferrables: true,
  allow_v2g: false,
  deferrable_start_action: 1.0,
  deferrable_urgency_threshold: 0.75,
  deferrable_slack_threshold: 0.25,
  deferrable_priority_threshold: 0.5,
  storage_min_soc: 0.2,
  storage_max_soc: 0.9,
  storage_target_soc: 0.5,
  storage_charge_rate: 0.35,
  storage_discharge_rate: 0.35,
  price_charge_rate: 0.6,
  price_discharge_rate: 0.45,
  pv_charge_rate: 0.75,
  peak_discharge_rate: 0.65,
  ev_normal_charge_rate: 1.0,
  ev_normal_target_soc: 1.0,
  ev_price_charge_rate: 0.7,
  ev_pv_charge_rate: 0.85,
  ev_v2g_discharge_rate: 0.3,
  pv_surplus_threshold_kw: 0.25,
  import_peak_threshold_kw: 7.0,
  low_headroom_threshold_kw: 2.0,
  ev_v2g_reserve_soc: 0.15,
  ev_service_margin_rate: 0.05,
  ev_service_floor_rate: 0.25,
  ev_service_lookahead_hours: 4.0,
  ev_service_target_soc: 0.0,
  ev_deadline_buffer_hours: 0.25,
  ev_v2g_min_departure_hours: 2.0,
  ev_v2g_service_margin_soc: 0.05
};

interface AlgorithmOption {
  id: string;
  label: string;
  family: "Learning" | "Rule based" | "Baseline" | "Experimental";
  summary: string;
  support: AlgorithmSupport;
  icon: ReactNode;
}

const ALGORITHM_OPTIONS: AlgorithmOption[] = [
  {
    id: "MADDPG",
    label: "MADDPG",
    family: "Learning",
    summary: "Multi-agent actor/critic training with replay memory and exploration noise.",
    support: "runtime",
    icon: <BrainCircuit size={17} />
  },
  {
    id: "RBCSmartPolicy",
    label: "RBC Smart",
    family: "Rule based",
    summary: "Solar, price, peak and EV-service aware baseline.",
    support: "runtime",
    icon: <ShieldCheck size={17} />
  },
  {
    id: "RBCBasicPolicy",
    label: "RBC Basic",
    family: "Rule based",
    summary: "Simple controllable EV/storage/deferrable baseline.",
    support: "runtime",
    icon: <Route size={17} />
  },
  {
    id: "RuleBasedPolicy",
    label: "RuleBased",
    family: "Rule based",
    summary: "Legacy heuristic controller that reads raw observations.",
    support: "runtime",
    icon: <SlidersHorizontal size={17} />
  },
  {
    id: "RandomPolicy",
    label: "Random",
    family: "Baseline",
    summary: "Runtime baseline for sanity checks and bounds.",
    support: "runtime",
    icon: <Activity size={17} />
  },
  {
    id: "NormalPolicy",
    label: "Normal",
    family: "Baseline",
    summary: "Normal-operation baseline with storage and demand behaviour.",
    support: "runtime",
    icon: <Zap size={17} />
  },
  {
    id: "NormalNoBatteryPolicy",
    label: "No Battery",
    family: "Baseline",
    summary: "Normal baseline without battery control.",
    support: "runtime",
    icon: <Cpu size={17} />
  },
  {
    id: "SingleAgentRL",
    label: "SingleAgentRL",
    family: "Experimental",
    summary: "Schema placeholder only; not backed by a runtime implementation yet.",
    support: "placeholder",
    icon: <GitBranch size={17} />
  }
];

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
        bias: 0.0,
        sigma: 0.15,
        decay: 0.9995,
        min_sigma: 0.03,
        noise_clip: 0.3,
        gamma: 0.99,
        tau: 0.001,
        end_initial_exploration_time_step: 96,
        random_exploration_steps: 96,
        initial_exploration_strategy: "uniform_full_range",
        warm_start_policy: null,
        warm_start_policy_deterministic: true,
        warm_start_policy_noise_scale: 0.0,
        noop_noise_scale: 0.15,
        deferrable_on_probability: 0.2,
        deferrable_trigger_threshold: 0.5,
        noop_actor_initialization: false,
        noop_actor_initialization_epsilon: 0.05,
        critic_update_mode: "joint_mean",
        actor_update_interval: 1,
        target_policy_smoothing: false,
        target_policy_noise: 0.05,
        target_policy_noise_clip: 0.1,
        actor_action_l2_penalty: 0.0,
        actor_action_saturation_penalty: 0.0,
        actor_action_saturation_threshold: 0.85,
        reward_normalization: true,
        reward_normalization_clip: 10.0,
        reward_normalization_epsilon: 1.0e-8
      }
    }
  },
  RuleBasedPolicy: {
    name: "RuleBasedPolicy",
    hyperparameters: RULE_BASED_HYPERPARAMETER_DEFAULTS,
    networks: null,
    replay_buffer: null,
    exploration: null
  },
  RBCBasicPolicy: {
    name: "RBCBasicPolicy",
    hyperparameters: {
      ...RULE_BASED_HYPERPARAMETER_DEFAULTS,
      allow_v2g: false,
      ev_service_floor_rate: 1.0
    },
    networks: null,
    replay_buffer: null,
    exploration: null
  },
  RBCSmartPolicy: {
    name: "RBCSmartPolicy",
    hyperparameters: {
      ...RULE_BASED_HYPERPARAMETER_DEFAULTS,
      allow_v2g: true,
      ev_service_floor_rate: 1.0,
      ev_service_lookahead_hours: 24.0,
      price_charge_rate: 0.0,
      price_discharge_rate: 0.15,
      pv_charge_rate: 0.2,
      peak_discharge_rate: 0.2,
      storage_min_soc: 0.3,
      storage_max_soc: 0.85,
      storage_target_soc: 0.6,
      pv_surplus_threshold_kw: 0.5,
      import_peak_threshold_kw: 10.0,
      low_headroom_threshold_kw: 1.0,
      deferrable_urgency_threshold: 0.6,
      deferrable_slack_threshold: 0.4
    },
    networks: null,
    replay_buffer: null,
    exploration: null
  },
  RandomPolicy: {
    name: "RandomPolicy",
    hyperparameters: {
      ...RULE_BASED_HYPERPARAMETER_DEFAULTS,
      control_storage: true,
      control_evs: true,
      control_deferrables: true
    },
    networks: null,
    replay_buffer: null,
    exploration: null
  },
  NormalPolicy: {
    name: "NormalPolicy",
    hyperparameters: RULE_BASED_HYPERPARAMETER_DEFAULTS,
    networks: null,
    replay_buffer: null,
    exploration: null
  },
  NormalNoBatteryPolicy: {
    name: "NormalNoBatteryPolicy",
    hyperparameters: {
      ...RULE_BASED_HYPERPARAMETER_DEFAULTS,
      control_storage: false
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
    system_metrics_interval: 10,
    action_diagnostics_enabled: false,
    action_diagnostics_detail: "summary",
    action_saturation_tolerance: 0.01,
    action_idle_tolerance: 0.02,
    training_diagnostics_enabled: true,
    training_diagnostics_detail: "summary",
    reward_diagnostics_enabled: true,
    reward_diagnostics_detail: "summary"
  },
  checkpointing: {
    resume_training: false,
    checkpoint_run_id: null,
    checkpoint_artifact: "latest_checkpoint.pth",
    use_best_checkpoint_artifact: false,
    reset_replay_buffer: false,
    freeze_pretrained_layers: false,
    fine_tune: false,
    checkpoint_interval: 5000,
    require_update_step: true,
    require_initial_exploration_done: true
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
    dataset_path: "/data/datasets/citylearn_challenge_2022_phase_all_plus_evs/schema.json",
    central_agent: false,
    interface: "entity",
    topology_mode: "static",
    entity_encoding: {
      enabled: true,
      normalization: "minmax_space",
      profile: "maddpg_v2_compact",
      clip: true
    },
    reward_function: "CostHardConstraintReward",
    reward_function_kwargs: COST_REWARD_DEFAULTS,
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

function valueAsNumberArray(model: ConfigModel | null, path: string, fallback: number[]): number[] {
  if (!model) return fallback;
  const raw = getNestedValue(model, path);
  if (!Array.isArray(raw)) return fallback;
  const parsed = raw.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0);
  return parsed.length > 0 ? parsed : fallback;
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

function isRuleBasedAlgorithm(name: string): boolean {
  return RULE_BASED_ALGORITHMS.includes(name);
}

function getAlgorithmOption(name: string): AlgorithmOption {
  return ALGORITHM_OPTIONS.find((option) => option.id === name) || {
    id: name || "unknown",
    label: name || "Unknown",
    family: "Experimental",
    summary: "This algorithm is not present in the Algorithms runtime registry.",
    support: "placeholder",
    icon: <GitBranch size={17} />
  };
}

function formatCompactNumber(value: unknown): string {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "-";
  if (Math.abs(numberValue) >= 1000000) return `${(numberValue / 1000000).toFixed(1)}M`;
  if (Math.abs(numberValue) >= 1000) return `${Math.round(numberValue / 1000)}k`;
  return String(numberValue);
}

function getConfigBaseName(path: string): string {
  const normalized = path.split(/[\\/]/).filter(Boolean);
  return normalized[normalized.length - 1] || path;
}

function NetworkStackBuilder({
  kind,
  layers,
  lr,
  onLayersChange,
  onLrChange
}: {
  kind: NetworkKind;
  layers: number[];
  lr: string;
  onLayersChange: (layers: number[]) => void;
  onLrChange: (value: number) => void;
}): JSX.Element {
  const color = kind === "actor" ? "#8b5cf6" : "#2d90d7";
  const label = kind === "actor" ? "Actor" : "Critic";
  const presets = kind === "actor"
    ? [
        { label: "Compact", layers: [512, 256] },
        { label: "Default", layers: [1024, 512, 256] },
        { label: "Wide", layers: [2048, 1024, 512] }
      ]
    : [
        { label: "Compact", layers: [512, 256] },
        { label: "Default", layers: [1024, 512, 256] },
        { label: "Deep", layers: [1024, 1024, 512, 256] }
      ];

  function updateLayer(index: number, rawValue: string): void {
    const nextValue = parseNumberOrFallback(rawValue, layers[index] || 256);
    onLayersChange(layers.map((layer, layerIndex) => (layerIndex === index ? nextValue : layer)));
  }

  return (
    <section className="config-network-stack" style={{ "--network-color": color } as CSSProperties}>
      <header className="config-network-stack-head">
        <div>
          <span className="config-mini-label">{label} network</span>
          <strong>{layers.length} hidden layers</strong>
        </div>
        <label className="config-network-lr-field">
          <span>Learning rate</span>
          <input
            type="text"
            inputMode="decimal"
            value={lr}
            onChange={(event) => onLrChange(parseNumberOrFallback(event.target.value, kind === "actor" ? 5.0e-5 : 5.0e-4))}
          />
        </label>
      </header>

      <div className="config-network-presets" aria-label={`${label} layer presets`}>
        {presets.map((preset) => (
          <button key={preset.label} type="button" onClick={() => onLayersChange(preset.layers)}>
            {preset.label}
          </button>
        ))}
      </div>

      <div className="config-network-flow">
        <span className="config-network-terminal">Input</span>
        {layers.map((layer, index) => {
          const width = `${Math.min(100, Math.max(34, Math.log2(layer + 1) * 9))}%`;
          return (
            <div key={`${kind}-${index}`} className="config-network-layer">
              <div className="config-network-layer-bar" style={{ width }}>
                <Layers3 size={13} />
                <span>Layer {index + 1}</span>
              </div>
              <input
                type="number"
                min={1}
                value={layer}
                onChange={(event) => updateLayer(index, event.target.value)}
                aria-label={`${label} layer ${index + 1} size`}
              />
              <button
                type="button"
                disabled={layers.length <= 1}
                onClick={() => onLayersChange(layers.filter((_, layerIndex) => layerIndex !== index))}
                aria-label={`Remove ${label} layer ${index + 1}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="config-network-add"
          onClick={() => onLayersChange([...layers, Math.max(64, Math.round((layers[layers.length - 1] || 256) / 2))])}
        >
          <Plus size={13} />
          Add hidden layer
        </button>
        <span className="config-network-terminal">Action</span>
      </div>
    </section>
  );
}

function AlgorithmOptionButton({
  option,
  selected,
  onSelect
}: {
  option: AlgorithmOption;
  selected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const disabled = option.support === "placeholder";
  return (
    <button
      type="button"
      className={`config-algorithm-card${selected ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
      onClick={() => {
        if (!disabled) onSelect(option.id);
      }}
      disabled={disabled}
    >
      <span className="config-algorithm-icon">{option.icon}</span>
      <span className="config-algorithm-copy">
        <strong>{option.label}</strong>
        <small>{option.summary}</small>
      </span>
      <span className={`config-algorithm-support is-${option.support}`}>
        {option.support === "runtime" ? "runtime" : "placeholder"}
      </span>
    </button>
  );
}

function ConfigNetworkArchitecturePreview({
  model
}: {
  model: ConfigModel | null;
}): JSX.Element {
  const actorLayers = valueAsNumberArray(model, "algorithm.networks.actor.layers", []);
  const criticLayers = valueAsNumberArray(model, "algorithm.networks.critic.layers", []);
  const replayCapacity = valueAsString(model, "algorithm.replay_buffer.capacity");
  const batchSize = valueAsString(model, "algorithm.replay_buffer.batch_size");
  const gamma = valueAsString(model, "algorithm.hyperparameters.gamma");
  const rows: NetworkArchitectureRow[] = [
    {
      id: "actor",
      label: "Actor",
      inputLabel: "Observation",
      inputDetail: "encoded state",
      outputLabel: "Action",
      outputDetail: "control vector",
      accent: "#7c3aed",
      layers: actorLayers.map((layer, index) => ({
        label: `Hidden L${index + 1}`,
        size: layer
      }))
    },
    {
      id: "critic",
      label: "Critic",
      inputLabel: "Obs + action",
      inputDetail: "training signal",
      outputLabel: "Q-value",
      outputDetail: "expected return",
      accent: "#0f8fcf",
      layers: criticLayers.map((layer, index) => ({
        label: `Hidden L${index + 1}`,
        size: layer
      }))
    }
  ];
  const stats: NetworkArchitectureStat[] = [
    {
      label: "Replay",
      value: `${formatCompactNumber(replayCapacity)} capacity`
    },
    {
      label: "Batch",
      value: batchSize || "-"
    },
    {
      label: "Gamma",
      value: gamma || "-"
    }
  ];

  return (
    <NetworkArchitectureGraph
      eyebrow="Network view"
      title="MADDPG actor and critic"
      description="This mirrors the layer sizes that will be written into the Algorithms config."
      rows={rows}
      stats={stats}
      className="config-network-architecture"
    />
  );
}

function ConfigStepShell({
  eyebrow,
  title,
  description,
  children,
  className
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={`config-step-shell${className ? ` ${className}` : ""}`}>
      <div className="config-step-main">
        <header className="config-step-titlebar">
          <span className="config-mini-label">{eyebrow}</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </header>
        {children}
      </div>
    </section>
  );
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
  const [showRewardParameters, setShowRewardParameters] = useState(false);
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
        `${payload.file_name} stored in the Job Orchestrator.`
      );
      setEditorOpen(false);
      queryClient.invalidateQueries({ queryKey: ["configs"] });
    },
    onError: (error) => notifyError("Failed to save experiment config", error)
  });

  const deleteMutation = useMutation({
    mutationFn: (target: string) => deleteExperimentConfig(target),
    onSuccess: () => {
      notifyInfo("Experiment config deleted", "Experiment config removed from the Job Orchestrator.");
      queryClient.invalidateQueries({ queryKey: ["configs"] });
    },
    onError: (error) => notifyError("Failed to delete experiment config", error)
  });

  const sortedDatasets = useMemo(
    () => [...(datasetsQuery.data || [])].sort((left, right) => left.name.localeCompare(right.name)),
    [datasetsQuery.data]
  );
  const datasetNames = useMemo(() => sortedDatasets.map((dataset) => dataset.name), [sortedDatasets]);

  const visualTotalSteps = VISUAL_WIZARD_STEPS.length;
  const wizardProgressPercent =
    visualTotalSteps > 1 ? ((Math.max(1, visualStep) - 1) / (visualTotalSteps - 1)) * 100 : 0;
  const visualStepId = VISUAL_WIZARD_STEPS[visualStep - 1]?.id || "setup";
  const currentStepLabel = VISUAL_WIZARD_STEPS[visualStep - 1]?.label || "Step";

  const selectedAlgorithmName = valueAsString(parsedModel, "algorithm.name") || "MADDPG";
  const selectedAlgorithmOption = getAlgorithmOption(selectedAlgorithmName);
  const simulatorInterface = valueAsString(parsedModel, "simulator.interface") || "flat";
  const topologyMode = valueAsString(parsedModel, "simulator.topology_mode") || "static";
  const dynamicTopologyNeedsEntity = topologyMode === "dynamic" && simulatorInterface !== "entity";
  const maddpgDynamicTopologyBlocked =
    selectedAlgorithmName === "MADDPG" && simulatorInterface === "entity" && topologyMode === "dynamic";

  const availableRewardFunctions = useMemo(() => {
    const current = valueAsString(parsedModel, "simulator.reward_function");
    if (!current || REWARD_FUNCTION_OPTIONS.includes(current)) return REWARD_FUNCTION_OPTIONS;
    return [...REWARD_FUNCTION_OPTIONS, current];
  }, [parsedModel]);

  const selectedDatasetName = valueAsString(parsedModel, "simulator.dataset_name");
  const datasetExists = selectedDatasetName ? datasetNames.includes(selectedDatasetName) : false;
  const selectedDataset = sortedDatasets.find((dataset) => dataset.name === selectedDatasetName) || null;
  const configFiles = configsQuery.data || [];

  const visualStepValid = useMemo(() => {
    if (!parsedModel) return false;

    if (visualStepId === "setup") {
      const trimmedName = fileName.trim();
      return Boolean(trimmedName) && /\.ya?ml$/i.test(trimmedName);
    }

    if (visualStepId === "metadata") {
      return Boolean(valueAsString(parsedModel, "metadata.experiment_name").trim()) &&
        Boolean(valueAsString(parsedModel, "metadata.run_name").trim());
    }

    if (visualStepId === "simulator") {
      return Boolean(valueAsString(parsedModel, "simulator.dataset_name").trim()) &&
        Boolean(valueAsString(parsedModel, "simulator.dataset_path").trim()) &&
        !dynamicTopologyNeedsEntity;
    }

    if (visualStepId === "algorithm") {
      return Boolean(valueAsString(parsedModel, "algorithm.name").trim()) &&
        selectedAlgorithmOption.support === "runtime" &&
        !maddpgDynamicTopologyBlocked;
    }

    if (visualStepId === "tracking") {
      const logFrequency = Number(valueAsString(parsedModel, "tracking.log_frequency") || "0");
      return Boolean(valueAsString(parsedModel, "tracking.log_level").trim()) && Number.isFinite(logFrequency) && logFrequency >= 1;
    }

    return true;
  }, [
    dynamicTopologyNeedsEntity,
    fileName,
    maddpgDynamicTopologyBlocked,
    parsedModel,
    selectedAlgorithmOption.support,
    visualStepId
  ]);

  function resetVisualWizardState(): void {
    setVisualStep(1);
    setShowSimulatorAdvanced(false);
    setShowAlgorithmAdvanced(false);
    setShowRewardParameters(false);
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

  function updateSimulatorInterface(nextInterface: string): void {
    updateVisualModel((model) => {
      let next = setNestedValue(model, "simulator.interface", nextInterface);
      next = setNestedValue(next, "simulator.entity_encoding.enabled", nextInterface === "entity");
      if (nextInterface !== "entity") {
        next = setNestedValue(next, "simulator.topology_mode", "static");
      }
      return next;
    });
  }

  function updateTopologyMode(nextTopologyMode: string): void {
    updateVisualModel((model) => {
      let next = setNestedValue(model, "simulator.topology_mode", nextTopologyMode);
      if (nextTopologyMode === "dynamic") {
        next = setNestedValue(next, "simulator.interface", "entity");
        next = setNestedValue(next, "simulator.entity_encoding.enabled", true);
      }
      return next;
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

        {configFiles.length > 0 ? (
          <section className="panel configs-list-panel">
              <table className="table configs-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="configs-actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {configFiles.map((config) => (
                  <tr key={config}>
                    <td>
                      <div className="configs-name-cell">
                        <span className="configs-file-icon"><SlidersHorizontal size={15} /></span>
                        <span>
                          <strong>{getConfigBaseName(config)}</strong>
                          {config !== getConfigBaseName(config) ? <small>{config}</small> : null}
                        </span>
                      </div>
                    </td>
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
        width="xl"
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
                    <small className="jobs-meta">File name locked in edit mode (orchestrator updates by file name).</small>
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
                    {visualStepId === "setup" ? (
                      <ConfigStepShell
                        eyebrow="File"
                        title="Setup"
                        description="Choose where this config will be stored and whether to start from an existing template."
                      >
                        <div className="config-visual-grid config-visual-grid--relaxed">
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
                      </ConfigStepShell>
                    ) : null}

                    {visualStepId === "metadata" ? (
                      <ConfigStepShell
                        eyebrow="Run identity"
                        title="Metadata"
                        description="Name the experiment in the same language used later by MLflow, logs, bundles and job detail pages."
                      >
                        <div className="config-visual-grid config-visual-grid--relaxed">
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
                      </ConfigStepShell>
                    ) : null}

                    {visualStepId === "simulator" ? (
                      <ConfigStepShell
                        eyebrow="Environment"
                        title="Dataset"
                        description="Pick the dataset used by the runner. Interface, topology and encoding usually come from the dataset contract and stay in advanced options."
                      >
                        <div className="config-visual-grid config-visual-grid--relaxed">
                          <label>
                            <span>Dataset (from orchestrator storage)</span>
                            <select
                              value={selectedDatasetName}
                              onChange={(event) => updateDatasetSelection(event.target.value)}
                            >
                              {selectedDatasetName && !datasetExists ? (
                                <option value={selectedDatasetName}>{selectedDatasetName} (custom)</option>
                              ) : null}
                              {sortedDatasets.map((dataset) => {
                                const format = getDatasetFormat(dataset);
                                return (
                                  <option key={dataset.name} value={dataset.name}>
                                    {dataset.name} - {getDatasetFormatLabel(format)}
                                  </option>
                                );
                              })}
                            </select>
                            {selectedDataset ? (
                              <small className="jobs-meta">
                                Type: {getDatasetFormatLabel(getDatasetFormat(selectedDataset))}
                              </small>
                            ) : null}
                            {datasetsQuery.isFetching ? <small className="jobs-meta">Refreshing datasets...</small> : null}
                          </label>

                          <label>
                            <span>Dataset path inside job container</span>
                            <input
                              value={valueAsString(parsedModel, "simulator.dataset_path")}
                              onChange={(event) => updateVisualField("simulator.dataset_path", event.target.value)}
                              placeholder="/data/datasets/<name>/schema.json"
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
                              <span>Interface</span>
                              <select
                                value={simulatorInterface}
                                onChange={(event) => updateSimulatorInterface(event.target.value)}
                              >
                                <option value="flat">flat</option>
                                <option value="entity">entity</option>
                              </select>
                            </label>
                            <label>
                              <span>Topology mode</span>
                              <select
                                value={topologyMode}
                                onChange={(event) => updateTopologyMode(event.target.value)}
                              >
                                <option value="static">static</option>
                                <option value="dynamic">dynamic</option>
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
                        ) : null}
                      </ConfigStepShell>
                    ) : null}

                    {visualStepId === "algorithm" ? (
                      <ConfigStepShell
                        eyebrow="Policy"
                        title="Algorithm"
                        description="Pick a runtime algorithm from the Algorithms registry, then shape the important knobs visually."
                        className="config-step-shell--algorithm"
                      >
                        <span className="config-algorithm-family-pill">{selectedAlgorithmOption.family}</span>
                        <div className="config-algorithm-workspace config-algorithm-workspace--single">
                          <div className="config-algorithm-main">
                            <div className="config-algorithm-selector">
                              {(["Learning", "Rule based", "Baseline", "Experimental"] as AlgorithmOption["family"][]).map((family) => {
                                const options = ALGORITHM_OPTIONS.filter((option) => option.family === family);
                                if (options.length === 0) return null;
                                return (
                                  <section key={family} className="config-algorithm-family">
                                    <h4>{family}</h4>
                                    <div className="config-algorithm-grid">
                                      {options.map((option) => (
                                        <AlgorithmOptionButton
                                          key={option.id}
                                          option={option}
                                          selected={selectedAlgorithmName === option.id}
                                          onSelect={updateAlgorithmPreset}
                                        />
                                      ))}
                                    </div>
                                  </section>
                                );
                              })}
                            </div>

                            {maddpgDynamicTopologyBlocked ? (
                              <div className="config-compat-warning">
                                MADDPG is intentionally blocked for entity + dynamic topology by the Algorithms schema.
                                Switch topology to static or choose a dynamic-ready baseline.
                              </div>
                            ) : null}

                            <section className="config-visual-subpanel">
                              <header className="config-subpanel-head">
                                <div>
                                  <span className="config-mini-label">Input and objective</span>
                                  <h4>Observation encoding and reward</h4>
                                </div>
                                {valueAsString(parsedModel, "simulator.reward_function") === "CostHardConstraintReward" ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setShowRewardParameters((state) => !state)}
                                  >
                                    {showRewardParameters ? "Hide reward params" : "Show reward params"}
                                  </Button>
                                ) : null}
                              </header>
                              <div className="config-param-grid">
                                <label>
                                  <span>Entity encoding profile</span>
                                  <select
                                    value={valueAsString(parsedModel, "simulator.entity_encoding.profile") || "minmax_space"}
                                    disabled={simulatorInterface !== "entity"}
                                    onChange={(event) => updateVisualField("simulator.entity_encoding.profile", event.target.value)}
                                  >
                                    {ENTITY_ENCODING_PROFILE_OPTIONS.map((option) => (
                                      <option key={option} value={option}>
                                        {option}
                                      </option>
                                    ))}
                                  </select>
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
                                <label className="config-toggle-card config-toggle-card--inline">
                                  <input
                                    type="checkbox"
                                    checked={valueAsBoolean(parsedModel, "simulator.entity_encoding.clip")}
                                    disabled={simulatorInterface !== "entity"}
                                    onChange={(event) => updateVisualField("simulator.entity_encoding.clip", event.target.checked)}
                                  />
                                  <span>Clip encoded observations</span>
                                </label>
                              </div>

                              {showRewardParameters && valueAsString(parsedModel, "simulator.reward_function") === "CostHardConstraintReward" ? (
                                <div className="config-param-grid config-visual-advanced">
                                  <label>
                                    <span>Export credit ratio</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min={0}
                                      value={valueAsString(parsedModel, "simulator.reward_function_kwargs.export_credit_ratio")}
                                      onChange={(event) =>
                                        updateVisualField(
                                          "simulator.reward_function_kwargs.export_credit_ratio",
                                          parseNumberOrFallback(event.target.value, 0.0)
                                        )
                                      }
                                    />
                                  </label>
                                  <label>
                                    <span>Grid violation penalty</span>
                                    <input
                                      type="number"
                                      step="1"
                                      min={0}
                                      value={valueAsString(parsedModel, "simulator.reward_function_kwargs.grid_violation_penalty")}
                                      onChange={(event) =>
                                        updateVisualField(
                                          "simulator.reward_function_kwargs.grid_violation_penalty",
                                          parseNumberOrFallback(event.target.value, 60.0)
                                        )
                                      }
                                    />
                                  </label>
                                  <label>
                                    <span>Power outage penalty</span>
                                    <input
                                      type="number"
                                      step="1"
                                      min={0}
                                      value={valueAsString(parsedModel, "simulator.reward_function_kwargs.power_outage_penalty")}
                                      onChange={(event) =>
                                        updateVisualField(
                                          "simulator.reward_function_kwargs.power_outage_penalty",
                                          parseNumberOrFallback(event.target.value, 120.0)
                                        )
                                      }
                                    />
                                  </label>
                                  <label>
                                    <span>EV window hours</span>
                                    <input
                                      type="number"
                                      step="0.1"
                                      min={0}
                                      value={valueAsString(parsedModel, "simulator.reward_function_kwargs.ev_departure_window_hours")}
                                      onChange={(event) =>
                                        updateVisualField(
                                          "simulator.reward_function_kwargs.ev_departure_window_hours",
                                          parseNumberOrFallback(event.target.value, 1.0)
                                        )
                                      }
                                    />
                                  </label>
                                  <label>
                                    <span>EV deficit penalty</span>
                                    <input
                                      type="number"
                                      step="1"
                                      min={0}
                                      value={valueAsString(parsedModel, "simulator.reward_function_kwargs.ev_departure_deficit_penalty")}
                                      onChange={(event) =>
                                        updateVisualField(
                                          "simulator.reward_function_kwargs.ev_departure_deficit_penalty",
                                          parseNumberOrFallback(event.target.value, 120.0)
                                        )
                                      }
                                    />
                                  </label>
                                  <label>
                                    <span>EV missed penalty</span>
                                    <input
                                      type="number"
                                      step="1"
                                      min={0}
                                      value={valueAsString(parsedModel, "simulator.reward_function_kwargs.ev_departure_missed_penalty")}
                                      onChange={(event) =>
                                        updateVisualField(
                                          "simulator.reward_function_kwargs.ev_departure_missed_penalty",
                                          parseNumberOrFallback(event.target.value, 250.0)
                                        )
                                      }
                                    />
                                  </label>
                                  <label>
                                    <span>Battery min SOC</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min={0}
                                      value={valueAsString(parsedModel, "simulator.reward_function_kwargs.battery_soc_min")}
                                      onChange={(event) =>
                                        updateVisualField(
                                          "simulator.reward_function_kwargs.battery_soc_min",
                                          parseNumberOrFallback(event.target.value, 0.0)
                                        )
                                      }
                                    />
                                  </label>
                                  <label>
                                    <span>Battery max SOC</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min={0}
                                      value={valueAsString(parsedModel, "simulator.reward_function_kwargs.battery_soc_max")}
                                      onChange={(event) =>
                                        updateVisualField(
                                          "simulator.reward_function_kwargs.battery_soc_max",
                                          parseNumberOrFallback(event.target.value, 1.0)
                                        )
                                      }
                                    />
                                  </label>
                                  <label>
                                    <span>Community peak penalty</span>
                                    <input
                                      type="number"
                                      step="0.001"
                                      min={0}
                                      value={valueAsString(parsedModel, "simulator.reward_function_kwargs.community_peak_import_penalty")}
                                      onChange={(event) =>
                                        updateVisualField(
                                          "simulator.reward_function_kwargs.community_peak_import_penalty",
                                          parseNumberOrFallback(event.target.value, 0.001)
                                        )
                                      }
                                    />
                                  </label>
                                  <label className="config-toggle-card config-toggle-card--inline">
                                    <input
                                      type="checkbox"
                                      checked={valueAsBoolean(parsedModel, "simulator.reward_function_kwargs.community_penalty_divide_by_agents")}
                                      onChange={(event) =>
                                        updateVisualField(
                                          "simulator.reward_function_kwargs.community_penalty_divide_by_agents",
                                          event.target.checked
                                        )
                                      }
                                    />
                                    <span>Divide community penalty by agents</span>
                                  </label>
                                </div>
                              ) : null}
                            </section>

                            {selectedAlgorithmName === "MADDPG" ? (
                              <div className="config-algorithm-tuning">
                                <section className="config-visual-subpanel">
                                  <header className="config-subpanel-head">
                                    <div>
                                      <span className="config-mini-label">Neural policy</span>
                                      <h4>Actor / critic architecture</h4>
                                    </div>
                                  </header>
                                  <ConfigNetworkArchitecturePreview model={parsedModel} />
                                  <div className="config-network-grid">
                                    <NetworkStackBuilder
                                      kind="actor"
                                      layers={valueAsNumberArray(parsedModel, "algorithm.networks.actor.layers", [1024, 512, 256])}
                                      lr={valueAsString(parsedModel, "algorithm.networks.actor.lr")}
                                      onLayersChange={(layers) => updateVisualField("algorithm.networks.actor.layers", layers)}
                                      onLrChange={(value) => updateVisualField("algorithm.networks.actor.lr", value)}
                                    />
                                    <NetworkStackBuilder
                                      kind="critic"
                                      layers={valueAsNumberArray(parsedModel, "algorithm.networks.critic.layers", [1024, 512, 256])}
                                      lr={valueAsString(parsedModel, "algorithm.networks.critic.lr")}
                                      onLayersChange={(layers) => updateVisualField("algorithm.networks.critic.layers", layers)}
                                      onLrChange={(value) => updateVisualField("algorithm.networks.critic.lr", value)}
                                    />
                                  </div>
                                </section>

                                <section className="config-visual-subpanel">
                                  <header className="config-subpanel-head">
                                    <div>
                                      <span className="config-mini-label">Learning loop</span>
                                      <h4>Replay, discount and exploration</h4>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setShowAlgorithmAdvanced((state) => !state)}
                                    >
                                      {showAlgorithmAdvanced ? "Hide advanced" : "Show advanced"}
                                    </Button>
                                  </header>

                                  <div className="config-param-grid">
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
                                      <span>Replay capacity</span>
                                      <input
                                        type="number"
                                        min={1}
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
                                      <span>Batch size</span>
                                      <input
                                        type="number"
                                        min={1}
                                        value={valueAsString(parsedModel, "algorithm.replay_buffer.batch_size")}
                                        onChange={(event) =>
                                          updateVisualField(
                                            "algorithm.replay_buffer.batch_size",
                                            parseNumberOrFallback(event.target.value, 256)
                                          )
                                        }
                                      />
                                    </label>
                                    <label>
                                      <span>Sigma</span>
                                      <input
                                        type="number"
                                        step="0.001"
                                        min={0}
                                        value={valueAsString(parsedModel, "algorithm.exploration.params.sigma")}
                                        onChange={(event) =>
                                          updateVisualField(
                                            "algorithm.exploration.params.sigma",
                                            parseNumberOrFallback(event.target.value, 0.15)
                                          )
                                        }
                                      />
                                    </label>
                                    <label>
                                      <span>Decay</span>
                                      <input
                                        type="number"
                                        step="0.0001"
                                        min={0}
                                        value={valueAsString(parsedModel, "algorithm.exploration.params.decay")}
                                        onChange={(event) =>
                                          updateVisualField(
                                            "algorithm.exploration.params.decay",
                                            parseNumberOrFallback(event.target.value, 0.9995)
                                          )
                                        }
                                      />
                                    </label>
                                    <label>
                                      <span>Warm-up steps</span>
                                      <input
                                        type="number"
                                        min={0}
                                        value={valueAsString(parsedModel, "algorithm.exploration.params.end_initial_exploration_time_step")}
                                        onChange={(event) =>
                                          updateVisualField(
                                            "algorithm.exploration.params.end_initial_exploration_time_step",
                                            parseNumberOrFallback(event.target.value, 96)
                                          )
                                        }
                                      />
                                    </label>
                                  </div>

                                  {showAlgorithmAdvanced ? (
                                    <div className="config-param-grid config-visual-advanced">
                                      <label>
                                        <span>Min sigma</span>
                                        <input
                                          type="number"
                                          step="0.001"
                                          min={0}
                                          value={valueAsString(parsedModel, "algorithm.exploration.params.min_sigma")}
                                          onChange={(event) =>
                                            updateVisualField(
                                              "algorithm.exploration.params.min_sigma",
                                              parseNumberOrFallback(event.target.value, 0.03)
                                            )
                                          }
                                        />
                                      </label>
                                      <label>
                                        <span>Noise clip</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          min={0}
                                          value={valueAsString(parsedModel, "algorithm.exploration.params.noise_clip")}
                                          onChange={(event) =>
                                            updateVisualField(
                                              "algorithm.exploration.params.noise_clip",
                                              parseNumberOrFallback(event.target.value, 0.3)
                                            )
                                          }
                                        />
                                      </label>
                                      <label>
                                        <span>Random exploration steps</span>
                                        <input
                                          type="number"
                                          min={0}
                                          value={valueAsString(parsedModel, "algorithm.exploration.params.random_exploration_steps")}
                                          onChange={(event) =>
                                            updateVisualField(
                                              "algorithm.exploration.params.random_exploration_steps",
                                              parseNumberOrFallback(event.target.value, 96)
                                            )
                                          }
                                        />
                                      </label>
                                      <label>
                                        <span>Actor update interval</span>
                                        <input
                                          type="number"
                                          min={1}
                                          value={valueAsString(parsedModel, "algorithm.exploration.params.actor_update_interval")}
                                          onChange={(event) =>
                                            updateVisualField(
                                              "algorithm.exploration.params.actor_update_interval",
                                              parseNumberOrFallback(event.target.value, 1)
                                            )
                                          }
                                        />
                                      </label>
                                      <label>
                                        <span>Critic update mode</span>
                                        <select
                                          value={valueAsString(parsedModel, "algorithm.exploration.params.critic_update_mode") || "joint_mean"}
                                          onChange={(event) =>
                                            updateVisualField("algorithm.exploration.params.critic_update_mode", event.target.value)
                                          }
                                        >
                                          <option value="joint_mean">joint_mean</option>
                                          <option value="per_agent">per_agent</option>
                                        </select>
                                      </label>
                                      <label className="config-checkbox-row">
                                        <input
                                          type="checkbox"
                                          checked={valueAsBoolean(parsedModel, "algorithm.exploration.params.reward_normalization")}
                                          onChange={(event) =>
                                            updateVisualField(
                                              "algorithm.exploration.params.reward_normalization",
                                              event.target.checked
                                            )
                                          }
                                        />
                                        <span>Reward normalization</span>
                                      </label>
                                    </div>
                                  ) : null}
                                </section>
                              </div>
                            ) : null}

                            {isRuleBasedAlgorithm(selectedAlgorithmName) ? (
                              <div className="config-algorithm-tuning">
                                <section className="config-visual-subpanel">
                                  <header className="config-subpanel-head">
                                    <div>
                                      <span className="config-mini-label">Heuristic control</span>
                                      <h4>Assets and thresholds</h4>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setShowAlgorithmAdvanced((state) => !state)}
                                    >
                                      {showAlgorithmAdvanced ? "Hide advanced" : "Show advanced"}
                                    </Button>
                                  </header>

                                  <div className="config-toggle-grid">
                                    {[
                                      ["control_storage", "Storage"],
                                      ["control_evs", "EV charging"],
                                      ["control_deferrables", "Deferrables"],
                                      ["allow_v2g", "V2G"]
                                    ].map(([key, label]) => (
                                      <label key={key} className="config-toggle-card">
                                        <input
                                          type="checkbox"
                                          checked={valueAsBoolean(parsedModel, `algorithm.hyperparameters.${key}`)}
                                          onChange={(event) =>
                                            updateVisualField(`algorithm.hyperparameters.${key}`, event.target.checked)
                                          }
                                        />
                                        <span>{label}</span>
                                      </label>
                                    ))}
                                  </div>

                                  <div className="config-param-grid">
                                    <label>
                                      <span>Flexibility hours</span>
                                      <input
                                        type="number"
                                        step="0.1"
                                        min={0}
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
                                        min={0}
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
                                      <span>EV service floor</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min={0}
                                        value={valueAsString(parsedModel, "algorithm.hyperparameters.ev_service_floor_rate")}
                                        onChange={(event) =>
                                          updateVisualField(
                                            "algorithm.hyperparameters.ev_service_floor_rate",
                                            parseNumberOrFallback(event.target.value, 0.25)
                                          )
                                        }
                                      />
                                    </label>
                                    <label>
                                      <span>PV charge rate</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min={0}
                                        value={valueAsString(parsedModel, "algorithm.hyperparameters.pv_charge_rate")}
                                        onChange={(event) =>
                                          updateVisualField(
                                            "algorithm.hyperparameters.pv_charge_rate",
                                            parseNumberOrFallback(event.target.value, 0.75)
                                          )
                                        }
                                      />
                                    </label>
                                    <label>
                                      <span>Import peak threshold kW</span>
                                      <input
                                        type="number"
                                        step="0.1"
                                        min={0}
                                        value={valueAsString(parsedModel, "algorithm.hyperparameters.import_peak_threshold_kw")}
                                        onChange={(event) =>
                                          updateVisualField(
                                            "algorithm.hyperparameters.import_peak_threshold_kw",
                                            parseNumberOrFallback(event.target.value, 7.0)
                                          )
                                        }
                                      />
                                    </label>
                                    <label>
                                      <span>Default EV capacity kWh</span>
                                      <input
                                        type="number"
                                        step="0.1"
                                        min={0}
                                        value={valueAsString(parsedModel, "algorithm.hyperparameters.default_capacity_kwh")}
                                        onChange={(event) =>
                                          updateVisualField(
                                            "algorithm.hyperparameters.default_capacity_kwh",
                                            parseNumberOrFallback(event.target.value, 60.0)
                                          )
                                        }
                                      />
                                    </label>
                                  </div>

                                  {showAlgorithmAdvanced ? (
                                    <div className="config-param-grid config-visual-advanced">
                                      <label>
                                        <span>Storage min SOC</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          min={0}
                                          value={valueAsString(parsedModel, "algorithm.hyperparameters.storage_min_soc")}
                                          onChange={(event) =>
                                            updateVisualField(
                                              "algorithm.hyperparameters.storage_min_soc",
                                              parseNumberOrFallback(event.target.value, 0.2)
                                            )
                                          }
                                        />
                                      </label>
                                      <label>
                                        <span>Storage max SOC</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          min={0}
                                          value={valueAsString(parsedModel, "algorithm.hyperparameters.storage_max_soc")}
                                          onChange={(event) =>
                                            updateVisualField(
                                              "algorithm.hyperparameters.storage_max_soc",
                                              parseNumberOrFallback(event.target.value, 0.9)
                                            )
                                          }
                                        />
                                      </label>
                                      <label>
                                        <span>Price discharge rate</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          min={0}
                                          value={valueAsString(parsedModel, "algorithm.hyperparameters.price_discharge_rate")}
                                          onChange={(event) =>
                                            updateVisualField(
                                              "algorithm.hyperparameters.price_discharge_rate",
                                              parseNumberOrFallback(event.target.value, 0.45)
                                            )
                                          }
                                        />
                                      </label>
                                      <label>
                                        <span>V2G reserve SOC</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          min={0}
                                          value={valueAsString(parsedModel, "algorithm.hyperparameters.ev_v2g_reserve_soc")}
                                          onChange={(event) =>
                                            updateVisualField(
                                              "algorithm.hyperparameters.ev_v2g_reserve_soc",
                                              parseNumberOrFallback(event.target.value, 0.15)
                                            )
                                          }
                                        />
                                      </label>
                                      <label>
                                        <span>Non-flexible chargers</span>
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
                                          placeholder="charger_1_1, charger_4_1"
                                        />
                                      </label>
                                      <label>
                                        <span>Seed</span>
                                        <input
                                          type="number"
                                          value={valueAsString(parsedModel, "algorithm.hyperparameters.seed")}
                                          onChange={(event) =>
                                            updateVisualField(
                                              "algorithm.hyperparameters.seed",
                                              event.target.value === ""
                                                ? null
                                                : parseNumberOrFallback(event.target.value, 123)
                                            )
                                          }
                                          placeholder="optional"
                                        />
                                      </label>
                                    </div>
                                  ) : null}
                                </section>
                              </div>
                            ) : null}

                            <section className="config-visual-subpanel">
                              <header className="config-subpanel-head">
                                <div>
                                  <span className="config-mini-label">Run mechanics</span>
                                  <h4>Training cadence and checkpointing</h4>
                                </div>
                              </header>

                              <div className="config-toggle-grid">
                                {[
                                  ["checkpointing.resume_training", "Resume training"],
                                  ["checkpointing.reset_replay_buffer", "Reset replay buffer"],
                                  ["checkpointing.freeze_pretrained_layers", "Freeze pretrained"],
                                  ["checkpointing.fine_tune", "Fine tune"],
                                  ["checkpointing.require_update_step", "Require update step"],
                                  ["checkpointing.require_initial_exploration_done", "Require exploration done"]
                                ].map(([path, label]) => (
                                  <label key={path} className="config-toggle-card">
                                    <input
                                      type="checkbox"
                                      checked={valueAsBoolean(parsedModel, path)}
                                      onChange={(event) => updateVisualField(path, event.target.checked)}
                                    />
                                    <span>{label}</span>
                                  </label>
                                ))}
                              </div>

                              <div className="config-param-grid">
                                <label>
                                  <span>Seed</span>
                                  <input
                                    type="number"
                                    value={valueAsString(parsedModel, "training.seed")}
                                    onChange={(event) =>
                                      updateVisualField("training.seed", parseNumberOrFallback(event.target.value, 123))
                                    }
                                  />
                                </label>
                                <label>
                                  <span>Steps between updates</span>
                                  <input
                                    type="number"
                                    min={1}
                                    value={valueAsString(parsedModel, "training.steps_between_training_updates")}
                                    onChange={(event) =>
                                      updateVisualField(
                                        "training.steps_between_training_updates",
                                        parseNumberOrFallback(event.target.value, 4)
                                      )
                                    }
                                  />
                                </label>
                                <label>
                                  <span>Target update interval</span>
                                  <input
                                    type="number"
                                    min={0}
                                    value={valueAsString(parsedModel, "training.target_update_interval")}
                                    onChange={(event) =>
                                      updateVisualField(
                                        "training.target_update_interval",
                                        parseNumberOrFallback(event.target.value, 2)
                                      )
                                    }
                                  />
                                </label>
                                <label>
                                  <span>Checkpoint interval</span>
                                  <input
                                    type="number"
                                    min={1}
                                    value={valueAsString(parsedModel, "checkpointing.checkpoint_interval")}
                                    onChange={(event) =>
                                      updateVisualField(
                                        "checkpointing.checkpoint_interval",
                                        event.target.value === ""
                                          ? null
                                          : parseNumberOrFallback(event.target.value, 5000)
                                      )
                                    }
                                    placeholder="disabled"
                                  />
                                </label>
                                <label>
                                  <span>Checkpoint artifact</span>
                                  <input
                                    value={valueAsString(parsedModel, "checkpointing.checkpoint_artifact")}
                                    onChange={(event) =>
                                      updateVisualField("checkpointing.checkpoint_artifact", event.target.value)
                                    }
                                  />
                                </label>
                                <label>
                                  <span>Checkpoint run ID</span>
                                  <input
                                    value={valueAsString(parsedModel, "checkpointing.checkpoint_run_id")}
                                    onChange={(event) =>
                                      updateVisualField(
                                        "checkpointing.checkpoint_run_id",
                                        event.target.value === "" ? null : event.target.value
                                      )
                                    }
                                    placeholder="optional"
                                  />
                                </label>
                              </div>
                            </section>
                          </div>

                        </div>
                      </ConfigStepShell>
                    ) : null}

                    {visualStepId === "tracking" ? (
                      <ConfigStepShell
                        eyebrow="Observability"
                        title="Tracking"
                        description="Control MLflow, progress files and diagnostic streams without opening raw YAML."
                      >
                        <div className="config-toggle-grid config-toggle-grid--tracking">
                          {[
                            ["tracking.mlflow_enabled", "MLflow"],
                            ["tracking.progress_updates_enabled", "Progress"],
                            ["tracking.system_metrics_enabled", "System metrics"],
                            ["tracking.action_diagnostics_enabled", "Action diagnostics"],
                            ["tracking.training_diagnostics_enabled", "Training diagnostics"],
                            ["tracking.reward_diagnostics_enabled", "Reward diagnostics"]
                          ].map(([path, label]) => (
                            <label key={path} className="config-toggle-card">
                              <input
                                type="checkbox"
                                checked={valueAsBoolean(parsedModel, path)}
                                onChange={(event) => updateVisualField(path, event.target.checked)}
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>

                        <div className="config-visual-grid config-visual-grid--relaxed">
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
                            <label>
                              <span>Action diagnostics detail</span>
                              <select
                                value={valueAsString(parsedModel, "tracking.action_diagnostics_detail") || "summary"}
                                onChange={(event) =>
                                  updateVisualField("tracking.action_diagnostics_detail", event.target.value)
                                }
                              >
                                <option value="summary">summary</option>
                                <option value="per_action">per_action</option>
                              </select>
                            </label>
                            <label>
                              <span>Training diagnostics detail</span>
                              <select
                                value={valueAsString(parsedModel, "tracking.training_diagnostics_detail") || "summary"}
                                onChange={(event) =>
                                  updateVisualField("tracking.training_diagnostics_detail", event.target.value)
                                }
                              >
                                <option value="summary">summary</option>
                                <option value="per_agent">per_agent</option>
                              </select>
                            </label>
                            <label>
                              <span>Reward diagnostics detail</span>
                              <select
                                value={valueAsString(parsedModel, "tracking.reward_diagnostics_detail") || "summary"}
                                onChange={(event) =>
                                  updateVisualField("tracking.reward_diagnostics_detail", event.target.value)
                                }
                              >
                                <option value="summary">summary</option>
                                <option value="per_agent">per_agent</option>
                              </select>
                            </label>
                          </div>
                        ) : null}
                      </ConfigStepShell>
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
