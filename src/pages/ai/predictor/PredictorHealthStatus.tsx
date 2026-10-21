import { useId, useState } from "react";
import { Activity, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { usePredictorHealth } from "../../../hooks/usePredictor";
import type { PredictorHealth } from "../../../api/predictorApi";

export type HealthTone = "good" | "warning" | "error" | "checking";

export interface HealthSummary {
  tone: HealthTone;
  headline: string;
  description: string;
  details: string[];
}

function formatTime(iso: string | null | undefined, timezone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-GB", { timeZone: timezone, dateStyle: "short", timeStyle: "short" });
}

function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/** Turn GET /api/health into one plain-language state for the header icon. */
export function describeHealth(
  health: PredictorHealth | undefined,
  failed: boolean,
  timezone: string
): HealthSummary {
  if (failed && !health) {
    return {
      tone: "error",
      headline: "Service unreachable",
      description: "The forecasting service did not answer. It may be offline or restarting.",
      details: [],
    };
  }
  if (!health) {
    return { tone: "checking", headline: "Checking service…", description: "Waiting for the first health check.", details: [] };
  }

  const details: string[] = [];
  const completed = formatTime(health.last_cycle_completed_at, timezone);
  if (completed) {
    const duration = health.last_cycle_duration_s != null ? ` in ${Math.round(health.last_cycle_duration_s)} s` : "";
    details.push(`Last cycle finished ${completed}${duration}`);
  }
  const published = formatTime(health.last_publish_at, timezone);
  if (published) details.push(`Last forecast published ${published}`);

  const failedHouses = health.last_cycle_houses_failed ?? 0;
  if (health.paused) {
    return {
      tone: "warning",
      headline: "Scheduled forecasts paused",
      description: "No forecasts run on the 15-minute schedule until the scheduler is resumed.",
      details,
    };
  }
  if (!health.healthy) {
    const since = health.seconds_since_progress != null ? ` for ${formatMinutes(health.seconds_since_progress)}` : "";
    return {
      tone: "error",
      headline: "Forecast cycles stalled",
      description: `No forecast cycle has completed${since}. The service restarts itself if this lasts an hour.`,
      details,
    };
  }
  if (health.publisher_connected === false) {
    return {
      tone: "warning",
      headline: "Forecasts not delivered",
      description: "Forecasts are computed but the message broker is disconnected, so they are not published.",
      details,
    };
  }
  if (failedHouses > 0) {
    return {
      tone: "warning",
      headline: `${failedHouses} ${failedHouses === 1 ? "house" : "houses"} without a forecast`,
      description: "Their last cycle failed, so nothing was published for them. Check the logs for the reason.",
      details,
    };
  }
  return {
    tone: "good",
    headline: "Working normally",
    description: "Forecast cycles are completing and being published.",
    details,
  };
}

const ICONS = { good: CircleCheck, warning: TriangleAlert, error: CircleAlert, checking: Activity } as const;

export function PredictorHealthStatus({ timezone }: { timezone: string }) {
  const { data, isError, dataUpdatedAt, errorUpdatedAt } = usePredictorHealth();
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const summary = describeHealth(data, isError, timezone);
  const Icon = ICONS[summary.tone];
  const lastCheck = Math.max(dataUpdatedAt, errorUpdatedAt);

  return (
    <div className="predictor-health" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className={`predictor-health-icon is-${summary.tone}`}
        aria-label={`Service status: ${summary.headline}`}
        aria-describedby={open ? tooltipId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            event.stopPropagation();
          }
        }}
      >
        <Icon size={20} aria-hidden="true" />
      </button>
      {open && (
        <div id={tooltipId} role="tooltip" className="predictor-health-tooltip">
          <strong>{summary.headline}</strong>
          <p>{summary.description}</p>
          {summary.details.length > 0 && (
            <ul>
              {summary.details.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          <small>
            {lastCheck ? `Checked ${new Date(lastCheck).toLocaleTimeString("en-GB", { timeZone: timezone })}` : "Checking…"} · Updates every 30 s
          </small>
        </div>
      )}
      {/* Only problems are announced, so screen readers stay quiet on every healthy poll. */}
      <span className="sr-only" role={summary.tone === "error" ? "alert" : "status"} aria-atomic="true">
        {summary.tone === "warning" || summary.tone === "error" ? summary.headline : ""}
      </span>
    </div>
  );
}
