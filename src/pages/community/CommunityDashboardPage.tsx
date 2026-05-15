import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  Battery,
  CalendarClock,
  Car,
  Download,
  ExternalLink,
  Gauge,
  Leaf,
  RefreshCcw,
  Sun,
  Zap
} from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../contexts/AuthContext";
import { useUI } from "../../contexts/UIContext";
import type { EnergyEntity, EnergyRange, EnergySeriesPoint } from "../../data/energyCommunity";
import {
  buildEnergySeries,
  formatPower,
  getEnergyEntities,
  getEnergyEntity,
  getEntityKpis,
  getEntityLineage,
  getProsumerBuildingScopes
} from "../../data/energyCommunity";

const RANGE_OPTIONS: Array<{ id: EnergyRange; label: string }> = [
  { id: "live", label: "Live" },
  { id: "1h", label: "1h" },
  { id: "6h", label: "6h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" }
];

function entityIcon(entity: EnergyEntity): JSX.Element {
  if (entity.kind === "battery") return <Battery size={18} />;
  if (entity.kind === "ev") return <Car size={18} />;
  if (entity.kind === "pv" || entity.kind === "solar_plant") return <Sun size={18} />;
  if (entity.kind === "transformer") return <Zap size={18} />;
  return <Gauge size={18} />;
}

function EnergyTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="energy-chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={`${item.name}-${item.color}`}>
          <i style={{ background: item.color }} />
          {item.name}: {typeof item.value === "number" ? formatPower(item.value) : "-"}
        </span>
      ))}
    </div>
  );
}

function KpiCard({ kpi }: { kpi: ReturnType<typeof getEntityKpis>[number] }): JSX.Element {
  return (
    <article className={`energy-kpi-card is-${kpi.tone || "neutral"}`}>
      <span>{kpi.label}</span>
      <strong>{kpi.value}</strong>
      {kpi.detail ? <small>{kpi.detail}</small> : null}
    </article>
  );
}

function AssetCard({
  entity,
  selected,
  onSelect
}: {
  entity: EnergyEntity;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const kpis = getEntityKpis(entity, null);
  return (
    <button className={`energy-asset-card${selected ? " is-selected" : ""}`} type="button" onClick={onSelect}>
      <header>
        <span className="energy-asset-icon">{entityIcon(entity)}</span>
        <span>
          <strong>{entity.label}</strong>
          <small>{entity.serial || entity.capacity || entity.kind.replace("_", " ")}</small>
        </span>
        <Badge tone={entity.status === "warning" ? "warning" : entity.status === "offline" ? "danger" : "success"}>
          {entity.status}
        </Badge>
      </header>
      <dl>
        {kpis.slice(0, 3).map((kpi) => (
          <div key={kpi.id}>
            <dt>{kpi.label}</dt>
            <dd>{kpi.value}</dd>
          </div>
        ))}
      </dl>
    </button>
  );
}

function AssetDetail({ entity }: { entity: EnergyEntity }): JSX.Element {
  const kpis = getEntityKpis(entity, null);
  const progress =
    entity.kind === "battery" ? 65 : entity.kind === "ev" ? 78 : entity.kind === "pv" || entity.kind === "solar_plant" ? 92 : 72;

  return (
    <section className="energy-detail-card">
      <header>
        <div>
          <span className="section-kicker">Selected asset</span>
          <h2>{entity.label}</h2>
        </div>
        <span className="energy-asset-icon">{entityIcon(entity)}</span>
      </header>

      <div className="energy-progress-row">
        <strong>{progress}%</strong>
        <div className="energy-progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <dl className="energy-detail-list">
        {kpis.map((kpi) => (
          <div key={kpi.id}>
            <dt>{kpi.label}</dt>
            <dd>{kpi.value}</dd>
          </div>
        ))}
      </dl>

      {entity.kind === "ev" ? (
        <div className="energy-schedule-card">
          <span>Charging scheduled</span>
          <strong>08:00 - 14:00</strong>
          <div className="energy-schedule-track">
            <span style={{ left: "30%", width: "42%" }} />
          </div>
          <small>Reason: community peak avoidance</small>
        </div>
      ) : null}
    </section>
  );
}

export function CommunityDashboardPage(): JSX.Element {
  const { session } = useAuth();
  const { activeCommunity, selectedEntityId, setSelectedEntityId } = useUI();
  const [range, setRange] = useState<EnergyRange>("live");
  const isProsumer = session?.role === "prosumer";
  const prosumerScopes = useMemo(
    () => (isProsumer ? getProsumerBuildingScopes(activeCommunity) : []),
    [activeCommunity, isProsumer]
  );
  const effectiveSelectedEntityId =
    isProsumer && selectedEntityId === "community" && prosumerScopes[0]
      ? prosumerScopes[0].id
      : selectedEntityId;

  useEffect(() => {
    if (!isProsumer || selectedEntityId !== "community" || !prosumerScopes[0]) return;
    setSelectedEntityId(prosumerScopes[0].id);
  }, [isProsumer, prosumerScopes, selectedEntityId, setSelectedEntityId]);

  const entity = getEnergyEntity(activeCommunity, session?.role, effectiveSelectedEntityId);
  const entities = getEnergyEntities(activeCommunity, session?.role);
  const lineage = getEntityLineage(activeCommunity, session?.role, entity.id);
  const kpis = getEntityKpis(entity, session?.role);
  const series = useMemo(() => buildEnergySeries(entity, range), [entity, range]);
  const children = entities.filter((item) => item.parentId === entity.id && item.kind !== "group");
  const visibleAssets = children.length > 0
    ? children
    : entities.filter((item) => ["battery", "ev", "pv", "solar_plant", "transformer"].includes(item.kind)).slice(0, 6);
  const latest = series[series.length - 1] || series[0];
  const isAsset = ["battery", "ev", "pv", "solar_plant", "transformer"].includes(entity.kind);

  return (
    <div className="page energy-console-page">
      <header className="energy-page-head">
        <div>
          <span className="section-kicker">{isProsumer ? "Prosumer workspace" : "REC Manager workspace"}</span>
          <h1>Dashboard</h1>
          <p>
            {lineage.map((item) => item.label).join(" / ")}
          </p>
        </div>
        <div className="energy-head-actions">
          <Button variant="ghost" iconLeft={<Download size={15} />}>Export</Button>
          <Button variant="ghost" iconLeft={<ExternalLink size={15} />}>Open</Button>
          <Button variant="secondary" iconLeft={<RefreshCcw size={15} />}>Refresh</Button>
        </div>
      </header>

      <section className="energy-timebar">
        <div className="energy-segments" role="group" aria-label="Time range">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={range === option.id ? "is-active" : ""}
              onClick={() => setRange(option.id)}
            >
              {option.id === "live" ? <Zap size={14} /> : null}
              {option.label}
            </button>
          ))}
        </div>
        <button className="energy-range-btn" type="button">
          <CalendarClock size={15} />
          Custom range
        </button>
        <small>Last update: a few seconds ago</small>
      </section>

      <section className="energy-kpi-grid">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.id} kpi={kpi} />
        ))}
        <article className="energy-price-card">
          <span>Avg. Price</span>
          <strong>{latest ? latest.price.toFixed(3) : "0.124"} EUR/kWh</strong>
          <ResponsiveContainer width="100%" height={44}>
            <AreaChart data={series.slice(-18)}>
              <Area type="monotone" dataKey="price" stroke="#d6a21d" fill="rgba(214,162,29,0.18)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </article>
      </section>

      <section className="energy-main-chart panel">
        <header>
          <div>
            <h2>{entity.label} energy flow</h2>
            <p>{range === "live" ? "Streaming live window" : "Historical view"} with automatic aggregation.</p>
          </div>
          {range === "live" ? <Badge tone="success">Live</Badge> : <Badge tone="info">{range}</Badge>}
        </header>

        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={series as EnergySeriesPoint[]} margin={{ top: 12, right: 18, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="var(--text-soft)" tickLine={false} axisLine={false} />
            <YAxis stroke="var(--text-soft)" tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
            <Tooltip content={<EnergyTooltip />} />
            <Legend />
            <Area
              name="Production"
              type="monotone"
              dataKey="production"
              stroke="#18a56f"
              fill="rgba(24,165,111,0.18)"
              strokeWidth={2.5}
            />
            <Line name="Consumption" type="monotone" dataKey="consumption" stroke="#ef4444" strokeWidth={2.2} dot={false} />
            <Line name="Grid Import" type="monotone" dataKey="importKw" stroke="#2d90d7" strokeWidth={2} dot={false} />
            <Line
              name="Grid Export"
              type="monotone"
              dataKey="exportKw"
              stroke="#51c878"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </section>

      {isProsumer ? (
        <section className="energy-status-strip">
          <Leaf size={18} />
          <strong>Currently self-sufficient</strong>
          <span>House 1 is covering local demand with PV and battery support.</span>
        </section>
      ) : null}

      <section className="energy-lower-grid">
        <article className="energy-mini-panel">
          <h2>Autonomy</h2>
          <div className="energy-ring" style={{ "--value": "72%" } as CSSProperties}>
            <strong>72%</strong>
          </div>
        </article>
        <article className="energy-mini-panel">
          <h2>Self-consumption</h2>
          <strong className="energy-large-number">86%</strong>
          <div className="energy-progress-track">
            <span style={{ width: "86%" }} />
          </div>
        </article>
        <article className="energy-mini-panel">
          <h2>CO2 Saved</h2>
          <strong className="energy-large-number">3.19 t</strong>
          <Leaf className="energy-soft-icon" size={46} />
        </article>
        <article className="energy-mini-panel">
          <h2>Power Balance</h2>
          <ResponsiveContainer width="100%" height={112}>
            <BarChart data={[{ name: "Cons.", value: latest?.consumption || 0 }, { name: "Prod.", value: latest?.production || 0 }, { name: "Import", value: latest?.importKw || 0 }, { name: "Export", value: latest?.exportKw || 0 }]}>
              <XAxis dataKey="name" stroke="var(--text-soft)" tickLine={false} axisLine={false} />
              <Bar dataKey="value" fill="#18a56f" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>
      </section>

      <section className="energy-entity-grid">
        <div className="energy-section-head">
          <div>
            <span className="section-kicker">Entity context</span>
            <h2>{isAsset ? "Related assets" : "Assets and child entities"}</h2>
          </div>
          <small>{visibleAssets.length} visible</small>
        </div>
        <div className="energy-assets-grid">
          {visibleAssets.map((item) => (
            <AssetCard
              key={item.id}
              entity={item}
              selected={item.id === entity.id}
              onSelect={() => setSelectedEntityId(item.id)}
            />
          ))}
        </div>
      </section>

      {isAsset ? <AssetDetail entity={entity} /> : null}
    </div>
  );
}
