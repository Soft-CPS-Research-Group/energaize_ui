// KPI Manager navigation: one source for the top tabs, page headers and section sub-tabs.

export const KPI_BASE = "/app/kpi-manager";

/** Ceramic illustration shown in a section's page header (see kpi-ceramic.css). */
export type KpiArt = "community" | "solar" | "meter" | "servers" | "shop" | "charger";

export interface KpiPage {
  path: string;
  label: string;
}

export interface KpiSection {
  path: string;
  label: string;
  art: KpiArt;
  /** Hidden sections are routed but not listed in the top navigation yet. */
  hidden?: boolean;
  /** Pages shown as sub-tabs under the section header. */
  pages?: KpiPage[];
}

export const KPI_SECTIONS: KpiSection[] = [
  { path: `${KPI_BASE}/overview`, label: "Overview", art: "community" },
  {
    path: `${KPI_BASE}/analysis`,
    label: "Analysis",
    art: "solar",
    pages: [
      { path: `${KPI_BASE}/analysis/compare`, label: "Compare periods" },
      { path: `${KPI_BASE}/analysis/correlations`, label: "Correlations" },
      { path: `${KPI_BASE}/analysis/reports`, label: "Reports" },
    ],
  },
  { path: `${KPI_BASE}/scenarios`, label: "Scenarios", art: "charger", hidden: true },
  { path: `${KPI_BASE}/data-quality`, label: "Data quality", art: "meter" },
  {
    path: `${KPI_BASE}/automation`,
    label: "Automation",
    art: "servers",
    pages: [
      { path: `${KPI_BASE}/automation/scheduler`, label: "Scheduler" },
      { path: `${KPI_BASE}/automation/alerts`, label: "Alerts" },
    ],
  },
  {
    path: `${KPI_BASE}/catalogue`,
    label: "Catalogue",
    art: "shop",
    pages: [
      { path: `${KPI_BASE}/catalogue/library`, label: "Library" },
      { path: `${KPI_BASE}/catalogue/explorer`, label: "Explorer" },
    ],
  },
];

/** Paths used before the six-section layout, kept as redirects for bookmarks and links. */
export const KPI_LEGACY_REDIRECTS: Record<string, string> = {
  dashboard: `${KPI_BASE}/overview`,
  compare: `${KPI_BASE}/analysis/compare`,
  correlations: `${KPI_BASE}/analysis/correlations`,
  reports: `${KPI_BASE}/analysis/reports`,
  "data-health": `${KPI_BASE}/data-quality`,
  scheduler: `${KPI_BASE}/automation/scheduler`,
  thresholds: `${KPI_BASE}/automation/alerts`,
  library: `${KPI_BASE}/catalogue/library`,
  explorer: `${KPI_BASE}/catalogue/explorer`,
};

export function kpiSectionFor(pathname: string): KpiSection | undefined {
  return KPI_SECTIONS.find((s) => pathname === s.path || pathname.startsWith(`${s.path}/`));
}
