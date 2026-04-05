import { describe, expect, it } from "vitest";
import {
  buildGroupedKpiCompareRows,
  buildKpiMeta,
  groupScopedKpis,
  isKpiGroupUsed,
  scoreKpiGroupTone
} from "./kpiMetadata";

describe("kpiMetadata", () => {
  it("parses V2 family/variant/aggregation and canonical ids", () => {
    const delta = buildKpiMeta("cost_delta_daily_average_eur");
    expect(delta.family).toBe("extended_core");
    expect(delta.variant).toBe("delta");
    expect(delta.aggregation).toBe("daily_average");
    expect(delta.direction).toBe("lower_better");
    expect(delta.canonicalGroupId).toBe("cost_daily_average_eur");

    const ev = buildKpiMeta("ev_departure_success_rate");
    expect(ev.family).toBe("ev_chargers");
    expect(ev.variant).toBe("absolute");
    expect(ev.aggregation).toBe("ratio");
    expect(ev.direction).toBe("higher_better");

    const legacy = buildKpiMeta("daily_peak_average");
    expect(legacy.family).toBe("legacy_normalized");
    expect(legacy.variant).toBe("normalized");
    expect(legacy.aggregation).toBe("ratio");

    expect(buildKpiMeta("phase_import_peak_kw_l1").family).toBe("phases_service");
    expect(buildKpiMeta("discomfort_hot_delta_average").family).toBe("comfort");
    expect(buildKpiMeta("mystery_kpi").family).toBe("other");
  });

  it("returns tooltip fallback when no exact mapping exists", () => {
    const unknown = buildKpiMeta("phase_import_peak_kw_l1");
    expect(unknown.tooltip.shortDescription.length).toBeGreaterThan(8);
    expect(unknown.tooltip.formulaShort).toContain("value");
  });

  it("groups scoped rows and computes delta/delta pct", () => {
    const grouped = groupScopedKpis([
      {
        key: "cost_control_daily_average_eur",
        label: "Cost Control Daily Average Eur",
        unit: "€",
        value: 10,
        breakdown: [{ entity: "District", value: 10 }]
      },
      {
        key: "cost_baseline_daily_average_eur",
        label: "Cost Baseline Daily Average Eur",
        unit: "€",
        value: 8,
        breakdown: [{ entity: "District", value: 8 }]
      }
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.delta).toBe(2);
    expect(grouped[0]?.deltaPct).toBeCloseTo(25, 8);
    expect(grouped[0]?.comparisonKey).toBe("cost_daily_average_eur");
    expect(grouped[0]?.canonicalGroupId).toBe("cost_daily_average_eur");
    expect(grouped[0]?.boardMetricKey).toBe("cost_eur");
  });

  it("supports daily->total fallback selection through board metric key", () => {
    const grouped = groupScopedKpis([
      {
        key: "cost_delta_total_eur",
        label: "Cost Delta Total Eur",
        unit: "€",
        value: 30,
        breakdown: [{ entity: "District", value: 30 }]
      },
      {
        key: "cost_delta_daily_average_eur",
        label: "Cost Delta Daily Average Eur",
        unit: "€",
        value: 1.2,
        breakdown: [{ entity: "District", value: 1.2 }]
      }
    ]);

    const daily = grouped.find((row) => row.comparisonKey === "cost_daily_average_eur");
    const total = grouped.find((row) => row.comparisonKey === "cost_total_eur");
    expect(daily?.boardMetricKey).toBe("cost_eur");
    expect(total?.boardMetricKey).toBe("cost_eur");
  });

  it("scores KPI tone from delta and normalized values", () => {
    expect(
      scoreKpiGroupTone({
        direction: "lower_better",
        delta: -1,
        normalized: null
      })
    ).toBe("better");

    expect(
      scoreKpiGroupTone({
        direction: "higher_better",
        delta: null,
        normalized: 0.91
      })
    ).toBe("worse");

    expect(
      scoreKpiGroupTone({
        direction: "unknown",
        delta: 4,
        normalized: null
      })
    ).toBe("unknown");
  });

  it("detects used KPI groups and hides inactive ones", () => {
    const inactive = groupScopedKpis([
      {
        key: "community_local_import_total_kwh",
        label: "Community Local Import Total Kwh",
        unit: "kWh",
        value: 0,
        breakdown: [{ entity: "District", value: 0 }]
      }
    ])[0];
    expect(inactive).toBeTruthy();
    expect(isKpiGroupUsed(inactive!)).toBe(false);

    const active = groupScopedKpis([
      {
        key: "cost_control_daily_average_eur",
        label: "Cost Control Daily Average Eur",
        unit: "€",
        value: 12,
        breakdown: [{ entity: "District", value: 12 }]
      },
      {
        key: "cost_baseline_daily_average_eur",
        label: "Cost Baseline Daily Average Eur",
        unit: "€",
        value: 9,
        breakdown: [{ entity: "District", value: 9 }]
      }
    ])[0];
    expect(active).toBeTruthy();
    expect(isKpiGroupUsed(active!)).toBe(true);
  });

  it("builds grouped compare rows with extended-core primary and secondary values", () => {
    const left = [
      { key: "cost_control_daily_average_eur::District", label: "Cost Control Daily Average Eur - District", source: "District", value: 10, unit: "€" },
      { key: "cost_baseline_daily_average_eur::District", label: "Cost Baseline Daily Average Eur - District", source: "District", value: 8, unit: "€" },
      { key: "cost_delta_daily_average_eur::District", label: "Cost Delta Daily Average Eur - District", source: "District", value: 2, unit: "€" },
      { key: "ev_departure_success_rate::District", label: "Ev Departure Success Rate - District", source: "District", value: 0.8, unit: "%" }
    ];

    const right = [
      { key: "cost_control_daily_average_eur::District", label: "Cost Control Daily Average Eur - District", source: "District", value: 9, unit: "€" },
      { key: "cost_baseline_daily_average_eur::District", label: "Cost Baseline Daily Average Eur - District", source: "District", value: 8, unit: "€" },
      { key: "cost_delta_daily_average_eur::District", label: "Cost Delta Daily Average Eur - District", source: "District", value: 1, unit: "€" },
      { key: "ev_departure_success_rate::District", label: "Ev Departure Success Rate - District", source: "District", value: 0.9, unit: "%" }
    ];

    const rows = buildGroupedKpiCompareRows(left, right);
    const cost = rows.find((row) => row.canonicalGroupId === "cost_daily_average_eur" && row.entity === "District");
    const ev = rows.find((row) => row.canonicalGroupId === "ev_departure_success_rate" && row.entity === "District");

    expect(cost).toBeTruthy();
    expect(cost?.family).toBe("extended_core");
    expect(cost?.leftPrimary).toBe(10);
    expect(cost?.rightPrimary).toBe(9);
    expect(cost?.leftSecondary?.baseline).toBe(8);
    expect(cost?.leftSecondary?.delta).toBe(2);
    expect(cost?.deltaAbs).toBe(-1);
    expect(cost?.tone).toBe("better");

    expect(ev).toBeTruthy();
    expect(ev?.family).toBe("ev_chargers");
    expect(ev?.leftSecondary).toBeNull();
    expect(ev?.deltaAbs).toBeCloseTo(0.1, 8);
    expect(ev?.tone).toBe("better");
  });

  it("keeps rows with missing side when showAll=true", () => {
    const left = [
      { key: "community_local_import_total_kwh::District", label: "Community Local Import Total Kwh - District", source: "District", value: 120, unit: "kWh" }
    ];

    const rows = buildGroupedKpiCompareRows(left, [], { showAll: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.leftPrimary).toBe(120);
    expect(rows[0]?.rightPrimary).toBeNull();
    expect(rows[0]?.deltaAbs).toBeNull();
  });
});
