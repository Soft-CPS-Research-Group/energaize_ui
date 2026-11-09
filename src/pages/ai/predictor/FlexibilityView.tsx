import { useEffect, useMemo, useState } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { Badge } from "../../../components/ui/Badge";
import { InfoTip } from "../../../components/ui/InfoTip";
import { usePredictorScope } from "../../../contexts/PredictorWorkspaceContext";
import { useFlexAssetForecasts, useFlexAssets, useFlexWorker } from "../../../hooks/usePredictor";
import type { FlexAsset, FlexForecast, FlexWindow, FlexWorkerState } from "../../../api/predictorApi";
import { fmtTs } from "./analysisFormat";
import {
  assetsInScope,
  chargerName,
  dayTicks,
  formatSocChange,
  jobBadge,
  jobBadgeTip,
  modelLabel,
  sourceSummary,
  timelineBar,
} from "./flexibilityFormat";

function useTimeFormat(timezone: string) {
  return useMemo(() => {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const day = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" });
    return {
      time: (iso: string) => time.format(new Date(iso)),
      day: (iso: string) => day.format(new Date(iso)),
      span: (from: string, to: string) => `${day.format(new Date(from))} ${time.format(new Date(from))} → ${time.format(new Date(to))}`,
    };
  }, [timezone]);
}

function WorkerStrip({ worker, assets, timezone }: { worker: FlexWorkerState | undefined; assets: FlexAsset[]; timezone: string }) {
  const forecast = assets.filter((a) => a.latest?.status === "completed" && a.latest.delivery === "delivered").length;
  const jobs = worker?.jobs;
  const fleet = worker?.global_model;
  return (
    <section className="predictor-status-strip" aria-label="EV flexibility status">
      <div className="predictor-status-item">
        <span>EV worker</span>
        <strong>{!worker ? "—" : worker.enabled ? (worker.running ? "On" : "Starting") : "Off"}</strong>
        {worker?.enabled && <small>{worker.model === "kde" ? "Kernel density" : "Quantile forest"} · {worker.worker_id}</small>}
      </div>
      <div className="predictor-status-item">
        <span>Chargers with a forecast</span>
        <strong>{assets.length ? `${forecast} of ${assets.length}` : "—"}</strong>
        <small>Latest job sent plug-in windows</small>
      </div>
      <div className="predictor-status-item">
        <span>Jobs since the service started</span>
        <strong>{jobs ? jobs.completed + jobs.insufficient_data + jobs.failed + jobs.lost : "—"}</strong>
        {jobs && (
          <small>
            {jobs.completed} forecast · {jobs.insufficient_data} insufficient · {jobs.failed} failed · {jobs.lost} lost
          </small>
        )}
      </div>
      <div className="predictor-status-item">
        <span>Fleet forest <InfoTip tip="Fitted on every mapped charger together. Chargers with little history use it until their own history is enough: 20 sessions for arrival, 40 for dwell, 10 for SoC." width={280} /></span>
        <strong>{fleet ? `${fleet.assets} chargers` : "Not built"}</strong>
        <small>{fleet ? `${fleet.sessions} sessions · fitted ${fmtTs(fleet.built_at, timezone)}` : "Needs two chargers with history"}</small>
      </div>
    </section>
  );
}

function ChargerTable({ assets, selected, onSelect, timezone }: {
  assets: FlexAsset[]; selected: string | null; onSelect: (id: string) => void; timezone: string;
}) {
  const fmt = useTimeFormat(timezone);
  return (
    <div className="panel">
      <div className="flex-panel-head">
        <h2>Chargers</h2>
        <span className="is-muted">From the predictor's asset map. Select one to see its forecast.</span>
      </div>
      <div className="analysis-table-scroll">
        <table className="table analysis-table flex-asset-table">
          <thead>
            <tr>
              <th>Charger</th>
              <th>Vehicle</th>
              <th>Last job</th>
              <th>Finished</th>
              <th className="is-num">Windows</th>
              <th>First plug-in</th>
              <th>Model</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const latest = asset.latest;
              const badge = jobBadge(latest);
              const isSelected = asset.asset_id === selected;
              return (
                <tr
                  key={asset.asset_id}
                  className={`flex-asset-row${isSelected ? " is-selected" : ""}`}
                  onClick={() => onSelect(asset.asset_id)}
                  aria-selected={isSelected}
                >
                  <td>
                    <button type="button" className="flex-asset-name" onClick={() => onSelect(asset.asset_id)} title={asset.asset_id}>
                      {chargerName(asset)}
                    </button>
                    {!asset.mapped && <small className="is-muted"> no longer mapped</small>}
                  </td>
                  <td>{asset.vehicle_id ?? <span className="is-muted">Any</span>}</td>
                  <td>
                    <span title={latest?.reason ?? jobBadgeTip(latest)}><Badge tone={badge.tone}>{badge.label}</Badge></span>
                  </td>
                  <td>{latest ? fmtTs(latest.finished_at, timezone) : <span className="is-muted">—</span>}</td>
                  <td className="is-num">{latest ? latest.window_count : "—"}</td>
                  <td>
                    {latest?.first_window
                      ? fmt.span(latest.first_window.starts_at, latest.first_window.ends_at)
                      : <span className="is-muted">{latest?.reason ? "—" : ""}</span>}
                  </td>
                  <td>
                    {latest?.model ? modelLabel(latest.model) : <span className="is-muted">—</span>}
                    {sourceSummary(latest?.sources) && <small className="is-muted flex-cell-note">{sourceSummary(latest?.sources)}</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WindowRow({ window, forecast, timezone }: { window: FlexWindow; forecast: FlexForecast; timezone: string }) {
  const fmt = useTimeFormat(timezone);
  const bar = timelineBar(window, forecast.from_at, forecast.until_at);
  const soc = formatSocChange(window);
  const tip = [
    `Plug-in ${fmt.time(window.starts_at)} (P10–P90 ${fmt.time(window.arrival_range.p10)}–${fmt.time(window.arrival_range.p90)})`,
    `Unplug ${fmt.time(window.ends_at)} (P10–P90 ${fmt.time(window.departure_range.p10)}–${fmt.time(window.departure_range.p90)})`,
    soc ? `SoC ${soc}` : null,
    `Seen in ${Math.round(window.probability * 100)}% of past weeks`,
  ].filter(Boolean).join(" · ");
  return (
    <li className="flex-window">
      <div className="flex-window-label">
        <strong>{fmt.day(window.starts_at)}</strong>
        <span>{fmt.time(window.starts_at)} → {fmt.time(window.ends_at)}</span>
      </div>
      <div className="flex-window-track" title={tip}>
        <span className="flex-window-range" style={{ left: `${bar.rangeLeft}%`, width: `${bar.rangeWidth}%` }} />
        <span className="flex-window-bar" style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />
      </div>
      <div className="flex-window-meta">
        {soc && <span>{soc}</span>}
        <span className="is-muted">{Math.round(window.probability * 100)}%</span>
      </div>
    </li>
  );
}

function ForecastPanel({ asset, timezone }: { asset: FlexAsset; timezone: string }) {
  const { data: forecasts, isLoading, isError } = useFlexAssetForecasts(asset.asset_id);
  const fmt = useTimeFormat(timezone);
  const latest = forecasts?.[0];
  const ticks = latest ? dayTicks(latest.from_at, latest.until_at, timezone) : [];
  const badge = jobBadge(latest);

  return (
    <div className="panel flex-forecast-panel">
      <div className="flex-panel-head">
        <h2>Forecast for {chargerName(asset)}</h2>
        {latest && <Badge tone={badge.tone}>{badge.label}</Badge>}
        {latest && (
          <span className="is-muted">
            {fmt.day(latest.from_at)} → {fmt.day(latest.until_at)} · {modelLabel(latest.model)}
            {sourceSummary(latest.sources) ? ` · ${sourceSummary(latest.sources)}` : ""}
            {latest.session_count != null ? ` · ${latest.session_count} past sessions` : ""}
          </span>
        )}
      </div>

      {isLoading && <p className="is-muted">Loading forecasts…</p>}
      {isError && <p className="analysis-error">The predictor could not return this charger's forecasts.</p>}
      {!isLoading && !isError && !latest && (
        <p className="is-muted">No job for this charger yet. Flexibility asks for a forecast when its policy says so.</p>
      )}

      {latest && latest.windows.length === 0 && (
        <div className={`predictor-notice is-${latest.status === "failed" || latest.delivery === "lost" ? "warning" : "info"}`} role="status">
          {latest.status === "failed" || latest.delivery === "lost" ? <TriangleAlert size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
          <div>
            <strong>{jobBadgeTip(latest)}</strong>
            {(latest.error || latest.reason) && <p>{latest.error || latest.reason}</p>}
          </div>
        </div>
      )}

      {latest && latest.windows.length > 0 && (
        <>
          <div className="flex-timeline-axis" aria-hidden="true">
            <span className="flex-window-label" />
            <div className="flex-window-track is-axis">
              {ticks.map((tick) => (
                <span key={tick.left} className="flex-axis-tick" style={{ left: `${tick.left}%` }}>{tick.label}</span>
              ))}
            </div>
            <span className="flex-window-meta"><span className="is-muted">SoC · weeks</span></span>
          </div>
          <ul className="flex-window-list" aria-label="Predicted plug-in windows">
            {latest.windows.map((window) => (
              <WindowRow key={window.starts_at} window={window} forecast={latest} timezone={timezone} />
            ))}
          </ul>
          <p className="flex-legend is-muted">
            <span className="flex-legend-swatch is-bar" /> Median plug-in to unplug
            <span className="flex-legend-swatch is-range" /> Early arrival (P10) to late departure (P90)
          </p>
        </>
      )}

      {forecasts && forecasts.length > 0 && (
        <details className="flex-history">
          <summary>Recent jobs ({forecasts.length})</summary>
          <table className="table analysis-table">
            <thead>
              <tr><th>Finished</th><th>Status</th><th>Horizon</th><th className="is-num">Windows</th><th>Note</th></tr>
            </thead>
            <tbody>
              {forecasts.map((job) => {
                const b = jobBadge(job);
                return (
                  <tr key={job.job_id + job.finished_at}>
                    <td>{fmtTs(job.finished_at, timezone)}</td>
                    <td><Badge tone={b.tone}>{b.label}</Badge></td>
                    <td>{fmt.day(job.from_at)} → {fmt.day(job.until_at)}</td>
                    <td className="is-num">{job.windows.length}</td>
                    <td className="is-muted">{job.error || job.reason || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

/** EV flexibility: which chargers the predictor forecasts for the Flexibility backend, and what it sent. */
export function FlexibilityView({ timezone }: { timezone: string }) {
  const worker = useFlexWorker();
  const assetsQuery = useFlexAssets();
  const { houses, community } = usePredictorScope();
  const assets = useMemo(
    () => assetsInScope(assetsQuery.data?.assets ?? [], community ? houses : null),
    [assetsQuery.data, houses, community],
  );
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (assets.length === 0) return;
    if (selected && assets.some((a) => a.asset_id === selected)) return;
    setSelected(assets[0].asset_id);
  }, [assets, selected]);

  if (assetsQuery.isError && worker.isError) {
    return (
      <div className="panel">
        <h2>EV flexibility</h2>
        <p className="is-muted">This predictor build has no EV flexibility endpoints yet. Update the forecasting service to see its EV forecasts here.</p>
      </div>
    );
  }

  const selectedAsset = assets.find((a) => a.asset_id === selected) ?? null;
  const off = worker.data && !worker.data.enabled;

  return (
    <div className="predictor-predict-view flex-view">
      <WorkerStrip worker={worker.data} assets={assets} timezone={timezone} />

      {(off || worker.data?.last_error) && (
        <div className="predictor-notices">
          {off && (
            <div className="predictor-notice is-info" role="status">
              <Info size={16} aria-hidden="true" />
              <div>
                <strong>The EV worker is off</strong>
                <p>It takes forecast jobs from the Flexibility backend once FLEX_API_URL and FLEX_WORKER_KEY are set on the forecasting service. Earlier forecasts stay listed.</p>
              </div>
            </div>
          )}
          {worker.data?.enabled && worker.data.last_error && (
            <div className="predictor-notice is-warning" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <div>
                <strong>Last problem talking to Flexibility</strong>
                <p>{worker.data.last_error}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {assetsQuery.isLoading ? (
        <div className="panel"><p className="is-muted">Loading chargers…</p></div>
      ) : assets.length === 0 ? (
        <div className="panel">
          <h2>Chargers</h2>
          <p className="is-muted">
            {community
              ? `No charger of ${community.name}'s houses is in the predictor's asset map.`
              : "No charger is mapped yet. Add the Flexibility asset ids to config/flex_assets.json on the forecasting service."}
          </p>
        </div>
      ) : (
        <>
          <ChargerTable assets={assets} selected={selected} onSelect={setSelected} timezone={timezone} />
          {selectedAsset && <ForecastPanel asset={selectedAsset} timezone={timezone} />}
        </>
      )}
    </div>
  );
}
