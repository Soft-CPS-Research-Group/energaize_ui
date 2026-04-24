import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/KpiCard";
import { Activity, AlertTriangle, Info } from "lucide-react";
import { useKpiMetadata } from "../../hooks/useKpiMetadata";

interface KpiStatsProps {
  title: string;
  value: number | string;
  unit?: string;
  description?: string;
  subtitle?: string;
  kpiName?: string;
  /** Backend high_variability flag from the summary aggregate (currently unused in UI) */
  highVariability?: boolean;
  /** Coefficient of variation from the summary aggregate (0–∞) (currently unused in UI) */
  cv?: number;
}

export const KpiStats = React.memo(function KpiStats({
  title, value, unit, description, subtitle, kpiName
}: KpiStatsProps) {
  const { kpis } = useKpiMetadata();
  const [showInfo, setShowInfo] = useState(false);
  const meta = kpiName ? kpis.find(k => k.name === kpiName) : null;

  return (
    <Card style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <CardHeader style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", position: "relative" }}>
            <CardTitle style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>{title}</CardTitle>
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
                      <code style={{ fontSize: "0.75rem" }}>{meta.formula || ""}</code>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", fontSize: "0.75rem", opacity: 0.8 }}>
                      <span><span style={{ fontWeight: "bold" }}>Unit:</span> {meta.unit || ""}</span>
                      <span><span style={{ fontWeight: "bold" }}>Window:</span> {meta.window}</span>
                      <span><span style={{ fontWeight: "bold" }}>Level:</span> {meta.level}</span>
                      <span><span style={{ fontWeight: "bold" }}>Type:</span> {meta.type}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {subtitle && (
            <div style={{ fontSize: "0.85rem", color: "var(--text-soft)", marginTop: "0.25rem", fontWeight: 500, wordBreak: "break-word", overflowWrap: "anywhere" }}>
              {subtitle}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <div style={{ fontSize: "2rem", fontWeight: "bold", margin: "0.5rem 0" }}>
          {value} <span style={{ fontSize: "1rem", fontWeight: "normal", opacity: 0.8 }}>{unit}</span>
        </div>

        {description && (
          <p style={{ fontSize: "0.85rem", opacity: 0.6, margin: 0, wordBreak: "break-word", overflowWrap: "anywhere" }}>{description}</p>
        )}
      </CardContent>
    </Card>
  );
});
