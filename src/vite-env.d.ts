/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_JOB_ORCHESTRATOR_API_URL: string
  readonly VITE_SIMULATION_DATA_PROVIDER: string
  readonly VITE_PREDICTOR_API_URL: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
