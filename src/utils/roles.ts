import type { UserRole } from "../types";

export function isTrainingManagerRole(role: UserRole | null | undefined): boolean {
  return role === "training_manager" || role === "ai_manager";
}

export function isPredictorRole(role: UserRole | null | undefined): boolean {
  return role === "predictor";
}

export function isKpiManagerRole(role: UserRole | null | undefined): boolean {
  return role === "kpi_manager";
}

export function roleHomePath(role: UserRole | null | undefined): string {
  if (isTrainingManagerRole(role)) return "/app/ai/jobs";
  if (isPredictorRole(role)) return "/app/predictor";
  if (isKpiManagerRole(role)) return "/app/kpi-manager";
  return "/communities";
}

export function roleLabel(role: UserRole | null | undefined): string {
  if (role === "training_manager") return "training manager";
  if (role === "ai_manager") return "training manager";
  if (role === "predictor") return "predictor";
  if (role === "kpi_manager") return "kpi manager";
  if (role === "rec_manager") return "rec manager";
  if (role === "prosumer") return "prosumer";
  return "unknown";
}
