import { useNavigate } from 'react-router-dom';
import { useState, useMemo } from "react";
import { Button } from "../../components/ui/Button";
import { useCommunities } from "../../hooks/useCommunities";
import { useKpiMetadata, type KpiMeta } from "../../hooks/useKpiMetadata";
import {  Card, CardContent, CardHeader, CardTitle  } from "../../components/ui/KpiCard";
import {
  Building2, ChevronRight, ChevronDown, Network,
  Zap, DollarSign, Leaf, Car, Scale, Activity,
  Loader2, AlertCircle, ExternalLink,
} from "lucide-react";

// ── Category metadata ──────────────────────────────────────────────────────

const CATEGORY_META: Record<string, {
  label: string;
  icon: React.ReactNode;
  color: string;
  borderColor: string;
}> = {
  energy:   { label: "Energy Grid",  icon: <Zap size={16} />,         color: "#2563eb",   borderColor: "#bfdbfe" },
  economic: { label: "Cost",         icon: <DollarSign size={16} />,  color: "#16a34a",  borderColor: "#bbf7d0" },
  equity:   { label: "Equity",       icon: <Scale size={16} />,        color: "#9333ea", borderColor: "#e9d5ff" },
  ev:       { label: "EV & Comfort", icon: <Car size={16} />,          color: "#ea580c", borderColor: "#fed7aa" },
  carbon:   { label: "Emissions",    icon: <Leaf size={16} />,         color: "#0d9488",   borderColor: "#99f6e4" },
};

// ── KPI detail card ────────────────────────────────────────────────────────

function KpiDetailCard({
  kpi,
  onOpenDashboard,
}: {
  kpi: KpiMeta;
  onOpenDashboard: (kpiName: string) => void;
}) {
  const catMeta = CATEGORY_META[kpi.category] ?? {
    label: kpi.category,
    icon: <Activity size={16} />,
    color: "var(--text-soft)",
    borderColor: "var(--line)",
  };
  return (
    <Card style={{ borderLeft: `4px solid ${catMeta.borderColor}`, transition: "box-shadow 0.2s" }} className="hover:shadow-md">
      <CardHeader style={{ paddingBottom: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
          <div>
            <CardTitle style={{ fontSize: "0.875rem", fontFamily: "monospace" }}>{kpi.name}</CardTitle>
            {kpi.canonical_name && (
              <p style={{ fontSize: "10px", color: "var(--text-soft)", fontFamily: "monospace", marginTop: "0.125rem" }}>{kpi.canonical_name}</p>
            )}
            <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", marginTop: "0.25rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 500, color: catMeta.color }}>
                {catMeta.label}
              </span>
              <span style={{ color: "var(--line)" }}>·</span>
              <span style={{ fontSize: "0.875rem", color: "var(--text-soft)" }}>{kpi.type}</span>
              {kpi.status === "pending" && (
                <span style={{ fontSize: "0.75rem", backgroundColor: "#fffbeb", color: "#b45309", border: "1px solid #fde68a", padding: "0.125rem 0.375rem", borderRadius: "9999px", marginLeft: "0.25rem" }}>
                  Pending
                </span>
              )}
            </div>
          </div>
          <Button
            onClick={() => onOpenDashboard(kpi.name)}
            disabled={kpi.status === "pending" || !kpi.registered}
            title="Open in Dashboard"
            variant="ghost"
            size="sm"
            iconLeft={<ExternalLink size={12} />}
          >
            Dashboard
          </Button>
        </div>
      </CardHeader>
      <CardContent style={{ fontSize: "0.875rem", color: "var(--text-soft)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {kpi.description && <p style={{ fontSize: "0.875rem", color: "var(--text-soft)" }}>{kpi.description}</p>}
        <div style={{ backgroundColor: "var(--bg)", borderRadius: "0.5rem", padding: "0.625rem", border: "1px solid #f3f4f6" }}>
          <p style={{ fontSize: "10px", color: "var(--text-soft)", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.025em" }}>Formula</p>
          <code style={{ fontSize: "0.75rem", color: "var(--text)", fontFamily: "monospace", lineHeight: "1.625", whiteSpace: "pre-wrap" }}>{kpi.formula || "—"}</code>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", fontSize: "0.875rem", color: "var(--text-soft)" }}>
          <span><span style={{ fontWeight: 500, color: "var(--text)" }}>Window:</span> {kpi.window}</span>
          <span><span style={{ fontWeight: 500, color: "var(--text)" }}>Unit:</span> {kpi.unit || "—"}</span>
          <span><span style={{ fontWeight: 500, color: "var(--text)" }}>Level:</span> {kpi.level}</span>
        </div>
        {kpi.pending_reason && (
          <p style={{ fontSize: "0.75rem", color: "#b45309", backgroundColor: "#fffbeb", border: "1px solid #fef3c7", borderRadius: "0.25rem", padding: "0.375rem 0.5rem" }}>
            {kpi.pending_reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Family accordion ───────────────────────────────────────────────────────

function KpiFamilyAccordion({
  category,
  kpis,
  onOpenDashboard,
}: {
  category: string;
  kpis: KpiMeta[];
  onOpenDashboard: (kpiName: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const meta = CATEGORY_META[category] ?? {
    label: category,
    icon: <Activity size={16} />,
    color: "var(--text-soft)",
    borderColor: "var(--line)",
  };
  const availableCount = kpis.filter((k: any) => k.registered && k.status === "available").length;

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.75rem", overflow: "hidden", backgroundColor: "var(--bg-elev)", boxShadow: "var(--shadow)" }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1rem",
          cursor: "pointer",
          backgroundColor: "transparent",
          border: "none",
          textAlign: "left",
          borderBottom: "1px solid #f3f4f6",
          transition: "background-color 0.2s"
        }}
        className="hover:bg-gray-50"
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ color: meta.color }}>{meta.icon}</span>
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: "0.875rem" }}>{meta.label}</span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-soft)", backgroundColor: "var(--bg)", padding: "0.125rem 0.5rem", borderRadius: "9999px" }}>
            {availableCount}/{kpis.length} available
          </span>
        </div>
        {expanded
          ? <ChevronDown size={16} style={{ color: "var(--text-soft)" }} />
          : <ChevronRight size={16} style={{ color: "var(--text-soft)" }} />}
      </button>
      {expanded && (
        <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {kpis.map(kpi => (
            <KpiDetailCard
              key={kpi.name}
              kpi={kpi}
              onOpenDashboard={onOpenDashboard}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tree node type ─────────────────────────────────────────────────────────

type TreeNodeId =
  | { type: "community"; id: string }
  | { type: "building"; community: string; id: string };

// ── Main page ──────────────────────────────────────────────────────────────



export function KpiExplorer() {
  const navigate = useNavigate();
  const { communities, loading: commLoading, error: commError } = useCommunities();
  const { kpis: allKpis, loading: kpiLoading }                  = useKpiMetadata();

  const [selectedNode, setSelectedNode] = useState<TreeNodeId | null>(null);
  const [expandedCommunities, setExpandedCommunities] = useState<Set<string>>(new Set());

  const toggleCommunity = (id: string) => {
    setExpandedCommunities(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // KPIs for the right panel, filtered by selected node level
  const panelKpis = useMemo(() => {
    if (!selectedNode) return [];
    if (selectedNode.type === "community") {
      return allKpis.filter((k: any) => k.level === "community" || k.level === "both");
    }
    return allKpis.filter((k: any) => k.level === "building" || k.level === "both");
  }, [selectedNode, allKpis]);

  // Group panel KPIs by category
  const kpisByCategory = useMemo(() => {
    const map: Record<string, KpiMeta[]> = {};
    for (const kpi of panelKpis) {
      (map[kpi.category] ??= []).push(kpi);
    }
    return map;
  }, [panelKpis]);

  const categoryOrder = ["economic", "energy", "ev", "equity", "carbon"];
  const sortedCategories = Object.keys(kpisByCategory).sort(
    (a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b)
  );

  const handleOpenDashboard = (kpiName: string) => {
    navigate('/app/kpi-manager/dashboard', { state: { preselectedKpi: kpiName } });
  };

  const isLoading = commLoading || kpiLoading;

  const panelTitle = selectedNode
    ? selectedNode.type === "community"
      ? `${selectedNode.id} — Community KPIs`
      : `${selectedNode.id}`
    : "Select a node to explore KPIs";

  const panelSubtitle = selectedNode
    ? selectedNode.type === "community"
      ? "KPIs computed at community (district) level"
      : `Building-level KPIs for ${selectedNode.id} in ${(selectedNode as any).community}`
    : "Choose a community or building from the left panel";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }} className="page">
      {/* Header */}
      <header className="jobs-hero">
        <div>
          <h1>KPI Explorer</h1>
          <p>Browse communities, buildings, and their available KPI families</p>
        </div>
      </header>

      {isLoading && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", color: "var(--text-soft)", padding: "2rem", justifyContent: "center" }}>
          <Loader2 className="animate-spin" size={24} />
          <span>Loading explorer...</span>
        </div>
      )}

      {commError && (
        <div style={{ margin: "1.5rem", display: "flex", alignItems: "flex-start", gap: "0.75rem", backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", padding: "1rem", borderRadius: "0.5rem" }}>
          <AlertCircle size={20} style={{ flexShrink: 0, marginTop: "0.125rem" }} />
          <p style={{ fontSize: "0.875rem", margin: 0 }}>{commError}</p>
        </div>
      )}

      {!isLoading && !commError && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* ── Left Tree Panel ──────────────────────────────────────────── */}
          <aside style={{ width: "16rem", flexShrink: 0, borderRight: "1px solid #e5e7eb", backgroundColor: "var(--bg-elev)", overflowY: "auto" }}>
            <div style={{ padding: "0.75rem" }}>
              <p style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.1em", padding: "0.25rem 0.5rem", margin: 0 }}>
                Communities
              </p>
              {Object.entries(communities).map(([community, buildings]) => {
                const isExpanded = expandedCommunities.has(community);
                const isCommunitySelected =
                  selectedNode?.type === "community" && selectedNode.id === community;

                return (
                  <div key={community}>
                    {/* Community node */}
                    <div style={{ display: "flex", alignItems: "center" }} className="group">
                      <button
                        onClick={() => toggleCommunity(community)}
                        style={{ padding: "0.25rem", color: "var(--text-soft)", flexShrink: 0, background: "transparent", border: "none", cursor: "pointer" }}
                      >
                        {isExpanded
                          ? <ChevronDown size={14} />
                          : <ChevronRight size={14} />}
                      </button>
                      <button
                        onClick={() => setSelectedNode({ type: "community", id: community })}
                        style={{
                          flex: 1, display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.375rem 0.5rem", borderRadius: "0.5rem", fontSize: "0.875rem", fontWeight: 500, textAlign: "left", transition: "background-color 0.2s",
                          backgroundColor: isCommunitySelected ? "#eff6ff" : "transparent",
                          color: isCommunitySelected ? "#1d4ed8" : "var(--text)", margin: 0, border: "none", cursor: "pointer"
                        }}
                      >
                        <Network style={{
                          width: "1rem", height: "1rem", flexShrink: 0,
                          color: isCommunitySelected ? "#3b82f6" : "var(--text-soft)"
                        }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{community.replace(/_/g, " ")}</span>
                      </button>
                    </div>

                    {/* Building nodes */}
                    {isExpanded && (
                        <div style={{ marginLeft: "1.25rem", borderLeft: "1px solid var(--line)", paddingLeft: "0.5rem", display: "flex", flexDirection: "column", gap: "0.125rem", marginBottom: "0.25rem" }}>
                        {buildings.map((building: any) => {
                          const isBuildingSelected =
                            selectedNode?.type === "building" &&
                            selectedNode.id === building &&
                            (selectedNode as any).community === community;
                          return (
                            <button
                              key={building}
                              onClick={() =>
                                setSelectedNode({ type: "building", community, id: building })
                              }
                              style={{
                                display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.375rem 0.5rem", borderRadius: "0.5rem", fontSize: "0.75rem", fontWeight: 500, textAlign: "left", transition: "background-color 0.2s",
                                backgroundColor: isBuildingSelected ? "#eff6ff" : "transparent", border: "none", cursor: "pointer",
                                color: isBuildingSelected ? "#1d4ed8" : "var(--text-soft)"
                              }}
                            >
                              <Building2 style={{
                                width: "0.875rem", height: "0.875rem", flexShrink: 0,
                                color: isBuildingSelected ? "#3b82f6" : "var(--text-soft)"
                              }} />
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{building.replace("building_", "")}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* ── Right Content Panel ──────────────────────────────────────── */}
          <main style={{ flex: 1, overflowY: "auto", padding: "1.5rem", backgroundColor: "var(--bg)" }}>
            {/* Panel header */}
            <div style={{ marginBottom: "1.25rem" }}>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text)", margin: 0 }}>{panelTitle}</h2>
              <p style={{ fontSize: "0.875rem", color: "var(--text-soft)", marginTop: "0.125rem", margin: 0 }}>{panelSubtitle}</p>
            </div>

            {!selectedNode && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4rem", backgroundColor: "var(--bg-elev)", borderRadius: "0.75rem", border: "1px dashed #d1d5db", color: "var(--text-soft)" }}>
                <Network size={48} style={{ marginBottom: "1rem", color: "var(--line)" }} />
                <p style={{ fontWeight: 500, color: "var(--text-soft)", margin: 0 }}>Click a community or building</p>
                <p style={{ fontSize: "0.875rem", marginTop: "0.25rem", textAlign: "center", maxWidth: "20rem", margin: 0 }}>
                  The right panel will show all KPI families and their individual KPIs available at that level.
                </p>
              </div>
            )}

            {selectedNode && panelKpis.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem", color: "var(--text-soft)" }}>
                <Activity size={40} style={{ marginBottom: "0.75rem", color: "var(--line)" }} />
                <p style={{ fontSize: "0.875rem", margin: 0 }}>No KPIs available for this node.</p>
              </div>
            )}

            {selectedNode && sortedCategories.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {sortedCategories.map(category => (
                  <KpiFamilyAccordion
                    key={category}
                    category={category}
                    kpis={kpisByCategory[category]}
                    onOpenDashboard={handleOpenDashboard}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
