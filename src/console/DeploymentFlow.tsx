import { useEffect, useState } from "react";
import { runtimeRequest } from "../api/runtimeApi";
import { stamp } from "./deploymentModel";

type ObjectData = Record<string, unknown>;
const object = (v: unknown): ObjectData =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as ObjectData) : {};
export interface Cycle {
  id: string;
  timestamp: string;
  payload: ObjectData;
  truncated: boolean;
  inference_decision?: ObjectData;
  writer?: string;
}
export interface Feed {
  site_id: string;
  available: boolean;
  messages: Cycle[];
  checked_at: string;
  owner?: string | null;
  period_seconds?: number;
  instance_id?: string;
  measurement_names?: Record<string, { measurement: string }>;
}

export function useObservation<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  delay: number,
) {
  const [state, setState] = useState<{
    key: string;
    value?: T;
    error?: string;
  }>();
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await load(abort.signal);
        if (!abort.signal.aborted) setState({ key, value });
      } catch (e) {
        if (!abort.signal.aborted)
          setState({ key, error: (e as Error).message });
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, delay);
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [key, load, delay]);
  return state?.key === key ? state : undefined;
}

export async function readJson<T>(
  url: string,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw Error("Read failed (" + response.status + ")");
  return response.json();
}
export async function feed(
  site: string,
  archive: boolean,
  summary: boolean,
  signal: AbortSignal,
) {
  const count = summary ? 1 : 8;
  const batch = archive
    ? await readJson<Feed>(
        `/telemetry-api/api/measurements/sites/${site}/cycle-archive?limit=${count}&summary=${summary}`,
        signal,
      )
    : await runtimeRequest<Feed>(
        `/api/runtime/percepta/sites/${site}/messages?limit=${count}`,
        { signal },
      );
  if (batch.site_id !== site || !Array.isArray(batch.messages))
    throw Error("Unexpected house in cycle response");
  return batch;
}
export function receivedForecasts(cycle?: Cycle) {
  return Object.values(object(cycle?.payload.entities)).flatMap((raw) => {
    const entity = object(raw);
    if (entity.entity_type_id !== "forecast_service") return [];
    return Object.entries(object(entity.parameters)).flatMap(([id, value]) => {
      const entry = object(value);
      if (entry.generated !== false || !Array.isArray(entry.final_values))
        return [];
      const intervals = entry.final_values
        .map(object)
        .filter(
          (i) =>
            typeof i.value === "number" &&
            Number.isFinite(i.value) &&
            typeof i.period_start === "string" &&
            typeof i.period_end === "string",
        );
      return intervals.length
        ? [
            {
              id,
              name: String(entry.parameter_type_id || id),
              unit: String(entry.measurement_unit || ""),
              intervals,
            },
          ]
        : [];
    });
  });
}
export function recent(
  cycle: Cycle | undefined,
  period: number | undefined,
  now = Date.now(),
) {
  const age = cycle && now - Date.parse(cycle.timestamp);
  return (
    typeof age === "number" &&
    age >= -5000 &&
    age <= Math.max(90, (period || 60) * 2 + 30) * 1000
  );
}

export function CycleFlow({
  kind,
  batch,
  error,
}: {
  kind: string;
  batch?: Feed;
  error?: string;
}) {
  if (error) return <p role="alert">{error}</p>;
  if (!batch) return <p role="status">Loading cycles…</p>;
  const forecasts = kind === "delivery" || kind === "publish";
  const decision = kind === "decision";
  const rows = batch.messages.filter(
    (m) =>
      (!forecasts && !decision) ||
      (forecasts ? receivedForecasts(m).length : !!m.inference_decision),
  );
  return (
    <>
      <p>
        {forecasts
          ? "Forecasts received by Percepta, grouped by cycle."
          : decision
            ? "Inference responses recorded for this house’s cycles."
            : ["archive", "write", "read"].includes(kind)
              ? "Documents stored in this house’s MongoDB collection."
              : "Cycles published by Percepta."}{" "}
        Updates every 5 seconds.
      </p>
      {rows.length === 0 && (
        <p role="status">
          {forecasts
            ? "No received forecasts in the latest cycles."
            : decision
              ? "No recorded inference response in the latest cycles."
              : "No recorded cycles for this house."}
        </p>
      )}
      {rows.map((m, i) => (
        <details
          key={m.id}
          className="deployment-cycle"
          open={i === 0 || undefined}
        >
          <summary>{stamp(m.timestamp)}</summary>
          {m.truncated ? (
            <p>Payload exceeds the preview limit.</p>
          ) : forecasts ? (
            receivedForecasts(m).map((f) => (
              <details key={f.id}>
                <summary>
                  {batch.measurement_names?.[f.id]?.measurement || f.name} ·{" "}
                  {f.intervals.length} intervals
                </summary>
                <table>
                  <thead>
                    <tr>
                      <th>From</th>
                      <th>Until</th>
                      <th>Forecast</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.intervals.map((v, j) => (
                      <tr key={j}>
                        <td>{stamp(String(v.period_start))}</td>
                        <td>{stamp(String(v.period_end))}</td>
                        <td>
                          {String(v.value)} {f.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))
          ) : decision ? (
            <>
              <details>
                <summary>Recorded cycle</summary>
                <pre>{JSON.stringify(m.payload, null, 2)}</pre>
              </details>
              <h4>Recorded response</h4>
              <pre>{JSON.stringify(m.inference_decision, null, 2)}</pre>
            </>
          ) : (
            <pre>{JSON.stringify(m.payload, null, 2)}</pre>
          )}
        </details>
      ))}
    </>
  );
}
