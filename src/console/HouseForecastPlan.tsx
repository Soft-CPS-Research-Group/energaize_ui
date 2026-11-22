import { useEffect, useState } from "react";
import { Activity, Settings2 } from "lucide-react";
import { runtimeRequest } from "../api/runtimeApi";

type Lane = {
  series: "consumption" | "production";
  metric: string;
  equipment: string[];
  input_state: "mapped" | "missing_meter" | "ambiguous_meter" | "missing_input";
  missing_inputs: string[];
  forecast_channel_configured: boolean;
};

type ForecastPlan = { site_id: string; lanes: Lane[]; ev_chargers: string[] };

function inputDescription(lane: Lane) {
  switch (lane.input_state) {
    case "missing_meter":
      return "Assign a main grid meter in Inventory.";
    case "ambiguous_meter":
      return "Review the main meter assignment in Inventory.";
    case "missing_input":
      return "Configure an energy reading in Percepta for " + lane.missing_inputs.join(", ") + ".";
    case "mapped":
      return lane.equipment.join(", ") + " · energy input mapped";
  }
}

export function HouseForecastPlan({ siteId, onConfigure, revision = 0 }: {
  siteId: string;
  onConfigure?: () => void;
  revision?: number;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; plan?: ForecastPlan; error?: string }>();
  const key = JSON.stringify([siteId, revision, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    runtimeRequest<ForecastPlan>(`/api/runtime/sites/${siteId}/forecast-plan`, { signal: controller.signal })
      .then(plan => {
        if (controller.signal.aborted) return;
        if (plan.site_id !== siteId || !Array.isArray(plan.lanes) || !Array.isArray(plan.ev_chargers)) throw Error("Unexpected house forecast plan.");
        setResult({ key, plan });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setResult({ key, error: error.message });
      });
    return () => controller.abort();
  }, [key, siteId]);

  const current = result?.key === key ? result : undefined;
  const plan = current?.plan;
  return <section className="house-forecast-plan" aria-label="House forecast plan">
    <header>
      <div><h3><Activity size={17} aria-hidden="true" />House forecast plan</h3>
        <p>From the saved equipment and Percepta configuration.</p></div>
      {onConfigure && <button className="btn" onClick={onConfigure}><Settings2 size={15} />Configure Percepta</button>}
    </header>
    {current?.error ? <p role="alert">Forecast plan unavailable. {current.error} <button className="btn text" onClick={() => setAttempt(n => n + 1)}>Retry</button></p>
      : !plan ? <p role="status">Loading house plan…</p> : <>
        <ul>{plan.lanes.map(lane => <li key={lane.series}>
          <div><strong>{lane.series === "consumption" ? "Base consumption" : "Solar production"}</strong>
            <small>{inputDescription(lane)}</small></div>
          <span>{lane.forecast_channel_configured ? "Forecast input configured" : "Forecast input to configure"}</span>
        </li>)}
        {plan.ev_chargers.map((name, index) => <li key={index}>
          <div><strong>EV availability</strong><small>{name}</small></div>
          <span>Separate Flexibility policy</span>
        </li>)}</ul>
        <p>One shared Predictor serves the energy forecasts. Check received forecasts in Percepta messages.</p>
      </>}
  </section>;
}
