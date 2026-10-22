// Values, units and exports of the aggregate report, kept out of the page so they can be tested.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { AggregateBucket, KpiAggStats } from "../../api/kpiApi";

/** auto = the KPI's own headline (sum for kWh/€, mean for %/ratios); sum/mean force one for every KPI. */
export type ReportMode = "auto" | "sum" | "mean";

// Fallbacks for a KPI module that does not yet send `value`/`unit` with each bucket
const LEGACY_SUM_KPIS = new Set(["EnergyCostKPI", "EffectiveSavingsKPI", "SelfConsumptionKPI"]);

function legacyUnit(kpi: string): string {
  if (kpi.includes("Cost") || kpi.includes("Savings")) return "€";
  if (["SelfSufficiency", "Rate", "Factor", "Gini", "Parity", "CR20", "NoHarm"].some((part) => kpi.includes(part))) return "%";
  if (kpi.includes("Balance") || kpi.includes("Energy")) return "kWh";
  return "";
}

export function statValue(kpi: string, stats: KpiAggStats, mode: ReportMode): number {
  if (mode === "sum") return stats.sum;
  if (mode === "mean") return stats.mean;
  if (typeof stats.value === "number") return stats.value;
  return LEGACY_SUM_KPIS.has(kpi) ? stats.sum : stats.mean;
}

export function statUnit(kpi: string, stats?: KpiAggStats | null): string {
  return stats?.unit ?? legacyUnit(kpi);
}

export function formatNumber(v: number): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (v !== 0 && Math.abs(v) < 0.001) return v.toExponential(2);
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function formatStat(kpi: string, stats: KpiAggStats, mode: ReportMode): string {
  const unit = statUnit(kpi, stats);
  return `${formatNumber(statValue(kpi, stats, mode))}${unit ? ` ${unit}` : ""}`;
}

export interface ReportRow {
  scope: string;
  kpi: string;
}

/** Every (scope, KPI) pair present in any bucket, sorted. */
export function reportRows(buckets: AggregateBucket[]): ReportRow[] {
  const keys = new Set<string>();
  for (const b of buckets) for (const scope of Object.keys(b.scopes)) for (const kpi of Object.keys(b.scopes[scope])) keys.add(`${scope}||${kpi}`);
  return Array.from(keys).sort().map((key) => {
    const [scope, kpi] = key.split("||");
    return { scope, kpi };
  });
}

/** Highest and lowest value of a row across buckets; null when there is nothing to contrast. */
export function rowExtremes(buckets: AggregateBucket[], { scope, kpi }: ReportRow, mode: ReportMode): { max: number; min: number } | null {
  const values = buckets
    .map((b) => b.scopes[scope]?.[kpi])
    .filter((s): s is KpiAggStats => s != null)
    .map((s) => statValue(kpi, s, mode));
  if (values.length < 2) return null;
  return { max: Math.max(...values), min: Math.min(...values) };
}

export function reportCsv(buckets: AggregateBucket[], mode: ReportMode): string {
  const header = ["Scope", "KPI", "Unit", ...buckets.map((b) => b.label)];
  const rows = reportRows(buckets).map(({ scope, kpi }) => {
    const firstStats = buckets.map((b) => b.scopes[scope]?.[kpi]).find((s) => s != null);
    const values = buckets.map((b) => {
      const stats = b.scopes[scope]?.[kpi];
      return stats ? String(statValue(kpi, stats, mode)) : "";
    });
    return [scope, kpi, statUnit(kpi, firstStats), ...values];
  });
  return [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadReportCsv(buckets: AggregateBucket[], mode: ReportMode, filename: string): void {
  download(new Blob([reportCsv(buckets, mode)], { type: "text/csv;charset=utf-8;" }), filename);
}

export function downloadReportPdf(buckets: AggregateBucket[], mode: ReportMode, title: string, filename: string): void {
  // Column widths (pt); the page widens with the number of buckets
  const MARGIN = 40;
  const SCOPE_COL_W = 115;
  const KPI_COL_W = 95;
  const DATA_COL_W = 90;
  const contentWidth = SCOPE_COL_W + KPI_COL_W + DATA_COL_W * buckets.length;
  const pageWidth = Math.max(841.89, contentWidth + MARGIN * 2); // never smaller than A4 landscape

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [pageWidth, 595.28] });
  doc.text(title, MARGIN, 40);

  const rows = reportRows(buckets);
  autoTable(doc, {
    startY: 60,
    head: [["Scope", "KPI", ...buckets.map((b) => b.label)]],
    body: rows.map(({ scope, kpi }) => [
      scope,
      kpi.replace("KPI", ""),
      ...buckets.map((b) => {
        const stats = b.scopes[scope]?.[kpi];
        return stats ? formatStat(kpi, stats, mode) : "—";
      }),
    ]),
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: contentWidth,
    columnStyles: {
      0: { cellWidth: SCOPE_COL_W, overflow: "ellipsize" },
      1: { cellWidth: KPI_COL_W, fontStyle: "bold" },
      ...Object.fromEntries(buckets.map((_, i) => [i + 2, { cellWidth: DATA_COL_W, halign: "right" }])),
    },
    headStyles: { fillColor: [64, 93, 67], textColor: 255, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: [244, 241, 235] },
    showHead: "everyPage",
    // Row extremes in bold: highest and lowest are not "good" or "bad" without knowing the KPI
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index < 2) return;
      const row = rows[data.row.index];
      const extremes = rowExtremes(buckets, row, mode);
      const stats = buckets[data.column.index - 2].scopes[row.scope]?.[row.kpi];
      if (!extremes || !stats) return;
      const v = statValue(row.kpi, stats, mode);
      if (v === extremes.max || v === extremes.min) data.cell.styles.fontStyle = "bold";
    },
  });

  doc.save(filename);
}
