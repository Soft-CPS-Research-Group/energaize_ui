import { useId, useState } from "react";
import { Info } from "lucide-react";
import { kpiDisplayName, type KpiMeta } from "../../hooks/useKpiMetadata";

/** Info button that reveals a KPI's catalogue entry (description, formula, unit, window). */
export function KpiInfo({ meta }: { meta: KpiMeta }): JSX.Element {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const name = kpiDisplayName(meta, meta.name);

  return (
    <span className="kpi-info" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={`About ${name}`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setOpen(false)}
      >
        <Info size={15} />
      </button>
      {open ? (
        <span className="kpi-info-pop" id={popoverId} role="tooltip">
          <strong>{name}</strong>
          {meta.description ? <span className="kpi-info-desc">{meta.description}</span> : null}
          {meta.formula ? <code>{meta.formula}</code> : null}
          <span className="kpi-info-facts">
            <span>Unit</span><span>{meta.unit || "—"}</span>
            <span>Window</span><span>{meta.window || "—"}</span>
            <span>Level</span><span>{meta.level || "—"}</span>
            <span>Type</span><span>{meta.type || "—"}</span>
          </span>
        </span>
      ) : null}
    </span>
  );
}
