import { describe, expect, it } from "vitest";
import type { SimulationSeries } from "../types";
import {
  buildChartRowsWithGranularity,
  GRANULARITY_OPTIONS,
  HOUR_MS,
  MINUTE_MS,
  SECOND_MS,
  inferSeriesResolutionMs,
  normalizeResolutionToSupportedGranularity,
  resolveAvailableGranularityOptions,
  resolveContextMinGranularityMs,
  resolveMinimumGranularityMs
} from "./timeseriesGranularity";

function makeSeries(metric: string, unit: string | undefined, values: Array<[number, number]>): SimulationSeries {
  return {
    id: `series::${metric}`,
    fileRef: "run/exported_data_building_1_ep0.csv",
    metric,
    unit,
    points: values.map(([epochMs, value]) => ({
      timestamp: new Date(epochMs).toISOString(),
      epochMs,
      value
    }))
  };
}

describe("timeseriesGranularity utils", () => {
  it("resolves context minimum granularity by preset and custom span", () => {
    expect(
      resolveContextMinGranularityMs({
        timePreset: "1h",
        useCustomRange: false,
        rangeStart: null,
        rangeEnd: null
      })
    ).toBe(15 * SECOND_MS);

    expect(
      resolveContextMinGranularityMs({
        timePreset: "7d",
        useCustomRange: false,
        rangeStart: null,
        rangeEnd: null
      })
    ).toBe(1 * HOUR_MS);

    expect(
      resolveContextMinGranularityMs({
        timePreset: "24h",
        useCustomRange: false,
        rangeStart: null,
        rangeEnd: null
      })
    ).toBe(15 * MINUTE_MS);

    expect(
      resolveContextMinGranularityMs({
        timePreset: "7d",
        useCustomRange: true,
        rangeStart: 0,
        rangeEnd: 6 * HOUR_MS
      })
    ).toBe(1 * MINUTE_MS);

    expect(
      resolveContextMinGranularityMs({
        timePreset: "all",
        useCustomRange: true,
        rangeStart: 0,
        rangeEnd: 70 * MINUTE_MS
      })
    ).toBe(1 * MINUTE_MS);
  });

  it("infers source resolution and normalizes to supported levels", () => {
    const series = [
      makeSeries("load_kw", "kW", [
        [0, 1],
        [5 * MINUTE_MS, 2],
        [10 * MINUTE_MS, 3]
      ])
    ];
    const resolution = inferSeriesResolutionMs(series);
    expect(resolution).toBe(5 * MINUTE_MS);
    expect(normalizeResolutionToSupportedGranularity(resolution)).toBe(5 * MINUTE_MS);
    expect(normalizeResolutionToSupportedGranularity(15 * SECOND_MS)).toBe(15 * SECOND_MS);
    expect(normalizeResolutionToSupportedGranularity(9 * MINUTE_MS)).toBe(15 * MINUTE_MS);
    expect(normalizeResolutionToSupportedGranularity(4 * HOUR_MS)).toBe(1 * HOUR_MS);
  });

  it("resolves minimum granularity combining context and source resolution", () => {
    const minFor24h = resolveMinimumGranularityMs({
      timePreset: "24h",
      useCustomRange: false,
      rangeStart: null,
      rangeEnd: null,
      sourceResolutionMs: 30 * MINUTE_MS
    });
    expect(minFor24h).toBe(30 * MINUTE_MS);

    const minFor6h = resolveMinimumGranularityMs({
      timePreset: "6h",
      useCustomRange: false,
      rangeStart: null,
      rangeEnd: null,
      sourceResolutionMs: 1 * MINUTE_MS
    });
    expect(minFor6h).toBe(1 * MINUTE_MS);
  });

  it("returns enabled/disabled granularity options", () => {
    const options = resolveAvailableGranularityOptions(15 * MINUTE_MS);
    expect(options.find((entry) => entry.ms === 15 * SECOND_MS)?.enabled).toBe(false);
    expect(options.find((entry) => entry.ms === 1 * MINUTE_MS)?.enabled).toBe(false);
    expect(options.find((entry) => entry.ms === 5 * MINUTE_MS)?.enabled).toBe(false);
    expect(options.find((entry) => entry.ms === 15 * MINUTE_MS)?.enabled).toBe(true);
    expect(options).toHaveLength(GRANULARITY_OPTIONS.length);
  });

  it("aggregates kWh as sum and kW/price/SoC as average by bucket", () => {
    const energy = makeSeries("energy_import_kwh", "kWh", [
      [0, 1.2],
      [10 * MINUTE_MS, 0.8],
      [40 * MINUTE_MS, 0.5]
    ]);
    const power = makeSeries("ev_power_kw", "kW", [
      [0, 10],
      [10 * MINUTE_MS, 14],
      [40 * MINUTE_MS, 12]
    ]);
    const price = makeSeries("energy_price", "€/kWh", [
      [0, 0.09],
      [10 * MINUTE_MS, 0.15]
    ]);
    const soc = makeSeries("battery_soc", "%", [
      [0, 0.4],
      [10 * MINUTE_MS, 0.6]
    ]);

    const rows = buildChartRowsWithGranularity(
      [energy, power, price, soc],
      [energy.id, power.id, price.id, soc.id],
      0,
      59 * MINUTE_MS,
      1 * HOUR_MS
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row[energy.id]).toBeCloseTo(2.5, 6);
    expect(row[power.id]).toBeCloseTo(12, 6);
    expect(row[price.id]).toBeCloseTo(0.12, 6);
    expect(row[soc.id]).toBeCloseTo(0.5, 6);
  });
});
