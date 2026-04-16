import { usePredictorStats, usePredictorHistory, usePredictorPredictions, usePredictorCommand } from "../../../hooks/usePredictor";
import { EVChargingLoader } from "../../../components/ui/EVChargingLoader";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import { buildPredictorTimeline } from "../../../utils/predictorTransforms";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from "recharts";
import { useState } from "react";

interface PredictViewProps {
  selectedHouseId: string | null;
  timezone: string;
}

export function PredictView({ selectedHouseId, timezone }: PredictViewProps) {
  const { notifySuccess, notifyError } = useApiFeedback();
  const [showForecastDialog, setShowForecastDialog] = useState(false);
  const [showFlexDialog, setShowFlexDialog] = useState(false);

  const { data: stats, isLoading: statsLoading } = usePredictorStats();
  const { data: history, isLoading: historyLoading } = usePredictorHistory(selectedHouseId);
  const { data: predictions, isLoading: predictionsLoading } = usePredictorPredictions(selectedHouseId);
  
  const commandMutation = usePredictorCommand();

  const isLoading = statsLoading || historyLoading || predictionsLoading;

  const chartData = buildPredictorTimeline(history, predictions);
  
  // Find where predictions start to draw a reference line
  // Assumes any entry with predictions but null actuals is the future
  const futureStart = chartData.find(
    (pt) => (pt.actualConsumption === null) && (pt.predictedConsumption !== null)
  );

  const handleForecastCommand = (lane: "consumption" | "production" | "both") => {
    if (!selectedHouseId) return;
    commandMutation.mutate(
      { command: "predict", house_id: selectedHouseId, lane },
      {
        onSuccess: (res) => {
          notifySuccess("Forecast Queued", res.message);
          setShowForecastDialog(false);
        },
        onError: (err) => notifyError("Forecast Error", err),
      }
    );
  };

  const handleFlexCommand = () => {
    if (!selectedHouseId) return;
    commandMutation.mutate(
      { command: "flex", house_id: selectedHouseId },
      {
        onSuccess: (res) => {
          notifySuccess("Flexibility Job", res.message);
          setShowFlexDialog(false);
        },
        onError: (err) => notifyError("Flexibility Error", err),
      }
    );
  };

  if (isLoading && chartData.length === 0) {
    return <EVChargingLoader label="Loading predictor data..." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "14px" }}>
        <KPICard title="Total Houses" value={stats?.total_houses ?? "-"} />
        <KPICard title="Houses w/ Predictions" value={stats?.predictions_available ?? "-"} />
        <KPICard title="Next Consumption (min)" value={stats?.next_consumption_cycle_minutes ?? "-"} />
        <KPICard title="Next Production (min)" value={stats?.next_production_cycle_minutes ?? "-"} />
      </div>

      {/* Chart Section */}
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Energy Forecast - {selectedHouseId || "No House Selected"}</h3>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button size="sm" onClick={() => setShowForecastDialog(true)} disabled={!selectedHouseId || commandMutation.isPending}>
              Run Forecast
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowFlexDialog(true)} disabled={!selectedHouseId || commandMutation.isPending}>
              Run Flex Job
            </Button>
          </div>
        </div>

        <div style={{ width: "100%", height: "400px", minHeight: "400px", minWidth: "10px", position: "relative", marginLeft: "-16px" }}>
          <ResponsiveContainer width="99%" height={400}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
              <XAxis dataKey="time" tickFormatter={(t) => new Date(t).toLocaleTimeString([], {timeZone: timezone, hour: "2-digit", minute:"2-digit"})} />
              <YAxis yAxisId="left" tickFormatter={(v) => `${v} kWh`} width={80} />
              <Tooltip labelFormatter={(l) => new Date(l).toLocaleString([], {timeZone: timezone})} />
              <Legend verticalAlign="top" height={36} />

              {/* Reference line for Future */}
              {futureStart && (
                <ReferenceLine x={futureStart.time} stroke="var(--border)" strokeDasharray="3 3" label="Now" yAxisId="left" />
              )}

              {/* Actual Data (Line) matching TUI colors */}
              <Line yAxisId="left" type="monotone" dataKey="actualConsumption" fill="#ea5a5a" stroke="#ea5a5a" strokeWidth={2} name="Actual Consumption" dot={false} isAnimationActive={false} />
              <Line yAxisId="left" type="monotone" dataKey="actualProduction" fill="#1db97f" stroke="#1db97f" strokeWidth={2} name="Actual Production" dot={false} isAnimationActive={false} />

              {/* Predicted Data (Line) matching TUI colors */}
              <Line yAxisId="left" type="monotone" dataKey="predictedConsumption" stroke="#56d364" strokeWidth={2} dot={false} strokeDasharray="4 4" name="Predicted Consumption" isAnimationActive={false} />
              <Line yAxisId="left" type="monotone" dataKey="predictedProduction" stroke="#388bfd" strokeWidth={2} dot={false} strokeDasharray="4 4" name="Predicted Production" isAnimationActive={false} />

            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Forecast Dialog */}
      <ConfirmDialog
        open={showForecastDialog}
        title="Run Energy Forecast"
        message={`Do you want to run the prediction pipeline for ${selectedHouseId} right now?`}
        confirmLabel="Run Both Lanes"
        confirmVariant="primary"
        pending={commandMutation.isPending}
        onConfirm={() => handleForecastCommand("both")}
        onCancel={() => setShowForecastDialog(false)}
      />

       <ConfirmDialog
        open={showFlexDialog}
        title="Run Flexibility Pipeline"
        message={`This will compute EV flexibility charging models for ${selectedHouseId}.`}
        confirmLabel="Run Flex"
        confirmVariant="primary"
        pending={commandMutation.isPending}
        onConfirm={handleFlexCommand}
        onCancel={() => setShowFlexDialog(false)}
      />
    </div>
  );
}

function KPICard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="panel" style={{ padding: "16px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "112px", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: "0.875rem", opacity: 0.7, marginBottom: "4px" }}>{title}</div>
      <div style={{ fontSize: "1.875rem", fontWeight: "bold", color: "var(--brand)" }}>{value}</div>
    </div>
  );
}