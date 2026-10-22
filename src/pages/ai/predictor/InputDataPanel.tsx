import { Badge } from "../../../components/ui/Badge";
import { InfoTip } from "../../../components/ui/InfoTip";
import type { DataQualityResponse } from "../../../api/predictorApi";
import {
  METER_SOURCE_LABELS, METER_SOURCE_TIPS, coveragePct, droppedReadings, meterUnitLabel, refusalText,
} from "./inputQuality";

const LANES = [["consumption", "Consumption"], ["production", "Production"]] as const;
const CONFIDENCE = {
  high: { label: "Sure", tone: "success" },
  low: { label: "Guess", tone: "warning" },
  none: { label: "Unknown", tone: "neutral" },
} as const;

/** How the predictor reads this house's meters, and how complete the last week of readings was. */
export function InputDataPanel({ data }: { data: DataQualityResponse | undefined }) {
  if (!data || !LANES.some(([lane]) => data.lanes[lane]?.meter || data.lanes[lane]?.window)) return null;

  return (
    <section className="panel predictor-jobs-panel" aria-label="Input data">
      <div className="predictor-panel-header">
        <h2>Input data</h2>
        <InfoTip tip="How the predictor reads this house's meters, and the last week of readings it forecast from. Updated every forecast cycle." />
      </div>
      <div className="predictor-panel-body">
        <table className="table predictor-jobs-table">
          <thead>
            <tr>
              <th>Lane</th>
              <th>Unit</th>
              <th>Source</th>
              <th>Certainty</th>
              <th className="is-num">Coverage <InfoTip tip="Share of 15-minute slots in the last week that had enough readings." /></th>
              <th className="is-num">Left out <InfoTip tip="Readings ignored: duplicates, unreadable values, large negatives, implausible spikes and counter resets." /></th>
              <th>Model trained as</th>
            </tr>
          </thead>
          <tbody>
            {LANES.map(([lane, name]) => {
              const q = data.lanes[lane];
              if (!q) return null;
              const meter = q.meter;
              const coverage = coveragePct(q);
              const conf = meter?.source === "declared" ? null : meter?.confidence ? CONFIDENCE[meter.confidence] : null;
              const trained = q.model?.meter ?? null;
              const mismatch = !!(trained && meter && meterUnitLabel(trained) !== meterUnitLabel(meter.spec));
              return (
                <tr key={lane}>
                  <td><span className={`analysis-lane-dot is-${lane}`} />{name}</td>
                  <td>{meter ? meterUnitLabel(meter.spec) : "—"}</td>
                  <td>
                    {meter ? (
                      <span className="input-source">
                        {METER_SOURCE_LABELS[meter.source] ?? meter.source}
                        <InfoTip tip={METER_SOURCE_TIPS[meter.source] ?? ""} />
                      </span>
                    ) : "—"}
                  </td>
                  <td>{meter?.source === "declared" ? <Badge tone="success">Declared</Badge> : conf ? <Badge tone={conf.tone}>{conf.label}</Badge> : "—"}</td>
                  <td className={`is-num${coverage != null && coverage < 80 ? " is-warning-text" : ""}`}>
                    {coverage == null ? "—" : `${coverage.toFixed(0)} %`}
                  </td>
                  <td className="is-num is-muted">{q.window ? droppedReadings(q) : "—"}</td>
                  <td>
                    {q.refused ? (
                      <span className="is-warning-text" title={refusalText(q.refused.reason)}>Refused, retrain</span>
                    ) : q.model == null ? (
                      <span className="is-muted">No model</span>
                    ) : trained ? (
                      <span className={mismatch ? "is-warning-text" : undefined}>{meterUnitLabel(trained)}</span>
                    ) : (
                      <span className="is-muted">Not recorded</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
