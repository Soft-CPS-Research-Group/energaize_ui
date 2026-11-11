import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../../components/ui/Badge";
import type { FlexAsset, FlexForecast, FlexWindow } from "../../../api/predictorApi";
import { chargerName, dayColumns, formatSoc, formatSocChange, jobBadge, REGULAR_HABIT, stayLayout } from "./flexibilityFormat";

function useFormats(timezone: string) {
  return useMemo(() => {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const day = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long", day: "numeric", month: "short" });
    return { time: (iso: string) => time.format(new Date(iso)), day: (iso: string) => day.format(new Date(iso)) };
  }, [timezone]);
}

/** The predicted stay in plain words. */
function stayLines(window: FlexWindow, f: ReturnType<typeof useFormats>): string[] {
  const lines = [
    `Plugs in around ${f.time(window.starts_at)}, usually between ${f.time(window.arrival_range.p10)} and ${f.time(window.arrival_range.p90)}.`,
    `Unplugs around ${f.time(window.ends_at)}, usually between ${f.time(window.departure_range.p10)} and ${f.time(window.departure_range.p90)}.`,
  ];
  if (window.soc_at_arrival != null || window.soc_at_departure != null) {
    lines.push(`Battery at ${formatSoc(window.soc_at_arrival)} when it plugs in, ${formatSoc(window.soc_at_departure)} when it leaves.`);
  }
  lines.push(`This happened in ${Math.round(window.probability * 100)}% of past weeks.`);
  return lines;
}

/**
 * One chart for the whole horizon: a row per charger, a bar per expected stay from plug-in to unplug,
 * the battery level written on the bar, and whiskers for how early or late the car may come and go.
 */
export function PlugInChart({ assets, forecasts, timezone, selected, onSelect }: {
  assets: FlexAsset[];
  forecasts: Record<string, FlexForecast | undefined>;
  timezone: string;
  selected: string | null;
  onSelect: (assetId: string) => void;
}) {
  const f = useFormats(timezone);
  const withStays = assets.map((a) => forecasts[a.asset_id]).filter((x): x is FlexForecast => !!x && x.windows.length > 0);
  const from = withStays.length ? Math.min(...withStays.map((x) => Date.parse(x.from_at))) : 0;
  const until = withStays.length ? Math.max(...withStays.map((x) => Date.parse(x.until_at))) : 0;
  const columns = useMemo(() => dayColumns(from, until, timezone), [from, until, timezone]);
  const [picked, setPicked] = useState<{ assetId: string; startsAt: string } | null>(null);

  // Follow the selected charger: show its first stay unless one of its stays is already picked.
  useEffect(() => {
    if (!selected) return;
    if (picked?.assetId === selected) return;
    const first = forecasts[selected]?.windows[0];
    setPicked(first ? { assetId: selected, startsAt: first.starts_at } : null);
  }, [selected, forecasts, picked]);

  if (withStays.length === 0) return null;

  const pickedAsset = picked ? assets.find((a) => a.asset_id === picked.assetId) : undefined;
  const pickedStay = picked ? forecasts[picked.assetId]?.windows.find((w) => w.starts_at === picked.startsAt) : undefined;

  return (
    <div className="panel flex-chart-panel">
      <div className="flex-panel-head">
        <h2>When each car is plugged in</h2>
      </div>

      <div className="flex-chart-scroll">
        <div className="flex-chart" role="table" aria-label="Expected charging stays per charger">
          <div className="flex-chart-row is-head" role="row">
            <span className="flex-chart-name" role="columnheader">Charger</span>
            <div className="flex-chart-lane is-head">
              {columns.map((c) => (
                <span key={c.left} className="flex-chart-day" style={{ left: `${c.left}%`, width: `${c.width}%` }} role="columnheader">{c.label}</span>
              ))}
            </div>
          </div>

          {assets.map((asset) => {
            const forecast = forecasts[asset.asset_id];
            const stays = forecast?.windows ?? [];
            const isSelected = asset.asset_id === selected;
            const badge = jobBadge(forecast ?? asset.latest);
            return (
              <div key={asset.asset_id} className={`flex-chart-row${isSelected ? " is-selected" : ""}`} role="row">
                <button type="button" className="flex-chart-name" onClick={() => onSelect(asset.asset_id)} aria-pressed={isSelected}>
                  {chargerName(asset)}
                </button>
                <div className="flex-chart-lane" role="cell">
                  {columns.slice(1).map((c) => <span key={c.left} className="flex-chart-midnight" style={{ left: `${c.left}%` }} />)}
                  {stays.map((stay) => {
                    const box = stayLayout(stay, from, until);
                    const soc = formatSocChange(stay);
                    const regular = stay.probability >= REGULAR_HABIT;
                    const isPicked = picked?.assetId === asset.asset_id && picked.startsAt === stay.starts_at;
                    return (
                      <button
                        type="button"
                        key={stay.starts_at}
                        className={`flex-stay${regular ? "" : " is-irregular"}${isPicked ? " is-picked" : ""}`}
                        style={{ left: `${box.earlyLeft}%`, width: `${box.lateRight - box.earlyLeft}%` }}
                        onClick={() => { onSelect(asset.asset_id); setPicked({ assetId: asset.asset_id, startsAt: stay.starts_at }); }}
                        title={`${chargerName(asset)}, ${f.day(stay.starts_at)}\n${stayLines(stay, f).join("\n")}`}
                        aria-label={`${f.day(stay.starts_at)}, ${f.time(stay.starts_at)} to ${f.time(stay.ends_at)}${soc ? `, battery ${soc}` : ""}`}
                      >
                        <span className="flex-stay-whisker" style={{
                          left: 0,
                          width: `${((box.barLeft - box.earlyLeft) / (box.lateRight - box.earlyLeft)) * 100}%`,
                        }} />
                        <span className="flex-stay-whisker is-late" style={{
                          right: 0,
                          width: `${((box.lateRight - box.barLeft - box.barWidth) / (box.lateRight - box.earlyLeft)) * 100}%`,
                        }} />
                        <span className="flex-stay-bar" style={{
                          left: `${((box.barLeft - box.earlyLeft) / (box.lateRight - box.earlyLeft)) * 100}%`,
                          width: `${(box.barWidth / (box.lateRight - box.earlyLeft)) * 100}%`,
                        }}>
                          {soc && box.barWidth >= 4 && <span className="flex-stay-soc">{soc.replace(/%/, "").replace(/ → /, "→")}</span>}
                        </span>
                      </button>
                    );
                  })}
                  {stays.length === 0 && (
                    <span className="flex-chart-empty">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      <span>{forecast?.error || forecast?.reason || asset.latest?.reason || "No forecast yet"}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-chart-legend is-muted">
        <span><span className="flex-key is-bar" /> Usual plug-in to unplug</span>
        <span><span className="flex-key is-whisker" /> May come this early or leave this late</span>
        <span><span className="flex-key is-irregular" /> Only some weeks</span>
        <span><span className="flex-key is-text">34→90%</span> Battery at plug-in → at unplug</span>
      </div>

      {pickedStay && pickedAsset && (
        <div className="flex-stay-detail" aria-live="polite">
          <strong>{chargerName(pickedAsset)} · {f.day(pickedStay.starts_at)}</strong>
          <ul>
            {stayLines(pickedStay, f).map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
