import { FLEXIBILITY_API_URL } from './communityApi';

export interface SelectionSettings {
  base_window_kind: 'required' | 'habitual';
  required_departure_time: string | null;
  default_soc_at_departure: number | null;
  default_cycle_id: string | null;
}
export interface SelectionPolicy {
  asset_id: string;
  revision: number;
  settings: Record<string, unknown> & { forecast_enabled: boolean; timezone: string; selection?: SelectionSettings };
}
export interface ChosenOffer {
  need_id: string; created_by: string | null; asset_id: string; event_id: string | null; occurrence_at: string | null;
  event_revision: number | null; exception_revision: number; exception_action?: 'modify' | 'cancel' | 'restore' | null;
  session_type: 'ev_charging' | 'appliance';
  status: 'resolved' | 'incomplete' | 'infeasible' | 'unavailable' | 'conflict';
  semantics: 'availability' | 'expected_usage'; starts_at: string | null; ends_at: string | null;
  soc_at_arrival: number | null; soc_at_departure: number | null;
  cycle: {id: string; name: string; duration_minutes: number; energy_consumption_kwh: number} | null;
  earliest_start: string | null; latest_start: string | null;
  origins: Record<string, { source: 'punctual' | 'recurrent' | 'forecast' | 'equipment' | 'requirement'; reference_id: string; revision: number | null }>;
  reasons: string[]; simulated: boolean; execution_ready: false;
}
export interface ChosenFlexibility {
  asset_id: string; policy_revision: number; computed_at: string;
  forecast?: {prediction_id?:string;request_id:string;revision:number;generated_at:string;valid_until:string;model_version:string;simulated:true}|null;
  forecast_windows?: Array<{event_id?:string|null;occurrence_at?:string|null;starts_at:string|null;ends_at:string|null;soc_at_arrival?:number|null}>;
  forecast_state: string; offers: ChosenOffer[]; decision_id: string | null;
}
export async function selectionRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${FLEXIBILITY_API_URL}/api/flexibility${path}`, {
    ...init, credentials: 'same-origin', headers: {'Content-Type': 'application/json', ...init.headers},
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível obter a flexibilidade.');
  return data as T;
}
