import type { ReactNode } from "react";

export interface KpiSegment<K extends string> {
  key: K;
  label: string;
  icon?: ReactNode;
}

interface KpiSegmentedProps<K extends string> {
  segments: KpiSegment<K>[];
  value: K;
  onChange: (key: K) => void;
  ariaLabel: string;
  /** Prefix for tab/panel ids, so a tab can point at its panel with aria-controls. */
  idPrefix?: string;
}

/** In-page view switcher (tablist) with the same pill look as the section sub-tabs. */
export function KpiSegmented<K extends string>({
  segments, value, onChange, ariaLabel, idPrefix,
}: KpiSegmentedProps<K>): JSX.Element {
  return (
    <div className="kpi-segmented" role="tablist" aria-label={ariaLabel}>
      {segments.map(({ key, label, icon }) => {
        const isActive = key === value;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            id={idPrefix ? `${idPrefix}-tab-${key}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${key}` : undefined}
            className={`kpi-segmented-tab${isActive ? " is-active" : ""}`}
            onClick={() => onChange(key)}
          >
            {icon}
            {label}
          </button>
        );
      })}
    </div>
  );
}
