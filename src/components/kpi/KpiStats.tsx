import React from "react";
import type { KpiMeta } from "../../hooks/useKpiMetadata";
import { KpiInfo } from "./KpiInfo";

interface KpiStatsProps {
  title: string;
  value: number | string;
  unit?: string;
  description?: string;
  subtitle?: string;
  /** Catalogue entry, shown in the info popover (formula, unit, window). */
  meta?: KpiMeta;
}

/** Summary card for one KPI result. */
export const KpiStats = React.memo(function KpiStats({
  title, value, unit, description, subtitle, meta,
}: KpiStatsProps) {
  return (
    <article className="kpi-stat">
      <div className="kpi-stat-head">
        <div>
          <h3 className="kpi-stat-title">{title}</h3>
          {subtitle ? <div className="kpi-stat-scope">{subtitle}</div> : null}
        </div>
        {meta ? <KpiInfo meta={meta} /> : null}
      </div>
      <div className="kpi-stat-value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {description ? <p className="kpi-stat-desc">{description}</p> : null}
    </article>
  );
});
