import { describe, expect, it } from "vitest";
import type { DeployLogsHistoryLine } from "../api/deployApi";
import { buildLocalDayWindow, buildRolling24hWindow, computeDeployInvestorKpis } from "./deployInvestorKpis";

function line(ts: string | null, text: string): DeployLogsHistoryLine {
  return {
    ts,
    text,
    source: "docker:inference_test"
  };
}

describe("deployInvestorKpis", () => {
  it("computes daily investor KPIs from rbc.summary blocks", () => {
    const lines: DeployLogsHistoryLine[] = [
      line("2026-04-12T10:00:00Z", "2026-04-12 10:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=4.0 kW meter_in=0.0100 kWh meter_out=0.0020 kWh"),
      line(null, "Community: in=0.0050 kWh out=0.0000 kWh net=0.0050 kWh"),
      line(null, "Prices (EUR/kWh): now=0.1000 h1=0.1100"),
      line("2026-04-12T10:00:15Z", "2026-04-12 10:00:15.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=2.0 kW meter_in=0.0200 kWh meter_out=0.0010 kWh"),
      line(null, "Community: in=0.0100 kWh out=0.0000 kWh net=0.0100 kWh"),
      line(null, "Prices (EUR/kWh): now=0.2000 h1=0.2100")
    ];

    const summary = computeDeployInvestorKpis(
      [
        {
          targetId: "rh01",
          targetName: "R-H-01",
          lines
        }
      ],
      {
        windowStartEpochMs: Date.parse("2026-04-12T00:00:00Z"),
        windowEndEpochMs: Date.parse("2026-04-12T11:00:00Z")
      }
    );

    expect(summary.targets).toHaveLength(1);
    expect(summary.targets[0].savedEur).not.toBeNull();
    expect(summary.targets[0].savedEur || 0).toBeGreaterThan(0.0004);
    expect(summary.targets[0].savedPct || 0).toBeGreaterThan(0);
    expect(summary.targets[0].communitySharePct).toBeCloseTo(10, 2);
    expect(summary.targets[0].solarSelfConsumptionPct || 0).toBeGreaterThan(0);
    expect(summary.targets[0].solarSelfConsumptionPct || 0).toBeLessThan(100);
  });

  it("falls back to local price when RH01 canonical price is missing on some slots", () => {
    const rh01Lines: DeployLogsHistoryLine[] = [
      line("2026-04-12T10:15:00Z", "2026-04-12 10:15:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: meter_in=0.0000 kWh meter_out=0.0200 kWh solar=4.0 kW"),
      line(null, "Prices (EUR/kWh): now=0.2000")
    ];

    const hqLines: DeployLogsHistoryLine[] = [
      line("2026-04-12T10:00:00Z", "2026-04-12 10:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=3.0 kW"),
      line(null, "L1 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  AC000002_1 - ev=100 connected=yes action=1.0 min=1.6 max=4.6 flex=no"),
      line(null, "Prices (EUR/kWh): now=0.3000"),
      line("2026-04-12T10:15:00Z", "2026-04-12 10:15:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=0.0 kW"),
      line(null, "L1 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  AC000002_1 - ev=100 connected=yes action=1.0 min=1.6 max=4.6 flex=no"),
      line(null, "Prices (EUR/kWh): now=0.4000")
    ];

    const summary = computeDeployInvestorKpis(
      [
        {
          targetId: "rh01",
          targetName: "R-H-01",
          lines: rh01Lines
        },
        {
          targetId: "hq",
          targetName: "HQ",
          lines: hqLines
        }
      ],
      {
        windowStartEpochMs: Date.parse("2026-04-12T00:00:00Z"),
        windowEndEpochMs: Date.parse("2026-04-12T11:00:00Z")
      }
    );

    const hqSnapshot = summary.targets.find((entry) => entry.targetId === "hq");
    expect(hqSnapshot).toBeTruthy();
    expect(hqSnapshot?.priceSource).toBe("mixed");
    expect(hqSnapshot?.savedEur).not.toBeNull();
    expect(hqSnapshot?.savedEur || 0).toBeGreaterThan(0);
    expect(hqSnapshot?.savedPct || 0).toBeGreaterThanOrEqual(0);
  });

  it("estimates HQ demand from charger actions when meter_in is unavailable", () => {
    const rh01Lines: DeployLogsHistoryLine[] = [
      line("2026-04-12T10:00:00Z", "2026-04-12 10:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: meter_in=0.0000 kWh meter_out=0.0200 kWh solar=4.0 kW"),
      line(null, "Prices (EUR/kWh): now=0.2000")
    ];

    const hqLines: DeployLogsHistoryLine[] = [
      line("2026-04-12T10:00:00Z", "2026-04-12 10:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=0.0 kW"),
      line(null, "L1 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  AC000002_1 - ev=- connected=yes action=1.6 min=1.6 max=4.6 flex=no")
    ];

    const summary = computeDeployInvestorKpis(
      [
        {
          targetId: "rh01",
          targetName: "R-H-01",
          lines: rh01Lines
        },
        {
          targetId: "hq",
          targetName: "HQ",
          lines: hqLines
        }
      ],
      {
        windowStartEpochMs: Date.parse("2026-04-12T09:59:00Z"),
        windowEndEpochMs: Date.parse("2026-04-12T10:01:00Z")
      }
    );

    const hqSnapshot = summary.targets.find((entry) => entry.targetId === "hq");
    expect(hqSnapshot).toBeTruthy();
    expect(hqSnapshot?.demandKwh24 || 0).toBeGreaterThan(0);
    expect(hqSnapshot?.communitySharePct || 0).toBeGreaterThan(90);
    expect(hqSnapshot?.savedEur || 0).toBeGreaterThan(0);
    expect(hqSnapshot?.savedPct || 0).toBeGreaterThan(0);
    expect(hqSnapshot?.priceSource).toBe("rh01");
  });

  it("includes export revenue in saved amount", () => {
    const lines: DeployLogsHistoryLine[] = [
      line("2026-04-12T10:00:00Z", "2026-04-12 10:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: meter_in=0.0500 kWh meter_out=0.0100 kWh solar=0.0 kW"),
      line(null, "Community: in=0.0200 kWh out=0.0100 kWh net=0.0100 kWh"),
      line(null, "Prices (EUR/kWh): now=0.1000")
    ];

    const summary = computeDeployInvestorKpis(
      [
        {
          targetId: "rh01",
          targetName: "R-H-01",
          lines
        }
      ],
      {
        windowStartEpochMs: Date.parse("2026-04-12T09:59:00Z"),
        windowEndEpochMs: Date.parse("2026-04-12T10:01:00Z")
      }
    );

    const target = summary.targets[0];
    expect(target.savedEur).not.toBeNull();
    expect(target.savedEur || 0).toBeCloseTo(0.001, 6);
    expect(target.savedPct).not.toBeNull();
    expect(target.savedPct || 0).toBeCloseTo(20, 3);
  });

  it("does not show night-time solar as 100% when generation is near zero", () => {
    const lines: DeployLogsHistoryLine[] = [
      line("2026-04-12T23:00:00Z", "2026-04-12 23:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=0.0 kW meter_in=0.0100 kWh meter_out=0.0000 kWh"),
      line(null, "Prices (EUR/kWh): now=0.1500")
    ];

    const summary = computeDeployInvestorKpis(
      [
        {
          targetId: "rh01",
          targetName: "R-H-01",
          lines
        }
      ],
      {
        windowStartEpochMs: Date.parse("2026-04-12T22:00:00Z"),
        windowEndEpochMs: Date.parse("2026-04-12T23:30:00Z")
      }
    );

    expect(summary.targets[0].solarSelfConsumptionPct).toBeNull();
  });

  it("computes global KPIs with weighted aggregation", () => {
    const hqLines: DeployLogsHistoryLine[] = [
      line("2026-04-12T10:00:00Z", "2026-04-12 10:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=0.0 kW"),
      line(null, "L1 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  AC000002_1 - ev=100 connected=yes action=1.6 min=1.6 max=4.6 flex=no")
    ];
    const rh01Lines: DeployLogsHistoryLine[] = [
      line("2026-04-12T10:00:00Z", "2026-04-12 10:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: meter_in=0.0000 kWh meter_out=0.0400 kWh solar=4.0 kW"),
      line(null, "Prices (EUR/kWh): now=0.2000")
    ];

    const summary = computeDeployInvestorKpis(
      [
        {
          targetId: "hq",
          targetName: "HQ",
          lines: hqLines
        },
        {
          targetId: "rh01",
          targetName: "R-H-01",
          lines: rh01Lines
        }
      ],
      {
        windowStartEpochMs: Date.parse("2026-04-12T09:59:00Z"),
        windowEndEpochMs: Date.parse("2026-04-12T10:01:00Z")
      }
    );

    expect(summary.global.savedEur || 0).toBeGreaterThan(0);
    expect(summary.global.communitySharePct || 0).toBeGreaterThan(0);
    expect(summary.global.communitySharePct || 0).toBeLessThanOrEqual(100);
  });

  it("respects battery dispatch sign for virtual meters (SM/HQ)", () => {
    const lines: DeployLogsHistoryLine[] = [
      line("2026-04-12T10:00:00Z", "2026-04-12 10:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Battery: soc=50.0% dispatch=1.0 kW"),
      line(null, "Prices (EUR/kWh): now=0.2000"),
      line("2026-04-12T10:00:15Z", "2026-04-12 10:00:15.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Battery: soc=50.0% dispatch=-1.0 kW"),
      line(null, "Prices (EUR/kWh): now=0.2000")
    ];

    const summary = computeDeployInvestorKpis(
      [
        {
          targetId: "sao_mamede",
          targetName: "Sao Mamede",
          lines
        }
      ],
      {
        windowStartEpochMs: Date.parse("2026-04-12T09:59:00Z"),
        windowEndEpochMs: Date.parse("2026-04-12T10:01:00Z")
      }
    );

    const snapshot = summary.targets[0];
    expect(snapshot.gridImportKwh24).toBeGreaterThan(0);
    expect(snapshot.gridExportKwh24).toBeGreaterThan(0);
    expect(snapshot.communityInKwh24).toBeCloseTo(0, 8);
    expect(snapshot.communityOutKwh24).toBeCloseTo(0, 8);
  });

  it("allocates community transfer proportionally and conserves energy per slot", () => {
    const hqLines: DeployLogsHistoryLine[] = [
      line("2026-04-12T10:00:00Z", "2026-04-12 10:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=0.0 kW"),
      line(null, "L1 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  AC000002_1 - ev=42 connected=yes action=2.4 min=1.6 max=4.6 flex=no"),
      line("2026-04-12T10:00:15Z", "2026-04-12 10:00:15.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=0.0 kW"),
      line(null, "L1 - total=0.0 kW runtime_limit=19.9 kW manifest_limit=18.3 kW"),
      line(null, "  AC000002_1 - ev=42 connected=yes action=2.4 min=1.6 max=4.6 flex=no")
    ];
    const smLines: DeployLogsHistoryLine[] = [
      line("2026-04-12T10:00:00Z", "2026-04-12 10:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=2.4 kW"),
      line(null, "Prices (EUR/kWh): now=0.2000"),
      line("2026-04-12T10:00:15Z", "2026-04-12 10:00:15.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Inputs: solar=2.4 kW"),
      line(null, "Prices (EUR/kWh): now=0.2000")
    ];

    const summary = computeDeployInvestorKpis(
      [
        {
          targetId: "hq",
          targetName: "HQ",
          lines: hqLines
        },
        {
          targetId: "sao_mamede",
          targetName: "Sao Mamede",
          lines: smLines
        }
      ],
      {
        windowStartEpochMs: Date.parse("2026-04-12T09:59:00Z"),
        windowEndEpochMs: Date.parse("2026-04-12T10:01:00Z")
      }
    );

    const hq = summary.targets.find((entry) => entry.targetId === "hq");
    const sm = summary.targets.find((entry) => entry.targetId === "sao_mamede");
    expect(hq).toBeTruthy();
    expect(sm).toBeTruthy();

    expect((hq?.communityInKwh24 || 0) > 0).toBe(true);
    expect((sm?.communityOutKwh24 || 0) > 0).toBe(true);
    expect(hq?.communityInKwh24 || 0).toBeCloseTo(sm?.communityOutKwh24 || 0, 6);
    expect(hq?.communitySharePct || 0).toBeCloseTo(100, 3);
    expect(sm?.solarSelfConsumptionPct || 0).toBeGreaterThan(99);
  });

  it("builds local-day window in local timezone and exports UTC timestamps", () => {
    const reference = new Date(2026, 3, 12, 13, 45, 0, 0);
    const window = buildLocalDayWindow(reference);

    const sinceLocal = new Date(window.sinceTs);
    const untilLocal = new Date(window.untilTs);

    expect(sinceLocal.getHours()).toBe(0);
    expect(sinceLocal.getMinutes()).toBe(0);
    expect(untilLocal.getHours()).toBe(13);
    expect(untilLocal.getMinutes()).toBe(45);
    expect(window.localDayKey).toBe("2026-04-12");
  });

  it("builds rolling 24h window from now", () => {
    const reference = new Date("2026-04-12T12:00:00Z");
    const window = buildRolling24hWindow(reference);

    expect(window.untilEpochMs - window.sinceEpochMs).toBe(24 * 60 * 60 * 1000);
    expect(new Date(window.untilTs).toISOString()).toBe("2026-04-12T12:00:00.000Z");
    expect(new Date(window.sinceTs).toISOString()).toBe("2026-04-11T12:00:00.000Z");
    expect(window.localDayKey.startsWith("rolling_")).toBe(true);
  });

  it("computes low coverage when slots are sparse", () => {
    const lines: DeployLogsHistoryLine[] = [
      line("2026-04-12T10:00:00Z", "2026-04-12 10:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Community: in=0.0050 kWh out=0.0000 kWh net=0.0050 kWh"),
      line("2026-04-12T11:00:00Z", "2026-04-12 11:00:00.000 | INFO | POST /inference | rbc.summary"),
      line(null, "Community: in=0.0050 kWh out=0.0000 kWh net=0.0050 kWh")
    ];

    const summary = computeDeployInvestorKpis(
      [
        {
          targetId: "rh01",
          targetName: "R-H-01",
          lines
        }
      ],
      {
        windowStartEpochMs: Date.parse("2026-04-12T10:00:00Z"),
        windowEndEpochMs: Date.parse("2026-04-12T11:00:00Z")
      }
    );

    expect(summary.targets[0].coveragePct).toBeLessThan(10);
    expect(summary.targets[0].coverageSlotsExpected).toBeGreaterThan(summary.targets[0].coverageSlotsPresent);
  });
});
