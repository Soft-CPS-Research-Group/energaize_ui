import { useId, type ReactNode } from "react";
import { Activity, Building2, Calendar, MapPin } from "lucide-react";
import { Button } from "../ui/Button";
import { MultiSelect } from "../ui/MultiSelect";

/** yyyy-mm-dd of a date in the browser's time zone (what <input type="date"> expects). */
export function toLocalDateString(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];
}

/** "living_lab" → "Living lab" */
export function communityLabel(id: string): string {
  const words = id.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface FilterBarProps {
  children: ReactNode;
  /** Row below the fields, for run options and the primary action. */
  footer?: ReactNode;
  ariaLabel?: string;
}

/** Panel holding a page's filters: fields wrap in a grid, actions sit in the footer. */
export function KpiFilterBar({ children, footer, ariaLabel = "Filters" }: FilterBarProps): JSX.Element {
  return (
    <section className="panel kpi-filterbar" aria-label={ariaLabel}>
      <div className="kpi-filterbar-fields">{children}</div>
      {footer ? <div className="kpi-filterbar-footer">{footer}</div> : null}
    </section>
  );
}

interface FieldProps {
  label: string;
  icon?: ReactNode;
  hint?: string;
  /** Relative width in the filter grid. */
  size?: "sm" | "md" | "lg";
  /** id of a native control, so clicking the label focuses it. */
  htmlFor?: string;
  children: ReactNode;
}

export function KpiField({ label, icon, hint, size = "md", htmlFor, children }: FieldProps): JSX.Element {
  const caption = (
    <>
      {icon}
      {label}
      {hint ? <small>{hint}</small> : null}
    </>
  );
  return (
    <div className={`kpi-field kpi-field-${size}`}>
      {htmlFor
        ? <label className="kpi-field-label" htmlFor={htmlFor}>{caption}</label>
        : <span className="kpi-field-label">{caption}</span>}
      {children}
    </div>
  );
}

export function CommunityField({ communities, value, onChange }: {
  communities: string[];
  value: string;
  onChange: (community: string) => void;
}): JSX.Element {
  const id = useId();
  return (
    <KpiField label="Community" icon={<MapPin size={14} />} htmlFor={id}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {communities.map((c) => <option key={c} value={c}>{communityLabel(c)}</option>)}
      </select>
    </KpiField>
  );
}

export function BuildingsField({ buildings, selected, onChange }: {
  buildings: string[];
  selected: string[];
  onChange: (buildings: string[]) => void;
}): JSX.Element {
  return (
    <KpiField label="Buildings" icon={<Building2 size={14} />} size="lg">
      <MultiSelect
        options={buildings.map((b) => ({ label: b, value: b }))}
        selected={selected}
        onChange={onChange}
        placeholder="Select buildings…"
      />
    </KpiField>
  );
}

export function KpiSelectField({ options, selected, onChange, label = "KPIs" }: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (kpis: string[]) => void;
  label?: string;
}): JSX.Element {
  return (
    <KpiField label={label} icon={<Activity size={14} />} size="lg">
      <MultiSelect options={options} selected={selected} onChange={onChange} placeholder="Select KPIs…" />
    </KpiField>
  );
}

export interface DatePreset {
  label: string;
  /** Start = today minus this many days; end = today. */
  days: number;
}

export const DEFAULT_DATE_PRESETS: DatePreset[] = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];

export function DateRangeField({ start, end, onChange, presets = DEFAULT_DATE_PRESETS, label = "Period" }: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  presets?: DatePreset[];
  label?: string;
}): JSX.Element {
  const id = useId();
  const applyPreset = (days: number) => {
    const from = new Date();
    from.setDate(from.getDate() - days);
    onChange(toLocalDateString(from), toLocalDateString(new Date()));
  };
  return (
    <KpiField label={label} icon={<Calendar size={14} />} size="lg" htmlFor={`${id}-start`}>
      <div className="kpi-daterange">
        <input id={`${id}-start`} type="date" aria-label={`${label} start`} value={start} max={end || undefined}
          onChange={(e) => onChange(e.target.value, end)} />
        <span aria-hidden="true">–</span>
        <input type="date" aria-label={`${label} end`} value={end} min={start || undefined}
          onChange={(e) => onChange(start, e.target.value)} />
        {presets.length > 0 ? (
          <div className="kpi-presets">
            {presets.map((p) => (
              <Button key={p.label} variant="secondary" size="sm" onClick={() => applyPreset(p.days)}>{p.label}</Button>
            ))}
          </div>
        ) : null}
      </div>
    </KpiField>
  );
}

/** Accessible on/off switch (a checkbox with role="switch"). */
export function KpiSwitch({ checked, onChange, label, hint }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}): JSX.Element {
  return (
    <label className="kpi-switch" title={hint}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="kpi-switch-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
