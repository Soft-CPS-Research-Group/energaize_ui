import { describe, expect, it } from "vitest";
import {
  buildKpiMeta,
  groupScopedKpis,
  isKpiGroupUsed,
  scoreKpiGroupTone
} from "./kpiMetadata";

describe("kpiMetadata", () => {
  it("parses family/variant/aggregation for known keys", () => {
    const delta = buildKpiMeta("cost_delta_daily_average_eur");
    expect(delta.family).toBe("energy_cost");
    expect(delta.variant).toBe("delta");
    expect(delta.aggregation).toBe("daily_average");
    expect(delta.direction).toBe("lower_better");

    const ev = buildKpiMeta("ev_departure_success_rate");
    expect(ev.family).toBe("ev");
    expect(ev.variant).toBe("absolute");
    expect(ev.aggregation).toBe("ratio");
    expect(ev.direction).toBe("higher_better");

    const core = buildKpiMeta("daily_peak_average");
    expect(core.family).toBe("core");
    expect(core.variant).toBe("normalized");
    expect(core.aggregation).toBe("ratio");
    expect(core.direction).toBe("lower_better");
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
});
