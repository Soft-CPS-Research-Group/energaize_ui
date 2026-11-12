import React, { useState } from "react";
import { Line, Tooltip, XAxis, YAxis } from "recharts";
import { TimeseriesPlot } from "../charts/TimeseriesPlot";
import { KPI_AXIS_TICK, KPI_TOOLTIP_STYLE } from "./chartTheme";
import { format } from "date-fns";
import { useKpiMetadata } from "../../hooks/useKpiMetadata";
import { KpiInfo } from "./KpiInfo";

interface KpiChartProps {
  title: string;
  data: any[];
  lines: string[];
  kpiName?: string;
}

/** Series colours on theme tokens, so both light and dark ceramic themes stay legible. */
export const SERIES_COLORS = [
  "var(--brand)",
  "var(--kpi-cat-ev)",
  "var(--kpi-cat-energy)",
  "var(--kpi-cat-equity)",
  "var(--kpi-cat-carbon)",
  "var(--kpi-cat-economic)",
];

/** "building_R-H-01_EnergyCostKPI" → "R-H-01" for the chips and tooltip. */
export function seriesLabel(key: string, kpiName?: string): string {
  const scope = kpiName && key.endsWith(`_${kpiName}`) ? key.slice(0, -kpiName.length - 1) : key;
  return scope.replace(/^building_/, "");
}

function formatTime(value: string, pattern: string): string {
  try {
    return format(new Date(String(value).replace(" ", "T")), pattern);
  } catch {
    return value;
  }
}

export const KpiChart = React.memo(function KpiChart({ title, data, lines, kpiName }: KpiChartProps) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const { kpis } = useKpiMetadata();
  const meta = kpiName ? kpis.find(k => k.name === kpiName) : undefined;
  const unit = meta?.unit ?? "";

  return (
    <section className="panel kpi-chart-card kpi-chart-wide" aria-label={title}>
      <header className="kpi-chart-head">
        <div className="kpi-chart-card-head">
          <h3>{title}{meta ? <KpiInfo meta={meta} /> : null}</h3>
        </div>
        <div className="kpi-series-chips" role="group" aria-label="Series">
          {lines.map((key, i) => (
            <button
              key={key}
              type="button"
              className="kpi-series-chip"
              aria-pressed={!hidden[key]}
              style={{ "--series": SERIES_COLORS[i % SERIES_COLORS.length] } as React.CSSProperties}
              onClick={() => setHidden(prev => ({ ...prev, [key]: !prev[key] }))}
            >
              {seriesLabel(key, kpiName)}
            </button>
          ))}
        </div>
      </header>
      <div className="kpi-chart-body">
        <TimeseriesPlot data={data} height={320} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
          <XAxis
            dataKey="timestamp"
            tickFormatter={(val) => formatTime(val, "MMM dd, HH:mm")}
            minTickGap={30}
            tick={KPI_AXIS_TICK}
          />
          <YAxis
            width={80}
            tick={KPI_AXIS_TICK}
            label={{ value: unit, angle: -90, position: "insideLeft", style: { textAnchor: "middle", fill: "var(--text-soft)" }, offset: -10 }}
          />
          <Tooltip
            contentStyle={KPI_TOOLTIP_STYLE}
            itemStyle={{ color: "var(--text)" }}
            formatter={(value: any, name: any) => [
              typeof value === "number" ? `${value.toFixed(2)}${unit ? ` ${unit}` : ""}` : value,
              name,
            ]}
            labelFormatter={(val) => formatTime(val, "PPp")}
          />
          {lines.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={seriesLabel(key, kpiName)}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
              hide={hidden[key]}
            />
          ))}
        </TimeseriesPlot>
      </div>
    </section>
  );
});
