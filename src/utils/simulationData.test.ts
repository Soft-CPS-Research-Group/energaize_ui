import { describe, expect, it } from "vitest";
import {
  buildComparedKpis,
  buildSimulationTree,
  extractChargerStateSamples,
  extractKpisFromSimulationData,
  parseSimulationDataFile,
  scoreKpiImprovement
} from "./simulationData";

describe("simulationData utils", () => {
  it("parses known simulation file patterns", () => {
    const community = parseSimulationDataFile("run/exported_data_community_ep0.csv");
    const building = parseSimulationDataFile("run/exported_data_building_7_ep0.csv");
    const battery = parseSimulationDataFile("run/exported_data_building_7_battery_ep0.csv");
    const charger = parseSimulationDataFile("run/exported_data_building_7_charger_7_1_ep0.csv");
    const kpi = parseSimulationDataFile("run/exported_kpis.csv");

    expect(community.kind).toBe("community");
    expect(building.kind).toBe("building");
    expect(battery.kind).toBe("battery");
    expect(charger.kind).toBe("charger");
    expect(charger.chargerId).toBe("7_1");
    expect(kpi.kind).toBe("kpi");
  });

  it("builds a tree with grouped buildings", () => {
    const files = [
      parseSimulationDataFile("run/exported_data_community_ep0.csv"),
      parseSimulationDataFile("run/exported_data_building_1_ep0.csv"),
      parseSimulationDataFile("run/exported_data_building_1_battery_ep0.csv"),
      parseSimulationDataFile("run/exported_data_building_1_charger_1_1_ep0.csv"),
      parseSimulationDataFile("run/exported_data_electric_vehicle_1_ep0.csv")
    ];

    const tree = buildSimulationTree(files);
    const buildingNode = tree.children.find((node) => node.id === "building:1");
    expect(buildingNode).toBeTruthy();
    expect(buildingNode?.fileRefs).toHaveLength(1);
    expect(buildingNode?.children.length).toBe(2);

    const evGroup = tree.children.find((node) => node.id === "group:electric-vehicles");
    expect(evGroup).toBeTruthy();
  });

  it("extracts KPI entries from exported_kpis csv", () => {
    const csv = [
      "KPI,District,Building_1",
      "cost_total,12.5,4.3",
      "ev_departure_success_rate,0.91,0.88"
    ].join("\n");

    const parsed = extractKpisFromSimulationData(csv);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.entries.some((entry) => entry.key === "cost_total::District")).toBe(true);
    expect(parsed.entries.some((entry) => entry.key === "ev_departure_success_rate::Building_1")).toBe(true);
  });

  it("scores KPI improvement with heuristic direction", () => {
    expect(scoreKpiImprovement("cost_total::District", -1)).toBe("better");
    expect(scoreKpiImprovement("success_rate::District", 1)).toBe("better");
    expect(scoreKpiImprovement("unknown_metric", 1)).toBe("unknown");
  });

  it("builds comparison rows with tone", () => {
    const rows = buildComparedKpis(
      [{ key: "cost_total::District", label: "Cost Total - District", value: 100 }],
      [{ key: "cost_total::District", label: "Cost Total - District", value: 80 }],
      false
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].deltaAbs).toBe(-20);
    expect(rows[0].tone).toBe("better");
  });

  it("extracts charger state samples from charger csv", () => {
    const csv = [
      "Timestamp,EV Charger State,Incoming EV Name,EV Name,EV SOC-%",
      "2026-01-01T00:00:00Z,0,,,30",
      "2026-01-01T00:01:00Z,2,EV_ARRIVING,,31",
      "2026-01-01T00:02:00Z,1,,EV_CONNECTED,32",
      "2026-01-01T00:03:00Z,9,,EV_CONNECTED,33"
    ].join("\n");

    const samples = extractChargerStateSamples(csv);
    expect(samples).toHaveLength(4);
    expect(samples[0].chargerState).toBe(0);
    expect(samples[1].chargerState).toBe(2);
    expect(samples[1].incomingEvName).toBe("EV_ARRIVING");
    expect(samples[2].chargerState).toBe(1);
    expect(samples[2].evName).toBe("EV_CONNECTED");
    expect(samples[3].chargerState).toBe(0);
  });

  it("falls back to Is EV Connected when charger state column is missing", () => {
    const csv = [
      "Timestamp,Incoming EV Name,Is EV Connected,EV Name",
      "2026-01-01T00:00:00Z,EV_A,False,",
      "2026-01-01T00:01:00Z,EV_A,True,EV_A",
      "2026-01-01T00:02:00Z,,0,"
    ].join("\n");

    const samples = extractChargerStateSamples(csv);
    expect(samples).toHaveLength(3);
    expect(samples[0].chargerState).toBe(0);
    expect(samples[1].chargerState).toBe(1);
    expect(samples[2].chargerState).toBe(0);
  });
});
