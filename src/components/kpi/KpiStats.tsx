import React, { useId, useState } from "react";
import { Info } from "lucide-react";
import { kpiDisplayName, type KpiMeta } from "../../hooks/useKpiMetadata";

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
  const [showInfo, setShowInfo] = useState(false);
  const popoverId = useId();

  return (
    <article className="kpi-stat">
      <div className="kpi-stat-head">
        <div>
          <h3 className="kpi-stat-title">{title}</h3>
          {subtitle ? <div className="kpi-stat-scope">{subtitle}</div> : null}
        </div>
        {meta ? (
          <div
            className="kpi-stat-info"
            onMouseEnter={() => setShowInfo(true)}
            onMouseLeave={() => setShowInfo(false)}
          >
            <button
              type="button"
              aria-label={`About ${title}`}
              aria-expanded={showInfo}
              aria-controls={popoverId}
              onClick={() => setShowInfo((open) => !open)}
              onBlur={() => setShowInfo(false)}
            >
              <Info size={15} />
            </button>
            {showInfo ? (
              <div className="kpi-stat-info-pop" id={popoverId} role="tooltip">
                <strong>{kpiDisplayName(meta, meta.name)}</strong>
                {meta.description ? <p>{meta.description}</p> : null}
                {meta.formula ? <code>{meta.formula}</code> : null}
                <dl>
                  <dt>Unit</dt><dd>{meta.unit || "—"}</dd>
                  <dt>Window</dt><dd>{meta.window || "—"}</dd>
                  <dt>Level</dt><dd>{meta.level || "—"}</dd>
                  <dt>Type</dt><dd>{meta.type || "—"}</dd>
                </dl>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="kpi-stat-value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {description ? <p className="kpi-stat-desc">{description}</p> : null}
    </article>
  );
});
