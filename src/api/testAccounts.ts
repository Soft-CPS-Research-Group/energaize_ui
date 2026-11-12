import type { UserRole } from "../types";
export interface TestAccountContext {
  role: UserRole;
  community_id: string | null;
  community_name: string | null;
  site_id: string | null;
  site_name: string | null;
  equipment_count: number;
}
export interface TestAccount {
  id: string;
  email: string;
  name: string;
  contexts: TestAccountContext[];
}
export interface TestAccountChoice {
  account: TestAccount;
  context: TestAccountContext;
}
export async function readTestAccounts(
  signal: AbortSignal,
): Promise<TestAccount[]> {
  const response = await fetch("/community-api/api/identity/test-accounts", {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw new Error("Test accounts could not be loaded.");
  return ((await response.json()) as { accounts: TestAccount[] }).accounts;
}
