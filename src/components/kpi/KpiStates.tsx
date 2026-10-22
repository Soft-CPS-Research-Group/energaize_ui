import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "../ui/Button";
import { EVChargingLoader } from "../ui/EVChargingLoader";

/** Loading state shared by KPI pages: the app's charging loader plus an optional hint. */
export function KpiLoading({ label, hint }: { label: string; hint?: string }): JSX.Element {
  return (
    <div className="kpi-state" role="status">
      <EVChargingLoader label={label} />
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}

/** Error state: what failed, and a retry when the page can repeat the request. */
export function KpiError({ message, onRetry }: { message: ReactNode; onRetry?: () => void }): JSX.Element {
  return (
    <div className="kpi-state kpi-state-error" role="alert">
      <AlertTriangle size={20} aria-hidden="true" />
      <p>{message}</p>
      {onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}
