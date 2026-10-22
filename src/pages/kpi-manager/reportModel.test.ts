import { describe, expect, it } from "vitest";
import type { AggregateBucket, KpiAggStats } from "../../api/kpiApi";
import { reportCsv, reportRows, rowExtremes, statUnit, statValue } from "./reportModel";

const stats = (over: Partial<KpiAggStats>): KpiAggStats => ({ sum: 10, mean: 2, min: 1, max: 3, count: 5, ...over });

const buckets: AggregateBucket[] = [
  { label: "2026-09", start: "2026-09-01", end: "2026-09-30", scopes: { b1: { EnergyCostKPI: stats({ sum: 10, value: 10, unit: "€" }) } } },
  { label: "2026-10", start: "2026-10-01", end: "2026-10-31", scopes: { b1: { EnergyCostKPI: stats({ sum: 4, value: 4, unit: "€" }) } } },
];

describe("report model", () => {
  it("uses the headline value and unit sent by the KPI module", () => {
    const s = stats({ sum: 99, mean: 50, value: 50, unit: "%" });
    expect(statValue("SelfSufficiencyRateKPI", s, "auto")).toBe(50);
    expect(statUnit("SelfSufficiencyRateKPI", s)).toBe("%");
  });

  it("falls back to the legacy name rules when the module sends no headline", () => {
    expect(statValue("EnergyCostKPI", stats({}), "auto")).toBe(10);       // € add up
    expect(statValue("SelfSufficiencyRateKPI", stats({}), "auto")).toBe(2); // % are averaged
    expect(statUnit("EnergyCostKPI", stats({}))).toBe("€");
  });

  it("lets sum and mean override the headline", () => {
    const s = stats({ value: 7 });
    expect(statValue("X", s, "sum")).toBe(10);
    expect(statValue("X", s, "mean")).toBe(2);
  });

  it("finds a row's extremes only when there are two values to contrast", () => {
    expect(rowExtremes(buckets, { scope: "b1", kpi: "EnergyCostKPI" }, "auto")).toEqual({ max: 10, min: 4 });
    expect(rowExtremes(buckets.slice(0, 1), { scope: "b1", kpi: "EnergyCostKPI" }, "auto")).toBeNull();
  });

  it("exports one quoted CSV row per scope and KPI, with its unit", () => {
    expect(reportRows(buckets)).toEqual([{ scope: "b1", kpi: "EnergyCostKPI" }]);
    expect(reportCsv(buckets, "auto").split("\n")).toEqual([
      '"Scope","KPI","Unit","2026-09","2026-10"',
      '"b1","EnergyCostKPI","€","10","4"',
    ]);
  });
});
