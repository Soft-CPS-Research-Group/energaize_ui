import { useEffect, useRef, useState } from "react";
import { runtimeRequest } from "../api/runtimeApi";
import { MessageEquipment, type MeasurementNames } from "./PerceptaMessages";
import {
  clockTime,
  cyclePeriod,
  cycleRefreshSeconds,
  FieldValues,
  fieldName,
} from "./CycleReadings";
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
  measurement_names?: MeasurementNames;
}

export function useObservation<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  delay: number | ((value?: T) => number),
) {
  const [state, setState] = useState<{
    key: string;
    value?: T;
    error?: string;
  }>();
  const interval = useRef(delay);
  interval.current = delay;
  const fixedDelay = typeof delay === "number" ? delay : undefined;
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    async function poll() {
      if (busy || abort.signal.aborted || document.hidden) return;
      clearTimeout(timer);
      busy = true;
      let value: T | undefined;
      try {
        value = await load(abort.signal);
        if (!abort.signal.aborted) setState({ key, value });
      } catch (e) {
        if (!abort.signal.aborted)
          setState({ key, error: (e as Error).message });
      } finally {
        busy = false;
        if (!abort.signal.aborted && !document.hidden)
          timer = setTimeout(
            poll,
            typeof interval.current === "number"
              ? interval.current
              : interval.current(value),
          );
      }
    }
    function visibility() {
      clearTimeout(timer);
      if (!document.hidden) void poll();
    }
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [key, load, fixedDelay]);
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
export function deviceReadings(cycle?: Cycle) {
  return Object.fromEntries(
    Object.entries(object(cycle?.payload.entities)).filter(([, raw]) => {
      const entity = object(raw);
      return (
        typeof entity.entity_type_id === "string" &&
        !["energy_market", "forecast_service", "community"].includes(
          entity.entity_type_id,
        )
      );
    }),
  );
}
export function hasDeviceSamples(cycle?: Cycle) {
  return Object.values(deviceReadings(cycle)).some((raw) =>
    Object.values(object(object(raw).parameters)).some((value) => {
      const entry = object(value);
      return (
        entry.generated === false &&
        Array.isArray(entry.final_values) &&
        entry.final_values.some((v) => object(v).value != null)
      );
    }),
  );
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

type FlowProps = {
  kind: string;
  batch?: Feed;
  error?: string;
  periodSeconds?: number;
  measurementNames?: MeasurementNames;
};
const archiveKinds = ["archive", "write", "read"];
export function CycleFlow({
  kind,
  batch,
  error,
  periodSeconds,
  measurementNames,
}: FlowProps) {
  const [pinned, setPinned] = useState<Cycle>();
  if (error) return <p role="alert">{error}</p>;
  if (!batch) return <p role="status">Loading cycles…</p>;
  const forecasts = kind === "delivery" || kind === "publish",
    decision = kind === "decision" || kind === "request";
  const rows = batch.messages.filter((m) =>
    forecasts
      ? receivedForecasts(m).length > 0
      : decision
        ? !!m.inference_decision
        : true,
  );
  const current = pinned || rows[0],
    period = cyclePeriod(
      periodSeconds ?? batch.period_seconds,
      batch.messages[0]?.payload,
    );
  const labels = batch.measurement_names ?? measurementNames ?? {};
  return (
    <>
      <div className="cycle-timing">
        <div>
          <span>Page check</span>
          <strong>
            Every {cycleRefreshSeconds(periodSeconds ?? batch.period_seconds)}{" "}
            seconds
          </strong>
        </div>
        <div>
          <span>Last checked</span>
          <strong>
            <time dateTime={batch.checked_at}>
              {clockTime(batch.checked_at)}
            </time>
          </strong>
        </div>
        <div>
          <span>House cycle</span>
          <strong>{period ? period + " seconds" : "Unknown"}</strong>
        </div>
        <div>
          <span>
            Latest{" "}
            {decision ? "decision" : forecasts ? "forecast cycle" : "cycle"}
          </span>
          <strong>{clockTime(rows[0]?.timestamp)}</strong>
        </div>
      </div>
      <p>
        {forecasts
          ? "Forecasts received by Percepta, grouped by cycle."
          : decision
            ? kind === "request"
              ? "Cycles with a recorded inference exchange."
              : "Proposals returned by inference for this house’s cycles."
            : archiveKinds.includes(kind)
              ? "Cycles stored in this house’s MongoDB collection."
              : kind === "observations"
                ? "Equipment readings in the cycle assembled by Percepta. Generated values and missing readings are marked."
                : "Cycles published by Percepta."}
      </p>
      {!current ? (
        <p role="status">
          {forecasts
            ? "No received forecasts in the latest cycles."
            : decision
              ? "No recorded inference response in the latest cycles."
              : "No recorded cycles for this house."}
        </p>
      ) : (
        <div className="cycle-reader">
          <nav aria-label="Recent cycles">
            <button
              type="button"
              aria-pressed={!pinned}
              onClick={() => setPinned(undefined)}
            >
              Follow latest
            </button>
            {rows.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setPinned(m)}
                aria-current={m.id === current.id ? "true" : undefined}
              >
                {clockTime(m.timestamp)}
              </button>
            ))}
          </nav>
          <article className="deployment-cycle">
            <h4>
              {new Date(current.timestamp).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              })}{" "}
              · {clockTime(current.timestamp)}
            </h4>
            {current.truncated ? (
              <p>Payload exceeds the preview limit.</p>
            ) : (
              <>
                {forecasts ? (
                  receivedForecasts(current).map((f) => (
                    <details key={f.id}>
                      <summary>
                        {fieldName(labels[f.id]?.measurement || f.name)} ·{" "}
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
                ) : kind === "request" || kind === "observations" ? (
                  <MessageEquipment
                    entities={
                      kind === "request"
                        ? current.payload.entities
                        : deviceReadings(current)
                    }
                    names={labels}
                  />
                ) : decision ? (
                  <>
                    <h4>Recorded decision</h4>
                    <FieldValues value={current.inference_decision} />
                  </>
                ) : (
                  <>
                    {!!current.payload.entities && (
                      <MessageEquipment
                        entities={current.payload.entities}
                        names={labels}
                      />
                    )}
                    {Object.entries(current.payload)
                      .filter(
                        ([key]) =>
                          !["entities", "period_start", "period_end"].includes(
                            key,
                          ),
                      )
                      .map(([key, value]) => (
                        <details key={key}>
                          <summary>{fieldName(key)}</summary>
                          <FieldValues value={value} />
                        </details>
                      ))}
                  </>
                )}
                <details>
                  <summary>Original JSON</summary>
                  <pre>
                    {JSON.stringify(
                      decision
                        ? {
                            cycle: current.payload,
                            decision: current.inference_decision,
                          }
                        : current.payload,
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </>
            )}
          </article>
        </div>
      )}
    </>
  );
}
