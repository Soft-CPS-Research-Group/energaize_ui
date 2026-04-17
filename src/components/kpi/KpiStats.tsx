import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/KpiCard";
import { Activity } from "lucide-react";

interface KpiStatsProps {
  title: string;
  value: number | string;
  unit?: string;
  description?: string;
}

export const KpiStats = React.memo(function KpiStats({
  title, value, unit, description
}: KpiStatsProps) {  
  return (
    <Card>
      <CardHeader style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <CardTitle>{title}</CardTitle>
        <Activity size={18} style={{ opacity: 0.5 }} />
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