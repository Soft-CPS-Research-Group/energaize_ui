import { useState } from "react";
import { fetchDataProfile } from "../../api/kpiApi";
import type { BuildingProfile } from "../../api/kpiApi";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { useCommunities } from "../../hooks/useCommunities";
import { COMMUNITY_FALLBACK } from "../../constants/kpiCommunities";
import { Building2, Search, Loader2, ShieldCheck, ShieldAlert, ShieldX, XCircle, Clock, BarChart2 } from "lucide-react";
import { KpiPageHeader } from "../../components/kpi/KpiPageHeader";
import { KpiError, KpiLoading } from "../../components/kpi/KpiStates";
import { BuildingsField, CommunityField, DateRangeField, KpiFilterBar, toLocalDateString } from "../../components/kpi/KpiFilters";

// ── Helpers ──────────────────────────────────────────────────────────────────

const defaultEnd = new Date();
const defaultStart = new Date();
defaultStart.setDate(defaultStart.getDate() - 1);

type Tone = "ok" | "warn" | "danger";

function pct(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Quality band of a 0–1 ratio: ≥ 0.8 good, ≥ 0.5 caution, below that poor. */
function qualityTone(ratio: number): Tone {
  return ratio >= 0.8 ? "ok" : ratio >= 0.5 ? "warn" : "danger";
}

function formatDuration(seconds: number) {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

const formatMoment = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const OUTLIER_METHOD: Record<string, string> = {
  grid_energy_in: "STL",
  grid_energy_out: "STL",
  solar_generation: "STL",
  battery_soc_drift: "CUSUM",
  battery_soc_spikes: "MAD",
};

// ── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number }) {
  const tone = qualityTone(score);
  const Icon = tone === "ok" ? ShieldCheck : tone === "warn" ? ShieldAlert : ShieldX;
  const label = tone === "ok" ? "High" : tone === "warn" ? "Medium" : "Low";
  return (
    <Badge tone={tone === "ok" ? "success" : tone === "warn" ? "warning" : "danger"}>
      <Icon size={13} /> {label} · {pct(score)}
    </Badge>
  );
}

// ── Ratio bar ────────────────────────────────────────────────────────────────

function RatioBar({ value, label }: { value: number; label: string }) {
  const tone = qualityTone(value);
  return (
    <div className="kpi-ratio">
      <div className="kpi-ratio-head">
        <span>{label}</span>
        <strong className={`kpi-text-${tone}`}>{pct(value)}</strong>
      </div>
      <div className="kpi-ratio-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={value}>
        <div className={`kpi-ratio-fill is-${tone}`} style={{ width: `${Math.min(100, value * 100).toFixed(1)}%` }} />
      </div>
    </div>
  );
}

// ── Building profile card ────────────────────────────────────────────────────

function BuildingProfileCard({ buildingId, profile }: { buildingId: string; profile: BuildingProfile }) {
  const invalid = (profile.physically_invalid_count ?? profile.physically_invalid) || 0;

  return (
    <article className="kpi-profile">
      <header className="kpi-profile-head">
        <h3><Building2 size={16} aria-hidden="true" /> {buildingId.replace("building_", "Building ")}</h3>
        <ConfidenceBadge score={profile.confidence_score} />
      </header>

      <div className="kpi-profile-body">
        <div className="kpi-profile-row">
          <span>Payloads received</span>
          <strong>{(profile.actual_payloads ?? profile.total_payloads ?? 0).toLocaleString()}</strong>
        </div>

        <RatioBar value={profile.coverage_ratio}     label="Coverage (missing data)" />
        <RatioBar value={profile.authenticity_ratio} label="Authenticity (real vs generated)" />
        <RatioBar value={profile.validity_ratio}     label="Physical validity" />

        {invalid > 0 && (
          <p className="kpi-profile-alert">
            <XCircle size={14} aria-hidden="true" />
            {invalid} physically impossible reading{invalid !== 1 ? "s" : ""}
          </p>
        )}

        {profile.outlier_counts && Object.keys(profile.outlier_counts).length > 0 && (
          <div>
            <p className="kpi-profile-subtitle"><BarChart2 size={12} aria-hidden="true" /> Outlier detection</p>
            <ul className="kpi-outliers">
              {Object.entries(profile.outlier_counts).map(([field, count]) => (
                <li key={field} className={count > 0 ? "has-outliers" : undefined}>
                  <span>{field.replace(/_/g, " ")} <small>[{OUTLIER_METHOD[field] ?? "IQR"}]</small></span>
                  <strong className={count > 0 ? "kpi-text-danger" : "kpi-text-ok"}>{count}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}

        <details className="kpi-gaps">
          <summary className={profile.gap_count > 0 ? "kpi-text-warn" : "kpi-text-soft"}>
            <Clock size={13} aria-hidden="true" /> {profile.gap_count} data gap{profile.gap_count !== 1 ? "s" : ""} detected
          </summary>
          {profile.gaps.length > 0 && (
            <div className="kpi-table-wrap">
              <table className="kpi-table">
                <thead>
                  <tr><th>From</th><th>To</th><th className="num">Duration</th></tr>
                </thead>
                <tbody>
                  {profile.gaps.map((g, i) => (
                    <tr key={i}>
                      <td>{formatMoment(g.from)}</td>
                      <td>{formatMoment(g.to)}</td>
                      <td className="num kpi-text-warn">{formatDuration(g.duration_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </div>
    </article>
  );
}

// ── Explainers ───────────────────────────────────────────────────────────────

function Explainer({ icon, title, intro, items }: {
  icon: React.ReactNode;
  title: string;
  intro: React.ReactNode;
  items: Array<{ name: string; meta: string; desc: string; note?: string }>;
}) {
  return (
    <details className="kpi-explainer">
      <summary>{icon} {title}</summary>
      <div className="kpi-explainer-body">
        {intro}
        <div className="kpi-explainer-grid">
          {items.map(({ name, meta, desc, note }) => (
            <div key={name} className="kpi-explainer-item">
              <strong>{name}</strong>
              <code>{meta}</code>
              <p>{desc}</p>
              {note ? <code>{note}</code> : null}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function FormulaExplainer() {
  return (
    <Explainer
      icon={<ShieldCheck size={14} aria-hidden="true" />}
      title="How is the confidence score calculated?"
      intro={
        <>
          <p className="kpi-explainer-formula">Confidence = Coverage × Authenticity × Physical validity</p>
          <p className="kpi-text-soft">
            Each dimension is between 0 and 1. A score of <strong>1.0</strong> means complete, real and physically
            valid data; below <strong>0.5</strong> (Low), treat KPI values from that building with caution.
          </p>
        </>
      }
      items={[
        {
          name: "Coverage",
          meta: "actual / expected payloads",
          desc: "Payloads received versus expected at the building's usual sending interval, inferred from its data. Gaps lower it.",
        },
        {
          name: "Authenticity",
          meta: "real fields / total fields",
          desc: "Share of readings that are not marked generated=true by Percepta (values it filled in or simulated).",
        },
        {
          name: "Physical validity",
          meta: "valid payloads / total payloads",
          desc: "Share of payloads that pass physical sanity checks: non-negative energy, state of charge between 0 and 1.",
        },
      ]}
    />
  );
}

function OutlierMethodExplainer() {
  return (
    <Explainer
      icon={<BarChart2 size={14} aria-hidden="true" />}
      title="How does outlier detection work? (STL · CUSUM · MAD · Rolling IQR)"
      intro={
        <p className="kpi-text-soft">
          Each sensor field uses the method suited to its statistics. Payloads are <strong>never removed</strong>:
          outliers are reported here, they do not change the KPI values.
        </p>
      }
      items={[
        {
          name: "STL + MAD",
          meta: "grid energy in/out, solar generation",
          desc: "Seasonal-trend decomposition (Cleveland 1990) removes the daily pattern, then MAD scores what is left, so normal daily peaks are not flagged.",
          note: "MAD score > 3.5",
        },
        {
          name: "CUSUM",
          meta: "battery SoC drift",
          desc: "Cumulative-sum control chart (Page 1954): sustained drift or a SoC stuck at one value, typical of a failing sensor.",
          note: "h = 5, k = 0.5",
        },
        {
          name: "MAD",
          meta: "battery SoC spikes",
          desc: "Median absolute deviation (Leys et al. 2013): one extreme value does not inflate the spread used to score the others.",
          note: "MAD score > 3.5",
        },
        {
          name: "Rolling IQR",
          meta: "fallback when STL cannot run",
          desc: "Tukey (1977) fences in a sliding window: bounds follow the local neighbourhood, no model fitting needed.",
          note: "IQR × 3.0",
        },
      ]}
    />
  );
}

// ── Summary strip ────────────────────────────────────────────────────────────

function SummaryStrip({ profiles }: { profiles: [string, BuildingProfile][] }) {
  const scores = profiles.map(([, p]) => p.confidence_score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const low = profiles.filter(([, p]) => p.confidence_score < 0.5).length;
  const totalGaps = profiles.reduce((a, [, p]) => a + p.gap_count, 0);

  return (
    <dl className="kpi-summary-strip">
      <div><dt>Average confidence</dt><dd className={`kpi-text-${qualityTone(avg)}`}>{pct(avg)}</dd></div>
      <div><dt>Buildings</dt><dd>{profiles.length}</dd></div>
      <div><dt>Low confidence</dt><dd className={low > 0 ? "kpi-text-danger" : undefined}>{low}</dd></div>
      <div><dt>Data gaps</dt><dd className={totalGaps > 0 ? "kpi-text-warn" : undefined}>{totalGaps}</dd></div>
    </dl>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function DataProfilingPage() {
  const { communities } = useCommunities();
  const defaultCommunity = Object.keys(COMMUNITY_FALLBACK)[0];

  const [community, setCommunity] = useState(defaultCommunity);
  const [buildings, setBuildings] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(toLocalDateString(defaultStart));
  const [endDate, setEndDate]     = useState(toLocalDateString(defaultEnd));

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
      <KpiPageHeader
        title="Data quality"
        description="Coverage, authenticity, validity and gaps of the telemetry behind each KPI"
      />

      <KpiFilterBar
        ariaLabel="Profile options"
        footer={
          <div className="kpi-filterbar-actions">
            <Button
              onClick={handleFetch}
              disabled={loading}
              variant="primary"
              iconLeft={loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            >
              {loading ? "Analyzing…" : "Run profile"}
            </Button>
          </div>
        }
      >
        <CommunityField
          communities={Object.keys(communities)}
          value={community}
          onChange={(c) => { setCommunity(c); setBuildings([]); }}
        />
        <BuildingsField buildings={currentBuildings} selected={buildings} onChange={setBuildings} />
        <DateRangeField
          start={startDate}
          end={endDate}
          presets={[{ label: "Today", days: 0 }, { label: "1 day", days: 1 }, { label: "7 days", days: 7 }]}
          onChange={(start, end) => { setStartDate(start); setEndDate(end); }}
        />
      </KpiFilterBar>

      {error && <KpiError message={error} onRetry={buildings.length ? handleFetch : undefined} />}

      {loading && (
        <KpiLoading
          label="Running data quality assessment…"
          hint="Checking coverage, authenticity and validity, and running outlier detection."
        />
      )}

      {!loading && profiles && (
        <section className="kpi-results" aria-label="Data quality results">
          <SummaryStrip profiles={profiles} />
          <FormulaExplainer />
          <OutlierMethodExplainer />
          <div className="kpi-profile-grid">
            {profiles.map(([buildingId, profile]) => (
              <BuildingProfileCard key={buildingId} buildingId={buildingId} profile={profile} />
            ))}
          </div>
        </section>
      )}

      {!loading && !profiles && !error && (
        <EmptyState
          title="No analysis yet"
          message="Select buildings and a period, then select Run profile."
        />
      )}
    </div>
  );
}
