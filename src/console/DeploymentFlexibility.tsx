import { readJson } from "./DeploymentFlow";
import { stamp } from "./deploymentModel";

export type Charger = { id: string; name: string };
type Window = {
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  sample_count: number;
};
type Result = {
  session_count: number;
  windows: Window[];
  reason?: string | null;
};
type Forecast = {
  asset_id: string;
  state: string;
  prediction: {
    usable: boolean;
    generated_at: string;
    valid_until: string;
    result: Result;
  } | null;
  jobs: {
    status: string;
    updated_at: string;
    error?: string | null;
    result?: Result | null;
  }[];
};
type ChargerForecast = Charger & { forecast?: Forecast; error?: string };
export async function chargerForecasts(
  chargers: Charger[],
  signal: AbortSignal,
): Promise<ChargerForecast[]> {
  return Promise.all(
    chargers.map(async (charger) => {
      try {
        const forecast = await readJson<Forecast>(
          `/flexibility-api/api/flexibility/assets/${encodeURIComponent(charger.id)}/forecasts`,
          signal,
        );
        if (forecast.asset_id !== charger.id)
          throw Error("Unexpected equipment in forecast response");
        return { ...charger, forecast };
      } catch (e) {
        if (signal.aborted) throw e;
        return { ...charger, error: (e as Error).message };
      }
    }),
  );
}
const states: Record<string, string> = {
  disabled: "Forecasting disabled",
  not_requested: "No forecast requested",
  pending: "Waiting for the predictor",
  running: "Forecast in progress",
  insufficient_data: "Insufficient observed sessions",
  completed: "Completed",
  failed: "Forecast failed",
  superseded: "Superseded",
};
export function FlexibilityForecasts({ rows }: { rows?: ChargerForecast[] }) {
  return (
    <section
      className="deployment-flex-forecasts"
      aria-label="Charger forecasts"
    >
      <p>
        Flexibility uses charger history from Telemetry. Its EV predictor
        returns expected plug-in windows for each charger.
      </p>
      {!rows ? (
        <p role="status">Checking charger forecasts…</p>
      ) : !rows.length ? (
        <p>No installed EV charger at this site.</p>
      ) : (
        rows.map(({ id, name, forecast, error }) => {
          const prediction = forecast?.prediction,
            job = forecast?.jobs[0];
          return (
            <section key={id}>
              <h4>{name}</h4>
              {error ? (
                <p role="alert">{error}</p>
              ) : (
                forecast && (
                  <>
                    <strong>{states[forecast.state] || forecast.state}</strong>
                    {job && (
                      <p>
                        Last job · {stamp(job.updated_at)} ·{" "}
                        {states[job.status] || job.status}
                      </p>
                    )}
                    {(job?.error || job?.result?.reason) && (
                      <p>{job.error || job.result?.reason}</p>
                    )}
                    {prediction ? (
                      <>
                        <p>
                          {prediction.usable
                            ? "Current forecast"
                            : "Previous forecast"}{" "}
                          · {stamp(prediction.generated_at)} · Valid until{" "}
                          {stamp(prediction.valid_until)}
                        </p>
                        <p>
                          {prediction.result.session_count} observed sessions
                        </p>
                        {prediction.result.windows.length ? (
                          <table>
                            <thead>
                              <tr>
                                <th>Plug-in</th>
                                <th>Departure</th>
                                <th>Typical use</th>
                              </tr>
                            </thead>
                            <tbody>
                              {prediction.result.windows.map((w, i) => (
                                <tr key={i}>
                                  <td>{stamp(w.starts_at)}</td>
                                  <td>{stamp(w.ends_at)}</td>
                                  <td>{w.duration_minutes} min</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p>No predicted plug-in windows.</p>
                        )}
                      </>
                    ) : (
                      <p>No forecast returned for this charger.</p>
                    )}
                  </>
                )
              )}
            </section>
          );
        })
      )}
    </section>
  );
}
