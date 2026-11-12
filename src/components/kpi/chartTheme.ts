import type { CSSProperties } from "react";

/** Recharts styling shared by the KPI charts, on theme tokens. */
export const KPI_AXIS_TICK = { fontSize: 11, fill: "var(--text-soft)" };

export const KPI_TOOLTIP_STYLE: CSSProperties = {
  borderRadius: 10, fontSize: 12, backgroundColor: "var(--bg-elev)", borderColor: "var(--line)", color: "var(--text)",
};
