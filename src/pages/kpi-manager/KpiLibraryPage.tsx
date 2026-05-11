import { useState, useEffect } from "react";
import { BookOpen, Search, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/KpiCard";
import { api as axios } from "../../api/kpiApi";

interface KpiEntry {
  name: string;
  canonical_name?: string;
  category: "energy" | "economic" | "equity" | "ev" | "carbon";
  type: "streaming" | "scheduled";
  window: string;
  unit: string;
  description: string;
  formula: string;
  status: "available" | "pending";
  registered: boolean;
  pending_reason?: string;
  scope?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  energy: "Energy",
  economic: "Economic",
  equity: "Equity",
  ev: "EV & Comfort",
  carbon: "Carbon",
};

const CATEGORY_COLORS: Record<string, any> = {
  energy:   { bg: "rgba(59, 130, 246, 0.1)", text: "#3b82f6", border: "rgba(59, 130, 246, 0.2)" },
  economic: { bg: "rgba(34, 197, 94, 0.1)", text: "#22c55e", border: "rgba(34, 197, 94, 0.2)" },
  equity:   { bg: "rgba(168, 85, 247, 0.1)", text: "#a855f7", border: "rgba(168, 85, 247, 0.2)" },
  ev:       { bg: "rgba(249, 115, 22, 0.1)", text: "#f97316", border: "rgba(249, 115, 22, 0.2)" },
  carbon:   { bg: "rgba(20, 184, 166, 0.1)", text: "#14b8a6", border: "rgba(20, 184, 166, 0.2)" },
};

export function KpiLibraryPage() {
  const [kpis, setKpis] = useState<KpiEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterType, setFilterType] = useState<"all" | "streaming" | "scheduled">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "available" | "pending">("all");

  useEffect(() => {
    axios.get<{ status: string; data: KpiEntry[] }>("api/v1/kpis/metadata")
      .then((res: any) => {
        if (res?.data?.data && Array.isArray(res.data.data)) {
          setKpis(res.data.data);
        } else {
          console.warn("Unexpected metadata format in Library:", res.data);
          setKpis([]);
        }
      })
      .catch((err: any) => setError(err?.message || "Failed to load KPI metadata"))
      .finally(() => setLoading(false));
  }, []);

  const categories = Array.from(new Set(kpis?.map((k: any) => k.category) || []));

  const filtered = (kpis || []).filter(kpi => {
    const matchSearch = kpi.name.toLowerCase().includes(search.toLowerCase()) ||
                        kpi.description.toLowerCase().includes(search.toLowerCase());
    const matchCategory = filterCategory === "all" || kpi.category === filterCategory;
    const matchType = filterType === "all" || kpi.type === filterType;
    const matchStatus = filterStatus === "all" || kpi.status === filterStatus;
    return matchSearch && matchCategory && matchType && matchStatus;
  });

  const selectStyle = {
    padding: "0.5rem 1rem",
    borderRadius: "0.375rem",
    border: "1px solid var(--line)",
    backgroundColor: "var(--bg)",
    color: "var(--text)",
    outline: "none",
    minWidth: "150px"
  };

  const labelStyle = {
    display: "block",
    fontSize: "0.875rem",
    fontWeight: 500,
    color: "var(--text-soft)",
    marginBottom: "0.25rem"
  };

  return (
    <div className="page" style={{ height: "100%", overflowY: "auto", paddingBottom: 0 }}>
      <header className="jobs-hero">
        <div>
          <h1>KPI Library</h1>
          <p>All available KPIs with formulas and metadata</p>
        </div>
      </header>

      <div className="page-content" style={{ display: "flex", flexDirection: "column", gap: "1.5rem", padding: "1.5rem 1.5rem 0 1.5rem" }}>
        
        {/* Filters */}
        <div style={{ 
            display: "flex", 
            flexWrap: "wrap", 
            gap: "1.5rem", 
            alignItems: "flex-end",
            backgroundColor: "var(--bg-elev)",
            padding: "1.5rem",
            borderRadius: "0.5rem",
            border: "1px solid var(--line)",
            boxShadow: "var(--shadow)"
        }}>
          <div style={{ flex: "1 1 250px" }}>
            <label style={labelStyle}>Search</label>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <Search style={{ position: "absolute", left: "0.75rem", color: "var(--text-soft)" }} size={16} />
              <input
                type="text"
                placeholder="Search KPIs by name or description..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 1rem 0.5rem 2.25rem",
                  borderRadius: "0.375rem",
                  border: "1px solid var(--line)",
                  backgroundColor: "var(--bg)",
                  color: "var(--text)",
                  outline: "none",
                  boxSizing: "border-box"
                }}
              />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={selectStyle}>
              <option value="all">All categories</option>
              {categories.map(c => (
                <option key={c as string} value={c as string}>{CATEGORY_LABELS[c as string] ?? c}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select value={filterType} onChange={e => setFilterType(e.target.value as any)} style={selectStyle}>
              <option value="all">All types</option>
              <option value="streaming">Streaming</option>
              <option value="scheduled">Scheduled</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} style={selectStyle}>
              <option value="all">All statuses</option>
              <option value="available">Available</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--text)", margin: 0 }}>Results</h2>
            {!loading && (
            <p style={{ color: "var(--text-soft)", fontSize: "0.875rem", margin: 0 }}>
                {filtered.length} KPI{filtered.length !== 1 ? "s" : ""}
            </p>
            )}
        </div>

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4rem", color: "var(--text-soft)", gap: "1rem" }}>
            <Loader2 size={32} />
            <span>Loading KPI library...</span>
          </div>
        )}

        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "1rem", backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444", borderRadius: "0.375rem", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
            <AlertCircle size={20} />
            <p style={{ margin: 0 }}>{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.5rem" }}>
            {filtered.map(kpi => {
              const colorInfo = CATEGORY_COLORS[kpi.category] || { bg: "var(--bg)", text: "var(--text-soft)", border: "var(--line)" };
              
              return (
              <Card key={kpi.name} className="panel" style={{ display: "flex", flexDirection: "column", minWidth: 0, opacity: kpi.status === "pending" ? 0.6 : 1, transition: "transform 0.2s, box-shadow 0.2s" }}>
                <CardHeader style={{ padding: "1.25rem", borderBottom: `1px solid var(--line)`, backgroundColor: "var(--bg-elev)", minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "0.75rem", minWidth: 0 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <CardTitle style={{ margin: "0 0 0.25rem 0", fontSize: "1.125rem", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kpi.name}</CardTitle>
                        {kpi.canonical_name && (
                            <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kpi.canonical_name}</p>
                        )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: "flex-end" }}>
                      {kpi.status === "pending" && (
                        <span style={{ fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", backgroundColor: "rgba(245, 158, 11, 0.1)", color: "#f59e0b", border: "1px solid rgba(245, 158, 11, 0.2)" }}>
                          Pending
                        </span>
                      )}
                      {!kpi.registered && kpi.status === "available" && (
                        <span style={{ fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "9999px", backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                          Not registered
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", minWidth: 0 }}>
                    <span style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem", borderRadius: "9999px", backgroundColor: colorInfo.bg, border: `1px solid ${colorInfo.border}`, color: colorInfo.text, fontWeight: 500, whiteSpace: "nowrap" }}>
                      {CATEGORY_LABELS[kpi.category] ?? kpi.category}
                    </span>
                    <span style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem", borderRadius: "9999px", backgroundColor: "var(--bg)", border: "1px solid var(--line)", color: "var(--text-soft)", fontWeight: 500, whiteSpace: "nowrap" }}>
                      {kpi.type}
                    </span>
                    {kpi.scope === "community_only" && (
                      <span style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem", borderRadius: "9999px", backgroundColor: "var(--bg)", border: "1px solid var(--line)", color: "var(--text-soft)", fontWeight: 500, whiteSpace: "nowrap" }}>
                        Community Only
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent style={{ padding: "1.25rem", flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <p style={{ margin: "0 0 1.25rem 0", fontSize: "0.875rem", color: "var(--text)", lineHeight: 1.5, flex: 1, wordBreak: "break-word" }}>{kpi.description}</p>
                  
                  <div style={{ backgroundColor: "var(--bg)", borderRadius: "0.375rem", border: "1px solid var(--line)", padding: "0.75rem", marginBottom: "1.25rem", overflowX: "hidden", minWidth: 0 }}>
                    <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Formula</p>
                    <code style={{ display: "block", fontSize: "0.875rem", color: "var(--text)", wordBreak: "break-all", whiteSpace: "pre-wrap", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{kpi.formula}</code>
                  </div>
                  
                  <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.875rem", color: "var(--text-soft)", borderTop: "1px solid var(--line)", paddingTop: "1rem", flexWrap: "wrap", minWidth: 0 }}>
                    <span style={{ flex: "1 1 100px", wordBreak: "break-word" }}><span style={{ fontWeight: 500, color: "var(--text)" }}>Window:</span> {kpi.window}</span>
                    <span style={{ flex: "1 1 100px", wordBreak: "break-word" }}><span style={{ fontWeight: 500, color: "var(--text)" }}>Unit:</span> {kpi.unit}</span>
                  </div>
                  {kpi.pending_reason && (
                    <p style={{ margin: "1rem 0 0 0", fontSize: "0.875rem", color: "#f59e0b", fontStyle: "italic", backgroundColor: "rgba(245, 158, 11, 0.05)", padding: "0.5rem", borderRadius: "0.25rem", borderLeft: "2px solid #f59e0b" }}>
                      Note: {kpi.pending_reason}
                    </p>
                  )}
                </CardContent>
              </Card>
            )})}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4rem", color: "var(--text-soft)", gap: "0.5rem", backgroundColor: "var(--bg-elev)", borderRadius: "0.5rem", border: "1px dashed var(--line)" }}>
            <BookOpen size={48} style={{ color: "var(--line)", marginBottom: "0.5rem" }} />
            <p style={{ fontSize: "1.125rem", fontWeight: 500, color: "var(--text)", margin: 0 }}>No KPIs found</p>
            <p style={{ margin: 0 }}>Try adjusting your search or filters.</p>
          </div>
        )}
      </div>
    </div>
  );
}
