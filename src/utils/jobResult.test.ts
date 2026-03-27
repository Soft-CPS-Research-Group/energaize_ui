import { describe, expect, it } from "vitest";
import { buildKpiComparisonRows, extractArtifacts, extractKpis, extractTimeseries } from "./jobResult";

describe("jobResult utils", () => {
  it("extracts KPIs from result.kpis first", () => {
    const payload = {
      kpis: {
        total_cost_eur: 34.2,
        self_consumption_pct: 82.1
      },
      other: {
        ignored_value: 4
      }
    };

    const kpis = extractKpis(payload);
    expect(kpis.map((item) => item.key)).toEqual(["self_consumption_pct", "total_cost_eur"]);
    expect(kpis.find((item) => item.key === "self_consumption_pct")?.unit).toBe("%");
  });

  it("extracts timeseries from explicit timeseries payload", () => {
    const payload = {
      timeseries: {
        power_kw: [1, 2, 3, 4],
        price: [
          { time: "2025-01-01T00:00:00Z", value: 0.12 },
          { time: "2025-01-01T01:00:00Z", value: 0.15 }
        ]
      }
    };

    const series = extractTimeseries(payload);
    expect(series.length).toBe(2);
    expect(series[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts artifacts from result and job_info", () => {
    const artifacts = extractArtifacts(
      {
        artifacts: {
          model_path: "/tmp/model.pkl"
        }
      },
      {
        job_id: "job-1",
        config_path: "/configs/demo.yaml"
      }
    );

    expect(artifacts.some((item) => item.pathOrUri.includes("model.pkl"))).toBe(true);
    expect(artifacts.some((item) => item.pathOrUri.includes("demo.yaml"))).toBe(true);
  });

  it("builds comparison rows with deltas", () => {
    const rows = buildKpiComparisonRows(
      [
        { key: "cost", label: "Cost", value: 100 },
        { key: "reward", label: "Reward", value: 10 }
      ],
      [
        { key: "cost", label: "Cost", value: 80 },
        { key: "reward", label: "Reward", value: 15 }
      ],
      false
    );

    const costRow = rows.find((row) => row.key === "cost");
    expect(costRow?.deltaAbs).toBe(-20);
    expect(costRow?.deltaPct).toBe(-20);
  });
});

