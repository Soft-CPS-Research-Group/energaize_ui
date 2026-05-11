import { useState } from "react";
import { fetchDataProfile } from "../../api/kpiApi";
import type { BuildingProfile } from "../../api/kpiApi";
import { Button } from "../../components/ui/Button";
import { MultiSelect } from "../../components/ui/MultiSelect";
import { useCommunities } from "../../hooks/useCommunities";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";
import {
  MapPin, Building2, Calendar, Search, Loader2,
  AlertCircle, ShieldCheck, ShieldAlert, ShieldX,
  CheckCircle2, XCircle, AlertTriangle, Clock,
} from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

const getLocalDateString = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];

const defaultEnd = new Date();
const defaultStart = new Date();
defaultStart.setDate(defaultStart.getDate() - 1);

function pct(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatDuration(seconds: number) {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

// ── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number }) {
  const pctVal = score * 100;
  const [Icon, label, color, bg] =
    pctVal >= 80
      ? [ShieldCheck,  "High",   "#16a34a", "rgba(22,163,74,0.12)"]
      : pctVal >= 50
      ? [ShieldAlert,  "Medium", "#d97706", "rgba(217,119,6,0.12)"]
      : [ShieldX,      "Low",    "#dc2626", "rgba(220,38,38,0.12)"];

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.375rem",
      padding: "0.25rem 0.75rem", borderRadius: "9999px",
      fontSize: "0.8rem", fontWeight: 600,
      color, backgroundColor: bg, border: `1px solid ${color}30`,
    }}>
      <Icon size={14} />
      {label} · {pct(score)}
    </span>
  );
}

// ── Ratio bar ────────────────────────────────────────────────────────────────

function RatioBar({ value, label, good = true }: { value: number; label: string; good?: boolean }) {
  const color = good
    ? value >= 0.8 ? "#16a34a" : value >= 0.5 ? "#d97706" : "#dc2626"
    : value <= 0.2 ? "#16a34a" : value <= 0.5 ? "#d97706" : "#dc2626";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--text-soft)" }}>{label}</span>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color }}>{pct(value)}</span>
      </div>
      <div style={{ height: "6px", borderRadius: "9999px", background: "var(--line)" }}>
        <div style={{
          height: "100%", borderRadius: "9999px",
          width: `${Math.min(100, value * 100).toFixed(1)}%`,
          background: color, transition: "width 0.4s ease",
        }} />
      </div>
    </div>
  );
}

// ── Building profile card ────────────────────────────────────────────────────

function BuildingProfileCard({ buildingId, profile }: { buildingId: string; profile: BuildingProfile }) {
  const [showGaps, setShowGaps] = useState(false);

  return (
    <div style={{
      background: "var(--bg-elev)", border: "1px solid var(--line)",
      borderRadius: "0.75rem", overflow: "hidden", boxShadow: "var(--shadow)",
    }}>
      {/* Card header */}
      <div style={{
        padding: "1rem 1.25rem",
        borderBottom: "1px solid var(--line)",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <Building2 size={16} style={{ color: "var(--brand)", flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text)" }}>
            {buildingId.replace("building_", "Building ")}
          </span>
        </div>
        <ConfidenceBadge score={profile.confidence_score} />
      </div>

      {/* Metrics grid */}
      <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

        {/* Payload count */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}>
          <span style={{ color: "var(--text-soft)" }}>Payloads received</span>
          <span style={{ fontWeight: 600, color: "var(--text)" }}>
            {(profile.actual_payloads ?? profile.total_payloads ?? 0).toLocaleString()}
          </span>
        </div>

        {/* Ratio bars */}
        <RatioBar value={profile.coverage_ratio}     label="Coverage (missing data)" />
        <RatioBar value={profile.authenticity_ratio} label="Authenticity (real vs simulated)" />
        <RatioBar value={profile.validity_ratio}     label="Physical validity" />

        {/* Physically invalid */}
        {((profile.physically_invalid_count ?? profile.physically_invalid) || 0) > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: "0.5rem",
            background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.2)",
            borderRadius: "0.5rem", padding: "0.625rem 0.875rem",
            fontSize: "0.8rem", color: "#dc2626",
          }}>
            <XCircle size={14} />
            {(profile.physically_invalid_count ?? profile.physically_invalid)} physically impossible reading{((profile.physically_invalid_count ?? profile.physically_invalid) || 0) !== 1 ? "s" : ""}
          </div>
        )}

        {/* Gaps */}
        <div>
          <button
            onClick={() => setShowGaps(g => !g)}
            style={{
              display: "flex", alignItems: "center", gap: "0.5rem",
              background: "none", border: "none", cursor: "pointer",
              fontSize: "0.8rem", color: profile.gap_count > 0 ? "#d97706" : "var(--text-soft)",
              padding: 0, fontWeight: 500,
            }}
          >
            <Clock size={13} />
            {profile.gap_count} data gap{profile.gap_count !== 1 ? "s" : ""} detected
            {profile.gap_count > 0 && (
              <span style={{ opacity: 0.7, fontWeight: 400 }}>
                {showGaps ? " (hide)" : " (show)"}
              </span>
            )}
          </button>

          {showGaps && profile.gaps.length > 0 && (
            <div style={{
              marginTop: "0.5rem", borderRadius: "0.5rem", overflow: "hidden",
              border: "1px solid var(--line)",
            }}>
              <table style={{ width: "100%", fontSize: "0.75rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg)", color: "var(--text-soft)", fontWeight: 600 }}>
                    <th style={{ padding: "0.375rem 0.625rem", textAlign: "left" }}>From</th>
                    <th style={{ padding: "0.375rem 0.625rem", textAlign: "left" }}>To</th>
                    <th style={{ padding: "0.375rem 0.625rem", textAlign: "right" }}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.gaps.map((g, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: "0.375rem 0.625rem", color: "var(--text)" }}>
                        {new Date(g.from).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td style={{ padding: "0.375rem 0.625rem", color: "var(--text)" }}>
                        {new Date(g.to).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td style={{ padding: "0.375rem 0.625rem", textAlign: "right", color: "#d97706", fontWeight: 600 }}>
                        {formatDuration(g.duration_seconds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Summary bar (top of results) ─────────────────────────────────────────────

function SummaryBar({ profiles }: { profiles: [string, BuildingProfile][] }) {
  const scores = profiles.map(([, p]) => p.confidence_score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const low = profiles.filter(([, p]) => p.confidence_score < 0.5).length;
  const totalGaps = profiles.reduce((a, [, p]) => a + p.gap_count, 0);

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: "1rem",
      background: "var(--bg-elev)", border: "1px solid var(--line)",
      borderRadius: "0.75rem", padding: "1rem 1.25rem",
      boxShadow: "var(--shadow)",
    }}>
      <SumStat label="Avg Confidence" value={pct(avg)} accent={avg >= 0.8 ? "#16a34a" : avg >= 0.5 ? "#d97706" : "#dc2626"} />
      <SumStat label="Buildings" value={String(profiles.length)} />
      <SumStat label="Low Confidence" value={String(low)} accent={low > 0 ? "#dc2626" : undefined} />
      <SumStat label="Total Data Gaps" value={String(totalGaps)} accent={totalGaps > 0 ? "#d97706" : undefined} />
    </div>
  );
}

function SumStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: "100px" }}>
      <span style={{ fontSize: "0.75rem", color: "var(--text-soft)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: "1.25rem", fontWeight: 700, color: accent ?? "var(--text)" }}>{value}</span>
    </div>
  );
}

// ── Formula explainer ────────────────────────────────────────────────

function FormulaExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      background: "var(--bg-elev)", border: "1px solid var(--line)",
      borderRadius: "0.75rem", overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0.75rem 1.25rem", background: "none", border: "none",
          cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-soft)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <ShieldCheck size={14} style={{ color: "var(--brand)" }} />
          How is the Confidence Score calculated?
        </span>
        <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>{open ? "▲ hide" : "▼ show"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 1.25rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text)", padding: "0.5rem 0.75rem", background: "rgba(99,102,241,0.06)", borderRadius: "0.5rem", border: "1px solid rgba(99,102,241,0.15)", fontFamily: "monospace", letterSpacing: "0.02em" }}>
            Confidence = Coverage × Authenticity × Physical Validity
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem" }}>
            {[
              {
                label: "Coverage",
                color: "#16a34a",
                desc: "Ratio of payloads actually received vs. expected, based on the data frequency you set. A gap in data lowers this.",
                formula: "actual / expected",
              },
              {
                label: "Authenticity",
                color: "#d97706",
                desc: "Ratio of real sensor readings vs. total readings. Values simulated or filled by Percepta are marked generated=true and counted against this.",
                formula: "real fields / total fields",
              },
              {
                label: "Physical Validity",
                color: "#6366f1",
                desc: "Ratio of payloads that pass physical sanity checks (non-negative energy, realistic SoC ranges, etc.).",
                formula: "valid payloads / total payloads",
              },
            ].map(({ label, color, desc, formula }) => (
              <div key={label} style={{
                padding: "0.75rem", borderRadius: "0.5rem",
                border: `1px solid ${color}25`, background: `${color}08`,
              }}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, color, marginBottom: "0.25rem" }}>{label}</div>
                <div style={{ fontSize: "0.7rem", fontFamily: "monospace", color: "var(--text-soft)", marginBottom: "0.375rem", opacity: 0.8 }}>{formula}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-soft)", lineHeight: 1.45 }}>{desc}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-soft)", margin: 0 }}>
            All three dimensions are between 0 and 1. A score of <strong>1.0</strong> means complete, real, and physically valid data.
            A score below <strong>0.5</strong> (Low) means KPI values from this building should be treated with caution.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function DataProfilingPage() {
  const { communities } = useCommunities();
  const defaultCommunity = Object.keys(COMMUNITY_FALLBACK)[0];

  const [community, setCommunity] = useState(defaultCommunity);
  const [buildings, setBuildings] = useState<string[]>(() => {
    const first = (COMMUNITY_FALLBACK[defaultCommunity] ?? [])[0];
    return first ? [first] : [];
  });
  const [startDate, setStartDate] = useState(getLocalDateString(defaultStart));
  const [endDate, setEndDate]     = useState(getLocalDateString(defaultEnd));

  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [profiles, setProfiles] = useState<[string, BuildingProfile][] | null>(null);

  const currentBuildings = communities[community] ?? COMMUNITY_FALLBACK[community] ?? [];

  const handleFetch = async () => {
    if (!buildings.length) { setError("Select at least one building."); return; }
    setLoading(true);
    setError(null);
    setProfiles(null);
    try {
      const res = await fetchDataProfile({
        community,
        buildings,
        startDate: new Date(startDate).toISOString(),
        endDate:   new Date(endDate).toISOString(),
      });
      setProfiles(Object.entries(res.data));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Profiling failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <header className="jobs-hero">
        <div>
          <h1>Data Health</h1>
          <p>Assess data quality (coverage, authenticity, validity, and gaps) before trusting KPI values</p>
        </div>
      </header>

      {/* ── Filters ── */}
      <div style={{ paddingBottom: "0.5rem" }}>
        <div className="panel" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-start" }}>
            {/* Community */}
            <div style={{ flex: "1 1 180px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
                <MapPin size={16} /> Community
              </label>
              <select
                style={{ width: "100%", padding: "0.5rem", borderRadius: "0.5rem", border: "1px solid var(--line)", backgroundColor: "var(--bg-elev)", color: "var(--text)" }}
                value={community}
                onChange={e => { setCommunity(e.target.value); setBuildings([]); }}
              >
                {Object.keys(communities).map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, " ").toUpperCase()}</option>
                ))}
              </select>
            </div>

            {/* Buildings */}
            <div style={{ flex: "2 1 280px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
                <Building2 size={16} /> Buildings
              </label>
              <MultiSelect
                options={currentBuildings.map((b: string) => ({ label: b, value: b }))}
                selected={buildings}
                onChange={setBuildings}
                placeholder="Select buildings..."
              />
            </div>
          </div>

          {/* Dates + frequency + run */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end", borderTop: "1px solid var(--line)", paddingTop: "1rem" }}>
            <div style={{ width: "150px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
                <Calendar size={16} /> Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", borderRadius: "0.5rem", border: "1px solid var(--line)", backgroundColor: "var(--bg-elev)", color: "var(--text)" }}
              />
            </div>
            <div style={{ width: "150px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", fontWeight: 600 }}>
                <Calendar size={16} /> End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", borderRadius: "0.5rem", border: "1px solid var(--line)", backgroundColor: "var(--bg-elev)", color: "var(--text)" }}
              />
            </div>

            <div style={{ marginLeft: "auto" }}>
              <Button
                onClick={handleFetch}
                disabled={loading}
                variant="primary"
                iconLeft={loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
              >
                {loading ? "Analysing…" : "Run Profile"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Results ── */}
      <main className="page-content" style={{ flex: 1, padding: "0 0 1.5rem" }}>

        {/* Error */}
        {error && (
          <div style={{
            display: "flex", alignItems: "center", gap: "0.75rem",
            background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)",
            color: "#dc2626", borderRadius: "0.75rem", padding: "1rem",
          }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="route-loading panel">
            <Loader2 className="ev-loader" />
            <p className="font-medium animate-pulse">Running data quality assessment…</p>
            <p>Checking coverage, authenticity, validity, and gaps across selected buildings.</p>
          </div>
        )}

        {/* Summary + cards */}
        {!loading && profiles && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <SummaryBar profiles={profiles} />
            <FormulaExplainer />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "1rem" }}>
              {profiles.map(([buildingId, profile]) => (
                <BuildingProfileCard key={buildingId} buildingId={buildingId} profile={profile} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !profiles && !error && (
          <div className="panel empty-state">
            <ShieldCheck size={48} style={{ opacity: 0.4, marginBottom: "1rem" }} />
            <p style={{ fontSize: "1.1rem", fontWeight: "bold" }}>No analysis yet</p>
            <p className="mt-1">Select buildings and a date range, then click Run Profile.</p>
          </div>
        )}
      </main>
    </div>
  );
}
