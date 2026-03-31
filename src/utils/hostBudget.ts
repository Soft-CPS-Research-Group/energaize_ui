export type BudgetAccountKind = "GPU" | "CPU" | "Account";

export function inferBudgetAccountKind(accountId: string | null | undefined): BudgetAccountKind {
  if (!accountId) return "Account";
  const normalized = accountId.trim().toLowerCase();
  if (normalized.endsWith("g")) return "GPU";
  if (normalized.endsWith("x")) return "CPU";
  return "Account";
}

