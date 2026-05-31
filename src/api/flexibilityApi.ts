import { FLEXIBILITY_API_URL } from "./communityApi";

export interface FlexCalendar {
  calendar_id: string;
  user_id: string;
  summary: string;
  description: string;
  timezone: string;
  created_at: string;
}

export interface FlexibilityEvent {
  event_id: string;
  session_type: string;
  asset_id: string;
  calendar_id: string | null;
  flex_offer_id: string | null;
  mode: string;
  recurrence: Record<string, unknown> | null;
  title: string;
  description: string;
  created_at: string;
  type_specific_data: Record<string, unknown>;
}

export interface FlexOffer {
  flex_offer_id: string;
  generated_at: string;
  time_flexibility: {
    earliest_start_time: string;
    latest_start_time: string;
  };
  total_energy_constraint: {
    min_kwh: number;
    max_kwh: number;
  };
  energy_profiles: Array<{
    duration_minutes: number;
    energy_min_kwh: number;
    energy_max_kwh: number;
  }>;
}

export interface CreateCalendarPayload {
  user_id: string;
  summary: string;
  description?: string;
  timezone?: string;
}

export interface CreateEvChargingSessionPayload {
  asset_id: string;
  calendar_id?: string | null;
  flex_offer_id?: string | null;
  mode: string;
  recurrence?: Record<string, unknown> | null;
  title: string;
  description?: string;
  soc_at_arrival: number;
  soc_at_departure: number;
  charger_id: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${FLEXIBILITY_API_URL}${path.startsWith("/") ? path : `/${path}`}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    },
    ...init
  });

  if (!response.ok) {
    let message = `Flexibility API request failed (${response.status})`;
    try {
      const data = await response.json();
      message = data.detail || data.message || message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function listCalendars(): Promise<FlexCalendar[]> {
  return request<FlexCalendar[]>("/api/calendars/");
}

export function listCalendarsByUser(userId: string): Promise<FlexCalendar[]> {
  return request<FlexCalendar[]>(`/api/calendars/by-user/${userId}`);
}

export function createCalendar(payload: CreateCalendarPayload): Promise<FlexCalendar> {
  return request<FlexCalendar>("/api/calendars/", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listFlexibilityEvents(): Promise<FlexibilityEvent[]> {
  return request<FlexibilityEvent[]>("/api/flexibility-events/");
}

export function listFlexibilityEventsByAsset(assetId: string): Promise<FlexibilityEvent[]> {
  return request<FlexibilityEvent[]>(`/api/flexibility-events/by-asset/${assetId}`);
}

export function createEvChargingSession(payload: CreateEvChargingSessionPayload): Promise<FlexibilityEvent> {
  return request<FlexibilityEvent>("/api/flexibility-events/ev-charging", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listFlexOffers(): Promise<FlexOffer[]> {
  return request<FlexOffer[]>("/api/flex-offers/");
}

export function listFlexOffersByEvent(eventId: string): Promise<FlexOffer[]> {
  return request<FlexOffer[]>(`/api/flex-offers/by-event/${eventId}`);
}
