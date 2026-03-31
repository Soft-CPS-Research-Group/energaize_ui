import type { CommunityContext, UserRole } from "./types";

export const APP_NAME = "EnergAIze";
export const AI_AVATAR_URL =
  "https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=260&q=80";

export const MOCK_USERS: Record<
  string,
  { password: string; name: string; role: UserRole }
> = {
  "tiago.fonseca@energaize.io": {
    password: "TfTm#2026!",
    name: "Tiago Fonseca",
    role: "training_manager"
  },
  "guilherme.sousa@energaize.io": {
    password: "GbdsTm#2026!",
    name: "Guilherme Barbosa De Sousa",
    role: "training_manager"
  },
  "pedro.monteiro@energaize.io": {
    password: "PamTm#2026!",
    name: "Pedro Alves Monteiro",
    role: "training_manager"
  },
  "gustavo.jorge@energaize.io": {
    password: "GnCJTm#2026!",
    name: "Gustavo Nuno Chaves Jorge",
    role: "training_manager"
  },
  "bernardo.cardoso@energaize.io": {
    password: "BpNgcPred#2026!",
    name: "Bernardo Paiva Do Novo Granja Cardoso",
    role: "predictor"
  },
  "francisco.lousada@energaize.io": {
    password: "FbLlKpi#2026!",
    name: "Francisco Barradas Lemos Lousada",
    role: "kpi_manager"
  },
  "rec@energaize.io": {
    password: "rec123",
    name: "REC Manager",
    role: "rec_manager"
  },
  "prosumer@energaize.io": {
    password: "pros123",
    name: "Prosumer",
    role: "prosumer"
  }
};

export const INITIAL_COMMUNITIES: CommunityContext[] = [
  {
    id: "solar-community",
    name: "Solar Community",
    location: "Porto, PT",
    description: "Residential microgrid with shared PV and EV assets.",
    buildings: 11,
    assets: 38,
    status: "normal"
  },
  {
    id: "river-grid",
    name: "River Grid",
    location: "Gaia, PT",
    description: "Mixed-use energy community with BESS orchestration.",
    buildings: 7,
    assets: 22,
    status: "alerts"
  },
  {
    id: "wind-hub",
    name: "Wind Hub",
    location: "Braga, PT",
    description: "Pilot site for distributed flexibility operations.",
    buildings: 5,
    assets: 17,
    status: "offline"
  }
];

export const QUICK_PERIODS = ["Last 15m", "1h", "24h", "7d", "30d"];

export const LOGIN_BACKGROUNDS = [
  "https://images.unsplash.com/photo-1466611653911-95081537e5b7?auto=format&fit=crop&w=2200&q=80",
  "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=2200&q=80",
  "https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=2200&q=80"
] as const;

export const JOB_POLL_MS = 5000;
export const HOSTS_POLL_MS = 7000;
export const DATASETS_POLL_MS = 10000;
export const LOGS_POLL_MS = 2000;

export const AUTH_SCENE_STORAGE_KEY = "energaize:auth-scene";
