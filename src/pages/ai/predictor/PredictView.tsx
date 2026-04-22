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
import { useCountUp } from "../../../hooks/useCountUp";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Zap, TrendingUp, Layers, Eye, EyeOff } from "lucide-react";

interface PredictViewProps {
  selectedHouseId: string | null;
  timezone: string;
}

type Lane = "consumption" | "production" | "both";
type ScaleMode = "auto" | "actual" | "prediction";

const LANE_COLORS: Record<"consumption" | "production", { actual: string; predicted: string; spectrum: string }> = {
  consumption: { actual: "#ea5a5a", predicted: "#3b82f6", spectrum: "#3b82f6" },
  production:  { actual: "#22c55e", predicted: "#a78bfa", spectrum: "#a78bfa" },
};

// Error metric trend chip — lower error = improved (green)
function DeltaChip({ delta, isPercent = false }: { delta: number | null; isPercent?: boolean }) {
  if (delta == null || Math.abs(delta) < (isPercent ? 0.05 : 0.0001)) return null;
  const improved = delta < 0;
  const abs = Math.abs(delta);
  const label = isPercent ? abs.toFixed(1) + "%" : abs.toFixed(3) + " kWh";
  return (
    <span className={`predictor-delta ${improved ? "improved" : "worsened"}`}>
      {improved ? "\u2193" : "\u2191"} {label}
    </span>
  );
}

export function PredictView({ selectedHouseId, timezone }: PredictViewProps) {
  // Tooltip renderer as a closure to capture `timezone`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TooltipContent = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const BAND_KEYS = new Set(["cBandLo","cBandHi","cBandQ1Lo","cBandQ1Hi","pBandLo","pBandHi","pBandQ1Lo","pBandQ1Hi"]);
    const relevant = payload.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => !BAND_KEYS.has(String(p.dataKey)) && !String(p.dataKey).startsWith("spec_") && p.value != null
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
  const [scaleMode, setScaleMode] = useState<ScaleMode>("auto");
  const [bandsOnly, setBandsOnly] = useState(false);
  const [showForecastDialog, setShowForecastDialog] = useState(false);
  const [showFlexDialog, setShowFlexDialog] = useState(false);

  const { data: stats } = usePredictorStats();
  const { data: history, isLoading: historyLoading, isFetching: historyFetching } = usePredictorHistory(selectedHouseId);
  const { data: predictions, isLoading: predictionsLoading, isFetching: predFetching } = usePredictorPredictions(selectedHouseId);
  const { consumption: histC, production: histP } = usePredictorPredictionHistory(selectedHouseId);

  const commandMutation = usePredictorCommand();
  const isLoading = historyLoading || predictionsLoading;
  const isRefetching = !isLoading && (historyFetching || predFetching || histC.isFetching || histP.isFetching);

  const predHistory = {
    consumption: histC.data?.history ?? [],
    production: histP.data?.history ?? [],
  };

  const { data: chartData, errors } = buildPredictorTimeline(history, predictions, predHistory);

  // Animated count-up values — must be called before any conditional returns
  const { ref: cMaeRef,  dir: cMaeDir  } = useCountUp(errors.consumption.mae,  v => `${v.toFixed(3)} kWh`);
  const { ref: cRmseRef, dir: cRmseDir } = useCountUp(errors.consumption.rmse, v => `${v.toFixed(3)} kWh`);
  const { ref: cMapeRef, dir: cMapeDir } = useCountUp(errors.consumption.mape, v => `${v.toFixed(1)} %`);
  const { ref: pMaeRef,  dir: pMaeDir  } = useCountUp(errors.production.mae,   v => `${v.toFixed(3)} kWh`);
  const { ref: pRmseRef, dir: pRmseDir } = useCountUp(errors.production.rmse,  v => `${v.toFixed(3)} kWh`);
  const { ref: pMapeRef, dir: pMapeDir } = useCountUp(errors.production.mape,  v => `${v.toFixed(1)} %`);
  const { ref: statHousesRef    } = useCountUp(stats?.total_houses          ?? null, v => String(Math.round(v)), 900);
  const { ref: statPredAvailRef } = useCountUp(stats?.predictions_available ?? null, v => String(Math.round(v)), 900);
  const { ref: statCyclesRef    } = useCountUp(stats?.total_cycles          ?? null, v => String(Math.round(v)), 900);

  const isConsumption = activeLane === "consumption" || activeLane === "both";
  const isProduction  = activeLane === "production"  || activeLane === "both";

  let _yMaxActual = 0.001;
  let _yMaxPrediction = 0.001;
  let _yMaxBands = 0.001;
  for (const pt of chartData) {
    const actualCandidates: (number | null)[] = [
      isConsumption ? pt.actualConsumption : null,
      isProduction ? pt.actualProduction : null,
    ];
    const predCandidates: (number | null)[] = [
      isConsumption ? pt.predictedConsumption : null,
      isProduction ? pt.predictedProduction : null,
    ];
    const bandCandidates: (number | null)[] = [
      isConsumption && pt.cBandLo != null && pt.cBandHi != null ? (pt.cBandLo as number) + (pt.cBandHi as number) : null,
      isProduction  && pt.pBandLo != null && pt.pBandHi != null ? (pt.pBandLo as number) + (pt.pBandHi as number) : null,
    ];
    for (const v of actualCandidates) { if (v != null && v > _yMaxActual) _yMaxActual = v; }
    for (const v of predCandidates)  { if (v != null && v > _yMaxPrediction) _yMaxPrediction = v; }
    for (const v of bandCandidates)  { if (v != null && v > _yMaxBands) _yMaxBands = v; }
  }
  const yMax = (
    bandsOnly
      ? _yMaxBands
      : scaleMode === "actual"
        ? _yMaxActual
        : scaleMode === "prediction"
          ? _yMaxPrediction
          : Math.max(_yMaxActual, _yMaxPrediction)
  ) * 1.08;



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
      {/* KPI strip — row 1: global stats */}
      <div className="kpi-grid predictor-kpi-grid">
        <div className="kpi">
          <span>Total Houses</span>
          <strong><span ref={statHousesRef}>—</span></strong>
        </div>
        <div className="kpi">
          <span>Houses w/ Predictions</span>
          <strong><span ref={statPredAvailRef}>—</span></strong>
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
          <strong><span ref={statCyclesRef}>—</span></strong>
        </div>
      </div>

      {/* KPI strip — row 2: forecast accuracy (last 24 h, inverse-recency-weighted) */}
      <div className="kpi-grid predictor-kpi-grid predictor-kpi-grid--accuracy">
        <div className={`kpi${cMaeDir !== "idle" ? ` kpi--animating-${cMaeDir}` : ""}`}>
          <span>Cons. MAE · 24 h ↓</span>
          <strong style={{ color: "#60a5fa" }}>
            <span ref={cMaeRef}>—</span>
            <DeltaChip delta={errors.consumption.maeDelta} />
          </strong>
        </div>
        <div className={`kpi${cRmseDir !== "idle" ? ` kpi--animating-${cRmseDir}` : ""}`}>
          <span>Cons. RMSE · 24 h ↓</span>
          <strong style={{ color: "#60a5fa" }}>
            <span ref={cRmseRef}>—</span>
            <DeltaChip delta={errors.consumption.rmseDelta} />
          </strong>
        </div>
        <div className={`kpi${cMapeDir !== "idle" ? ` kpi--animating-${cMapeDir}` : ""}`}>
          <span>Cons. MAPE · 24 h ↓</span>
          <strong style={{ color: "#60a5fa" }}>
            <span ref={cMapeRef}>—</span>
            <DeltaChip delta={errors.consumption.mapeDelta} isPercent />
          </strong>
        </div>
        <div className={`kpi${pMaeDir !== "idle" ? ` kpi--animating-${pMaeDir}` : ""}`}>
          <span>Prod. MAE · 24 h ↓</span>
          <strong style={{ color: "#a78bfa" }}>
            <span ref={pMaeRef}>—</span>
            <DeltaChip delta={errors.production.maeDelta} />
          </strong>
        </div>
        <div className={`kpi${pRmseDir !== "idle" ? ` kpi--animating-${pRmseDir}` : ""}`}>
          <span>Prod. RMSE · 24 h ↓</span>
          <strong style={{ color: "#a78bfa" }}>
            <span ref={pRmseRef}>—</span>
            <DeltaChip delta={errors.production.rmseDelta} />
          </strong>
        </div>
        <div className={`kpi${pMapeDir !== "idle" ? ` kpi--animating-${pMapeDir}` : ""}`}>
          <span>Prod. MAPE · 24 h ↓</span>
          <strong style={{ color: "#a78bfa" }}>
            <span ref={pMapeRef}>—</span>
            <DeltaChip delta={errors.production.mapeDelta} isPercent />
          </strong>
        </div>
      </div>

      {/* Forecast chart */}
      <div className={`panel predictor-chart-panel${isRefetching ? " is-refetching" : ""}`}>
        <div className="predictor-chart-header">
          <div className="predictor-chart-title">
            <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="predictor-live-dot" title="Auto-refreshing" />
              Energy Forecast — {selectedHouseId}
            </h3>
            {(predHistory.consumption.length > 0 || predHistory.production.length > 0) && (
              <span className="predictor-spectrum-hint">
                forecast uncertainty bands
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

            <div className="predictor-lane-toggle">
              <button
                className={`predictor-lane-btn${scaleMode === "auto" ? " is-active" : ""}`}
                onClick={() => setScaleMode("auto")}
                title="Scale to the largest of actual or predicted data"
              >
                Auto
              </button>
              <button
                className={`predictor-lane-btn${scaleMode === "actual" ? " is-active" : ""}`}
                onClick={() => setScaleMode("actual")}
                title="Scale to actual (measured) data"
              >
                Actual
              </button>
              <button
                className={`predictor-lane-btn${scaleMode === "prediction" ? " is-active" : ""}`}
                onClick={() => setScaleMode("prediction")}
                title="Scale to forecast data"
              >
                Forecast
              </button>
            </div>

            {(predHistory.consumption.length > 0 || predHistory.production.length > 0) && (
              <button
                className={`predictor-lane-btn${bandsOnly ? " is-active" : ""}`}
                onClick={() => setBandsOnly((v) => !v)}
                title={bandsOnly ? "Show all data" : "Show forecast bands only"}
                style={{ display: "flex", alignItems: "center", gap: 4 }}
              >
                {bandsOnly ? <Eye size={12} /> : <EyeOff size={12} />}
                Bands only
              </button>
            )}

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
              height={20}
            />
            <YAxis
              yAxisId="left"
              tickFormatter={(v: number) => `${parseFloat(v.toPrecision(4))} kWh`}
              width={70}
              tick={{ fontSize: 11, fill: "var(--text-soft)" }}
              tickLine={false}
              axisLine={false}
              domain={[0, yMax]}
              allowDataOverflow={true}
            />
            <Tooltip content={TooltipContent} />
            <Legend
              verticalAlign="top"
              height={32}
              wrapperStyle={{ fontSize: "0.78rem" }}
            />

            {futureStart && !bandsOnly && (
              <ReferenceLine
                x={futureStart.time}
                yAxisId="left"
                stroke="var(--line-strong)"
                strokeDasharray="4 4"
                label={{ value: "Now", fill: "var(--text-soft)", fontSize: 10, position: "insideTopRight" }}
              />
            )}

            {/* Forecast confidence bands — outer (min–max) then inner (IQR), rendered below the lines */}
            {isConsumption && (
              <>
                <Area yAxisId="left" type="monotone" dataKey="cBandLo"
                  stroke="none" fill="none" fillOpacity={0}
                  stackId="cOuter" legendType="none" dot={false}
                  isAnimationActive={false} connectNulls={false} />
                <Area yAxisId="left" type="monotone" dataKey="cBandHi"
                  stroke="none" fill={LANE_COLORS.consumption.predicted} fillOpacity={0.12}
                  stackId="cOuter" legendType="none" dot={false}
                  isAnimationActive={false} connectNulls={false} />
                <Area yAxisId="left" type="monotone" dataKey="cBandQ1Lo"
                  stroke="none" fill="none" fillOpacity={0}
                  stackId="cInner" legendType="none" dot={false}
                  isAnimationActive={false} connectNulls={false} />
                <Area yAxisId="left" type="monotone" dataKey="cBandQ1Hi"
                  stroke="none" fill={LANE_COLORS.consumption.predicted} fillOpacity={0.25}
                  stackId="cInner" legendType="none" dot={false}
                  isAnimationActive={false} connectNulls={false} />
              </>
            )}
            {isProduction && (
              <>
                <Area yAxisId="left" type="monotone" dataKey="pBandLo"
                  stroke="none" fill="none" fillOpacity={0}
                  stackId="pOuter" legendType="none" dot={false}
                  isAnimationActive={false} connectNulls={false} />
                <Area yAxisId="left" type="monotone" dataKey="pBandHi"
                  stroke="none" fill={LANE_COLORS.production.predicted} fillOpacity={0.12}
                  stackId="pOuter" legendType="none" dot={false}
                  isAnimationActive={false} connectNulls={false} />
                <Area yAxisId="left" type="monotone" dataKey="pBandQ1Lo"
                  stroke="none" fill="none" fillOpacity={0}
                  stackId="pInner" legendType="none" dot={false}
                  isAnimationActive={false} connectNulls={false} />
                <Area yAxisId="left" type="monotone" dataKey="pBandQ1Hi"
                  stroke="none" fill={LANE_COLORS.production.predicted} fillOpacity={0.25}
                  stackId="pInner" legendType="none" dot={false}
                  isAnimationActive={false} connectNulls={false} />
              </>
            )}

            {/* Actual & predicted lines — hidden in bands-only mode */}
            {isConsumption && !bandsOnly && (
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
            {isConsumption && !bandsOnly && (
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
            {isProduction && !bandsOnly && (
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
            {isProduction && !bandsOnly && (
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