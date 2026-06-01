import { describe, expect, it } from "vitest";
import {
  formatKpiScorecardValue,
  resolveKpiScorecardSections,
  resolveKpiScorecardSignals,
  type KpiScorecardSourceRow
} from "./kpiScorecard";

describe("kpiScorecard", () => {
  it("resolves the six dashboard signals with reference-safe labels", () => {
    const rows: KpiScorecardSourceRow[] = [
      { key: "district_cost_total_control_eur", label: "Cost", unit: "€", value: 1000 },
      { key: "district_cost_total_delta_eur", label: "Cost delta", unit: "€", value: -125 },
      { key: "ev_min_acceptable_feasible_rate", label: "EV min service", unit: "%", value: 0.99 },
      { key: "ev_within_tolerance_rate", label: "EV tolerance", unit: "%", value: 0.94 },
      { key: "district_battery_total_throughput_kwh", label: "Battery throughput", unit: "kWh", value: 320 },
      { key: "community_solar_self_consumption_rate", label: "Solar self-consumption", unit: "%", value: 0.82 }
    ];

    const signals = resolveKpiScorecardSignals(rows);

    expect(signals.map((signal) => signal.definition.title)).toEqual([
      "Cost saving vs reference",
      "EV minimum feasible service",
      "EV within tolerance",
      "Electrical violations",
      "Battery throughput",
      "Solar self-consumption"
    ]);
    expect(signals[0]?.value).toBe(125);
    expect(signals[1]?.tone).toBe("better");
    expect(signals[2]?.tone).toBe("worse");
    expect(signals[4]?.tone).toBe("neutral");
    expect(signals[5]?.tone).toBe("better");
    expect(formatKpiScorecardValue(signals[1]!)).toBe("99%");
    expect(formatKpiScorecardValue(signals[4]!)).toBe("320 kWh");
  });

  it("groups selected simulator metrics and omits removed derived diagnostics", () => {
    const sections = resolveKpiScorecardSections([
      { key: "district_ev_total_v2g_export_kwh", label: "V2G export", unit: "kWh", value: 42 },
      { key: "district_energy_grid_total_import_control_kwh", label: "Community import", unit: "kWh", value: 1200 },
      { key: "district_cost_total_delta_eur", label: "Cost delta", unit: "€", value: -10 }
    ]);

    expect(sections.map((section) => section.title)).toEqual(["Selected KPIs"]);
    const selected = sections[0];
    expect(selected?.reportedCount).toBe(3);
    expect(selected?.signals.find((signal) => signal.definition.id === "v2g-export")?.value).toBe(42);
    expect(selected?.signals.some((signal) => signal.definition.id === "unsafe-v2g-share")).toBe(false);
    expect(selected?.signals.some((signal) => signal.definition.id === "battery-ratio-reference")).toBe(false);
    expect(selected?.signals.some((signal) => signal.definition.id === "saving-per-battery-kwh")).toBe(false);
  });

  it("prefers BAU ratios over simulator baseline ratios when both are exported", () => {
    const [dailyPeak, allTimePeak, loadFactor] = resolveKpiScorecardSections([
      {
        key: "district_energy_grid_shape_quality_peak_daily_average_to_baseline_ratio",
        label: "Daily peak vs baseline",
        unit: "ratio",
        value: 1.25
      },
      {
        key: "district_energy_grid_shape_quality_peak_daily_average_to_business_as_usual_ratio",
        label: "Daily peak vs BAU",
        unit: "ratio",
        value: 0.92
      },
      {
        key: "district_energy_grid_shape_quality_peak_all_time_average_to_baseline_ratio",
        label: "All-time peak vs baseline",
        unit: "ratio",
        value: 1.18
      },
      {
        key: "district_energy_grid_shape_quality_peak_all_time_average_to_business_as_usual_ratio",
        label: "All-time peak vs BAU",
        unit: "ratio",
        value: 0.95
      },
      {
        key: "district_energy_grid_shape_quality_load_factor_penalty_daily_average_to_baseline_ratio",
        label: "Load factor vs baseline",
        unit: "ratio",
        value: 1.12
      },
      {
        key: "district_energy_grid_shape_quality_load_factor_penalty_daily_average_to_business_as_usual_ratio",
        label: "Load factor vs BAU",
        unit: "ratio",
        value: 0.88
      }
    ])[0]!.signals.filter((signal) =>
      ["daily-peak-ratio", "all-time-peak-ratio", "load-factor-penalty"].includes(signal.definition.id)
    );

    expect(dailyPeak?.sourceKey).toBe("district_energy_grid_shape_quality_peak_daily_average_to_business_as_usual_ratio");
    expect(dailyPeak?.value).toBe(0.92);
    expect(allTimePeak?.sourceKey).toBe("district_energy_grid_shape_quality_peak_all_time_average_to_business_as_usual_ratio");
    expect(allTimePeak?.value).toBe(0.95);
    expect(loadFactor?.sourceKey).toBe("district_energy_grid_shape_quality_load_factor_penalty_daily_average_to_business_as_usual_ratio");
    expect(loadFactor?.value).toBe(0.88);
  });

  it("keeps grid-shape ratios community-only in the selected scorecard", () => {
    const rows: KpiScorecardSourceRow[] = [
      {
        key: "building_energy_grid_shape_quality_peak_daily_average_to_baseline_ratio",
        label: "Building daily peak vs baseline",
        unit: "ratio",
        value: 1.05
      },
      {
        key: "building_energy_grid_shape_quality_peak_all_time_average_to_baseline_ratio",
        label: "Building all-time peak vs baseline",
        unit: "ratio",
        value: 1.07
      },
      {
        key: "building_energy_grid_shape_quality_load_factor_penalty_daily_average_to_baseline_ratio",
        label: "Building load factor vs baseline",
        unit: "ratio",
        value: 1.1
      },
      {
        key: "building_energy_grid_total_import_control_kwh",
        label: "Building import",
        unit: "kWh",
        value: 42
      }
    ];

    const buildingSignals = resolveKpiScorecardSections(rows, undefined, "building")[0]?.signals || [];
    const communitySignals = resolveKpiScorecardSections(rows, undefined, "community")[0]?.signals || [];

    expect(buildingSignals.map((signal) => signal.definition.id)).not.toContain("daily-peak-ratio");
    expect(buildingSignals.map((signal) => signal.definition.id)).not.toContain("all-time-peak-ratio");
    expect(buildingSignals.map((signal) => signal.definition.id)).not.toContain("load-factor-penalty");
    expect(buildingSignals.map((signal) => signal.definition.id)).toContain("community-import");

    expect(communitySignals.map((signal) => signal.definition.id)).toContain("daily-peak-ratio");
    expect(communitySignals.map((signal) => signal.definition.id)).toContain("all-time-peak-ratio");
    expect(communitySignals.map((signal) => signal.definition.id)).toContain("load-factor-penalty");
  });
});
