import { displayMeasurementName } from "./PerceptaMeasurementEditor";
export const fieldName = (key: string) =>
  displayMeasurementName(key).replaceAll("_", " ");
/** Generic structured fields for decision actions and additional Percepta sections. */
export function FieldValues({ value }: { value: unknown }) {
  if (value == null || value === "") return <span>—</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  if (Array.isArray(value))
    return value.length ? (
      <ol className="cycle-value-list">
        {value.map((v, i) => (
          <li key={i}>
            <FieldValues value={v} />
          </li>
        ))}
      </ol>
    ) : (
      <span>None</span>
    );
  const fields = Object.entries(value);
  return fields.length ? (
    <dl className="cycle-fields">
      {fields.map(([key, v]) => (
        <div key={key}>
          <dt>{fieldName(key)}</dt>
          <dd>
            <FieldValues value={v} />
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <span>None</span>
  );
}
export const clockTime = (s?: string | null) =>
  s
    ? new Date(s).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";
export function cyclePeriod(
  configured?: number | null,
  payload?: Record<string, unknown>,
) {
  if (configured && configured > 0) return configured;
  const seconds =
    (Date.parse(String(payload?.period_end)) -
      Date.parse(String(payload?.period_start))) /
    1000;
  return seconds > 0 && Number.isFinite(seconds) ? seconds : undefined;
}

export function cycleRefreshSeconds(period?: number | null) {
  return period && period > 0 && Number.isFinite(period)
    ? Math.min(900, Math.max(15, Math.round(period)))
    : 60;
}
