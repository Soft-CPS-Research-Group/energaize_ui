import { useState } from "react";
import {
  usePredictorStats,
  usePredictorHistory,
  usePredictorPredictions,
  usePredictorCommand,
  usePredictorPredictionHistory,
  usePredictorActiveModel,
  usePredictorDataQuality,
} from "../../../hooks/usePredictor";
import { EVChargingLoader } from "../../../components/ui/EVChargingLoader";
import { EmptyState } from "../../../components/ui/EmptyState";
import { InfoTip } from "../../../components/ui/InfoTip";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useApiFeedback } from "../../../hooks/useApiFeedback";
import { buildPredictorTimeline } from "../../../utils/predictorTransforms";
import type { ModelBackend } from "../../../api/predictorApi";
import { useCountUp } from "../../../hooks/useCountUp";
import { currentSlotKey, formatAge, forecastNotices, hasForecast, minutesSince, nowLineSlot } from "./forecastStatus";
import { inputNotices } from "./inputQuality";
import { InputDataPanel } from "./InputDataPanel";
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
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import { Zap, TrendingUp, Layers, Info, TriangleAlert } from "lucide-react";

interface PredictViewProps {
  selectedHouseId: string | null;
  timezone: string;
}

type Lane = "consumption" | "production" | "both";
type ScaleMode = "auto" | "actual" | "prediction";

// Colours come from tokens in predictor-ceramic.css. Lanes differ by hue and
// actual vs forecast by hue and dash, so no pair relies on colour alone.
const LANE_COLORS: Record<"consumption" | "production", { actual: string; predicted: string }> = {
  consumption: { actual: "var(--pred-consumption-actual)", predicted: "var(--pred-consumption-forecast)" },
  production:  { actual: "var(--pred-production-actual)", predicted: "var(--pred-production-forecast)" },
};

const MODEL_LABELS: Record<ModelBackend, string> = { xgboost: "XGBoost", lgbm: "LightGBM", lstm: "LSTM" };

// Error metric trend chip — lower error = improved (green)
function DeltaChip({ delta, isPercent = false }: { delta: number | null; isPercent?: boolean }) {
  if (delta == null || Math.abs(delta) < (isPercent ? 0.05 : 0.0001)) return null;
  const improved = delta < 0;
  const abs = Math.abs(delta);
  const label = isPercent ? abs.toFixed(1) + "%" : abs.toFixed(3) + " kWh";
  return (
    <span
      className={`predictor-delta ${improved ? "improved" : "worsened"}`}
      title={`${improved ? "Lower" : "Higher"} than the previous 24 h`}
    >
      {improved ? "\u2193" : "\u2191"} {label}
    </span>
  );
}

export function PredictView({ selectedHouseId, timezone }: PredictViewProps) {
  // Tooltip renderer as a closure to capture `timezone`
  const TooltipContent = ({ active, payload, label }: TooltipContentProps<TooltipValueType, string | number>) => {
    if (!active || !payload || payload.length === 0) return null;
    const BAND_KEYS = new Set(["cBandLo","cBandHi","cBandQ1Lo","cBandQ1Hi","pBandLo","pBandHi","pBandQ1Lo","pBandQ1Hi"]);
    const relevant = payload.filter(
      (p) => !BAND_KEYS.has(String(p.dataKey)) && !String(p.dataKey).startsWith("spec_") && p.value != null
    );
    if (relevant.length === 0) return null;
    const dateStr = new Date(label as string).toLocaleString("en-GB", {
      timeZone: timezone,
      dateStyle: "short",
      timeStyle: "short",
    });
    return (
      <div className="predictor-chart-tooltip">
        <p>{dateStr}</p>
        {relevant.map((p) => (
          <p key={String(p.dataKey)}>
            <i style={{ background: p.color }} aria-hidden="true" />
            {p.name}: <strong>{Number(p.value).toFixed(3)} kWh</strong>
          </p>
        ))}
      </div>
    );
  };
  const { notifySuccess, notifyError } = useApiFeedback();
  const [activeLane, setActiveLane] = useState<Lane>("both");
  // Each house opens on both lanes.
  const [laneHouseId, setLaneHouseId] = useState(selectedHouseId);
  if (laneHouseId !== selectedHouseId) {
    setLaneHouseId(selectedHouseId);
    setActiveLane("both");
  }
  const [scaleMode, setScaleMode] = useState<ScaleMode>("auto");
  const [bandsOnly, setBandsOnly] = useState(false);
  const [showBands, setShowBands] = useState(true);
  const [showForecastDialog, setShowForecastDialog] = useState(false);
  const [showFlexDialog, setShowFlexDialog] = useState(false);

  const { data: stats } = usePredictorStats();
  const { data: activeModel } = usePredictorActiveModel(selectedHouseId);
  const { data: dataQuality } = usePredictorDataQuality(selectedHouseId);
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

  // Animated accuracy values — must be called before any conditional returns
  const { ref: cMaeRef,  dir: cMaeDir  } = useCountUp(errors.consumption.mae,  v => `${v.toFixed(3)} kWh`);
  const { ref: cRmseRef, dir: cRmseDir } = useCountUp(errors.consumption.rmse, v => `${v.toFixed(3)} kWh`);
  const { ref: cMapeRef, dir: cMapeDir } = useCountUp(errors.consumption.mape, v => `${v.toFixed(1)} %`);
  const { ref: pMaeRef,  dir: pMaeDir  } = useCountUp(errors.production.mae,   v => `${v.toFixed(3)} kWh`);
  const { ref: pRmseRef, dir: pRmseDir } = useCountUp(errors.production.rmse,  v => `${v.toFixed(3)} kWh`);
  const { ref: pMapeRef, dir: pMapeDir } = useCountUp(errors.production.mape,  v => `${v.toFixed(1)} %`);
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
      isConsumption ? pt.lastPredConsumption : null,
      isProduction ? pt.predictedProduction : null,
      isProduction ? pt.lastPredProduction : null,
    ];
    const bandCandidates: (number | null)[] = [
      isConsumption && pt.cBandLo != null && pt.cBandHi != null ? (pt.cBandLo as number) + (pt.cBandHi as number) : null,
      isProduction  && pt.pBandLo != null && pt.pBandHi != null ? (pt.pBandLo as number) + (pt.pBandHi as number) : null,
    ];
    for (const v of actualCandidates) { if (v != null && v > _yMaxActual) _yMaxActual = v; }
    for (const v of predCandidates)  { if (v != null && v > _yMaxPrediction) _yMaxPrediction = v; }
    for (const v of bandCandidates)  { if (v != null && v > _yMaxBands) _yMaxBands = v; }
  }
  // In predictions-only mode include bands in the scale, but only when they are within
  // 3× the predicted line max — beyond that they're outlier-driven and would crush the chart.
  const _yMaxPredWithBands =
    showBands && _yMaxBands <= _yMaxPrediction * 3
      ? Math.max(_yMaxPrediction, _yMaxBands)
      : _yMaxPrediction;

  const yMax = (
    bandsOnly
      ? _yMaxPredWithBands
      : scaleMode === "actual"
        ? _yMaxActual
        : scaleMode === "prediction"
          ? _yMaxPrediction
          : Math.max(_yMaxActual, _yMaxPrediction)
  ) * 1.08;



  const now = Date.now();
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", { timeZone: timezone, dateStyle: "short", timeStyle: "short" });
  const nowSlot = nowLineSlot(chartData.map((pt) => pt.time), currentSlotKey(now));
  const notices = selectedHouseId
    ? forecastNotices({
        houseId: selectedHouseId,
        predictions,
        history,
        paused: !!stats?.scheduler_paused,
        now,
        formatTime,
      }).concat(inputNotices(selectedHouseId, dataQuality))
    : [];
  const forecastAge = hasForecast(predictions) ? minutesSince(predictions?.target_time, now) : null;
  const modelSummary = activeModel
    ? `Consumption ${MODEL_LABELS[activeModel.consumption] ?? activeModel.consumption} · Production ${MODEL_LABELS[activeModel.production] ?? activeModel.production}`
    : null;
  const hasRunHistory = predHistory.consumption.length > 0 || predHistory.production.length > 0;

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
        title="No house selected"
        message="Choose a house in the header to see its forecast."
      />
    );
  }

  if (isLoading && chartData.length === 0) {
    return <EVChargingLoader label="Loading predictor data…" />;
  }

  const formatXAxis = (t: string) =>
    new Date(t).toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });

  return (
    <div className="predictor-predict-view">
      <section className="predictor-status-strip" aria-label="Forecast status">
        <div className="predictor-status-item">
          <span>Houses with a forecast</span>
          <strong>{stats ? `${stats.predictions_available} of ${stats.total_houses}` : "—"}</strong>
        </div>
        <div className="predictor-status-item">
          <span>Next cycle</span>
          <strong>
            {stats?.scheduler_paused
              ? "Paused"
              : stats?.next_cycle_at
                ? new Date(stats.next_cycle_at).toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" })
                : "—"}
          </strong>
          {stats ? <small>{stats.total_cycles} forecasts published since the service started</small> : null}
        </div>
        <div className="predictor-status-item is-wide">
          <span>Forecast for {selectedHouseId}</span>
          <strong>{forecastAge != null ? `Updated ${formatAge(forecastAge)}` : predictions ? "None yet" : "—"}</strong>
          {modelSummary ? <small>{modelSummary}</small> : null}
        </div>
      </section>

      {notices.length > 0 && (
        <div className="predictor-notices">
          {notices.map((notice) => (
            <div key={notice.title} className={`predictor-notice is-${notice.tone}`} role={notice.tone === "warning" ? "alert" : "status"}>
              {notice.tone === "warning" ? <TriangleAlert size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
              <div>
                <strong>{notice.title}</strong>
                <p>{notice.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Forecast accuracy (last 24 h, inverse-recency-weighted) */}
      <div className="kpi-grid predictor-kpi-grid predictor-kpi-grid--accuracy">
        <div className={`kpi${cMaeDir !== "idle" ? ` kpi--animating-${cMaeDir}` : ""}`}>
          <span className="predictor-kpi-label">Cons. MAE · 24 h ↓<InfoTip tip="Mean Absolute Error for consumption predictions — average magnitude of errors in kWh, inverse-recency-weighted across the last 24 h of forecast runs. Lower is better." /></span>
          <strong className="predictor-kpi-value is-consumption">
            <span ref={cMaeRef}>—</span>
            <DeltaChip delta={errors.consumption.maeDelta} />
          </strong>
        </div>
        <div className={`kpi${cRmseDir !== "idle" ? ` kpi--animating-${cRmseDir}` : ""}`}>
          <span className="predictor-kpi-label">Cons. RMSE · 24 h ↓<InfoTip tip="Root Mean Squared Error for consumption — like MAE but penalises large individual errors more heavily. Lower is better." /></span>
          <strong className="predictor-kpi-value is-consumption">
            <span ref={cRmseRef}>—</span>
            <DeltaChip delta={errors.consumption.rmseDelta} />
          </strong>
        </div>
        <div className={`kpi${cMapeDir !== "idle" ? ` kpi--animating-${cMapeDir}` : ""}`}>
          <span className="predictor-kpi-label">Cons. sMAPE · 24 h ↓<InfoTip tip="Symmetric MAPE for consumption — 2×|actual−pred| / (|actual|+|pred|), bounded 0–200%. Unlike standard MAPE it doesn’t blow up when actual is near zero, making it reliable across night-time low-consumption slots. Lower is better." /></span>
          <strong className="predictor-kpi-value is-consumption">
            <span ref={cMapeRef}>—</span>
            <DeltaChip delta={errors.consumption.mapeDelta} isPercent />
          </strong>
        </div>
        <div className={`kpi${pMaeDir !== "idle" ? ` kpi--animating-${pMaeDir}` : ""}`}>
          <span className="predictor-kpi-label">Prod. MAE · 24 h ↓<InfoTip tip="Mean Absolute Error for production predictions — average magnitude of errors in kWh, inverse-recency-weighted across the last 24 h of forecast runs. Lower is better." /></span>
          <strong className="predictor-kpi-value is-production">
            <span ref={pMaeRef}>—</span>
            <DeltaChip delta={errors.production.maeDelta} />
          </strong>
        </div>
        <div className={`kpi${pRmseDir !== "idle" ? ` kpi--animating-${pRmseDir}` : ""}`}>
          <span className="predictor-kpi-label">Prod. RMSE · 24 h ↓<InfoTip tip="Root Mean Squared Error for production — like MAE but penalises large individual errors more heavily. Lower is better." /></span>
          <strong className="predictor-kpi-value is-production">
            <span ref={pRmseRef}>—</span>
            <DeltaChip delta={errors.production.rmseDelta} />
          </strong>
        </div>
        <div className={`kpi${pMapeDir !== "idle" ? ` kpi--animating-${pMapeDir}` : ""}`}>
          <span className="predictor-kpi-label">Prod. sMAPE · 24 h ↓<InfoTip tip="Symmetric MAPE for production — 2×|actual−pred| / (|actual|+|pred|), bounded 0–200%. Unlike standard MAPE it doesn’t blow up when actual is near zero, making it reliable across night-time zero-production slots. Lower is better." /></span>
          <strong className="predictor-kpi-value is-production">
            <span ref={pMapeRef}>—</span>
            <DeltaChip delta={errors.production.mapeDelta} isPercent />
          </strong>
        </div>
      </div>

      {/* Forecast chart */}
      <section className={`panel predictor-chart-panel${isRefetching ? " is-refetching" : ""}`}>
        <div className="predictor-chart-header">
          <div className="predictor-chart-title">
            <h3>
              <span className="predictor-live-dot" title="Refreshes every minute" />
              Energy forecast
            </h3>
          </div>
          <div className="predictor-chart-actions">
            <Button size="sm" variant="secondary" onClick={() => setShowForecastDialog(true)} disabled={commandMutation.isPending}>
              Forecast now
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowFlexDialog(true)} disabled={commandMutation.isPending}>
              Flexibility job
            </Button>
          </div>
        </div>

        <div className="predictor-chart-controls">
          <div className="predictor-lane-toggle" role="group" aria-label="Lane">
            {([
              ["consumption", <Zap size={12} key="i" />, "Consumption"],
              ["production", <TrendingUp size={12} key="i" />, "Production"],
              ["both", <Layers size={12} key="i" />, "Both"],
            ] as const).map(([lane, icon, label]) => (
              <button
                key={lane}
                type="button"
                className={`predictor-lane-btn${activeLane === lane ? " is-active" : ""}`}
                aria-pressed={activeLane === lane}
                onClick={() => setActiveLane(lane)}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          <div className="predictor-lane-toggle" role="group" aria-label="Scale">
            {([
              ["auto", "Auto", "Scale to the larger of measured and forecast values"],
              ["actual", "Measured", "Scale to measured values"],
              ["prediction", "Forecast", "Scale to forecast values"],
            ] as const).map(([mode, label, title]) => (
              <button
                key={mode}
                type="button"
                className={`predictor-lane-btn${scaleMode === mode ? " is-active" : ""}`}
                aria-pressed={scaleMode === mode}
                onClick={() => setScaleMode(mode)}
                title={title}
              >
                {label}
              </button>
            ))}
          </div>

          {hasRunHistory && (
            <div className="predictor-lane-toggle" role="group" aria-label="Layers">
              <button
                type="button"
                className={`predictor-lane-btn${showBands ? " is-active" : ""}`}
                aria-pressed={showBands}
                onClick={() => setShowBands((v) => !v)}
              >
                Spread
              </button>
              <button
                type="button"
                className={`predictor-lane-btn${bandsOnly ? " is-active" : ""}`}
                aria-pressed={bandsOnly}
                onClick={() => setBandsOnly((v) => !v)}
              >
                Forecasts only
              </button>
            </div>
          )}
          {hasRunHistory && (
            <InfoTip tip="Spread shades the range of values forecast for each 15-minute slot across past forecast runs: the light band is the full range, the darker band the middle half (25th to 75th percentile). Forecasts only hides the measured lines." />
          )}
        </div>

        {chartData.length === 0 ? (
          <div className="predictor-chart-empty">
            <strong>Nothing to plot</strong>
            <p>There are no measurements or forecasts for this house in the last 3 days.</p>
          </div>
        ) : (
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
              tickFormatter={(v: number) => String(parseFloat(v.toPrecision(3)))}
              width={52}
              label={{ value: "kWh", angle: -90, position: "insideLeft", fill: "var(--text-soft)", fontSize: 11 }}
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
              formatter={(value: string) => <span className="predictor-legend-label">{value}</span>}
            />

            {nowSlot && (
              <ReferenceLine
                x={nowSlot}
                yAxisId="left"
                stroke="var(--line-strong)"
                strokeDasharray="4 4"
                label={{ value: "Now", fill: "var(--text-soft)", fontSize: 10, position: "insideTopRight" }}
              />
            )}

            {/* Forecast confidence bands — outer (min–max) then inner (IQR), rendered below the lines */}
            {isConsumption && showBands && (
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
            {isProduction && showBands && (
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

            {/* Actual lines — hidden in predictions-only mode */}
            {isConsumption && !bandsOnly && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="actualConsumption"
                stroke={LANE_COLORS.consumption.actual}
                strokeWidth={2}
                name="Measured consumption"
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
                name="Forecast consumption"
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
                name="Measured production"
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
                name="Forecast production"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}

            {/* Last-prediction trace: for each past point, the most recent model prediction */}
            {isConsumption && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="lastPredConsumption"
                stroke={LANE_COLORS.consumption.predicted}
                strokeWidth={1.5}
                strokeOpacity={0.8}
                name="Earlier forecast, consumption"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
                legendType="none"
              />
            )}
            {isProduction && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="lastPredProduction"
                stroke={LANE_COLORS.production.predicted}
                strokeWidth={1.5}
                strokeOpacity={0.8}
                name="Earlier forecast, production"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
                legendType="none"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        )}

      </section>

      <InputDataPanel data={dataQuality} />

      <ConfirmDialog
        open={showForecastDialog}
        title="Forecast now"
        message={`Run a forecast for ${selectedHouseId} now, for both consumption and production? If it succeeds it is published like a scheduled one.`}
        confirmLabel="Run forecast"
        confirmVariant="primary"
        pending={commandMutation.isPending}
        onConfirm={handleForecast}
        onCancel={() => setShowForecastDialog(false)}
      />

      <ConfirmDialog
        open={showFlexDialog}
        title="Run flexibility job"
        message={`Compute EV charging flexibility for ${selectedHouseId} from its recent charging sessions.`}
        confirmLabel="Run job"
        confirmVariant="primary"
        pending={commandMutation.isPending}
        onConfirm={handleFlex}
        onCancel={() => setShowFlexDialog(false)}
      />
    </div>
  );
}