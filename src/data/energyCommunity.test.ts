import { describe, expect, it } from "vitest";
import { INITIAL_COMMUNITIES } from "../constants";
import {
  buildEnergySeries,
  getEnergyEntity,
  getEnergyLogs,
  getEnergyTree,
  getProsumerBuildingScopes,
  getProsumerDefaultScope
} from "./energyCommunity";

describe("energy community demo data", () => {
  const community = INITIAL_COMMUNITIES[0];

  it("limits the prosumer tree to the community, own home and own assets", () => {
    const tree = getEnergyTree(community, "prosumer");
    const serialized = JSON.stringify(tree);

    expect(serialized).toContain("House 1");
    expect(serialized).toContain("EV Charger");
    expect(serialized).not.toContain("Apartment 1");
    expect(serialized).not.toContain("Main Transformer");
  });

  it("resolves the prosumer entry scope to the owned building or home", () => {
    const scopes = getProsumerBuildingScopes(community);

    expect(scopes).toHaveLength(1);
    expect(scopes[0].id).toBe("site-house-1");
  });

  it("finds the first available prosumer building when the active REC is blank", () => {
    const defaultScope = getProsumerDefaultScope([
      {
        id: "new-rec",
        name: "New REC",
        location: "Porto, PT",
        buildings: 0,
        assets: 0,
        status: "normal",
        topologyPreset: "blank"
      },
      ...INITIAL_COMMUNITIES
    ]);

    expect(defaultScope?.community.id).toBe("solar-community");
    expect(defaultScope?.scope.id).toBe("site-house-1");
  });

  it("starts blank communities with only the community root", () => {
    const tree = getEnergyTree(
      {
        id: "new-rec",
        name: "New REC",
        location: "Porto, PT",
        buildings: 0,
        assets: 0,
        status: "normal",
        topologyPreset: "blank"
      },
      "rec_manager"
    );

    expect(tree).toHaveLength(1);
    expect(tree[0].label).toBe("New REC");
    expect(tree[0].children).toHaveLength(0);
  });

  it("falls back to community when an entity is not accessible for the role", () => {
    const entity = getEnergyEntity(community, "prosumer", "main-transformer");

    expect(entity.id).toBe("community");
  });

  it("builds deterministic chart series for the selected entity", () => {
    const entity = getEnergyEntity(community, "rec_manager", "community");
    const series = buildEnergySeries(entity, "24h");

    expect(series.length).toBeGreaterThan(24);
    expect(series[0]).toHaveProperty("consumption");
    expect(series[0]).toHaveProperty("production");
  });

  it("hides debug and unrelated logs from prosumers", () => {
    const logs = getEnergyLogs("prosumer");

    expect(logs.some((item) => item.level === "debug")).toBe(false);
    expect(logs.some((item) => item.entity === "Main Transformer")).toBe(false);
  });
});
