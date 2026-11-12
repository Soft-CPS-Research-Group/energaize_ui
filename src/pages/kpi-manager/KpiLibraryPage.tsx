import { useId, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { kpiDisplayName, useKpiMetadata } from "../../hooks/useKpiMetadata";
import { KpiPageHeader } from "../../components/kpi/KpiPageHeader";
import { KpiError, KpiLoading } from "../../components/kpi/KpiStates";
import { KpiField, KpiFilterBar } from "../../components/kpi/KpiFilters";

const CATEGORY_LABELS: Record<string, string> = {
  energy: "Energy",
  economic: "Economic",
  equity: "Equity",
  ev: "EV & Comfort",
  carbon: "Carbon",
  quality: "Data quality",
};

export function KpiLibraryPage() {
  const ids = useId();
  const { kpis, loading, error } = useKpiMetadata();
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterType, setFilterType] = useState<"all" | "streaming" | "scheduled">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "available" | "pending">("all");

  const categories = Array.from(new Set(kpis.map((k) => k.category)));
  const query = search.trim().toLowerCase();

  const filtered = kpis.filter(kpi => {
    const haystack = `${kpi.name} ${kpi.display_name ?? ""} ${kpi.canonical_name ?? ""} ${kpi.description ?? ""}`.toLowerCase();
    return (!query || haystack.includes(query))
      && (filterCategory === "all" || kpi.category === filterCategory)
      && (filterType === "all" || kpi.type === filterType)
      && (filterStatus === "all" || kpi.status === filterStatus);
  });

  return (
    <div className="page">
      <KpiPageHeader
        title="Library"
        description="Every available KPI with its formula, unit and calculation window"
      />

      <KpiFilterBar ariaLabel="Library filters">
        <KpiField label="Search" icon={<Search size={14} />} size="lg" htmlFor={`${ids}-search`}>
          <input
            id={`${ids}-search`}
            type="search"
            placeholder="Name or description…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </KpiField>
        <KpiField label="Category" size="sm" htmlFor={`${ids}-cat`}>
          <select id={`${ids}-cat`} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
          </select>
        </KpiField>
        <KpiField label="Type" size="sm" htmlFor={`${ids}-type`}>
          <select id={`${ids}-type`} value={filterType} onChange={e => setFilterType(e.target.value as typeof filterType)}>
            <option value="all">All types</option>
            <option value="streaming">Streaming</option>
            <option value="scheduled">Scheduled</option>
          </select>
        </KpiField>
        <KpiField label="Status" size="sm" htmlFor={`${ids}-status`}>
          <select id={`${ids}-status`} value={filterStatus} onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}>
            <option value="all">All statuses</option>
            <option value="available">Available</option>
            <option value="pending">Pending</option>
          </select>
        </KpiField>
      </KpiFilterBar>

      {loading && <KpiLoading label="Loading KPI library…" />}
      {error && <KpiError message={error} />}

      {!loading && !error && (
        <section className="kpi-results" aria-label="KPIs">
          <p className="kpi-text-soft" role="status">{filtered.length} KPI{filtered.length !== 1 ? "s" : ""}</p>

          {filtered.length > 0 ? (
            <div className="kpi-library-grid">
              {filtered.map(kpi => (
                <article key={kpi.name} className={`kpi-library-card${kpi.status === "pending" ? " is-pending" : ""}`}>
                  <header>
                    <div className="kpi-library-title">
                      <h3>{kpiDisplayName(kpi, kpi.name)}</h3>
                      <code>{kpi.name}</code>
                    </div>
                    <div className="kpi-library-flags">
                      {kpi.status === "pending" && <Badge tone="warning">Pending</Badge>}
                      {!kpi.registered && kpi.status === "available" && <Badge tone="danger">Not registered</Badge>}
                    </div>
                  </header>
                  <ul className="kpi-library-tags" aria-label="Tags">
                    <li className="kpi-category" data-category={kpi.category}>{CATEGORY_LABELS[kpi.category] ?? kpi.category}</li>
                    <li>{kpi.type}</li>
                    {kpi.scope === "community_only" && <li>Community only</li>}
                  </ul>
                  {kpi.description ? <p className="kpi-library-desc">{kpi.description}</p> : null}
                  {kpi.formula ? (
                    <div className="kpi-library-formula">
                      <span>Formula</span>
                      <code>{kpi.formula}</code>
                    </div>
                  ) : null}
                  <dl className="kpi-library-facts">
                    <div><dt>Window</dt><dd>{kpi.window || "—"}</dd></div>
                    <div><dt>Unit</dt><dd>{kpi.unit || "—"}</dd></div>
                  </dl>
                  {kpi.pending_reason && <p className="kpi-library-note">Note: {kpi.pending_reason}</p>}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No KPIs found" message="Try another search or fewer filters." />
          )}
        </section>
      )}
    </div>
  );
}
