import { useState, useEffect, useRef } from "react";
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

  const { data: chartData } = buildPredictorTimeline(history, predictions, predHistory);

  // Refs for simpleheat canvas elements and chart width measurement
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const heatConsRef  = useRef<HTMLCanvasElement>(null);
  const heatProdRef  = useRef<HTMLCanvasElement>(null);
  const [chartContainerWidth, setChartContainerWidth] = useState(0);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setChartContainerWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isConsumption = activeLane === "consumption" || activeLane === "both";
  const isProduction  = activeLane === "production"  || activeLane === "both";

  // Chart geometry constants — must match ComposedChart margin + axis dimensions exactly
  const CHART_H  = 380;
  const LEGEND_H = 32;   // <Legend verticalAlign="top" height={32}>
  const PLOT_L   = 78;   // margin-left(8) + yAxisWidth(70)
  const PLOT_T   = 6 + LEGEND_H; // margin-top(6) + legend
  const plotH    = CHART_H - PLOT_T - 26; // margin-bottom(6) + xAxisHeight(20)

  // yMax is shared between the YAxis domain and heatmap pixel math so coordinates align
  let _yMax = 0.001;
  for (const pt of chartData) {
    for (const k of Object.keys(pt)) {
      if (pt[k] == null || typeof pt[k] !== "number") continue;
      if (
        (isConsumption && (k === "actualConsumption" || k === "predictedConsumption" || k.startsWith("spec_consumption_")))
        || (isProduction && (k === "actualProduction" || k === "predictedProduction" || k.startsWith("spec_production_")))
      ) {
        if ((pt[k] as number) > _yMax) _yMax = pt[k] as number;
      }
    }
  }
  const yMax = _yMax * 1.08;

  // Rebuild heatmap canvas whenever chart data, lane, container width, or scale changes.
  // IMPORTANT: we measure width from the DOM directly inside the effect as a fallback so the
  // heatmap still renders when chartData arrives before the ResizeObserver fires (page load race).
  useEffect(() => {
    const wrapEl = chartWrapRef.current;
    // Use state width if available, otherwise fall back to the live DOM measurement
    const effectWidth = chartContainerWidth > 0 ? chartContainerWidth : (wrapEl?.offsetWidth ?? 0);
    const effectPlotW = Math.max(0, effectWidth - PLOT_L - 20);
    const effectSlotW = chartData.length > 0 ? effectPlotW / chartData.length : 0;

    const lanes = [
      { lane: "consumption" as const, ref: heatConsRef },
      { lane: "production"  as const, ref: heatProdRef },
    ];

    for (const { lane, ref } of lanes) {
      const canvas = ref.current;
      if (!canvas) continue;
      canvas.width  = Math.max(effectWidth, 1);
      canvas.height = CHART_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (effectWidth <= 0 || effectSlotW <= 0) continue;

      // Clip to the plot area so strokes don’t bleed over the legend, axes, or margins
      ctx.save();
      ctx.beginPath();
      ctx.rect(PLOT_L, PLOT_T, effectPlotW, plotH);
      ctx.clip();

      // Scan ALL points — spec_ keys only appear on future-slot points, not historical ones
      const specKeys: string[] = [];
      for (const pt of chartData) {
        for (const k of Object.keys(pt)) {
          if (k.startsWith(`spec_${lane}_`) && !specKeys.includes(k)) specKeys.push(k);
        }
      }
      if (specKeys.length === 0) { ctx.restore(); continue; }

      // Sort spec keys by their numeric index so oldest (0) → newest (N-1)
      specKeys.sort((a, b) => {
        const ai = parseInt(a.split("_").pop() ?? "0", 10);
        const bi = parseInt(b.split("_").pop() ?? "0", 10);
        return ai - bi;
      });
      const total = specKeys.length;

      // Colour interpolation: same hue, older = pale tint → newer = full saturated lane colour.
      // Oldest drawn first, newest drawn last (on top) — loop order guarantees this.
      // Consumption: pale blue (#bfdbfe) → #3b82f6
      // Production:  pale violet (#ede9fe) → #a78bfa
      const OLD_COLOR = lane === "consumption" ? [191, 219, 254] : [237, 233, 254];
      const NEW_COLOR = lane === "consumption" ? [ 59, 130, 246] : [167, 139, 250];

      ctx.lineWidth = 7;
      ctx.lineJoin  = "round";
      ctx.lineCap   = "round";

      for (let ki = 0; ki < specKeys.length; ki++) {
        const key = specKeys[ki];
        const t  = total > 1 ? ki / (total - 1) : 1; // 0 = oldest, 1 = newest
        const rv = Math.round(OLD_COLOR[0] + t * (NEW_COLOR[0] - OLD_COLOR[0]));
        const gv = Math.round(OLD_COLOR[1] + t * (NEW_COLOR[1] - OLD_COLOR[1]));
        const bv = Math.round(OLD_COLOR[2] + t * (NEW_COLOR[2] - OLD_COLOR[2]));
        const alpha = 0.10 + t * 0.20;
        ctx.strokeStyle = `rgba(${rv},${gv},${bv},${alpha.toFixed(2)})`;
        const pts: [number, number][] = [];
        for (let xi = 0; xi < chartData.length; xi++) {
          const val = chartData[xi][key];
          if (val == null) continue;
          const px = PLOT_L + (xi + 0.5) * effectSlotW;
          const py = PLOT_T + plotH * (1 - Math.min(Math.max(val as number, 0), yMax) / yMax);
          pts.push([px, py]);
        }
        if (pts.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2;
          const my = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        ctx.stroke();
      }

      ctx.restore();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartData, activeLane, chartContainerWidth, yMax]);

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
            {(predHistory.consumption.length > 0 || predHistory.production.length > 0) && (
              <span className="predictor-spectrum-hint">
                prediction history heatmap
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

        <div ref={chartWrapRef} style={{ position: "relative" }}>
          {/* Heatmap canvases — above chart (zIndex:3), pointer-events:none so interactions pass through.
              CSS blur turns the overlapping semi-transparent strokes into a smooth density field. */}
          <canvas
            ref={heatConsRef}
            style={{
              position: "absolute", top: 0, left: 0,
              pointerEvents: "none", zIndex: 3,
              opacity: isConsumption ? 0.55 : 0,
              filter: "blur(4px)",
              transition: "opacity 0.2s",
            }}
          />
          <canvas
            ref={heatProdRef}
            style={{
              position: "absolute", top: 0, left: 0,
              pointerEvents: "none", zIndex: 3,
              opacity: isProduction ? 0.55 : 0,
              filter: "blur(4px)",
              transition: "opacity 0.2s",
            }}
          />
          <ResponsiveContainer width="100%" height={CHART_H} style={{ position: "relative", zIndex: 2 }}>
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
            />
            <Tooltip content={TooltipContent} />
            <Legend
              verticalAlign="top"
              height={32}
              wrapperStyle={{ fontSize: "0.78rem" }}
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