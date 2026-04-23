import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/KpiCard";
import { Activity, AlertTriangle } from "lucide-react";

interface KpiStatsProps {
  title: string;
  value: number | string;
  unit?: string;
  description?: string;
  /** Backend high_variability flag from the summary aggregate */
  highVariability?: boolean;
  /** Coefficient of variation from the summary aggregate (0–∞) */
  cv?: number;
}

export const KpiStats = React.memo(function KpiStats({
  title, value, unit, description, highVariability, cv
}: KpiStatsProps) {
  return (
    <Card>
      <CardHeader style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <CardTitle>{title}</CardTitle>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {highVariability && (
            <span
              title={`High variability — CV: ${cv !== undefined ? (cv * 100).toFixed(1) + "%" : "n/a"}. Values fluctuate significantly across windows.`}
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.25rem",
                fontSize: "0.7rem", fontWeight: 700, padding: "0.1rem 0.45rem",
                borderRadius: "9999px", cursor: "help",
                color: "#92400e",
                background: "rgba(252,211,77,0.2)",
                border: "1px solid rgba(252,211,77,0.5)",
              }}
            >
              <AlertTriangle size={10} />
              {cv !== undefined ? `CV ${(cv * 100).toFixed(0)}%` : "Variable"}
            </span>
          )}
          <Activity size={18} style={{ opacity: 0.5 }} />
        </div>
      </CardHeader>
      <CardContent>
        <div style={{ fontSize: "2rem", fontWeight: "bold", margin: "0.5rem 0" }}>
          {value} <span style={{ fontSize: "1rem", fontWeight: "normal", opacity: 0.8 }}>{unit}</span>
        </div>

        {description && (
          <p style={{ fontSize: "0.85rem", opacity: 0.6, margin: 0 }}>{description}</p>
        )}
      </CardContent>
    </Card>
  );
});