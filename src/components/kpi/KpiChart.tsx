import React, { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/KpiCard";
import { format } from "date-fns";
import { useKpiMetadata } from "../../hooks/useKpiMetadata";
import { Info } from "lucide-react";

interface KpiChartProps {
  title: string;
  data: any[];
  lines: string[];
  kpiName?: string;
}

const COLORS = ["#2563eb", "#ea580c", "#16a34a", "#dc2626", "#9333ea"];

export const KpiChart = React.memo(function KpiChart({ title, data, lines, kpiName }: KpiChartProps) {
  const [hiddenLines, setHiddenLines] = useState<Record<string, boolean>>({});
  const { kpis } = useKpiMetadata();
  const [showInfo, setShowInfo] = useState(false);

  const meta = kpiName ? kpis.find(k => k.name === kpiName) : null;

  const toggleLine = (dataKey: string) => {
    setHiddenLines((prev) => ({
      ...prev,
      [dataKey]: !prev[dataKey],
    }));
  };

  return (
    <Card style={{ gridColumn: "1 / -1" }}>
      <CardHeader>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", position: "relative" }}>
            <CardTitle>{title}</CardTitle>
            {meta && (
              <div 
                className="relative flex items-center"
                onMouseEnter={() => setShowInfo(true)}
                onMouseLeave={() => setShowInfo(false)}
              >
                <button
                  style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.5, color: "var(--text)" }}
                >
                  <Info size={16} />
                </button>
                {showInfo && (
                  <div className="panel" style={{ position: "absolute", left: "2rem", top: 0, zIndex: 50, width: "300px", padding: "1rem" }}>
                    <p style={{ fontWeight: "bold", margin: "0 0 0.5rem 0" }}>{meta.display_name || meta.canonical_name || meta.name}</p>
                    {meta.description && (
                      <p style={{ fontSize: "0.85rem", margin: "0 0 1rem 0", opacity: 0.8 }}>{meta.description}</p>
                    )}
                    <div style={{ background: "var(--bg-elev-2)", padding: "0.5rem", borderRadius: "8px", marginBottom: "1rem" }}>
                      <p style={{ fontSize: "0.7rem", textTransform: "uppercase", margin: "0 0 0.25rem 0", opacity: 0.6 }}>Formula</p>
                      <code style={{ fontSize: "0.75rem" }}>{meta.formula || "�"}</code>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", fontSize: "0.75rem", opacity: 0.8 }}>
                      <span><span style={{ fontWeight: "bold" }}>Unit:</span> {meta.unit || "�"}</span>
                      <span><span style={{ fontWeight: "bold" }}>Window:</span> {meta.window}</span>
                      <span><span style={{ fontWeight: "bold" }}>Level:</span> {meta.level}</span>
                      <span><span style={{ fontWeight: "bold" }}>Type:</span> {meta.type}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {lines.map((key, i) => (
              <button
                key={key}
                onClick={() => toggleLine(key)}
                style={{
                  fontSize: "0.85rem",
                  padding: "0.25rem 0.75rem",
                  borderRadius: "999px",
                  border: "1px solid var(--line-strong)",
                  background: hiddenLines[key] ? "var(--bg-elev-2)" : "var(--bg-elev)",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  borderColor: hiddenLines[key] ? undefined : COLORS[i % COLORS.length],
                  color: hiddenLines[key] ? "var(--text-soft)" : COLORS[i % COLORS.length],
                }}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div style={{ height: "350px", width: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(val) => {
                  try {
                    return format(new Date(val.replace(' ', 'T')), "MMM dd, HH:mm");
                  } catch {
                    return val;
                  }
                }}
                minTickGap={30}
                style={{ fontSize: "13px", fill: "var(--text)" }}
              />
              <YAxis 
                width={80}
                style={{ fontSize: "13px", fill: "var(--text)" }} 
                label={{ value: meta?.unit || "", angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: 'var(--text)' }, offset: -10 }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg-elev)', borderColor: 'var(--line)', color: 'var(--text)', borderRadius: "8px", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                itemStyle={{ color: 'var(--text)' }}
                formatter={(value: any) => {
                  if (typeof value === 'number') {
                    return [meta?.unit ? `${value.toFixed(2)} ${meta.unit}` : value.toFixed(2)];
                  }
                  return [value];
                }}
                labelFormatter={(val) => {
                  try {
                    return format(new Date(val.replace(' ', 'T')), "PPp");
                  } catch {
                    return val;
                  }
                }}
              />
              <Legend />
              {lines.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6 }}
                  isAnimationActive={false}
                  hide={hiddenLines[key]}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
});
