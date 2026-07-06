import { describe, expect, it } from "vitest";
import {
  buildComparedKpis,
  buildSimulationTree,
  extractChargerStateSamples,
  extractKpisFromSimulationData,
  filterFilesToLatestEpisode,
  parseSimulationDataFile,
  scoreKpiImprovement
} from "./simulationData";

describe("simulationData utils", () => {
  it("parses known simulation file patterns", () => {
    const community = parseSimulationDataFile("run/exported_data_community_ep0.csv");
    const building = parseSimulationDataFile("run/exported_data_building_7_ep0.csv");
    const battery = parseSimulationDataFile("run/exported_data_building_7_battery_ep0.csv");
    const charger = parseSimulationDataFile("run/exported_data_building_7_charger_7_1_ep0.csv");
    const site = parseSimulationDataFile("latest/exported_data_hq_ep0.csv");
    const siteBattery = parseSimulationDataFile("latest/exported_data_hq_battery_ep0.csv");
    const siteCharger = parseSimulationDataFile("latest/exported_data_hq_charger_hq_01_ep0.csv");
    const evAlias = parseSimulationDataFile("latest/exported_data_ev_demo9_001_ep0.csv");
    const kpi = parseSimulationDataFile("run/exported_kpis.csv");

    expect(community.kind).toBe("community");
    expect(building.kind).toBe("building");
    expect(battery.kind).toBe("battery");
    expect(charger.kind).toBe("charger");
    expect(charger.chargerId).toBe("7_1");
    expect(site.kind).toBe("building");
    expect(site.buildingId).toBe("hq");
    expect(siteBattery.kind).toBe("battery");
    expect(siteBattery.buildingId).toBe("hq");
    expect(siteCharger.kind).toBe("charger");
    expect(siteCharger.buildingId).toBe("hq");
    expect(siteCharger.chargerId).toBe("hq_01");
    expect(evAlias.kind).toBe("electric_vehicle");
    expect(evAlias.vehicleId).toBe("demo9_001");
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

  it("builds the asset tree from the latest episode only", () => {
    const files = [
      parseSimulationDataFile("run/exported_data_building_1_ep1.csv"),
      parseSimulationDataFile("run/exported_data_building_1_battery_ep1.csv"),
      parseSimulationDataFile("run/exported_data_building_1_charger_1_1_ep1.csv"),
      parseSimulationDataFile("run/exported_data_building_1_ep2.csv"),
      parseSimulationDataFile("run/exported_data_building_1_battery_ep2.csv"),
      parseSimulationDataFile("run/exported_data_building_1_charger_1_1_ep2.csv")
    ];

    const tree = buildSimulationTree(files);
    const buildingNode = tree.children.find((node) => node.id === "building:1");
    const batteryNode = buildingNode?.children.find((node) => node.kind === "battery");
    const chargerNode = buildingNode?.children.find((node) => node.kind === "charger");

    expect(buildingNode?.fileRefs).toEqual(["run/exported_data_building_1_ep2.csv"]);
    expect(buildingNode?.children).toHaveLength(2);
    expect(batteryNode?.fileRefs).toEqual(["run/exported_data_building_1_battery_ep2.csv"]);
    expect(chargerNode?.fileRefs).toEqual(["run/exported_data_building_1_charger_1_1_ep2.csv"]);
  });

  it("filters file entries to the latest episode while preserving episode-less files", () => {
    const files = [
      parseSimulationDataFile("run/exported_data_building_1_ep1.csv"),
      parseSimulationDataFile("run/exported_data_building_1_ep2.csv"),
      parseSimulationDataFile("run/exported_kpis.csv")
    ];

    expect(filterFilesToLatestEpisode(files).map((file) => file.relativePath)).toEqual([
      "run/exported_data_building_1_ep2.csv",
      "run/exported_kpis.csv"
    ]);
  });

  it("builds a tree for named sites (hq/sao_mamede/r-h-01)", () => {
    const files = [
      parseSimulationDataFile("latest/exported_data_hq_ep0.csv"),
      parseSimulationDataFile("latest/exported_data_hq_battery_ep0.csv"),
      parseSimulationDataFile("latest/exported_data_hq_charger_hq_01_ep0.csv"),
      parseSimulationDataFile("latest/exported_data_sao_mamede_ep0.csv"),
      parseSimulationDataFile("latest/exported_data_sao_mamede_battery_ep0.csv"),
      parseSimulationDataFile("latest/exported_data_r-h-01_ep0.csv"),
      parseSimulationDataFile("latest/exported_data_r-h-01_charger_r_h_01_1_ep0.csv")
    ];

    const tree = buildSimulationTree(files);
    const hqNode = tree.children.find((node) => node.id === "building:hq");
    const saoNode = tree.children.find((node) => node.id === "building:sao_mamede");
    const rhNode = tree.children.find((node) => node.id === "building:r_h_01");

    expect(hqNode?.label).toBe("Boavista (HQ)");
    expect(hqNode?.children.length).toBe(2);
    expect(saoNode?.label).toBe("Sao Mamede");
    expect(rhNode?.label).toBe("R-H-01");
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
