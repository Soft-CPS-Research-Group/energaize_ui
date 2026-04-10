import { describe, expect, it } from "vitest";
import {
  buildGroupedKpiCompareRows,
  buildKpiMeta,
  groupRowsByFamilySubfamily,
  groupScopedKpis,
  isKpiGroupUsed,
  pickPrimaryValueForGroup,
  scoreKpiGroupTone
} from "./kpiMetadata";

describe("kpiMetadata v2", () => {
  it("parses level/family/subfamily/variant/unit from v2 keys", () => {
    const meta = buildKpiMeta("district_energy_grid_total_import_control_kwh");

    expect(meta.level).toBe("district");
    expect(meta.family).toBe("energy_grid");
    expect(meta.subfamilyKey).toBe("total");
    expect(meta.metricKey).toBe("import");
    expect(meta.variant).toBe("control");
    expect(meta.aggregation).toBe("total");
    expect(meta.canonicalGroupId).toBe("district_energy_grid_total_import_kwh");
  });

  it("parses multi-token subfamilies and keeps metric detail", () => {
    const meta = buildKpiMeta("district_energy_grid_shape_quality_peak_daily_average_to_baseline_ratio");
    expect(meta.family).toBe("energy_grid");
    expect(meta.subfamilyKey).toBe("shape_quality");
    expect(meta.metricKey).toBe("peak_daily_average_to_baseline");
    expect(meta.aggregation).toBe("daily_average");
  });

  it("falls back to other family for unknown key contracts", () => {
    const meta = buildKpiMeta("legacy_peak_ratio");
    expect(meta.family).toBe("other");
    expect(meta.canonicalGroupId).toBe("legacy_peak_ratio");
  });

  it("groups control/baseline/delta rows and computes delta pct", () => {
    const grouped = groupScopedKpis([
      {
        key: "district_cost_total_control_eur",
        label: "Control",
        unit: "€",
        value: 100,
        breakdown: [{ entity: "District", value: 100 }]
      },
      {
        key: "district_cost_total_baseline_eur",
        label: "Baseline",
        unit: "€",
        value: 120,
        breakdown: [{ entity: "District", value: 120 }]
      },
      {
        key: "district_cost_total_delta_eur",
        label: "Delta",
        unit: "€",
        value: -20,
        breakdown: [{ entity: "District", value: -20 }]
      }
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.control).toBe(100);
    expect(grouped[0]?.baseline).toBe(120);
    expect(grouped[0]?.delta).toBe(-20);
    expect(grouped[0]?.deltaPct).toBeCloseTo(-16.666, 2);
    expect(grouped[0]?.canonicalGroupId).toBe("district_cost_total_eur");
  });

  it("marks rows without numeric values as N/A candidates", () => {
    const grouped = groupScopedKpis([
      {
        key: "district_comfort_resilience_discomfort_overall_ratio",
        label: "Discomfort",
        unit: "%",
        value: null,
        breakdown: []
      }
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.hasAnyNumeric).toBe(false);
    expect(isKpiGroupUsed(grouped[0]!)).toBe(false);
  });

  it("uses control->absolute->normalized->baseline->delta priority", () => {
    expect(
      pickPrimaryValueForGroup({
        control: 11,
        absolute: 9,
        normalized: 0.9,
        baseline: 12,
        delta: -1
      })
    ).toBe(11);

    expect(
      pickPrimaryValueForGroup({
        control: null,
        absolute: 9,
        normalized: 0.9,
        baseline: 12,
        delta: -1
      })
    ).toBe(9);
  });

  it("scores KPI tone from direction and delta", () => {
    const grouped = groupScopedKpis([
      {
        key: "district_emissions_total_control_kgco2",
        label: "Control",
        unit: "kgCO2",
        value: 80,
        breakdown: [{ entity: "District", value: 80 }]
      },
      {
        key: "district_emissions_total_baseline_kgco2",
        label: "Baseline",
        unit: "kgCO2",
        value: 100,
        breakdown: [{ entity: "District", value: 100 }]
      }
    ]);

    expect(scoreKpiGroupTone(grouped[0]!)).toBe("better");
  });

  it("builds compare rows with semantic metadata and N/A support", () => {
    const left = [
      {
        key: "district_ev_performance_departure_success_ratio::District",
        label: "EV Success",
        source: "District",
        value: 0.85,
        unit: "%"
      },
      {
        key: "district_comfort_resilience_discomfort_overall_ratio::District",
        label: "Discomfort",
        source: "District",
        value: Number.NaN,
        unit: "%"
      }
    ];

    const right = [
      {
        key: "district_ev_performance_departure_success_ratio::District",
        label: "EV Success",
        source: "District",
        value: 0.9,
        unit: "%"
      },
      {
        key: "district_comfort_resilience_discomfort_overall_ratio::District",
        label: "Discomfort",
        source: "District",
        value: Number.NaN,
        unit: "%"
      }
    ];

    const rows = buildGroupedKpiCompareRows(left, right, { showAll: true });
    const ev = rows.find((row) => row.canonicalGroupId === "district_ev_performance_departure_success_ratio");
    const na = rows.find(
      (row) => row.canonicalGroupId === "district_comfort_resilience_discomfort_overall_ratio"
    );

    expect(ev?.family).toBe("ev");
    expect(ev?.subfamilyKey).toBe("performance");
    expect(ev?.leftPrimary).toBeCloseTo(0.85, 4);
    expect(ev?.rightPrimary).toBeCloseTo(0.9, 4);
    expect(ev?.leftHasValue).toBe(true);
    expect(ev?.rightHasValue).toBe(true);

    expect(na?.leftPrimary).toBeNull();
    expect(na?.rightPrimary).toBeNull();
    expect(na?.leftHasValue).toBe(false);
    expect(na?.rightHasValue).toBe(false);
  });

  it("groups rows by family and subfamily", () => {
    const rows = groupScopedKpis([
      {
        key: "district_cost_total_control_eur",
        label: "Control",
        unit: "€",
        value: 100,
        breakdown: [{ entity: "District", value: 100 }]
      },
      {
        key: "district_cost_daily_average_control_eur",
        label: "Control",
        unit: "€",
        value: 5,
        breakdown: [{ entity: "District", value: 5 }]
      }
    ]);

    const sections = groupRowsByFamilySubfamily(rows);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.family).toBe("cost");
    expect(sections[0]?.subfamilies.map((item) => item.subfamilyKey)).toEqual(["daily_average", "total"]);
  });
});
