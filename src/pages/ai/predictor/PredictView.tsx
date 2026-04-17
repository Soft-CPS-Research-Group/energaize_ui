import { useState } from "react";
import {
  usePredictorStats,
  usePredictorHistory,
  usePredictorPredictions,
  usePredictorCommand,
  usePredictorPredictionHistory,
} from "../../../hooks/usePredictor";
import { EVChargingLoader } from "../../../components/ui/EVChargingLoader";
import { EmptyState } from "../../../components/ui/EmptyState";
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
  ReferenceLine,
} from "recharts";
import { Zap, TrendingUp, Layers } from "lucide-react";

interface PredictViewProps {
  selectedHouseId: string | null;
  timezone: string;
}

type Lane = "consumption" | "production" | "both";

const LANE_COLORS: Record<"consumption" | "production", { actual: string; predicted: string; spectrum: string }> = {
  consumption: { actual: "#ea5a5a", predicted: "#3b82f6", spectrum: "#3b82f6" },
  production:  { actual: "#22c55e", predicted: "#a78bfa", spectrum: "#a78bfa" },
};

export function PredictView({ selectedHouseId, timezone }: PredictViewProps) {
  // Tooltip renderer as a closure to capture `timezone`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TooltipContent = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const relevant = payload.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => !String(p.dataKey).startsWith("spec_") && p.value != null
    );
    if (relevant.length === 0) return null;
    const dateStr = new Date(label as string).toLocaleString([], {
      timeZone: timezone,
      dateStyle: "short",
      timeStyle: "short",
    });
    return (
      <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", fontSize: "0.8rem" }}>
        <p style={{ margin: "0 0 6px", color: "var(--text-soft)", fontWeight: 500 }}>{dateStr}</p>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {relevant.map((p: any) => (
          <p key={String(p.dataKey)} style={{ margin: "2px 0", color: p.color }}>
            {p.name}: <strong>{Number(p.value).toFixed(3)} kWh</strong>
          </p>
        ))}
      </div>
    );
  };
  const { notifySuccess, notifyError } = useApiFeedback();
  const [activeLane, setActiveLane] = useState<Lane>("consumption");
  const [showForecastDialog, setShowForecastDialog] = useState(false);
  const [showFlexDialog, setShowFlexDialog] = useState(false);

  const { data: stats } = usePredictorStats();
  const { data: history, isLoading: historyLoading } = usePredictorHistory(selectedHouseId);
  const { data: predictions, isLoading: predictionsLoading } = usePredictorPredictions(selectedHouseId);
  const { consumption: histC, production: histP } = usePredictorPredictionHistory(selectedHouseId);

  const commandMutation = usePredictorCommand();
  const isLoading = historyLoading || predictionsLoading;

  const predHistory = {
    consumption: histC.data?.history ?? [],
    production: histP.data?.history ?? [],
  };

  const { data: chartData, spectrumMeta } = buildPredictorTimeline(history, predictions, predHistory);

  const isConsumption = activeLane === "consumption" || activeLane === "both";
  const isProduction  = activeLane === "production"  || activeLane === "both";
  const activeSpectrum = activeLane === "both"
    ? spectrumMeta
    : spectrumMeta.filter((m) => m.lane === activeLane);

  const futureStart = chartData.find((pt) => {
    if (isConsumption && pt.actualConsumption === null && pt.predictedConsumption !== null) return true;
    if (isProduction  && pt.actualProduction  === null && pt.predictedProduction  !== null) return true;
    return false;
  });

  const handleForecast = () => {
    if (!selectedHouseId) return;
    commandMutation.mutate(
      { command: "predict", house_id: selectedHouseId, lane: "both" },
      {
        onSuccess: (res) => { notifySuccess("Forecast Queued", res.message); setShowForecastDialog(false); },
        onError: (err) => notifyError("Forecast Error", err),
      }
    );
  };

  const handleFlex = () => {
    if (!selectedHouseId) return;
    commandMutation.mutate(
      { command: "flex", house_id: selectedHouseId },
      {
        onSuccess: (res) => { notifySuccess("Flexibility Job", res.message); setShowFlexDialog(false); },
        onError: (err) => notifyError("Flexibility Error", err),
      }
    );
  };

  if (!selectedHouseId) {
    return (
      <EmptyState
        title="No House Selected"
        message="Select a house from the dropdown above to view its forecast data."
      />
    );
  }

  if (isLoading && chartData.length === 0) {
    return <EVChargingLoader label="Loading predictor data…" />;
  }

  const formatXAxis = (t: string) =>
    new Date(t).toLocaleTimeString([], { timeZone: timezone, hour: "2-digit", minute: "2-digit" });

  return (
    <div className="predictor-predict-view">
      {/* KPI strip */}
      <div className="kpi-grid predictor-kpi-grid">
        <div className="kpi">
          <span>Total Houses</span>
          <strong>{stats?.total_houses ?? "—"}</strong>
        </div>
        <div className="kpi">
          <span>Houses w/ Predictions</span>
          <strong>{stats?.predictions_available ?? "—"}</strong>
        </div>
        <div className="kpi">
          <span>Next Compute Cycle</span>
          <strong>
            {stats?.next_cycle_at
              ? new Date(stats.next_cycle_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "—"}
          </strong>
        </div>
        <div className="kpi">
          <span>Cycles Completed</span>
          <strong>{stats?.total_cycles ?? "—"}</strong>
        </div>
      </div>

      {/* Forecast chart */}
      <div className="panel predictor-chart-panel">
        <div className="predictor-chart-header">
          <div className="predictor-chart-title">
            <h3>Energy Forecast — {selectedHouseId}</h3>
            {activeSpectrum.length > 0 && (
              <span className="predictor-spectrum-hint">
                {activeSpectrum.length} prediction history layers
              </span>
            )}
          </div>

          <div className="predictor-chart-controls">
            <div className="predictor-lane-toggle">
              <button
                className={`predictor-lane-btn${activeLane === "consumption" ? " is-active" : ""}`}
                onClick={() => setActiveLane("consumption")}
              >
                <Zap size={12} /> Consumption
              </button>
              <button
                className={`predictor-lane-btn${activeLane === "production" ? " is-active" : ""}`}
                onClick={() => setActiveLane("production")}
              >
                <TrendingUp size={12} /> Production
              </button>
              <button
                className={`predictor-lane-btn${activeLane === "both" ? " is-active" : ""}`}
                onClick={() => setActiveLane("both")}
              >
                <Layers size={12} /> Both
              </button>
            </div>

            <Button size="sm" variant="primary" onClick={() => setShowForecastDialog(true)} disabled={commandMutation.isPending}>
              Run Forecast
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowFlexDialog(true)} disabled={commandMutation.isPending}>
              Run Flex Job
            </Button>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={chartData} margin={{ top: 6, right: 20, left: 8, bottom: 6 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
            <XAxis
              dataKey="time"
              tickFormatter={formatXAxis}
              tick={{ fontSize: 11, fill: "var(--text-soft)" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="left"
              tickFormatter={(v) => `${v} kWh`}
              width={70}
              tick={{ fontSize: 11, fill: "var(--text-soft)" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={TooltipContent} />
            <Legend
              verticalAlign="top"
              height={32}
              wrapperStyle={{ fontSize: "0.78rem" }}
              formatter={(value) => value.startsWith("spec_") ? null : value}
            />

            {futureStart && (
              <ReferenceLine
                x={futureStart.time}
                yAxisId="left"
                stroke="var(--line-strong)"
                strokeDasharray="4 4"
                label={{ value: "Now", fill: "var(--text-soft)", fontSize: 10, position: "insideTopRight" }}
              />
            )}

            {/* Spectrum: faint history layers rendered first (underneath) */}
            {activeSpectrum.map((meta) => (
              <Line
                key={meta.key}
                yAxisId="left"
                type="monotone"
                dataKey={meta.key}
                stroke={LANE_COLORS[meta.lane].spectrum}
                strokeWidth={1}
                strokeOpacity={meta.opacity}
                dot={false}
                isAnimationActive={false}
                legendType="none"
                name={meta.key}
                connectNulls={false}
              />
            ))}

            {/* Actual & predicted lines */}
            {isConsumption && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="actualConsumption"
                stroke={LANE_COLORS.consumption.actual}
                strokeWidth={2}
                name="Actual Consumption"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            {isConsumption && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="predictedConsumption"
                stroke={LANE_COLORS.consumption.predicted}
                strokeWidth={2}
                strokeDasharray="5 5"
                name="Predicted Consumption"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            {isProduction && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="actualProduction"
                stroke={LANE_COLORS.production.actual}
                strokeWidth={2}
                name="Actual Production"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            {isProduction && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="predictedProduction"
                stroke={LANE_COLORS.production.predicted}
                strokeWidth={2}
                strokeDasharray="5 5"
                name="Predicted Production"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ConfirmDialog
        open={showForecastDialog}
        title="Run Energy Forecast"
        message={`Run the prediction pipeline for ${selectedHouseId} now? Both consumption and production lanes will be queued.`}
        confirmLabel="Run Both Lanes"
        confirmVariant="primary"
        pending={commandMutation.isPending}
        onConfirm={handleForecast}
        onCancel={() => setShowForecastDialog(false)}
      />

      <ConfirmDialog
        open={showFlexDialog}
        title="Run Flexibility Pipeline"
        message={`This will compute EV flexibility charging models for ${selectedHouseId}.`}
        confirmLabel="Run Flex"
        confirmVariant="primary"
        pending={commandMutation.isPending}
        onConfirm={handleFlex}
        onCancel={() => setShowFlexDialog(false)}
      />
    </div>
  );
}