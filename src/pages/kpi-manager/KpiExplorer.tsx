import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, Building2, Car, ChevronDown, ChevronRight, DollarSign,
  ExternalLink, Gauge, Leaf, Network, Scale, Zap,
} from "lucide-react";
import { KPI_BASE } from "./kpiSections";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { useCommunities } from "../../hooks/useCommunities";
import { kpiDisplayName, useKpiMetadata, type KpiMeta } from "../../hooks/useKpiMetadata";
import { KpiPageHeader } from "../../components/kpi/KpiPageHeader";
import { KpiError, KpiLoading } from "../../components/kpi/KpiStates";
import { communityLabel } from "../../components/kpi/KpiFilters";

const CATEGORY_META: Record<string, { label: string; icon: ReactNode }> = {
  economic: { label: "Cost", icon: <DollarSign size={16} /> },
  energy: { label: "Energy grid", icon: <Zap size={16} /> },
  ev: { label: "EV & Comfort", icon: <Car size={16} /> },
  equity: { label: "Equity", icon: <Scale size={16} /> },
  carbon: { label: "Emissions", icon: <Leaf size={16} /> },
  quality: { label: "Data quality", icon: <Gauge size={16} /> },
};
const CATEGORY_ORDER = Object.keys(CATEGORY_META);

function categoryMeta(category: string) {
  return CATEGORY_META[category] ?? { label: category, icon: <Activity size={16} /> };
}

type TreeNode =
  | { type: "community"; id: string }
  | { type: "building"; community: string; id: string };

function sameNode(a: TreeNode | null, b: TreeNode): boolean {
  return !!a && a.type === b.type && a.id === b.id
    && (a.type === "community" || (b.type === "building" && a.community === b.community));
}

function KpiDetailCard({ kpi, onOpenDashboard }: { kpi: KpiMeta; onOpenDashboard: (kpiName: string) => void }) {
  return (
    <article className={`kpi-library-card${kpi.status === "pending" ? " is-pending" : ""}`}>
      <header>
        <div className="kpi-library-title">
          <h4>{kpiDisplayName(kpi, kpi.name)}</h4>
          <code>{kpi.name}</code>
        </div>
        <Button
          onClick={() => onOpenDashboard(kpi.name)}
          disabled={kpi.status === "pending" || !kpi.registered}
          variant="ghost"
          size="sm"
          iconLeft={<ExternalLink size={12} />}
          aria-label={`Open ${kpiDisplayName(kpi, kpi.name)} in Overview`}
        >
          Overview
        </Button>
      </header>
      <ul className="kpi-library-tags" aria-label="Tags">
        <li>{kpi.type}</li>
        {kpi.status === "pending" && <li><Badge tone="warning">Pending</Badge></li>}
      </ul>
      {kpi.description ? <p className="kpi-library-desc">{kpi.description}</p> : null}
      <div className="kpi-library-formula">
        <span>Formula</span>
        <code>{kpi.formula || "—"}</code>
      </div>
      <dl className="kpi-library-facts">
        <div><dt>Window</dt><dd>{kpi.window || "—"}</dd></div>
        <div><dt>Unit</dt><dd>{kpi.unit || "—"}</dd></div>
        <div><dt>Level</dt><dd>{kpi.level}</dd></div>
      </dl>
      {kpi.pending_reason && <p className="kpi-library-note">{kpi.pending_reason}</p>}
    </article>
  );
}

function KpiFamily({ category, kpis, onOpenDashboard }: {
  category: string;
  kpis: KpiMeta[];
  onOpenDashboard: (kpiName: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const meta = categoryMeta(category);
  const available = kpis.filter(k => k.registered && k.status === "available").length;
  const panelId = `kpi-family-${category}`;

  return (
    <section className="kpi-family" data-category={category}>
      <button type="button" className="kpi-family-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(e => !e)}>
        <span className="kpi-family-icon" aria-hidden="true">{meta.icon}</span>
        <span className="kpi-family-label">{meta.label}</span>
        <span className="kpi-family-count">{available}/{kpis.length} available</span>
        {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      </button>
      {expanded && (
        <div id={panelId} className="kpi-library-grid">
          {kpis.map(kpi => <KpiDetailCard key={kpi.name} kpi={kpi} onOpenDashboard={onOpenDashboard} />)}
        </div>
      )}
    </section>
  );
}

export function KpiExplorer() {
  const navigate = useNavigate();
  const { communities, loading: commLoading, error: commError } = useCommunities();
  const { kpis: allKpis, loading: kpiLoading, error: kpiError } = useKpiMetadata();

  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleCommunity = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const kpisByCategory = useMemo(() => {
    if (!selected) return [];
    const levels = selected.type === "community" ? ["community", "both"] : ["building", "both"];
    const map: Record<string, KpiMeta[]> = {};
    for (const kpi of allKpis) {
      if (levels.includes(kpi.level)) (map[kpi.category] ??= []).push(kpi);
    }
    const rank = (c: string) => (CATEGORY_ORDER.indexOf(c) + CATEGORY_ORDER.length + 1) % (CATEGORY_ORDER.length + 1);
    return Object.entries(map).sort(([a], [b]) => rank(a) - rank(b));
  }, [selected, allKpis]);

  const openInOverview = (kpiName: string) => {
    navigate(`${KPI_BASE}/overview`, { state: { preselectedKpi: kpiName } });
  };

  const error = commError ?? kpiError;

  return (
    <div className="page">
      <KpiPageHeader
        title="Explorer"
        description="Browse communities, buildings and the KPI families available for each"
      />

      {(commLoading || kpiLoading) && <KpiLoading label="Loading explorer…" />}
      {error && <KpiError message={error} />}

      {!commLoading && !kpiLoading && !error && (
        <div className="kpi-explorer">
          <nav className="kpi-explorer-tree" aria-label="Communities and buildings">
            <p className="kpi-explorer-eyebrow">Communities</p>
            <ul>
              {Object.entries(communities).map(([community, buildings]) => {
                const isOpen = expanded.has(community);
                const node: TreeNode = { type: "community", id: community };
                return (
                  <li key={community}>
                    <div className="kpi-explorer-row">
                      <button
                        type="button"
                        className="kpi-explorer-caret"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Collapse" : "Expand"} ${communityLabel(community)}`}
                        onClick={() => toggleCommunity(community)}
                      >
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <button
                        type="button"
                        className="kpi-explorer-node"
                        aria-pressed={sameNode(selected, node)}
                        onClick={() => setSelected(node)}
                      >
                        <Network size={15} aria-hidden="true" />
                        <span>{communityLabel(community)}</span>
                      </button>
                    </div>
                    {isOpen && (
                      <ul className="kpi-explorer-buildings">
                        {buildings.map(building => {
                          const bNode: TreeNode = { type: "building", community, id: building };
                          return (
                            <li key={building}>
                              <button
                                type="button"
                                className="kpi-explorer-node"
                                aria-pressed={sameNode(selected, bNode)}
                                onClick={() => setSelected(bNode)}
                              >
                                <Building2 size={14} aria-hidden="true" />
                                <span>{building.replace("building_", "")}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>

          <section className="kpi-explorer-panel" aria-live="polite">
            {!selected ? (
              <EmptyState
                title="Pick a community or building"
                message="Its KPI families and the KPIs in each will show here."
              />
            ) : (
              <>
                <header className="kpi-explorer-heading">
                  <h2>{selected.type === "community" ? `${communityLabel(selected.id)} — community KPIs` : selected.id.replace("building_", "")}</h2>
                  <p>
                    {selected.type === "community"
                      ? "KPIs computed for the whole community"
                      : `Building-level KPIs in ${communityLabel(selected.community)}`}
                  </p>
                </header>
                {kpisByCategory.length === 0 ? (
                  <EmptyState title="No KPIs" message="No KPIs are available at this level." />
                ) : (
                  kpisByCategory.map(([category, kpis]) => (
                    <KpiFamily key={category} category={category} kpis={kpis} onOpenDashboard={openInOverview} />
                  ))
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
