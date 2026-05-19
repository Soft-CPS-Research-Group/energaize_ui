import { useState } from "react";
import { BatteryCharging, Car, Clock, Save, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { useUI } from "../../contexts/UIContext";

export function ProsumerFlexibilityPage(): JSX.Element {
  const { activeCommunity } = useUI();
  const [minSoc, setMinSoc] = useState(65);
  const [targetSoc, setTargetSoc] = useState(85);
  const [allowExport, setAllowExport] = useState(true);
  const [priority, setPriority] = useState("balanced");

  return (
    <div className="page energy-console-page">
      <header className="energy-page-head">
        <div>
          <span className="section-kicker">Prosumer preferences</span>
          <h1>Flexibility</h1>
          <p>{activeCommunity.name} can optimize around these limits without taking away comfort.</p>
        </div>
        <Button variant="primary" iconLeft={<Save size={15} />}>Save preferences</Button>
      </header>

      <section className="prosumer-flex-grid">
        <article className="prosumer-flex-card panel">
          <header>
            <Car size={20} />
            <div>
              <h2>EV charging</h2>
              <p>Allow managed charging inside your availability window.</p>
            </div>
            <Badge tone="success">Active</Badge>
          </header>

          <label>
            <span>Minimum SoC</span>
            <strong>{minSoc}%</strong>
            <input type="range" min={20} max={95} value={minSoc} onChange={(event) => setMinSoc(Number(event.target.value))} />
          </label>

          <label>
            <span>Target SoC by departure</span>
            <strong>{targetSoc}%</strong>
            <input type="range" min={minSoc} max={100} value={targetSoc} onChange={(event) => setTargetSoc(Number(event.target.value))} />
          </label>

          <div className="energy-schedule-card">
            <span>Availability</span>
            <strong>08:00 - 14:00</strong>
            <div className="energy-schedule-track">
              <span style={{ left: "28%", width: "40%" }} />
            </div>
            <small>Estimated flexibility: 0.8 kWh</small>
          </div>
        </article>

        <article className="prosumer-flex-card panel">
          <header>
            <BatteryCharging size={20} />
            <div>
              <h2>Battery participation</h2>
              <p>Share battery flexibility while preserving your reserve.</p>
            </div>
            <Badge tone="info">Managed</Badge>
          </header>

          <label className="energy-toggle-row">
            <span>
              <strong>Allow community export</strong>
              <small>Only when price and self-sufficiency rules are satisfied.</small>
            </span>
            <input type="checkbox" checked={allowExport} onChange={(event) => setAllowExport(event.target.checked)} />
          </label>

          <div className="prosumer-segmented">
            {["comfort", "balanced", "savings"].map((item) => (
              <button
                key={item}
                type="button"
                className={priority === item ? "is-active" : ""}
                onClick={() => setPriority(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <dl className="energy-detail-list">
            <div>
              <dt>Current reserve</dt>
              <dd>65%</dd>
            </div>
            <div>
              <dt>Export cap</dt>
              <dd>2.3 kW</dd>
            </div>
            <div>
              <dt>Next action</dt>
              <dd>Charge from PV surplus</dd>
            </div>
          </dl>
        </article>

        <article className="prosumer-flex-summary panel">
          <header>
            <SlidersHorizontal size={20} />
            <h2>Optimization contract</h2>
          </header>
          <ul>
            <li><ShieldCheck size={15} /> Comfort limits are always enforced before community optimization.</li>
            <li><Clock size={15} /> Flexible actions are scheduled between 08:00 and 14:00.</li>
            <li><BatteryCharging size={15} /> Battery reserve never drops below {minSoc}%.</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
