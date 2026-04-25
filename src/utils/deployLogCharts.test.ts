import { describe, expect, it } from "vitest";
import {
  buildDeployAssetTree,
  buildDeployChartSeries,
  computeAvailabilityPercent,
  computeNoDataIntervals,
  parseDeployLogSamples,
  resolveDeploySiteProfile,
  resolveDeploySiteLabel
} from "./deployLogCharts";
import type { DeployLogsHistoryLine } from "../api/deployApi";

function line(ts: string | null, text: string): DeployLogsHistoryLine {
  return {
    ts,
    text,
    source: "docker:inference_demo"
  };
}

describe("deployLogCharts utils", () => {
  it("parses rbc.summary and classifies assets/units", () => {
    const samples = parseDeployLogSamples([
      line(
        "2026-04-12T12:00:00Z",
        "INFO | rbc.summary | grid_import_kw=18.4 solar_generation_kw=7.1 ev_departure_success_ratio=0.91"
      )
    ]);

    expect(samples.length).toBe(3);
    expect(samples.find((item) => item.assetId === "grid")?.unit).toBe("kW");
    expect(samples.find((item) => item.assetId === "solar")?.unit).toBe("kW");
    expect(samples.find((item) => item.assetId === "ev")?.unit).toBe("%");
  });

  it("parses numeric key-value logs even without rbc source marker", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-12T12:00:00Z", "INFO | metrics snapshot | grid_import_kw=18.4 battery_soc_ratio=0.61")
    ]);

    expect(samples.length).toBe(2);
    expect(samples.some((item) => item.assetId === "grid")).toBe(true);
    expect(samples.some((item) => item.assetId === "battery")).toBe(true);
  });

  it("reuses last known timestamp for continuation lines and parses charger phase metrics", () => {
    const samples = parseDeployLogSamples([
      line(
        "2026-04-12T12:59:20.007Z",
        "2026-04-12 12:59:20.007 | INFO | request_id=abc | status=0 | POST /inference | rbc.summary"
      ),
      line(null, "Inputs: solar=4.7 kW unmanaged=0.0 kW community_in=-"),
      line(null, "L1 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  AC000002_1 - ev=- connected=yes action=1.6 min=1.6 max=4.6 flex=no")
    ]);

    const solar = samples.find((item) => item.metricKey === "solar");
    expect(solar?.unit).toBe("kW");
    expect(solar?.timestamp).toBe("2026-04-12T12:59:20.007Z");

    const charger = samples.find((item) => item.assetId === "charger_ac000002_1" && item.metricKey === "action_kw");
    expect(charger?.value).toBe(1.6);
    expect(charger?.unit).toBe("kW");
  });

  it("parses community_* metrics from Inputs line", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-12T12:59:20.007Z", "2026-04-12 12:59:20.007 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=4.7 kW community_in=0.0120 kWh community_out=0.0020 kWh community_net=0.0100 kWh")
    ]);

    expect(samples.some((item) => item.assetId === "community" && item.metricKey === "community_in")).toBe(true);
    expect(samples.some((item) => item.assetId === "community" && item.metricKey === "community_out")).toBe(true);
    expect(samples.some((item) => item.assetId === "community" && item.metricKey === "community_net")).toBe(true);
  });

  it("deduplicates 3-phase charger action into a single plotted series", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-12T12:59:20.007Z", "2026-04-12 12:59:20.007 | INFO | rbc.summary"),
      line(null, "L1 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  BB000018_1 - ev=- connected=yes action=8.0 min=8.0 max=10.0 flex=no"),
      line(null, "L2 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  BB000018_1 - ev=- connected=yes action=8.0 min=8.0 max=10.0 flex=no"),
      line(null, "L3 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  BB000018_1 - ev=- connected=yes action=8.0 min=8.0 max=10.0 flex=no")
    ]);

    const bbActionSeries = buildDeployChartSeries(samples).find((entry) => entry.assetId === "charger_bb000018_1");
    expect(bbActionSeries?.id).toBe("charger_bb000018_1::action_kw");
    expect(bbActionSeries?.points.length).toBe(1);
  });

  it("treats timezone-less ISO timestamps as UTC", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-12T12:00:00", "INFO | rbc.summary | grid_import_kw=18.4")
    ]);

    expect(samples.length).toBe(1);
    expect(samples[0].timestamp).toBe("2026-04-12T12:00:00.000Z");
    expect(samples[0].epochMs).toBe(Date.parse("2026-04-12T12:00:00Z"));
  });

  it("maps virtual/community battery aliases to community group", () => {
    const samples = parseDeployLogSamples([
      line(
        "2026-04-12T12:00:00Z",
        "INFO | rbc.actions | virtual_battery_power_kw=-1.2 community_battery_soc_ratio=0.55"
      )
    ]);

    expect(samples.every((item) => item.assetId === "community")).toBe(true);
    expect(samples.every((item) => item.assetKind === "community")).toBe(true);
  });

  it("parses 'Community battery' summary line into community metrics for charts", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-13T08:13:25.006Z", "2026-04-13 08:13:25.006 | INFO | POST /inference | rbc.summary"),
      line(
        null,
        "Community battery (B01): action=-4.6 kW soc_raw=0.8471 soc=84.7% soc_unit_mode=fraction charge_cap=50.0 kW discharge_cap=50.0 kW"
      )
    ]);

    expect(samples.some((item) => item.assetId === "community" && item.metricKey === "battery_action")).toBe(true);
    expect(samples.some((item) => item.assetId === "community" && item.metricKey === "battery_soc")).toBe(true);
    expect(samples.some((item) => item.assetId === "community" && item.metricKey === "battery_soc_raw")).toBe(true);
  });

  it("builds chart series with point deduplication on same epoch", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-12T12:00:00Z", "INFO | rbc.summary | grid_import_kw=10.0"),
      line("2026-04-12T12:00:00Z", "INFO | rbc.summary | grid_import_kw=11.0"),
      line("2026-04-12T12:05:00Z", "INFO | rbc.summary | grid_import_kw=12.5")
    ]);

    const series = buildDeployChartSeries(samples);
    expect(series.length).toBe(1);
    expect(series[0].points.length).toBe(2);
    expect(series[0].points[0].value).toBe(11);
    expect(series[0].points[1].value).toBe(12.5);
  });

  it("computes no-data intervals with adaptive threshold", () => {
    const start = Date.parse("2026-04-12T12:00:00Z");
    const rows = [
      { epochMs: start, seriesA: 1 },
      { epochMs: start + 5 * 60_000, seriesA: 2 },
      { epochMs: start + 25 * 60_000, seriesA: 3 },
      { epochMs: start + 30 * 60_000, seriesA: 4 }
    ];

    const intervals = computeNoDataIntervals(
      rows,
      ["seriesA"],
      start,
      start + 60 * 60_000,
      5 * 60_000
    );

    expect(intervals.length).toBeGreaterThanOrEqual(2);
    expect(intervals[0].startEpochMs).toBe(start + 5 * 60_000);
    expect(intervals[0].endEpochMs).toBe(start + 25 * 60_000);

    const coverage = computeAvailabilityPercent(rows, ["seriesA"], start, start + 60 * 60_000, 5 * 60_000);
    expect(coverage).toBeLessThan(50);
    expect(coverage).toBeGreaterThan(20);
  });

  it("keeps hardcoded profile assets even without data", () => {
    const profile = resolveDeploySiteProfile("sm");
    const tree = buildDeployAssetTree(profile, []);

    expect(tree.some((node) => node.id === "community")).toBe(true);
    expect(tree.some((node) => node.id === "chargers")).toBe(true);
  });

  it("groups all charger_* series under Chargers in tree", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-12T12:59:20.007Z", "2026-04-12 12:59:20.007 | INFO | rbc.summary"),
      line(null, "L1 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  AC000002_1 - ev=- connected=no action=1.6 min=1.6 max=4.6 flex=no"),
      line(null, "L2 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  BB000018_1 - ev=- connected=yes action=8.0 min=8.0 max=10.0 flex=no")
    ]);
    const series = buildDeployChartSeries(samples);
    const tree = buildDeployAssetTree(resolveDeploySiteProfile("hq"), series);

    expect(tree.some((node) => node.id === "grid")).toBe(false);
    expect(tree.some((node) => node.id === "ev")).toBe(false);

    const chargersNode = tree.find((node) => node.id === "chargers");
    expect(chargersNode).toBeTruthy();
    expect(chargersNode?.metrics.some((metric) => metric.label.includes("AC000002_1"))).toBe(true);
    expect(chargersNode?.metrics.some((metric) => metric.label.includes("BB000018_1"))).toBe(true);
  });

  it("sets charger action to 0 when vehicle is not connected", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-12T12:59:20.007Z", "2026-04-12 12:59:20.007 | INFO | rbc.summary"),
      line(null, "L1 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  AC000002_1 - ev=- connected=no action=1.6 min=1.6 max=4.6 flex=no")
    ]);

    const action = samples.find((item) => item.assetId === "charger_ac000002_1" && item.metricKey === "action_kw");
    expect(action?.value).toBe(0);
  });

  it("maps rh01 summary blocks into charger, battery, grid, solar and community assets", () => {
    const samples = parseDeployLogSamples([
      line(
        "2026-04-12T20:54:35.021Z",
        "2026-04-12 20:54:35.021 | INFO | request_id=abc | status=0 | POST /inference | rbc.summary"
      ),
      line(
        null,
        "Inputs: non_shiftable=0.0 kW solar=0.0 kW meter_in=0.0062 kWh (1.49 kW) meter_out=0.0000 kWh (0.00 kW) meter_net=0.0062 kWh (1.49 kW)"
      ),
      line(null, "EV: connected=no hard_min=0.0 kW floor=0.0 kW max=0.0 kW dispatch=0.0 kW"),
      line(null, "Battery: soc=23.0% bounds=[-4.8, 4.8] kW dispatch=0.0 kW"),
      line(null, "Grid: base_wo_battery=1.4 kW import_limit=8.0 kW export_limit=8.0 kW net=1.4 kW"),
      line(
        null,
        "Community: in=0.0177 kWh (4.25 kW) out=0.0000 kWh (0.00 kW) net=0.0177 kWh (4.25 kW) effective_community_target_kw=0.0 kW"
      ),
      line(null, "Prices (EUR/kWh): now=0.0350 h1=0.0350 h2=0.0200 h6=0.0089 h12=0.0015 h24=0.0830 avg_24h=0.0284")
    ]);

    expect(samples.some((item) => item.assetId === "charger_ev_1" && item.metricKey === "action_kw")).toBe(true);
    expect(samples.some((item) => item.assetId === "battery" && item.metricKey === "battery_soc")).toBe(true);
    expect(samples.some((item) => item.assetId === "battery" && item.metricKey === "battery_dispatch")).toBe(true);
    expect(samples.some((item) => item.assetId === "grid" && item.metricKey === "meter_in")).toBe(true);
    expect(samples.some((item) => item.assetId === "grid" && item.metricKey === "meter_out")).toBe(true);
    expect(samples.some((item) => item.assetId === "grid" && item.metricKey === "meter_net")).toBe(true);
    expect(samples.some((item) => item.assetId === "grid" && item.metricKey === "grid_net")).toBe(false);
    expect(samples.some((item) => item.assetId === "community" && item.metricKey === "community_in")).toBe(true);
    expect(samples.some((item) => item.assetId === "community" && item.metricKey === "community_out")).toBe(true);
    expect(samples.some((item) => item.assetId === "community" && item.metricKey === "community_net")).toBe(true);
    expect(samples.some((item) => item.assetId === "community" && item.metricKey === "community_target_battery_raw")).toBe(false);
    expect(samples.some((item) => item.assetId === "solar")).toBe(true);
    expect(samples.some((item) => item.assetId === "pricing" && item.metricKey === "price_now")).toBe(true);
  });

  it("shows Grid node for rh01 tree", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-12T20:54:35.021Z", "2026-04-12 20:54:35.021 | INFO | request_id=abc | status=0 | POST /inference | rbc.summary"),
      line(null, "Grid: base_wo_battery=1.4 kW import_limit=8.0 kW export_limit=8.0 kW net=1.4 kW")
    ]);
    const series = buildDeployChartSeries(samples);
    const tree = buildDeployAssetTree(resolveDeploySiteProfile("rh01"), series);
    expect(tree.some((node) => node.id === "grid")).toBe(true);
  });

  it("shows Prices node for rh01 tree", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-12T20:54:35.021Z", "2026-04-12 20:54:35.021 | INFO | request_id=abc | status=0 | POST /inference | rbc.summary"),
      line(null, "Prices (EUR/kWh): now=0.0350 h1=0.0350 h2=0.0200 h6=0.0089")
    ]);
    const series = buildDeployChartSeries(samples);
    const tree = buildDeployAssetTree(resolveDeploySiteProfile("rh01"), series);
    expect(tree.some((node) => node.id === "pricing")).toBe(true);
  });

  it("keeps price unit declared in Prices header", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-12T20:54:35.021Z", "2026-04-12 20:54:35.021 | INFO | request_id=abc | status=0 | POST /inference | rbc.summary"),
      line(null, "Prices (EUR/MWh): now=64.2 h1=58.0 h2=52.1")
    ]);

    const now = samples.find((item) => item.metricKey === "price_now");
    expect(now?.unit).toBe("EUR/MWh");
  });

  it("parses W and Wh units from inline summary tokens", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-12T20:54:35.021Z", "2026-04-12 20:54:35.021 | INFO | request_id=abc | status=0 | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=4200 W meter_in=6200 Wh meter_out=0 Wh")
    ]);

    const solar = samples.find((item) => item.metricKey === "solar");
    const meterIn = samples.find((item) => item.metricKey === "meter_in");
    expect(solar?.unit).toBe("W");
    expect(meterIn?.unit).toBe("Wh");
  });

  it("shows only Battery action and SoC metrics in battery charts tree", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-13T08:13:25.006Z", "2026-04-13 08:13:25.006 | INFO | POST /inference | rbc.summary"),
      line(
        null,
        "Community battery (B01): action=-4.6 kW soc_raw=0.8471 soc=84.7% soc_unit_mode=fraction charge_cap=50.0 kW discharge_cap=50.0 kW"
      ),
      line(null, "Battery: soc=83.9% bounds=[-50.0, 50.0] kW dispatch=-4.6 kW")
    ]);

    const series = buildDeployChartSeries(samples);
    const tree = buildDeployAssetTree(resolveDeploySiteProfile("sao_mamede"), series);
    const battery = tree.find((node) => node.id === "battery");

    expect(battery).toBeTruthy();
    expect(battery?.metrics.length).toBeLessThanOrEqual(2);
    expect(battery?.metrics.some((metric) => metric.label.toLowerCase().includes("soc"))).toBe(true);
    expect(
      battery?.metrics.some(
        (metric) =>
          metric.label.toLowerCase().includes("action") || metric.label.toLowerCase().includes("dispatch")
      )
    ).toBe(true);
  });

  it("maps rh01 EV dispatch line into Chargers group", () => {
    const samples = parseDeployLogSamples([
      line("2026-04-12T20:54:35.021Z", "2026-04-12 20:54:35.021 | INFO | request_id=abc | status=0 | POST /inference | rbc.summary"),
      line(null, "EV: connected=no hard_min=0.0 kW floor=0.0 kW max=0.0 kW dispatch=1.6 kW")
    ]);
    const series = buildDeployChartSeries(samples);
    const tree = buildDeployAssetTree(resolveDeploySiteProfile("rh01"), series);
    const chargers = tree.find((node) => node.id === "chargers");
    expect(chargers).toBeTruthy();
    expect(chargers?.metrics.some((metric) => metric.label === "EV Charger")).toBe(true);
  });

  it("resolves boavista label from hq", () => {
    expect(resolveDeploySiteLabel("hq")).toBe("Boavista (HQ)");
  });

  it("resolves rh1 aliases as R-H-01 profile/label", () => {
    expect(resolveDeploySiteLabel("rh1")).toBe("R-H-01");
    expect(resolveDeploySiteProfile("rh1").id).toBe("rh01");
  });
});
